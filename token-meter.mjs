#!/usr/bin/env node
/**
 * Agent Token Meter — zero-dependency burn-rate monitor for AI coding agents.
 *
 * Reads session logs and displays live token usage with burn-rate
 * acceleration, compaction prediction, and workflow advisor.
 *
 * Currently supports: Claude Code. More agents planned.
 *
 * Usage:
 *   npx agent-token-meter              # auto-detect agent and session
 *   npx agent-token-meter --all        # summary of all sessions
 *   npx agent-token-meter --help       # show help
 */

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import * as protocol from "./protocol.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// VERSION is sourced from package.json so a single bump stays in sync
// across dashboard header, --version, help text, and the npm tarball.
const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version;
  } catch { return "0.0.0"; }
})();

// ── Agent Profiles ───────────────────────────────────────────────────
// Each profile defines everything agent-specific. To add a new agent,
// add an entry here with the same shape.

const AGENTS = {
  "claude-code": {
    id: "claude-code",
    name: "Claude Code",
    sessionDir: () => path.join(os.homedir(), ".claude", "projects"),
    configDir: () => path.join(os.homedir(), ".claude"),
    configFile: "token-meter.json",
    pricing: {
      "claude-opus-4-7":   { input: 15,   output: 75,  cacheWrite: 18.75, cacheRead: 1.5  },
      "claude-opus-4-6":   { input: 15,   output: 75,  cacheWrite: 18.75, cacheRead: 1.5  },
      "claude-opus-4-5":   { input: 15,   output: 75,  cacheWrite: 18.75, cacheRead: 1.5  },
      "claude-sonnet-4-6": { input: 3,    output: 15,  cacheWrite: 3.75,  cacheRead: 0.3  },
      "claude-sonnet-4-5": { input: 3,    output: 15,  cacheWrite: 3.75,  cacheRead: 0.3  },
      "claude-haiku-4-5":  { input: 0.8,  output: 4,   cacheWrite: 1,     cacheRead: 0.08 },
    },
    defaultPricing: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
    contextLimits: {
      "claude-opus-4-7":   1_000_000,
      "claude-opus-4-6":   1_000_000,
      "claude-opus-4-5":   1_000_000,
      "claude-sonnet-4-6": 1_000_000,
      "claude-sonnet-4-5":   200_000,
      "claude-haiku-4-5":    200_000,
    },
    defaultContextLimit: 1_000_000,
    commands: { clear: "/clear", compact: "/compact" },
    hook: {
      supported: true,
      settingsPath: () => path.join(os.homedir(), ".claude", "settings.json"),
      hookDir: () => path.join(os.homedir(), ".claude", "hooks"),
      hookEvent: "PostToolUse",
      hookFileName: "token-meter-hook.mjs",
      stateFile: "token-meter-hook-state.json",
    },
    detect: () => {
      try { return fs.existsSync(path.join(os.homedir(), ".claude", "projects")); }
      catch { return false; }
    },
  },
};

// ── External provider pricing (cross-agent comparisons) ──────────────
const EXTERNAL_PROVIDERS = {
  "kimi-k2.5":        { input: 0.6,  output: 3.0,  cacheWrite: 0.6,  cacheRead: 0.15 },
  "kimi-k2-thinking": { input: 0.6,  output: 2.5,  cacheWrite: 0.6,  cacheRead: 0.15 },
};
const EXTERNAL_CONTEXT_LIMITS = {
  "kimi-k2.5":        262_144,
  "kimi-k2-thinking": 262_144,
};

// ── Constants ────────────────────────────────────────────────────────
const COMPACT_BUFFER = 33_000;
const HANDOFF_SIZE = 2_000;
const CLEAR_LOOKAHEAD = 20;
const OUTPUT_RATIO_WARN = 0.03;     // warn when output > 3% of total inputs (verbose agent)
const DEFAULT_COMPARE = ["claude-sonnet-4-6", "kimi-k2.5"];

// ── ANSI ──────────────────────────────────────────────────────────────
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";
const WHITE = "\x1b[37m";
const BG_RED = "\x1b[41m";
const DIM_CYAN = "\x1b[2;36m";
const BG_WHITE = "\x1b[47m";
// Render sequence for dashboard refresh. Uses the alt-screen buffer so
// repeated redraws don't accumulate in terminal scrollback (a default
// behavior of Windows Terminal that visually duplicated the header
// across scrollback frames in pre-1.2.1).
const ENTER_ALT = "\x1b[?1049h\x1b[?25l"; // enter alt screen + hide cursor
const LEAVE_ALT = "\x1b[?25h\x1b[?1049l"; // show cursor + leave alt screen
const CLR_SCR = "\x1b[H\x1b[2J";          // home cursor then clear (no scrollback push in alt screen)

// ── Workflow phases ───────────────────────────────────────────────────
const PHASES = [
  { maxPct: 10,  name: "EXPLORE",  color: GREEN,   advice: "Context is cheap. Explore, plan, read broadly." },
  { maxPct: 25,  name: "BUILD",    color: CYAN,    advice: "Productive zone. Context is earning its keep." },
  { maxPct: 45,  name: "HANDOFF",  color: YELLOW,  advice: "Write a plan file soon: \"save our plan to plan.md\"" },
  { maxPct: 100, name: "RESET",    color: RED,     advice: "Write handoff, then {{clear}}. Reload with the plan file." },
];

// ── Helpers ───────────────────────────────────────────────────────────
function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}

function fmtCost(n) {
  return n < 0.01 ? "$" + n.toFixed(4) : "$" + n.toFixed(2);
}

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m " + (s % 60) + "s";
  const h = Math.floor(m / 60);
  return h + "h " + (m % 60) + "m";
}

function bar(pct, width = 30) {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const color = pct > 80 ? RED : pct > 50 ? YELLOW : GREEN;
  return `${color}${"█".repeat(filled)}${DIM}${"░".repeat(empty)}${RESET}`;
}

// Claude Code encodes a working directory into its project subdirectory
// by replacing `/`, `\`, and `:` each with `-`. Verified against real
// dirs: B:\A5DS-HQ\agent-token-meter → B--A5DS-HQ-agent-token-meter.
function cwdToProjectName(cwd) {
  return cwd.replace(/[/\\:]/g, "-");
}

// ── Agent resolution ─────────────────────────────────────────────────
function resolveAgent(args) {
  // 1. Explicit --agent flag
  const agentIdx = args.indexOf("--agent");
  if (agentIdx >= 0 && agentIdx + 1 < args.length) {
    const id = args[agentIdx + 1];
    if (!AGENTS[id]) {
      console.error(`${RED}Unknown agent: ${id}${RESET}`);
      console.error(`${DIM}Supported: ${Object.keys(AGENTS).join(", ")}${RESET}`);
      process.exit(1);
    }
    return AGENTS[id];
  }

  // 2. Infer from positional file path
  const positional = args.filter(a => !a.startsWith("--"));
  if (positional.length > 0) {
    const fp = positional[0].toLowerCase();
    for (const profile of Object.values(AGENTS)) {
      if (fp.includes(`.${profile.id.split("-")[0]}`)) return profile;
    }
  }

  // 3. Auto-detect
  for (const profile of Object.values(AGENTS)) {
    if (profile.detect()) return profile;
  }

  // 4. No agent found
  console.error(`${RED}No supported agent detected.${RESET}`);
  console.error(`${DIM}Supported agents: ${Object.values(AGENTS).map(a => a.name).join(", ")}${RESET}`);
  console.error(`${DIM}Use --agent <id> to specify manually.${RESET}`);
  process.exit(1);
}

