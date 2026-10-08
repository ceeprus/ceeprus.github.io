(function (root) {
  var STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
  var STORE = "atlas-v1";
  var FOG_FILL = "rgba(30,30,30,0.88)";
  var EXPORT_SIZE = 2048;
  var TILE = 256;
  var FEATHER = 0.35;
  var SKIP_PX = 0.75;
  var ringTables = {};
  var CLOUDS = [[1, 0.6, 0, 0], [2.4, 0.4, 61, 37]];
  var core = root.AtlasCore;
  var tileCanvas = null;

  var TEXT = {
    loading: "Loading map...",
    tiles: "Map tiles could not load. Check your connection.",
    empty: "Nothing explored yet. Choose Paint and draw on the map.",
    storage: "Progress can't be saved in this browser.",
    webgl: "Your browser can't show this map (WebGL is off).",
    nothing: "Nothing to export yet.",
    rendering: "Rendering PNG...",
    limit: "Drawing limit reached. Undo some strokes to keep painting."
  };

  function fogTile() {
    if (tileCanvas) return tileCanvas;
    tileCanvas = document.createElement("canvas");
    tileCanvas.width = TILE;
    tileCanvas.height = TILE;
    var c = tileCanvas.getContext("2d");
    var seed = 7;
    function rnd() {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    }
    for (var i = 0; i < 46; i++) {
      var x = rnd() * TILE;
      var y = rnd() * TILE;
      var r = 18 + rnd() * 52;
      var a = 0.05 + rnd() * 0.09;
      for (var dx = -TILE; dx <= TILE; dx += TILE) {
        for (var dy = -TILE; dy <= TILE; dy += TILE) {
          var g = c.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
          g.addColorStop(0, "rgba(205,212,222," + a + ")");
          g.addColorStop(1, "rgba(205,212,222,0)");
          c.fillStyle = g;
          c.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
        }
      }
    }
    return tileCanvas;
  }

  function tracePath(ctx, op, view) {
    var points = op[2];
    var count = points.length / 2;
    var p = view.project(points[0], points[1]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    if (count === 1) ctx.lineTo(p.x + 0.01, p.y);
    var stepLng = SKIP_PX * 360 / (512 * Math.pow(2, view.zoom));
    var stepLat = stepLng * Math.max(0.05, Math.cos(points[1] * Math.PI / 180));
    var lastLng = points[0];
    var lastLat = points[1];
    for (var i = 1; i < count; i++) {
      var lng = points[i * 2];
      var lat = points[i * 2 + 1];
      if (i < count - 1 && Math.abs(lng - lastLng) < stepLng && Math.abs(lat - lastLat) < stepLat) continue;
      p = view.project(lng, lat);
      ctx.lineTo(p.x, p.y);
      lastLng = lng;
      lastLat = lat;
    }
  }

  function strokeRings(ctx, op, view) {
    var width = Math.max(3, 2 * op[1] / core.metersPerPixel(op[2][1], view.zoom));
    var count = core.ringCount(width / 2);
    var alphas = ringTables[count] || (ringTables[count] = core.ringAlphas(count));
    ctx.globalCompositeOperation = op[0] === 0 ? "source-over" : "destination-out";
    ctx.strokeStyle = "#fff";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    tracePath(ctx, op, view);
    for (var i = 0; i < count; i++) {
      ctx.globalAlpha = alphas[i];
      ctx.lineWidth = Math.max(1, width * (1 - FEATHER * i / (count - 1)));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  function paintMask(ctx, ops, view) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    ops.forEach(function (op) {
      if (core.boxesOverlap(core.opBox(op), view.bounds)) strokeRings(ctx, op, view);
    });
  }

  function composeFog(ctx, mask, view) {
    var w = view.width;
    var h = view.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = FOG_FILL;
    ctx.fillRect(0, 0, w, h);
    var pattern = ctx.createPattern(fogTile(), "repeat");
    var origin = view.project(0, 0);
    CLOUDS.forEach(function (cloud) {
      var size = TILE * cloud[0];
      var ox = ((origin.x + cloud[2]) % size + size) % size;
      var oy = ((origin.y + cloud[3]) % size + size) % size;
      ctx.save();
      ctx.globalAlpha = cloud[1];
      ctx.translate(ox - size, oy - size);
      ctx.scale(cloud[0], cloud[0]);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, (w + size * 2) / cloud[0], (h + size * 2) / cloud[0]);
      ctx.restore();
    });
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }

  function pointCount(ops) {
    return ops.reduce(function (sum, op) {
      return sum + op[2].length / 2;
    }, 0);
  }

  function wrapLng(lng) {
    return ((lng + 180) % 360 + 360) % 360 - 180;
  }

  function formatKm(meters) {
    var km = meters / 1000;
    return (km < 10 ? km.toFixed(1) : String(Math.round(km))) + " km";
  }

  function readOps() {
    try {
      return core.decode(localStorage.getItem(STORE));
    } catch (error) {
      return [];
    }
  }

  function storageWorks() {
    try {
      localStorage.setItem(STORE + "-probe", "1");
      localStorage.removeItem(STORE + "-probe");
      return true;
    } catch (error) {
      return false;
    }
  }

  function waitFor(map, event, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error("timeout"));
      }, ms);
      map.once(event, function () {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  function makeCanvas(width, height) {
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  async function start(rootEl) {
    var mapEl = rootEl.querySelector('[data-atlas="map"]');
    var fogEl = rootEl.querySelector('[data-atlas="fog"]');
    var linesEl = rootEl.querySelector('[data-atlas="lines"]');
    var statusEl = rootEl.querySelector('[data-atlas="status"]');
    var sizeEl = rootEl.querySelector('[data-atlas="size"]');
    var sizeLabel = rootEl.querySelector('[data-atlas="size-label"]');
    var undoEl = rootEl.querySelector('[data-atlas="undo"]');
    var exportEl = rootEl.querySelector('[data-atlas="export"]');
    var modeEls = Array.prototype.slice.call(rootEl.querySelectorAll("[data-atlas-mode]"));
    var ctx = fogEl.getContext("2d");
    var baseEl = makeCanvas(1, 1);
    var maskEl = makeCanvas(1, 1);
    var baseCtx = baseEl.getContext("2d");
    var maskCtx = maskEl.getContext("2d");

    var ops = readOps();
    var mode = "move";
    var errorText = "";
    var transient = "";
    var saveFailed = !storageWorks();
    var stroke = null;
    var pointers = {};
    var pointerTotal = 0;
    var panning = null;
    var hover = null;
    var ring = document.createElement("div");
    ring.className = "atlas-brush";
    ring.hidden = true;
    rootEl.insertBefore(ring, statusEl);
    var bar = document.querySelector(".bar");
    var barWatch = null;
    var lastSig = "";
    var map = null;
    var linesMap = null;
    var parts = null;
    var stopped = false;
    var busy = false;

    function fitBar() {
      if (bar) rootEl.style.top = bar.getBoundingClientRect().height + "px";
    }

    function refreshStatus() {
      var text = transient || errorText || (saveFailed ? TEXT.storage : "") || (ops.length === 0 ? TEXT.empty : "");
      statusEl.textContent = text;
    }

    function setError(text) {
      errorText = text;
      refreshStatus();
    }

    function setTransient(text) {
      transient = text;
      refreshStatus();
    }

    function revealCount() {
      return ops.filter(function (op) {
        return op[0] === 0;
      }).length;
    }

    function refreshButtons() {
      undoEl.setAttribute("aria-disabled", String(ops.length === 0));
      exportEl.setAttribute("aria-disabled", String(revealCount() === 0));
    }

    function save() {
      try {
        localStorage.setItem(STORE, core.encode(ops));
        saveFailed = false;
      } catch (error) {
        saveFailed = true;
      }
    }

    function currentView() {
      var rect = mapEl.getBoundingClientRect();
      var b = map.getBounds();
      return {
        project: function (lng, lat) {
          var p = map.project([lng, lat]);
          return { x: p.x, y: p.y };
        },
        zoom: map.getZoom(),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
        bounds: { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }
      };
    }

    function fit(view) {
      [fogEl, baseEl, maskEl].forEach(function (canvas) {
        if (canvas.width !== view.width || canvas.height !== view.height) {
          canvas.width = view.width;
          canvas.height = view.height;
        }
      });
    }

    function present(view) {
      maskCtx.setTransform(1, 0, 0, 1, 0, 0);
      maskCtx.clearRect(0, 0, view.width, view.height);
      maskCtx.drawImage(baseEl, 0, 0);
      if (stroke) strokeRings(maskCtx, stroke, view);
      composeFog(ctx, maskEl, view);
    }

    function rebuild() {
      if (stopped || !map) return;
      var view = currentView();
      fit(view);
      paintMask(baseCtx, ops, view);
      present(view);
    }

    function sync() {
      if (stopped || !map) return;
      var center = map.getCenter();
      var signature = [center.lng, center.lat, map.getZoom(), mapEl.clientWidth, mapEl.clientHeight].join();
      if (signature === lastSig) return;
      lastSig = signature;
      placeRing();
      if (linesMap) {
        linesMap.jumpTo({ center: center, zoom: map.getZoom() });
        linesMap.redraw();
      }
      rebuild();
    }

    function setMode(next) {
      mode = next;
      modeEls.forEach(function (el) {
        el.setAttribute("aria-pressed", String(el.getAttribute("data-atlas-mode") === next));
      });
      var drawing = next !== "move";
      if (map) {
        if (drawing) {
          map.dragPan.disable();
          map.doubleClickZoom.disable();
        } else {
          map.dragPan.enable();
          map.doubleClickZoom.enable();
        }
        map.getCanvasContainer().style.cursor = drawing ? "none" : "";
      }
      placeRing();
    }

    function brushRadius() {
      return core.radiusFromSlider(Number(sizeEl.value));
    }

    function placeRing() {
      if (!hover || !map || mode === "move") {
        ring.hidden = true;
        return;
      }
      var rect = rootEl.getBoundingClientRect();
      var x = hover.x - rect.left;
      var y = hover.y - rect.top;
      var lat = stroke ? stroke[2][1] : Math.max(-85, Math.min(85, map.unproject([x, y]).lat));
      var size = Math.max(6, 2 * brushRadius() / core.metersPerPixel(lat, map.getZoom()));
      ring.style.width = size + "px";
      ring.style.height = size + "px";
      ring.style.transform = "translate(" + (x - size / 2) + "px," + (y - size / 2) + "px)";
      ring.hidden = false;
    }

    function track(event) {
      hover = event.pointerType === "touch" ? null : { x: event.clientX, y: event.clientY };
      placeRing();
    }

    function onLeave() {
      hover = null;
      placeRing();
    }

    function updateSizeLabel() {
      sizeLabel.textContent = formatKm(brushRadius());
      placeRing();
    }

    function lngLatFrom(event) {
      var rect = map.getCanvasContainer().getBoundingClientRect();
      var ll = map.unproject([event.clientX - rect.left, event.clientY - rect.top]);
      return [wrapLng(ll.lng), Math.max(-85, Math.min(85, ll.lat))];
    }

    function discardStroke() {
      if (!stroke) return;
      stroke = null;
      present(currentView());
    }

    function stopPan(event) {
      if (panning && panning.id === event.pointerId) panning = null;
    }

    function onDown(event) {
      track(event);
      pointers[event.pointerId] = true;
      pointerTotal++;
      if (event.button === 2) {
        discardStroke();
        panning = { id: event.pointerId, x: event.clientX, y: event.clientY };
        try {
          map.getCanvasContainer().setPointerCapture(event.pointerId);
        } catch (error) {
        }
        return;
      }
      if (pointerTotal > 1) {
        discardStroke();
        return;
      }
      if (mode === "move" || event.button !== 0) return;
      if (pointCount(ops) >= core.MAX_POINTS) {
        setTransient(TEXT.limit);
        return;
      }
      setTransient("");
      var at = lngLatFrom(event);
      stroke = [mode === "paint" ? 0 : 1, brushRadius(), [at[0], at[1]]];
      try {
        map.getCanvasContainer().setPointerCapture(event.pointerId);
      } catch (error) {
      }
      present(currentView());
    }

    function onMove(event) {
      track(event);
      if (panning && panning.id === event.pointerId) {
        map.panBy([panning.x - event.clientX, panning.y - event.clientY], { animate: false });
        panning.x = event.clientX;
        panning.y = event.clientY;
        return;
      }
      if (!stroke || !pointers[event.pointerId]) return;
      var points = stroke[2];
      var last = [points[points.length - 2], points[points.length - 1]];
      var next = lngLatFrom(event);
      if (!core.shouldAddPoint(last, next, stroke[1])) return;
      if (pointCount(ops) + points.length / 2 >= core.MAX_POINTS) {
        setTransient(TEXT.limit);
        return;
      }
      points.push(next[0], next[1]);
      present(currentView());
    }

    function release(event) {
      if (pointers[event.pointerId]) {
        delete pointers[event.pointerId];
        pointerTotal = Math.max(0, pointerTotal - 1);
      }
    }

    function onUp(event) {
      release(event);
      stopPan(event);
      if (!stroke) return;
      ops.push(stroke);
      var view = currentView();
      strokeRings(baseCtx, stroke, view);
      stroke = null;
      save();
      refreshButtons();
      refreshStatus();
      present(view);
    }

    function blockMenu(event) {
      event.preventDefault();
    }

    function onCancel(event) {
      release(event);
      stopPan(event);
      discardStroke();
    }

    function undo() {
      if (ops.length === 0) return;
      ops.pop();
      save();
      setTransient("");
      refreshButtons();
      rebuild();
    }

    async function shoot(styleObject, bounds) {
      var holder = document.createElement("div");
      holder.style.cssText = "position:fixed;left:0;top:0;width:" + EXPORT_SIZE + "px;height:" + EXPORT_SIZE + "px;opacity:0;pointer-events:none;z-index:-1";
      document.body.appendChild(holder);
      var shot = null;
      try {
        shot = new root.maplibregl.Map({
          container: holder,
          style: styleObject,
          bounds: [[bounds.west, bounds.south], [bounds.east, bounds.north]],
          fitBoundsOptions: { padding: 0 },
          interactive: false,
          attributionControl: false,
          fadeDuration: 0,
          pixelRatio: 1,
          renderWorldCopies: false,
          canvasContextAttributes: { preserveDrawingBuffer: true }
        });
        await Promise.all([waitFor(shot, "load", 60000), waitFor(shot, "idle", 90000)]);
        var layer = makeCanvas(EXPORT_SIZE, EXPORT_SIZE);
        var captured = new Promise(function (resolve) {
          shot.once("render", function () {
            layer.getContext("2d").drawImage(shot.getCanvas(), 0, 0, EXPORT_SIZE, EXPORT_SIZE);
            resolve();
          });
        });
        shot.triggerRepaint();
        await captured;
        return { canvas: layer, zoom: shot.getZoom() };
      } finally {
        if (shot) shot.remove();
        holder.remove();
      }
    }

    async function exportPng() {
      if (busy) return;
      var bounds = core.squareBounds(ops, 0.05);
      if (!bounds) {
        setTransient(TEXT.nothing);
        return;
      }
      busy = true;
      setTransient(TEXT.rendering);
      try {
        var shots = await Promise.all([
          shoot(parts.base, bounds),
          parts.lines.layers.length ? shoot(parts.lines, bounds) : null
        ]);
        var base = shots[0];
        var borders = shots[1];
        if (stopped) return;
        var out = makeCanvas(EXPORT_SIZE, EXPORT_SIZE);
        var octx = out.getContext("2d");
        octx.drawImage(base.canvas, 0, 0);
        var west = core.mercator(bounds.west, 0).x;
        var east = core.mercator(bounds.east, 0).x;
        var north = core.mercator(0, bounds.north).y;
        var south = core.mercator(0, bounds.south).y;
        var view = {
          project: function (lng, lat) {
            var m = core.mercator(lng, lat);
            return { x: (m.x - west) / (east - west) * EXPORT_SIZE, y: (m.y - north) / (south - north) * EXPORT_SIZE };
          },
          zoom: base.zoom,
          width: EXPORT_SIZE,
          height: EXPORT_SIZE,
          bounds: bounds
        };
        var exportMask = makeCanvas(EXPORT_SIZE, EXPORT_SIZE);
        paintMask(exportMask.getContext("2d"), ops, view);
        var exportFog = makeCanvas(EXPORT_SIZE, EXPORT_SIZE);
        composeFog(exportFog.getContext("2d"), exportMask, view);
        octx.drawImage(exportFog, 0, 0);
        if (borders) octx.drawImage(borders.canvas, 0, 0);
        var credit = "OpenStreetMap contributors, OpenMapTiles";
        octx.font = "22px sans-serif";
        var textWidth = octx.measureText(credit).width;
        octx.fillStyle = "rgba(30,30,30,0.85)";
        octx.fillRect(EXPORT_SIZE - textWidth - 36, EXPORT_SIZE - 44, textWidth + 36, 44);
        octx.fillStyle = "#fff";
        octx.fillText(credit, EXPORT_SIZE - textWidth - 18, EXPORT_SIZE - 14);
        await new Promise(function (resolve, reject) {
          out.toBlob(function (blob) {
            if (!blob) {
              reject(new Error("blob"));
              return;
            }
            var url = URL.createObjectURL(blob);
            var link = document.createElement("a");
            link.href = url;
            link.download = "explored.png";
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(function () {
              URL.revokeObjectURL(url);
            }, 1000);
            resolve();
          }, "image/png");
        });
        setTransient("");
      } catch (error) {
        setTransient("");
        setError(TEXT.tiles);
      } finally {
        busy = false;
      }
    }

    modeEls.forEach(function (el) {
      el.addEventListener("click", function () {
        setMode(el.getAttribute("data-atlas-mode"));
      });
    });
    sizeEl.addEventListener("input", updateSizeLabel);
    undoEl.addEventListener("click", undo);
    exportEl.addEventListener("click", exportPng);
    updateSizeLabel();
    refreshButtons();
    fitBar();
    setTransient(TEXT.loading);

    try {
      var response = await fetch(STYLE_URL);
      if (!response.ok) throw new Error("style");
      parts = core.splitStyle(core.cleanStyle(await response.json()));
    } catch (error) {
      setTransient("");
      setError(TEXT.tiles);
      return { stop: function () { stopped = true; } };
    }
    if (stopped) return { stop: function () {} };

    try {
      map = new root.maplibregl.Map({
        container: mapEl,
        style: parts.base,
        center: [0, 20],
        zoom: 2,
        minZoom: 1,
        maxZoom: 16,
        renderWorldCopies: false,
        maxBounds: [[-179.9, -84.9], [179.9, 84.9]],
        dragRotate: false,
        attributionControl: { compact: true }
      });
      map.touchZoomRotate.disableRotation();
    } catch (error) {
      setTransient("");
      setError(/webgl/i.test(String(error && error.message)) ? TEXT.webgl : TEXT.tiles);
      return { stop: function () { stopped = true; } };
    }

    if (linesEl && parts.lines.layers.length) {
      try {
        linesMap = new root.maplibregl.Map({
          container: linesEl,
          style: parts.lines,
          center: map.getCenter(),
          zoom: map.getZoom(),
          minZoom: 1,
          maxZoom: 16,
          interactive: false,
          attributionControl: false,
          fadeDuration: 0,
          renderWorldCopies: false
        });
      } catch (error) {
        linesMap = null;
      }
    }

    var container = map.getCanvasContainer();
    container.addEventListener("pointerdown", onDown);
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", onUp);
    container.addEventListener("pointercancel", onCancel);
    container.addEventListener("pointerleave", onLeave);
    container.addEventListener("contextmenu", blockMenu);
    if (bar && root.ResizeObserver) {
      barWatch = new root.ResizeObserver(fitBar);
      barWatch.observe(bar);
    }

    map.on("render", sync);
    map.on("load", function () {
      setTransient("");
      sync();
    });
    map.on("sourcedata", function (event) {
      if (event.isSourceLoaded && errorText === TEXT.tiles) setError("");
    });
    map.on("error", function (event) {
      var message = event && event.error && event.error.message ? String(event.error.message) : "";
      if (/webgl/i.test(message)) setError(TEXT.webgl);
      else setError(TEXT.tiles);
    });
    setMode("move");
    sync();

    return {
      stop: function () {
        stopped = true;
        container.removeEventListener("pointerdown", onDown);
        container.removeEventListener("pointermove", onMove);
        container.removeEventListener("pointerup", onUp);
        container.removeEventListener("pointercancel", onCancel);
        container.removeEventListener("pointerleave", onLeave);
        container.removeEventListener("contextmenu", blockMenu);
        ring.remove();
        if (barWatch) barWatch.disconnect();
        if (linesMap) {
          linesMap.remove();
          linesMap = null;
        }
        map.remove();
        map = null;
        ctx.clearRect(0, 0, fogEl.width, fogEl.height);
        statusEl.textContent = "";
      }
    };
  }

  root.Atlas = { start: start };
})(typeof globalThis !== "undefined" ? globalThis : this);
