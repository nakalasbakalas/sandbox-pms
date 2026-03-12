(function () {
  const root = document.querySelector("[data-front-desk-board]");
  const surface = document.getElementById("front-desk-board-surface");
  if (!root || !surface) {
    return;
  }

  const csrfToken = root.dataset.csrfToken || "";
  const canEdit = root.dataset.canEdit === "true";
  const feedback = root.querySelector("[data-board-feedback]");

  function setFeedback(message, tone) {
    if (!feedback) {
      return;
    }
    feedback.textContent = message || "";
    feedback.dataset.tone = tone || "neutral";
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

  async function refreshSurface() {
    const target = new URL(root.dataset.fragmentUrl, window.location.origin);
    target.search = window.location.search;
    const response = await fetch(target.toString(), {
      headers: { Accept: "text/html" },
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new Error("Unable to refresh the planning board.");
    }
    surface.innerHTML = await response.text();
    initInteractiveBoard();
  }

  function clearTrackHighlights() {
    surface.querySelectorAll(".planning-board-track.drop-target").forEach((track) => {
      track.classList.remove("drop-target");
    });
  }

  function attachSummaryGuards(summary) {
    summary.addEventListener("click", (event) => {
      const block = summary.closest("[data-board-block]");
      if (!block || block.dataset.suppressClick !== "true") {
        return;
      }
      block.dataset.suppressClick = "false";
      event.preventDefault();
      event.stopPropagation();
    });
  }

  function initInteractiveBoard() {
    surface.querySelectorAll("[data-board-block] > summary").forEach(attachSummaryGuards);
    if (!canEdit) {
      return;
    }

    surface.querySelectorAll("[data-board-block] > summary").forEach((summary) => {
      summary.addEventListener("pointerdown", onPointerDown);
    });
  }

  function onPointerDown(event) {
    const summary = event.currentTarget;
    const block = summary.closest("[data-board-block]");
    if (!block) {
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

    const boardDays = Number(
      track.style.getPropertyValue("--board-days") ||
        getComputedStyle(track).getPropertyValue("--board-days") ||
        block.closest(".planning-board-grid")?.style.getPropertyValue("--board-days") ||
        14,
    );
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
      dayWidth,
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
    };

    block.classList.add("is-dragging");
    summary.setPointerCapture(event.pointerId);

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

      let targetTrack = interaction.track;
      if (interaction.mode === "move") {
        const candidateTrack = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest("[data-board-track]");
        if (candidateTrack) {
          const candidateRoomId = candidateTrack.dataset.roomId || "";
          if (candidateRoomId || !interaction.originalRoomId) {
            targetTrack = candidateTrack;
          }
        }
      }

      clearTrackHighlights();
      targetTrack.classList.add("drop-target");
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

    async function onEnd(endEvent) {
      summary.releasePointerCapture(interaction.pointerId);
      summary.removeEventListener("pointermove", onMove);
      summary.removeEventListener("pointerup", onEnd);
      summary.removeEventListener("pointercancel", onCancel);
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
        return;
      }

      block.classList.remove("is-dragging");
      block.classList.add("is-pending");
      setFeedback("Saving board change...", "pending");

      const payload = {
        roomId: roomId || null,
        checkInDate: startDate,
        checkOutDate: endDate,
      };
      const endpoint = interaction.mode === "move" ? block.dataset.moveUrl : block.dataset.resizeUrl;

      try {
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
        const result = await response.json();
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
      }
    }

    function onCancel() {
      summary.removeEventListener("pointermove", onMove);
      summary.removeEventListener("pointerup", onEnd);
      summary.removeEventListener("pointercancel", onCancel);
      clearTrackHighlights();
      revertPreview(interaction);
    }

    summary.addEventListener("pointermove", onMove);
    summary.addEventListener("pointerup", onEnd);
    summary.addEventListener("pointercancel", onCancel);
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
    if (interaction.originalParent && interaction.block.parentElement !== interaction.originalParent) {
      interaction.originalParent.insertBefore(interaction.block, interaction.originalNextSibling);
    }
  }

  initInteractiveBoard();
})();
