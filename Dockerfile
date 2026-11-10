FROM rust:1-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends jq && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
ENV CARGO_NET_GIT_FETCH_WITH_CLI=true
RUN set -eu; \
    cargo build --release --locked -p madar; \
    cp target/release/madar /madar; \
    nuah="$(cargo metadata --locked --format-version 1 | jq -r '.packages[] | select(.name=="nuah-shell") | .manifest_path' | xargs dirname)/../.."; \
    mkdir -p /faces && cp -r "$nuah/faces/nuah" /faces/nuah

FROM debian:bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/addaui/madar"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home-dir /data madar && mkdir /data && chown madar /data
COPY --from=build /madar /usr/local/bin/madar
COPY --from=build /faces /app/faces
COPY faces/madar /app/faces/madar
# The identity file (nuah.json) and the database are in /data; the Faces are ./faces/<scope>/<name> next to the program.
ENV NUAH_LISTEN=0.0.0.0:3000 NUAH_HOME=/data
WORKDIR /app
USER madar
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["madar", "healthcheck"]
STOPSIGNAL SIGTERM
ENTRYPOINT ["madar"]
CMD ["serve"]
