# Agent Token Meter

[![npm version](https://img.shields.io/npm/v/agent-token-meter)](https://www.npmjs.com/package/agent-token-meter) [![npm downloads](https://img.shields.io/npm/dm/agent-token-meter)](https://www.npmjs.com/package/agent-token-meter) [![CI](https://github.com/albertdobmeyer/agent-token-meter/actions/workflows/ci.yml/badge.svg)](https://github.com/albertdobmeyer/agent-token-meter/actions/workflows/ci.yml) [![signed with provenance](https://img.shields.io/badge/signed-provenance-brightgreen)](https://github.com/albertdobmeyer/agent-token-meter/blob/main/SECURITY.md#verifying-a-release) [![zero deps](https://img.shields.io/badge/deps-0-brightgreen)](https://github.com/albertdobmeyer/agent-token-meter/blob/main/package.json) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**A speedometer for your context window.** Zero dependencies. Single file. Answers one question: *should I reset my context right now?*

AI coding agents bill by tokens, and conversations accumulate cost **quadratically** — each message resends the entire history. A 100-turn conversation doesn't cost 10x more than a 10-turn conversation. It costs **50x** more. Most developers have no real-time visibility into this.

Agent Token Meter watches your coding agent's session and shows you the burn rate, acceleration, and estimated calls until auto-compaction — so you know *when* to act, not just how much you've spent after the fact.

![Agent Token Meter dashboard](https://raw.githubusercontent.com/albertdobmeyer/agent-token-meter/main/agent-token-meter-terminal-screenshot.png)

```
 Agent Token Meter v1.2.0 · Claude Code · B--A5DS-HQ-agent-token-meter · 32891718
════════════════════════════════════════════════════════════
 MULTIPLIER   ×7.6 ↑        $0.52 now   $0.04 fresh
 BUILD — productive zone · context 22% · reset in ~442
════════════════════════════════════════════════════════════
 NOW
 context      212.5k / 967.0k         22%
 burn         +1706 tok/call ↑
 last turn    212.5k in · 231 out · tool_use
────────────────────────────────────────────────────────────
 IF YOU CLEAR
 per call     save $0.27
 next 20      save ~$5.48
 steps        write handoff → /clear → reload with plan
────────────────────────────────────────────────────────────
 SESSION
 spend        $75.93 · 16 turns · 11h 55m · $6.36/hr
 cache        97% hit · saved $350.12 · 27.7M in · 286.2k out
 alt models   Sonnet 4.6 $15.19   Kimi K2.5 $5.35
════════════════════════════════════════════════════════════
 Watching · Ctrl+C to exit
```

The headline is the **×N.N multiplier** — how much each call costs vs. a fresh-conversation call. ×1–×2 green, ×3 yellow, ×4+ red, ×5+ red background. The second line is a phase banner that fuses status (BUILD/HANDOFF/CLEAR), context fill, and reset ETA into one scannable sentence. When context exceeds the usable limit you see `⚠ HANDOFF AND CLEAR — context N% OVER · reset overdue Nm` instead.

## Supported agents

| Agent | Status | Session logs |
|---|---|---|
| **Claude Code** | Supported | `~/.claude/projects/{project}/{session}.jsonl` |
| **Cursor** | Planned | — |
| **Windsurf** | Planned | — |

Adding a new agent requires only a profile object and a parser function. See the `AGENTS` object in `token-meter.mjs`.

## Install

```bash
npx agent-token-meter
```

Or clone and run directly:

```bash
git clone https://github.com/albertdobmeyer/agent-token-meter
cd agent-token-meter
node token-meter.mjs
```

**Requirements:** Node.js 18+ (no other dependencies).

## Threshold hooks (agent integration)

The token meter can nudge your AI agent directly inside the conversation. Instead of polling or injecting on every turn, it uses **threshold triggers** — the agent gets a one-line system reminder only when context crosses a critical boundary. Zero tokens wasted otherwise.

### Install hooks

```bash
npx agent-token-meter --install-hooks
```

This copies a lightweight hook script to `~/.claude/hooks/` and registers it as a `PostToolUse` hook in `~/.claude/settings.json`. The hook fires after every tool call but **stays silent unless a threshold is crossed**.

Currently supported for: **Claude Code**.

### What the agent sees

| Threshold | Nudge |
|---|---|
| **50%** | `[Token Meter] Context 50%. Plan a handoff point — write key decisions to a file.` |
| **75%** | `[Token Meter] Context 75%. Write your plan/findings to a file now. Prepare to /clear.` |
| **90%** | `[Token Meter] Context 90%. ~$X.XX/call context tax. /clear now to avoid quadrupled costs.` |
| **Compaction** | `[Token Meter] Compaction detected (Nx). Context reset to X%. Thresholds re-armed.` |

Each threshold fires **once per session**. When auto-compaction happens, thresholds above the new fill level are re-armed.

### How it works

The hook script (`~/.claude/hooks/token-meter-hook.mjs`) runs in ~20ms:

1. Finds the active session JSONL file
2. Parses it for current context size and model
3. Computes fill % against the model's context limit
4. Checks against thresholds stored in a tiny state file
5. If no threshold crossed — exits silently (no output, zero tokens injected)
6. If a threshold is crossed — emits one line via `additionalContext`

State is tracked in `~/.claude/token-meter-hook-state.json` to prevent re-firing.

### Uninstall hooks

```bash
npx agent-token-meter --uninstall-hooks
```

Removes the hook script, state file, and settings entry. Your existing hooks are preserved.

### Two tools, two purposes

| | Dashboard (`npx agent-token-meter`) | Hooks (`--install-hooks`) |
|---|---|---|
| **Audience** | You (the developer) | The AI agent |
| **Display** | Full real-time dashboard in split terminal | One-line system reminder |
| **Frequency** | Continuous live updates | Only at 50/75/90% thresholds |
| **Token cost** | Zero (separate process) | ~4 lines total across entire session |
| **Purpose** | Monitor burn rate, plan workflow | Nudge the agent to be token-frugal |

Use both together: the dashboard for your situational awareness, the hooks for the agent's.

## Usage

Run in a **split terminal pane** alongside your coding agent:

```bash
# Scoped to current project by default — watches sessions in this cwd only
npx agent-token-meter

# Watch any session machine-wide (pre-1.2 behavior)
npx agent-token-meter --all-projects

# List sessions active in the last 10 min (scoped to cwd unless --all-projects)
npx agent-token-meter --sessions

# Lock to a specific session by short id or path (disables auto-follow)
npx agent-token-meter --session 32891718

# Pin to the initial session without auto-follow
npx agent-token-meter --no-follow

# Specify agent explicitly
npx agent-token-meter --agent claude-code

# List supported agents and detection status
npx agent-token-meter --agents

# List all sessions ever (cost summary)
npx agent-token-meter --all

# Filter by project name substring
npx agent-token-meter --project augustus-trading
```

### Which session is being watched?

The meter watches **one session at a time, scoped to your current working directory by default.** Launch it from `B:\A5DS-HQ\agent-token-meter` and it only considers sessions in that project — never a newer one from an unrelated repo. It derives the project directory from `cwd` using Claude Code's own naming scheme (replace `/`, `\`, `:` each with `-`: `B:\A5DS-HQ\agent-token-meter` → `B--A5DS-HQ-agent-token-meter`).

The dashboard header shows both the project directory name and the short session id:

```
Agent Token Meter v1.2.0 · Claude Code · B--A5DS-HQ-agent-token-meter · 6cfb4866
```

This is the primary disambiguation signal — you match the project string (with the drive letter and path segments) against your terminal's `cwd` to confirm the numbers belong to the conversation you're thinking about. The short session id is the tiebreaker if multiple terminals are open in the same project; Claude Code's `/status` command shows the same id.

A transient cyan line at the **bottom** of the dashboard cycles through 2–4 startup slides (each ~4–5s, then the line goes quiet) so the numbers above never shift:

| Slide | When it shows |
|---|---|
| `no sessions in cwd (<project>) · watching newest globally · --all-projects to keep this mode` | You launched from a directory with no Claude Code sessions — fell back to global scan |
| `watching: <cwd or project> · <short id>` | Always |
| `follow mode on · switches to newest in this project after 30s idle` | Default mode |
| `+N other active in this project · --sessions to list · --session <id> to pin` | Multiple sessions open in the same project |
| `new session segment · prior <id> (2.8MB, 26m ago) · metrics cover this segment only` | Claude Code just rolled over to a fresh `.jsonl` — a long conversation now lives across two files |
| `pinned to <id> · auto-follow off` | `--no-follow` or `--session` is active |
| `→ switched to <project> · <id>` | Auto-follow just jumped (one-shot notice) |

Escape hatches:

```bash
npx agent-token-meter --all-projects        # watch any session machine-wide
npx agent-token-meter --sessions            # list sessions active in last 10 min
npx agent-token-meter --session 6cfb4866    # lock to one by short id
npx agent-token-meter --no-follow           # pin to initial pick, never switch
```

### Multiple Claude Code terminals

With cwd-scoping, you can safely run one meter per project in separate terminal panes — they won't stomp on each other. Inside a single project, if you have two Claude Code instances running (e.g. a main chat and a sub-agent), auto-follow switches between them after 30 seconds of local idle on the current one. Cross-project switching only happens if you pass `--all-projects`.

**Orphan protection:** the meter polls `process.ppid` every 5 seconds and exits if the launching shell is gone. It also exits on stdin end/close. On Windows this fixes the long-standing problem where killing the `npx` wrapper leaves the grandchild `node.exe` running forever — closing your terminal now cleanly takes the meter down with it.

**For agents:** if your agent reads the meter output (e.g. via `tee` to a log file), it can compare the short session id in the header against its own session file to confirm the numbers belong to *its* conversation. A mismatch means the meter is watching a sibling session.

### Session rollovers

Claude Code doesn't always append a conversation to the same `.jsonl`. Starting a new session in the same `cwd` — via `/resume`, `claude --continue`, a fresh `claude` invocation, or recovery after a crash — opens a **new** session file that picks up from a handoff while the prior file sits stale on disk. The meter always watches one file at a time, so after a rollover it reports on the *new* segment only. A multi-hour conversation can briefly look like a short one until the new file grows.

The meter detects this pattern at startup and queues a slide so the scope isn't ambiguous:

```
new session segment · prior fa7a76de (2.8MB, 26m ago) · metrics cover this segment only
```

The slide fires when the current file has **≤5 user turns** *and* a sibling `.jsonl` **≥100KB** exists in the same project directory. No aggregation happens — the numbers stay faithful to the live file; the slide just makes the scope explicit. To inspect the prior segment, jump to it, or see cumulative cost across every segment:

```bash
npx agent-token-meter --sessions              # list recent sessions in this project
npx agent-token-meter --session fa7a76de      # lock to the prior segment
npx agent-token-meter --all                   # cost summary across every session in this project
```

### Terminal setup

**Windows Terminal:** Right-click tab > Split Pane > run the meter in the smaller pane.
**macOS/Linux:** `tmux split-window -h 'npx agent-token-meter'` or use iTerm2 split panes.
**VS Code:** Split terminal (Ctrl+Shift+5), run in the second pane.

## Why this exists

Most coding agents have some form of cost or context display, but none tell you the *rate of change* — which is what actually matters for making decisions.

| Question | Built-in | **Agent Token Meter** |
|---|:---:|:---:|
| How much have I spent? | Sometimes | **Yes** |
| How full is my context? | Sometimes | **Yes** |
| How fast is it filling? | | **Yes** |
| Is the rate increasing? | | **Yes** |
| When will compaction trigger? | | **Yes** |
| Did compaction happen? | | **Yes** |
| Should I reset context now? | | **Yes** |
| How much does my history cost per call? | | **Yes** |
| How much would resetting save me? | | **Yes** |
| Can the agent nudge itself? | | **Yes** |

## Reading the display

### ×N.N multiplier + phase banner (the headline)

```
 MULTIPLIER   ×7.6 ↑        $0.52 now   $0.04 fresh
 BUILD — productive zone · context 22% · reset in ~442
```

The headline answers the question "should I reset?" before anything else. The multiplier is `currentContext / baseline` — per-call cost ratio vs. a fresh conversation, displayed with one decimal of precision. The arrow tracks acceleration (`↑`/`=`/`↓`). `now` is the current per-call cost; `fresh` is what a fresh-conversation call would cost.

The phase banner compresses state + action into one sentence: phase name (EXPLORE / BUILD / HANDOFF / CLEAR), short rationale, context fill %, reset ETA. When context has already exceeded usable, the banner switches to `⚠ HANDOFF AND CLEAR — context N% OVER · reset overdue Nm`.

Color bands on the multiplier:
- **×1–×2** green — fresh or productive, nothing to do
- **×3** yellow — plan a handoff
- **×4+** red — conversation history is taxing you heavily
- **×5+** red background — stop and reset now

### NOW — what's the current state

```
 context      212.5k / 967.0k         22%
 burn         +1706 tok/call ↑
 last turn    212.5k in · 231 out · tool_use
```

- **context** — current context size / usable limit (model limit minus the 33k auto-compact buffer) + fill %.
- **burn** — average context growth per call over the last 10 calls. Arrow shows acceleration trend.
- **last turn** — latest API call's context, output tokens, and stop reason. Useful for spotting which turns are driving burn.

### IF YOU CLEAR — the actionable projection

```
 per call     save $0.27
 next 20      save ~$5.48
 steps        write handoff → /clear → reload with plan
```

- **per call** — what you'd save on every subsequent call by writing a ~2k handoff file and resetting.
- **next 20** — cumulative savings over the next 20 calls.
- **steps** — the workflow: dump a plan file, reset context, reload in a fresh session.

This section only appears when `/clear` would save more than ~$0.005/call — below that, it's silent to keep the dashboard quiet.

### SESSION — the post-game breakdown

```
 spend        $75.93 · 16 turns · 11h 55m · $6.36/hr
 cache        97% hit · saved $350.12 · 27.7M in · 286.2k out
 alt models   Sonnet 4.6 $15.19   Kimi K2.5 $5.35
```

- **spend** — total cost, user turn count, session duration, cost per hour.
- **cache** — hit rate, cache ROI (net savings from caching), total billed input/output tokens.
- **alt models** — what the same workload would have cost on other providers. Customize via config file.
- **last** — most recent API call's context size, output tokens, stop reason. Useful for debugging unexpected burn.

## How it works

Coding agents write conversation logs as JSONL files. Each API response includes a `usage` object:

```json
{
  "input_tokens": 3,
  "output_tokens": 1247,
  "cache_creation_input_tokens": 2841,
  "cache_read_input_tokens": 89339
}
```

Agent Token Meter watches the active session file with `fs.watch` (falling back to polling), parses usage entries, and computes derived metrics: burn rate, acceleration, compaction prediction, and cost estimates.

A background scan every 3 seconds tracks which session is most recently active. If a different session starts growing and the current one has been idle for 30 s or more, the meter switches to it — so it follows you when you jump between Claude Code terminals. For the hook, Claude Code passes the session id and transcript path on stdin, so threshold state is tracked per session and concurrent instances don't suppress each other's nudges.

**It is strictly read-only.** It never modifies session files or interacts with any API.

## Pricing

Built-in rates (as of April 2026):

| Model | Input | Output | Cache Write | Cache Read | Context |
|---|---|---|---|---|---|
| **Opus 4.7** | $15/M | $75/M | $18.75/M | $1.50/M | 1M |
| **Opus 4.6** | $15/M | $75/M | $18.75/M | $1.50/M | 1M |
| **Sonnet 4.6** | $3/M | $15/M | $3.75/M | $0.30/M | 1M |
| **Haiku 4.5** | $0.80/M | $4/M | $1.00/M | $0.08/M | 200K |
| **Kimi K2.5** | $0.60/M | $3.00/M | $0.60/M | $0.15/M | 262K |
| **Kimi K2 Thinking** | $0.60/M | $2.50/M | $0.60/M | $0.15/M | 262K |

> Opus 4.7 rates mirror Opus 4.6 as a conservative default — Anthropic has kept Opus family pricing consistent. Override via `~/.claude/token-meter.json` if that changes.

### Custom providers

Add or override providers via config file (location depends on agent):

```json
{
  "compare": ["claude-sonnet-4-6", "kimi-k2.5", "my-provider"],
  "providers": {
    "my-provider": {
      "input": 1.0,
      "output": 5.0,
      "cacheWrite": 1.25,
      "cacheRead": 0.1,
      "context": 128000,
      "label": "My LLM"
    }
  }
}
```

## The quadratic cost problem

Every agent message sends the **entire conversation history** as input. If each turn adds ~2k tokens of context:

| Turns | Context sent this turn | Cumulative input billed |
|---|---|---|
| 10 | 20k | 110k |
| 50 | 100k | 2.55M |
| 100 | 200k | 10.1M |

That's not linear growth. It's `n(n+1)/2` — and it's why a long session can cost 10-50x what you'd expect.

Agent Token Meter makes this visible in real-time. The workflow advisor translates abstract context growth into a concrete dollar-per-call **context tax** and tells you exactly when the cost of continuing exceeds the cost of writing a handoff and starting fresh.

## License

MIT
