# ⚡ Claude Code Token Meter

**A speedometer for your context window.** Zero dependencies. Single file. Answers one question: *should I `/compact` or `/clear` right now?*

Claude Code bills by tokens, and conversations accumulate cost **quadratically** — each message resends the entire history. A 100-turn conversation doesn't cost 10× more than a 10-turn conversation. It costs **50×** more. Most developers have no real-time visibility into this.

Token Meter watches your Claude Code session and shows you the burn rate, acceleration, and estimated calls until auto-compaction — so you know *when* to act, not just how much you've spent after the fact.

```
 ⚡ Claude Code Token Meter v0.3.0
────────────────────────────────────────────────────

 model      claude-opus-4-6
 session    12 user turns  (37 API calls)  1h 24m

 context    ██████░░░░░░░░░░░░░░░░░░░░░░░░ 18.2%
            176.3k / 967.0k usable  (1.0M limit - 33.0k buffer)

 burn       +2.1k/call  accelerating
 compact    ~376 calls

 tokens     in: 3.8M   out: 42.1k
            cache hit: 3.6M (96%)  write: 142.3k  uncached: 42
            cache ROI: +$48.07 net savings (write: $5.50, saved: $53.57)

 cost       $7.83 total   ~$0.21/call   ~$5.58/hr
            Sonnet 4.6: $1.57  Kimi K2.5: $0.49

────────────────────────────────────────────────────

 workflow   BUILD  Productive zone. Context is earning its keep.

 overhead   159.5k of history  (baseline: 16.8k)
 ctx tax    $0.24/call for carrying conversation history
 /clear     saves $0.24/call  (~$4.72 over next 20 calls with handoff)
 projection ~$86.72 total by compaction (376 more calls)

────────────────────────────────────────────────────
 last call  ctx: 176.3k  out: 1.2k  end_turn
────────────────────────────────────────────────────
```

## Why this exists

Claude Code has `/cost` (total spent) and `/context` (snapshot of fill %). Neither tells you the *rate of change* — which is what actually matters for making decisions.

| Question | `/cost` | `/context` | **Token Meter** |
|---|:---:|:---:|:---:|
| How much have I spent? | ✓ | | ✓ |
| How full is my context? | | ✓ | ✓ |
| How fast is it filling? | | | **✓** |
| Is the rate increasing? | | | **✓** |
| When will compaction trigger? | | | **✓** |
| Did compaction happen? | | | **✓** |
| Should I `/compact` now? | | | **✓** |
| Should I `/clear` now? | | | **✓** |
| How much does my history cost per call? | | | **✓** |
| How much would `/clear` save me? | | | **✓** |

## What makes this different

There are 15+ Claude Code monitoring tools. Here's why this one exists:

### Workflow advisor with `/clear` savings

Token Meter is the only tool that tells you *when* to `/clear` and *how much you'll save* if you do. It tracks four workflow phases based on your context overhead:

| Phase | Overhead | What it means |
|---|---|---|
| **EXPLORE** | 0-10% | Context is cheap. Read files, explore, plan freely. |
| **BUILD** | 10-25% | Productive zone. Your history is earning its keep. |
| **HANDOFF** | 25-45% | Getting expensive. Write a plan file soon. |
| **/CLEAR** | 45%+ | Context tax is significant. Write handoff, then `/clear`. |

The **context tax** line shows the per-call dollar cost of carrying your conversation history. The **/clear savings** line shows exactly how much you'd save over the next 20 calls by clearing and reloading from a plan file. This turns an abstract "should I clear?" into a concrete dollar amount.

**The optimal workflow this enables:**
1. **EXPLORE** — plan, read code, ask questions (cheap)
2. **BUILD** — implement, context is useful (productive)
3. **HANDOFF** — tell Claude "save our plan to `plan.md`" (preserve decisions)
4. **/CLEAR** — fresh context, reload: "read `plan.md` and implement step 3" (cheap again)

### It's a speedometer, not a dashboard

Most tools are dashboards: charts, tables, history, web UIs. Token Meter is a glanceable heads-up display. You run it in a split terminal pane and it tells you what you need to know *right now* — context fill, burn rate, calls until compaction.

### Burn-rate acceleration

Other tools track cumulative cost. Token Meter tracks the **second derivative** — is your context growing faster or slower than it was 5 calls ago? This tells you whether you're entering a heavy phase (large file reads, verbose tool output) before the bill surprises you.

### Compaction detection

