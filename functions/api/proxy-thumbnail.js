export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const thumbUrl = url.searchParams.get("url") || "";

    if (!thumbUrl || (!thumbUrl.includes("ytimg.com") && !thumbUrl.includes("googleusercontent.com"))) {
        return Response.json({ error: "Invalid URL" }, { status: 400 });
    }

    const resp = await fetch(thumbUrl);
    if (!resp.ok) {
        return Response.json({ error: "Failed to fetch thumbnail" }, { status: 502 });
    }

    return new Response(resp.body, {
        headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, max-age=86400",
        },
    });
}
