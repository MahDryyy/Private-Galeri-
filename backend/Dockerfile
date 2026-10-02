# syntax=docker/dockerfile:1
FROM golang:1.23-bookworm AS build
WORKDIR /src
COPY go.mod ./
COPY . .
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -o /out/server ./cmd/server

FROM debian:bookworm-slim
RUN apt-get update \
      && apt-get install -y --no-install-recommends ca-certificates ffmpeg curl yt-dlp \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data/app /data/cache
WORKDIR /app
COPY --from=build /out/server /app/server
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8080/health || exit 1
ENTRYPOINT ["/app/server"]