function renderAgents() {
  console.log(`\n${BOLD}Supported Agents${RESET}\n`);
  console.log(`  ${"Agent".padEnd(20)} ${"Status".padEnd(12)} Data Directory`);
  console.log(`  ${DIM}${"─".repeat(60)}${RESET}`);
  for (const p of Object.values(AGENTS)) {
    const detected = p.detect();
    const status = detected ? `${GREEN}detected${RESET}` : `${DIM}not found${RESET}`;
    console.log(`  ${p.name.padEnd(20)} ${status}${" ".repeat(Math.max(0, 12 - (detected ? 8 : 9)))} ${DIM}${p.sessionDir()}${RESET}`);
  }
  console.log();
}

// ── Config & provider resolution ─────────────────────────────────────
function loadConfig(profile) {
  try {
    const configPath = path.join(profile.configDir(), profile.configFile);
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

function resolveConfig(config, profile) {
  const allPricing = { ...profile.pricing, ...EXTERNAL_PROVIDERS };
  const allLimits = { ...profile.contextLimits, ...EXTERNAL_CONTEXT_LIMITS };
  if (config.providers) {
    for (const [k, v] of Object.entries(config.providers)) {
      if (v.input != null && v.output != null) allPricing[k] = v;
      if (v.context) allLimits[k] = v.context;
    }
  }
  return {
    allPricing,
    allLimits,
    defaultPricing: profile.defaultPricing,
    defaultContextLimit: profile.defaultContextLimit,
    compare: config.compare || DEFAULT_COMPARE,
    labels: Object.fromEntries(
      Object.entries(config.providers || {})
        .filter(([, v]) => v.label)
        .map(([k, v]) => [k, v.label])
    ),
  };
}

function findPricing(model, rc) {
  if (rc.allPricing[model]) return rc.allPricing[model];
  for (const key of Object.keys(rc.allPricing)) {
    if (model.startsWith(key)) return rc.allPricing[key];
  }
  return rc.defaultPricing;
}

function findContextLimit(model, rc) {
  if (rc.allLimits[model]) return rc.allLimits[model];
  for (const key of Object.keys(rc.allLimits)) {
    if (model.startsWith(key)) return rc.allLimits[key];
  }
  return rc.defaultContextLimit;
}

function providerLabel(key, labels) {
  if (labels && labels[key]) return labels[key];
  const m = key.match(/^claude-(\w+)-(\d+)-(\d+)/);
  if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1) + " " + m[2] + "." + m[3];
  return key.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// ── Session discovery ─────────────────────────────────────────────────
function findSessions(projectFilter, profile, opts = {}) {
  const projectsDir = profile.sessionDir();
  const results = [];

  if (!fs.existsSync(projectsDir)) return results;

  let projects;
  try {
    projects = fs.readdirSync(projectsDir);
  } catch {
    return results;
  }

  const matchFilter = opts.exact
    ? (proj) => proj === projectFilter
    : (proj) => proj.toLowerCase().includes(projectFilter.toLowerCase());

  for (const proj of projects) {
    if (projectFilter && !matchFilter(proj)) continue;
    const projPath = path.join(projectsDir, proj);
    let stat;
    try { stat = fs.statSync(projPath); } catch { continue; }
    if (!stat.isDirectory()) continue;

    let files;
    try { files = fs.readdirSync(projPath); } catch { continue; }

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const fullPath = path.join(projPath, file);
      try {
        const fstat = fs.statSync(fullPath);
        results.push({ path: fullPath, project: proj, mtime: fstat.mtimeMs, size: fstat.size });
      } catch { /* skip unreadable */ }
    }
  }

  return results.sort((a, b) => b.mtime - a.mtime);
}

// ── JSONL parser ──────────────────────────────────────────────────────
function parseSession(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    return { turns: [], userTurns: 0, compactions: [], model: "unknown", project: "", filePath };
  }

  const lines = content.split("\n");
  const apiCalls = [];
  const userTimestamps = [];
  let model = "unknown";
  let project = "";

  // Extract project name from path
  const sep = /[\\/]/;
  const parts = filePath.split(sep);
  const pidx = parts.indexOf("projects");
  if (pidx >= 0 && pidx + 1 < parts.length) project = parts[pidx + 1];

  for (const line of lines) {
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }

    // Track user messages for turn grouping
    if (obj.type === "user" && obj.message?.role === "user") {
      const isToolResult = Array.isArray(obj.message.content) &&
        obj.message.content.some(c => c.type === "tool_result");
      if (!isToolResult) {
        userTimestamps.push(obj.timestamp || "");
      }
    }

    // Track assistant API responses with usage
    if (obj.type === "assistant" && obj.message?.usage) {
      const u = obj.message.usage;
      const input = u.input_tokens || 0;
      const output = u.output_tokens || 0;
      const cacheCreate = u.cache_creation_input_tokens || 0;
      const cacheRead = u.cache_read_input_tokens || 0;
      const thinking = u.thinking_tokens || 0;
      if (input === 0 && output === 0 && cacheCreate === 0 && cacheRead === 0) continue;

      if (obj.message.model) model = obj.message.model;

      apiCalls.push({
        input, output, cacheCreate, cacheRead, thinking,
        contextSize: input + cacheCreate + cacheRead,
        model: obj.message.model || model,
        stopReason: obj.message.stop_reason || "?",
        timestamp: obj.timestamp || "",
      });
    }
  }

  // Detect compaction events: context drops > 20% between consecutive calls
  const compactions = [];
  for (let i = 1; i < apiCalls.length; i++) {
    const prev = apiCalls[i - 1].contextSize;
    const curr = apiCalls[i].contextSize;
    if (prev > 0 && curr < prev * 0.8 && (prev - curr) > 5000) {
      compactions.push({
        index: i,
        before: prev,
        after: curr,
        reduction: prev - curr,
        timestamp: apiCalls[i].timestamp,
      });
    }
  }

  return { turns: apiCalls, userTurns: userTimestamps.length, compactions, model, project, filePath };
}