When Claude Code auto-compacts, your context size drops sharply. Token Meter detects these events and resets its burn-rate calculation from the post-compaction baseline — so predictions stay accurate across compaction boundaries. It also logs compaction history so you can see how aggressively your sessions get compacted.

### Zero dependencies, single file

| | Token Meter | ccusage | Claude-Code-Usage-Monitor | tokscale | Claude Code Dashboard |
|---|---|---|---|---|---|
| Dependencies | **0** | 0 | Python + Rich + Pydantic | Node + Rust | Express + Chokidar + React |
| Files | **1** | monorepo | package | package + native | project |
| Install | `npx` | `npx` | `pip install` | `npx` + build | `git clone` + `npm install` |
| Real-time | **✓** | ✗ | ✓ | ✓ | ✓ |
| Burn rate | **✓** | ✗ | ✓ | ✗ | ✗ |
| Acceleration | **✓** | ✗ | ✗ | ✗ | ✗ |
| Compaction detection | **✓** | ✗ | ✗ | ✗ | ✗ |
| Compact ETA | **✓** | ✗ | limit ETA | ✗ | ✗ |
| Workflow phases | **✓** | ✗ | ✗ | ✗ | ✗ |
| Context tax ($/call) | **✓** | ✗ | ✗ | ✗ | ✗ |
| /clear savings | **✓** | ✗ | ✗ | ✗ | ✗ |
| Multi-provider comparison | **✓** | ✗ | ✗ | ✗ | ✗ |
| Cost per hour | **✓** | ✗ | ✗ | ✗ | ✗ |
| Cache ROI | **✓** | ✗ | ✗ | ✗ | ✗ |
| Session cost projection | **✓** | ✗ | ✗ | ✗ | ✗ |
| Custom provider config | **✓** | ✗ | ✗ | ✗ | ✗ |

## Install

```bash
npx claude-code-token-meter
```

Or clone and run directly:

```bash
git clone https://github.com/gitgoodordietrying/claude-code-token-meter
cd claude-code-token-meter
node token-meter.mjs
```

**Requirements:** Node.js 18+ (no other dependencies).

## Usage

Run in a **split terminal pane** alongside Claude Code:

```bash
# Auto-detect and watch the most recent session
npx claude-code-token-meter

# List all sessions with cost summary
npx claude-code-token-meter --all

# Filter by project
npx claude-code-token-meter --project augustus-trading

# Watch a specific session file
npx claude-code-token-meter ~/.claude/projects/my-project/SESSION_ID.jsonl
```

### Terminal setup

**Windows Terminal:** Right-click tab → Split Pane → run the meter in the smaller pane.
**macOS/Linux:** `tmux split-window -h 'npx claude-code-token-meter'` or use iTerm2 split panes.
**VS Code:** Split terminal (Ctrl+Shift+5), run in the second pane.

## Reading the display

### Context bar

```
 context    ██████████████████░░░░░░░░░░░░ 58.2%
            563.2k / 967.0k usable  (1.0M limit - 33.0k buffer)
```

The usable space is the model's context limit minus Claude Code's 33k auto-compact buffer. When you hit ~95% of usable space, auto-compaction triggers.

### Burn rate + acceleration

```
 burn       +3.4k/call  accelerating
```

- **Burn rate** — average context growth per API call over the last 10 calls (resets after compaction).
- **Acceleration** — compares the rate from the last 5 calls vs. the previous 5. `accelerating` means you're reading larger files or getting longer responses. `decelerating` means the conversation is stabilizing. `steady` means consistent growth.

### Compaction ETA

```
 compact    ~142 calls
```

Estimated API calls until auto-compaction triggers, based on current burn rate. Color-coded:
- 🟢 Green (200+): no pressure
- 🟡 Yellow (50-200): getting there
- 🔴 Red (<50): consider `/compact` or `/clear`
- ⬛ Inverted red (<10): `/compact now`

### Workflow advisor

```
 workflow   HANDOFF  Write a plan file soon: "save our plan to plan.md"

 overhead   283.1k of history  (baseline: 16.8k)
 ctx tax    $0.42/call for carrying conversation history
 /clear     saves $0.42/call  (~$8.41 over next 20 calls with handoff)
```

