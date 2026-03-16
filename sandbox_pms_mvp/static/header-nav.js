(function () {
  const drawer = document.getElementById("nav-drawer");
  const menuToggle = document.querySelector(".nav-menu-toggle");
  const headerMenus = Array.from(document.querySelectorAll(".header-menu"));

  function setDrawerState(open) {
    if (!drawer || !menuToggle) {
      return;
    }
    if (open) {
      drawer.setAttribute("data-open", "");
      drawer.setAttribute("aria-hidden", "false");
      menuToggle.setAttribute("aria-expanded", "true");
    } else {
      drawer.removeAttribute("data-open");
      drawer.setAttribute("aria-hidden", "true");
      menuToggle.setAttribute("aria-expanded", "false");
    }
  }

  function closeHeaderMenus(exceptMenu) {
    headerMenus.forEach(function (menu) {
      if (menu !== exceptMenu) {
        menu.removeAttribute("open");
      }
    });
  }

  if (menuToggle && drawer) {
    menuToggle.addEventListener("click", function () {
      setDrawerState(!drawer.hasAttribute("data-open"));
    });

    const drawerClose = drawer.querySelector(".nav-drawer-close");
    if (drawerClose) {
      drawerClose.addEventListener("click", function () {
        setDrawerState(false);
        menuToggle.focus();
      });
    }

    drawer.addEventListener("click", function (event) {
      const clickedInside = event.target.closest(".nav-drawer-content");
      const clickedLink = event.target.closest(".nav-drawer-link");
      if (!clickedInside || clickedLink) {
        setDrawerState(false);
      }
    });
  }

  headerMenus.forEach(function (menu) {
    const summary = menu.querySelector("summary");
    if (!summary) {
      return;
    }
    summary.addEventListener("click", function () {
      closeHeaderMenus(menu.hasAttribute("open") ? null : menu);
    });
  });

  document.addEventListener("click", function (event) {
    const clickedMenu = event.target.closest(".header-menu");
    if (!clickedMenu) {
      closeHeaderMenus(null);
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" && event.key !== "Esc") {
      return;
    }
    closeHeaderMenus(null);
    if (drawer && drawer.hasAttribute("data-open")) {
      setDrawerState(false);
      if (menuToggle) {
        menuToggle.focus();
      }
    }
  });
})();
