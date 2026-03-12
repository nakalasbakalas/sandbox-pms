(function () {
  const body = document.body;
  if (!body || !body.classList.contains("public-site")) {
    return;
  }

  const CONSENT_KEY = "sandbox_analytics_consent_v1";
  const CONSENT_GRANTED = "granted";
  const CONSENT_DENIED = "denied";
  const CONSENT_PENDING = "pending";
  const EVENT_NAMES = {
    bookingRequestSubmit: "booking_request_submit",
    consentUpdate: "consent_update",
    contactClick: "contact_click",
    ctaClick: "cta_click",
    galleryInteraction: "gallery_interaction",
    pageView: "page_view",
  };
  let transientConsentState = CONSENT_PENDING;
  const banner = document.querySelector("[data-consent-banner]");
  const consentStatus = document.querySelector("[data-consent-status]");
  const grantButtons = document.querySelectorAll('[data-consent-action="grant"]');
  const denyButtons = document.querySelectorAll('[data-consent-action="deny"]');
  const manageButtons = document.querySelectorAll("[data-consent-open]");

  window.dataLayer = window.dataLayer || [];

  function readStorage() {
    try {
      return window.localStorage.getItem(CONSENT_KEY);
    } catch (error) {
      return null;
    }
  }

  function writeStorage(value) {
    try {
      window.localStorage.setItem(CONSENT_KEY, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function readConsentState() {
    const storedValue = readStorage();
    if (storedValue === CONSENT_GRANTED || storedValue === CONSENT_DENIED) {
      transientConsentState = storedValue;
      return storedValue;
    }
    return transientConsentState;
  }

  function deviceClass() {
    return window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop";
  }

  function sanitizeTarget(value) {
    if (!value) {
      return "";
    }
    try {
      const url = new URL(value, window.location.origin);
      if (url.origin === window.location.origin) {
        return url.pathname + url.search + url.hash;
      }
      return url.origin + url.pathname;
    } catch (error) {
      return String(value);
    }
  }

  function baseEventPayload() {
    return {
      event_time: new Date().toISOString(),
      page_language: body.dataset.analyticsLanguage || "",
      page_type: body.dataset.analyticsEndpoint || "",
      page_path: body.dataset.analyticsPath || window.location.pathname,
      device_class: deviceClass(),
      source_channel: body.dataset.analyticsSourceChannel || "direct_web",
      consent_state: readConsentState(),
    };
  }

  function analyticsAllowed() {
    return readConsentState() === CONSENT_GRANTED;
  }

  function pushEvent(eventName, detail, options) {
    const allowWithoutConsent = options && options.allowWithoutConsent;
    if (!allowWithoutConsent && !analyticsAllowed()) {
      return false;
    }
    window.dataLayer.push(
      Object.assign(
        {
          event: eventName,
        },
        baseEventPayload(),
        detail || {}
      )
    );
    return true;
  }

  function syncConsentUi() {
    const state = readConsentState();
    body.dataset.analyticsConsent = state;
    if (banner) {
      banner.hidden = state !== CONSENT_PENDING;
    }
  }

  function setConsentStatusMessage(message) {
    if (consentStatus) {
      consentStatus.textContent = message || "";
    }
  }

  function applyConsent(state, message) {
    transientConsentState = state;
    writeStorage(state);
    syncConsentUi();
    setConsentStatusMessage(message);
    pushEvent(
      EVENT_NAMES.consentUpdate,
      {
        analytics_storage: state === CONSENT_GRANTED ? "granted" : "denied",
      },
      { allowWithoutConsent: true }
    );
    if (state === CONSENT_GRANTED) {
      pushEvent(EVENT_NAMES.pageView, { page_title: document.title });
    }
  }

  function openConsentBanner() {
    if (!banner) {
      return;
    }
    banner.hidden = false;
    body.dataset.analyticsConsent = CONSENT_PENDING;
    setConsentStatusMessage("");
    const focusTarget = banner.querySelector('[data-consent-action="grant"]');
    if (focusTarget) {
      focusTarget.focus();
    }
  }

  function inferContext(element) {
    if (element.dataset.analyticsContext) {
      return element.dataset.analyticsContext;
    }
    const section = element.closest("section, article, nav, footer, header");
    if (!section) {
      return "page";
    }
    if (section.tagName === "NAV") {
      return "navigation";
    }
    return section.className || section.tagName.toLowerCase();
  }

  function trackClickEvent(target) {
    const trackedElement = target.closest("[data-analytics-event]");
    if (!trackedElement) {
      return;
    }
    const eventName = trackedElement.dataset.analyticsEvent;
    const payload = {
      cta_label: trackedElement.dataset.analyticsLabel || trackedElement.textContent.trim().slice(0, 80),
      cta_context: inferContext(trackedElement),
      target_path: sanitizeTarget(
        trackedElement.getAttribute("href") || trackedElement.getAttribute("action") || ""
      ),
    };
    if (eventName === EVENT_NAMES.galleryInteraction) {
      payload.gallery_action = trackedElement.dataset.analyticsAction || "interact";
    }
    pushEvent(eventName, payload);
  }

  function trackContactClick(target) {
    const contactLink = target.closest('a[href^="tel:"], a[href^="mailto:"]');
    if (!contactLink) {
      return;
    }
    const href = contactLink.getAttribute("href") || "";
    const contactMethod = href.startsWith("tel:") ? "phone" : "email";
    pushEvent(EVENT_NAMES.contactClick, {
      contact_method: contactMethod,
      cta_label: contactLink.dataset.analyticsLabel || contactMethod,
      cta_context: inferContext(contactLink),
      target_path: sanitizeTarget(href),
    });
  }

  function trackFormSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }
    const eventName = form.dataset.analyticsEvent || EVENT_NAMES.bookingRequestSubmit;
    if (!eventName) {
      return;
    }
    pushEvent(eventName, {
      form_name: form.dataset.analyticsLabel || form.getAttribute("action") || "form",
      booking_step: form.dataset.analyticsStep || "",
      target_path: sanitizeTarget(form.getAttribute("action") || window.location.pathname),
    });
  }

  function createExtraSummaryRow(input, currencyLabel, formatter) {
    const row = document.createElement("div");
    row.className = "list-row no-link";

    const copy = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = input.dataset.extraName || "";
    copy.appendChild(strong);

    const pricing = document.createElement("p");
    pricing.className = "small muted";
    pricing.textContent = input.dataset.extraPricing || "";
    copy.appendChild(pricing);

    const total = document.createElement("strong");
    total.textContent = currencyLabel + " " + formatter.format(Number(input.dataset.extraTotal || "0"));

    row.appendChild(copy);
    row.appendChild(total);
    return row;
  }

  function initBookingExtrasSummary() {
    const optionInputs = Array.from(document.querySelectorAll('input[name="extra_ids"][data-extra-total]'));
    if (!optionInputs.length) {
      return;
    }
    const extrasTotalValue = document.getElementById("extras-total-value");
    const grandTotalValue = document.getElementById("grand-total-value");
    const summaryContainer = document.getElementById("selected-extras-summary");
    const formatter = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const currencyLabel =
      (summaryContainer && summaryContainer.dataset.currency) ||
      (grandTotalValue && grandTotalValue.dataset.currency) ||
      "";
    const emptyText = (summaryContainer && summaryContainer.dataset.emptyText) || "";
    const baseTotal = Number((grandTotalValue && grandTotalValue.dataset.baseTotal) || "0");

    function renderSummary() {
      const selected = optionInputs.filter(function (input) {
        return input.checked;
      });
      const extrasTotal = selected.reduce(function (sum, input) {
        return sum + Number(input.dataset.extraTotal || "0");
      }, 0);

      if (extrasTotalValue) {
        extrasTotalValue.textContent = currencyLabel + " " + formatter.format(extrasTotal);
      }
      if (grandTotalValue) {
        grandTotalValue.textContent = currencyLabel + " " + formatter.format(baseTotal + extrasTotal);
      }
      if (!summaryContainer) {
        return;
      }

      summaryContainer.replaceChildren();
      if (!selected.length) {
        const emptyNode = document.createElement("p");
        emptyNode.className = "muted";
        emptyNode.id = "no-extras-selected";
        emptyNode.textContent = emptyText;
        summaryContainer.appendChild(emptyNode);
        return;
      }

      selected.forEach(function (input) {
        summaryContainer.appendChild(createExtraSummaryRow(input, currencyLabel, formatter));
      });
    }

    optionInputs.forEach(function (input) {
      input.addEventListener("change", function () {
        renderSummary();
        pushEvent(EVENT_NAMES.ctaClick, {
          cta_label: input.checked ? "extra_add" : "extra_remove",
          cta_context: "booking_extras",
          extra_name: input.dataset.extraName || "",
        });
      });
    });
    renderSummary();
  }

  document.addEventListener("click", function (event) {
    const consentAction = event.target.closest("[data-consent-action]");
    if (consentAction) {
      const consentSavedText = body.dataset.analyticsConsentSaved || "";
      applyConsent(
        consentAction.dataset.consentAction === "grant" ? CONSENT_GRANTED : CONSENT_DENIED,
        consentSavedText
      );
      return;
    }

    const consentOpen = event.target.closest("[data-consent-open]");
    if (consentOpen) {
      openConsentBanner();
      return;
    }

    trackContactClick(event.target);
    trackClickEvent(event.target);
  });

  document.addEventListener("submit", trackFormSubmit, true);

  syncConsentUi();
  setConsentStatusMessage("");
  pushEvent(
    EVENT_NAMES.consentUpdate,
    {
      analytics_storage:
        readConsentState() === CONSENT_GRANTED
          ? "granted"
          : readConsentState() === CONSENT_DENIED
            ? "denied"
            : "pending",
    },
    { allowWithoutConsent: true }
  );
  if (analyticsAllowed()) {
    pushEvent(EVENT_NAMES.pageView, { page_title: document.title });
  }
  initBookingExtrasSummary();
})();