// ── Metrics engine ────────────────────────────────────────────────────
function computeMetrics(session, rc) {
  const { turns, compactions, model } = session;
  if (turns.length === 0) return null;

  const contextLimit = findContextLimit(model, rc);
  const usableContext = contextLimit - COMPACT_BUFFER;
  const pricing = findPricing(model, rc);

  let totalInput = 0, totalOutput = 0, totalCacheCreate = 0, totalCacheRead = 0, totalCost = 0;
  const turnCosts = [];
  const contextSizes = [];

  for (const t of turns) {
    totalInput += t.input;
    totalOutput += t.output;
    totalCacheCreate += t.cacheCreate;
    totalCacheRead += t.cacheRead;

    const cost =
      (t.input / 1e6) * pricing.input +
      (t.output / 1e6) * pricing.output +
      (t.cacheCreate / 1e6) * pricing.cacheWrite +
      (t.cacheRead / 1e6) * pricing.cacheRead;

    totalCost += cost;
    turnCosts.push(cost);
    contextSizes.push(t.contextSize);
  }

  const currentContext = contextSizes[contextSizes.length - 1] || 0;
  const contextPct = (currentContext / usableContext) * 100;

  // ── Burn rate (last 10 API calls, after last compaction) ──
  const lastCompactIdx = compactions.length > 0 ? compactions[compactions.length - 1].index : 0;
  const postCompactSizes = contextSizes.slice(lastCompactIdx);
  const window = Math.min(10, postCompactSizes.length);
  let burnRate = 0;
  if (postCompactSizes.length >= 2) {
    const recent = postCompactSizes.slice(-window);
    burnRate = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
  }

  // ── Acceleration (burn rate change: last 5 vs previous 5) ──
  let acceleration = 0;
  if (postCompactSizes.length >= 10) {
    const older = postCompactSizes.slice(-10, -5);
    const newer = postCompactSizes.slice(-5);
    const olderRate = (older[older.length - 1] - older[0]) / (older.length - 1);
    const newerRate = (newer[newer.length - 1] - newer[0]) / (newer.length - 1);
    acceleration = newerRate - olderRate;
  }

  // ── Compaction ETA ──
  const remaining = usableContext - currentContext;
  const turnsToCompact = burnRate > 0
    ? Math.max(0, Math.floor(remaining / burnRate))
    : Infinity;
  const overContext = currentContext > usableContext;

  // ── Cost rate ──
  const recentCosts = turnCosts.slice(-10);
  const avgCostPerTurn = recentCosts.reduce((a, b) => a + b, 0) / recentCosts.length;

  // ── Cache efficiency ──
  const totalBilledInput = totalInput + totalCacheCreate + totalCacheRead;
  const cacheHitRate = totalBilledInput > 0 ? (totalCacheRead / totalBilledInput) * 100 : 0;

  // ── Session duration ──
  const firstTs = turns[0].timestamp;
  const lastTs = turns[turns.length - 1].timestamp;
  let durationMs = 0;
  if (firstTs && lastTs) {
    durationMs = new Date(lastTs).getTime() - new Date(firstTs).getTime();
  }

  // ── Workflow advisor ──
  const baseline = contextSizes.length > 0 ? contextSizes[0] : 16_000;
  const overhead = Math.max(0, currentContext - baseline);
  const overheadPct = (overhead / usableContext) * 100;
  const contextTaxPerCall = (overhead / 1e6) * pricing.cacheRead;
  const postClearContext = baseline + HANDOFF_SIZE;
  const savedPerCall = ((currentContext - postClearContext) / 1e6) * pricing.cacheRead;
  const savingsOverLookahead = savedPerCall * CLEAR_LOOKAHEAD;

  // ── Per-call cost multiplier (current call vs fresh-conversation call) ──
  // Cache-read dominates billing and scales linearly with context, so the
  // context-size ratio closely approximates the $/call ratio. Keep one
  // decimal so the user can distinguish ×1.2 (fresh) from ×1.8 (warming up).
  const multiplier = baseline > 0 ? Math.max(1, currentContext / baseline) : 1;
  const baselineCostPerCall = (baseline / 1e6) * pricing.cacheRead;

  // ── Reset-overdue duration (when context has already exceeded usable) ──
  let overdueMs = 0;
  if (overContext) {
    for (const t of turns) {
      if (t.contextSize > usableContext) {
        const ts = t.timestamp ? new Date(t.timestamp).getTime() : 0;
        if (ts > 0) overdueMs = Date.now() - ts;
        break;
      }
    }
  }

  let phase = PHASES[PHASES.length - 1];
  for (const p of PHASES) {
    if (overheadPct <= p.maxPct) { phase = p; break; }
  }

  // ── Cost per hour ──
  let costPerHour = 0;
  if (durationMs > 60_000 && turns.length >= 2) {
    costPerHour = (totalCost / durationMs) * 3_600_000;
  }

  // ── Session cost projection ──
  const projectedCostToCompact = burnRate > 0 && turnsToCompact !== Infinity
    ? totalCost + turnsToCompact * avgCostPerTurn
    : null;

  // ── Cache ROI ──
  const cacheWriteCost = (totalCacheCreate / 1e6) * pricing.cacheWrite;
  const cacheReadSavings = (totalCacheRead / 1e6) * (pricing.input - pricing.cacheRead);
  const cacheNetSavings = cacheReadSavings - cacheWriteCost;

  // ── Multi-provider comparison ──
  const comparisons = {};
  for (const name of rc.compare) {
    if (name === model) continue;
    const p = findPricing(name, rc);
    if (p === rc.defaultPricing && !rc.allPricing[name]) continue;
    comparisons[name] =
      (totalInput / 1e6) * p.input +
      (totalOutput / 1e6) * p.output +
      (totalCacheCreate / 1e6) * (p.cacheWrite || p.input) +
      (totalCacheRead / 1e6) * (p.cacheRead || p.input);
  }

  // ── Thinking tokens ──
  let totalThinking = 0;
  for (const t of turns) totalThinking += t.thinking;

  return {
    model, usableContext, contextLimit, pricing,
    turnCount: turns.length,
    userTurnCount: session.userTurns,
    totalInput, totalOutput, totalCacheCreate, totalCacheRead, totalBilledInput,
    totalCost, avgCostPerTurn, costPerHour,
    currentContext, contextPct,
    burnRate, acceleration, turnsToCompact,
    cacheHitRate,
    compactions,
    durationMs,
    lastTurn: turns[turns.length - 1],
    turnCosts, contextSizes,
    baseline, overhead, overheadPct,
    contextTaxPerCall, savedPerCall, savingsOverLookahead,
    multiplier, baselineCostPerCall,
    overContext, overdueMs,
    phase,
    projectedCostToCompact,
    cacheWriteCost, cacheReadSavings, cacheNetSavings,
    comparisons, totalThinking,
  };
}

// ── Renderers ─────────────────────────────────────────────────────────

// ── Multiplier styling ───────────────────────────────────────────────
// Color reflects how much more the current call costs vs. a fresh one.
function multColor(mult) {
  if (mult >= 4) return RED;
  if (mult >= 3) return YELLOW;
  return GREEN;
}

function sessionShortId(filePath) {
  if (!filePath) return "";
  const base = filePath.split(/[\\/]/).pop() || "";
  return base.replace(/\.jsonl$/, "").slice(0, 8);
}

// Reasoning-zone band derived from contextPct — independent of cost multiplier.
// Maps the U-shaped attention degradation curve (Liu et al. 2023; RULER; NoLiMa)
// to context fill percentage. Bands are coarse but defensible for any 1M-window
// model. For 200k-window models the same bands apply since contextPct is relative.
function reasoningZone(contextPct) {
  if (contextPct > 100) return { name: "OVER",       color: BG_RED + WHITE + BOLD, bar: BG_RED + WHITE };
  if (contextPct > 80)  return { name: "TOLERANCE",  color: RED + BOLD,            bar: RED };
  if (contextPct > 60)  return { name: "DRIFT",      color: YELLOW + BOLD,         bar: YELLOW };
  if (contextPct > 35)  return { name: "SOFTENING",  color: CYAN,                  bar: DIM_CYAN };
  return                        { name: "SHARP",     color: GREEN + BOLD,          bar: GREEN };
}

// Render a fixed-width context bar with zone-tinted fill.
// Width is 30 cells so the bar plus trailing percent+pages+tag stays under ~70 chars total.
function renderContextBar(pct, zone, width = 30) {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  const empty = width - filled;
  return zone.bar + "█".repeat(filled) + RESET + DIM + "░".repeat(empty) + RESET;
}

