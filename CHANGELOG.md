# Changelog

All notable changes to **agent-token-meter** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.4] — 2026-06-10

### Fixed
- **`parseSession` read-error path returned `userTurns: []` (an array) instead of `0`.** Every other path treats `userTurns` as a number; the array leaked into the rollover-cap check (`(session.userTurns || 0) <= ROLLOVER_TURN_CAP`), where a truthy empty array coerces to `0` and could spuriously trigger the rollover hint for an unreadable session. Now returns `0`. (`token-meter.mjs`)
- **Hook state file (`token-meter-hook-state.json`) is now written atomically (tmp + rename).** A plain `writeFileSync` could be read half-written by a second hook process from a concurrent session, resetting per-session `fired` state and re-firing already-crossed thresholds. Now matches the tmp+rename pattern already used for `settings.json`, with a pid-stamped tmp name so concurrent writers don't collide. (`hook.mjs`)
- **`settings.json` atomic write hardened.** Pid-stamped tmp name; on a rename failure (e.g. the target briefly open on Windows) the tmp file is cleaned up instead of stranded in `~/.claude/`. (`token-meter.mjs`)

### Security
- **SessionStart bootstrap nudge no longer reflects arbitrary filesystem names into the agent's context.** Handoff-file discovery now requires a strict `handoff-<name>.md` pattern, so a crafted filename carrying prompt-injection text (spaces, parens, quotes) is rejected rather than interpolated into `additionalContext`. Closes the in-scope prompt-injection vector named in the SECURITY.md threat model. (`hook.mjs`)

### Docs
- **`SECURITY.md` write-path count corrected from "six" to "five".** The v1.4.2 "four → six" fix over-counted by including `~/.claude/token-meter.json`, which is read-only config (and already listed under read-only paths). The Scope section now enumerates only the five real write paths.
- **`SECURITY.md` hook-matching claim corrected.** It previously said matching was "exact … never a substring match"; the implementation matches the full installed filename (`token-meter-hook.mjs`) as a containment check. The wording now describes what the code does while keeping the real guarantee (the bare `token-meter` token is not matched).
- **README "What the agent sees" nudge table synced to the actual hook strings** — the 50/75/90% and compaction rows now show the `./handoff-<id>.md` filenames the hook emits (the table still showed pre-v1.4 strings).
- **README dashboard mockups bumped from `v1.4.0` to `v1.4.4`.**

### Changed
- **CI: Dependabot bumped the SHA-pinned GitHub Actions** — `actions/checkout` 4.3.1 → 6.0.2 and `actions/setup-node` 4.4.0 → 6.4.0, per the SHA-pinning supply-chain policy documented in SECURITY.md.

### Why
A full pre-release codebase sweep (three focused reviewers plus line-by-line verification). It surfaced two real code bugs (`userTurns` type, non-atomic hook state), one in-scope prompt-injection hardening, and several documentation claims that had drifted from the implementation. No change to the dashboard, the wire format, or the hook's normal behavior.

## [1.4.3] — 2026-05-19

### Changed
- **README Install section restructured for clarity.** A pre-ship audit found the install information had three issues: (1) the word "install" was overloaded across three different concepts (package install, hook install, protocol install) without an obvious hierarchy, (2) the combined full-setup command was buried in the Agent Protocol section several screen-heights below, (3) no prerequisite about Claude Code being installed/running. The section now uses a flatter four-subsection structure:
  - **Quick start** — single `npx agent-token-meter` command with the prerequisite called out explicitly
  - **Full agentic setup (one-time per project)** — the combined `--install-hooks --install-protocol` command surfaced near the top instead of buried, with reversal commands listed inline
  - **Alternate install methods** — `npm i -g` and source-clone, collapsed into compact code blocks
  - **Heads-up about the npm-page install snippet** — the npm-default-snippet footgun is now a labeled subsection (was a blockquote, easy to skim past), with a recovery path for users who already ran `npm i agent-token-meter` and find the command missing on PATH
- **Threshold hooks and Agent Protocol sections** retain their behavioral explanations but no longer duplicate the install commands — those live in the new top-of-install structure.

