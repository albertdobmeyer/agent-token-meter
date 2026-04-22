# Changelog

All notable changes to **agent-token-meter** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.2.3]: https://github.com/albertdobmeyer/agent-token-meter/releases/tag/v1.2.3
[1.2.2]: https://github.com/albertdobmeyer/agent-token-meter/releases/tag/v1.2.2
[1.2.1]: https://github.com/albertdobmeyer/agent-token-meter/releases/tag/v1.2.1
[1.2.0]: https://github.com/albertdobmeyer/agent-token-meter/releases/tag/v1.2.0
[1.1.0]: https://github.com/albertdobmeyer/agent-token-meter/releases/tag/v1.1.0
[1.0.1]: https://github.com/albertdobmeyer/agent-token-meter/releases/tag/v1.0.1
[1.0.0]: https://www.npmjs.com/package/agent-token-meter/v/1.0.0