function buildPhaseBanner(m, cmds) {
  const clearCaps = cmds.clear.replace("/", "").toUpperCase();
  const fillPct = m.contextPct.toFixed(0);
  const overheadPct = m.overheadPct.toFixed(0);

  const resetFrag = m.overContext
    ? `${RED}${BOLD}reset overdue${m.overdueMs > 60_000 ? ` ${fmtDuration(m.overdueMs)}` : ""}${RESET}`
    : m.turnsToCompact === Infinity
      ? `${GREEN}no pressure${RESET}`
      : m.turnsToCompact < 10
        ? `${BG_RED}${WHITE}${BOLD} reset in ~${m.turnsToCompact} turns ${RESET}`
        : m.turnsToCompact < 50
          ? `${RED}reset in ~${m.turnsToCompact} turns${RESET}`
          : m.turnsToCompact < 200
            ? `${YELLOW}reset in ~${m.turnsToCompact} turns${RESET}`
            : `${DIM}reset in ~${m.turnsToCompact} turns${RESET}`;

  // Dual-signal fragment: shows both context fill (budget) and overhead (drift).
  const signalFrag = m.overContext
    ? `${RED}${BOLD}fill ${fillPct}% OVER${RESET} ${DIM}(overhead ${overheadPct}%)${RESET}`
    : `${DIM}fill ${fillPct}% (overhead ${overheadPct}%)${RESET}`;

  switch (m.phase.name) {
    case "EXPLORE":
      return `${GREEN}${BOLD}EXPLORE${RESET} ${DIM}—${RESET} context cheap, reasoning sharp · ${signalFrag} · ${resetFrag}`;
    case "BUILD":
      return `${CYAN}${BOLD}BUILD${RESET} ${DIM}—${RESET} productive zone, reasoning sharp · ${signalFrag} · ${resetFrag}`;
    case "HANDOFF":
      return `${YELLOW}${BOLD}HANDOFF${RESET} ${DIM}—${RESET} curate handoff now · ${signalFrag} · ${resetFrag}`;
    case "RESET":
    default: {
      const head = m.overContext
        ? `${RED}${BOLD}⚠ HANDOFF AND ${clearCaps}${RESET}`
        : `${RED}${BOLD}⚠ ${clearCaps}${RESET}`;
      return `${head} ${DIM}—${RESET} ${signalFrag} · ${resetFrag}`;
    }
  }
}

function renderDashboard(metrics, session, rc, profile, hud = {}) {
  if (!metrics) {
    process.stdout.write(CLR_SCR);
    process.stdout.write(`${DIM}Waiting for session data...${RESET}\n`);
    return;
  }
  const m = metrics;
  const cmds = profile.commands;

  // Acceleration arrow
  let accelArrow = "";
  if (m.acceleration > 100) accelArrow = `${RED}↑${RESET}`;
  else if (m.acceleration < -100) accelArrow = `${GREEN}↓${RESET}`;
  else if (m.turnCount >= 10) accelArrow = `${DIM}=${RESET}`;

  // Multiplier styling — color = cost-multiplier band, suffix [ZONE] tag = reasoning band
  const mc = multColor(m.multiplier);
  const multText = `×${m.multiplier.toFixed(1)}`;
  const multStyled = m.multiplier >= 5
    ? `${BG_RED}${WHITE}${BOLD} ${multText} ${RESET}`
    : `${mc}${BOLD}${multText}${RESET}`;

  const zone = reasoningZone(m.contextPct);
  const zoneTag = `${zone.color}[${zone.name}]${RESET}`;

  // Header — prefer the cwd's basename as a friendly project name; fall back to
  // Claude Code's encoded form (B:--path--like--this) only when watching a
  // session outside the current cwd (e.g. --all-projects mode).
  const shortId = sessionShortId(session?.filePath);
  const projRaw = session?.project || "";
  const cwdBase = path.basename(process.cwd() || "");
  const cwdEncoded = cwdBase.replace(/[/\\:]/g, "-");
  const proj = (cwdBase && projRaw.endsWith(cwdEncoded))
    ? cwdBase
    : (projRaw.length > 40 ? "…" + projRaw.slice(-39) : projRaw);
  const header = `${BOLD}${CYAN} Agent Token Meter ${RESET}${DIM}v${VERSION}${RESET} ${DIM}·${RESET} ${DIM}${profile.name}${RESET}`;
  const subHeader = (proj || shortId)
    ? ` ${DIM}${[proj, shortId].filter(Boolean).join(" · ")}${RESET}`
    : null;

  const noticeLine = hud.notice ? ` ${CYAN}${hud.notice}${RESET}` : null;

  const W = 60;
  const sepHeavy = `${DIM}${"═".repeat(W)}${RESET}`;
  const sepLight = `${DIM}${"─".repeat(W)}${RESET}`;

  // NOW section
  const compactionAnnotation = (m.compactions && m.compactions.length > 0)
    ? ` ${DIM}(post-compaction × ${m.compactions.length})${RESET}`
    : "";

  const contextBar = renderContextBar(m.contextPct, zone);
  const contextLine = ` ${DIM}context${RESET}  ${contextBar}  ${BOLD}${m.contextPct.toFixed(0)}%${RESET} ${zoneTag}`;
  const burnLine = ` ${DIM}burn${RESET}         ${MAGENTA}${m.burnRate >= 0 ? "+" : ""}${Math.round(m.burnRate)}${RESET} ${DIM}tok/call${RESET}${accelArrow ? ` ${accelArrow}` : ""}`;
  const lastTurnLine = ` ${DIM}last turn${RESET}    ${DIM}${fmtTokens(m.lastTurn.contextSize)} in · ${fmtTokens(m.lastTurn.output)} out · ${m.lastTurn.stopReason}${RESET}`;

  // IF YOU CLEAR section — triggers on cost savings OR reasoning-zone DRIFT/TOLERANCE/OVER
  const clearCaps = cmds.clear.replace("/", "").toUpperCase();
  const attentionTrigger = ["DRIFT", "TOLERANCE", "OVER"].includes(zone.name);
  const costTrigger = m.savedPerCall > 0.005;
  const showClearSection = costTrigger || attentionTrigger;

  let clearSection = null;
  if (showClearSection) {
    const lines = [
      sepLight,
      ` ${DIM}IF YOU ${clearCaps}${RESET}`,
    ];
    if (costTrigger) {
      lines.push(` ${DIM}per call${RESET}     ${GREEN}save ${fmtCost(m.savedPerCall)}${RESET}`);
    }
    if (attentionTrigger) {
      lines.push(` ${DIM}reasoning${RESET}    ${zone.color}${zone.name}${RESET} ${DIM}→${RESET} ${GREEN}${BOLD}SHARP${RESET}`);
    }
    if (costTrigger) {
      lines.push(` ${DIM}next ${CLEAR_LOOKAHEAD}${RESET}      ${GREEN}save ~${fmtCost(m.savingsOverLookahead)}${RESET}`);
    }
    lines.push(` ${DIM}steps${RESET}        ${DIM}curate handoff → ${cmds.clear} → reload (lands at position 0)${RESET}`);
    clearSection = lines;
  }

  // HANDOFF SECTIONS — surfaces the schema during HANDOFF/RESET phases as a
  // proper section (not a row), so it visually reads as a teaching aid, not
  // data. Full schema lives in AGENT-PROTOCOL.md.
  let handoffSection = null;
  if (m.phase.name === "HANDOFF" || m.phase.name === "RESET") {
    handoffSection = [
      sepLight,
      ` ${DIM}HANDOFF SECTIONS${RESET}`,
      ` ${DIM}mission · constraints · decisions · open · next · files · avoid${RESET}`,
    ];
  }

  // SESSION section
  const sessionParts = [`${BOLD}${GREEN}${fmtCost(m.totalCost)}${RESET}`, `${m.userTurnCount} turns`];
  if (m.durationMs > 0) sessionParts.push(fmtDuration(m.durationMs));
  if (m.costPerHour > 0) sessionParts.push(`${fmtCost(m.costPerHour)}/hr`);
  const spendLine = ` ${DIM}spend${RESET}        ${sessionParts.map((p, i) => i === 0 ? p : DIM + p + RESET).join(` ${DIM}·${RESET} `)}`;

  const cacheParts = [`${m.cacheHitRate.toFixed(0)}% hit`];
  if (m.cacheNetSavings > 0.01) cacheParts.push(`saved ${GREEN}${fmtCost(m.cacheNetSavings)}${RESET}`);
  cacheParts.push(`${fmtTokens(m.totalBilledInput)} in`);
  cacheParts.push(`${fmtTokens(m.totalOutput)} out`);
  const cacheLine = ` ${DIM}cache${RESET}        ${DIM}${cacheParts.join(" · ")}${RESET}`;

  // Output-ratio line — surfaces "output competes for budget" insight from Gary's article
  const outputRatio = m.totalBilledInput > 0 ? (m.totalOutput / m.totalBilledInput) : 0;
  const outputVerbose = outputRatio > OUTPUT_RATIO_WARN;
  const outputWarn = outputVerbose ? ` ${YELLOW}⚠ verbose${RESET}` : "";
  const outputLine = ` ${DIM}output${RESET}       ${DIM}${fmtTokens(m.totalOutput)} total · ${(outputRatio * 100).toFixed(1)}% of inputs${RESET}${outputWarn}`;

  const altLine = Object.keys(m.comparisons).length > 0
    ? ` ${DIM}alt models${RESET}   ${DIM}${Object.entries(m.comparisons).slice(0, 3).map(([k, v]) => `${providerLabel(k, rc.labels)} ${fmtCost(v)}`).join("   ")}${RESET}`
    : null;

  const lines = [
    "",
    header,
    subHeader,
    sepHeavy,
    // MULTIPLIER line: pure cost signal (×N + dollar deltas). The reasoning-zone
    // tag lives only on the context-bar line two rows below — one axis per line
    // keeps the scan clean.
    ` ${DIM}MULTIPLIER${RESET}   ${multStyled}${accelArrow ? " " + accelArrow : ""}   ${BOLD}${fmtCost(m.avgCostPerTurn)}${RESET} ${DIM}now${RESET}   ${DIM}${fmtCost(m.baselineCostPerCall)} fresh${RESET}`,
    ` ${buildPhaseBanner(m, cmds)}`,
    sepHeavy,
    ` ${DIM}NOW${RESET}${compactionAnnotation}`,
    contextLine,
    burnLine,
    lastTurnLine,
    ...(clearSection || []),
    ...(handoffSection || []),
    sepLight,
    ` ${DIM}SESSION${RESET}`,
    spendLine,
    cacheLine,
    outputLine,
    altLine,
    sepHeavy,
    ` ${DIM}Watching · Ctrl+C to exit${RESET}`,
    noticeLine,
  ].filter(Boolean);

  process.stdout.write(CLR_SCR);
  process.stdout.write(lines.join("\n") + "\n");
}

