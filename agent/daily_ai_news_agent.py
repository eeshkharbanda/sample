#!/usr/bin/env python3
"""
Daily AI News Agent
Fetches the latest AI video from Vaibhav Sisinty's YouTube channel,
generates a Claude Code skill.md, and sends a daily email digest.
"""

import os
import sys
import json
import re
import smtplib
import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

try:
    from googleapiclient.discovery import build
    from youtube_transcript_api import YouTubeTranscriptApi
    import anthropic
except ImportError as e:
    print(f"Missing dependency: {e}\nRun: pip install -r requirements.txt")
    sys.exit(1)

# ── Config ───────────────────────────────────────────────────────────────────
CHANNEL_SEARCH_TERM = "Vaibhav Sisinty AI"
RECIPIENT_EMAIL     = "eeshkharbanda@gmail.com"
SKILLS_DIR          = Path(__file__).parent.parent / "skills"
STATE_FILE          = Path(__file__).parent / "state.json"
# ─────────────────────────────────────────────────────────────────────────────


def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {"processed_video_ids": []}


def save_state(state: dict):
    STATE_FILE.write_text(json.dumps(state, indent=2))


def get_latest_unprocessed_video(api_key: str, processed_ids: list) -> dict | None:
    """Return the newest video from the channel not yet processed."""
    youtube = build("youtube", "v3", developerKey=api_key)

    # Search for Vaibhav Sisinty's channel
    search_resp = youtube.search().list(
        q=CHANNEL_SEARCH_TERM,
        type="channel",
        part="id,snippet",
        maxResults=5,
    ).execute()

    channel_id, channel_name = None, None
    for item in search_resp.get("items", []):
        title = item["snippet"]["title"].lower()
        if "vaibhav" in title or "sisinty" in title:
            channel_id   = item["id"]["channelId"]
            channel_name = item["snippet"]["title"]
            break

    if not channel_id:
        # Fallback: use known channel handle
        channel_resp = youtube.channels().list(
            forHandle="vaibhavsisinty",
            part="id,snippet",
        ).execute()
        if channel_resp.get("items"):
            channel_id   = channel_resp["items"][0]["id"]
            channel_name = channel_resp["items"][0]["snippet"]["title"]
        else:
            raise ValueError(
                f"Could not find Vaibhav Sisinty's channel. "
                f"Search returned: {[i['snippet']['title'] for i in search_resp.get('items', [])]}"
            )

    print(f"Channel: {channel_name} ({channel_id})")

    # Latest 5 videos — find first unprocessed
    vids_resp = youtube.search().list(
        channelId=channel_id,
        type="video",
        part="id,snippet",
        order="date",
        maxResults=5,
    ).execute()

    for item in vids_resp.get("items", []):
        vid_id = item["id"]["videoId"]
        if vid_id not in processed_ids:
            return {
                "video_id":     vid_id,
                "title":        item["snippet"]["title"],
                "description":  item["snippet"]["description"],
                "published_at": item["snippet"]["publishedAt"],
                "channel_name": channel_name,
                "url":          f"https://www.youtube.com/watch?v={vid_id}",
            }

    return None  # all recent videos already processed


def get_transcript(video_id: str) -> str:
    try:
        segments = YouTubeTranscriptApi.get_transcript(
            video_id, languages=["en", "en-US", "en-IN"]
        )
        return " ".join(s["text"] for s in segments)
    except Exception as e:
        print(f"Transcript unavailable ({e}); will use description only.")
        return ""


