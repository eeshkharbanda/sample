#!/usr/bin/env python3
"""Fast, cheap transcription for any video/audio — tuned for Hindi-English (Hinglish) speech.

Pipeline:
  video file / URL -> ffmpeg (audio only, 16 kHz mono, small mp3)
  -> split at silences if too long -> transcribe chunks in parallel
  -> stitch timestamps -> .txt / .srt / .vtt / .json

Backends:
  groq   (default) Whisper large-v3 on Groq. Very fast, ~$0.11 per audio hour. Needs GROQ_API_KEY.
  local  faster-whisper on your own machine. Free and offline, but slow without a GPU.

Examples:
  python transcribe.py meeting.mp4
  python transcribe.py "https://youtu.be/xyz" --script roman
  python transcribe.py lecture.mkv --prompt "Satyug Today, Eesh, Kubernetes" --out ./transcripts
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, asdict
from pathlib import Path

GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_PRICE_PER_HOUR = {"whisper-large-v3": 0.111, "whisper-large-v3-turbo": 0.04}

# Whisper copies the style of the prompt, so the prompt decides the output script.
# Each preset: (language passed to Whisper, style prompt).
SCRIPT_PRESETS = {
    # Hindi words in Devanagari, English words stay in Latin letters. Most faithful to the audio.
    "mixed": ("hi", "तो आज हम बात करेंगे about the new project. यह बहुत important है, so let's start the meeting."),
    # Everything in Roman letters ("Hinglish" as typed on WhatsApp). Occasionally Whisper
    # translates a Hindi sentence into English instead of transliterating it.
    "roman": ("en", "Haan toh aaj hum baat karenge about the new project. Yeh bahut important hai, so let's start."),
    # Pure Devanagari, English words transliterated.
    "devanagari": ("hi", "तो आज हम नए प्रोजेक्ट के बारे में बात करेंगे। यह बहुत ज़रूरी है।"),
    # Let Whisper decide everything.
    "auto": (None, ""),
}

AUDIO_BITRATE = "48k"  # 16 kHz mono speech; ~0.36 MB per minute
MAX_UPLOAD_MB = 24  # Groq free tier caps uploads at 25 MB


@dataclass
class Segment:
    start: float
    end: float
    text: str


# ---------------------------------------------------------------- audio helpers

def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def require(binary: str) -> None:
    if not shutil.which(binary):
        sys.exit(f"error: '{binary}' not found on PATH. Install it first (e.g. `brew install {binary}` / `apt install {binary}`).")


def download(url: str, workdir: Path) -> Path:
    """Download only the audio track of a URL (YouTube, Drive, Instagram, ...) via yt-dlp."""
    print(f"↓ downloading audio from {url}")
    try:
        import yt_dlp
    except ImportError:
        sys.exit("error: URL input needs yt-dlp. Run `pip install yt-dlp`.")
    opts = {
        "format": "bestaudio/best",
        "outtmpl": str(workdir / "download.%(ext)s"),
        "quiet": True,
        "noprogress": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        return Path(ydl.prepare_filename(info))


def extract_audio(src: Path, dst: Path) -> None:
    """Strip video, downmix to 16 kHz mono — that's all Whisper uses, and it cuts upload size ~20x."""
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
         "-vn", "-ac", "1", "-ar", "16000", "-b:a", AUDIO_BITRATE, str(dst)])


def duration_of(path: Path) -> float:
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
               "-of", "default=nw=1:nk=1", str(path)]).stdout.strip()
    return float(out)


def silence_midpoints(path: Path) -> list[float]:
    """Midpoints of every pause >= 0.4 s — safe places to cut without slicing a word in half."""
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(path), "-af", "silencedetect=noise=-35dB:d=0.4", "-f", "null", "-"],
        capture_output=True, text=True)
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", proc.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", proc.stderr)]
    return [(s + e) / 2 for s, e in zip(starts, ends)]


def plan_chunks(total: float, chunk_len: float, silences: list[float], slack: float = 30.0) -> list[tuple[float, float]]:
    """Split [0, total] into ~chunk_len pieces, nudging each cut to the nearest pause within ±slack seconds."""
    if total <= chunk_len:
        return [(0.0, total)]
    cuts, target = [], chunk_len
    while target < total - slack:
        nearby = [s for s in silences if abs(s - target) <= slack and (not cuts or s > cuts[-1] + 1)]
        cut = min(nearby, key=lambda s: abs(s - target)) if nearby else target
        cuts.append(cut)
        target = cut + chunk_len
    bounds = [0.0, *cuts, total]
    return list(zip(bounds[:-1], bounds[1:]))


