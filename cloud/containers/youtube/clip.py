"""Cut one section of a YouTube video to an H.264 MP4.

Usage: clip.py <video_id> <start> <end> <work_dir>

Prints exactly one JSON line on stdout and exits 0 either way; the Worker reads the
JSON, never the exit status. The Worker has already validated every argument, and
they are validated again here because this file builds command lines from them.
"""
import json
import os
import re
import signal
import subprocess
import sys

VIDEO_ID = re.compile(r'^[A-Za-z0-9_-]{11}$')
SECONDS = re.compile(r'^\d{1,6}\.\d$')


def done(**fields):
    print(json.dumps(fields), flush=True)
    sys.exit(0)


def fail(code, detail='', reason=None):
    done(ok=False, code=code, detail=str(detail)[-500:], **({'reason': reason} if reason else {}))


def classify(message):
    """yt-dlp reports refusals as text; map the ones a person can act on."""
    text = message.lower()
    if 'not a bot' in text or 'http error 429' in text or 'proxy' in text or 'unable to connect' in text:
        return 'refused', None
    if 'private video' in text:
        return 'unavailable', 'private'
    if 'members' in text or 'join this channel' in text:
        return 'unavailable', 'members'
    if 'confirm your age' in text or 'age-restricted' in text or 'inappropriate for some users' in text:
        return 'unavailable', 'age'
    if 'live event' in text or 'premiere' in text or 'is live' in text:
        return 'unavailable', 'live'
    if 'video unavailable' in text or 'has been removed' in text or 'not available' in text and 'format' not in text:
        return 'unavailable', 'removed'
    if 'requested format is not available' in text:
        return 'no_720p', None
    return 'failed', None


def stop(signum, frame):
    # exec().kill() reaches only this process; take yt-dlp and ffmpeg down with it.
    os.killpg(0, signal.SIGKILL)


def main():
    try:
        os.setpgrp()
    except PermissionError:
        pass  # already a process-group leader (e.g. PID 1 under `docker run`); killpg(0) still covers it
    signal.signal(signal.SIGTERM, stop)
    if len(sys.argv) != 5:
        fail('invalid', 'expected 4 arguments')
    video_id, start, end, work = sys.argv[1:5]
    if not VIDEO_ID.match(video_id) or not SECONDS.match(start) or not SECONDS.match(end) or not re.match(r'^/tmp/clips/[A-Za-z0-9-]+$', work):
        fail('invalid', 'malformed arguments')
    start_s, end_s = float(start), float(end)
    os.makedirs(work, exist_ok=True)

    import yt_dlp
    from yt_dlp.utils import DownloadError, download_range_func

    base = {'quiet': True, 'no_warnings': True, 'noprogress': True, 'socket_timeout': 20,
            'proxy': os.environ.get('YOUTUBE_PROXY_URL') or None}
    try:
        with yt_dlp.YoutubeDL(base) as ydl:
            info = ydl.extract_info(f'https://www.youtube.com/watch?v={video_id}', download=False)
    except DownloadError as error:
        code, reason = classify(str(error))
        fail(code, error, reason)
    if info.get('is_live') or info.get('live_status') in ('is_live', 'is_upcoming', 'post_live'):
        fail('unavailable', 'live', 'live')
    if (info.get('age_limit') or 0) >= 18:
        fail('unavailable', 'age-restricted', 'age')
    duration = info.get('duration') or 0
    if end_s > duration + 0.05:
        fail('range', f'video is {duration} seconds')

    options = {**base,
               # Short edge >= 720 px (Seedance needs >= 407,696 source pixels), closest to 1080p.
               'format': 'bv*[height>=720][width>=720]+ba/b[height>=720][width>=720]',
               'format_sort': ['res:1080'],
               'download_ranges': download_range_func(None, [(start_s, end_s)]),
               'force_keyframes_at_cuts': True,
               'outtmpl': os.path.join(work, 'source.%(ext)s'),
               'merge_output_format': 'mkv'}
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            ydl.process_ie_result(info, download=True)
    except DownloadError as error:
        code, reason = classify(str(error))
        fail(code, error, reason)
    sources = [name for name in os.listdir(work) if name.startswith('source.')]
    if not sources:
        fail('failed', 'no section was downloaded')

    out = os.path.join(work, 'clip.mp4')
    # -t makes the length exact: a 30.0 s section must not come out 30.04 s against a 30 s limit.
    encode = subprocess.run(
        ['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', os.path.join(work, sources[0]),
         '-t', f'{end_s - start_s:.1f}', '-map', '0:v:0', '-map', '0:a:0?',
         '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-maxrate', '8M', '-bufsize', '16M',
         '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out],
        capture_output=True, text=True)
    if encode.returncode != 0:
        fail('failed', encode.stderr)
    probe = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', out],
        capture_output=True, text=True)
    try:
        data = json.loads(probe.stdout)
        stream = data['streams'][0]
        done(ok=True, path=out, bytes=os.path.getsize(out), width=int(stream['width']),
             height=int(stream['height']), duration=round(float(data['format']['duration']), 2))
    except (KeyError, IndexError, ValueError) as error:
        fail('failed', f'unreadable output: {error}')


if __name__ == '__main__':
    main()