function renderAllSessions(projectFilter, limit, rc, profile, exact = false) {
  const sessions = findSessions(projectFilter, profile, { exact });
  if (sessions.length === 0) {
    console.log(`\n${DIM}No sessions found.${RESET}\n`);
    return;
  }

  console.log(`\n${BOLD}${profile.name} Sessions${RESET}${projectFilter ? ` ${DIM}(filter: "${projectFilter}")${RESET}` : ""}\n`);
  console.log(
    `  ${DIM}${"Date".padEnd(12)}${"Context".padStart(9)}${"Turns".padStart(7)}${"Cost".padStart(9)}  ` +
    `${"Cache%".padStart(7)}  Project${RESET}`
  );
  console.log(`  ${DIM}${"─".repeat(70)}${RESET}`);

  let totalCost = 0;
  let shown = 0;

  for (const s of sessions) {
    if (shown >= limit) break;
    const parsed = parseSession(s.path);
    const m = computeMetrics(parsed, rc);
    if (!m) continue;
    shown++;
    totalCost += m.totalCost;
    const date = new Date(s.mtime).toLocaleDateString();
    const compact = m.compactions.length > 0 ? ` ${DIM}(${m.compactions.length}x compacted)${RESET}` : "";
    console.log(
      `  ${DIM}${date.padEnd(12)}${RESET}` +
      `${fmtTokens(m.currentContext).padStart(9)}  ` +
      `${String(m.userTurnCount || m.turnCount).padStart(5)}  ` +
      `${fmtCost(m.totalCost).padStart(9)}  ` +
      `${m.cacheHitRate.toFixed(0).padStart(5)}%  ` +
      `${parsed.project}${compact}`
    );
  }

  console.log(`  ${DIM}${"─".repeat(70)}${RESET}`);
  console.log(`  ${BOLD}Total: ${fmtCost(totalCost)}${RESET} across ${shown} sessions\n`);
}

function renderHelp(profile) {
  const cmd = "npx agent-token-meter";
  const cmds = profile ? profile.commands : { clear: "/clear", compact: "/compact" };
  const configDir = profile ? profile.configDir() : "~/.claude";
  console.log(`
${BOLD}${CYAN}Agent Token Meter${RESET} v${VERSION}
Zero-dependency burn-rate monitor for AI coding agents.

${BOLD}Usage:${RESET}
  ${cmd}                    Auto-detect agent and watch active session
  ${cmd} --all              List all sessions with cost summary
  ${cmd} --project X        Filter sessions by project name
  ${cmd} <file>             Watch a specific .jsonl session file

${BOLD}Options:${RESET}
  --agent <id>         Select agent (default: auto-detect)
  --agents             List supported agents and detection status
  --all                Show all sessions summary
  --sessions           List sessions active in the last 10 min
  --session <id|path>  Watch a specific session (disables auto-follow)
  --no-follow          Pin to initial session; don't auto-switch
  --project <name>     Filter by project name (substring match)
  --all-projects       Watch any session machine-wide (default: cwd scope)
  --limit <n>          Max sessions to show in --all (default: 20)
  --install-hooks      Install threshold hooks (agent-specific)
  --uninstall-hooks    Remove threshold hooks
  --emit-agent-protocol      Print AGENT-PROTOCOL.md to stdout (for piping)
  --install-protocol [...]   Install AGENT-PROTOCOL.md in cwd + CLAUDE.md import
                             (use --no-claude-md to skip CLAUDE.md edit)
  --uninstall-protocol       Remove AGENT-PROTOCOL.md + CLAUDE.md section
  --help, -h           Show this help
  --version, -v        Show version

${BOLD}Multi-instance:${RESET}
  By default the meter scopes to the project matching your current
  working directory — so launching it in terminal A only ever watches
  sessions for that project, never a newer one from terminal B in a
  different repo. Auto-follow switches between sessions inside the
  same project after 30s of local idle. Escape hatches:
    --all-projects       watch any session machine-wide
    --no-follow          pin to the initial session
    --session <id>       lock to one specific session
  The meter self-exits if its launching shell dies, so orphaned
  processes don't accumulate if you close the terminal without Ctrl+C.

${BOLD}Hooks (threshold nudges):${RESET}
  Threshold hooks inject a one-line nudge into the agent's context
  when your session crosses a reasoning-degradation boundary:
    50% — curation still cheap, draft the handoff
    75% — drift zone, finish the handoff before /clear
    90% — attention degraded + cost biting, /clear from handoff
  Each fires once. Compaction re-arms them. Zero tokens wasted
  when below thresholds. Currently supported: Claude Code.

  For the full agent contract (handoff schema, exact request-to-clear
  phrasing, bootstrap protocol), install the bundled AGENT-PROTOCOL.md:
    npx agent-token-meter --install-protocol

  Install:    ${cmd} --install-hooks
  Uninstall:  ${cmd} --uninstall-hooks

${BOLD}What it shows:${RESET}
  Reasoning-zone band [SHARP / SOFTENING / DRIFT / TOLERANCE] alongside cost
  Context bar with zone-tinted fill + percent + page-equivalent
  Burn rate (tokens/call) with acceleration detection
  Compaction ETA, history, and post-compaction annotation
  Cost tracking with cache efficiency breakdown
  Output-vs-input ratio with verbose-agent warning
  Multi-provider comparison (same workload on Sonnet, Kimi, etc.)
  Cost per hour and session cost projection
  Cache ROI (net savings from prompt caching)
  Workflow advisor: phase, context tax, ${cmds.clear} savings projection
  WHAT TO HANDOFF widget during HANDOFF / RESET phases

${BOLD}Config:${RESET}
  Optional: ${configDir}/token-meter.json
  Add custom providers or change the comparison list:
  { "compare": ["claude-sonnet-4-6", "kimi-k2.5"],
    "providers": { "my-llm": { "input": 1, "output": 5 } } }

${BOLD}Setup:${RESET}
  Run in a split terminal pane alongside your coding agent.
  It reads session JSONL logs (read-only).
`);
}

