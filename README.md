# Madar (مدار)

Task manager: projects, tasks, pages, live updates. An open-source application built on [Nuah](https://github.com/addaui/nuah). Self-hosting is a first-class way to run it, and an official hosted service is planned.

## Run with Docker

Requirements for a minimal deployment:

- a Linux box (amd64) with Docker 24+ and the Compose plugin
- 1 vCPU, 256 MB RAM, 1 GB of disk for the image and a small database
- a domain and a reverse proxy for TLS (Nginx Proxy Manager, Caddy, Traefik), or use it on a LAN without TLS
- outbound internet only for link previews and pulling the image

Steps:

```bash
mkdir madar && cd madar && mkdir data && sudo chown 10001 data
curl -O https://raw.githubusercontent.com/addaui/madar/main/deploy/compose.yml
```

Replace `madar.example.com` in `compose.yml` with the name your proxy serves, then:

```bash
docker compose up -d
docker compose logs -f
```

The first start has no `data/nuah.json`, so it runs a setup page on port 3000 and prints a setup code in the log. Open the page, type the code and answer the questions (name, storage, sign-in, features); the first administrator is created there. When you save, Madar starts on its own. Point the proxy at `127.0.0.1:3000`.

Everything it runs is in `data/nuah.json`: the plugins that are on, their settings and what they are allowed to do. Sign in, open `/faces/nuah/console/` and use "Plugins and settings" to change it; the change takes effect after a restart (a button there). A setting can read an environment variable instead of holding a value: `{"$env": "NAME"}`.

Locked out: stop the container, then `docker compose run --rm madar reset-password NAME` (reads the new password on stdin).

Update: `docker compose pull && docker compose up -d`. Backup: stop the container and copy `data/`.

| Variable | Meaning |
|---|---|
| `NUAH_HOME` | the folder with `nuah.json` (`/data` in the image) |
| `NUAH_LISTEN` | address inside the container, default `0.0.0.0:3000` |
| `NUAH_ALLOW_HOSTS` | host names for the setup page, comma separated |
| `NUAH_FACES` | where the Faces are (`/app/faces` in the image) |
| `NUAH_LOG_LEVEL` | `error`, `warn`, `info`, `debug`, `trace` |

Health: `GET /healthz` (alive) and `GET /readyz` (can read its data).

## Develop

```bash
cargo test --workspace
cargo run -p madar -- serve   # setup runs first; the Faces are looked for in ./faces/nuah and ./faces/madar
```

## Layout

- `crates/madar-plugins`: the plugins
- `crates/madar`: the program (only `main`)
- `crates/madar-cli`: the `madar-cli` command
- `faces/madar/web`: the web board (the console and the setup page come from Nuah: copy its `faces/nuah` to `faces/nuah` for a run from source)
- `faces/editor-src`: editor source
- `deploy`: compose file

## License

[Apache License 2.0](LICENSE). Self-host it, change it, fork it and use it commercially. Fonts and the bundled editor keep their own licenses, listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The names and logos are covered separately, see [TRADEMARK.md](TRADEMARK.md). To contribute, see [CONTRIBUTING.md](CONTRIBUTING.md).

## TODO

- [ ] docs
- [ ] arm64 image
- [ ] overview page
- [ ] light theme
- [ ] share by link
- [ ] backup command
- [ ] raw text mode
- [ ] otlp