def generate_with_claude(
    client: anthropic.Anthropic, video: dict, transcript: str
) -> dict:
    """Ask Claude to produce a skill.md + email content from the video."""
    today = datetime.date.today().strftime("%Y-%m-%d")
    context = f"""Video Title: {video['title']}
Channel: {video['channel_name']}
Published: {video['published_at']}
URL: {video['url']}
Description:
{video['description']}

Transcript (up to 8 000 chars):
{transcript[:8000]}"""

    prompt = f"""You are analysing an AI-focused YouTube video by Vaibhav Sisinty.
Extract the single most useful AI tool, workflow, or technique demonstrated and generate:

1. A Claude Code skill.md that teaches Claude how to apply this technique step by step.
2. A daily email digest with three sections.

Return ONLY valid JSON (no markdown fences, no extra text):
{{
  "skill_name": "kebab-case-slug",
  "skill_display_name": "Human Readable Name",
  "skill_md_content": "...full skill.md...",
  "email": {{
    "subject": "Daily AI Skill [{today}]: <skill display name>",
    "what_skill": "2-3 sentence summary of what was learned",
    "where_to_use": "• bullet one\\n• bullet two\\n• bullet three\\n• bullet four",
    "case_story": "150-word narrative addressed to 'you' showing a vivid real-world benefit"
  }}
}}

The skill.md MUST use this exact Claude Code format:
---
description: one-line description of when Claude Code should invoke this skill
---

# <Skill Display Name>

<overview of what this skill does>

## When to Use
...

## Steps
1. ...
2. ...

## Output Format
...

## Example
...

Video content to analyse:
{context}"""

    resp = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = resp.content[0].text.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    return json.loads(raw)


def save_skill(skill_name: str, content: str) -> Path:
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    today = datetime.date.today().strftime("%Y-%m-%d")
    path  = SKILLS_DIR / f"{today}-{skill_name}.md"
    path.write_text(content, encoding="utf-8")
    return path