def cut(src: Path, start: float, end: float, dst: Path) -> None:
    run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{start:.3f}", "-to", f"{end:.3f}",
         "-i", str(src), "-c", "copy", str(dst)])


# ---------------------------------------------------------------- backends

def looks_hallucinated(seg: dict) -> bool:
    """Whisper invents text ('Thanks for watching!') over music/silence; its own confidence scores give it away."""
    return seg.get("no_speech_prob", 0) > 0.6 and seg.get("avg_logprob", 0) < -1.0


def transcribe_groq(path: Path, model: str, language: str | None, prompt: str) -> list[Segment]:
    import requests

    key = os.environ.get("GROQ_API_KEY")
    if not key:
        sys.exit("error: set GROQ_API_KEY (free key at https://console.groq.com/keys), or use --backend local.")
    data = {"model": model, "response_format": "verbose_json", "temperature": "0"}
    if language:
        data["language"] = language
    if prompt:
        data["prompt"] = prompt[:800]  # Whisper only looks at the last ~224 tokens anyway

    for attempt in range(5):
        with path.open("rb") as fh:
            resp = requests.post(GROQ_URL, headers={"Authorization": f"Bearer {key}"},
                                 data=data, files={"file": (path.name, fh)}, timeout=600)
        if resp.status_code == 429 or resp.status_code >= 500:
            wait = float(resp.headers.get("retry-after", 2 ** attempt * 2))
            print(f"  … {resp.status_code} from Groq, retrying in {wait:.0f}s")
            time.sleep(wait)
            continue
        if not resp.ok:
            sys.exit(f"error: Groq returned {resp.status_code}: {resp.text[:500]}")
        segs = resp.json().get("segments", [])
        return [Segment(s["start"], s["end"], s["text"].strip()) for s in segs if not looks_hallucinated(s)]
    sys.exit("error: Groq kept rate-limiting; try again later or lower --workers.")


_local_model = None


def transcribe_local(path: Path, model: str, language: str | None, prompt: str) -> list[Segment]:
    global _local_model
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.exit("error: local backend needs faster-whisper. Run `pip install faster-whisper`.")
    if _local_model is None:
        print(f"  loading local model '{model}' (first run downloads it)…")
        _local_model = WhisperModel(model, device="auto", compute_type="int8")
    segs, _ = _local_model.transcribe(str(path), language=language, initial_prompt=prompt or None,
                                      vad_filter=True, beam_size=5, temperature=0)
    return [Segment(s.start, s.end, s.text.strip()) for s in segs
            if not (s.no_speech_prob > 0.6 and s.avg_logprob < -1.0)]


# ---------------------------------------------------------------- output

def ts(seconds: float, sep: str) -> str:
    ms = round(seconds * 1000)
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02}{sep}{ms:03}"


def write_outputs(segments: list[Segment], base: Path, formats: set[str]) -> list[Path]:
    written = []
    if "txt" in formats:
        p = base.with_suffix(".txt")
        p.write_text("\n".join(f"[{ts(s.start, '.')[:8]}] {s.text}" for s in segments) + "\n", encoding="utf-8")
        written.append(p)
    if "srt" in formats:
        p = base.with_suffix(".srt")
        p.write_text("\n".join(f"{i}\n{ts(s.start, ',')} --> {ts(s.end, ',')}\n{s.text}\n"
                               for i, s in enumerate(segments, 1)), encoding="utf-8")
        written.append(p)
    if "vtt" in formats:
        p = base.with_suffix(".vtt")
        p.write_text("WEBVTT\n\n" + "\n".join(f"{ts(s.start, '.')} --> {ts(s.end, '.')}\n{s.text}\n"
                                              for s in segments), encoding="utf-8")
        written.append(p)
    if "json" in formats:
        p = base.with_suffix(".json")
        p.write_text(json.dumps([asdict(s) for s in segments], ensure_ascii=False, indent=2), encoding="utf-8")
        written.append(p)
    return written


