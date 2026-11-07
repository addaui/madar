# syntax=docker/dockerfile:1.7
# Madar's image: the madar-server binary, the web face, and Nuah's generic faces (console, setup).
# Nuah is a git dependency pinned by tag in Cargo.toml; if it is a private repository pass a read token:
#   docker build --secret id=nuah_token,env=NUAH_READ_TOKEN .

FROM rust:1-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends jq && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
ENV CARGO_NET_GIT_FETCH_WITH_CLI=true
RUN --mount=type=secret,id=nuah_token \
    --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/src/target \
    set -eu; \
    if [ -s /run/secrets/nuah_token ]; then git config --global url."https://x-access-token:$(cat /run/secrets/nuah_token)@github.com/".insteadOf "https://github.com/"; fi; \
    cargo build --release --locked -p madar-server; \
    cp target/release/madar-server /madar-server; \
    nuah="$(cargo metadata --locked --format-version 1 | jq -r '.packages[] | select(.name=="nuah-host") | .manifest_path' | xargs dirname)/../.."; \
    mkdir -p /faces && cp -r "$nuah/faces/console" "$nuah/faces/setup" /faces/; \
    rm -f /root/.gitconfig

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home-dir /data madar && mkdir /data && chown madar /data
COPY --from=build /madar-server /usr/local/bin/madar-server
COPY --from=build /faces /app/faces
COPY faces/web /app/faces/web
ENV NUAH_LISTEN=0.0.0.0:3000
USER madar
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["madar-server", "healthcheck"]
STOPSIGNAL SIGTERM
ENTRYPOINT ["madar-server"]
CMD ["serve", "--db", "/data/madar.db", "--accounts", "/data/accounts.json", "--web", "/app/faces/web", "--console", "/app/faces/console"]
