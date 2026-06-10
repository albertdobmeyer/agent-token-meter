#!/usr/bin/env node
/**
 * Token Meter Hook for Claude Code (v1.4 — multi-event)
 *
 * Single hook script handles multiple event types via payload.hook_event_name:
 *
 *   PostToolUse  → threshold nudges at 50/75/90% context fill
 *   SessionStart → bootstrap-from-handoff nudge if a recent handoff exists in cwd
 *   PreCompact   → reserved (no-op in v1.4)
 *   PostCompact  → explicit compaction nudge; suppresses heuristic detection for 60s
 *
 * Install:   npx agent-token-meter --install-hooks
 * Remove:    npx agent-token-meter --uninstall-hooks
 *
 * State is keyed per session_id at ~/.claude/token-meter-hook-state.json.
 */

import fs from "fs";
import path from "path";
import os from "os";

const COMPACT_BUFFER = 33_000;
const STATE = path.join(os.homedir(), ".claude", "token-meter-hook-state.json");
const HEURISTIC_SUPPRESS_MS = 60_000;
const BOOTSTRAP_MAX_AGE_HOURS = 7 * 24;
const BOOTSTRAP_MAX_USER_TURNS = 2;

const LIMITS = {
  "claude-opus-4-7": 1_000_000,
  "claude-opus-4-6": 1_000_000, "claude-opus-4-5": 1_000_000,
  "claude-sonnet-4-6": 1_000_000, "claude-sonnet-4-5": 200_000,
  "claude-haiku-4-5": 200_000,
};
const DEFAULT_LIMIT = 1_000_000;
const CACHE_RATES = { opus: 1.5, sonnet: 0.3, haiku: 0.08 };

// Threshold messages map context fill to reasoning-degradation milestones.
// Each takes a `ctx` object { shortId, tax } and returns the message string.
const THRESHOLDS = [
  {
    pct: 50,
    fn: (ctx) => `Context 50%. Reasoning still sharp — start drafting the handoff at ./handoff-${ctx.shortId}.md (per AGENT-PROTOCOL.md if present).`,
  },
  {
    pct: 75,
    fn: (ctx) => `Context 75%. Drift zone — finish ./handoff-${ctx.shortId}.md now while curation is still cheap. Prepare to request /clear from the user.`,
  },
  {
    pct: 90,
    fn: (ctx) => `Context 90%. ~$${ctx.tax}/call tax + attention degrading. Confirm ./handoff-${ctx.shortId}.md is complete, then ask the user to /clear and reload by saying "continue from ./handoff-${ctx.shortId}.md".`,
  },
];

// ── I/O helpers ──────────────────────────────────────────────────────

function emit(text) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: process.env.HOOK_EVENT_NAME || "PostToolUse",
      additionalContext: `[Token Meter] ${text}`,
    },
  }));
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE, "utf8")); }
  catch { return {}; }
}

