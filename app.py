import os
import io
import re
import zipfile
import requests
from flask import Flask, render_template, request, jsonify, send_file
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder="public", static_url_path="", template_folder="public")
CORS(app)

API_KEY = os.environ.get("YOUTUBE_API_KEY", "")
YT_API = "https://www.googleapis.com/youtube/v3"


def resolve_channel_id(channel_input):
    """Resolve various YouTube channel URL formats to a channel ID."""
    channel_input = channel_input.strip().rstrip("/")

    # Direct channel ID
    if re.match(r"^UC[\w-]{22}$", channel_input):
        return channel_input

    # Extract from URL patterns
    patterns = [
        r"youtube\.com/channel/(UC[\w-]{22})",          # /channel/UCxxxx
        r"youtube\.com/@([\w.-]+)",                       # /@handle
        r"youtube\.com/c/([\w.-]+)",                      # /c/name
        r"youtube\.com/user/([\w.-]+)",                   # /user/name
        r"youtube\.com/([\w.-]+)$",                       # /name (legacy)
    ]

    identifier = None
    is_channel_id = False

    for i, pattern in enumerate(patterns):
        match = re.search(pattern, channel_input)
        if match:
            identifier = match.group(1)
            is_channel_id = (i == 0)
            break

    if not identifier:
        # Treat raw input as a handle or username
        identifier = channel_input.lstrip("@")

    if is_channel_id:
        return identifier

    # Try as handle first (@handle)
    handle = identifier if identifier.startswith("@") else f"@{identifier}"
    resp = requests.get(f"{YT_API}/channels", params={
        "part": "id",
        "forHandle": handle,
        "key": API_KEY,
    })
    data = resp.json()
    if data.get("items"):
        return data["items"][0]["id"]

    # Try as username
    resp = requests.get(f"{YT_API}/channels", params={
        "part": "id",
        "forUsername": identifier,
        "key": API_KEY,
    })
    data = resp.json()
    if data.get("items"):
        return data["items"][0]["id"]

    # Try search as last resort
    resp = requests.get(f"{YT_API}/search", params={
        "part": "snippet",
        "q": identifier,
        "type": "channel",
        "maxResults": 1,
        "key": API_KEY,
    })
    data = resp.json()
    if data.get("items"):
        return data["items"][0]["snippet"]["channelId"]

    return None


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/config")
def config():
    return jsonify({"has_key": bool(API_KEY)})


@app.route("/api/channel", methods=["POST"])
def get_channel():
    """Fetch channel info and initial batch of videos."""
    body = request.json or {}
    channel_input = body.get("url", "")

    if not API_KEY:
        return jsonify({"error": "YouTube API key not configured on server."}), 500

    channel_id = resolve_channel_id(channel_input)
    if not channel_id:
        return jsonify({"error": "Could not find that channel. Check the URL and try again."}), 404

    # Get channel info
    resp = requests.get(f"{YT_API}/channels", params={
        "part": "snippet,statistics,contentDetails",
        "id": channel_id,
        "key": API_KEY,
    })
    data = resp.json()
    if not data.get("items"):
        return jsonify({"error": "Channel not found."}), 404

    channel = data["items"][0]
    uploads_playlist = channel["contentDetails"]["relatedPlaylists"]["uploads"]

    # Fetch first batch of videos
    videos, next_page = fetch_videos(uploads_playlist, None)

    return jsonify({
        "channel": {
            "id": channel_id,
            "title": channel["snippet"]["title"],
            "description": channel["snippet"].get("description", ""),
            "thumbnail": channel["snippet"]["thumbnails"].get("medium", {}).get("url", ""),
            "subscriber_count": channel["statistics"].get("subscriberCount", "N/A"),
            "video_count": channel["statistics"].get("videoCount", "0"),
            "uploads_playlist": uploads_playlist,
        },
        "videos": videos,
        "next_page_token": next_page,
    })


@app.route("/api/videos", methods=["POST"])
def get_videos():
    """Fetch next page of videos."""
    body = request.json or {}
    playlist_id = body.get("playlist_id", "")
    page_token = body.get("page_token", "")

    if not playlist_id:
        return jsonify({"error": "Missing playlist_id"}), 400

    videos, next_page = fetch_videos(playlist_id, page_token)
    return jsonify({"videos": videos, "next_page_token": next_page})


def fetch_videos(playlist_id, page_token):
    """Fetch videos from a playlist with thumbnails."""
    params = {
        "part": "snippet",
        "playlistId": playlist_id,
        "maxResults": 50,
        "key": API_KEY,
    }
    if page_token:
        params["pageToken"] = page_token

    resp = requests.get(f"{YT_API}/playlistItems", params=params)
    data = resp.json()

    if "error" in data:
        return [], None

    videos = []
    for item in data.get("items", []):
        snippet = item["snippet"]
        video_id = snippet.get("resourceId", {}).get("videoId", "")
        thumbnails = snippet.get("thumbnails", {})

        # Get best available thumbnail
        thumb_url = ""
        for quality in ["maxres", "standard", "high", "medium", "default"]:
            if quality in thumbnails:
                thumb_url = thumbnails[quality]["url"]
                break

        # Also collect all available resolutions
        available = {}
        for quality in ["maxres", "standard", "high", "medium", "default"]:
            if quality in thumbnails:
                available[quality] = thumbnails[quality]["url"]

        videos.append({
            "id": video_id,
            "title": snippet.get("title", ""),
            "published_at": snippet.get("publishedAt", ""),
            "thumbnail": thumb_url,
            "thumbnails": available,
        })

    next_page = data.get("nextPageToken")
    return videos, next_page


@app.route("/api/download-zip", methods=["POST"])
def download_zip():
    """Download selected thumbnails as a ZIP file."""
    body = request.json or {}
    videos = body.get("videos", [])
    quality = body.get("quality", "maxres")

    if not videos:
        return jsonify({"error": "No videos selected"}), 400

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for v in videos:
            thumb_url = v.get("thumbnails", {}).get(quality) or v.get("thumbnail", "")
            if not thumb_url:
                continue
            try:
                resp = requests.get(thumb_url, timeout=10)
                if resp.status_code == 200:
                    safe_title = re.sub(r'[^\w\s-]', '', v.get("title", v["id"]))[:80].strip()
                    filename = f"{safe_title}_{v['id']}.jpg"
                    zf.writestr(filename, resp.content)
            except Exception:
                continue

    buf.seek(0)
    channel_name = body.get("channel_name", "thumbnails")
    safe_channel = re.sub(r'[^\w\s-]', '', channel_name)[:50].strip() or "thumbnails"
    return send_file(
        buf,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"{safe_channel}_thumbnails.zip",
    )


@app.route("/api/proxy-thumbnail")
def proxy_thumbnail():
    """Proxy a single thumbnail download to avoid CORS issues."""
    url = request.args.get("url", "")
    filename = request.args.get("filename", "thumbnail.jpg")
    if not url or "ytimg.com" not in url and "googleusercontent.com" not in url:
        return jsonify({"error": "Invalid URL"}), 400

    resp = requests.get(url, timeout=10)
    if resp.status_code != 200:
        return jsonify({"error": "Failed to fetch thumbnail"}), 502

    buf = io.BytesIO(resp.content)
    buf.seek(0)
    return send_file(buf, mimetype="image/jpeg", as_attachment=True, download_name=filename)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG", "0") == "1")
