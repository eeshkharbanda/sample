# Video → transcript (Hindi + English)

One command: give it a video file or a link, get `.txt`, `.srt` and `.json` transcripts with timestamps.

```bash
pip install -r requirements.txt          # plus ffmpeg: brew install ffmpeg / apt install ffmpeg
export GROQ_API_KEY=gsk_...              # free key: https://console.groq.com/keys

python transcribe.py meeting.mp4
python transcribe.py "https://youtu.be/VIDEO_ID" --script roman
python transcribe.py call.mkv --prompt "Satyug Today, Eesh, Razorpay"   # names it should spell right
```

## How it stays fast and cheap
- **Uploads audio only.** ffmpeg throws away the video and downmixes to 16 kHz mono (~0.36 MB/min), so a 1 GB video turns into ~20 MB of audio.
- **Groq Whisper large-v3**: about $0.11 per audio hour and roughly 100–200× realtime. A 1-hour video costs around ₹10 and takes under a minute.
- **Long files** are split at pauses (so no word gets cut in half) and the pieces are sent in parallel.
- **Filters hallucinations**: drops segments Whisper itself marks as probably not speech (the classic "Thanks for watching!" over background music).

## Choosing the script (`--script`)
| value | output looks like | notes |
|---|---|---|
| `mixed` (default) | `तो आज हम बात करेंगे about the project` | Closest to what was actually said |
| `roman` | `Toh aaj hum baat karenge about the project` | WhatsApp-style. Sometimes *translates* a Hindi line into English |
| `devanagari` | `तो आज हम प्रोजेक्ट के बारे में…` | English words written in Devanagari |
| `auto` | whatever Whisper picks | Can flip between scripts mid-file |

## Options
`--model whisper-large-v3-turbo` (≈⅓ the price, a bit worse on Hindi) · `--backend local` (free and offline with faster-whisper; slow without a GPU) · `--formats txt,srt,vtt,json` · `--out DIR` · `--chunk-minutes N` · `--workers N` · `--keep-audio`

## Limits
- Whisper doesn't label who is speaking.
- Heavy background music, people talking over each other, or bad phone audio will still cause errors.
- Groq's free tier caps how many audio-hours you can send per hour/day. Upgrade, or lower `--workers`, if you hit 429 errors.
