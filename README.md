# Nu'ah (نواه)

A plugin-first core framework: a small kernel runs plugins, and apps are made by choosing and
configuring them. Madar, a task manager, is the app built on it to test the design.

Documentation (PRD, ADRs, specs, plans, tasks, glossary) lives in docmd, not in this repo:
https://docs.addaui.com/nuah/ . Working rules for contributors and agents are in `the contributor notes`.

## Layout

| Path | What it is |
|---|---|
| `crates/nuah-kernel` | v2 kernel: manifests, resolver, data Port, call pipeline, Pulse, Listeners. Knows nothing about tasks. |
| `crates/nuah-adapters` | Adapters for the Ports (memory and SQLite db, auth, policy, clock, ids) and the db conformance suite. |
| `crates/nuah-madar` | Madar v2 as plugins: projects, tasks, discussion, audit, quota, prefs, export, notify. |
| `spike/` | The first version (with server, CLI and web faces). Reference only; deleted when v2 reaches parity. |

v2 has no server or faces yet; see https://docs.addaui.com/nuah/plans/v2-status/ for what exists.

## Run it

Needs Rust (`rustup`, stable).

```bash
cargo test --workspace            # v2
cd spike && cargo test --workspace   # the spike, which also has the runnable server and faces
```
