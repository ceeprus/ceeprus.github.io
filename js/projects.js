(function () {
  var main = document.querySelector("main");
  var views = {};
  document.querySelectorAll("template[data-view-source]").forEach(function (node) {
    views[node.dataset.viewSource] = node;
  });
  if (!main || !views.index) return;

  var atlas = null;
  var launch = 0;
  var assets = null;
  var meet = null;
  var meetLaunch = 0;
  var meetAssets = null;

  function addTag(tag, props) {
    return new Promise(function (resolve, reject) {
      var node = Object.assign(document.createElement(tag), props);
      node.onload = resolve;
      node.onerror = reject;
      document.head.appendChild(node);
    });
  }

  function loadAssets() {
    if (!assets) {
      assets = Promise.all([
        addTag("link", { rel: "stylesheet", href: "/vendor/maplibre-gl.css" }),
        addTag("script", { src: "/vendor/maplibre-gl.js" })
          .then(function () { return addTag("script", { src: "/js/atlas-core.js" }); })
          .then(function () { return addTag("script", { src: "/js/atlas.js" }); })
      ]).catch(function (error) {
        assets = null;
        throw error;
      });
    }
    return assets;
  }

  function startAtlas(area) {
    var id = ++launch;
    loadAssets()
      .then(function () {
        return id === launch ? Atlas.start(area) : null;
      })
      .then(function (handle) {
        if (!handle) return;
        if (id === launch) atlas = handle;
        else handle.stop();
      })
      .catch(function () {
        area.querySelector('[data-atlas="status"]').textContent = "Could not load the map. Check your connection.";
      });
  }

  function stopAtlas() {
    launch++;
    if (atlas) {
      atlas.stop();
      atlas = null;
    }
  }

  function loadMeet() {
    if (!meetAssets) {
      meetAssets = addTag("script", { src: "/js/meet-core.js" })
        .then(function () { return import("/js/meet.js"); })
        .catch(function (error) {
          meetAssets = null;
          throw error;
        });
    }
    return meetAssets;
  }

  function startMeet(area) {
    var id = ++meetLaunch;
    loadMeet()
      .then(function (module) {
        if (id !== meetLaunch) return;
        meet = module.start(area);
      })
      .catch(function () {
        area.querySelector('[data-meet="status"]').textContent = "Could not load Meet. Check your connection.";
      });
  }

  function stopMeet() {
    meetLaunch++;
    if (meet) {
      meet.stop();
      meet = null;
    }
  }

  function show(name, focus) {
    stopAtlas();
    stopMeet();
    if (name !== "meet" && location.hash) history.replaceState(null, "", location.pathname);
    main.replaceChildren(views[name].content.cloneNode(true));
    var area = main.querySelector(".atlas");
    if (area) startAtlas(area);
    var board = main.querySelector(".meet");
    if (board) startMeet(board);
    var heading = main.querySelector("h2");
    if (focus && heading) heading.focus({ preventScroll: true });
  }

  main.addEventListener("click", function (event) {
    var target = event.target.closest("[data-view]");
    if (target && views[target.dataset.view]) show(target.dataset.view, true);
  });

  main.addEventListener("input", function (event) {
    if (!event.target.matches('[data-mtg="filter"]')) return;
    var clean = function (text) { return text.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9']+/g, " "); };
    var words = clean(event.target.value).trim().split(/\s+/);
    var shown = 0;
    main.querySelectorAll(".mtg-group").forEach(function (group) {
      var count = 0;
      group.querySelectorAll(".mtg-entry").forEach(function (entry) {
        var text = " " + clean(entry.textContent);
        var hit = words.every(function (word) { return text.indexOf(" " + word) !== -1; });
        entry.hidden = !hit;
        if (hit) count++;
      });
      group.hidden = count === 0;
      shown += count;
    });
    main.querySelector('[data-mtg="empty"]').hidden = shown > 0;
    var searching = words.join("") !== "";
    main.querySelector(".mtg-jump").hidden = searching;
    main.querySelector('[data-mtg="count"]').textContent = searching ? shown + (shown === 1 ? " match" : " matches") : "";
  });

  show(/^#e=/.test(location.hash) ? "meet" : "index", false);
})();
