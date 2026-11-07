FROM rust:1-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends jq && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
ENV CARGO_NET_GIT_FETCH_WITH_CLI=true
RUN set -eu; \
    cargo build --release --locked -p madar-server; \
    cp target/release/madar-server /madar-server; \
    nuah="$(cargo metadata --locked --format-version 1 | jq -r '.packages[] | select(.name=="nuah-host") | .manifest_path' | xargs dirname)/../.."; \
    mkdir -p /faces && cp -r "$nuah/faces/console" "$nuah/faces/setup" /faces/

FROM debian:bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/addaui/madar"
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
