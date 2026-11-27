(function () {
  var main = document.querySelector("main");
  if (!main) return;
  if (/^#e=/.test(location.hash) && !main.querySelector(".meet")) {
    location.replace("/site/projects/meet/" + location.hash);
    return;
  }

  var float = main.querySelector(".project-float");
  if (float) {
    var onScroll = function () { float.toggleAttribute("data-stuck", scrollY > 0); };
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  var V = "?v=30";
  var FOLDS = "mtg-folds";
  var autoOpened = false;

  function readFolds() {
    try {
      return JSON.parse(localStorage.getItem(FOLDS)) || {};
    } catch (error) {
      return {};
    }
  }

  function addTag(tag, props) {
    return new Promise(function (resolve, reject) {
      var node = Object.assign(document.createElement(tag), props);
      node.onload = resolve;
      node.onerror = reject;
      document.head.appendChild(node);
    });
  }

  var tools = [
    {
      area: ".meet",
      status: '[data-meet="status"]',
      fail: "Could not load Meet. Check your connection.",
      load: function () {
        return addTag("script", { src: "/js/meet-core.js" + V }).then(function () { return import("/js/meet.js" + V); });
      },
      start: function (area, module) { return module.start(area); }
    },
    {
      area: ".mtg",
      status: '[data-mtg="card-status"]',
      fail: "Could not load card lookup. Check your connection.",
      load: function () { return addTag("script", { src: "/js/mtg.js" + V }); },
      start: function (area) { return MtgLookup.start(area); }
    }
  ];

  tools.forEach(function (tool) {
    var area = main.querySelector(tool.area);
    if (!area) return;
    tool.load()
      .then(function (loaded) { return tool.start(area, loaded); })
      .catch(function () {
        area.querySelector(tool.status).textContent = tool.fail;
      });
  });

  var goty = main.querySelector(".goty");
  if (goty) {
    var showCat = function (key) {
      var cat = goty.querySelector('[data-cat="' + key + '"]');
      if (!cat) return;
      goty.querySelectorAll("[data-cat]").forEach(function (each) { each.hidden = each !== cat; });
      goty.querySelectorAll("[data-cat-pick]").forEach(function (chip) {
        chip.setAttribute("aria-pressed", String(chip.dataset.catPick === key));
      });
      reveal(goty.querySelector('[data-cat-pick="' + key + '"]'));
    };
    var reveal = function (chip) {
      var row = chip.parentElement;
      if (row.scrollWidth > row.clientWidth) {
        var gap = chip.getBoundingClientRect().left - row.getBoundingClientRect().left;
        if (gap < 0 || gap + chip.offsetWidth > row.clientWidth) row.scrollLeft += gap - 16;
      }
    };
    goty.addEventListener("focusin", function (event) {
      if (event.target.matches("[data-cat-pick]")) reveal(event.target);
    });
    goty.addEventListener("error", function (event) {
      if (event.target.tagName === "IMG") event.target.remove();
    }, true);
    goty.querySelectorAll(".goty-cover img").forEach(function (img) {
      if (img.complete && !img.naturalWidth) img.remove();
    });
    showCat(location.hash.slice(1));
    addEventListener("hashchange", function () { showCat(location.hash.slice(1) || "goty"); });

    goty.addEventListener("click", function (event) {
      var chip = event.target.closest("[data-cat-pick]");
      if (!chip) return;
      showCat(chip.dataset.catPick);
      history.replaceState(null, "", chip.dataset.catPick === "goty" ? location.pathname : "#" + chip.dataset.catPick);
    });
  }

  var folds = readFolds();
  main.querySelectorAll("[data-fold]").forEach(function (fold) {
    if (folds[fold.dataset.fold] === false) fold.open = false;
  });

  main.addEventListener("toggle", function (event) {
    var fold = event.target;
    if (!fold.dataset || !fold.dataset.fold) return;
    fold.dataset.moved = "";
    if (autoOpened && fold.dataset.fold === "rules") {
      autoOpened = false;
      return;
    }
    var saved = readFolds();
    saved[fold.dataset.fold] = fold.open;
    try {
      localStorage.setItem(FOLDS, JSON.stringify(saved));
    } catch (error) {}
  }, true);

  var picked = "all";

  function filterRules() {
    var clean = function (text) { return text.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9']+/g, " "); };
    var words = clean(main.querySelector('[data-mtg="card"]').value).trim().split(/\s+/);
    var searching = words.join("") !== "";
    var total = 0;
    var shown = 0;
    main.querySelectorAll(".mtg-group").forEach(function (group) {
      var count = 0;
      group.querySelectorAll(".mtg-entry").forEach(function (entry) {
        var text = " " + clean(entry.textContent);
        var hit = words.every(function (word) { return text.indexOf(" " + word) !== -1; });
        entry.hidden = !hit;
        if (hit) count++;
      });
      var chip = main.querySelector('[data-group="' + group.id.slice(4) + '"]');
      chip.lastChild.textContent = count;
      chip.setAttribute("aria-disabled", String(count === 0));
      var visible = count > 0 && (picked === "all" || group.id === "mtg-" + picked);
      group.hidden = !visible;
      total += count;
      if (visible) shown += count;
    });
    main.querySelector('[data-group="all"]').lastChild.textContent = total;
    main.querySelector('[data-mtg="empty"]').hidden = shown > 0;
    var rules = main.querySelector('[data-mtg="rules"]');
    if (searching && !rules.open) {
      autoOpened = true;
      rules.open = true;
    }
    main.querySelector('[data-mtg="count"]').textContent = searching || picked !== "all" ? shown + (shown === 1 ? " match" : " matches") : "";
  }

  main.addEventListener("click", function (event) {
    var chip = event.target.closest("[data-group]");
    if (!chip || (chip.getAttribute("aria-disabled") === "true" && chip.dataset.group !== picked)) return;
    picked = chip.dataset.group === picked ? "all" : chip.dataset.group;
    main.querySelectorAll("[data-group]").forEach(function (each) {
      each.setAttribute("aria-pressed", String(each.dataset.group === picked));
    });
    filterRules();
  });

  main.addEventListener("input", function (event) {
    if (event.target.matches('[data-mtg="card"]')) filterRules();
  });
})();
