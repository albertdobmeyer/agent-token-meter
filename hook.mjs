#!/usr/bin/env node
/**
 * Token Meter Threshold Hook for Claude Code
 *
 * Ultra-lean PostToolUse hook. Runs after every tool call but stays
 * silent unless a context threshold (50%, 75%, 90%) is crossed.
 * Each threshold fires ONCE per session. Compaction re-arms them.
 *
 * Install:   npx agent-token-meter --install-hooks
 * Remove:    npx agent-token-meter --uninstall-hooks
 */
import fs from "fs";
import path from "path";
import os from "os";

const COMPACT_BUFFER = 33_000;
const STATE = path.join(os.homedir(), ".claude", "token-meter-hook-state.json");

const LIMITS = {
  "claude-opus-4-7": 1_000_000,
  "claude-opus-4-6": 1_000_000, "claude-opus-4-5": 1_000_000,
  "claude-sonnet-4-6": 1_000_000, "claude-sonnet-4-5": 200_000,
  "claude-haiku-4-5": 200_000,
};
const DEFAULT_LIMIT = 1_000_000;

const CACHE_RATES = { opus: 1.5, sonnet: 0.3, haiku: 0.08 };

const THRESHOLDS = [
  { pct: 50, msg: "Context 50%. Plan a handoff point — write key decisions to a file." },
  { pct: 75, msg: "Context 75%. Write your plan/findings to a file now. Prepare to /clear." },
  { pct: 90, fn: (tax) => `Context 90%. ~$${tax}/call context tax. /clear now to avoid quadrupled costs.` },
];

// ── I/O helpers ──────────────────────────────────────────────────────

function emit(text) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { additionalContext: `[Token Meter] ${text}` },
  }));
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE, "utf8")); }
  catch { return {}; }
}

function saveState(s) {
  try { fs.writeFileSync(STATE, JSON.stringify(s)); } catch {}
}

// ── Hook payload from stdin ──────────────────────────────────────────
// Claude Code passes { session_id, transcript_path, cwd, tool_name, ... }
// as JSON on stdin. Reading fd 0 synchronously works because the payload
// is already buffered by the time the hook runs. Skip if stdin is a TTY
// (manual testing) to avoid blocking.

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

// ── Session discovery fallback ───────────────────────────────────────

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
      } catch { /* unreadable dir */ }
    }
  } catch { /* no projects dir */ }
  return best?.path;
}

function sessionIdFromPath(filePath) {
  const base = (filePath || "").split(/[\\/]/).pop() || "";
  return base.replace(/\.jsonl$/, "");
}

// ── Quick JSONL parse (only extracts what we need) ───────────────────

function parseQuick(filePath) {
  let content;
  try { content = fs.readFileSync(filePath, "utf8"); }
  catch { return null; }

  let model = "", ctx = 0, prevCtx = 0, compactions = 0;

  for (const line of content.split("\n")) {
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
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
    } catch { /* partial line or bad JSON */ }
  }

  return ctx > 0 ? { model, ctx, compactions } : null;
}

// ── Lookups ──────────────────────────────────────────────────────────

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

// ── Main ─────────────────────────────────────────────────────────────

const payload = readHookPayload();
// Authoritative session from Claude Code's payload; fallback to mtime scan.
const sessionPath = payload?.transcript_path || findSessionByMtime();
if (!sessionPath) process.exit(0);

const sessionId = payload?.session_id || sessionIdFromPath(sessionPath);

// State is keyed by session_id so concurrent Claude Code instances don't
// suppress each other's threshold firings.
const allState = loadState();
if (!allState.sessions) allState.sessions = {};
// Migrate legacy state format (flat, single-session blob) on load.
if (allState.session) {
  const legacyId = sessionIdFromPath(allState.session);
  if (legacyId && !allState.sessions[legacyId]) {
    allState.sessions[legacyId] = {
      fired: allState.fired || [], compactions: allState.compactions || 0,
    };
  }
  delete allState.session;
  delete allState.fired;
  delete allState.compactions;
}
const state = allState.sessions[sessionId] || { fired: [], compactions: 0 };
allState.sessions[sessionId] = state;

const m = parseQuick(sessionPath);
if (!m) { saveState(allState); process.exit(0); }

const limit = usableLimit(m.model);
const pct = (m.ctx / limit) * 100;

// Compaction detected — re-arm thresholds above current fill
if (m.compactions > (state.compactions || 0)) {
  state.compactions = m.compactions;
  state.fired = (state.fired || []).filter(t => t <= pct);
  saveState(allState);
  emit(`Compaction detected (${m.compactions}x). Context reset to ${pct.toFixed(0)}%. Thresholds re-armed.`);
  process.exit(0);
}

// Check thresholds — emit at most one per invocation
for (const t of THRESHOLDS) {
  if (pct >= t.pct && !(state.fired || []).includes(t.pct)) {
    state.fired = [...(state.fired || []), t.pct];
    const tax = (m.ctx / 1e6 * cacheRate(m.model)).toFixed(2);
    const msg = t.fn ? t.fn(tax) : t.msg;
    saveState(allState);
    emit(msg);
    process.exit(0);
  }
}

// No threshold crossed — silent
saveState(allState);
