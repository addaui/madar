# Nu'ah (نواه)

A plugin-first core framework: a small kernel runs plugins, and apps are made by choosing and
configuring them. Madar, a task manager, is the app built on it to test the design.

Documentation (PRD, ADRs, specs, plans, tasks, glossary) lives in docmd, not in this repo:
https://docs.addaui.com/nuah/ . Working rules for contributors and agents are in `the contributor notes`.

## Layout

| Path | What it is |
|---|---|
| `crates/nuah-kernel` | The kernel: manifests, resolver, data Port, call pipeline, Pulse, Listeners, contract generator, setup helpers. Knows nothing about tasks. |
| `crates/nuah-adapters` | Adapters for the Ports (memory and SQLite db, auth, policy, clock, ids) and the db conformance suite. |
| `crates/nuah-madar` | Madar as plugins: projects, tasks, discussion, audit, quota, prefs, export, notify, themes. |
| `crates/nuah-server` | HTTP and SSE server (`nuah-server serve`) and the setup mode (`nuah-server setup`). |
| `crates/nuah-cli` | The `madar` command line, over HTTP or directly on a database file. |
| `faces/web`, `faces/console`, `faces/setup` | The web board, the console generated from `describe`, and the setup wizard (vanilla JS, no build). The one built file is the rich-text editor, `faces/web/vendor/editor.js`. |
| `faces/editor-src` | Source of that editor (Tiptap on ProseMirror). Rebuild with `bun install && bun run build` inside it; the built file is committed. |

What exists and how it is proven: https://docs.addaui.com/nuah/plans/v2-status/

## Run it

Needs Rust (`rustup`, stable).

```bash
cargo test --workspace
nuah-server hash-password < password.txt          # make an accounts file outside the repo, see the docs
nuah-server serve --db madar.db --accounts accounts.json --web faces/web --console faces/console
nuah-server setup --profile profile.json --face faces/setup
```

Rebuilding the editor (only when `faces/editor-src` changes): `cd faces/editor-src && bun install && bun run build`.
