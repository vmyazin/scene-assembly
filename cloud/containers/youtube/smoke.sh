#!/usr/bin/env bash
# Builds the importer image and cuts a real section outside Cloudflare.
# Needs Docker running. If this machine's IP gets the bot check, export
# YOUTUBE_PROXY_URL first (the same value as the Worker secret).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
docker build --platform linux/amd64 -t scene-assembly-youtube "$here"
out="$(mktemp -d)"
# Big Buck Bunny, Blender Foundation, CC BY 3.0.
docker run --rm --platform linux/amd64 -e YOUTUBE_PROXY_URL="${YOUTUBE_PROXY_URL:-}" -v "$out:/tmp/clips" \
  scene-assembly-youtube python3 /app/clip.py aqz-KE-bpKQ 62.0 74.4 /tmp/clips/smoke | tee "$out/result.json"
python3 - "$out/result.json" "$out/smoke/clip.mp4" <<'PY'
import json, subprocess, sys
lines = [line for line in open(sys.argv[1]).read().splitlines() if line.strip()]
assert len(lines) == 1, lines
result = json.loads(lines[0])
assert result["ok"], result
probe = json.loads(subprocess.run(
    ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
     "stream=codec_name,width,height:format=duration", "-of", "json", sys.argv[2]],
    capture_output=True, text=True, check=True).stdout)
stream, duration = probe["streams"][0], float(probe["format"]["duration"])
assert stream["codec_name"] == "h264", stream
assert min(stream["width"], stream["height"]) >= 720, stream
assert abs(duration - 12.4) <= 0.1, duration
print(f"smoke ok: {stream['width']}x{stream['height']}, {duration:.2f} s")
PY
