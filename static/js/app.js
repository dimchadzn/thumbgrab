(() => {
    "use strict";

    // ── State ──
    let channelData = null;
    let allVideos = [];
    let selectedIds = new Set();
    let nextPageToken = null;
    let uploadsPlaylist = null;

    // ── DOM refs ──
    const $ = (sel) => document.querySelector(sel);
    const heroSection = $("#heroSection");
    const resultsSection = $("#resultsSection");
    const headerActions = $("#headerActions");
    const searchForm = $("#searchForm");
    const channelInput = $("#channelInput");
    const searchBtn = $("#searchBtn");
    const grid = $("#thumbnailGrid");
    const loadMoreWrap = $("#loadMoreWrap");
    const btnLoadMore = $("#btnLoadMore");
    const btnSelectAll = $("#btnSelectAll");
    const btnDeselectAll = $("#btnDeselectAll");
    const btnDownloadZip = $("#btnDownloadZip");
    const btnNewSearch = $("#btnNewSearch");
    const selectionCount = $("#selectionCount");
    const qualitySelect = $("#qualitySelect");
    const toast = $("#toast");
    const toastMessage = $("#toastMessage");
    const lightbox = $("#lightbox");
    const downloadOverlay = $("#downloadOverlay");
    const downloadStatus = $("#downloadStatus");

    // ── Helpers ──
    function showToast(msg, duration = 4000) {
        toastMessage.textContent = msg;
        toast.style.display = "flex";
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => { toast.style.display = "none"; }, duration);
    }

    function setLoading(btn, loading) {
        const text = btn.querySelector(".btn-text");
        const loader = btn.querySelector(".btn-loader");
        if (text) text.style.display = loading ? "none" : "";
        if (loader) loader.style.display = loading ? "inline-flex" : "none";
        btn.disabled = loading;
    }

    function formatDate(iso) {
        if (!iso) return "";
        const d = new Date(iso);
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }

    function formatNumber(n) {
        const num = parseInt(n);
        if (isNaN(num)) return n;
        if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
        if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
        return num.toLocaleString();
    }

    function updateSelectionUI() {
        const count = selectedIds.size;
        selectionCount.textContent = `${count} selected`;
        btnDownloadZip.disabled = count === 0;
    }

    // ── Card rendering ──
    function createCard(video) {
        const card = document.createElement("div");
        card.className = "card" + (selectedIds.has(video.id) ? " selected" : "");
        card.dataset.id = video.id;
        card.innerHTML = `
            <div class="card-thumb-wrap">
                <img class="card-thumb" src="${video.thumbnail}" alt="" loading="lazy">
                <div class="card-check">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <div class="card-actions">
                    <button class="card-action-btn" data-action="preview" title="Preview">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                    <button class="card-action-btn" data-action="download" title="Download thumbnail">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </button>
                </div>
            </div>
            <div class="card-body">
                <div class="card-title" title="${video.title.replace(/"/g, '&quot;')}">${escapeHtml(video.title)}</div>
                <div class="card-date">${formatDate(video.published_at)}</div>
            </div>
        `;

        // Toggle selection on card click
        card.addEventListener("click", (e) => {
            // Don't toggle if action button was clicked
            if (e.target.closest("[data-action]")) return;
            toggleSelect(video.id, card);
        });

        // Preview button
        card.querySelector('[data-action="preview"]').addEventListener("click", (e) => {
            e.stopPropagation();
            openLightbox(video);
        });

        // Download single
        card.querySelector('[data-action="download"]').addEventListener("click", (e) => {
            e.stopPropagation();
            downloadSingle(video);
        });

        return card;
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    function toggleSelect(id, card) {
        if (selectedIds.has(id)) {
            selectedIds.delete(id);
            card.classList.remove("selected");
        } else {
            selectedIds.add(id);
            card.classList.add("selected");
        }
        updateSelectionUI();
    }

    function renderVideos(videos, append = false) {
        if (!append) grid.innerHTML = "";
        const fragment = document.createDocumentFragment();
        for (const v of videos) {
            fragment.appendChild(createCard(v));
        }
        grid.appendChild(fragment);
    }

    // ── Fetch channel ──
    async function fetchChannel(url) {
        setLoading(searchBtn, true);
        try {
            const resp = await fetch("/api/channel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url }),
            });
            const data = await resp.json();
            if (!resp.ok) {
                showToast(data.error || "Something went wrong.");
                return;
            }

            channelData = data.channel;
            allVideos = data.videos;
            nextPageToken = data.next_page_token;
            uploadsPlaylist = data.channel.uploads_playlist;
            selectedIds.clear();

            // Update UI
            $("#channelAvatar").src = channelData.thumbnail;
            $("#channelTitle").textContent = channelData.title;
            $("#channelStats").textContent =
                `${formatNumber(channelData.subscriber_count)} subscribers · ${formatNumber(channelData.video_count)} videos`;

            renderVideos(allVideos);
            updateSelectionUI();

            heroSection.style.display = "none";
            resultsSection.style.display = "block";
            headerActions.style.display = "flex";
            loadMoreWrap.style.display = nextPageToken ? "flex" : "none";

        } catch (err) {
            showToast("Network error. Please try again.");
            console.error(err);
        } finally {
            setLoading(searchBtn, false);
        }
    }

    // ── Load more ──
    async function loadMore() {
        if (!nextPageToken || !uploadsPlaylist) return;
        setLoading(btnLoadMore, true);
        try {
            const resp = await fetch("/api/videos", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playlist_id: uploadsPlaylist, page_token: nextPageToken }),
            });
            const data = await resp.json();
            if (!resp.ok) {
                showToast(data.error || "Failed to load more.");
                return;
            }
            allVideos.push(...data.videos);
            nextPageToken = data.next_page_token;
            renderVideos(data.videos, true);
            loadMoreWrap.style.display = nextPageToken ? "flex" : "none";
        } catch (err) {
            showToast("Network error.");
        } finally {
            setLoading(btnLoadMore, false);
        }
    }

    // ── Download single ──
    function downloadSingle(video) {
        const quality = qualitySelect.value;
        const url = (video.thumbnails && video.thumbnails[quality]) || video.thumbnail;
        const safeTitle = video.title.replace(/[^\w\s-]/g, "").trim().slice(0, 80) || video.id;
        const filename = `${safeTitle}_${video.id}.jpg`;
        const proxyUrl = `/api/proxy-thumbnail?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;

        const a = document.createElement("a");
        a.href = proxyUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // ── Download ZIP ──
    async function downloadZip() {
        const selected = allVideos.filter(v => selectedIds.has(v.id));
        if (selected.length === 0) return;

        const quality = qualitySelect.value;
        downloadOverlay.style.display = "flex";
        downloadStatus.textContent = `Preparing ${selected.length} thumbnail${selected.length > 1 ? "s" : ""}...`;

        try {
            const resp = await fetch("/api/download-zip", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    videos: selected,
                    quality,
                    channel_name: channelData?.title || "thumbnails",
                }),
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                showToast(err.error || "ZIP download failed.");
                return;
            }

            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = resp.headers.get("Content-Disposition")?.match(/filename="?(.+?)"?$/)?.[1]
                || `${channelData?.title || "thumbnails"}_thumbnails.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            showToast("Download failed.");
            console.error(err);
        } finally {
            downloadOverlay.style.display = "none";
        }
    }

    // ── Lightbox ──
    function openLightbox(video) {
        const quality = qualitySelect.value;
        const url = (video.thumbnails && video.thumbnails[quality]) || video.thumbnail;
        $("#lightboxImg").src = url;
        $("#lightboxTitle").textContent = video.title;
        lightbox.style.display = "flex";
        document.body.style.overflow = "hidden";

        // Store current video for download
        lightbox._currentVideo = video;
    }

    function closeLightbox() {
        lightbox.style.display = "none";
        document.body.style.overflow = "";
        $("#lightboxImg").src = "";
    }

    // ── Reset ──
    function resetToSearch() {
        heroSection.style.display = "flex";
        resultsSection.style.display = "none";
        headerActions.style.display = "none";
        grid.innerHTML = "";
        allVideos = [];
        selectedIds.clear();
        nextPageToken = null;
        channelData = null;
        channelInput.value = "";
        channelInput.focus();
    }

    // ── Event listeners ──
    searchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const val = channelInput.value.trim();
        if (!val) return;
        fetchChannel(val);
    });

    document.querySelectorAll(".hint-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            channelInput.value = chip.dataset.url;
            fetchChannel(chip.dataset.url);
        });
    });

    btnLoadMore.addEventListener("click", loadMore);

    btnSelectAll.addEventListener("click", () => {
        allVideos.forEach(v => selectedIds.add(v.id));
        grid.querySelectorAll(".card").forEach(c => c.classList.add("selected"));
        updateSelectionUI();
    });

    btnDeselectAll.addEventListener("click", () => {
        selectedIds.clear();
        grid.querySelectorAll(".card").forEach(c => c.classList.remove("selected"));
        updateSelectionUI();
    });

    btnDownloadZip.addEventListener("click", downloadZip);
    btnNewSearch.addEventListener("click", resetToSearch);

    // Lightbox
    $("#lightboxClose").addEventListener("click", closeLightbox);
    $("#lightboxBackdrop").addEventListener("click", closeLightbox);
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && lightbox.style.display !== "none") closeLightbox();
    });

    $("#lightboxDownload").addEventListener("click", () => {
        if (lightbox._currentVideo) downloadSingle(lightbox._currentVideo);
    });

    // Keyboard shortcut: Ctrl/Cmd+A to select all when results visible
    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "a" && resultsSection.style.display !== "none") {
            // Only intercept if not focused on input
            if (document.activeElement === channelInput) return;
            e.preventDefault();
            btnSelectAll.click();
        }
    });

})();
