# Nu'ah (نواه)

A plugin-first core framework. This repository holds the first test of the idea: a Madar-style task
manager built as **one core and two faces**. Nothing here is a product; it exists to find out where the
design is wrong before more apps are built on it.

Documentation (PRD, ADRs, specs, plans, tasks, glossary) lives in docmd, not in this repo:
https://docs.addaui.com/nuah/ . Working rules for contributors and agents are in `the contributor notes`.

## Layout

| Path | What it is |
|---|---|
| `crates/nuah-kernel` | Kernel: manifests, resolver, ports, hooks, events (Pulse log), capability broker, call pipeline. Knows nothing about tasks. |
| `crates/nuah-adapters` | Adapters for the ports: memory and SQLite db, local and token auth, allow-all and role policy, system and fixed clock/ids. Includes the db conformance suite. |
| `crates/nuah-madar` | The distribution: tasks, audit, quota, prefs, export, theme plugins, and the profiles. |
| `crates/nuah-server` | HTTP projection of the Link, Pulse over SSE, static hosting for the web face. |
| `crates/nuah-client` | Face-side Link: `InProcess` (coupled) and `Http` (decoupled) behind one trait. |
| `crates/nuah-cli` | Face 2: the `madar` command line. |
| `faces/web` | Face 1: web board, vanilla JS, no build step. |
| `profiles/server.json` | Example server profile (demo tokens only). |

## Run it

Needs Rust (`rustup`, stable).

```bash
cargo test                      # kernel, adapter conformance, domain, HTTP and parity tests
cargo build

# Face 2, coupled: the core runs inside the command, data in one SQLite file
target/debug/madar --db /tmp/madar.db project add Home
target/debug/madar --db /tmp/madar.db add Home "Fix the tap" -p 8

# Face 1 + face 2 against a hosted core
target/debug/nuah-server --profile profiles/server.json --web faces/web
#   open http://127.0.0.1:8787/  and sign in with token: demo-admin
target/debug/madar --remote http://127.0.0.1:8787 --token demo-admin list
target/debug/madar --remote http://127.0.0.1:8787 --token demo-admin watch
```

The tokens in `profiles/server.json` are demo values. Do not expose that profile to a network.
