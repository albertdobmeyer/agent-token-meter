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
- File-system writes outside the four known paths: `~/.claude/settings.json`, `~/.claude/hooks/token-meter-hook.mjs`, `~/.claude/token-meter-hook-state.json`, and `~/.claude/token-meter.json`
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

- **Zero runtime dependencies.** No transitive supply-chain risk.
- **No lifecycle scripts.** Nothing runs automatically on `npm install` or `npm uninstall`.
- **Read-mostly.** The dashboard is read-only. Writes are limited to the four paths listed above and are opt-in behind explicit flags.
- **Atomic settings writes.** Concurrent edits to `~/.claude/settings.json` by Claude Code won't clobber user-owned hook entries.
- **Published from signed CI.** No maintainer laptop holds publish credentials. The npm access token lives only as an encrypted GitHub repository secret.

For a change-by-change audit trail, see [CHANGELOG.md](CHANGELOG.md).