- **workflow** — current phase (EXPLORE → BUILD → HANDOFF → /CLEAR) based on how much of your context is conversation overhead vs. the fixed baseline (system prompt + tools).
- **overhead** — tokens of conversation history you're carrying. This is the part that disappears when you `/clear`.
- **ctx tax** — the dollar cost per API call of that overhead, at cache-read rates. This is what you're paying *just to replay your history* on every single call.
- **/clear savings** — if you write a ~2k token handoff file and `/clear`, this is how much you save per call and cumulatively over the next 20 calls. When this number gets large, it's time to act.
- **projection** — estimated total session cost by the time auto-compaction triggers. Based on current burn rate × avg cost/call. Helps you decide whether to `/clear` now or let it ride.

### Cost comparison

```
 cost       $7.83 total   ~$0.21/call   ~$5.58/hr
            Sonnet 4.6: $1.57  Kimi K2.5: $0.49
```

Shows what the same workload (same token counts, same cache split) would cost on alternative providers. Default comparisons: Sonnet 4.6 and Kimi K2.5. Customize via `~/.claude/token-meter.json`. The **$/hr** rate is computed from elapsed session time.

### Cache efficiency + ROI

```
 tokens     in: 3.8M   out: 42.1k
            cache hit: 3.6M (96%)  write: 142.3k  uncached: 42
            cache ROI: +$48.07 net savings (write: $5.50, saved: $53.57)
```

Claude Code uses prompt caching aggressively. A high cache hit rate (90%+) means the system is working well. Low hit rates suggest frequent cache invalidation (e.g., many file edits between turns).

The **cache ROI** line shows the net value of caching: how much the cache writes cost vs. how much you saved by reading from cache (at input rate) instead of paying full input price. A positive number means caching is working in your favor.

### Session summary

```bash
$ npx claude-code-token-meter --all

Claude Code Sessions

  Date          Context  Turns      Cost  Cache%  Project
  ──────────────────────────────────────────────────────────────────────
  4/1/2026       49.0k      7     $4.00    96%  my-project
  3/31/2026     274.9k     48   $150.48    91%  augustus-trading (3x compacted)
  3/27/2026     409.9k     62   $217.31    88%  llm-tuning-forge
  ──────────────────────────────────────────────────────────────────────
  Total: $371.79 across 3 sessions
```

## How it works

Claude Code writes conversation logs as JSONL files in `~/.claude/projects/<project>/<session-id>.jsonl`. Each API response includes a `usage` object:

```json
{
  "input_tokens": 3,
  "output_tokens": 1247,
  "cache_creation_input_tokens": 2841,
  "cache_read_input_tokens": 89339
}
```

Token Meter watches the active session file with `fs.watch` (falling back to polling if unavailable), parses usage entries, and computes derived metrics: burn rate, acceleration, compaction prediction, and cost estimates.

**It is strictly read-only.** It never modifies session files or interacts with the Claude API.

## Pricing

Built-in rates (as of April 2026):

| Model | Input | Output | Cache Write | Cache Read | Context |
|---|---|---|---|---|---|
| **Opus 4.6** | $15/M | $75/M | $18.75/M | $1.50/M | 1M |
| **Sonnet 4.6** | $3/M | $15/M | $3.75/M | $0.30/M | 1M |
| **Haiku 4.5** | $0.80/M | $4/M | $1.00/M | $0.08/M | 200K |
| **Kimi K2.5** | $0.60/M | $3.00/M | $0.60/M | $0.15/M | 262K |
| **Kimi K2 Thinking** | $0.60/M | $2.50/M | $0.60/M | $0.15/M | 262K |

### Custom providers

Add or override providers via `~/.claude/token-meter.json`:

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

The `compare` array controls which providers appear in the comparison line. Only `input` and `output` are required; cache rates fall back to the input rate if omitted. The `label` field overrides the auto-generated display name.

## The quadratic cost problem

Every Claude Code message sends the **entire conversation history** as input. If each turn adds ~2k tokens of context:

| Turns | Context sent this turn | Cumulative input billed |
|---|---|---|
| 10 | 20k | 110k |
| 50 | 100k | 2.55M |
| 100 | 200k | 10.1M |

That's not linear growth. It's `n(n+1)/2` — and it's why a long session can cost 10-50× what you'd expect.

Token Meter makes this visible in real-time. The workflow advisor translates abstract context growth into a concrete dollar-per-call **context tax** and tells you exactly when the cost of continuing exceeds the cost of writing a handoff and starting fresh.

The optimal strategy: plan in one context, write a handoff, `/clear`, then implement from the lean handoff. Token Meter keeps you on that track by showing when each transition should happen — in dollars, not guesswork.

## License

MIT
