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

Create the first account. The password hash is made by the image itself:

```bash
HASH=$(printf '%s' 'a long password' | docker run --rm -i ghcr.io/addaui/madar hash-password)
printf '[{"name": "admin", "password_hash": "%s", "roles": ["admin"]}]\n' "$HASH" > data/accounts.json
```

Replace `madar.example.com` in `NUAH_ALLOW_HOSTS` in `compose.yml` with the name your proxy serves, then:

```bash
docker compose up -d
docker compose logs -f
```

It listens on `127.0.0.1:3000`. Point the proxy there and open the site. On a LAN without a proxy, set
`NUAH_SECURE_COOKIE: "false"`, publish the port as `3000:3000` and add the box address to `NUAH_ALLOW_HOSTS`.

Update: `docker compose pull && docker compose up -d`. Backup: stop the container and copy `data/`.

| Variable | Meaning |
|---|---|
| `NUAH_ALLOW_HOSTS` | host names it answers to, comma separated |
| `NUAH_SECURE_COOKIE` | `true` behind a TLS proxy |
| `NUAH_WITH` | `previews`, `metrics` |
| `NUAH_LOG_LEVEL` | `error`, `warn`, `info`, `debug`, `trace` |
| `NUAH_LOG_FILE` | also write JSON lines to this file |
| `NUAH_LISTEN` | address inside the container, default `0.0.0.0:3000` |
| `NUAH_PROFILE` | a Profile file instead of `--db` and `--accounts` |
| `MADAR_METRICS_LISTEN` | with `metrics`; in a container use `0.0.0.0:9464` and publish the port |
| `MADAR_METRICS_TOKEN` | bearer token for the metrics endpoint, 8 characters or more |

Health: `GET /healthz` (alive) and `GET /readyz` (can read its data).

## Develop

```bash
cargo test --workspace
cargo run -p madar-server -- serve --db madar.db --accounts accounts.json --web faces/web
```

## Layout

- `crates/madar-core`: the plugins
- `crates/madar-server`: the server program
- `crates/madar-cli`: the `madar` command
- `faces/web`: the web board
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
