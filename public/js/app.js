(() => {
    "use strict";

    // ── State ──
    let channelData = null;
    let allVideos = [];
    let selectedIds = new Set();
    let nextPageToken = null;
    let uploadsPlaylist = null;
    let currentFilter = "all"; // "all", "long", "shorts"

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
    const filterSelect = $("#filterSelect");
    const toast = $("#toast");
    const toastMessage = $("#toastMessage");
    const lightbox = $("#lightbox");
    const downloadOverlay = $("#downloadOverlay");
    const downloadStatus = $("#downloadStatus");
    const fab = $("#fab");
    const fabCount = $("#fabCount");
    const fabDownloadZip = $("#fabDownloadZip");
    const fabScrollTop = $("#fabScrollTop");
    const toolbar = $("#toolbar");
    const btnSelectRecent = $("#btnSelectRecent");
    const recentCount = $("#recentCount");

    // ── Dark mode ──
    function initDarkMode() {
        const saved = localStorage.getItem("theme");
        if (saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
            document.documentElement.setAttribute("data-theme", "dark");
        }
    }

    function toggleDarkMode() {
        const isDark = document.documentElement.getAttribute("data-theme") === "dark";
        if (isDark) {
            document.documentElement.removeAttribute("data-theme");
            localStorage.setItem("theme", "light");
        } else {
            document.documentElement.setAttribute("data-theme", "dark");
            localStorage.setItem("theme", "dark");
        }
    }

    initDarkMode();
    $("#darkToggle").addEventListener("click", toggleDarkMode);
    $("#darkToggleHero").addEventListener("click", toggleDarkMode);

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

    // Detect if a video is a Short based on title patterns and thumbnail aspect ratio
    function isShort(video) {
        const title = (video.title || "").toLowerCase();
        // Shorts typically only have default/medium/high thumbnails, not maxres/standard
        // Also check title for common shorts indicators
        if (title.includes("#shorts") || title.includes("#short")) return true;
        // If only low-res thumbnails available, likely a short
        const thumbs = video.thumbnails || {};
        if (!thumbs.maxres && !thumbs.standard && thumbs.default) return true;
        return false;
    }

    function updateSelectionUI() {
        const count = selectedIds.size;
        selectionCount.textContent = `${count} selected`;
        btnDownloadZip.disabled = count === 0;
        fabCount.textContent = `${count} selected`;
        fabDownloadZip.disabled = count === 0;
        updateFabVisibility();
    }

    // ── Floating Action Bar visibility ──
    let toolbarOutOfView = false;

    function updateFabVisibility() {
        const show = toolbarOutOfView && selectedIds.size > 0 && resultsSection.style.display !== "none";
        fab.style.display = show ? "block" : "none";
    }

    const toolbarObserver = new IntersectionObserver((entries) => {
        toolbarOutOfView = !entries[0].isIntersecting;
        updateFabVisibility();
    }, { threshold: 0 });

    // ── Filter logic ──
    function applyFilter() {
        currentFilter = filterSelect.value;
        const cards = grid.querySelectorAll(".card");
        cards.forEach(card => {
            const videoId = card.dataset.id;
            const video = allVideos.find(v => v.id === videoId);
            if (!video) return;
            const short = isShort(video);
            let show = true;
            if (currentFilter === "long" && short) show = false;
            if (currentFilter === "shorts" && !short) show = false;
            card.classList.toggle("hidden-by-filter", !show);
        });
    }

    // ── Card rendering ──
    function createCard(video) {
        const card = document.createElement("div");
        const short = isShort(video);
        card.className = "card" + (selectedIds.has(video.id) ? " selected" : "");
        card.dataset.id = video.id;
        if (short) card.dataset.type = "short";

        // Apply current filter
        if (currentFilter === "long" && short) card.classList.add("hidden-by-filter");
        if (currentFilter === "shorts" && !short) card.classList.add("hidden-by-filter");

        const badgeHtml = short ? `<div class="card-badge">Short</div>` : "";

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
                ${badgeHtml}
            </div>
            <div class="card-body">
                <div class="card-title" title="${video.title.replace(/"/g, '&quot;')}">${escapeHtml(video.title)}</div>
                <div class="card-date">${formatDate(video.published_at)}</div>
            </div>
        `;

        card.addEventListener("click", (e) => {
            if (e.target.closest("[data-action]")) return;
            toggleSelect(video.id, card);
        });

        card.querySelector('[data-action="preview"]').addEventListener("click", (e) => {
            e.stopPropagation();
            openLightbox(video);
        });

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
            currentFilter = "all";
            filterSelect.value = "all";

            $("#channelAvatar").src = channelData.thumbnail;
            $("#channelTitle").textContent = channelData.title;
            $("#channelStats").textContent =
                `${formatNumber(channelData.subscriber_count)} subscribers · ${formatNumber(channelData.video_count)} videos`;

            renderVideos(allVideos);
            updateSelectionUI();

            heroSection.style.display = "none";
            resultsSection.style.display = "block";
            headerActions.style.display = "flex";
            $("#darkToggleHero").style.display = "none";
            loadMoreWrap.style.display = nextPageToken ? "flex" : "none";

            // Start observing toolbar for FAB
            toolbarObserver.observe(toolbar);

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

    // ── Download single thumbnail ──
    async function downloadSingle(video) {
        const quality = qualitySelect.value;
        const url = (video.thumbnails && video.thumbnails[quality]) || video.thumbnail;
        const safeTitle = video.title.replace(/[^\w\s-]/g, "").trim().slice(0, 80) || video.id;
        const filename = `${safeTitle}_${video.id}.jpg`;

        try {
            const resp = await fetch(`/api/proxy-thumbnail?url=${encodeURIComponent(url)}`);
            const blob = await resp.blob();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        } catch (err) {
            showToast("Download failed.");
        }
    }

    // ── Download ZIP (client-side using JSZip) ──
    async function downloadZip() {
        const selected = allVideos.filter(v => selectedIds.has(v.id));
        if (selected.length === 0) return;

        const quality = qualitySelect.value;
        downloadOverlay.style.display = "flex";

        try {
            const zip = new JSZip();
            let done = 0;

            const batchSize = 6;
            for (let i = 0; i < selected.length; i += batchSize) {
                const batch = selected.slice(i, i + batchSize);
                await Promise.all(batch.map(async (v) => {
                    const url = (v.thumbnails && v.thumbnails[quality]) || v.thumbnail;
                    if (!url) return;
                    try {
                        const resp = await fetch(`/api/proxy-thumbnail?url=${encodeURIComponent(url)}`);
                        if (!resp.ok) return;
                        const blob = await resp.blob();
                        const safeTitle = v.title.replace(/[^\w\s-]/g, "").trim().slice(0, 80) || v.id;
                        zip.file(`${safeTitle}_${v.id}.jpg`, blob);
                        done++;
                        downloadStatus.textContent = `Downloading ${done}/${selected.length}...`;
                    } catch (e) { /* skip failed */ }
                }));
            }

            downloadStatus.textContent = "Creating ZIP...";
            const blob = await zip.generateAsync({ type: "blob" });
            const channelName = (channelData?.title || "thumbnails").replace(/[^\w\s-]/g, "").trim();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `${channelName}_thumbnails.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        } catch (err) {
            showToast("ZIP creation failed.");
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
        $("#darkToggleHero").style.display = "";
        fab.style.display = "none";
        grid.innerHTML = "";
        allVideos = [];
        selectedIds.clear();
        nextPageToken = null;
        channelData = null;
        currentFilter = "all";
        filterSelect.value = "all";
        channelInput.value = "";
        channelInput.focus();
        toolbarObserver.disconnect();
    }

    // ── Select recent N ──
    function selectRecentN() {
        const n = parseInt(recentCount.value) || 20;
        // Get visible (non-filtered) videos, take first N (most recent)
        let count = 0;
        selectedIds.clear();
        grid.querySelectorAll(".card").forEach(c => c.classList.remove("selected"));

        for (const v of allVideos) {
            if (count >= n) break;
            const short = isShort(v);
            if (currentFilter === "long" && short) continue;
            if (currentFilter === "shorts" && !short) continue;
            selectedIds.add(v.id);
            const card = grid.querySelector(`.card[data-id="${v.id}"]`);
            if (card) card.classList.add("selected");
            count++;
        }
        updateSelectionUI();
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
        allVideos.forEach(v => {
            const short = isShort(v);
            if (currentFilter === "long" && short) return;
            if (currentFilter === "shorts" && !short) return;
            selectedIds.add(v.id);
        });
        grid.querySelectorAll(".card:not(.hidden-by-filter)").forEach(c => c.classList.add("selected"));
        updateSelectionUI();
    });

    btnDeselectAll.addEventListener("click", () => {
        selectedIds.clear();
        grid.querySelectorAll(".card").forEach(c => c.classList.remove("selected"));
        updateSelectionUI();
    });

    btnSelectRecent.addEventListener("click", selectRecentN);
    recentCount.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); selectRecentN(); }
    });

    filterSelect.addEventListener("change", applyFilter);

    btnDownloadZip.addEventListener("click", downloadZip);
    fabDownloadZip.addEventListener("click", downloadZip);
    fabScrollTop.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    });

    btnNewSearch.addEventListener("click", resetToSearch);

    $("#lightboxClose").addEventListener("click", closeLightbox);
    $("#lightboxBackdrop").addEventListener("click", closeLightbox);
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && lightbox.style.display !== "none") closeLightbox();
    });

    $("#lightboxDownload").addEventListener("click", () => {
        if (lightbox._currentVideo) downloadSingle(lightbox._currentVideo);
    });

    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "a" && resultsSection.style.display !== "none") {
            if (document.activeElement === channelInput) return;
            e.preventDefault();
            btnSelectAll.click();
        }
    });

})();