// ── Hook installer ───────────────────────────────────────────────────

// Write settings atomically via tmp-file + rename. Claude Code may be
// writing to settings.json concurrently; a naive read→mutate→write
// clobbers unrelated hook entries on race. Same-directory rename replaces
// in one step on POSIX and NTFS. The tmp name carries the pid so two
// concurrent writers don't collide on it; on rename failure (e.g. the
// target is briefly open on Windows) we clean up the tmp file rather than
// leave it stranded in ~/.claude/.
function writeSettingsAtomic(settingsPath, settings) {
  const tmp = `${settingsPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
  try {
    fs.renameSync(tmp, settingsPath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

// Identify our hook entries by the hook filename we installed, not by
// a "token-meter" substring — the substring match could silently
// delete an unrelated user hook whose command happens to contain that
// string. `hookFileName` is specific enough that only our entries hit.
function isTokenMeterHook(entry, hookFileName) {
  return Array.isArray(entry?.hooks) && entry.hooks.some(h =>
    h?.type === "command" &&
    typeof h?.command === "string" &&
    h.command.includes(hookFileName)
  );
}

function installHooks(profile) {
  if (!profile.hook?.supported) {
    console.error(`\n${RED}Hooks are not supported for ${profile.name}.${RESET}`);
    console.error(`${DIM}Currently only Claude Code supports threshold hooks.${RESET}\n`);
    process.exit(1);
  }

  const hk = profile.hook;
  const hooksDir = hk.hookDir();
  const hookDest = path.join(hooksDir, hk.hookFileName);
  const hookSrc = path.join(__dirname, "hook.mjs");
  const settingsPath = hk.settingsPath();

  if (!fs.existsSync(hookSrc)) {
    console.error(`${RED}hook.mjs not found at ${hookSrc}${RESET}`);
    console.error(`${DIM}Try reinstalling: npm install -g agent-token-meter${RESET}`);
    process.exit(1);
  }

  // 1. Copy hook script to stable location
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.copyFileSync(hookSrc, hookDest);

  // 2. Merge into settings
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch {}

  if (!settings.hooks) settings.hooks = {};

  // v1.4: register for multiple events so we can act on SessionStart and PostCompact
  // explicitly, not just PostToolUse heuristics.
  const eventsToRegister = ["PostToolUse", "SessionStart", "PostCompact"];
  const hookCmd = `node "${hookDest.replace(/\\/g, "/")}"`;

  for (const event of eventsToRegister) {
    if (!settings.hooks[event]) settings.hooks[event] = [];
    settings.hooks[event] = settings.hooks[event].filter(
      h => !isTokenMeterHook(h, hk.hookFileName)
    );
    settings.hooks[event].push({
      matcher: "",
      hooks: [{ type: "command", command: hookCmd }],
    });
  }

  writeSettingsAtomic(settingsPath, settings);

  console.log(`\n${GREEN}✓${RESET} Token Meter hooks installed for ${BOLD}${profile.name}${RESET}\n`);
  console.log(`  ${DIM}Hook:${RESET}     ${hookDest}`);
  console.log(`  ${DIM}Config:${RESET}   ${settingsPath}`);
  console.log(`\n  ${profile.name} receives a one-line nudge when context crosses:`);
  console.log(`    ${YELLOW}50%${RESET}  — reasoning still sharp, draft the handoff`);
  console.log(`    ${YELLOW}75%${RESET}  — drift zone, finish the handoff before ${profile.commands.clear}`);
  console.log(`    ${RED}90%${RESET}  — attention degraded + cost biting, ${profile.commands.clear} from handoff`);
  console.log(`\n  Each fires ${BOLD}once${RESET} per session. Compaction re-arms them.`);
  console.log(`  To remove: ${CYAN}npx agent-token-meter --uninstall-hooks${RESET}\n`);
}

function uninstallHooks(profile) {
  if (!profile.hook?.supported) {
    console.error(`\n${RED}Hooks are not supported for ${profile.name}.${RESET}\n`);
    process.exit(1);
  }

  const hk = profile.hook;
  const hookDest = path.join(hk.hookDir(), hk.hookFileName);
  const statePath = path.join(profile.configDir(), hk.stateFile);
  const settingsPath = hk.settingsPath();

  // Remove hook file and state
  try { fs.unlinkSync(hookDest); } catch {}
  try { fs.unlinkSync(statePath); } catch {}

  // Remove from settings
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    if (settings.hooks) {
      // v1.4: remove our entries from every event we may have registered for
      for (const event of Object.keys(settings.hooks)) {
        if (!Array.isArray(settings.hooks[event])) continue;
        settings.hooks[event] = settings.hooks[event].filter(
          h => !isTokenMeterHook(h, hk.hookFileName)
        );
        if (settings.hooks[event].length === 0) delete settings.hooks[event];
      }
      if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
      writeSettingsAtomic(settingsPath, settings);
    }
  } catch {}

  console.log(`\n${GREEN}✓${RESET} Token Meter hooks uninstalled\n`);
}

// ── CLI ───────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    // Help can run without a detected agent
    const profile = Object.values(AGENTS).find(a => a.detect()) || Object.values(AGENTS)[0];
    renderHelp(profile);
    return;
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
    return;
  }

  if (args.includes("--agents")) {
    renderAgents();
    return;
  }

  // Resolve which agent we're monitoring
  const profile = resolveAgent(args);

  if (args.includes("--install-hooks")) {
    installHooks(profile);
    return;
  }

  if (args.includes("--uninstall-hooks")) {
    uninstallHooks(profile);
    return;
  }

  // ── Agent protocol management (v1.4) ──
  if (args.includes("--emit-agent-protocol")) {
    protocol.emitProtocol();
    process.exit(0);
  }

  if (args.includes("--install-protocol")) {
    const skipClaudeMd = args.includes("--no-claude-md");
    try {
      const result = protocol.installProtocol({ skipClaudeMd });
      console.log(`\n${GREEN}✓${RESET} Wrote ${BOLD}AGENT-PROTOCOL.md${RESET} to ${result.protocolPath}`);
      if (result.claudeMdUpdated) {
        console.log(`${GREEN}✓${RESET} ${result.claudeMdCreated ? "Created" : "Updated"} CLAUDE.md with protocol import`);
      } else if (result.claudeMdReason) {
        console.log(`${DIM}·${RESET} CLAUDE.md unchanged: ${result.claudeMdReason}`);
      }
      console.log("");
    } catch (e) {
      console.error(`${RED}Install failed:${RESET} ${e.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (args.includes("--uninstall-protocol")) {
    try {
      const result = protocol.uninstallProtocol();
      if (result.protocolRemoved) console.log(`${GREEN}✓${RESET} Removed AGENT-PROTOCOL.md`);
      else console.log(`${DIM}·${RESET} AGENT-PROTOCOL.md not present`);
      if (result.claudeMdRemoved) console.log(`${GREEN}✓${RESET} Removed CLAUDE.md (empty after section removal)`);
      else if (result.claudeMdUpdated) console.log(`${GREEN}✓${RESET} Removed protocol section from CLAUDE.md`);
      else console.log(`${DIM}·${RESET} CLAUDE.md unchanged`);
      console.log("");
    } catch (e) {
      console.error(`${RED}Uninstall failed:${RESET} ${e.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // Parse --project filter
  let projectFilter = null;
  const projIdx = args.indexOf("--project");
  if (projIdx >= 0 && projIdx + 1 < args.length) {
    projectFilter = args[projIdx + 1];
  }

  // Parse --limit
  let limit = 20;
  const limIdx = args.indexOf("--limit");
  if (limIdx >= 0 && limIdx + 1 < args.length) {
    limit = parseInt(args[limIdx + 1], 10) || 20;
  }

  // Parse --session (explicit id or path; disables auto-follow)
  let sessionArg = null;
  const sessIdx = args.indexOf("--session");
  if (sessIdx >= 0 && sessIdx + 1 < args.length) {
    sessionArg = args[sessIdx + 1];
  }

  // Load config and resolve providers
  const rc = resolveConfig(loadConfig(profile), profile);

  // Determine target file and whether to auto-follow
  let targetFile;
  let followMode = !args.includes("--no-follow");
  const skipArgs = ["--agent", "--project", "--limit", "--session"];
  const positional = args.filter((a, i) => !a.startsWith("--") && !skipArgs.includes(args[i - 1]));

  // ── cwd-scoping ──
  // Default: only watch sessions whose project dir matches the current
  // working directory. Prevents accidentally metering an unrelated
  // Claude Code session from another terminal.
  //   opt-out:      --all-projects
  //   overridden:   --project, --session, positional file arg
  const allProjectsFlag = args.includes("--all-projects");
  const explicitScope = allProjectsFlag || !!projectFilter || !!sessionArg || positional.length > 0;
  const cwdProject = !explicitScope ? cwdToProjectName(process.cwd()) : null;
  const cwdProjectExists = !!cwdProject
    && fs.existsSync(path.join(profile.sessionDir(), cwdProject));
  const effectiveFilter = cwdProjectExists ? cwdProject : projectFilter;
  const effectiveExact = !!cwdProjectExists;

  if (args.includes("--all")) {
    renderAllSessions(effectiveFilter, limit, rc, profile, effectiveExact);
    return;
  }

  if (args.includes("--sessions")) {
    renderActiveSessions(profile, rc, effectiveFilter, effectiveExact);
    return;
  }

  if (sessionArg) {
    // Explicit --session disables auto-follow
    followMode = false;
    targetFile = resolveSessionArg(sessionArg, profile);
  } else if (positional.length > 0) {
    followMode = false;
    targetFile = path.resolve(positional[0]);
  } else {
    const sessions = findSessions(effectiveFilter, profile, { exact: effectiveExact });
    if (sessions.length === 0) {
      console.error(`${RED}No ${profile.name} session files found.${RESET}`);
      console.error(`${DIM}Expected logs in: ${profile.sessionDir()}${RESET}`);
      if (cwdProject && !cwdProjectExists) {
        console.error(`${DIM}(cwd scope: ${cwdProject} — not found; pass --all-projects to watch any session)${RESET}`);
      }
      process.exit(1);
    }
    targetFile = sessions[0].path;
  }

  if (!fs.existsSync(targetFile)) {
    console.error(`${RED}File not found:${RESET} ${targetFile}`);
    process.exit(1);
  }

  // Enter alt-screen buffer so the dashboard redraws in a private
  // screen that doesn't push frames into terminal scrollback. Restored
  // on any exit path via process.on("exit"), below.
  process.stdout.write(ENTER_ALT);

  // Initial render
  let currentFile = targetFile;
  let session = parseSession(currentFile);
  let metrics = computeMetrics(session, rc);
  let lastLocalChange = Date.now();
  let hud = {};
  let noticeQueue = [];
  let noticeTimer = null;

  const rerender = () => {
    try {
      session = parseSession(currentFile);
      metrics = computeMetrics(session, rc);
      renderDashboard(metrics, session, rc, profile, hud);
    } catch { /* mid-write, skip */ }
  };

  // Slide-queue notices — fade and advance on a timer. Each slide gets
  // a full bottom line so messages don't have to be crammed together.
  const playNotices = () => {
    if (noticeTimer) { clearTimeout(noticeTimer); noticeTimer = null; }
    if (noticeQueue.length === 0) { hud = {}; rerender(); return; }
    const next = noticeQueue.shift();
    hud = { notice: next.text };
    rerender();
    noticeTimer = setTimeout(playNotices, next.ms);
  };
  const queueNotices = (slides) => { noticeQueue = slides.slice(); playNotices(); };
  const showNotice = (text, ms = 6000) => queueNotices([{ text, ms }]);

  // Startup slides — explain scope, follow mode, and escape hatches.
  const ACTIVE_WINDOW_MS = 10 * 60 * 1000;
  const startupShortId = sessionShortId(currentFile);
  const scopeActive = cwdProjectExists;
  const scopeWord = scopeActive ? "in this project" : "across all projects";
  const startupSlides = [];
  if (cwdProject && !cwdProjectExists) {
    startupSlides.push({
      text: `no sessions in cwd (${cwdProject}) · watching newest globally · --all-projects to keep this mode`,
      ms: 5000,
    });
  }
  // The "watching:" slide used to appear here. Removed in v1.4 — the header
  // line 2 now shows the friendly project basename + short session id, which
  // is the same info less verbosely. Keep the other slides (follow mode,
  // rollover hints, multi-session indicators) — they carry information the
  // header doesn't.
  if (followMode) {
    startupSlides.push({
      text: `follow mode on · switches to newest ${scopeWord} after 30s idle`,
      ms: 4000,
    });
    const activeCount = findSessions(effectiveFilter, profile, { exact: effectiveExact })
      .filter(s => Date.now() - s.mtime < ACTIVE_WINDOW_MS).length;
    if (activeCount > 1) {
      startupSlides.push({
        text: `+${activeCount - 1} other active ${scopeWord} · --sessions to list · --session <id> to pin`,
        ms: 5000,
      });
    }
  } else {
    startupSlides.push({ text: `pinned to ${startupShortId} · auto-follow off`, ms: 4000 });
  }

  // Session-rollover hint — Claude Code opens a new .jsonl on /resume
  // or a fresh `claude` in the same cwd, so a long conversation can
  // read as a short one. When the current file has just a handful of
  // user turns and a substantial prior .jsonl exists in the same
  // project dir, flag it so the numbers aren't mistaken for the whole
  // conversation. We don't aggregate — just make the scope explicit.
  if (scopeActive) {
    const ROLLOVER_TURN_CAP = 5;
    const PRIOR_MIN_BYTES = 100 * 1024;
    if ((session.userTurns || 0) <= ROLLOVER_TURN_CAP) {
      const siblings = findSessions(effectiveFilter, profile, { exact: effectiveExact })
        .filter(s => s.path !== currentFile && s.size >= PRIOR_MIN_BYTES)
        .sort((a, b) => b.mtime - a.mtime);
      const prior = siblings[0];
      if (prior) {
        const priorMB = (prior.size / 1e6).toFixed(1);
        const priorAge = fmtDuration(Date.now() - prior.mtime);
        startupSlides.push({
          text: `new session segment · prior ${sessionShortId(prior.path)} (${priorMB}MB, ${priorAge} ago) · metrics cover this segment only`,
          ms: 6000,
        });
      }
    }
  }

  queueNotices(startupSlides);

  // Watch current file
  let watcher = null;
  let pollTimer = null;
  const attachWatcher = () => {
    if (watcher) { try { watcher.close(); } catch {} watcher = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    let debounce = null;
    try {
      watcher = fs.watch(currentFile, () => {
        lastLocalChange = Date.now();
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(rerender, 250);
      });
    } catch {
      // fs.watch unavailable — poll
      let lastCount = session.turns.length;
      pollTimer = setInterval(() => {
        try {
          const ns = parseSession(currentFile);
          if (ns.turns.length !== lastCount) {
            lastCount = ns.turns.length;
            lastLocalChange = Date.now();
            rerender();
          }
        } catch { /* skip */ }
      }, 2000);
    }
  };
  attachWatcher();

  // Auto-follow: periodic rescan for a newer session
  let followTimer = null;
  if (followMode) {
    followTimer = setInterval(() => {
      try {
        const sessions = findSessions(effectiveFilter, profile, { exact: effectiveExact });
        if (sessions.length === 0) return;
        const newest = sessions[0];
        if (newest.path === currentFile) return;
        // Only switch if current file has been idle for 30s+ AND newest is actually newer
        const currentMtime = fs.statSync(currentFile).mtimeMs;
        if (newest.mtime <= currentMtime) return;
        if (Date.now() - lastLocalChange < 30_000) return;
        // Switch
        currentFile = newest.path;
        lastLocalChange = Date.now();
        attachWatcher();
        session = parseSession(currentFile);
        metrics = computeMetrics(session, rc);
        showNotice(`→ switched to ${newest.project} · ${sessionShortId(currentFile)}`);
        renderDashboard(metrics, session, rc, profile, hud);
      } catch { /* skip */ }
    }, 3000);
  }

  // Parent-watchdog — self-exit if the launching shell dies. On Windows
  // killing an `npx` wrapper doesn't propagate to the grandchild node
  // process, so without this the meter would leak as an orphan after
  // the terminal closes. process.kill(pid, 0) throws if pid is gone.
  const ppidWatchdog = setInterval(() => {
    const ppid = process.ppid;
    if (!ppid || ppid === 1) return; // reparented to init — leave running
    try { process.kill(ppid, 0); }
    catch { process.exit(0); }
  }, 5000);

  // Secondary lifecycle signal — TTY stdin closing means the controlling
  // terminal is gone. Normal TTY stdin never emits end/close otherwise.
  if (process.stdin.isTTY) {
    process.stdin.on("end", () => process.exit(0));
    process.stdin.on("close", () => process.exit(0));
  }

  // Universal cleanup — runs on any process.exit() including SIGINT,
  // ppid watchdog, and stdin close. Restores the user's original
  // terminal screen (leaves alt-screen buffer).
  process.on("exit", () => {
    try { process.stdout.write(LEAVE_ALT); } catch {}
  });

  // Graceful Ctrl+C
  process.on("SIGINT", () => {
    if (followTimer) clearInterval(followTimer);
    if (ppidWatchdog) clearInterval(ppidWatchdog);
    if (noticeTimer) clearTimeout(noticeTimer);
    if (watcher) { try { watcher.close(); } catch {} }
    if (pollTimer) clearInterval(pollTimer);
    process.exit(0); // triggers the "exit" handler above → LEAVE_ALT
  });
}

// ── --sessions renderer ──────────────────────────────────────────────
function renderActiveSessions(profile, rc, projectFilter = null, exact = false) {
  const sessions = findSessions(projectFilter, profile, { exact });
  const now = Date.now();
  const ACTIVE_WINDOW_MS = 10 * 60 * 1000;
  const active = sessions.filter(s => now - s.mtime < ACTIVE_WINDOW_MS);

  if (active.length === 0) {
    console.log(`\n${DIM}No ${profile.name} sessions active in the last 10 minutes.${RESET}\n`);
    return;
  }

  console.log(`\n${BOLD}Active ${profile.name} sessions${RESET} ${DIM}(mtime within 10 min)${RESET}\n`);
  console.log(`  ${DIM}${"Age".padEnd(8)}${"Turns".padStart(6)}${"Cost".padStart(9)}  ${"×N".padEnd(5)} ${"Project".padEnd(30)} Session${RESET}`);
  console.log(`  ${DIM}${"─".repeat(78)}${RESET}`);

  for (const s of active) {
    const parsed = parseSession(s.path);
    const m = computeMetrics(parsed, rc);
    if (!m) continue;
    const age = fmtDuration(now - s.mtime) + " ago";
    const mc = multColor(m.multiplier);
    console.log(
      `  ${DIM}${age.padEnd(8)}${RESET}` +
      `${String(m.userTurnCount || m.turnCount).padStart(5)}  ` +
      `${fmtCost(m.totalCost).padStart(9)}  ` +
      `${mc}×${m.multiplier.toFixed(1).padEnd(4)}${RESET} ` +
      `${(parsed.project || "").slice(0, 30).padEnd(30)} ${DIM}${sessionShortId(s.path)}${RESET}`
    );
  }
  console.log();
  console.log(`  ${DIM}Pick one: npx agent-token-meter --session <id>${RESET}\n`);
}

// ── --session arg resolver ──────────────────────────────────────────
function resolveSessionArg(arg, profile) {
  // If it looks like a path and exists, use it directly
  if (arg.includes("/") || arg.includes("\\") || arg.endsWith(".jsonl")) {
    return path.resolve(arg);
  }
  // Otherwise treat as session id prefix, search in projects dir
  const sessions = findSessions(null, profile);
  const match = sessions.find(s => sessionShortId(s.path).startsWith(arg));
  if (!match) {
    console.error(`${RED}No session matching "${arg}" found.${RESET}`);
    console.error(`${DIM}Run --sessions to list active sessions.${RESET}`);
    process.exit(1);
  }
  return match.path;
}

main();
