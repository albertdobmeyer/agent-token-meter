# Spec: External Config File (Feature E)

## Goal

Let users customize comparison providers and add new pricing without editing source code. Preserves the zero-dependency promise — just `fs.readFileSync` + `JSON.parse`.

## File Location

```
~/.claude/token-meter.json
```

Lives alongside Claude Code's own config. The file is **optional** — the meter works identically without it.

## Schema

```json
{
  "compare": ["claude-sonnet-4-6", "kimi-k2.5", "my-custom-provider"],
  "providers": {
    "my-custom-provider": {
      "input": 1.0,
      "output": 5.0,
      "cacheWrite": 1.25,
      "cacheRead": 0.1,
      "context": 128000,
      "label": "Custom LLM"
    }
  }
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `compare` | `string[]` | No | Provider keys to show in comparison line. Default: `["claude-sonnet-4-6", "kimi-k2.5"]` |
| `providers` | `object` | No | Custom provider definitions keyed by provider ID |
| `providers[key].input` | `number` | Yes* | $/M input tokens |
| `providers[key].output` | `number` | Yes* | $/M output tokens |
| `providers[key].cacheWrite` | `number` | No | $/M cache write tokens. Falls back to `input` rate |
| `providers[key].cacheRead` | `number` | No | $/M cache read tokens. Falls back to `input` rate |
| `providers[key].context` | `number` | No | Context window size in tokens |
| `providers[key].label` | `string` | No | Display name. Falls back to key with heuristic formatting |

*Required only for user-defined providers. Built-in providers already have rates.

## Loading Behavior

1. **On startup**: `main()` reads and parses the config file
2. **On error** (missing file, invalid JSON, permission denied): silently use defaults — no crash, no warning
3. **Merge order**: Built-in Claude pricing → built-in external providers → user config providers (user wins on conflict)
4. **Config providers can override built-ins**: If the user defines `"claude-opus-4-6"` in their config, their rates replace the hardcoded ones. This handles price changes without waiting for a code update.

## Resolution

The resolved config object passed through the call chain:

```js
{
  allPricing: { ...builtInClaude, ...builtInExternal, ...userProviders },
  allLimits: { ...builtInLimits, ...externalLimits, ...userLimits },
  compare: config.compare || ["claude-sonnet-4-6", "kimi-k2.5"],
}
```

## Display Name Heuristic

For provider keys without a `label`:
- `claude-opus-4-6` → `Opus 4.6`
- `claude-sonnet-4-6` → `Sonnet 4.6`
- `claude-haiku-4-5` → `Haiku 4.5`
- `kimi-k2.5` → `Kimi K2.5`
- Anything else → title-case the key, replace `-` with space

## Edge Cases

- **File doesn't exist**: Use defaults silently (the common case)
- **File is empty or `{}`**: Use defaults
- **Malformed JSON**: Use defaults, no crash
- **Provider missing required rate fields**: Skip that provider in comparisons
- **compare references unknown key**: Skip silently
- **Config file changes while meter is running**: Not hot-reloaded (restart required). Could add later but YAGNI for v0.3.
