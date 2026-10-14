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


# Everything written to fd 1 (yt-dlp's ffmpeg downloader inherits it) goes to stderr;
# the result line is the only thing that reaches the real stdout.
REAL_STDOUT = os.dup(1)
os.dup2(2, 1)


def done(**fields):
    sys.stdout.flush()
    os.write(REAL_STDOUT, (json.dumps(fields) + '\n').encode())
    sys.exit(0)


def clean_title(value):
    """The video title is third-party text: no control characters, one line, at most 200 characters."""
    text = re.sub(r'[\x00-\x1f\x7f]', ' ', str(value or ''))
    return re.sub(r'\s+', ' ', text).strip()[:200]


def fail(code, detail='', reason=None):
    done(ok=False, code=code, detail=str(detail)[-500:], **({'reason': reason} if reason else {}))


def classify(message):
    """yt-dlp reports refusals as text; map the ones a person can act on."""
    text = message.lower()
    if ('not a bot' in text or 'http error 429' in text or 'unable to connect to proxy' in text
            or 'proxyerror' in text or 'tunnel connection failed' in text or 'unable to connect' in text):
        return 'refused', None
    if 'available in your country' in text or 'geo restrict' in text or 'geo-restrict' in text:
        return 'unavailable', 'removed'
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
    # YouTube reports whole seconds, so the real end can be up to a second past it. A
    # missing or zero duration is unknown, not "0 seconds": let the cut find the end.
    duration = info.get('duration') or 0
    if duration > 0 and end_s > duration + 1.0:
        fail('range', f'video is {duration} seconds')

    length = f'{end_s - start_s:.1f}'
    options = {**base,
               # Short edge >= 720 px (Seedance needs >= 407,696 source pixels), closest to 1080p.
               'format': 'bv*[height>=720][width>=720]+ba/b[height>=720][width>=720]',
               # SDR over HDR at the same size: the 8-bit H.264 output has no tone mapping,
               # so an HDR source would come out washed out.
               'format_sort': ['res:1080', 'hdr:sdr'],
               'download_ranges': download_range_func(None, [(start_s, end_s)]),
               # yt-dlp's ffmpeg seeks each input (-ss before -i) and, with this set,
               # re-encodes instead of stream-copying, so the cut starts on the exact frame.
               # That encode is the only one: these are its output settings.
               'force_keyframes_at_cuts': True,
               'external_downloader_args': {'ffmpeg_o': [
                   '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-maxrate', '8M', '-bufsize', '16M',
                   '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k']},
               'outtmpl': os.path.join(work, 'source.%(ext)s'),
               'merge_output_format': 'mp4'}
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            ydl.process_ie_result(info, download=True)
    except DownloadError as error:
        code, reason = classify(str(error))
        fail(code, error, reason)
    sources = [name for name in os.listdir(work) if name.startswith('source.') and not name.endswith('.part')]
    if not sources:
        fail('failed', 'no section was downloaded')
    source = os.path.join(work, sources[0])

    out = os.path.join(work, 'clip.mp4')
    # A stream copy, not a second encode: -t makes the length exact (a 30.0 s section must
    # not come out 30.04 s against a 30 s limit) and +faststart puts the index first.
    remux = subprocess.run(
        ['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', source, '-t', length,
         '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart', out],
        capture_output=True, text=True)
    if remux.returncode != 0:
        fail('failed', remux.stderr)
    probe = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', out],
        capture_output=True, text=True)
    try:
        data = json.loads(probe.stdout)
        stream = data['streams'][0]
        done(ok=True, path=out, bytes=os.path.getsize(out), width=int(stream['width']),
             height=int(stream['height']), duration=round(float(data['format']['duration']), 2),
             title=clean_title(info.get('title')))
    except (KeyError, IndexError, ValueError) as error:
        fail('failed', f'unreadable output: {error}')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:  # SystemExit (from done) is not an Exception
        fail('failed', repr(error))
