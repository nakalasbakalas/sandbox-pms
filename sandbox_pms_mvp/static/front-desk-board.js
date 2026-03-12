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

  function setBusyState(isBusy) {
    mutationInFlight = isBusy;
    root.dataset.busy = isBusy ? "true" : "false";
    surface.setAttribute("aria-busy", isBusy ? "true" : "false");
  }

  function setFeedback(message, tone) {
    if (!feedback) {
      return;
    }
    feedback.textContent = message || "";
    feedback.dataset.tone = tone || "neutral";
    feedback.hidden = !message;
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

  function onSurfaceClick(event) {
    const summary = resolveSummaryTarget(event.target);
    if (!summary) {
      return;
    }
    const block = summary.closest("[data-board-block]");
    if (!block || block.dataset.suppressClick !== "true") {
      return;
    }
    block.dataset.suppressClick = "false";
    event.preventDefault();
    event.stopPropagation();
  }

  function onSurfaceKeydown(event) {
    if (event.key !== "Escape") {
      return;
    }
    const openContainer =
      (event.target instanceof Element && event.target.closest("[data-board-block][open]")) ||
      (event.target instanceof Element && event.target.closest(".planning-board-quick[open]"));
    if (!openContainer) {
      return;
    }
    openContainer.removeAttribute("open");
    setFeedback("", "neutral");
  }

  function onSurfacePointerDown(event) {
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
    const cell = track.querySelector(".planning-board-cell");
    const dayWidth = cell ? cell.getBoundingClientRect().width : track.getBoundingClientRect().width / boardDays;
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
          throw new Error(result.error || "The board change was rejected.");
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

  surface.addEventListener("click", onSurfaceClick);
  surface.addEventListener("keydown", onSurfaceKeydown);
  if (canEdit) {
    surface.addEventListener("pointerdown", onSurfacePointerDown);
  }
  setBusyState(false);
})();
