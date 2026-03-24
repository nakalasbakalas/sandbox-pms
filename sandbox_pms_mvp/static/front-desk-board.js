(function () {
  const root = document.querySelector("[data-front-desk-board]");
  const surface = document.getElementById("front-desk-board-surface");
  if (!root || !surface) {
    return;
  }

  const csrfToken = root.dataset.csrfToken || "";
  const canEdit = root.dataset.canEdit === "true";
  const feedback = root.querySelector("[data-board-feedback]");
  const searchForm = root.querySelector("[data-board-search-form]");
  const searchInput = root.querySelector("[data-board-search-input]");
  const surfaceContent = surface.querySelector("[data-board-surface-content]");
  const surfaceSkeleton = surface.querySelector("[data-board-skeleton]");
  const panelEl = document.getElementById("board-side-panel");
  const panelTitle = document.querySelector("[data-panel-title]");
  const panelContent = document.querySelector(".panel-content");
  const panelCloseBtn = document.querySelector("[data-action='close-panel']");
  let mutationInFlight = false;
  let selectedBlock = null;
  let moveMode = false;
  let moveTargetRoomId = null;
  let moveTargetTrack = null;
  let resizeMode = false;
  let resizeTargetEndDate = null;
  let boardSearchSubmitTimer = null;
  let lastSubmittedSearchValue = searchInput ? searchInput.value.trim() : "";
  let panelReservationId = "";
  let preferencesSaveTimer = null;
  const DEFAULT_BOARD_STATE = {
    version: 2,
    density: "compact",
    activeRoleView: "",
    activeFilters: [],
    defaultQuickFilters: [],
    hkOverlay: false,
    collapsedGroups: [],
    toolbarCollapsed: false,
    savedViews: [],
  };
  const QUEUE_FILTER_MAP = {
    ready_arrivals: ["ready-arrival"],
    blocked_arrivals: ["blocked-arrival"],
    dirty_turnarounds: ["dirty"],
    unallocated_arrivals: ["unallocated"],
    unpaid_arrivals: ["balance-due"],
    special_requests: ["special-request"],
  };
  let boardState = normalizeBoardState(readInitialBoardState());

  function readInitialBoardState() {
    try {
      return JSON.parse(root.dataset.boardState || "{}");
    } catch (_) {
      return {};
    }
  }

  function normalizeStringList(value) {
    return Array.isArray(value)
      ? value.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
  }

  function normalizeSavedViews(value) {
    return Array.isArray(value)
      ? value
          .filter((item) => item && typeof item === "object" && String(item.name || "").trim())
          .map((item) => ({
            name: String(item.name || "").trim().slice(0, 40),
            filters: normalizeStringList(item.filters),
            hkOverlay: Boolean(item.hkOverlay),
            activeRoleView: String(item.activeRoleView || "").trim(),
          }))
      : [];
  }

  function normalizeBoardState(raw) {
    const candidate = raw && typeof raw === "object" ? raw : {};
    return {
      ...DEFAULT_BOARD_STATE,
      ...candidate,
      density: String(candidate.density || DEFAULT_BOARD_STATE.density),
      activeRoleView: String(candidate.activeRoleView || ""),
      activeFilters: normalizeStringList(candidate.activeFilters),
      defaultQuickFilters: normalizeStringList(candidate.defaultQuickFilters),
      hkOverlay: Boolean(candidate.hkOverlay),
      collapsedGroups: normalizeStringList(candidate.collapsedGroups),
      toolbarCollapsed: Boolean(candidate.toolbarCollapsed),
      savedViews: normalizeSavedViews(candidate.savedViews),
    };
  }

  function writeBoardStateToRoot() {
    root.dataset.boardState = JSON.stringify(boardState);
  }

  function setBusyState(isBusy) {
    mutationInFlight = isBusy;
    root.dataset.busy = isBusy ? "true" : "false";
    surface.setAttribute("aria-busy", isBusy || surface.classList.contains("is-loading") ? "true" : "false");
  }

  function setSurfaceLoading(isLoading) {
    surface.classList.toggle("is-loading", isLoading);
    if (surfaceSkeleton) {
      surfaceSkeleton.hidden = !isLoading;
    }
    surface.setAttribute("aria-busy", isLoading || mutationInFlight ? "true" : "false");
  }

  function setFeedback(message, tone, options) {
    if (!feedback) {
      return;
    }
    const allowHtml = Boolean(options && options.allowHtml);
    if (allowHtml) {
      feedback.innerHTML = message || "";
    } else {
      feedback.textContent = message || "";
    }
    feedback.dataset.tone = tone || "neutral";
    feedback.hidden = !message;
  }

  function focusBlockHandle(blockEl) {
    if (!blockEl) {
      return;
    }
    const summary = blockEl.querySelector("summary[data-block-handle]");
    if (summary && typeof summary.focus === "function") {
      summary.focus();
      return;
    }
    if (typeof blockEl.focus === "function") {
      blockEl.focus();
    }
  }

  function selectBlock(blockEl) {
    if (!blockEl || !blockEl.dataset.boardBlock) {
      return;
    }
    if (selectedBlock === blockEl) {
      return;
    }
    if (selectedBlock) {
      selectedBlock.classList.remove("selected");
    }
    selectedBlock = blockEl;
    blockEl.classList.add("selected");
    focusBlockHandle(blockEl);
    announceSelection(blockEl);
  }

  function announceSelection(blockEl) {
    const summary = blockEl.querySelector("summary[data-block-handle]");
    if (summary && summary.getAttribute("aria-label")) {
      const label = summary.getAttribute("aria-label");
      setFeedback(`Selected: ${label}`, "neutral");
    }
  }

  function clearSelection() {
    if (selectedBlock) {
      selectedBlock.classList.remove("selected");
      selectedBlock = null;
      setFeedback("", "neutral");
    }
  }

  function clearBoardSearchTimer() {
    if (boardSearchSubmitTimer) {
      clearTimeout(boardSearchSubmitTimer);
      boardSearchSubmitTimer = null;
    }
  }

  function submitBoardSearchIfChanged() {
    if (!searchForm || !searchInput) {
      return;
    }
    clearBoardSearchTimer();
    const normalizedQuery = searchInput.value.trim();
    if (normalizedQuery === lastSubmittedSearchValue) {
      return;
    }
    lastSubmittedSearchValue = normalizedQuery;
    setSurfaceLoading(true);
    if (typeof searchForm.requestSubmit === "function") {
      searchForm.requestSubmit();
      return;
    }
    searchForm.submit();
  }

  function initializeBoardSearch() {
    if (!searchForm || !searchInput) {
      return;
    }
    searchForm.addEventListener("submit", () => {
      clearBoardSearchTimer();
      lastSubmittedSearchValue = searchInput.value.trim();
    });
    searchInput.addEventListener("input", () => {
      clearBoardSearchTimer();
      boardSearchSubmitTimer = window.setTimeout(submitBoardSearchIfChanged, 250);
    });
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        clearBoardSearchTimer();
      }
    });
  }

  function getBlocksInTrack(track) {
    if (!track) return [];
    return Array.from(track.querySelectorAll("[data-board-block]"));
  }

  function getBoardTracks() {
    return Array.from(surface.querySelectorAll("[data-board-track]"));
  }

  function getBlockTrack(block) {
    return block ? block.closest("[data-board-track]") : null;
  }

  function getBlockCenterColumn(block) {
    const start = Number(block?.dataset.gridStart || 1);
    const span = Number(block?.dataset.gridSpan || 1);
    return start + (span - 1) / 2;
  }

  function getClosestBlockInTrack(referenceBlock, track) {
    const blocks = getBlocksInTrack(track);
    if (!blocks.length) {
      return null;
    }
    const referenceCenter = getBlockCenterColumn(referenceBlock);
    return blocks.reduce((best, candidate) => {
      if (!best) {
        return candidate;
      }
      const bestDistance = Math.abs(getBlockCenterColumn(best) - referenceCenter);
      const candidateDistance = Math.abs(getBlockCenterColumn(candidate) - referenceCenter);
      if (candidateDistance < bestDistance) {
        return candidate;
      }
      return best;
    }, null);
  }

  function findAdjacentBlock(direction) {
    if (!selectedBlock) {
      return null;
    }
    const currentTrack = getBlockTrack(selectedBlock);
    if (!currentTrack) {
      return null;
    }
    const tracks = getBoardTracks();
    const currentIndex = tracks.indexOf(currentTrack);
    if (currentIndex === -1) {
      return null;
    }
    for (let index = currentIndex + direction; index >= 0 && index < tracks.length; index += direction) {
      const candidate = getClosestBlockInTrack(selectedBlock, tracks[index]);
      if (candidate) {
        return candidate;
      }
    }
    return null;
  }

  function isCompatibleMoveTrack(block, candidateTrack) {
    if (!block || !candidateTrack) {
      return false;
    }
    const sourceTrack = getBlockTrack(block);
    const sourceRoomId = sourceTrack?.dataset.roomId || "";
    const candidateRoomId = candidateTrack.dataset.roomId || "";
    const candidateRoomTypeId = candidateTrack.dataset.roomTypeId || "";
    const candidateLaneKind = candidateTrack.dataset.laneKind || "room";
    const blockRoomTypeId = block.dataset.roomTypeId || "";

    if (candidateRoomTypeId && blockRoomTypeId && candidateRoomTypeId !== blockRoomTypeId) {
      return false;
    }
    if (sourceRoomId && !candidateRoomId) {
      return false;
    }
    if (candidateLaneKind === "unallocated") {
      return candidateTrack === sourceTrack;
    }
    return true;
  }

  function describeTrack(track) {
    return track?.getAttribute("aria-label") || track?.dataset.anchorId || "selected lane";
  }

  function setMoveTarget(track) {
    if (!selectedBlock || !track) {
      return false;
    }
    clearTrackHighlights();
    moveTargetTrack = track;
    moveTargetRoomId = track.dataset.roomId || "";
    track.classList.add(isCompatibleMoveTrack(selectedBlock, track) ? "drop-target" : "drop-target-invalid");
    return isCompatibleMoveTrack(selectedBlock, track);
  }

  function moveTargetBy(direction) {
    if (!selectedBlock) {
      return;
    }
    const tracks = getBoardTracks();
    const currentTrack = moveTargetTrack || getBlockTrack(selectedBlock);
    const currentIndex = tracks.indexOf(currentTrack);
    if (currentIndex === -1) {
      return;
    }
    for (let index = currentIndex + direction; index >= 0 && index < tracks.length; index += direction) {
      const candidateTrack = tracks[index];
      if (isCompatibleMoveTrack(selectedBlock, candidateTrack)) {
        setMoveTarget(candidateTrack);
        setFeedback(`Move target: ${describeTrack(candidateTrack)}. Enter to confirm.`, "neutral");
        return;
      }
    }
    setFeedback("No more compatible room lanes in that direction.", "neutral");
  }

  function moveSelectionUp() {
    const candidate = findAdjacentBlock(-1);
    if (candidate) {
      selectBlock(candidate);
    }
  }

  function moveSelectionDown() {
    const candidate = findAdjacentBlock(1);
    if (candidate) {
      selectBlock(candidate);
    }
  }

  function enterMoveMode() {
    if (!selectedBlock || selectedBlock.dataset.draggable !== "true") {
      return;
    }
    moveMode = true;
    setMoveTarget(getBlockTrack(selectedBlock));
    selectedBlock.classList.add("move-mode");
    setFeedback("Move mode: Use ↑↓ to select room. Enter to confirm. Esc to cancel.", "neutral");
  }

  function exitMoveMode(canceled = false) {
    moveMode = false;
    moveTargetRoomId = null;
    moveTargetTrack = null;
    clearTrackHighlights();
    if (selectedBlock) {
      selectedBlock.classList.remove("move-mode");
    }
    if (canceled) {
      setFeedback("Move cancelled.", "neutral");
    }
  }

  function enterResizeMode() {
    if (!selectedBlock || selectedBlock.dataset.resizable !== "true") {
      return;
    }
    resizeMode = true;
    resizeTargetEndDate = selectedBlock.dataset.endDate || "";
    selectedBlock.classList.add("resize-mode");
    setFeedback("Resize mode: Use ← → to adjust checkout date. Enter to confirm. Esc to cancel.", "neutral");
  }

  function exitResizeMode(canceled = false) {
    resizeMode = false;
    resizeTargetEndDate = null;
    if (selectedBlock) {
      selectedBlock.classList.remove("resize-mode");
    }
    if (canceled) {
      setFeedback("Resize cancelled.", "neutral");
    }
  }

  function parseIsoDate(value) {
    const [year, month, day] = String(value || "").split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  function formatIsoDate(value) {
    return value.toISOString().slice(0, 10);
  }

  function addDays(value, delta) {
    const next = parseIsoDate(value);
    next.setUTCDate(next.getUTCDate() + delta);
    return formatIsoDate(next);
  }

  function readBoardDays(track) {
    const candidates = [
      track.style.getPropertyValue("--board-days"),
      getComputedStyle(track).getPropertyValue("--board-days"),
      track.closest(".planning-board-grid")?.style.getPropertyValue("--board-days"),
      track.closest(".planning-board-grid")
        ? getComputedStyle(track.closest(".planning-board-grid")).getPropertyValue("--board-days")
        : "",
    ];
    for (const candidate of candidates) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return 14;
  }

  function escapeSelectorValue(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(String(value || ""));
    }
    return String(value || "").replace(/["\\]/g, "\\$&");
  }

  function findBlockByReservationId(reservationId) {
    if (!reservationId) {
      return null;
    }
    return surface.querySelector(`[data-board-block][data-reservation-id="${escapeSelectorValue(reservationId)}"]`);
  }

  function scrollToBoardAnchor(anchorId) {
    if (!anchorId) {
      return;
    }
    const target = document.getElementById(anchorId) || document.getElementById(`mobile-${anchorId}`);
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  async function refreshSurface(options = {}) {
    const reservationId = options.reservationId || panelReservationId || selectedBlock?.dataset.reservationId || "";
    const reopenPanel = Boolean(options.reopenPanel && reservationId);
    const target = new URL(root.dataset.fragmentUrl, window.location.origin);
    target.search = window.location.search;
    setSurfaceLoading(true);
    const response = await fetch(target.toString(), {
      headers: { Accept: "text/html" },
      credentials: "same-origin",
    });
    if (!response.ok) {
      setSurfaceLoading(false);
      throw new Error("Unable to refresh the planning board.");
    }
    const html = await response.text();
    if (surfaceContent) {
      surfaceContent.style.visibility = "hidden";
      surfaceContent.innerHTML = html;
    } else {
      surface.style.visibility = "hidden";
      surface.innerHTML = html;
    }
    setSurfaceLoading(false);
    reapplyBoardState();
    const nextBlock = reservationId ? findBlockByReservationId(reservationId) : null;
    if (nextBlock) {
      selectBlock(nextBlock);
    } else if (!reopenPanel) {
      clearSelection();
    }
    if (surfaceContent) surfaceContent.style.visibility = "";
    else surface.style.visibility = "";
    if (reopenPanel && reservationId) {
      await loadPanelForReservation(reservationId, nextBlock, { silent: true });
    }
  }

  function clearTrackHighlights() {
    surface
      .querySelectorAll(".planning-board-track.drop-target, .planning-board-track.drop-target-invalid")
      .forEach((track) => {
        track.classList.remove("drop-target", "drop-target-invalid");
      });
  }

  function resolveSummaryTarget(target) {
    return target instanceof Element ? target.closest("summary[data-block-handle]") : null;
  }

  function applyPreview(block, gridStart, gridSpan) {
    block.dataset.previewGridStart = String(gridStart);
    block.dataset.previewGridSpan = String(gridSpan);
    block.style.gridColumn = `${gridStart} / span ${gridSpan}`;
    block.style.gridRow = "1";
  }

  function revertPreview(interaction) {
    interaction.block.classList.remove("is-dragging", "is-pending");
    interaction.block.style.gridColumn = `${interaction.originalGridStart} / span ${interaction.originalGridSpan}`;
    interaction.block.style.gridRow = "";
    interaction.block.dataset.previewGridStart = "";
    interaction.block.dataset.previewGridSpan = "";
    interaction.block.dataset.suppressClick = "false";
    if (interaction.originalParent && interaction.block.parentElement !== interaction.originalParent) {
      interaction.originalParent.insertBefore(interaction.block, interaction.originalNextSibling);
    }
  }

  function isCompatibleTrack(interaction, candidateTrack) {
    if (!candidateTrack) {
      return false;
    }
    const candidateRoomId = candidateTrack.dataset.roomId || "";
    const candidateRoomTypeId = candidateTrack.dataset.roomTypeId || "";
    const candidateLaneKind = candidateTrack.dataset.laneKind || "room";
    const blockRoomTypeId = interaction.block.dataset.roomTypeId || "";

    if (candidateRoomTypeId && blockRoomTypeId && candidateRoomTypeId !== blockRoomTypeId) {
      return false;
    }
    if (interaction.originalRoomId && !candidateRoomId) {
      return false;
    }
    if (candidateLaneKind === "unallocated") {
      return candidateTrack === interaction.originalTrack;
    }
    return true;
  }

  async function readJsonResponse(response) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return response.json();
    }
    return { ok: response.ok, error: (await response.text()) || "The board change was rejected." };
  }

  /**
   * Build a user-readable conflict message from a 409 result that may contain serverState.
   * Injects a "Refresh board" link directly into the feedback area.
   */
  function handleConflictResult(result) {
    const baseMsg = result.error || "The change could not be saved due to a conflict.";
    if (result.serverState) {
      const ss = result.serverState;
      const lines = [baseMsg];
      if (ss.currentCheckInDate && ss.currentCheckOutDate) {
        lines.push(`Current dates: ${ss.currentCheckInDate} → ${ss.currentCheckOutDate}`);
      }
      lines.push("");
      if (!feedback) return;
      feedback.textContent = lines.filter(Boolean).join(" — ");
      // Append a Refresh link so staff can immediately resync without full page reload
      const refreshBtn = document.createElement("button");
      refreshBtn.type = "button";
      refreshBtn.className = "button-link";
      refreshBtn.style.cssText = "margin-left:10px;color:var(--accent-soft);text-decoration:underline;";
      refreshBtn.textContent = "Refresh board";
      refreshBtn.addEventListener("click", async () => {
        clearSelection();
        setFeedback("Refreshing...", "pending");
        try { await refreshSurface(); setFeedback("Board refreshed.", "success"); }
        catch { setFeedback("Refresh failed.", "error"); }
      });
      feedback.appendChild(refreshBtn);
      feedback.dataset.tone = "error";
      feedback.hidden = false;
    } else {
      setFeedback(baseMsg, "error");
    }
  }

  function onSurfaceClick(event) {
    const summary = resolveSummaryTarget(event.target);
    if (!summary) {
      return;
    }
    const block = summary.closest("[data-board-block]");
    if (!block) {
      return;
    }

    // Select the block on click
    selectBlock(block);

    if (block.dataset.suppressClick === "true") {
      block.dataset.suppressClick = "false";
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Single click on reservation blocks opens side panel directly
    // for fast check-in/check-out without leaving the board
    if (block.dataset.reservationId) {
      event.preventDefault(); // Prevent <details> toggle
      openPanel(block);
      return;
    }
    // Non-reservation blocks (closures, external blocks, etc.) allow
    // the default <details> popover to open for inline editing
  }

  function onSurfaceKeydown(event) {
    // Handle escape to close popover or clear selection or exit mode
    if (event.key === "Escape") {
      if (moveMode) {
        exitMoveMode(true);
        return;
      }
      if (resizeMode) {
        exitResizeMode(true);
        return;
      }
      const openContainer =
        (event.target instanceof Element && event.target.closest("[data-board-block][open]")) ||
        (event.target instanceof Element && event.target.closest(".planning-board-quick[open]"));
      if (openContainer) {
        openContainer.removeAttribute("open");
        setFeedback("", "neutral");
      } else {
        clearSelection();
      }
      return;
    }

    if (!selectedBlock) {
      return;
    }

    // In move mode: arrow keys navigate room targets without requiring focus on the block element.
    if (moveMode) {
      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          moveTargetBy(-1);
          break;
        case "ArrowDown":
          event.preventDefault();
          moveTargetBy(1);
          break;
        case "Enter":
          event.preventDefault();
          submitMove();
          break;
        default:
          break;
      }
      return;
    }

    // In resize mode: arrow keys adjust end date without pointer dragging.
    if (resizeMode) {
      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          resizeTargetEndDate = addDays(resizeTargetEndDate, -1);
          setFeedback(`Checkout adjusted to ${resizeTargetEndDate}`, "neutral");
          break;
        case "ArrowRight":
          event.preventDefault();
          resizeTargetEndDate = addDays(resizeTargetEndDate, 1);
          setFeedback(`Checkout adjusted to ${resizeTargetEndDate}`, "neutral");
          break;
        case "Enter":
          event.preventDefault();
          submitResize();
          break;
        default:
          break;
      }
      return;
    }

    // Normal navigation mode
    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        moveSelectionUp();
        break;
      case "ArrowDown":
        event.preventDefault();
        moveSelectionDown();
        break;
      case "m":
      case "M":
        if (!canEdit || mutationInFlight) return;
        event.preventDefault();
        enterMoveMode();
        break;
      case "r":
      case "R":
        if (!canEdit || mutationInFlight) return;
        event.preventDefault();
        enterResizeMode();
        break;
      case "Enter":
        event.preventDefault();
        openPanel(selectedBlock);
        break;
      default:
        break;
    }
  }

  async function submitMove() {
    if (!selectedBlock || !selectedBlock.dataset.moveUrl) {
      setFeedback("Move is not available for this block.", "error");
      return;
    }

    exitMoveMode(false);
    selectedBlock.classList.add("is-pending");
    setBusyState(true);
    setFeedback("Saving move...", "pending");

    const payload = {
      roomId: moveTargetRoomId || null,
      checkInDate: selectedBlock.dataset.startDate,
      checkOutDate: selectedBlock.dataset.endDate,
    };

    try {
      const response = await fetch(selectedBlock.dataset.moveUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify(payload),
      });
      const result = await readJsonResponse(response);
      if (!response.ok || !result.ok) {
        handleConflictResult(result);
        return;
      }
      setFeedback(result.message || "Block moved.", "success");
      await refreshSurface({ reservationId: selectedBlock.dataset.reservationId || "" });
    } catch (error) {
      setFeedback(error.message || "The move was rejected.", "error");
    } finally {
      selectedBlock.classList.remove("is-pending");
      setBusyState(false);
    }
  }

  async function submitResize() {
    if (!selectedBlock || !selectedBlock.dataset.resizeUrl) {
      setFeedback("Resize is not available for this block.", "error");
      return;
    }

    exitResizeMode(false);
    selectedBlock.classList.add("is-pending");
    setBusyState(true);
    setFeedback("Saving resize...", "pending");

    const payload = {
      roomId: selectedBlock.dataset.roomId || null,
      checkInDate: selectedBlock.dataset.startDate,
      checkOutDate: resizeTargetEndDate,
    };

    try {
      const response = await fetch(selectedBlock.dataset.resizeUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify(payload),
      });
      const result = await readJsonResponse(response);
      if (!response.ok || !result.ok) {
        handleConflictResult(result);
        return;
      }
      setFeedback(result.message || "Block resized.", "success");
      await refreshSurface({ reservationId: selectedBlock.dataset.reservationId || "" });
    } catch (error) {
      setFeedback(error.message || "The resize was rejected.", "error");
    } finally {
      selectedBlock.classList.remove("is-pending");
      setBusyState(false);
    }
  }

  function onSurfacePointerDown(event) {
    // Prevent dragging when panel is open
    if (!panelEl.classList.contains("hidden")) {
      return;
    }

    if (!canEdit || mutationInFlight) {
      return;
    }
    if (typeof event.button === "number" && event.button !== 0) {
      return;
    }
    const summary = resolveSummaryTarget(event.target);
    if (!summary) {
      return;
    }
    const block = summary.closest("[data-board-block]");
    if (!block || block.classList.contains("is-pending")) {
      return;
    }
    const resizeHandle = event.target.closest("[data-resize-handle]");
    const mode = resizeHandle ? `resize-${resizeHandle.dataset.resizeHandle}` : "move";
    const dragPolicy = block.dataset.dragPolicy || "none";
    if (mode === "move" && block.dataset.draggable !== "true") {
      return;
    }
    if (mode !== "move" && block.dataset.resizable !== "true") {
      return;
    }
    if (mode === "move" && dragPolicy === "none") {
      return;
    }

    const track = block.closest("[data-board-track]");
    if (!track) {
      return;
    }

    const boardDays = readBoardDays(track);
    const dayWidth = track.getBoundingClientRect().width / boardDays;
    const interaction = {
      block,
      summary,
      track,
      originalTrack: track,
      originalParent: block.parentElement,
      originalNextSibling: block.nextSibling,
      mode,
      dragPolicy,
      boardDays,
      dayWidth: dayWidth || 1,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originalGridStart: Number(block.dataset.gridStart || 1),
      originalGridSpan: Number(block.dataset.gridSpan || 1),
      originalStartDate: block.dataset.startDate,
      originalEndDate: block.dataset.endDate,
      originalRoomId: track.dataset.roomId || "",
      previewTrack: track,
      moved: false,
      invalidTargetAttempted: false,
    };

    block.classList.add("is-dragging");
    summary.setPointerCapture(event.pointerId);

    function removePointerListeners() {
      summary.removeEventListener("pointermove", onMove);
      summary.removeEventListener("pointerup", onEnd);
      summary.removeEventListener("pointercancel", onCancel);
    }

    function onMove(moveEvent) {
      const deltaX = moveEvent.clientX - interaction.startX;
      const deltaY = moveEvent.clientY - interaction.startY;
      const thresholdExceeded = Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6;
      if (!thresholdExceeded && !interaction.moved) {
        return;
      }
      interaction.moved = true;
      block.dataset.suppressClick = "true";

      const rawDayDelta = Math.round(deltaX / interaction.dayWidth);
      let dayDelta = rawDayDelta;
      if (interaction.dragPolicy === "room") {
        dayDelta = 0;
      }

      let targetTrack = interaction.previewTrack;
      const candidateTrack =
        interaction.mode === "move"
          ? document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest("[data-board-track]")
          : null;

      clearTrackHighlights();
      if (candidateTrack) {
        if (isCompatibleTrack(interaction, candidateTrack)) {
          interaction.invalidTargetAttempted = false;
          candidateTrack.classList.add("drop-target");
          targetTrack = candidateTrack;
        } else {
          interaction.invalidTargetAttempted = true;
          candidateTrack.classList.add("drop-target-invalid");
        }
      } else {
        interaction.invalidTargetAttempted = false;
        interaction.previewTrack.classList.add("drop-target");
      }

      if (targetTrack !== interaction.previewTrack) {
        targetTrack.appendChild(block);
        interaction.previewTrack = targetTrack;
      }

      if (interaction.mode === "move") {
        const nextGridStart = Math.max(
          1,
          Math.min(interaction.boardDays - interaction.originalGridSpan + 1, interaction.originalGridStart + dayDelta),
        );
        applyPreview(block, nextGridStart, interaction.originalGridSpan);
      } else if (interaction.mode === "resize-start") {
        const maxGridStart = interaction.originalGridStart + interaction.originalGridSpan - 1;
        const nextGridStart = Math.max(1, Math.min(maxGridStart, interaction.originalGridStart + rawDayDelta));
        applyPreview(block, nextGridStart, interaction.originalGridSpan - (nextGridStart - interaction.originalGridStart));
      } else {
        const nextGridSpan = Math.max(
          1,
          Math.min(interaction.boardDays - interaction.originalGridStart + 1, interaction.originalGridSpan + rawDayDelta),
        );
        applyPreview(block, interaction.originalGridStart, nextGridSpan);
      }
    }

    async function onEnd() {
      if (summary.hasPointerCapture(interaction.pointerId)) {
        summary.releasePointerCapture(interaction.pointerId);
      }
      removePointerListeners();
      clearTrackHighlights();

      if (!interaction.moved) {
        block.classList.remove("is-dragging");
        return;
      }

      const previewStart = Number(block.dataset.previewGridStart || interaction.originalGridStart);
      const previewSpan = Number(block.dataset.previewGridSpan || interaction.originalGridSpan);
      const roomId = interaction.previewTrack.dataset.roomId || "";
      const startDate = addDays(interaction.originalStartDate, previewStart - interaction.originalGridStart);
      const endDate = addDays(startDate, previewSpan);

      const noBoardChange =
        startDate === interaction.originalStartDate &&
        endDate === interaction.originalEndDate &&
        roomId === interaction.originalRoomId;
      if (noBoardChange) {
        revertPreview(interaction);
        if (interaction.invalidTargetAttempted) {
          setFeedback("That room lane cannot accept this reservation.", "error");
        }
        return;
      }

      block.classList.remove("is-dragging");
      block.classList.add("is-pending");
      setBusyState(true);
      setFeedback("Saving board change...", "pending");

      const payload = {
        roomId: roomId || null,
        checkInDate: startDate,
        checkOutDate: endDate,
      };
      const endpoint = interaction.mode === "move" ? block.dataset.moveUrl : block.dataset.resizeUrl;

      try {
        if (!endpoint) {
          throw new Error("The planning board action is unavailable for this block.");
        }
        const response = await fetch(endpoint, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify(payload),
        });
        const result = await readJsonResponse(response);
        if (!response.ok || !result.ok) {
          revertPreview(interaction);
          handleConflictResult(result);
          return;
        }
        setFeedback(result.message || "Board updated.", "success");
        await refreshSurface({ reservationId: block.dataset.reservationId || "" });
      } catch (error) {
        revertPreview(interaction);
        setFeedback(error.message || "The board change was rejected.", "error");
      } finally {
        block.classList.remove("is-pending");
        setBusyState(false);
      }
    }

    function onCancel() {
      if (summary.hasPointerCapture(interaction.pointerId)) {
        summary.releasePointerCapture(interaction.pointerId);
      }
      removePointerListeners();
      clearTrackHighlights();
      revertPreview(interaction);
    }

    summary.addEventListener("pointermove", onMove);
    summary.addEventListener("pointerup", onEnd);
    summary.addEventListener("pointercancel", onCancel);
  }

  // Handle density toggle buttons
  const densityToggle = document.querySelector("[data-density-toggle]");
  if (densityToggle) {
    const densityButtons = densityToggle.querySelectorAll("button[data-density]");
    densityButtons.forEach((button) => {
      button.addEventListener("click", async (e) => {
        e.preventDefault();
        const density = button.dataset.density;
        if (!density) return;

        // Update button states
        densityButtons.forEach((btn) => {
          btn.removeAttribute("data-active");
          btn.setAttribute("aria-pressed", "false");
        });
        button.setAttribute("data-active", "true");
        button.setAttribute("aria-pressed", "true");

        // Apply CSS class to grid
        const grid = document.querySelector(".planning-board-grid");
        if (grid) {
          grid.classList.remove("density-compact", "density-comfortable", "density-spacious", "density-ultra");
          grid.classList.add(`density-${density}`);
        }

        boardState = normalizeBoardState({
          ...boardState,
          density,
        });
        writeBoardStateToRoot();
        await saveBoardState({ feedbackMessage: `Layout set to ${density}.` });
      });
    });
  }

  surface.addEventListener("click", onSurfaceClick);
  surface.addEventListener("keydown", onSurfaceKeydown);
  if (canEdit) {
    surface.addEventListener("pointerdown", onSurfacePointerDown);
  }

  // ── Quick filter chips – module-level state so command strip & role views share it ──
  const activeFilters = new Set();

  function getActiveDensity() {
    const activeButton = densityToggle ? densityToggle.querySelector("[data-density][data-active='true']") : null;
    return activeButton?.dataset.density || boardState.density || DEFAULT_BOARD_STATE.density;
  }

  function isToolbarCollapsed() {
    const legend = root.querySelector(".board-legend");
    return Boolean(legend && legend.classList.contains("toolbar-hidden"));
  }

  function syncBoardStateFromUi() {
    boardState = normalizeBoardState({
      ...boardState,
      density: getActiveDensity(),
      activeFilters: [...activeFilters],
      activeRoleView,
      hkOverlay: hkOverlayActive,
      collapsedGroups: [...collapsedGroups],
      toolbarCollapsed: isToolbarCollapsed(),
    });
    writeBoardStateToRoot();
  }

  async function saveBoardState(options = {}) {
    syncBoardStateFromUi();
    try {
      const response = await fetch("/staff/front-desk/board/preferences", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ state: boardState }),
      });
      const result = await readJsonResponse(response);
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Failed to save board preference.");
      }
      boardState = normalizeBoardState(result.boardState || boardState);
      writeBoardStateToRoot();
      renderSavedViewOptions();
      if (options.feedbackMessage) {
        setFeedback(options.feedbackMessage, "success");
      }
    } catch (error) {
      if (!options.silent) {
        setFeedback(error.message || "Could not save board preference.", "error");
      }
      console.error("Board preference save error:", error);
    }
  }

  function scheduleBoardStateSave(options = {}) {
    syncBoardStateFromUi();
    if (preferencesSaveTimer) {
      window.clearTimeout(preferencesSaveTimer);
    }
    preferencesSaveTimer = window.setTimeout(() => {
      saveBoardState(options);
    }, options.immediate ? 0 : 250);
  }

  function renderSavedViewOptions() {
    const select = root.querySelector("[data-saved-view-select]");
    const deleteBtn = root.querySelector("[data-action='delete-current-view']");
    if (!select) {
      return;
    }
    const selectedValue = select.value;
    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Saved views";
    select.appendChild(placeholder);
    boardState.savedViews.forEach((view, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = view.name;
      select.appendChild(option);
    });
    if (selectedValue && boardState.savedViews[Number(selectedValue)]) {
      select.value = selectedValue;
    }
    if (deleteBtn) {
      deleteBtn.disabled = boardState.savedViews.length === 0 || !select.value;
    }
  }

  function saveDefaultFilters() {
    boardState = normalizeBoardState({
      ...boardState,
      defaultQuickFilters: [...activeFilters],
    });
    writeBoardStateToRoot();
    scheduleBoardStateSave({ feedbackMessage: "Default board filters updated." });
  }

  function saveCurrentView() {
    const suggestedName = activeRoleView ? activeRoleView.replace(/-/g, " ") : "Current board";
    const rawName = window.prompt("Save this board view as:", suggestedName);
    const name = String(rawName || "").trim();
    if (!name) {
      return;
    }
    const nextViews = [...boardState.savedViews];
    const nextView = {
      name,
      filters: [...activeFilters],
      hkOverlay: hkOverlayActive,
      activeRoleView,
    };
    const existingIndex = nextViews.findIndex((view) => view.name.toLowerCase() === name.toLowerCase());
    if (existingIndex >= 0) {
      nextViews.splice(existingIndex, 1, nextView);
    } else {
      nextViews.push(nextView);
    }
    boardState = normalizeBoardState({
      ...boardState,
      savedViews: nextViews,
    });
    writeBoardStateToRoot();
    renderSavedViewOptions();
    const select = root.querySelector("[data-saved-view-select]");
    if (select) {
      select.value = String(Math.max(0, nextViews.findIndex((view) => view.name === name)));
    }
    const deleteBtn = root.querySelector("[data-action='delete-current-view']");
    if (deleteBtn) {
      deleteBtn.disabled = false;
    }
    scheduleBoardStateSave({ feedbackMessage: `Saved view "${name}".` });
  }

  function deleteCurrentView() {
    const select = root.querySelector("[data-saved-view-select]");
    const index = select ? Number(select.value) : NaN;
    if (!Number.isInteger(index) || index < 0 || !boardState.savedViews[index]) {
      return;
    }
    const removedName = boardState.savedViews[index].name;
    const nextViews = [...boardState.savedViews];
    nextViews.splice(index, 1);
    boardState = normalizeBoardState({
      ...boardState,
      savedViews: nextViews,
    });
    writeBoardStateToRoot();
    renderSavedViewOptions();
    if (select) {
      select.value = "";
    }
    scheduleBoardStateSave({ feedbackMessage: `Deleted view "${removedName}".` });
  }

  function applySavedView(index) {
    const view = boardState.savedViews[index];
    if (!view) {
      return;
    }
    activeRoleView = view.activeRoleView || "";
    activeFilters.clear();
    (view.filters || []).forEach((filterName) => activeFilters.add(filterName));
    hkOverlayActive = Boolean(view.hkOverlay);
    syncFilterState();
    syncHkOverlayState();
    syncRoleViewState();
    applyQuickFilters();
    persistFilterState();
    scheduleBoardStateSave({ silent: true });
    setFeedback(`Applied view "${view.name}".`, "success");
  }

  function matchFilter(filterName, track) {
    const hk = track.dataset.hkStatus || "";
    switch (filterName) {
      case "dirty":       return hk.includes("dirty");
      case "vacant":      return track.dataset.isVacant === "true";
      case "arrival":     return track.dataset.hasArrivalToday === "true";
      case "departure":   return track.dataset.hasDepartureToday === "true";
      case "maintenance": return track.dataset.isMaintenance === "true" || track.dataset.isBlocked === "true";
      case "unallocated": return track.dataset.laneKind === "unallocated";
      case "in-house":    return track.dataset.isOccupied === "true";
      case "stayover":    return track.dataset.isStayover === "true";
      case "balance-due": return track.dataset.hasBalanceDue === "true";
      case "ready-arrival": return track.dataset.hasReadyArrival === "true";
      case "blocked-arrival": return track.dataset.hasBlockedArrival === "true";
      case "special-request": return track.dataset.hasSpecialRequest === "true";
      case "conflict":    return track.dataset.isConflict === "true";
      case "inspected":   return hk === "inspected";
      default:            return true;
    }
  }

  function applyQuickFilters() {
    const tracks = surface.querySelectorAll("[data-board-track]");
    tracks.forEach((track) => {
      const matches =
        activeFilters.size === 0 ? true : [...activeFilters].some((filterName) => matchFilter(filterName, track));
      track.hidden = !matches;
      const prev = track.previousElementSibling;
      if (prev && prev.classList.contains("planning-board-room") && !prev.classList.contains("heading")) {
        prev.hidden = !matches;
      }
    });
    updateNoResultsIndicator();
  }

  function syncFilterState() {
    // Sync chips in the persistent toolbar
    const quickFiltersEl = document.querySelector("[data-quick-filters]");
    if (quickFiltersEl) {
      quickFiltersEl.querySelectorAll("[data-filter]").forEach((chip) => {
        const isActive = activeFilters.has(chip.dataset.filter);
        chip.setAttribute("aria-pressed", isActive ? "true" : "false");
        chip.classList.toggle("active", isActive);
      });
    }
    // Sync command strip metric buttons (inside refreshable surface)
    surface.querySelectorAll("[data-cmd-filter]").forEach((btn) => {
      const isActive = activeFilters.has(btn.dataset.cmdFilter);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      btn.classList.toggle("active", isActive);
    });
  }

  function toggleQuickFilter(filter) {
    if (!filter) return;
    activeRoleView = "";
    if (activeFilters.has(filter)) {
      activeFilters.delete(filter);
    } else {
      activeFilters.add(filter);
    }
    syncFilterState();
    syncRoleViewState();
    applyQuickFilters();
    persistFilterState();
  }

  function resetAllFilters() {
    activeFilters.clear();
    activeRoleView = "";
    syncFilterState();
    syncRoleViewState();
    applyQuickFilters();
    persistFilterState();
    try { localStorage.setItem("board_active_view", ""); } catch (_) { /* ignore */ }
  }

  function persistFilterState() {
    try { localStorage.setItem("board_active_filters", JSON.stringify([...activeFilters])); } catch (_) { /* ignore */ }
    scheduleBoardStateSave({ silent: true });
  }

  function restoreFilterState() {
    activeFilters.clear();
    const preferredFilters = boardState.activeFilters.length
      ? boardState.activeFilters
      : boardState.defaultQuickFilters;
    if (preferredFilters.length) {
      preferredFilters.forEach((filterName) => activeFilters.add(filterName));
      return;
    }
    try {
      const saved = localStorage.getItem("board_active_filters");
      if (saved) {
        JSON.parse(saved).forEach((f) => activeFilters.add(f));
      }
    } catch (_) { /* ignore */ }
  }

  const quickFiltersEl = document.querySelector("[data-quick-filters]");
  if (quickFiltersEl) {
    quickFiltersEl.addEventListener("click", (e) => {
      if (e.target.closest("[data-action='save-default-filters']")) {
        saveDefaultFilters();
        return;
      }
      if (e.target.closest("[data-action='reset-filters']")) {
        resetAllFilters();
        return;
      }
      const chip = e.target.closest("[data-filter]");
      if (!chip) return;
      toggleQuickFilter(chip.dataset.filter);
    });
  }

  function focusQueue(queueId) {
    const mappedFilters = QUEUE_FILTER_MAP[queueId] || [];
    if (!mappedFilters.length) {
      return;
    }
    activeRoleView = "";
    activeFilters.clear();
    mappedFilters.forEach((filterName) => activeFilters.add(filterName));
    syncFilterState();
    syncRoleViewState();
    applyQuickFilters();
    persistFilterState();
    setFeedback("Focused the board on that queue.", "success");
  }

  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-action='save-current-view']")) {
      saveCurrentView();
      return;
    }
    if (event.target.closest("[data-action='delete-current-view']")) {
      deleteCurrentView();
    }
  });

  root.addEventListener("change", (event) => {
    const select = event.target.closest("[data-saved-view-select]");
    if (!select) {
      return;
    }
    const index = Number(select.value);
    if (Number.isInteger(index) && index >= 0) {
      applySavedView(index);
    }
    const deleteBtn = root.querySelector("[data-action='delete-current-view']");
    if (deleteBtn) {
      deleteBtn.disabled = !select.value;
    }
  });

  // ── Command strip: click delegation on surface (survives AJAX refresh) ──
  surface.addEventListener("click", (e) => {
    // Metric filter button (not inside a board block or track)
    const queueOpenBtn = e.target.closest("[data-queue-open]");
    if (queueOpenBtn) {
      const reservationId = queueOpenBtn.dataset.reservationId;
      const roomAnchor = queueOpenBtn.dataset.roomAnchor;
      if (roomAnchor) {
        scrollToBoardAnchor(roomAnchor);
      }
      if (reservationId) {
        const queueBlock = findBlockByReservationId(reservationId);
        if (queueBlock) {
          selectBlock(queueBlock);
          openPanel(queueBlock);
        } else {
          loadPanelForReservation(reservationId, null);
        }
      }
      return;
    }
    const queueFocusBtn = e.target.closest("[data-queue-focus]");
    if (queueFocusBtn) {
      focusQueue(queueFocusBtn.dataset.queueFocus);
      return;
    }
    const metricBtn = e.target.closest("[data-cmd-filter]");
    if (metricBtn && !metricBtn.closest("[data-board-block]") && !metricBtn.closest("[data-board-track]")) {
      toggleQuickFilter(metricBtn.dataset.cmdFilter);
      return;
    }
    // HK overlay toggle
    if (e.target.closest("[data-action='toggle-hk-overlay']")) {
      toggleHkOverlay();
      return;
    }
    // Role preset view buttons
    if (e.target.closest("[data-view-presets]")) {
      const viewBtn = e.target.closest("[data-view]");
      if (viewBtn !== null) {
        applyRoleView(viewBtn.dataset.view);
        return;
      }
    }
  });

  // ── Double-click on block: navigate to full reservation detail ──
  surface.addEventListener("dblclick", (e) => {
    const blockEl = e.target.closest("[data-board-block]");
    if (!blockEl) return;
    const detailLink = blockEl.querySelector("a[href*='/staff/reservations/']");
    if (detailLink && detailLink.href) {
      window.location.href = detailLink.href;
    }
  });

  // ── HK Overlay Mode ──
  let hkOverlayActive = false;

  function syncHkOverlayState() {
    const surfaceEl = document.getElementById("front-desk-board-surface");
    if (surfaceEl) surfaceEl.classList.toggle("hk-overlay-active", hkOverlayActive);
    surface.querySelectorAll("[data-action='toggle-hk-overlay']").forEach((btn) => {
      btn.setAttribute("aria-pressed", hkOverlayActive ? "true" : "false");
      btn.classList.toggle("active", hkOverlayActive);
    });
  }

  function toggleHkOverlay() {
    hkOverlayActive = !hkOverlayActive;
    syncHkOverlayState();
    try { localStorage.setItem("board_hk_overlay", hkOverlayActive ? "1" : "0"); } catch (_) { /* ignore */ }
    scheduleBoardStateSave({ silent: true });
  }

  function restoreHkOverlay() {
    if (boardState.hkOverlay) {
      hkOverlayActive = true;
      return;
    }
    try { hkOverlayActive = localStorage.getItem("board_hk_overlay") === "1"; } catch (_) { /* ignore */ }
  }

  // ── Role View Presets ──
  const ROLE_VIEWS = {
    "front-desk":   { filters: ["arrival", "departure"], overlay: false },
    "arrivals":     { filters: ["ready-arrival", "blocked-arrival", "unallocated", "balance-due", "special-request"], overlay: false },
    "housekeeping": { filters: ["dirty"],                overlay: true  },
    "allocation":   { filters: ["unallocated"],          overlay: false },
    "night-shift":  { filters: ["in-house"],             overlay: false },
  };

  let activeRoleView = "";

  function applyRoleView(viewName) {
    activeRoleView = viewName || "";
    activeFilters.clear();
    if (viewName && ROLE_VIEWS[viewName]) {
      const view = ROLE_VIEWS[viewName];
      (view.filters || []).forEach((f) => activeFilters.add(f));
      hkOverlayActive = Boolean(view.overlay);
    } else {
      hkOverlayActive = false;
    }
    syncFilterState();
    syncHkOverlayState();
    syncRoleViewState();
    applyQuickFilters();
    persistFilterState();
    try { localStorage.setItem("board_active_view", activeRoleView); } catch (_) { /* ignore */ }
    scheduleBoardStateSave({ silent: true });
  }

  function syncRoleViewState() {
    surface.querySelectorAll("[data-view]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === activeRoleView);
    });
  }

  function restoreRoleView() {
    activeRoleView = boardState.activeRoleView || "";
    if (activeRoleView) {
      return;
    }
    try { activeRoleView = localStorage.getItem("board_active_view") || ""; } catch (_) { /* ignore */ }
  }

  // ── Sticky shell: set CSS variable so day headers account for shell height ──
  function updateStickyOffset() {
    if (!root) return;
    document.documentElement.style.setProperty("--board-shell-h", root.offsetHeight + "px");
  }

  // ── Post-refresh: reapply all stateful board decoration ──
  function reapplyBoardState() {
    syncFilterState();
    applyQuickFilters();
    syncHkOverlayState();
    syncRoleViewState();
    renderSavedViewOptions();
    updateStickyOffset();
    initCollapsibleGroups();
  }

  // ── Collapsible room-type group headers ──
  const collapsedGroups = new Set();

  function restoreCollapsedGroups() {
    collapsedGroups.clear();
    if (boardState.collapsedGroups.length) {
      boardState.collapsedGroups.forEach((groupId) => collapsedGroups.add(groupId));
      return;
    }
    try {
      const saved = localStorage.getItem("board_collapsed_groups");
      if (saved) JSON.parse(saved).forEach((g) => collapsedGroups.add(g));
    } catch (_) { /* ignore */ }
  }

  function persistCollapsedGroups() {
    try { localStorage.setItem("board_collapsed_groups", JSON.stringify([...collapsedGroups])); } catch (_) { /* ignore */ }
    scheduleBoardStateSave({ silent: true });
  }

  function setGroupCollapsed(groupEl, collapsed) {
    const groupId = groupEl.dataset.groupId || groupEl.textContent.trim();
    groupEl.classList.toggle("collapsed", collapsed);
    groupEl.setAttribute("aria-expanded", collapsed ? "false" : "true");
    // Hide/show all rows belonging to this group until the next group header
    let sibling = groupEl.nextElementSibling;
    while (sibling && !sibling.classList.contains("planning-board-group")) {
      sibling.classList.toggle("group-hidden", collapsed);
      sibling = sibling.nextElementSibling;
    }
    if (collapsed) collapsedGroups.add(groupId);
    else collapsedGroups.delete(groupId);
    persistCollapsedGroups();
  }

  function initCollapsibleGroups() {
    surface.querySelectorAll(".planning-board-group").forEach((groupEl) => {
      groupEl.setAttribute("role", "button");
      groupEl.setAttribute("tabindex", "0");
      groupEl.setAttribute("title", "Click to collapse/expand this room group");
      const groupId = groupEl.dataset.groupId || groupEl.textContent.trim();
      if (collapsedGroups.has(groupId)) {
        setGroupCollapsed(groupEl, true);
      } else {
        groupEl.setAttribute("aria-expanded", "true");
      }
    });
  }

  surface.addEventListener("click", (e) => {
    const groupEl = e.target.closest(".planning-board-group");
    if (groupEl) {
      const isCollapsed = groupEl.classList.contains("collapsed");
      setGroupCollapsed(groupEl, !isCollapsed);
    }
  });

  surface.addEventListener("keydown", (e) => {
    const groupEl = e.target.closest(".planning-board-group");
    if (groupEl && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      const isCollapsed = groupEl.classList.contains("collapsed");
      setGroupCollapsed(groupEl, !isCollapsed);
    }
  });

  restoreCollapsedGroups();

  // ── Collapsible toolbar (legend + row2) ──
  const legendEl = root.querySelector(".board-legend");
  const row2El = root.querySelector(".planning-board-row2");
  const toolbarToggle = root.querySelector("[data-action='toggle-toolbar']");

  function setToolbarCollapsed(collapsed) {
    if (legendEl) legendEl.classList.toggle("toolbar-hidden", collapsed);
    if (row2El) row2El.classList.toggle("toolbar-hidden", collapsed);
    if (toolbarToggle) {
      toolbarToggle.setAttribute("aria-pressed", collapsed ? "true" : "false");
      toolbarToggle.title = collapsed ? "Show filters & legend" : "Hide filters & legend";
    }
    try { localStorage.setItem("board_toolbar_collapsed", collapsed ? "1" : "0"); } catch (_) { /* ignore */ }
    scheduleBoardStateSave({ silent: true });
  }

  function restoreToolbarState() {
    if (boardState.toolbarCollapsed) {
      setToolbarCollapsed(true);
      return;
    }
    try {
      const saved = localStorage.getItem("board_toolbar_collapsed");
      if (saved === "1") setToolbarCollapsed(true);
    } catch (_) { /* ignore */ }
  }

  if (toolbarToggle) {
    toolbarToggle.addEventListener("click", () => {
      const isCollapsed = legendEl && legendEl.classList.contains("toolbar-hidden");
      setToolbarCollapsed(!isCollapsed);
    });
  }

  restoreToolbarState();

  // ── Keyboard shortcuts button ──
  const shortcutsBtn = root.querySelector("[data-action='show-shortcuts']");
  if (shortcutsBtn) {
    shortcutsBtn.addEventListener("click", () => showKeyboardHelp());
  }

  // ── No-results indicator for quick filters ──
  function updateNoResultsIndicator() {
    let indicator = surface.querySelector("[data-board-no-results]");
    if (activeFilters.size === 0) {
      if (indicator) indicator.hidden = true;
      return;
    }
    const tracks = surface.querySelectorAll("[data-board-track]");
    const anyVisible = Array.from(tracks).some((t) => !t.hidden);
    if (!anyVisible) {
      if (!indicator) {
        indicator = document.createElement("div");
        indicator.dataset.boardNoResults = "";
        indicator.className = "planning-board-no-results";
        indicator.setAttribute("role", "status");
        const msg = document.createElement("p");
        msg.textContent = "No rooms match the active filters.";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "button secondary tiny";
        btn.textContent = "Clear filters";
        btn.addEventListener("click", resetAllFilters);
        indicator.appendChild(msg);
        indicator.appendChild(btn);
        const desktopSection = surface.querySelector(".planning-board-desktop");
        if (desktopSection) desktopSection.parentNode.insertBefore(indicator, desktopSection.nextSibling);
        else surface.appendChild(indicator);
      }
      indicator.hidden = false;
    } else {
      if (indicator) indicator.hidden = true;
    }
  }

  // ── Scroll to today helper (shared by indicator & initial load) ──
  const TODAY_SCROLL_OFFSET = 60;

  function scrollToToday(behavior) {
    const desktop = document.querySelector(".planning-board-desktop");
    if (!desktop) return;
    const gridEl = desktop.querySelector(".planning-board-grid");
    if (!gridEl) return;
    const todayCol = gridEl.querySelector(".planning-board-day.today");
    if (!todayCol) return;
    const containerRect = desktop.getBoundingClientRect();
    const colRect = todayCol.getBoundingClientRect();
    desktop.scrollTo({
      left: desktop.scrollLeft + colRect.left - containerRect.left - TODAY_SCROLL_OFFSET,
      behavior: behavior || "smooth",
    });
  }

  // ── Sticky today indicator ──
  const todayIndicator = document.getElementById("board-today-indicator");
  if (todayIndicator) {
    const todayHeader = surface.querySelector(".planning-board-day.today");
    if (todayHeader) {
      const todayObserver = new IntersectionObserver(
        (entries) => {
          const visible = entries[0].isIntersecting;
          todayIndicator.hidden = visible;
          todayIndicator.classList.toggle("hidden", visible);
        },
        { threshold: 0.1 }
      );
      todayObserver.observe(todayHeader);
      todayIndicator.addEventListener("click", () => scrollToToday("smooth"));
      todayIndicator.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          todayIndicator.click();
        }
      });
    }
  }

  // ── Auto-scroll to today on page load ──
  window.requestAnimationFrame(() => scrollToToday("instant"));

  // ── Occupancy heatmap classes on day headers ──
  const OCC_HIGH_THRESHOLD = 90;
  const OCC_MEDIUM_THRESHOLD = 70;
  surface.querySelectorAll(".planning-board-day[data-occupancy-pct]").forEach((dayEl) => {
    const pct = parseInt(dayEl.dataset.occupancyPct || "0", 10);
    if (pct >= OCC_HIGH_THRESHOLD) dayEl.classList.add("occ-high");
    else if (pct >= OCC_MEDIUM_THRESHOLD) dayEl.classList.add("occ-medium");
    else if (pct > 0) dayEl.classList.add("occ-low");
  });

  // ── Stats panel trigger ──
  const statsBtn = document.querySelector("[data-action='open-stats-panel']");
  if (statsBtn) {
    statsBtn.addEventListener("click", () => {
      panelTitle.textContent = "Board Stats";
      panelReservationId = "";
      setBusyState(true);
      const target = new URL("/staff/front-desk/board/stats-panel", window.location.origin);
      target.search = window.location.search;
      fetch(target.toString(), { headers: { Accept: "text/html" }, credentials: "same-origin" })
        .then((r) => r.ok ? r.text() : Promise.reject())
        .then((html) => {
          panelContent.innerHTML = html;
          panelEl.classList.remove("hidden");
          panelEl.removeAttribute("inert");
          panelEl.setAttribute("aria-hidden", "false");
          panelCloseBtn.focus();
        })
        .catch(() => setFeedback("Stats unavailable.", "error"))
        .finally(() => setBusyState(false));
    });
  }

  // ── Shift handover panel trigger ──
  const handoverBtn = document.querySelector("[data-action='open-handover-panel']");
  if (handoverBtn) {
    handoverBtn.addEventListener("click", () => {
      panelTitle.textContent = "Shift Handover";
      panelReservationId = "";
      setBusyState(true);
      const target = new URL("/staff/front-desk/board/handover-panel", window.location.origin);
      target.search = window.location.search;
      fetch(target.toString(), { headers: { Accept: "text/html" }, credentials: "same-origin" })
        .then((r) => r.ok ? r.text() : Promise.reject())
        .then((html) => {
          panelContent.innerHTML = html;
          panelEl.classList.remove("hidden");
          panelEl.removeAttribute("inert");
          panelEl.setAttribute("aria-hidden", "false");
          panelCloseBtn.focus();
        })
        .catch(() => setFeedback("Handover data unavailable.", "error"))
        .finally(() => setBusyState(false));
    });
  }

  // Side panel for reservation details

  async function loadPanelForReservation(reservationId, blockEl, options = {}) {
    if (!reservationId) {
      setFeedback("Cannot open panel for this block.", "error");
      return;
    }
    const summary = blockEl ? blockEl.querySelector("summary[data-block-handle]") : null;
    const label = summary ? summary.getAttribute("aria-label") : "Reservation Details";

    panelTitle.textContent = label || "Reservation Details";
    panelReservationId = reservationId;

    setBusyState(true);
    if (!options.silent) {
      setFeedback("Loading details...", "pending");
    }

    try {
      const response = await fetch(`/staff/front-desk/board/reservations/${reservationId}/panel`, {
        headers: { Accept: "text/html" },
        credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error("Failed to load panel");
      }
      const html = await response.text();
      panelContent.innerHTML = html;
      panelEl.classList.remove("hidden");
      panelEl.removeAttribute("inert");
      panelEl.setAttribute("aria-hidden", "false");
      if (!options.silent) {
        setFeedback("", "neutral");
      }
      attachPanelHandlers();
      panelCloseBtn.focus();
    } catch (err) {
      setFeedback(err.message || "Failed to load panel.", "error");
    } finally {
      setBusyState(false);
    }
  }

  function openPanel(blockEl) {
    if (!blockEl || !blockEl.dataset.reservationId) {
      setFeedback("Cannot open panel for this block.", "error");
      return;
    }
    loadPanelForReservation(blockEl.dataset.reservationId, blockEl);
  }

  function closePanel(options = {}) {
    panelEl.classList.add("hidden");
    panelEl.setAttribute("inert", "");
    panelEl.setAttribute("aria-hidden", "true");
    panelContent.innerHTML = "";
    panelReservationId = "";
    if (!options.skipFocus && selectedBlock) {
      focusBlockHandle(selectedBlock);
    }
  }

  function attachPanelHandlers() {
    // Handle form submissions within panel
    const forms = panelContent.querySelectorAll("form");
    forms.forEach(form => {
      form.addEventListener("submit", handlePanelFormSubmit);
    });

    // Handle quick action buttons
    const buttons = panelContent.querySelectorAll("[data-action='check-in'], [data-action='check-out']");
    buttons.forEach(btn => {
      btn.addEventListener("click", handlePanelQuickAction);
    });
  }

  async function handlePanelFormSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const reservationId =
      panelContent.querySelector("[data-panel-reservation-id]")?.dataset.panelReservationId || panelReservationId;
    setBusyState(true);
    setFeedback("Saving...", "pending");

    try {
      const response = await fetch(form.action, {
        method: form.method || "POST",
        body: new FormData(form),
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const result = await readJsonResponse(response);
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Save failed");
      }

      setFeedback(result.message || "Saved successfully.", "success");
      await refreshSurface({ reopenPanel: true, reservationId });
    } catch (err) {
      setFeedback(err.message || "Save failed.", "error");
    } finally {
      setBusyState(false);
    }
  }

  async function handlePanelQuickAction(event) {
    event.preventDefault();
    const button = event.target;
    const action = button.dataset.action;
    const reservationId = button.dataset.reservationId;

    if (!action || !reservationId) return;

    setBusyState(true);
    setFeedback(`${action === 'check-in' ? 'Checking in' : 'Checking out'}...`, "pending");

    try {
      const url = action === 'check-in'
        ? `/staff/front-desk/board/reservations/${reservationId}/check_in`
        : `/staff/front-desk/board/reservations/${reservationId}/check_out`;

      const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "X-CSRF-Token": csrfToken },
      });

      const result = await readJsonResponse(response);
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Action failed.");
      }

      setFeedback(result.message || "Action completed.", "success");
      await refreshSurface({ reopenPanel: true, reservationId });
    } catch (err) {
      setFeedback(err.message || "Action failed.", "error");
    } finally {
      setBusyState(false);
    }
  }

  // Wire panel controls
  panelCloseBtn.addEventListener("click", closePanel);
  panelEl.addEventListener("click", (e) => {
    if (e.target === panelEl) closePanel();
  });
  panelEl.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
      return;
    }
    // Focus trap: keep Tab within the panel while it is open.
    // Guard against spurious events when the panel is off-screen.
    if (event.key !== "Tab" || panelEl.classList.contains("hidden")) {
      return;
    }
    const focusable = Array.from(
      panelEl.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.hidden && el.offsetWidth > 0 && el.offsetHeight > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  // Global keyboard shortcuts for quick actions
  document.addEventListener("keydown", (event) => {
    // Ignore if user is typing in input/textarea
    if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) {
      return;
    }

    switch (event.key) {
      case "/":
        event.preventDefault();
        openSearchPanel();
        break;
      case "?":
        event.preventDefault();
        showKeyboardHelp();
        break;
      case "n":
      case "N":
        if (createBaseUrl && canEdit) {
          event.preventDefault();
          window.location.href = createBaseUrl + "?back=" + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
        }
        break;
      case "a":
      case "A":
        event.preventDefault();
        assignUnallocatedReservation();
        break;
      case "c":
      case "C":
        if (selectedBlock && canEdit && !mutationInFlight) {
          event.preventDefault();
          performCheckIn();
        }
        break;
      case "o":
      case "O":
        if (selectedBlock && canEdit && !mutationInFlight) {
          event.preventDefault();
          performCheckOut();
        }
        break;
      case "i":
      case "I":
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          statsBtn && statsBtn.click();
        }
        break;
      default:
        break;
    }
  });

  function openSearchPanel() {
    const searchInput = root.querySelector(".planning-board-search-inline input[name='q']");
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    } else {
      setFeedback("Use the Search field in the filter bar to filter by guest, reservation, or room.", "neutral");
    }
  }

  function showKeyboardHelp() {
    const helpContent = `
      <strong>Keyboard Shortcuts</strong>
      <ul style="margin: 8px 0; padding-left: 20px;">
        <li><kbd>T</kbd> : Jump to today</li>
        <li><kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd> : Switch to 7 / 14 / 30 day view</li>
        <li>↑ ↓ : Navigate blocks across room tracks</li>
        <li><kbd>Enter</kbd> : Open reservation details panel</li>
        <li><kbd>M</kbd> : Move mode (keyboard alternative to drag)</li>
        <li><kbd>R</kbd> : Resize mode (keyboard alternative to drag)</li>
        <li><kbd>Enter</kbd> : Confirm action or open details</li>
        <li><kbd>Esc</kbd> : Cancel or close</li>
        <li><kbd>/</kbd> : Open search</li>
        <li><kbd>N</kbd> : New reservation</li>
        <li><kbd>A</kbd> : Assign unallocated</li>
        <li><kbd>C</kbd> : Check-in selected</li>
        <li><kbd>O</kbd> : Check-out selected</li>
        <li><kbd>Ctrl+I</kbd> : Board stats drawer</li>
        <li><kbd>?</kbd> : Show this help</li>
      </ul>
      <p style="font-size:0.78rem;color:var(--muted);margin:4px 0 0;">Click any empty grid slot to quick-create a booking for that room + date.</p>
    `;
    setFeedback(helpContent, "neutral", { allowHtml: true });
  }

  async function performCheckIn() {
    if (!selectedBlock) {
      setFeedback("No block selected.", "error");
      return;
    }

    const reservationId = selectedBlock.dataset.reservationId;
    if (!reservationId) {
      setFeedback("This block does not have a reservation ID.", "error");
      return;
    }

    selectedBlock.classList.add("is-pending");
    setBusyState(true);
    setFeedback("Checking in...", "pending");

    try {
      const response = await fetch(`/staff/front-desk/board/reservations/${reservationId}/check_in`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": csrfToken,
        },
      });
      const result = await readJsonResponse(response);
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Check-in failed.");
      }
      setFeedback(result.message || "Checked in.", "success");
      await refreshSurface({ reservationId });
    } catch (error) {
      setFeedback(error.message || "Check-in failed.", "error");
    } finally {
      selectedBlock.classList.remove("is-pending");
      setBusyState(false);
    }
  }

  async function performCheckOut() {
    if (!selectedBlock) {
      setFeedback("No block selected.", "error");
      return;
    }

    const reservationId = selectedBlock.dataset.reservationId;
    if (!reservationId) {
      setFeedback("This block does not have a reservation ID.", "error");
      return;
    }

    selectedBlock.classList.add("is-pending");
    setBusyState(true);
    setFeedback("Checking out...", "pending");

    try {
      const response = await fetch(`/staff/front-desk/board/reservations/${reservationId}/check_out`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": csrfToken,
        },
      });
      const result = await readJsonResponse(response);
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Check-out failed.");
      }
      setFeedback(result.message || "Checked out.", "success");
      await refreshSurface({ reservationId });
    } catch (error) {
      setFeedback(error.message || "Check-out failed.", "error");
    } finally {
      selectedBlock.classList.remove("is-pending");
      setBusyState(false);
    }
  }

  function assignUnallocatedReservation() {
    if (!selectedBlock) {
      setFeedback("Select an unallocated block first.", "neutral");
      return;
    }
    enterMoveMode();
  }

  async function performNoShow() {
    if (!selectedBlock) {
      setFeedback("No block selected.", "error");
      return;
    }
    const reservationId = selectedBlock.dataset.reservationId;
    if (!reservationId) {
      setFeedback("This block does not have a reservation ID.", "error");
      return;
    }
    if (!confirm("Mark this reservation as no-show?")) return;
    selectedBlock.classList.add("is-pending");
    setBusyState(true);
    setFeedback("Marking no-show…", "pending");
    try {
      const response = await fetch(`/staff/front-desk/board/reservations/${reservationId}/no-show`, {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "X-CSRF-Token": csrfToken },
      });
      const result = await readJsonResponse(response);
      if (!response.ok || !result.ok) throw new Error(result.error || "No-show failed.");
      setFeedback(result.message || "Marked as no-show.", "success");
      await refreshSurface({ reservationId });
    } catch (error) {
      setFeedback(error.message || "No-show failed.", "error");
    } finally {
      selectedBlock && selectedBlock.classList.remove("is-pending");
      setBusyState(false);
    }
  }

  function performMarkRoomReady(blockEl) {
    const reservationId = blockEl ? blockEl.dataset.reservationId : null;
    if (!reservationId) {
      setFeedback("Cannot determine reservation.", "error");
      return;
    }
    setBusyState(true);
    setFeedback("Marking room clean…", "pending");
    fetch(`/staff/front-desk/board/reservations/${reservationId}/room-ready`, {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", "X-CSRF-Token": csrfToken },
    })
      .then((r) => readJsonResponse(r))
      .then((result) => {
        if (!result.ok) throw new Error(result.error || "Failed.");
        setFeedback(result.message || "Room marked clean.", "success");
        return refreshSurface({ reservationId });
      })
      .catch((err) => setFeedback(err.message || "Failed to mark room ready.", "error"))
      .finally(() => setBusyState(false));
  }

  // ========== Board Auto-Refresh (Polling) ==========

  let pollInterval = null;

  function startPolling() {
    if (pollInterval) return;
    pollInterval = setInterval(() => {
      if (!mutationInFlight) {
        refreshSurface({
          reservationId: panelReservationId || selectedBlock?.dataset.reservationId || "",
          reopenPanel: !panelEl.classList.contains("hidden") && Boolean(panelReservationId),
        });
      }
    }, 10000);
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    restoreFilterState();
    restoreHkOverlay();
    restoreRoleView();
    renderSavedViewOptions();
    startPolling();
  });

  window.addEventListener("resize", updateStickyOffset);

  window.addEventListener("beforeunload", () => {
    stopPolling();
  });

  setBusyState(false);
  initializeBoardSearch();
  updateStickyOffset();
  setSurfaceLoading(true);
  window.requestAnimationFrame(() => {
    setSurfaceLoading(false);
    reapplyBoardState();
  });

  // ── Context menu (right-click on blocks) ──
  const ctxMenu = document.getElementById("board-context-menu");
  if (ctxMenu) {
    function showContextMenu(blockEl, x, y) {
      if (!blockEl) return;
      const detailUrl = blockEl.querySelector("a[href*='/staff/reservations/']");
      const frontDeskUrl = blockEl.querySelector("a[href*='/staff/front-desk/']:not([href*='/staff/front-desk/board/'])");
      const allocationState = blockEl.dataset.allocationState || "";
      const sourceType = blockEl.dataset.sourceType || "";
      const isClosure = sourceType === "closure" || sourceType === "blocked";

      ctxMenu.querySelectorAll("button").forEach(btn => {
        const action = btn.dataset.ctx;
        if (action === "open") btn.disabled = !detailUrl;
        if (action === "front-desk") btn.disabled = !frontDeskUrl;
        if (action === "check-in" || action === "check-out" || action === "no-show") btn.disabled = isClosure || !canEdit;
        if (action === "room-ready") btn.disabled = isClosure || !canEdit || allocationState !== "allocated";
        if (action === "move" || action === "resize" || action === "assign") btn.disabled = !canEdit;
      });

      ctxMenu.classList.remove("hidden");
      ctxMenu.hidden = false;
      var menuW = ctxMenu.offsetWidth || 200;
      var menuH = ctxMenu.offsetHeight || 300;
      ctxMenu.style.left = Math.min(x, window.innerWidth - menuW - 8) + "px";
      ctxMenu.style.top = Math.min(y, window.innerHeight - menuH - 8) + "px";
      ctxMenu._block = blockEl;
    }

    function hideContextMenu() {
      ctxMenu.classList.add("hidden");
      ctxMenu.hidden = true;
      ctxMenu._block = null;
    }

    surface.addEventListener("contextmenu", function(e) {
      const blockEl = e.target.closest("[data-board-block]");
      if (!blockEl) return;
      e.preventDefault();
      selectBlock(blockEl);
      showContextMenu(blockEl, e.clientX, e.clientY);
    });

    document.addEventListener("click", function(e) {
      if (!ctxMenu.contains(e.target)) hideContextMenu();
    });

    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") hideContextMenu();
    });

    ctxMenu.addEventListener("click", function(e) {
      const btn = e.target.closest("button[data-ctx]");
      if (!btn || btn.disabled) return;
      const blockEl = ctxMenu._block;
      if (!blockEl) return;
      const action = btn.dataset.ctx;
      hideContextMenu();

      if (action === "open") {
        const link = blockEl.querySelector("a[href*='/staff/reservations/']");
        if (link) window.location.href = link.href;
      } else if (action === "front-desk") {
        const link = blockEl.querySelector("a[href*='/staff/front-desk/']:not([href*='/staff/front-desk/board/'])");
        if (link) window.location.href = link.href;
      } else if (action === "check-in") {
        selectBlock(blockEl);
        performCheckIn();
      } else if (action === "check-out") {
        selectBlock(blockEl);
        performCheckOut();
      } else if (action === "no-show") {
        selectBlock(blockEl);
        performNoShow();
      } else if (action === "move") {
        selectBlock(blockEl);
        enterMoveMode();
      } else if (action === "resize") {
        selectBlock(blockEl);
        enterResizeMode();
      } else if (action === "assign") {
        selectBlock(blockEl);
        assignUnallocatedReservation();
      } else if (action === "room-ready") {
        selectBlock(blockEl);
        performMarkRoomReady(blockEl);
      } else if (action === "export-ics") {
        const icsLink = blockEl.querySelector("a[href*='export.ics']");
        if (icsLink) window.location.href = icsLink.href;
      }
    });
  }

  // ── Empty slot click: create booking pre-filled with room + date ──
  const createBaseUrl = root.dataset.createUrl || "";
  if (createBaseUrl && canEdit) {
    surface.addEventListener("click", function onEmptySlotClick(e) {
      // Only act on direct track clicks, not on blocks or other elements
      const track = e.target.closest("[data-board-track]");
      if (!track) return;
      if (e.target.closest("[data-board-block]")) return;
      if (e.target.closest("summary, button, a, form, input, select, textarea")) return;

      const roomId = track.dataset.roomId;
      const roomTypeId = track.dataset.roomTypeId;
      if (!roomId) return; // Don't handle unallocated lane

      // Compute which day column was clicked using track bounding box
      const grid = track.closest(".planning-board-grid");
      if (!grid) return;
      const startDateAttr = grid.dataset.boardStartDate;
      const days = parseInt(grid.dataset.boardDays, 10);
      if (!startDateAttr || !days) return;

      // Determine click position relative to the track
      const rect = track.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const trackWidth = rect.width;
      const colWidth = trackWidth / days;
      const colIndex = Math.max(0, Math.min(days - 1, Math.floor(clickX / colWidth)));

      // Format a Date as YYYY-MM-DD using local time (avoids UTC shift from toISOString)
      function formatDateLocal(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return year + "-" + month + "-" + day;
      }

      // Compute date from column
      const startDate = new Date(startDateAttr + "T00:00:00");
      startDate.setDate(startDate.getDate() + colIndex);
      const checkIn = formatDateLocal(startDate);
      const nextDay = new Date(startDate);
      nextDay.setDate(nextDay.getDate() + 1);
      const checkOut = formatDateLocal(nextDay);

      // Navigate to reservation create form with pre-filled params
      const params = new URLSearchParams({
        check_in: checkIn,
        check_out: checkOut,
        room_id: roomId,
        room_type_id: roomTypeId,
        source_channel: "admin_manual",
        status: "confirmed",
        back: window.location.pathname + window.location.search + window.location.hash,
      });
      window.location.href = createBaseUrl + "?" + params.toString();
    });
  }

})();
