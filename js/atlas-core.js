(function (root) {
  var EARTH = 40075016.686;
  var RADIUS = 6371008.8;
  var MAX_LAT = 85.0511287798;
  var MAX_POINTS = 50000;
  var MIN_RADIUS = 100;
  var MAX_RADIUS = 2000000;

  function toRad(degrees) {
    return degrees * Math.PI / 180;
  }

  function metersPerPixel(lat, zoom) {
    return EARTH * Math.cos(toRad(lat)) / (512 * Math.pow(2, zoom));
  }

  function distanceMeters(a, b) {
    var dLat = toRad(b[1] - a[1]);
    var dLng = toRad(b[0] - a[0]);
    var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.pow(Math.sin(dLng / 2), 2);
    return 2 * RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function mercator(lng, lat) {
    var clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
    var sin = Math.sin(toRad(clamped));
    return {
      x: (lng + 180) / 360,
      y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)
    };
  }

  function unmercator(x, y) {
    var lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
    return [x * 360 - 180, lat];
  }

  function radiusFromSlider(value) {
    return value * 1000;
  }

  function squareBounds(ops, pad) {
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    ops.forEach(function (op) {
      if (op[0] !== 0) return;
      var points = op[2];
      for (var i = 0; i < points.length; i += 2) {
        var m = mercator(points[i], points[i + 1]);
        var d = op[1] / (EARTH * Math.cos(toRad(Math.max(-MAX_LAT, Math.min(MAX_LAT, points[i + 1])))));
        minX = Math.min(minX, m.x - d);
        maxX = Math.max(maxX, m.x + d);
        minY = Math.min(minY, m.y - d);
        maxY = Math.max(maxY, m.y + d);
      }
    });
    if (!isFinite(minX)) return null;
    var side = Math.min(1, Math.max(maxX - minX, maxY - minY) * (1 + 2 * pad));
    var cx = Math.min(1 - side / 2, Math.max(side / 2, (minX + maxX) / 2));
    var cy = Math.min(1 - side / 2, Math.max(side / 2, (minY + maxY) / 2));
    var nw = unmercator(cx - side / 2, cy - side / 2);
    var se = unmercator(cx + side / 2, cy + side / 2);
    return { west: nw[0], north: nw[1], east: se[0], south: se[1] };
  }

  function round4(value) {
    return Math.round(value * 10000) / 10000;
  }

  function encode(ops) {
    return JSON.stringify({
      v: 1,
      ops: ops.map(function (op) {
        return [op[0], Math.round(op[1]), op[2].map(round4)];
      })
    });
  }

  function decode(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      return [];
    }
    if (!data || data.v !== 1 || !Array.isArray(data.ops)) return [];
    var total = 0;
    var ops = [];
    for (var i = 0; i < data.ops.length; i++) {
      var op = data.ops[i];
      if (!Array.isArray(op) || op.length !== 3) return [];
      var mode = op[0];
      var radius = op[1];
      var points = op[2];
      if (mode !== 0 && mode !== 1) return [];
      if (!isFinite(radius) || typeof radius !== "number" || radius < MIN_RADIUS || radius > MAX_RADIUS) return [];
      if (!Array.isArray(points) || points.length < 2 || points.length % 2 !== 0) return [];
      total += points.length / 2;
      if (total > MAX_POINTS) return [];
      for (var j = 0; j < points.length; j += 2) {
        var lng = points[j];
        var lat = points[j + 1];
        if (typeof lng !== "number" || typeof lat !== "number" || !isFinite(lng) || !isFinite(lat)) return [];
        if (lng < -180 || lng > 180 || lat < -MAX_LAT || lat > MAX_LAT) return [];
      }
      ops.push([mode, radius, points.slice()]);
    }
    return ops;
  }

  function cleanStyle(style) {
    style.layers = style.layers.filter(function (layer) {
      return layer.type !== "symbol";
    });
    var provinces = style.layers.find(function (layer) {
      return layer.id === "boundary_3";
    });
    if (provinces) {
      provinces.minzoom = 4;
      provinces.filter = ["all",
        [">=", ["get", "admin_level"], 3],
        ["<=", ["get", "admin_level"], 4],
        ["!=", ["get", "maritime"], 1],
        ["!=", ["get", "disputed"], 1]];
    }
    return style;
  }

  function splitStyle(style) {
    function isBorder(layer) {
      return /^boundary_/.test(layer.id);
    }
    var tones = { boundary_3: ["#6f6f6f", 1] };
    var borders = style.layers.filter(isBorder).map(function (layer) {
      var copy = JSON.parse(JSON.stringify(layer));
      var tone = tones[layer.id] || ["#9c9c9c", 1.3];
      copy.paint = copy.paint || {};
      copy.paint["line-color"] = tone[0];
      copy.paint["line-width"] = tone[1];
      copy.paint["line-opacity"] = 1;
      return copy;
    });
    return {
      base: Object.assign({}, style, {
        layers: style.layers.filter(function (layer) {
          return !isBorder(layer);
        })
      }),
      lines: Object.assign({}, style, { layers: borders })
    };
  }

  function opBox(op) {
    if (op.box) return op.box;
    var points = op[2];
    var west = Infinity;
    var south = Infinity;
    var east = -Infinity;
    var north = -Infinity;
    var widest = 0;
    for (var i = 0; i < points.length; i += 2) {
      west = Math.min(west, points[i]);
      east = Math.max(east, points[i]);
      south = Math.min(south, points[i + 1]);
      north = Math.max(north, points[i + 1]);
      widest = Math.max(widest, Math.abs(points[i + 1]));
    }
    var dLat = op[1] / 111320;
    var dLng = dLat / Math.max(0.05, Math.cos(toRad(Math.min(MAX_LAT, widest + dLat))));
    op.box = { west: west - dLng, south: south - dLat, east: east + dLng, north: north + dLat };
    return op.box;
  }

  function boxesOverlap(a, b) {
    return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
  }

  function ringAlphas(n) {
    var out = [];
    var prev = 0;
    for (var i = 0; i < n; i++) {
      var t = (i + 1) / n;
      var target = t * t * (3 - 2 * t);
      out.push(i === n - 1 ? 1 : 1 - (1 - target) / (1 - prev));
      prev = target;
    }
    return out;
  }

  function ringCount(radiusPx) {
    return Math.max(4, Math.min(12, Math.round(radiusPx * 0.35 / 2)));
  }

  function shouldAddPoint(last, next, radius) {
    return distanceMeters(last, next) >= radius * 0.15;
  }

  var core = {
    metersPerPixel: metersPerPixel,
    distanceMeters: distanceMeters,
    mercator: mercator,
    unmercator: unmercator,
    radiusFromSlider: radiusFromSlider,
    squareBounds: squareBounds,
    encode: encode,
    decode: decode,
    cleanStyle: cleanStyle,
    splitStyle: splitStyle,
    opBox: opBox,
    ringAlphas: ringAlphas,
    ringCount: ringCount,
    boxesOverlap: boxesOverlap,
    shouldAddPoint: shouldAddPoint,
    MAX_POINTS: MAX_POINTS
  };

  if (typeof module !== "undefined" && module.exports) module.exports = core;
  else root.AtlasCore = core;
})(typeof globalThis !== "undefined" ? globalThis : this);
