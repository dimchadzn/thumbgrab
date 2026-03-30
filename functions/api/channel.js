const YT_API = "https://www.googleapis.com/youtube/v3";

async function resolveChannelId(channelInput, apiKey) {
    channelInput = channelInput.trim().replace(/\/+$/, "");

    // Direct channel ID
    if (/^UC[\w-]{22}$/.test(channelInput)) return channelInput;

    const patterns = [
        { re: /youtube\.com\/channel\/(UC[\w-]{22})/, isDirect: true },
        { re: /youtube\.com\/@([\w.-]+)/ },
        { re: /youtube\.com\/c\/([\w.-]+)/ },
        { re: /youtube\.com\/user\/([\w.-]+)/ },
        { re: /youtube\.com\/([\w.-]+)$/ },
    ];

    let identifier = null;
    let isDirect = false;

    for (const p of patterns) {
        const m = channelInput.match(p.re);
        if (m) {
            identifier = m[1];
            isDirect = !!p.isDirect;
            break;
        }
    }

    if (!identifier) identifier = channelInput.replace(/^@/, "");
    if (isDirect) return identifier;

    // Try handle
    const handle = identifier.startsWith("@") ? identifier : `@${identifier}`;
    let resp = await fetch(`${YT_API}/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`);
    let data = await resp.json();
    if (data.items?.length) return data.items[0].id;

    // Try username
    resp = await fetch(`${YT_API}/channels?part=id&forUsername=${encodeURIComponent(identifier)}&key=${apiKey}`);
    data = await resp.json();
    if (data.items?.length) return data.items[0].id;

    // Search fallback
    resp = await fetch(`${YT_API}/search?part=snippet&q=${encodeURIComponent(identifier)}&type=channel&maxResults=1&key=${apiKey}`);
    data = await resp.json();
    if (data.items?.length) return data.items[0].snippet.channelId;

    return null;
}

// Parse ISO 8601 duration to seconds
function parseDuration(iso) {
    if (!iso) return 0;
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

function isLikelyShort(title, durationSeconds) {
    // Duration-based: shorts are up to ~62s (some wiggle room for encoding)
    if (durationSeconds > 0 && durationSeconds <= 62) return true;
    // Title-based: creators often tag shorts
    const t = (title || "").toLowerCase();
    if (t.includes("#shorts") || t.includes("#short")) return true;
    return false;
}

// Fetch video durations and enrich video objects
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
        return Response.json({ error: "YouTube API key not configured." }, { status: 500 });
    }

    const body = await context.request.json();
    const url = body.url || "";

    const channelId = await resolveChannelId(url, apiKey);
    if (!channelId) {
        return Response.json({ error: "Could not find that channel. Check the URL and try again." }, { status: 404 });
    }

    // Get channel info
    const resp = await fetch(`${YT_API}/channels?part=snippet,statistics,contentDetails&id=${channelId}&key=${apiKey}`);
    const data = await resp.json();
    if (!data.items?.length) {
        return Response.json({ error: "Channel not found." }, { status: 404 });
    }

    const channel = data.items[0];
    const uploadsPlaylist = channel.contentDetails.relatedPlaylists.uploads;

    // Fetch first batch of videos
    const { videos, nextPageToken } = await fetchVideos(uploadsPlaylist, null, apiKey);

    // Enrich with durations to detect shorts
    const enrichedVideos = await enrichWithDurations(videos, apiKey);

    return Response.json({
        channel: {
            id: channelId,
            title: channel.snippet.title,
            description: channel.snippet.description || "",
            thumbnail: channel.snippet.thumbnails?.medium?.url || "",
            subscriber_count: channel.statistics.subscriberCount || "N/A",
            video_count: channel.statistics.videoCount || "0",
            uploads_playlist: uploadsPlaylist,
        },
        videos: enrichedVideos,
        next_page_token: nextPageToken,
    });
}

async function fetchVideos(playlistId, pageToken, apiKey) {
    let url = `${YT_API}/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50&key=${apiKey}`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const resp = await fetch(url);
    const data = await resp.json();

    if (data.error) return { videos: [], nextPageToken: null };

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

    return { videos, nextPageToken: data.nextPageToken || null };
}
