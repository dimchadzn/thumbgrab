const YT_API = "https://www.googleapis.com/youtube/v3";

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

    return Response.json({
        videos,
        next_page_token: data.nextPageToken || null,
    });
}