function saveState(s) {
  // tmp+rename so a second hook process (concurrent session) can't read a
  // half-written state file and lose per-session fired-threshold tracking;
  // the pid in the tmp name keeps two concurrent writers from colliding.
  try {
    const tmp = `${STATE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s));
    fs.renameSync(tmp, STATE);
  } catch {}
}

function readHookPayload() {
  if (process.stdin.isTTY) return null;
  try {
    const raw = fs.readFileSync(0, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function findSessionByMtime() {
  const dir = path.join(os.homedir(), ".claude", "projects");
  let best = null;
  try {
    for (const proj of fs.readdirSync(dir)) {
      const p = path.join(dir, proj);
      try {
        if (!fs.statSync(p).isDirectory()) continue;
        for (const f of fs.readdirSync(p)) {
          if (!f.endsWith(".jsonl")) continue;
          const fp = path.join(p, f);
          const mt = fs.statSync(fp).mtimeMs;
          if (!best || mt > best.mt) best = { path: fp, mt };
        }
      } catch { /* unreadable */ }
    }
  } catch { /* no projects dir */ }
  return best?.path;
}

function sessionIdFromPath(filePath) {
  const base = (filePath || "").split(/[\\/]/).pop() || "";
  return base.replace(/\.jsonl$/, "");
}

function parseQuick(filePath) {
  let content;
  try { content = fs.readFileSync(filePath, "utf8"); }
  catch { return null; }

  let model = "", ctx = 0, prevCtx = 0, compactions = 0, userTurns = 0;

  for (const line of content.split("\n")) {
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === "user" && obj.message?.role === "user") {
        if (!Array.isArray(obj.message.content) || !obj.message.content.some(c => c?.type === "tool_result")) {
          userTurns++;
        }
        continue;
      }
      if (obj.type !== "assistant" || !obj.message?.usage) continue;
      const u = obj.message.usage;
      const c = (u.input_tokens || 0) +
                (u.cache_creation_input_tokens || 0) +
                (u.cache_read_input_tokens || 0);
      if (c === 0) continue;
      if (obj.message.model) model = obj.message.model;
      if (prevCtx > 0 && c < prevCtx * 0.8 && prevCtx - c > 5000) compactions++;
      prevCtx = c;
      ctx = c;
    } catch { /* partial line */ }
  }

  return ctx > 0 ? { model, ctx, compactions, userTurns } : null;
}

function usableLimit(model) {
  for (const [k, v] of Object.entries(LIMITS)) {
    if (model.startsWith(k)) return v - COMPACT_BUFFER;
  }
  return DEFAULT_LIMIT - COMPACT_BUFFER;
}

function cacheRate(model) {
  for (const [k, v] of Object.entries(CACHE_RATES)) {
    if (model.includes(k)) return v;
  }
  return 1.5;
}

function getSessionState(allState, sessionId) {
  if (!allState.sessions) allState.sessions = {};
  // Legacy migration (pre-1.2.4 flat format)
  if (allState.session) {
    const legacyId = sessionIdFromPath(allState.session);
    if (legacyId && !allState.sessions[legacyId]) {
      allState.sessions[legacyId] = {
        fired: allState.fired || [],
        compactions: allState.compactions || 0,
      };
    }
    delete allState.session;
    delete allState.fired;
    delete allState.compactions;
  }
  if (!allState.sessions[sessionId]) {
    allState.sessions[sessionId] = { fired: [], compactions: 0 };
  }
  return allState.sessions[sessionId];
}

// ── Event handlers ──────────────────────────────────────────────────

function handlePostToolUse(payload) {
  const sessionPath = payload.transcript_path || findSessionByMtime();
  if (!sessionPath) process.exit(0);

  const sessionId = payload.session_id || sessionIdFromPath(sessionPath);
  const shortId = sessionId.slice(0, 8);

  const allState = loadState();
  const state = getSessionState(allState, sessionId);

  const m = parseQuick(sessionPath);
  if (!m) { saveState(allState); process.exit(0); }

  const limit = usableLimit(m.model);
  const pct = (m.ctx / limit) * 100;

  // Heuristic compaction detection — suppressed for 60s after an explicit PostCompact event
  const recentExplicitCompact = state.lastCompactEventMs &&
    (Date.now() - state.lastCompactEventMs) < HEURISTIC_SUPPRESS_MS;

  if (!recentExplicitCompact && m.compactions > (state.compactions || 0)) {
    state.compactions = m.compactions;
    state.fired = (state.fired || []).filter(t => t <= pct);
    saveState(allState);
    emit(`Compaction detected (${m.compactions}x). Context reset to ${pct.toFixed(0)}%. Position bias reset to fresh; thresholds re-armed. Write a fresh ./handoff-${shortId}.md now — the auto-summary is a fallback, not a substitute.`);
    process.exit(0);
  }

  // Threshold checks — emit at most one per invocation
  for (const t of THRESHOLDS) {
    if (pct >= t.pct && !(state.fired || []).includes(t.pct)) {
      state.fired = [...(state.fired || []), t.pct];
      const tax = (m.ctx / 1e6 * cacheRate(m.model)).toFixed(2);
      const ctx = { shortId, tax };
      saveState(allState);
      emit(t.fn(ctx));
      process.exit(0);
    }
  }

  saveState(allState);
}

function handleSessionStart(payload) {
  const sessionId = payload.session_id || "";
  const cwd = payload.cwd;
  if (!cwd) process.exit(0);

  const allState = loadState();
  const state = getSessionState(allState, sessionId);

  // Bootstrap fires once per session
  if (state.bootstrapFired) {
    saveState(allState);
    process.exit(0);
  }

  // Find the most recent handoff-*.md in cwd, modified within BOOTSTRAP_MAX_AGE_HOURS
  let handoff = null;
  try {
    const files = fs.readdirSync(cwd);
    for (const f of files) {
      // Strict pattern — only well-formed handoff filenames. A crafted name
      // (spaces, parens, quotes, newlines) is rejected, so nothing arbitrary
      // from the filesystem reaches the agent's additionalContext below.
      if (!/^handoff-[\w.-]+\.md$/.test(f)) continue;
      const fp = path.join(cwd, f);
      try {
        const stat = fs.statSync(fp);
        if (!stat.isFile()) continue;
        const ageMs = Date.now() - stat.mtimeMs;
        const ageHours = ageMs / 3_600_000;
        if (ageHours > BOOTSTRAP_MAX_AGE_HOURS) continue;
        if (!handoff || stat.mtimeMs > handoff.mtimeMs) {
          handoff = { file: f, mtimeMs: stat.mtimeMs, ageHours };
        }
      } catch { /* unreadable */ }
    }
  } catch { /* dir read failed */ }

  if (!handoff) {
    saveState(allState);
    process.exit(0);
  }

  // Verify session is fresh — check transcript for low user-turn count
  if (payload.transcript_path) {
    const m = parseQuick(payload.transcript_path);
    if (m && m.userTurns > BOOTSTRAP_MAX_USER_TURNS) {
      // Session isn't actually fresh — skip the bootstrap nudge
      state.bootstrapFired = true;
      saveState(allState);
      process.exit(0);
    }
  }

  state.bootstrapFired = true;
  saveState(allState);

  const ageStr = handoff.ageHours < 1
    ? `${Math.round(handoff.ageHours * 60)}m ago`
    : handoff.ageHours < 24
      ? `${Math.round(handoff.ageHours)}h ago`
      : `${Math.round(handoff.ageHours / 24)}d ago`;

  emit(`Fresh session in project with recent handoff (./${handoff.file}, ${ageStr}). Read it before continuing — it contains the prior session's mission, decisions, and open threads.`);
}

function handlePostCompact(payload) {
  const sessionPath = payload.transcript_path;
  if (!sessionPath) process.exit(0);

  const sessionId = payload.session_id || sessionIdFromPath(sessionPath);
  const shortId = sessionId.slice(0, 8);

  const m = parseQuick(sessionPath);
  if (!m) process.exit(0);

  const limit = usableLimit(m.model);
  const pct = (m.ctx / limit) * 100;

  const allState = loadState();
  const state = getSessionState(allState, sessionId);
  state.compactions = (state.compactions || 0) + 1;
  state.fired = (state.fired || []).filter(t => t <= pct);
  state.lastCompactEventMs = Date.now();
  saveState(allState);

  emit(`Compaction detected (${state.compactions}x). Context reset to ${pct.toFixed(0)}%. Position bias reset to fresh; thresholds re-armed. Write a fresh ./handoff-${shortId}.md now — the auto-summary is a fallback, not a substitute.`);
}

function handlePreCompact(payload) {
  // Reserved for v1.5. In v1.4 we exit silently.
  process.exit(0);
}

// ── Main ─────────────────────────────────────────────────────────────

const payload = readHookPayload();
if (!payload) process.exit(0);

const event = payload.hook_event_name || "PostToolUse";
process.env.HOOK_EVENT_NAME = event;

switch (event) {
  case "PostToolUse":
    handlePostToolUse(payload);
    break;
  case "SessionStart":
    handleSessionStart(payload);
    break;
  case "PostCompact":
    handlePostCompact(payload);
    break;
  case "PreCompact":
    handlePreCompact(payload);
    break;
  default:
    // Unknown event — exit silently for forward compatibility
    process.exit(0);
}
