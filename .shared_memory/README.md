# Shared Memory

This folder is for durable project context that should survive across work sessions.

Keep these notes high signal. Update them whenever code changes, fixes, migrations, or investigations create context that would save future time.

Rules for future updates:

- Do not store plaintext secrets, private keys, tokens, or copied config values.
- If a file contains a secret, note the file and the problem, but redact the value.
- Prefer concise facts over long transcripts.
- After code changes or fixes, update `implementation_state.md`, `risk_register.md`, or `change_log.md` as appropriate.
- Shell commands in this repo should be run through `rtk`, per `/root/.codex/RTK.md`.

Artifacts:

- `repo_overview.md`: architecture, important directories, and document map.
- `implementation_state.md`: current implementation facts discovered from docs and code.
- `risk_register.md`: known risks and things to check before release.
- `commands.md`: useful local commands and verification notes.
- `change_log.md`: shared-memory update log.
