# Madar (مدار)

A task manager: projects, tasks, pages and notes, live updates, an editor that never traps you, a customizable look.
It is a **product built on [Nu'ah](https://github.com/addaui/nuah)**: Madar is plugins, a web face and a command line
around Nu'ah's kernel. It never edits Nu'ah; Nu'ah is a dependency pinned by tag in `Cargo.toml`.

Documentation (PRD, ADRs, specs, plans, tasks, glossary) lives in docmd, not here: https://docs.addaui.com/nuah/ .
Working rules for contributors and agents are in `the contributor notes`.

## Layout

| Path | What it is |
|---|---|
| `crates/madar-core` | Madar's plugins (projects, tasks, pages, discussion, appearance, files, search, previews, …), its catalog and Profiles. |
| `crates/madar-server` | `madar-server`: Madar's `main` on the Nu'ah host, plus Madar's own routes for the `http` Projection (file downloads, link previews). |
| `crates/madar-cli` | The `madar` command line, over HTTP or directly on a database file. |
| `faces/web` | The web board (vanilla JS, no build). The one built file is the rich-text editor, `faces/web/vendor/editor.js`. |
| `faces/editor-src` | Source of that editor (Tiptap on ProseMirror). Rebuild with `bun install && bun run build`; the built file is committed. |
| `prototypes/design-lab.html` | The throwaway design lab the customizer's presets came from. |
| `deploy/compose.yml` | Running the image on a server box. |

## Develop

```bash
cargo test --workspace
cargo run -p madar-server -- serve --db madar.db --accounts accounts.json --web faces/web
```

`accounts.json` is `[{"name": "...", "password_hash": "...", "roles": ["admin"]}]`; make a hash with
`madar-server hash-password < password.txt`. It stays outside git.

To try a Nu'ah change before it has a tag, add a local, uncommitted `.cargo/config.toml`:

```toml
[patch."https://github.com/addaui/nuah"]
nuah-kernel = { path = "../nuah/crates/nuah-kernel" }
nuah-adapters = { path = "../nuah/crates/nuah-adapters" }
nuah-http = { path = "../nuah/crates/nuah-http" }
nuah-host = { path = "../nuah/crates/nuah-host" }
```

## Release and deploy

- Every push to `main` runs the tests and builds `ghcr.io/addaui/madar` (tags `latest` and the short commit); a `vX.Y.Z` tag adds that version.
- When Nu'ah publishes a tag, the `nuah-update` workflow opens a pull request that moves the pin. Merging it deploys the update.
- The image holds the binary and faces only. Data lives in the `/data` volume (`madar.db`, `accounts.json`); settings come from environment variables:

| Variable | Meaning |
|---|---|
| `NUAH_LISTEN` | address inside the container, default `0.0.0.0:3000` |
| `NUAH_ALLOW_HOSTS` | host names it answers to behind a proxy, comma separated |
| `NUAH_SECURE_COOKIE` | `true` when the proxy terminates TLS |
| `NUAH_WITH` | product switches; `previews` turns link previews on |
| `NUAH_PROFILE` | a Profile file instead of `--db`/`--accounts` (what the setup wizard saves) |

First run on a server:

```bash
mkdir -p data && docker run --rm -i ghcr.io/addaui/madar hash-password <<< 'a long password'   # paste the hash into data/accounts.json
docker compose -f deploy/compose.yml up -d
```

The container stops cleanly on `docker stop` (SIGTERM). Reads use a pool of SQLite connections (one per core, 2 to 16;
`readers` in the `db-sqlite` settings) and the server uses every core.

### Repository secrets (GitHub)

- `NUAH_READ_TOKEN`: only if the Nu'ah repository is private: a fine-grained token with read access to it.
- `NUAH_UPDATE_TOKEN` (optional): lets the update pull request trigger the tests; without it, run the `ci` workflow on that branch by hand.
