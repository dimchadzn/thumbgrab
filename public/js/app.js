(() => {
    "use strict";

    // ── State ──
    let channelData = null;
    let allVideos = [];
    let selectedIds = new Set();
    let nextPageToken = null;
    let uploadsPlaylist = null;
    let currentFilter = "all";
    let isLoadingMore = false;

    // ── DOM refs ──
    const $ = (sel) => document.querySelector(sel);
    const heroSection = $("#heroSection");
    const resultsSection = $("#resultsSection");
    const headerActions = $("#headerActions");
    const searchForm = $("#searchForm");
    const channelInput = $("#channelInput");
    const searchBtn = $("#searchBtn");
    const grid = $("#thumbnailGrid");
    const gridWrap = $("#gridWrap");
    const selectionBox = $("#selectionBox");
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
    const fab = $("#fab");
    const fabCount = $("#fabCount");
    const fabDownloadZip = $("#fabDownloadZip");
    const fabScrollTop = $("#fabScrollTop");
    const toolbar = $("#toolbar");

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
        return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
        fabCount.textContent = `${count} selected`;
        fabDownloadZip.disabled = count === 0;
        updateFabVisibility();
    }

    // Count how many visible (non-filtered) cards are shown
    function countVisibleCards() {
        return grid.querySelectorAll(".card:not(.hidden-by-filter)").length;
    }

    // ── FAB visibility ──
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
    function applyFilter(filter) {
        currentFilter = filter;
        document.querySelectorAll(".filter-btn").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.filter === filter);
        });
        // Show/hide cards
        grid.querySelectorAll(".card").forEach(card => {
            const videoId = card.dataset.id;
            const video = allVideos.find(v => v.id === videoId);
            if (!video) return;
            let show = true;
            if (filter === "long" && video.is_short) show = false;
            if (filter === "shorts" && !video.is_short) show = false;
            card.classList.toggle("hidden-by-filter", !show);
        });

        // If we don't have enough visible cards, keep loading more
        ensureEnoughVisible();
    }

    // Keep loading more batches until we have at least ~20 visible cards or no more pages
    async function ensureEnoughVisible() {
        const MIN_VISIBLE = 20;
        while (countVisibleCards() < MIN_VISIBLE && nextPageToken && !isLoadingMore) {
            await loadMore();
        }
    }

    // Filter button clicks
    document.querySelectorAll(".filter-btn").forEach(btn => {
        btn.addEventListener("click", () => applyFilter(btn.dataset.filter));
    });

    // ── Card rendering ──
    function createCard(video) {
        const card = document.createElement("div");
        card.className = "card" + (selectedIds.has(video.id) ? " selected" : "");
        card.dataset.id = video.id;

        // Apply current filter
        if (currentFilter === "long" && video.is_short) card.classList.add("hidden-by-filter");
        if (currentFilter === "shorts" && !video.is_short) card.classList.add("hidden-by-filter");

        const badgeHtml = video.is_short ? `<div class="card-badge">Short</div>` : "";

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
            if (card._skipClick) { card._skipClick = false; return; }
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
        for (const v of videos) fragment.appendChild(createCard(v));
        grid.appendChild(fragment);
    }

    // ════════════════════════════════════════════
    // ── DRAG SELECTION BOX ──
    // ════════════════════════════════════════════
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartScrollX = 0;
    let dragStartScrollY = 0;
    const dragMinDistance = 5;
    let dragStarted = false;
    let preSelectionSnapshot = new Set();
    let autoScrollRAF = null;
    let lastMouseEvent = null;

    // Auto-scroll speed constants
    const SCROLL_ZONE = 60; // px from edge to trigger scroll
    const SCROLL_SPEED = 8; // px per frame


    document.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        // Don't start drag on interactive elements or when results aren't visible
        if (e.target.closest(".card-action-btn, .btn, a, button, select, input, .header, .lightbox, .download-overlay, .fab, .toast")) return;
        if (resultsSection.style.display === "none") return;

        isDragging = true;
        dragStarted = false;

        // Store start position in client (viewport) coords + scroll offset
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        dragStartScrollX = window.scrollX;
        dragStartScrollY = window.scrollY;

        preSelectionSnapshot = new Set(selectedIds);
        lastMouseEvent = e;

        e.preventDefault();
    });

    function updateSelectionBox(e) {
        // Use client (viewport) coords for the fixed-position selection box
        const startClientX = dragStartX - (window.scrollX - dragStartScrollX);
        const startClientY = dragStartY - (window.scrollY - dragStartScrollY);
        const endClientX = e.clientX;
        const endClientY = e.clientY;

        const left = Math.min(startClientX, endClientX);
        const top = Math.min(startClientY, endClientY);
        const width = Math.abs(endClientX - startClientX);
        const height = Math.abs(endClientY - startClientY);

        selectionBox.style.left = left + "px";
        selectionBox.style.top = top + "px";
        selectionBox.style.width = width + "px";
        selectionBox.style.height = height + "px";

        // Use page coords for intersection (accounts for scroll)
        const pageStartX = dragStartX + dragStartScrollX;
        const pageStartY = dragStartY + dragStartScrollY;
        const pageEndX = e.clientX + window.scrollX;
        const pageEndY = e.clientY + window.scrollY;

        const selLeft = Math.min(pageStartX, pageEndX);
        const selTop = Math.min(pageStartY, pageEndY);
        const selRight = Math.max(pageStartX, pageEndX);
        const selBottom = Math.max(pageStartY, pageEndY);

        selectedIds = new Set(preSelectionSnapshot);

        const cards = grid.querySelectorAll(".card:not(.hidden-by-filter)");
        cards.forEach(card => {
            const r = card.getBoundingClientRect();
            // Convert card viewport rect to page coords
            const cLeft = r.left + window.scrollX;
            const cTop = r.top + window.scrollY;
            const cRight = cLeft + r.width;
            const cBottom = cTop + r.height;

            const intersects =
                selLeft < cRight &&
                selRight > cLeft &&
                selTop < cBottom &&
                selBottom > cTop;

            const videoId = card.dataset.id;
            if (intersects) {
                selectedIds.add(videoId);
                card.classList.add("selected");
            } else if (preSelectionSnapshot.has(videoId)) {
                card.classList.add("selected");
            } else {
                card.classList.remove("selected");
            }
        });

        updateSelectionUI();
    }

    function autoScrollLoop() {
        if (!isDragging || !dragStarted || !lastMouseEvent) return;

        const viewportY = lastMouseEvent.clientY;
        const viewportHeight = window.innerHeight;
        let scrollDelta = 0;

        // Near bottom edge → scroll down
        if (viewportY > viewportHeight - SCROLL_ZONE) {
            scrollDelta = SCROLL_SPEED * ((viewportY - (viewportHeight - SCROLL_ZONE)) / SCROLL_ZONE);
        }
        // Near top edge → scroll up
        else if (viewportY < SCROLL_ZONE + 56) { // 56 = header height
            scrollDelta = -SCROLL_SPEED * (((SCROLL_ZONE + 56) - viewportY) / SCROLL_ZONE);
        }

        if (scrollDelta !== 0) {
            window.scrollBy(0, scrollDelta);
            // Update the selection box to reflect the new scroll position
            updateSelectionBox(lastMouseEvent);
        }

        autoScrollRAF = requestAnimationFrame(autoScrollLoop);
    }

    document.addEventListener("mousemove", (e) => {
        if (!isDragging) return;

        lastMouseEvent = e;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY + (window.scrollY - dragStartScrollY);

        if (!dragStarted) {
            if (Math.abs(dx) < dragMinDistance && Math.abs(dy) < dragMinDistance) return;
            dragStarted = true;
            document.body.classList.add("is-dragging");
            selectionBox.style.display = "block";
            // Start auto-scroll loop
            autoScrollRAF = requestAnimationFrame(autoScrollLoop);
        }

        updateSelectionBox(e);
    });

    document.addEventListener("mouseup", (e) => {
        if (!isDragging) return;

        const wasDragStarted = dragStarted;
        isDragging = false;
        dragStarted = false;
        lastMouseEvent = null;
        document.body.classList.remove("is-dragging");
        selectionBox.style.display = "none";

        // Stop auto-scroll
        if (autoScrollRAF) {
            cancelAnimationFrame(autoScrollRAF);
            autoScrollRAF = null;
        }

        if (wasDragStarted) {
            grid.querySelectorAll(".card").forEach(c => { c._skipClick = true; });
            requestAnimationFrame(() => {
                grid.querySelectorAll(".card").forEach(c => { c._skipClick = false; });
            });
        }

        // Click on empty space anywhere → deselect all
        if (!wasDragStarted) {
            const clickedCard = e.target.closest(".card");
            const clickedInteractive = e.target.closest(".btn, button, a, select, input, .header, .lightbox, .download-overlay, .fab, .toast");
            if (!clickedCard && !clickedInteractive && resultsSection.style.display !== "none") {
                selectedIds.clear();
                grid.querySelectorAll(".card").forEach(c => c.classList.remove("selected"));
                updateSelectionUI();
            }
        }
    });

    gridWrap.addEventListener("selectstart", (e) => {
        if (isDragging) e.preventDefault();
    });

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
            document.querySelectorAll(".filter-btn").forEach(b => b.classList.toggle("active", b.dataset.filter === "all"));

            $("#channelAvatar").src = channelData.thumbnail;
            $("#channelTitle").textContent = channelData.title;
            $("#channelStats").textContent =
                `${formatNumber(channelData.subscriber_count)} subscribers · ${formatNumber(channelData.video_count)} videos`;

            renderVideos(allVideos);
            updateSelectionUI();

            heroSection.style.display = "none";
            resultsSection.style.display = "block";
            headerActions.style.display = "flex";
            loadMoreWrap.style.display = "none";

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
        if (!nextPageToken || !uploadsPlaylist || isLoadingMore) return;
        isLoadingMore = true;
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
        } catch (err) {
            showToast("Network error.");
        } finally {
            isLoadingMore = false;
        }
    }

    // ── Download single ──
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

    // ── Download ZIP ──
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
                    } catch (e) { /* skip */ }
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
        fab.style.display = "none";
        grid.innerHTML = "";
        allVideos = [];
        selectedIds.clear();
        nextPageToken = null;
        channelData = null;
        currentFilter = "all";
        channelInput.value = "";
        channelInput.focus();
        toolbarObserver.disconnect();
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

    // ── Infinite scroll ──
    window.addEventListener("scroll", () => {
        if (!nextPageToken || isLoadingMore || resultsSection.style.display === "none") return;
        const scrollBottom = window.innerHeight + window.scrollY;
        const threshold = document.body.offsetHeight - 800;
        if (scrollBottom >= threshold) {
            loadMore();
        }
    });

    btnSelectAll.addEventListener("click", () => {
        allVideos.forEach(v => {
            if (currentFilter === "long" && v.is_short) return;
            if (currentFilter === "shorts" && !v.is_short) return;
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

    btnDownloadZip.addEventListener("click", downloadZip);
    fabDownloadZip.addEventListener("click", downloadZip);
    fabScrollTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
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
