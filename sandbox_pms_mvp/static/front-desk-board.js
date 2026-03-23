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
  let mutationInFlight = false;
  let selectedBlock = null;
  let moveMode = false;
  let moveTargetRoomId = null;
  let moveTargetTrack = null;
  let resizeMode = false;
  let resizeTargetEndDate = null;
  let boardSearchSubmitTimer = null;
  let lastSubmittedSearchValue = searchInput ? searchInput.value.trim() : "";

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

  async function refreshSurface() {
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
    if (surfaceContent) {
      surfaceContent.innerHTML = await response.text();
    } else {
      surface.innerHTML = await response.text();
    }
    setSurfaceLoading(false);
    reapplyBoardState();
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

    if (block.dataset.suppressClick !== "true") {
      return;
    }
    block.dataset.suppressClick = "false";
    event.preventDefault();
    event.stopPropagation();
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
      await refreshSurface();
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
      await refreshSurface();
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
        await refreshSurface();
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

        // Save to server
        try {
          const response = await fetch("/staff/front-desk/board/preferences", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrfToken,
            },
            body: JSON.stringify({ density }),
          });
          if (!response.ok) {
            throw new Error("Failed to save preference");
          }
          setFeedback(`Layout set to ${density}.`, "success");
        } catch (error) {
          setFeedback("Could not save preference.", "error");
          console.error("Density toggle error:", error);
        }
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

  function matchFilter(filterName, track) {
    const hk = track.dataset.hkStatus || "";
    switch (filterName) {
      case "dirty":       return hk.includes("dirty");
      case "vacant":      return track.dataset.isVacant === "true";
      case "arrival":     return track.dataset.hasArrivalToday === "true";
      case "departure":   return track.dataset.hasDepartureToday === "true";
      case "maintenance": return track.dataset.isMaintenance === "true";
      case "unallocated": return track.dataset.laneKind === "unallocated";
      case "in-house":    return track.dataset.isOccupied === "true";
      case "stayover":    return track.dataset.isStayover === "true";
      case "balance-due": return track.dataset.hasBalanceDue === "true";
      case "conflict":    return track.dataset.isConflict === "true";
      case "inspected":   return hk === "inspected";
      default:            return true;
    }
  }

  function applyQuickFilters() {
    const tracks = surface.querySelectorAll("[data-board-track]");
    const hasUnallocated = activeFilters.has("unallocated");
    const nonUnallocatedFilters = [...activeFilters].filter((f) => f !== "unallocated");
    tracks.forEach((track) => {
      const isUnallocated = track.dataset.laneKind === "unallocated";
      let matches;
      if (activeFilters.size === 0) {
        matches = true;
      } else if (isUnallocated) {
        // Unallocated rows only visible when the "unallocated" filter is active
        matches = hasUnallocated;
      } else {
        // Regular rows: show if they match any non-unallocated filter (OR semantics)
        // When only the unallocated filter is active, hide regular rows
        matches = nonUnallocatedFilters.length > 0 && nonUnallocatedFilters.some((f) => matchFilter(f, track));
      }
      track.hidden = !matches;
      const prev = track.previousElementSibling;
      if (prev && prev.classList.contains("planning-board-room") && !prev.classList.contains("heading")) {
        prev.hidden = !matches;
      }
    });
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
    if (activeFilters.has(filter)) {
      activeFilters.delete(filter);
    } else {
      activeFilters.add(filter);
    }
    syncFilterState();
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
  }

  function restoreFilterState() {
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
      if (e.target.closest("[data-action='reset-filters']")) {
        resetAllFilters();
        return;
      }
      const chip = e.target.closest("[data-filter]");
      if (!chip) return;
      toggleQuickFilter(chip.dataset.filter);
    });
  }

  // ── Command strip: click delegation on surface (survives AJAX refresh) ──
  surface.addEventListener("click", (e) => {
    // Metric filter button (not inside a board block or track)
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
  }

  function restoreHkOverlay() {
    try { hkOverlayActive = localStorage.getItem("board_hk_overlay") === "1"; } catch (_) { /* ignore */ }
  }

  // ── Role View Presets ──
  const ROLE_VIEWS = {
    "front-desk":   { filters: ["arrival", "departure"], overlay: false },
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
  }

  function syncRoleViewState() {
    surface.querySelectorAll("[data-view]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === activeRoleView);
    });
  }

  function restoreRoleView() {
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
    updateStickyOffset();
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
      todayIndicator.addEventListener("click", () => {
        const desktop = document.querySelector(".planning-board-desktop");
        if (!desktop) return;
        const gridEl = desktop.querySelector(".planning-board-grid");
        if (!gridEl) return;
        const todayCol = gridEl.querySelector(".planning-board-day.today");
        if (!todayCol) return;
        const containerRect = desktop.getBoundingClientRect();
        const colRect = todayCol.getBoundingClientRect();
        desktop.scrollTo({
          left: desktop.scrollLeft + colRect.left - containerRect.left - 60,
          behavior: "smooth",
        });
      });
      todayIndicator.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          todayIndicator.click();
        }
      });
    }
  }

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
      setBusyState(true);
      const target = new URL("/staff/front-desk/board/stats-panel", window.location.origin);
      target.search = window.location.search;
      fetch(target.toString(), { headers: { Accept: "text/html" }, credentials: "same-origin" })
        .then((r) => r.ok ? r.text() : Promise.reject())
        .then((html) => {
          panelContent.innerHTML = html;
          panelEl.classList.remove("hidden");
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
      setBusyState(true);
      const target = new URL("/staff/front-desk/board/handover-panel", window.location.origin);
      target.search = window.location.search;
      fetch(target.toString(), { headers: { Accept: "text/html" }, credentials: "same-origin" })
        .then((r) => r.ok ? r.text() : Promise.reject())
        .then((html) => {
          panelContent.innerHTML = html;
          panelEl.classList.remove("hidden");
          panelEl.setAttribute("aria-hidden", "false");
          panelCloseBtn.focus();
        })
        .catch(() => setFeedback("Handover data unavailable.", "error"))
        .finally(() => setBusyState(false));
    });
  }

  // Side panel for reservation details
  const panelEl = document.getElementById("board-side-panel");
  const panelTitle = document.querySelector("[data-panel-title]");
  const panelContent = document.querySelector(".panel-content");
  const panelCloseBtn = document.querySelector("[data-action='close-panel']");

  function openPanel(blockEl) {
    if (!blockEl || !blockEl.dataset.reservationId) {
      setFeedback("Cannot open panel for this block.", "error");
      return;
    }

    const reservationId = blockEl.dataset.reservationId;
    const summary = blockEl.querySelector("summary[data-block-handle]");
    const label = summary ? summary.getAttribute("aria-label") : blockEl.dataset.blockId;

    panelTitle.textContent = label || "Reservation Details";

    setBusyState(true);
    setFeedback("Loading details...", "pending");

    fetch(`/staff/front-desk/board/reservations/${reservationId}/panel`, {
      headers: { "Accept": "text/html" },
      credentials: "same-origin",
    })
    .then(resp => {
      if (!resp.ok) throw new Error("Failed to load panel");
      return resp.text();
    })
    .then(html => {
      panelContent.innerHTML = html;
      panelEl.classList.remove("hidden");
      panelEl.setAttribute("aria-hidden", "false");
      setFeedback("", "neutral");
      attachPanelHandlers();
      // Move focus to close button so screen readers announce the dialog
      panelCloseBtn.focus();
    })
    .catch(err => {
      setFeedback(err.message || "Failed to load panel.", "error");
    })
    .finally(() => setBusyState(false));
  }

  function closePanel() {
    panelEl.classList.add("hidden");
    panelEl.setAttribute("aria-hidden", "true");
    panelContent.innerHTML = "";
    if (selectedBlock) {
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
    setBusyState(true);
    setFeedback("Saving...", "pending");

    try {
      const response = await fetch(form.action, {
        method: form.method || "POST",
        body: new FormData(form),
        credentials: "same-origin",
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Save failed");
      }

      setFeedback("Saved successfully.", "success");
      closePanel();
      await refreshSurface();
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
        headers: { "X-CSRF-Token": csrfToken },
      });

      const result = await readJsonResponse(response);
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Action failed.");
      }

      setFeedback(result.message || "Action completed.", "success");
      closePanel();
      await refreshSurface();
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

  // Wire Enter key to open panel for selected block (from Sprint 2)
  // Modify the global keyboard handler to call openPanel instead of a stub
  // This will be handled in the onSurfaceKeydown handler by updating it to call openPanel

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
        <li>↑ ↓ : Navigate blocks across room tracks</li>
        <li><kbd>M</kbd> : Move mode (keyboard alternative to drag)</li>
        <li><kbd>R</kbd> : Resize mode (keyboard alternative to drag)</li>
        <li><kbd>Enter</kbd> : Confirm action or open details</li>
        <li><kbd>Esc</kbd> : Cancel or close</li>
        <li><kbd>/</kbd> : Open search</li>
        <li><kbd>A</kbd> : Assign unallocated</li>
        <li><kbd>C</kbd> : Check-in selected</li>
        <li><kbd>O</kbd> : Check-out selected</li>
        <li><kbd>Ctrl+I</kbd> : Board stats drawer</li>
      </ul>
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
          "X-CSRF-Token": csrfToken,
        },
      });
      const result = await readJsonResponse(response);
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Check-in failed.");
      }
      setFeedback(result.message || "Checked in.", "success");
      await refreshSurface();
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
          "X-CSRF-Token": csrfToken,
        },
      });
      const result = await readJsonResponse(response);
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Check-out failed.");
      }
      setFeedback(result.message || "Checked out.", "success");
      await refreshSurface();
    } catch (error) {
      setFeedback(error.message || "Check-out failed.", "error");
    } finally {
      selectedBlock.classList.remove("is-pending");
      setBusyState(false);
    }
  }

  function assignUnallocatedReservation() {
    setFeedback("Assign unallocated feature coming soon. Select an unallocated block and press M to move.", "neutral");
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
      headers: { "X-CSRF-Token": csrfToken },
    })
      .then((r) => readJsonResponse(r))
      .then((result) => {
        if (!result.ok) throw new Error(result.error || "Failed.");
        setFeedback(result.message || "Room marked clean.", "success");
        return refreshSurface();
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
        refreshSurface();
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
        setFeedback("No-show marking: use the reservation detail page.", "neutral");
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

})();
