const YT_API = "https://www.googleapis.com/youtube/v3";

// Parse ISO 8601 duration to seconds
function parseDuration(iso) {
    if (!iso) return 0;
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

function isLikelyShort(title, durationSeconds) {
    if (durationSeconds > 0 && durationSeconds <= 62) return true;
    const t = (title || "").toLowerCase();
    if (t.includes("#shorts") || t.includes("#short")) return true;
    return false;
}

async function enrichWithDurations(videos, apiKey) {
    if (!videos.length) return videos;
    const ids = videos.map(v => v.id).join(",");
    const resp = await fetch(`${YT_API}/videos?part=contentDetails&id=${ids}&key=${apiKey}`);
    const data = await resp.json();

    const durationMap = {};
    for (const item of (data.items || [])) {
        const seconds = parseDuration(item.contentDetails?.duration);
        durationMap[item.id] = seconds;
    }

    return videos.map(v => ({
        ...v,
        duration: durationMap[v.id] || 0,
        is_short: isLikelyShort(v.title, durationMap[v.id] || 0),
    }));
}

export async function onRequestPost(context) {
    const apiKey = context.env.YOUTUBE_API_KEY;
    if (!apiKey) {
        return Response.json({ error: "API key not configured." }, { status: 500 });
    }

    const body = await context.request.json();
    const playlistId = body.playlist_id || "";
    const pageToken = body.page_token || "";

    if (!playlistId) {
        return Response.json({ error: "Missing playlist_id" }, { status: 400 });
    }

    let url = `${YT_API}/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50&key=${apiKey}`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const resp = await fetch(url);
    const data = await resp.json();

    if (data.error) {
        return Response.json({ error: "Failed to fetch videos." }, { status: 502 });
    }

    const videos = (data.items || []).map(item => {
        const snippet = item.snippet;
        const videoId = snippet.resourceId?.videoId || "";
        const thumbnails = snippet.thumbnails || {};

        let thumbUrl = "";
        const available = {};
        for (const q of ["maxres", "standard", "high", "medium", "default"]) {
            if (thumbnails[q]) {
                if (!thumbUrl) thumbUrl = thumbnails[q].url;
                available[q] = thumbnails[q].url;
            }
        }

        return {
            id: videoId,
            title: snippet.title || "",
            published_at: snippet.publishedAt || "",
            thumbnail: thumbUrl,
            thumbnails: available,
        };
    });

    // Enrich with durations
    const enrichedVideos = await enrichWithDurations(videos, apiKey);

    return Response.json({
        videos: enrichedVideos,
        next_page_token: data.nextPageToken || null,
    });
}
