(function () {
  var main = document.querySelector("main");
  var views = {};
  document.querySelectorAll("template[data-view-source]").forEach(function (node) {
    views[node.dataset.viewSource] = node;
  });
  if (!main || !views.index) return;

  var launch = 0;
  var current = null;

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
      area: ".atlas",
      status: '[data-atlas="status"]',
      fail: "Could not load the map. Check your connection.",
      load: function () {
        return Promise.all([
          addTag("link", { rel: "stylesheet", href: "/vendor/maplibre-gl.css" }),
          addTag("script", { src: "/vendor/maplibre-gl.js" })
            .then(function () { return addTag("script", { src: "/js/atlas-core.js" }); })
            .then(function () { return addTag("script", { src: "/js/atlas.js" }); })
        ]);
      },
      start: function (area) { return Atlas.start(area); }
    },
    {
      area: ".meet",
      status: '[data-meet="status"]',
      fail: "Could not load Meet. Check your connection.",
      load: function () {
        return addTag("script", { src: "/js/meet-core.js" }).then(function () { return import("/js/meet.js"); });
      },
      start: function (area, module) { return module.start(area); }
    },
    {
      area: ".mtg",
      status: '[data-mtg="card-status"]',
      fail: "Could not load card lookup. Check your connection.",
      load: function () { return addTag("script", { src: "/js/mtg.js" }); },
      start: function (area) { return MtgLookup.start(area); }
    }
  ];

  function startTool(tool, area) {
    var id = ++launch;
    if (!tool.assets) {
      tool.assets = tool.load().catch(function (error) {
        tool.assets = null;
        throw error;
      });
    }
    tool.assets
      .then(function (loaded) {
        return id === launch ? tool.start(area, loaded) : null;
      })
      .then(function (handle) {
        if (!handle) return;
        if (id === launch) current = handle;
        else handle.stop();
      })
      .catch(function () {
        area.querySelector(tool.status).textContent = tool.fail;
      });
  }

  function stopTool() {
    launch++;
    if (current) {
      current.stop();
      current = null;
    }
  }

  function show(name, focus) {
    stopTool();
    if (name !== "meet" && location.hash) history.replaceState(null, "", location.pathname);
    main.replaceChildren(views[name].content.cloneNode(true));
    tools.forEach(function (tool) {
      var area = main.querySelector(tool.area);
      if (area) startTool(tool, area);
    });
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
    if (searching) main.querySelector('[data-mtg="rules"]').open = true;
    main.querySelector(".mtg-jump").hidden = searching;
    main.querySelector('[data-mtg="count"]').textContent = searching ? shown + (shown === 1 ? " match" : " matches") : "";
  });

  show(/^#e=/.test(location.hash) ? "meet" : "index", false);
})();
