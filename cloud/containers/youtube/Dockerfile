# The YouTube clip importer, run by Cloudflare Containers (linux/amd64). The Durable
# Object in cloud/src/youtube/importer.ts execs clip.py inside a running instance,
# so the entrypoint only has to keep the instance alive.
#
# yt-dlp breaks whenever YouTube changes its player. Rebuild with a current
# YTDLP_VERSION when imports start failing with `failed`/`no_720p` on public videos;
# see docs/deployment.md.
ARG FFMPEG_TAG=9.0.2
ARG DENO_TAG=bin-2.9.7
FROM mwader/static-ffmpeg:${FFMPEG_TAG} AS ffmpeg
# yt-dlp needs a JavaScript runtime to solve YouTube's player challenges; without one
# most formats disappear and every import reads as "no 720p version".
FROM denoland/deno:${DENO_TAG} AS deno

FROM python:3.13-slim-bookworm
ARG YTDLP_VERSION=2026.8.19
COPY --from=ffmpeg /ffmpeg /ffprobe /usr/local/bin/
COPY --from=deno /deno /usr/local/bin/deno
RUN pip install --no-cache-dir "yt-dlp[default]==${YTDLP_VERSION}"
COPY clip.py /app/clip.py
# Nothing listens here: the Durable Object only exec()s clip.py. Wrangler's local dev
# refuses an image that exposes no port, so declare one.
EXPOSE 8080
CMD ["sleep", "infinity"]