### Why
The package gets ~500 weekly downloads. The most common point of friction for a new user is the install path, and the npm-page default snippet (`npm i agent-token-meter`) genuinely doesn't make the CLI binary available — a footgun outside our control. v1.4.3 doesn't fix the npm snippet (we can't), but it puts the right command first, names the trap clearly, and tells the user what to do if they fell into it. Net effect: a smoother first impression for new users, no behavior change.

## [1.4.2] — 2026-05-19

### Fixed
- **README + AGENT-PROTOCOL.md `~50×` claim corrected to `~90×`.** A 100-turn vs 10-turn comparison at 2k tokens/turn yields a 91.8× billed-input ratio, not 50× — the table in the README already showed the correct math (`110k` → `10.1M`), but the prose summary used a conservative number that didn't reconcile. Now the headline and the worked example match.
- **`SECURITY.md` "four known paths" corrected to enumerate all six.** v1.4 added `./AGENT-PROTOCOL.md` and `./CLAUDE.md` writes via `--install-protocol`, but the Scope section still said "four." Now references the **Files this tool writes to** enumeration as the canonical list.
- **`SECURITY.md` overclaim on `npm audit signatures` scoped down.** The previous wording — "tampering at any step breaks `npm audit signatures`" — was wrong; that command checks the published tarball and provenance but not the source git tag signature. Now the two checks (`npm audit signatures` + `git tag --verify`) are documented as independent and complementary.
- **README "strictly read-only" claim scoped to the watcher process.** Previous wording could be read as the whole tool being read-only; the dashboard and watcher are read-only, but the installer flags write files (and that's enumerated in SECURITY.md). Clarified.
- **`~20ms` hook runtime claim softened to "typically under 50ms".** The 20ms number was plausible but not benchmarked; the softer claim is defensible across machine speeds and session sizes.
- **Stale path examples replaced with generic placeholders.** `B:\A5DS-HQ\agent-token-meter` (old maintainer workspace) and `--project augustus-trading` (specific personal project) replaced with `~/code/my-project` and `--project my-app`.
- **AGENT-PROTOCOL.md "Following this protocol means:" softened to "Following this protocol helps".** The previous phrasing implied a guarantee; the protocol helps but doesn't guarantee outcomes across all models, sessions, and tasks.
- **Pricing table dated "as of April 2026" updated to "as of v1.4".** Version-tagged is more durable than calendar-tagged and avoids the staleness drift the README hit between 1.4.0 and 1.4.1.

### Added
- **`SECURITY.md` "Privacy posture" section.** Explicit, prominent disclosure that the tool makes no network calls, generates no user identifier, stores all state locally, and only extracts structural metadata (token counts, model IDs, turn timestamps) from session JSONL files — never copying or transmitting conversation content. Addresses a reasonable concern users may have about a tool that monitors AI-coding sessions.

### Why
Pre-ship documentation audit of every user-facing claim ahead of the npm landing-page promo push. Findings: nothing was a behavior bug, but several prose claims didn't reconcile with the code or with each other. v1.4.2 brings every claim into alignment with the implementation. No behavior change — same dashboard, same hooks, same wire format. Just claims that hold up under scrutiny.

## [1.4.1] — 2026-05-18

### Fixed
- **README dashboard examples updated to match the polished v1.4 output.** The PNG screenshot was refreshed in 1.4.0 but several text code-fences in the README still showed the pre-polish layout (multi-line `WHAT TO HANDOFF` widget, duplicated `[DRIFT]` zone tag on the multiplier line, `12 pages` overlay on the context line, `write handoff → /clear → reload with plan` step phrasing). Every example fence and explanatory paragraph now matches the actual dashboard output, including the new dual-signal phase banner (`fill N% (overhead M%)`), the single-canonical zone tag location, and the new `HANDOFF SECTIONS` section header.
- **"Which session is being watched?" example header** updated to show the new two-line clean form (`agent-token-meter · 6cfb4866` instead of the truncated encoded path).
- **Startup-slide table** updated — the `watching: <project> · <id>` row was removed in 1.4.0 (header line 2 now carries that signal) but the docs table still listed it.
- **`SESSION` explanation** now documents the `output` ratio line (added in 1.4.0) and removes the reference to a `last` field that was never in that section.

### Security
- **`.github/dependabot.yml` added.** Weekly schedule on `github-actions` ecosystem — opens a PR whenever a pinned-by-SHA Action has a newer release. Keeps the supply-chain hardening fresh without manual maintenance burden. The PR updates both the SHA and the inline version comment in a single diff, so reviewers see exactly what changed.

## [1.4.0] — 2026-05-18

### Added
- **`AGENT-PROTOCOL.md`** — bundled agent-facing protocol document specifying the handoff file schema (7 sections), filename convention (`./handoff-{shortId}.md`), exact request-to-clear phrasing, post-compaction fallback procedure, fresh-session bootstrap protocol, and handoff-vs-memory decision rubric. Installed into projects via the new `--install-protocol` flag; auto-loaded by the agent through `CLAUDE.md` `@import`.
- **`protocol.mjs`** — new module providing `emitProtocol()`, `installProtocol()`, `uninstallProtocol()` with atomic write semantics and idempotent install.
- **`--emit-agent-protocol`, `--install-protocol`, `--uninstall-protocol` CLI flags.** Combined setup: `npx agent-token-meter --install-hooks --install-protocol`.
- **Multi-event hook registration.** `--install-hooks` now registers handlers for `PostToolUse`, `SessionStart`, and `PostCompact` — not just `PostToolUse`. The hook script dispatches on `payload.hook_event_name`.
- **`SessionStart` bootstrap nudge.** When a new session starts in a project containing a recent `./handoff-*.md`, the hook emits a one-line read-this-first reminder. Fires once per session.
- **`PostCompact` explicit nudge.** When Claude Code fires the explicit compaction event, the hook emits an immediate fresh-handoff instruction. Suppresses the legacy heuristic detection for 60s to prevent double-firing.
- **`CREDITS.md`** with full citations for Gary Capps' *The Hidden Constraint in LLM Systems* (May 2026), Liu et al. 2023 (*Lost in the Middle*, arXiv 2307.03172), Hsieh et al. 2024 (*RULER*, arXiv 2404.06654), Modarressi et al. 2025 (*NoLiMa*, arXiv 2502.05167), and an acknowledgment of Anthropic's platform prior art (Claude Code, session JSONL format, hook architecture, prompt caching).
- **`the-hidden-constraint.md`** shipped as an official reference doc in the npm tarball with the author's permission.
- **Reasoning-zone bands** on the dashboard. The multiplier line now carries a `[SHARP]`, `[SOFTENING]`, `[DRIFT]`, `[TOLERANCE]`, or `[OVER]` tag derived from `contextPct`, displayed alongside the cost-based multiplier color.
- **Two-axis phase banner.** Now reads `fill N% (overhead M%)` — exposing both the budget signal (fill) and the drift signal (overhead) without conflating them.
- **Page-equivalent on the context line.** Shows e.g. `78% · 12 pages [DRIFT]`. Conversion: ~750 tokens/page (mixed prose+code midpoint).
- **Visual context bar** with zone-tinted fill (30 cells).
- **`WHAT TO HANDOFF` widget** appears during HANDOFF/RESET phases — a 5-item primer mirroring the protocol's handoff schema.
- **Post-compaction annotation** in the NOW section (`NOW (post-compaction × 1)`).
- **Output-vs-input ratio** in the SESSION section with a verbose-agent warning when output exceeds 3% of inputs — surfaces Gary Capps' "generated output competes for the same reasoning budget" insight.
- **README "Agent Protocol" section** explaining the contract, install commands, and end-to-end workflow.
- **README "Composing with Claude Code's memory system" appendix** documenting the architectural parallel (within-session handoff vs. across-session memory).

### Changed
- **Thesis-aligned copy across every customer-facing surface.** The 50/75/90% thresholds are framed as *reasoning-degradation milestones*, not budget alarms. Curation is still cheap at 50%, drift sets in at 75%, attention is degraded and cost is biting at 90%.
- **Hook nudge strings include the concrete handoff filename** via `${shortId}` substitution. The 90% nudge contains the literal phrase the agent should say to the user.
- **Compaction nudge** now reads *"Position bias reset to fresh; thresholds re-armed. Write a fresh ./handoff-${shortId}.md now — the auto-summary is a fallback, not a substitute."*
- **README "Why short sessions win" section** rewritten around the *retrieval reach vs. active reasoning workspace* distinction (from Gary Capps' article). Adds the *output competes for budget* and *dependency density matters* points. Closes with the *competence zone vs. tolerance zone* heuristic.
- **`IF YOU CLEAR` section** now triggers on cost savings **OR** reasoning-zone DRIFT/TOLERANCE — surfaces guidance even when cost is low but attention is degraded. When attention-triggered, adds a `reasoning DRIFT → SHARP` line.
- **`installHooks` / `uninstallHooks`** sweep all registered event keys, not just one.
- **npm package description** rewritten to lead with the value prop instead of a feature list.

### Security
- **GitHub Actions pinned to commit SHAs.** `ci.yml` and `publish.yml` now reference `actions/checkout` and `actions/setup-node` by their full commit SHA with a version-tag comment, instead of by mutable tag. A compromise of an upstream Action's tag cannot reach our publish workflow until we explicitly review and update the pinned SHA.
- **Signed git tags for releases.** `CONTRIBUTING.md` documents `npm version --sign-git-tag` as the release-cut convention. Combined with the existing SLSA provenance attestation, releases now have an end-to-end signed chain: maintainer-signed tag → CI verifies tag matches `package.json` → npm publish provenance ties the tarball to the commit. Consumers verify both via `git tag --verify v<x.y.z>` and `npm audit signatures`.
- **`CODEOWNERS` file added** at `.github/CODEOWNERS` — gives reviewers and supply-chain scanners a verifiable maintainer signal.
- **`SECURITY.md` expanded** to enumerate every filesystem path the tool reads or writes, with the trigger flag for each write. Out-of-scope writes are now an explicit security bug. The supply-chain hardening section documents the SHA-pin / signed-tag / provenance chain end-to-end.

### Why
Two threads converged: (1) sharpening the public framing around quadratic cumulative cost and U-shaped attention reasoning degradation, and (2) closing the gap between *agent-readable signal* (already good in v1.3) and *agent-driven workflow* (was missing — agent had to improvise the handoff). v1.4 makes the "AGENT" in agent-token-meter fully earned: the agent receives a protocol document, knows the schema and filename, knows what to tell the human at 90%, and the next session bootstraps from the handoff automatically.

The supply-chain hardening is independent of the agent-protocol work but shipped in the same release because it's small and load-bearing for trust: Socket.dev's supply-chain score, `npm audit signatures` verification, and downstream consumers all benefit from the tighter posture.

No behavior change to read-only telemetry, session-file watching, or the cost-multiplier math. Threshold percentages and compaction-detection heuristics unchanged.

## [1.2.5] — 2026-04-22

### Added
- `SECURITY.md` with a private-disclosure policy, scope statement, verification instructions (`npm audit signatures`), and a summary of the package's security posture.
- README badges for monthly downloads, signed provenance (linking to `SECURITY.md#verifying-a-release`), and zero dependencies.

## [1.2.4] — 2026-04-22

### Security
- **Atomic settings.json writes.** Hook install/uninstall now writes to `settings.json.tmp` and renames into place, preventing concurrent-write clobbering if Claude Code is editing `~/.claude/settings.json` at the same moment. Same-directory rename is atomic on both Windows and POSIX.
- **Exact-path hook matching.** Install/uninstall now identifies token-meter entries by the installed hook filename (`token-meter-hook.mjs`) instead of a loose `"token-meter"` substring match. Closes a silent-deletion edge case where an unrelated user hook containing the string "token-meter" could be removed on uninstall.

### Infrastructure
- **Publish via GitHub Actions with SLSA provenance.** Releases now trigger on a `v*` tag push; the `publish.yml` workflow authenticates via a repo secret and calls `npm publish --provenance`, attaching a signed attestation tying each tarball to its source commit. Consumers can verify via `npm audit signatures`. No npm tokens ever touch local machines, chat, or documentation during a release. See `CONTRIBUTING.md` for the one-time setup.

### Changed
- `VERSION` now reads from `package.json` at runtime instead of being a separately-maintained constant — single source of truth, no drift.

## [1.2.3] — 2026-04-22

### Documentation
- README documents the 1.2.2 session-rollover hint: new row in the startup-slides table and a dedicated "Session rollovers" subsection explaining when the slide fires, why the meter reports per-segment instead of aggregating across `.jsonl` files, and how to pivot between segments via `--sessions` / `--session` / `--all`.

## [1.2.2] — 2026-04-22

### Added
- Session-rollover hint. When Claude Code opens a fresh `.jsonl` on `/resume` or a new `claude` invocation in the same cwd, the meter now surfaces a startup slide like `new session segment · prior fa7a76de (2.8MB, 26m ago) · metrics cover this segment only` whenever the current file has ≤5 user turns and a substantial prior `.jsonl` exists in the same project dir. Prevents a long, rolled-over conversation from reading as a short one.

## [1.2.1] — 2026-04-20

### Fixed
- Header no longer overflows the 60-char UI width. Split into two lines: agent identity on line 1, project directory + short session id on line 2.
- Dashboard no longer duplicates into terminal scrollback on refresh. Switched to the alt-screen buffer (`\x1b[?1049h`) — the same technique `vim` and `less` use. Exiting the meter cleanly restores your original terminal contents.

## [1.2.0] — 2026-04-20

### Changed
- **Default session scope is now the current working directory.** Launching the meter in terminal A only watches sessions for that project, never a newer one from terminal B in a different repo. Auto-follow still switches between sessions, but only inside the same project. Use `--all-projects` to restore the pre-1.2 machine-wide behavior.
- Dashboard header now shows the Claude Code project directory alongside the short session id — the primary signal for matching the numbers to a specific terminal by eye.
- Startup notice replaced with a slide queue: 2–4 slides (each ~4–5s) explaining scope, follow mode, and escape hatches. Rendered at the bottom so the numbers above never shift when slides fade.

### Added
- `--all-projects` flag to watch any session machine-wide.
- Parent-watchdog: the meter polls `process.ppid` every 5 seconds and self-exits when the launching shell dies. Fixes the Windows orphan-process leak where killing the `npx` wrapper left the grandchild `node.exe` running forever.
- Fallback notice when launched from a directory with no matching Claude Code project: falls back to global scan and warns.

### Fixed
- Multiplier in `--sessions` output now displays as `×8.1` instead of the raw float `×8.148956277621814`.

## [1.1.0] — 2026-04-20

### Added
- Per-call cost multiplier (`×N.N`) as the dashboard headline — shows how much each call costs vs. a fresh-conversation call.
- Phase banner fusing workflow phase, context fill %, and compaction ETA into one scannable sentence.
- Support for Opus 4.7 pricing and context limits.
- Multi-instance auto-follow: the meter switches to whichever Claude Code session is most recently active when the current one has been idle for 30+ seconds.

### Changed
- Decluttered dashboard layout into three labeled zones: NOW, IF YOU CLEAR, SESSION.
- Multiplier now uses one decimal place for sub-integer precision.

## [1.0.1] — 2026-04-08

### Fixed
- Corrected npm README screenshot path.
- Normalized `package.json`.

## [1.0.0] — 2026-04

### Added
- Initial public release. Live burn-rate dashboard, cost tracking, multi-provider comparison, compaction detection, threshold hooks.
- Support for Claude Code via `~/.claude/projects/` JSONL logs.
- `--install-hooks` / `--uninstall-hooks` for in-context threshold nudges at 50/75/90%.

[1.4.4]: https://github.com/albertdobmeyer/agent-token-meter/releases/tag/v1.4.4
[1.4.3]: https://github.com/albertdobmeyer/agent-token-meter/releases/tag/v1.4.3
[1.4.2]: https://github.com/albertdobmeyer/agent-token-meter/releases/tag/v1.4.2
[1.4.1]: https://github.com/albertdobmeyer/agent-token-meter/releases/tag/v1.4.1
[1.4.0]: https://github.com/albertdobmeyer/agent-token-meter/releases/tag/v1.4.0
[1.2.5]: https://github.com/albertdobmeyer/agent-token-meter/releases/tag/v1.2.5
[1.2.4]: https://github.com/albertdobmeyer/agent-token-meter/releases/tag/v1.2.4
[1.2.3]: https://github.com/albertdobmeyer/agent-token-meter/releases/tag/v1.2.3
[1.2.2]: https://github.com/albertdobmeyer/agent-token-meter/releases/tag/v1.2.2
[1.2.1]: https://github.com/albertdobmeyer/agent-token-meter/releases/tag/v1.2.1
[1.2.0]: https://github.com/albertdobmeyer/agent-token-meter/releases/tag/v1.2.0
[1.1.0]: https://github.com/albertdobmeyer/agent-token-meter/releases/tag/v1.1.0
[1.0.1]: https://github.com/albertdobmeyer/agent-token-meter/releases/tag/v1.0.1
[1.0.0]: https://www.npmjs.com/package/agent-token-meter/v/1.0.0
