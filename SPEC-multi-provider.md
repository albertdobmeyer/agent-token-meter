# Spec: Multi-Provider Cost Comparison (Feature A)

## Goal

Show what the current session would cost on alternative providers, displayed as a single comparison line beneath the existing cost readout. Turns the meter into a decision tool: "am I on the right model for this task?"

## Data Flow

1. On startup, resolve a **comparison list** — provider keys to compare against:
   - Default: `["claude-sonnet-4-6", "kimi-k2.5"]` (meaningful contrast for Opus users)
   - Overridable via config file (`compare` array in `~/.claude/token-meter.json`)
   - The active model is always excluded from the comparison line

2. Per-turn token counts (`input`, `output`, `cacheCreate`, `cacheRead`) are already tracked. For each comparison provider, recompute total cost using that provider's rates:
   ```
   altCost = (totalInput/1M * p.input)
           + (totalOutput/1M * p.output)
           + (totalCacheCreate/1M * (p.cacheWrite || p.input))
           + (totalCacheRead/1M * (p.cacheRead || p.input))
   ```

3. If a provider has no `cacheWrite` rate published, fall back to `input` rate (conservative estimate — assumes no cache discount on writes).

## Display

```
 cost       $13.49 total   ~$0.36/call   ~$7.20/hr
            Sonnet 4.6: $2.70  Kimi K2.5: $0.76
```

- Second line is DIM, indented to align with the cost value
- Provider names are shortened for display (`claude-sonnet-4-6` → `Sonnet 4.6`, `kimi-k2.5` → `Kimi K2.5`)
- Up to 3 comparison providers shown (truncate if more to avoid line wrap)

## Built-in External Providers

Ship with these baked in (no config needed):

| Key | Input | Output | Cache Write | Cache Read | Context |
|-----|-------|--------|-------------|------------|---------|
| `kimi-k2.5` | $0.60/M | $3.00/M | $0.60/M | $0.15/M | 262K |
| `kimi-k2-thinking` | $0.60/M | $2.50/M | $0.60/M | $0.15/M | 262K |

Users can add more via config file (see SPEC-config-file.md).

## Assumptions & Limitations

- **Same cache behavior assumed**: We reuse Claude's cache hit/miss split. Real-world cache performance on other providers would differ. This is explicitly a "same workload, different rates" estimate — not a migration prediction.
- **No capability comparison**: The line doesn't claim Kimi K2.5 produces equivalent output. It's a price tag, not a recommendation.
- **Thinking tokens**: External providers may charge thinking tokens differently. We apply output rate uniformly since we can't distinguish thinking tokens in the current JSONL format (forward-compatible if the field appears).

## Edge Cases

- Active model matches a comparison key → skip it (don't show "Opus: $13.49" when you're on Opus)
- Unknown comparison key (typo in config) → silently skip
- Session has 0 turns → skip comparison line entirely
