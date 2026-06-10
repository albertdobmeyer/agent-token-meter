# Security Policy

## Supported versions

Only the latest published version on npm receives security fixes. The project is small enough that there's no LTS branch — please upgrade to the latest before reporting an issue.

## Reporting a vulnerability

**Please do not file public GitHub issues for security concerns.**

Use GitHub's [private vulnerability reporting](https://github.com/albertdobmeyer/agent-token-meter/security/advisories/new):

1. Open the [Security tab](https://github.com/albertdobmeyer/agent-token-meter/security) of this repository
2. Click **Report a vulnerability**
3. Fill in the advisory details

You'll get an acknowledgment within 72 hours. For high-severity issues, expect a fix or mitigation within 14 days. You'll be credited in the release notes unless you prefer to remain anonymous.

## Scope

**In scope:**

- Code execution or privilege escalation triggered by running `agent-token-meter` or its hook
- File-system writes outside the paths enumerated in **Files this tool writes to** below — currently six: `~/.claude/settings.json`, `~/.claude/hooks/token-meter-hook.mjs`, `~/.claude/token-meter-hook-state.json`, `~/.claude/token-meter.json`, `./AGENT-PROTOCOL.md`, and `./CLAUDE.md` (the last two only on `--install-protocol`)
- Silent modification or deletion of unrelated hook entries during `--install-hooks` / `--uninstall-hooks`
- Supply-chain integrity issues: tampering with published tarballs, forged or missing provenance attestations, compromised CI workflow
- Prompt-injection vectors in the threshold hook — e.g., if attacker-controlled text in a session log could be reflected into the `additionalContext` field sent back to the agent

**Out of scope:**

- Vulnerabilities in Node.js itself or in the user's terminal emulator
- Overriding pricing or context limits via the optional config file — that's local user configuration, not a security boundary
- Social engineering of the maintainer or npm/GitHub account (report to the respective platform)
- Files in the user's own `~/.claude/` directory being readable by other processes running as the same user

## Verifying a release

Every version since **1.2.4** is published via GitHub Actions with a signed SLSA provenance attestation. To verify a release as a consumer:

```bash
npm audit signatures
```

from a project that installs `agent-token-meter`. Expected output:

```
1 package has a verified registry signature
1 package has a verified attestation
```

The attestation cryptographically ties the tarball to a specific commit in this repository, built by this repository's `publish.yml` workflow. A package that lacks provenance — or whose provenance points to a different repo — is evidence of unauthorized publishing.

## Security posture

- **Zero runtime dependencies.** No transitive supply-chain risk. `package.json` `dependencies` is intentionally absent.
- **No lifecycle scripts.** Nothing runs automatically on `npm install` or `npm uninstall`. No `preinstall`, `postinstall`, `prepublish`, or any other hook scripts in `package.json`.
- **Read-mostly.** The dashboard is strictly read-only against session logs. All writes are limited to the paths enumerated below, behind explicit flags, with atomic semantics.
- **Atomic settings writes.** Concurrent edits to `~/.claude/settings.json` by Claude Code won't clobber user-owned hook entries (tmp-file + rename pattern, same-directory rename is atomic on Windows and POSIX).
- **Exact-path hook matching.** Install/uninstall identifies our hook entries by the exact installed filename, never a substring match — so an unrelated user hook with "token-meter" in its name can't be silently removed.
- **Published from signed CI.** No maintainer laptop holds publish credentials. The npm access token lives only as an encrypted GitHub repository secret (`NPM_AGENT_TOKEN_METER_CI`).
- **GitHub Actions pinned to commit SHAs.** Every external Action used in `ci.yml` and `publish.yml` is pinned to a specific commit hash (with a comment indicating the matching version tag). A compromise of an upstream Action's tag cannot affect us until we explicitly review and update the pinned SHA. Updates ride through Dependabot or a deliberate maintainer change.
- **Signed git tags for releases.** Release tags (`v*`) are GPG- or SSH-signed by the maintainer. Combined with SLSA provenance and the tag-version-matches-package.json check in the publish workflow, this creates a three-step chain: signed tag → CI verifies tag = package.json version → npm `--provenance` attestation links the published tarball to the commit. Tampering with the published tarball or its provenance is caught by `npm audit signatures`; tampering with the source tag itself is caught by `git tag --verify`. The two checks are independent — together they cover the full chain.

## Automated scanner findings (reviewed & accepted)

Third-party supply-chain scanners (e.g., [Socket.dev](https://socket.dev)) raise a low-severity, **informational** `URL strings` alert against this package. This is expected and benign — it is not a vulnerability.

The alert fires because the bundled documentation contains hardcoded URLs. Every one of them is a static documentation or attribution link:

- **`README.md`** — npm, CI, license, signed-provenance, and deps-0 status badges; the repository link; and the terminal screenshot.
- **`CREDITS.md`** / **`the-hidden-constraint.md`** — source attributions: the arXiv papers, articles, and Claude Code docs that informed the design.

These strings appear only in Markdown that ships for human reading. The executable code (`token-meter.mjs`, `hook.mjs`, `protocol.mjs`) contains no hardcoded network endpoints, and — as noted under **Privacy posture** — the tool **makes no network calls at runtime**. There is nothing for an embedded URL to exfiltrate to. Removing these links would strip legitimate attribution and security badges without improving the actual supply-chain posture, so the finding is reviewed and accepted as a false positive rather than suppressed by deleting the links.

## Privacy posture

Because the meter watches an AI-coding session, users have reasonably asked what the tool itself learns about them. The short answer: nothing leaves your machine.

- **No telemetry.** The tool makes no network calls — ever. There is no analytics, no phone-home, no error reporting, no version-check ping. The only network activity related to this package is `npm audit signatures`, which you run yourself.
- **No user identification.** We do not generate, store, or transmit any identifier for you. The hook state file (`~/.claude/token-meter-hook-state.json`) is keyed only by Claude Code's local session UUIDs.
- **All state is local.** Every file the tool creates lives on your filesystem, enumerated below, removable via `--uninstall-hooks` / `--uninstall-protocol`.
- **What the tool reads from your session.** The dashboard and hook parse your session JSONL files (`~/.claude/projects/*/*.jsonl`) to extract token counts, model identifiers, and turn timestamps. Your conversation *content* is in those files but the tool extracts only the structural metadata — and nothing is copied, transmitted, or logged elsewhere.

## Files this tool writes to

For full auditability, here is every path `agent-token-meter` writes to, when, and why. Writes outside this list constitute a security bug — please report.

### Always (when the dashboard runs)

| Path | When | Purpose |
|---|---|---|
| stdout | continuously | Rendering the dashboard via alt-screen buffer |

The dashboard itself writes only to stdout. No filesystem writes occur in normal `npx agent-token-meter` operation.

### On `--install-hooks` (opt-in)

| Path | Action |
|---|---|
| `~/.claude/hooks/token-meter-hook.mjs` | Created or overwritten — copy of the bundled `hook.mjs` |
| `~/.claude/settings.json` | Atomically updated to register hook entries under three event keys: `PostToolUse`, `SessionStart`, `PostCompact`. Existing entries by other tools are preserved. |

### On hook execution (after `--install-hooks`)

| Path | Action |
|---|---|
| `~/.claude/token-meter-hook-state.json` | Read on each hook invocation; updated when a threshold fires or compaction is detected. Tiny JSON file keyed by session id. |
| stdout | If a threshold fires, emits one JSON line with `hookSpecificOutput.additionalContext` containing the nudge text. Otherwise silent. |

### On `--uninstall-hooks` (opt-in)

| Path | Action |
|---|---|
| `~/.claude/hooks/token-meter-hook.mjs` | Removed if present |
| `~/.claude/token-meter-hook-state.json` | Removed if present |
| `~/.claude/settings.json` | Atomically updated to remove our entries from every registered event key |

### On `--install-protocol` (opt-in, project-local)

| Path | Action |
|---|---|
| `./AGENT-PROTOCOL.md` (in the cwd) | Created or overwritten — copy of the bundled protocol document |
| `./CLAUDE.md` (in the cwd) | Created if absent, or atomically updated to append a delimited section referencing `@AGENT-PROTOCOL.md`. Idempotent — re-running does not duplicate. Pass `--no-claude-md` to skip this step entirely. |

### On `--uninstall-protocol` (opt-in, project-local)

| Path | Action |
|---|---|
| `./AGENT-PROTOCOL.md` | Removed if present |
| `./CLAUDE.md` | Atomically updated to remove the delimited section. If the file would be empty after removal (we created it), it is removed as well. |

### Read-only paths (never written)

| Path | Read for |
|---|---|
| `~/.claude/projects/*/*.jsonl` | Parsing session logs for cost and context metrics |
| `~/.claude/token-meter.json` (optional) | Configuration overrides (custom providers, etc.) |
| `package.json` (in the package directory) | Reading the version string for the dashboard header |

## Verifying a release (for consumers)

Every version since **1.2.4** is published via GitHub Actions with a signed SLSA provenance attestation. Every tag since **1.4.0** is also signed by the maintainer's key. To verify a release as a consumer:

```bash
# Verify the published tarball's provenance
npm audit signatures
```

Expected output:

```
1 package has a verified registry signature
1 package has a verified attestation
```

```bash
# Verify the corresponding git tag's signature
git tag --verify v1.4.0
```

A package that lacks provenance — or whose provenance points to a different repo, or whose tag fails verification — is evidence of unauthorized publishing.

For a change-by-change audit trail, see [CHANGELOG.md](CHANGELOG.md).
