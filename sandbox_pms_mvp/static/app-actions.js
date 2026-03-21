document.addEventListener("click", function (event) {
  var printTrigger = event.target.closest("[data-window-print]");
  if (printTrigger) {
    event.preventDefault();
    window.print();
  }
});

document.addEventListener("change", function (event) {
  var autoSubmitField = event.target.closest("[data-auto-submit]");
  if (autoSubmitField && autoSubmitField.form) {
    if (typeof autoSubmitField.form.requestSubmit === "function") {
      autoSubmitField.form.requestSubmit();
    } else {
      autoSubmitField.form.submit();
    }
    return;
  }

  var hkNav = event.target.closest("[data-hk-nav-base]");
  if (hkNav) {
    var base = hkNav.getAttribute("data-hk-nav-base");
    var mobile = hkNav.getAttribute("data-hk-mobile") === "true";
    var url = base + "?date=" + hkNav.value;
    if (mobile) { url += "&view=mobile"; }
    window.location.href = url;
    return;
  }

  var navField = event.target.closest("[data-url-param-nav]");
  if (!navField) {
    return;
  }

  var paramName = navField.getAttribute("data-url-param-nav");
  if (!paramName) {
    return;
  }

  var nextUrl = new URL(window.location.href);
  if (navField.value) {
    nextUrl.searchParams.set(paramName, navField.value);
  } else {
    nextUrl.searchParams.delete(paramName);
  }
  window.location.href = nextUrl.toString();
});

document.addEventListener("submit", function (event) {
  var form = event.target.closest("form[data-confirm-message]");
  if (!form) {
    return;
  }

  if (!window.confirm(form.getAttribute("data-confirm-message") || "Are you sure?")) {
    event.preventDefault();
  }
});