def build_html_email(
    email_data: dict, video: dict, skill_filename: str
) -> str:
    today_str  = datetime.date.today().strftime("%A, %B %d, %Y")
    where_html = "".join(
        f"<li>{line.lstrip('•- ').strip()}</li>"
        for line in email_data["where_to_use"].splitlines()
        if line.strip()
    )
    skill_slug = "-".join(skill_filename.replace(".md", "").split("-")[3:])

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       background:#f0f4f8;margin:0;padding:20px}}
  .wrap{{max-width:600px;margin:0 auto;background:#fff;border-radius:14px;
         overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}}
  .hdr{{background:linear-gradient(135deg,#0f0c29,#302b63,#24243e);
        color:#fff;padding:32px 28px;text-align:center}}
  .badge{{display:inline-block;background:#f6ad55;color:#1a1a2e;padding:5px 14px;
          border-radius:20px;font-size:12px;font-weight:700;margin-bottom:12px}}
  .hdr h1{{margin:0;font-size:22px}}
  .hdr .date{{color:#a0aec0;font-size:13px;margin-top:6px}}
  .sec{{padding:22px 28px;border-bottom:1px solid #e2e8f0}}
  .sec h2{{margin:0 0 10px;font-size:15px;color:#2d3748}}
  .sec p,.sec li{{color:#4a5568;line-height:1.65;font-size:14px}}
  .use-box{{background:#ebf8ff;border-radius:8px;padding:14px 14px 14px 8px}}
  .use-box ul{{margin:0;padding-left:20px}}
  .use-box li{{color:#2b6cb0;margin-bottom:4px}}
  .story{{background:#fffaf0;border-left:4px solid #f6ad55;
          padding:14px 16px;border-radius:0 8px 8px 0}}
  .mono{{background:#1a202c;color:#68d391;font-family:monospace;
         padding:10px 14px;border-radius:7px;font-size:13px;word-break:break-all}}
  .btn{{display:block;background:#cc0000;color:#fff;text-align:center;padding:13px;
        border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;margin-top:16px}}
  .ftr{{padding:18px 28px;text-align:center;color:#a0aec0;font-size:11px}}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <div class="badge">⚡ Daily AI Skill Update</div>
    <h1>Your AI Skill for Today</h1>
    <div class="date">{today_str}</div>
  </div>

  <div class="sec">
    <h2>🧠 What New Skill Was Learned</h2>
    <p>{email_data['what_skill']}</p>
    <p style="font-size:13px;color:#718096">
      Source: <a href="{video['url']}" style="color:#3182ce">{video['title']}</a>
    </p>
  </div>

  <div class="sec">
    <h2>⚡ Where You Can Use It</h2>
    <div class="use-box"><ul>{where_html}</ul></div>
  </div>

  <div class="sec">
    <h2>🌟 Your Ideal Use Case Story</h2>
    <div class="story"><p>{email_data['case_story']}</p></div>
  </div>

  <div class="sec">
    <h2>📁 Activate in Claude Code</h2>
    <p style="font-size:13px;color:#4a5568">Pull the repo then copy to your Claude skills folder:</p>
    <div class="mono">~/.claude/skills/{skill_filename}</div>
    <p style="font-size:12px;color:#718096;margin-top:10px">
      Invoke with <strong>/{skill_slug}</strong> in any Claude Code session,
      or Claude will suggest it automatically when the context matches.
    </p>
    <a href="{video['url']}" class="btn">▶ Watch the Source Video</a>
  </div>

  <div class="ftr">
    Daily AI News Agent &bull; Powered by Claude &amp; YouTube<br>
    eeshkharbanda/sample → skills/ folder
  </div>
</div>
</body>
</html>"""


def send_email(gmail_user: str, gmail_pw: str, subject: str, html_body: str):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = gmail_user
    msg["To"]      = RECIPIENT_EMAIL
    msg.attach(MIMEText(html_body, "html"))
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as srv:
        srv.login(gmail_user, gmail_pw)
        srv.sendmail(gmail_user, RECIPIENT_EMAIL, msg.as_string())


def main():
    required = {
        "YOUTUBE_API_KEY":    os.environ.get("YOUTUBE_API_KEY"),
        "ANTHROPIC_API_KEY":  os.environ.get("ANTHROPIC_API_KEY"),
        "GMAIL_USER":         os.environ.get("GMAIL_USER"),
        "GMAIL_APP_PASSWORD": os.environ.get("GMAIL_APP_PASSWORD"),
    }
    missing = [k for k, v in required.items() if not v]
    if missing:
        print(f"ERROR: Missing env vars: {', '.join(missing)}")
        sys.exit(1)

    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] Daily AI News Agent starting…")

    state = load_state()

    # 1. Find latest unprocessed video
    print("Searching YouTube for latest video…")
    video = get_latest_unprocessed_video(
        required["YOUTUBE_API_KEY"], state["processed_video_ids"]
    )
    if video is None:
        print("No new videos found — all recent videos already processed. Exiting.")
        sys.exit(0)
    print(f"Video: {video['title']} ({video['published_at'][:10]})")

    # 2. Transcript
    print("Fetching transcript…")
    transcript = get_transcript(video["video_id"])

    # 3. Claude generation
    print("Generating skill + email via Claude…")
    client    = anthropic.Anthropic(api_key=required["ANTHROPIC_API_KEY"])
    generated = generate_with_claude(client, video, transcript)

    # 4. Save skill
    skill_path = save_skill(generated["skill_name"], generated["skill_md_content"])
    print(f"Skill saved → {skill_path.name}")

    # 5. Email
    print(f"Sending email to {RECIPIENT_EMAIL}…")
    html = build_html_email(generated["email"], video, skill_path.name)
    send_email(
        required["GMAIL_USER"],
        required["GMAIL_APP_PASSWORD"],
        generated["email"]["subject"],
        html,
    )
    print("Email sent.")

    # 6. Persist state
    state["processed_video_ids"].append(video["video_id"])
    state["processed_video_ids"] = state["processed_video_ids"][-50:]
    save_state(state)

    print(f"\n✓ Done — {generated['skill_display_name']} → {skill_path.name}")


if __name__ == "__main__":
    main()
