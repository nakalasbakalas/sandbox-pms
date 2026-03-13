(function () {
  const root = document.querySelector("[data-front-desk-board]");
  const surface = document.getElementById("front-desk-board-surface");
  if (!root || !surface) {
    return;
  }

  const csrfToken = root.dataset.csrfToken || "";
  const canEdit = root.dataset.canEdit === "true";
  const feedback = root.querySelector("[data-board-feedback]");
  let mutationInFlight = false;
  let selectedBlock = null;
  let moveMode = false;
  let moveTargetRoomId = null;
  let moveTargetTrack = null;
  let resizeMode = false;
  let resizeTargetEndDate = null;

  function setBusyState(isBusy) {
    mutationInFlight = isBusy;
    root.dataset.busy = isBusy ? "true" : "false";
    surface.setAttribute("aria-busy", isBusy ? "true" : "false");
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
    surface.setAttribute("aria-busy", "true");
    const response = await fetch(target.toString(), {
      headers: { Accept: "text/html" },
      credentials: "same-origin",
    });
    if (!response.ok) {
      surface.setAttribute("aria-busy", mutationInFlight ? "true" : "false");
      throw new Error("Unable to refresh the planning board.");
    }
    surface.innerHTML = await response.text();
    surface.setAttribute("aria-busy", mutationInFlight ? "true" : "false");
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
        });
        button.setAttribute("data-active", "true");

        // Apply CSS class to grid
        const grid = document.querySelector(".planning-board-grid");
        if (grid) {
          grid.classList.remove("density-compact", "density-comfortable", "density-spacious");
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
      default:
        break;
    }
  });

  function openSearchPanel() {
    const searchInput = root.querySelector(".planning-board-topbar input[name='q'], .toolbar input[name='q']");
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

  // ========== Sprint 4: Real-Time Sync (SSE) ==========

  let eventSource = null;
  let sseRetries = 0;
  const MAX_SSE_RETRIES = 5;
  let refreshTimeout = null;

  function initSSE() {
    if (eventSource) {
      eventSource.close();
    }

    const url = "/staff/front-desk/board/events";
    eventSource = new EventSource(url);

    eventSource.addEventListener("board.changed", (e) => {
      console.log("Board updated via SSE:", e.data);

      // Debounce rapid refreshes
      debounceRefreshSurface();
    });

    eventSource.addEventListener("error", () => {
      sseRetries++;
      if (sseRetries > MAX_SSE_RETRIES) {
        console.warn("SSE reconnection failed after", MAX_SSE_RETRIES, "attempts, stopping");
        eventSource.close();
        eventSource = null;
        setFeedback("Real-time updates disabled. Refresh page to re-enable.", "warning");
      } else {
        // Browser will auto-reconnect with exponential backoff
        console.log(`SSE error, retry ${sseRetries}/${MAX_SSE_RETRIES}...`);
      }
    });

    sseRetries = 0; // Reset on successful connection
  }

  function debounceRefreshSurface() {
    clearTimeout(refreshTimeout);
    refreshTimeout = setTimeout(() => {
      refreshSurface();
    }, 500);
  }

  function closeSSE() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    clearTimeout(refreshTimeout);
  }

  // Graceful degradation if EventSource not supported
  if ("EventSource" in window) {
    // Start SSE on page load
    document.addEventListener("DOMContentLoaded", () => {
      initSSE();
    });

    // Close SSE on page unload
    window.addEventListener("beforeunload", () => {
      closeSSE();
    });
  } else {
    console.warn("EventSource not supported, falling back to polling");
    // Fallback: poll every 30 seconds
    setInterval(() => {
      refreshSurface();
    }, 30000);
  }

  setBusyState(false);
})();