# ---------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="video/audio file path or URL")
    ap.add_argument("--backend", choices=["groq", "local"], default="groq")
    ap.add_argument("--model", help="groq: whisper-large-v3 (default, best for Hindi) or whisper-large-v3-turbo "
                                    "(cheaper, a bit worse). local: large-v3, medium, small…")
    ap.add_argument("--script", choices=list(SCRIPT_PRESETS), default="mixed",
                    help="output script for Hindi parts (default: mixed = Devanagari Hindi + Latin English)")
    ap.add_argument("--language", help="override Whisper language code (hi, en, …)")
    ap.add_argument("--prompt", default="", help="names/jargon that appear in the audio, e.g. 'Satyug Today, Eesh'")
    ap.add_argument("--chunk-minutes", type=float, default=15, help="split long audio into pieces this long")
    ap.add_argument("--workers", type=int, default=4, help="chunks transcribed in parallel")
    ap.add_argument("--formats", default="txt,srt,json", help="comma list of txt,srt,vtt,json")
    ap.add_argument("--out", help="output directory (default: next to the input, or cwd for URLs)")
    ap.add_argument("--keep-audio", action="store_true", help="keep the extracted .mp3")
    args = ap.parse_args()

    require("ffmpeg")
    require("ffprobe")
    model = args.model or ("whisper-large-v3" if args.backend == "groq" else "large-v3")
    language, style = SCRIPT_PRESETS[args.script]
    language = args.language or language
    prompt = " ".join(p for p in (args.prompt, style) if p)  # vocab first; style last so it sets the tone
    backend = transcribe_groq if args.backend == "groq" else transcribe_local
    if args.backend == "groq" and not os.environ.get("GROQ_API_KEY"):
        sys.exit("error: set GROQ_API_KEY (free key at https://console.groq.com/keys), or use --backend local.")
    t0 = time.time()

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        is_url = re.match(r"^https?://", args.input) is not None
        src = download(args.input, tmp) if is_url else Path(args.input).expanduser()
        if not src.exists():
            sys.exit(f"error: {src} not found")
        stem = re.sub(r"[^\w\-]+", "_", src.stem if not is_url else "transcript")[:80]
        out_dir = Path(args.out) if args.out else (Path.cwd() if is_url else src.parent)
        out_dir.mkdir(parents=True, exist_ok=True)

        audio = tmp / "audio.mp3"
        print(f"♪ extracting audio from {src.name}")
        extract_audio(src, audio)
        total = duration_of(audio)

        chunk_len = args.chunk_minutes * 60
        if args.backend == "groq":
            # Keep every chunk under the upload cap, whatever the bitrate math says.
            mb_per_sec = audio.stat().st_size / 1e6 / max(total, 1)
            chunk_len = min(chunk_len, MAX_UPLOAD_MB / mb_per_sec * 0.9)
        silences = silence_midpoints(audio) if total > chunk_len else []
        chunks = plan_chunks(total, chunk_len, silences)
        print(f"⏱  {total / 60:.1f} min of audio → {len(chunks)} chunk(s) via {args.backend}/{model}")

        paths = []
        for i, (a, b) in enumerate(chunks):
            if len(chunks) == 1:
                paths.append(audio)
            else:
                p = tmp / f"chunk{i:03}.mp3"
                cut(audio, a, b, p)
                paths.append(p)

        workers = args.workers if args.backend == "groq" else 1  # one local model, one at a time
        results: list[list[Segment]] = [[] for _ in chunks]
        with cf.ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(backend, p, model, language, prompt): i for i, p in enumerate(paths)}
            for done, fut in enumerate(cf.as_completed(futures), 1):
                i = futures[fut]
                offset = chunks[i][0]
                results[i] = [Segment(s.start + offset, s.end + offset, s.text) for s in fut.result() if s.text]
                print(f"  ✓ chunk {done}/{len(chunks)}")

        segments = [s for chunk in results for s in chunk]
        written = write_outputs(segments, out_dir / stem, {f.strip() for f in args.formats.split(",")})
        if args.keep_audio:
            shutil.copy(audio, out_dir / f"{stem}.mp3")

    elapsed = time.time() - t0
    print(f"\n✔ done in {elapsed:.1f}s ({total / max(elapsed, 0.01):.0f}× realtime)")
    if args.backend == "groq" and model in GROQ_PRICE_PER_HOUR:
        billed = sum(max(b - a, 10) for a, b in chunks)  # Groq bills a 10 s minimum per request
        print(f"  est. cost: ${billed / 3600 * GROQ_PRICE_PER_HOUR[model]:.4f}")
    for p in written:
        print(f"  → {p}")


if __name__ == "__main__":
    main()
