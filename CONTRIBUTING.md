# Contributing to Agent Token Meter

Thanks for your interest! This is a small, zero-dependency tool and contributions should keep it that way.

## Adding a new agent

The tool is agent-agnostic by design. Each agent is a profile in the `AGENTS` object (`token-meter.mjs`, line ~28). To add support for a new agent (e.g., Cursor, Windsurf):

1. **Add an agent profile** to the `AGENTS` object with this shape:

```js
"my-agent": {
  id: "my-agent",
  name: "My Agent",
  sessionDir: () => path.join(os.homedir(), ".my-agent", "sessions"),
  configDir: () => path.join(os.homedir(), ".my-agent"),
  configFile: "token-meter.json",
  pricing: {
    "model-name": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  },
  defaultPricing: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  contextLimits: { "model-name": 200_000 },
  defaultContextLimit: 200_000,
  commands: { clear: "/clear", compact: "/compact" },
  hook: { supported: false },
  detect: () => fs.existsSync(path.join(os.homedir(), ".my-agent")),
}
```

2. **Ensure the JSONL parser works** with your agent's log format. The parser (`token-meter.mjs`, line ~293) expects lines with:
   - `type: "assistant"` and `message.usage` containing `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`
   - `type: "user"` with `message.role: "user"` for turn counting

   If your agent uses a different log format, you'll need to add a format-specific parser branch.

3. **Test** with a real session log file from the agent.

## Adding a pricing provider

For external cost comparisons, add entries to `EXTERNAL_PROVIDERS` and `EXTERNAL_CONTEXT_LIMITS` (line ~68):

```js
"my-provider": { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
```

Prices are in dollars per million tokens.

## Development setup

```bash
git clone https://github.com/albertdobmeyer/agent-token-meter
cd agent-token-meter
node token-meter.mjs          # run the dashboard
node token-meter.mjs --all    # list all sessions
```

No build step, no dependencies to install. Just Node.js 18+.

## PR guidelines

- **Zero dependencies.** Don't add npm packages. The tool uses only Node.js built-ins (`fs`, `path`, `os`).
- **Single file.** Keep `token-meter.mjs` as the main (and ideally only) source file.
- **Test with real data.** Run the meter against an actual session log before submitting.
- **Keep it fast.** The dashboard refreshes on every file change. The hook script must stay under ~50ms.

## Releasing (maintainers)

Releases publish via GitHub Actions on a `v*` tag push. No npm tokens ever touch a laptop, chat, or the README — the workflow authenticates via a repo secret and attaches [SLSA provenance](https://docs.npmjs.com/generating-provenance-statements) so consumers can verify the tarball was built from this repo.

**One-time setup** (per repo, ~2 minutes):

1. On npmjs.com, generate a **Granular Access Token** scoped to the `agent-token-meter` package with:
   - Permissions: **Read and write**
   - Packages: `agent-token-meter`
   - Expiration: 90 days (shorter is better; rotate on expiry)
2. Add it to the repo: GitHub → Settings → Secrets and variables → Actions → **New repository secret** → name `NPM_TOKEN`, value the token. The secret is never exposed in workflow logs.

**Per-release workflow:**

```bash
# Bump the version (patch / minor / major) — creates a commit and tag
npm version patch -m "Release v%s"

# Push both the commit and the tag. The tag push triggers publish.yml.
git push --follow-tags origin main
```

Watch the run under **Actions** in GitHub. The workflow:

1. Checks that the tag matches `package.json` version (fails fast on mismatch).
2. Runs syntax and CLI smoke checks.
3. Publishes with `--provenance` — npm stores a cryptographic attestation linking the tarball to this exact commit and CI run.

After publish, users can verify:

```bash
npm audit signatures
```

**Version is sourced from `package.json`** at runtime (token-meter.mjs), so `npm version` is the single source of truth — no separate constant to keep in sync.

## Reporting issues

Open an issue on GitHub with:
- Your OS and Node.js version
- The agent you're using
- What you expected vs. what happened
