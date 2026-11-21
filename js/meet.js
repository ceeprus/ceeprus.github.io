import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  where,
  limit,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

var db = null;
var NAME_KEY = "meet-name";
var PIC_KEY = "meet-pic";
var CLOCK_KEY = "meet-clock";
var PIC_SIZE = 64;
var MAX_PIC = 12000;
var MAX_FILE = 15 * 1024 * 1024;
var MAX_DAYS = 31;
var WEEKLY_DAYS = 60;
var MONTHS_AHEAD = 12;
var DEFAULT_TITLE = "New event";
var TZ_KEY = "meet-tz";
var PICS_KEY = "meet-pics";
var LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
var MAX_CELL_PICS = 3;
var HALF_HOURS = [];
for (var hh = 0; hh < 1440; hh += 30) HALF_HOURS.push(hh);
var OWN_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
var ZONES = (Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : []).slice();
if (ZONES.indexOf(OWN_TZ) === -1) ZONES.push(OWN_TZ);
if (ZONES.indexOf("UTC") === -1) ZONES.push("UTC");
ZONES.sort();
var zoneNames = {};

function zoneOffset(zone) {
  if (zoneNames[zone] === undefined) {
    zoneNames[zone] = "";
    try {
      zoneNames[zone] = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
        .formatToParts(Date.now())
        .filter(function (p) { return p.type === "timeZoneName"; })[0].value;
    } catch (error) {}
  }
  return zoneNames[zone];
}

function zoneLabel(zone) {
  var offset = zoneOffset(zone);
  return zone.replace(/_/g, " ") + (offset ? " (" + offset + ")" : "");
}

function zoneShort(zone) {
  var offset = zoneOffset(zone);
  return zone.split("/").pop().replace(/_/g, " ") + (offset ? " " + offset : "");
}

function connect(config) {
  if (!db) db = initializeFirestore(initializeApp(config), { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  return db;
}

function remember(value, key) {
  try {
    if (value) localStorage.setItem(key || NAME_KEY, value);
    else localStorage.removeItem(key || NAME_KEY);
  } catch (error) {}
}

function recall(key) {
  try {
    return localStorage.getItem(key || NAME_KEY) || "";
  } catch (error) {
    return "";
  }
}

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function addMonths(day, n) {
  var d = day.split("-").map(Number);
  return isoDay(Date.UTC(d[0], d[1] - 1 + n, 1));
}

var formats = {};

function fmt(day, options) {
  var key = JSON.stringify(options);
  if (!formats[key]) formats[key] = new Intl.DateTimeFormat("en-GB", Object.assign({ timeZone: "UTC" }, options));
  return formats[key].format(Date.parse(day + "T12:00:00Z"));
}

function dayLabel(day) {
  return fmt(day, { weekday: "short", day: "numeric" });
}

function clockText(total, h12) {
  var h = Math.floor(total / 60) % 24;
  var m = String(total % 60).padStart(2, "0");
  if (!h12) return String(h).padStart(2, "0") + ":" + m;
  return (h % 12 || 12) + ":" + m + (h < 12 ? " AM" : " PM");
}

function isPic(value) {
  return typeof value === "string" && /^data:image\/(webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= MAX_PIC;
}

async function shrink(file) {
  if (!file || file.size > MAX_FILE || !/^image\//.test(file.type)) return "";
  var bitmap = await createImageBitmap(file);
  var side = Math.min(bitmap.width, bitmap.height);
  var canvas = document.createElement("canvas");
  canvas.width = PIC_SIZE;
  canvas.height = PIC_SIZE;
  canvas.getContext("2d").drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, PIC_SIZE, PIC_SIZE);
  bitmap.close();
  var out = canvas.toDataURL("image/webp", 0.8);
  if (out.indexOf("data:image/webp") !== 0) out = canvas.toDataURL("image/jpeg", 0.8);
  if (!isPic(out)) out = canvas.toDataURL("image/jpeg", 0.5);
  return isPic(out) ? out : "";
}

function avatar(name, pic) {
  var box = document.createElement("span");
  box.className = "meet-avatar";
  box.setAttribute("aria-hidden", "true");
  box.textContent = name.charAt(0).toUpperCase();
  if (isPic(pic)) {
    var img = document.createElement("img");
    img.alt = "";
    img.draggable = false;
    img.width = 20;
    img.height = 20;
    img.decoding = "async";
    img.onerror = function () { img.remove(); };
    img.src = pic;
    box.appendChild(img);
  }
  return box;
}

function today() {
  return isoDay(Date.now() - new Date().getTimezoneOffset() * 60000);
}

function eventId() {
  var m = /^#e=([A-Za-z0-9]{20})$/.exec(location.hash);
  return m ? m[1] : "";
}

export function start(area) {
  var M = window.MeetCore;
  var q = function (name) { return area.querySelector('[data-meet="' + name + '"]'); };
  var status = q("status");
  var create = q("create");
  var panel = q("event");
  var join = q("join");
  var who = q("who");
  var mine = q("mine");
  var group = q("group");
  var names = q("names");
  var titleInput = q("title");
  var store;

  var id = "";
  var event = null;
  var times = [];
  var per = 0;
  var people = {};
  var me = "";
  var free = [];
  var dirty = false;
  var timer = 0;
  var unsubscribe = [];
  var painting = null;
  var ready = false;
  var anchor = 0;
  var reach = 0;
  var base = [];
  var opening = 0;
  var pic = isPic(recall(PIC_KEY)) ? recall(PIC_KEY) : "";
  var thisMonth = today().slice(0, 8) + "01";
  var month = thisMonth;
  var mode = "dates";
  var chosen = { dates: {}, week: {} };
  var pick = null;
  var range = { from: 1080, to: 120 };
  var createTz = OWN_TZ;
  var viewTz = ZONES.indexOf(recall(TZ_KEY)) !== -1 ? recall(TZ_KEY) : OWN_TZ;
  var openSelect = null;
  var copyTimer = 0;
  var tapped = false;
  var clockChoice = recall(CLOCK_KEY);
  var hidePics = recall(PICS_KEY) !== "on";

  function say(text) {
    status.textContent = text;
  }

  try {
    store = connect(JSON.parse(area.dataset.config));
  } catch (error) {
    say("Meet is not set up yet.");
    return;
  }

  function ended(data) {
    return Boolean(data.expireAt) && data.expireAt.toMillis() < Date.now();
  }

  function remove(ref) {
    return getDocs(collection(ref, "people")).then(function (list) {
      return Promise.all(list.docs.map(function (d) { return deleteDoc(d.ref); }));
    }).then(function () {
      return deleteDoc(ref);
    });
  }

  function sweep() {
    var past = Timestamp.fromMillis(Date.now() - 300000);
    getDocs(query(collection(store, "events"), where("expireAt", "<", past), limit(10))).then(function (list) {
      return list.docs.reduce(function (chain, d) {
        return chain.then(function () { return remove(d.ref); });
      }, Promise.resolve());
    }).catch(function () {});
  }

  sweep();

  function clock() {
    if (clockChoice === "12" || clockChoice === "24") return Number(clockChoice);
    return event && event.clock === 12 ? 12 : 24;
  }

  function showClock() {
    var current = String(clock());
    area.querySelectorAll("[data-meet-clock]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.meetClock === current));
    });
    area.querySelectorAll("[data-meet-select]").forEach(drawSelect);
  }

  function setClock(value) {
    clockChoice = String(value);
    remember(clockChoice, CLOCK_KEY);
    showClock();
    if (event) {
      build(mine);
      build(group);
      paint();
    }
  }

  function setHidePics(on) {
    hidePics = on;
    remember(on ? "" : "on", PICS_KEY);
    if (event) paint();
  }

  function closeEvent() {
    flush();
    unsubscribe.forEach(function (stop) { stop(); });
    unsubscribe = [];
    id = "";
    event = null;
    people = {};
  }

  function showCreate() {
    closeEvent();
    panel.hidden = true;
    create.hidden = false;
    drawCal();
    drawWeek();
    showClock();
    say("");
  }

  function valuesOf(key) {
    return isZone(key) ? ZONES : HALF_HOURS;
  }

  function valueOf(key) {
    if (key === "tz") return createTz;
    if (key === "view") return viewTz;
    return range[key];
  }

  function labelOf(key, value) {
    return isZone(key) ? zoneLabel(value) : clockText(value, clock() === 12);
  }

  function isZone(key) {
    return key === "tz" || key === "view";
  }

  function drawSelect(host) {
    var key = host.dataset.meetSelect;
    var values = valuesOf(key);
    var button = host.querySelector(".meet-select-btn");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "meet-select-btn";
      button.setAttribute("aria-haspopup", "listbox");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-labelledby", host.dataset.label + " " + key + "Value");
      var value = document.createElement("span");
      value.id = key + "Value";
      button.appendChild(value);
      var list = document.createElement("ul");
      list.className = "meet-options";
      list.id = key + "List";
      list.setAttribute("role", "listbox");
      list.setAttribute("aria-labelledby", host.dataset.label);
      list.tabIndex = -1;
      values.forEach(function (v, index) {
        var option = document.createElement("li");
        option.setAttribute("role", "option");
        option.id = key + "Opt" + index;
        option.dataset.index = index;
        list.appendChild(option);
      });
      var pop = list;
      if (isZone(key)) {
        pop = document.createElement("div");
        var search = document.createElement("input");
        search.type = "search";
        search.className = "meet-search";
        search.placeholder = "Search city or GMT+3";
        search.autocomplete = "off";
        search.setAttribute("role", "combobox");
        search.setAttribute("aria-controls", list.id);
        search.setAttribute("aria-expanded", "true");
        search.addEventListener("input", function () { filterSelect(host); });
        var label = document.createElement("label");
        label.className = "meet-search-label";
        label.append("Search", search);
        pop.append(label, list);
      }
      pop.classList.add("meet-pop");
      pop.hidden = true;
      host.append(button, pop);
    }
    var current = valueOf(key);
    button.firstChild.textContent = isZone(key) ? zoneShort(current) : labelOf(key, current);
    button.title = labelOf(key, current);
    host.querySelectorAll("[role=option]").forEach(function (option) {
      var v = values[Number(option.dataset.index)];
      option.textContent = labelOf(key, v);
      option.setAttribute("aria-selected", String(v === current));
    });
  }

  function shownIndexes(host) {
    var out = [];
    host.querySelectorAll("[role=option]").forEach(function (option) {
      if (!option.hidden) out.push(Number(option.dataset.index));
    });
    return out;
  }

  function filterSelect(host) {
    var words = host.querySelector(".meet-search").value.toLowerCase().replace(/_/g, " ").trim().split(/\s+/).filter(Boolean);
    host.querySelectorAll("[role=option]").forEach(function (option) {
      var text = option.textContent.toLowerCase();
      option.hidden = !words.every(function (w) { return text.indexOf(w) !== -1; });
    });
    var shown = shownIndexes(host);
    if (shown.length) activate(host, shown.indexOf(host.active) !== -1 ? host.active : shown[0]);
    else activate(host, -1);
  }

  function selectOpen(host) {
    selectClose();
    var pop = host.querySelector(".meet-pop");
    var list = host.querySelector(".meet-options");
    var search = host.querySelector(".meet-search");
    var button = host.querySelector(".meet-select-btn");
    openSelect = host;
    pop.hidden = false;
    button.setAttribute("aria-expanded", "true");
    host.active = Math.max(0, valuesOf(host.dataset.meetSelect).indexOf(valueOf(host.dataset.meetSelect)));
    if (search) {
      search.value = "";
      filterSelect(host);
      search.focus({ preventScroll: true });
    } else {
      activate(host, host.active);
      list.focus({ preventScroll: true });
    }
    pop.scrollIntoView({ block: "nearest" });
  }

  function selectClose(focusButton) {
    if (!openSelect) return;
    var host = openSelect;
    openSelect = null;
    host.querySelector(".meet-pop").hidden = true;
    host.querySelector(".meet-select-btn").setAttribute("aria-expanded", "false");
    if (focusButton) host.querySelector(".meet-select-btn").focus();
  }

  function activate(host, index) {
    var list = host.querySelector(".meet-options");
    var search = host.querySelector(".meet-search");
    list.querySelectorAll("[data-active]").forEach(function (o) { o.removeAttribute("data-active"); });
    host.active = index;
    var option = list.querySelector('[data-index="' + index + '"]');
    if (!option) {
      list.removeAttribute("aria-activedescendant");
      if (search) search.removeAttribute("aria-activedescendant");
      return;
    }
    option.setAttribute("data-active", "");
    list.setAttribute("aria-activedescendant", option.id);
    if (search) search.setAttribute("aria-activedescendant", option.id);
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
  }

  function choose(host, index) {
    var key = host.dataset.meetSelect;
    var value = valuesOf(key)[index];
    if (key === "tz") createTz = value;
    else if (key === "view") {
      viewTz = value;
      remember(value, TZ_KEY);
      if (event) {
        build(mine);
        build(group);
        paint();
      }
    } else range[key] = value;
    drawSelect(host);
    selectClose(true);
  }

  function onSelectKey(e) {
    var host = e.target.closest("[data-meet-select]");
    if (!host) return;
    if (openSelect !== host) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].indexOf(e.key) !== -1 && e.target.closest(".meet-select-btn")) {
        e.preventDefault();
        selectOpen(host);
      }
      return;
    }
    var typing = !!e.target.closest(".meet-search");
    var shown = shownIndexes(host);
    var last = shown.length - 1;
    var at = Math.max(0, shown.indexOf(host.active));
    if (e.key === "ArrowDown") at = Math.min(last, at + 1);
    else if (e.key === "ArrowUp") at = Math.max(0, at - 1);
    else if (e.key === "PageDown") at = Math.min(last, at + 8);
    else if (e.key === "PageUp") at = Math.max(0, at - 8);
    else if ((e.key === "Home" || e.key === "End") && !typing) at = e.key === "Home" ? 0 : last;
    else if (e.key === "Enter" || (e.key === " " && !typing)) {
      e.preventDefault();
      if (host.active >= 0) choose(host, host.active);
      return;
    } else if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      return selectClose(e.key === "Escape");
    } else if (typing) {
      return;
    } else if (e.key.length === 1) {
      clearTimeout(host.typeTimer);
      host.typed = (host.typed || "") + e.key.toLowerCase();
      host.typeTimer = setTimeout(function () { host.typed = ""; }, 700);
      var options = host.querySelectorAll("[role=option]");
      for (var n = 0; n < options.length; n++) {
        if (options[n].textContent.toLowerCase().indexOf(host.typed) === 0) {
          at = shown.indexOf(n);
          break;
        }
      }
    } else return;
    e.preventDefault();
    if (shown.length) activate(host, shown[at]);
  }

  function onOutside(e) {
    if (openSelect && !openSelect.contains(e.target)) selectClose(false);
    var months = q("months");
    if (!months.hidden && !e.target.closest(".meet-month")) closeMonths(false);
  }

  function pickCell(grid, map, r, c, key, text, label) {
    var cell = document.createElement("button");
    cell.type = "button";
    cell.className = "meet-pick-cell";
    cell.dataset.r = r;
    cell.dataset.c = c;
    cell.dataset.key = key;
    cell.textContent = text;
    cell.setAttribute("aria-label", label);
    cell.setAttribute("aria-pressed", String(!!map[key]));
    grid.appendChild(cell);
    return cell;
  }

  function drawCal() {
    var cal = q("cal");
    cal.replaceChildren();
    LETTERS.forEach(function (letter) {
      var head = document.createElement("span");
      head.className = "meet-cal-head";
      head.setAttribute("aria-hidden", "true");
      head.textContent = letter;
      cal.appendChild(head);
    });
    var now = today();
    var first = M.weekStart(month);
    var end = addMonths(month, 1);
    for (var w = 0; M.addDays(first, w * 7) < end; w++) {
      for (var d = 0; d < 7; d++) {
        var day = M.addDays(first, w * 7 + d);
        var label = fmt(day, { weekday: "long", day: "numeric", month: "long" });
        var cell = pickCell(cal, chosen.dates, w, d, day, String(Number(day.slice(8))), label);
        cell.disabled = day < now;
        if (day.slice(0, 7) !== month.slice(0, 7)) cell.classList.add("meet-out");
      }
    }
    q("month-name").textContent = fmt(month, { month: "long", year: "numeric" });
    q("prev").disabled = month <= thisMonth;
    q("next").disabled = month >= addMonths(thisMonth, MONTHS_AHEAD - 1);
  }

  function drawMonths() {
    var box = q("months");
    box.replaceChildren();
    for (var i = 0; i < MONTHS_AHEAD; i++) {
      var value = addMonths(thisMonth, i);
      var b = document.createElement("button");
      b.type = "button";
      b.className = "meet-month-pick";
      b.dataset.month = value;
      b.textContent = fmt(value, { month: "short", year: "2-digit" });
      b.setAttribute("aria-label", fmt(value, { month: "long", year: "numeric" }));
      b.setAttribute("aria-pressed", String(value === month));
      box.appendChild(b);
    }
  }

  function openMonths() {
    drawMonths();
    q("months").hidden = false;
    q("month").setAttribute("aria-expanded", "true");
    var current = q("months").querySelector('[aria-pressed="true"]');
    if (current) current.focus();
  }

  function closeMonths(focus) {
    q("months").hidden = true;
    q("month").setAttribute("aria-expanded", "false");
    if (focus) q("month").focus();
  }

  function drawWeek() {
    var week = q("week");
    week.replaceChildren();
    for (var d = 0; d < 7; d++) {
      var day = M.addDays(M.weekStart(today()), d);
      pickCell(week, chosen.week, 0, d, String(d), fmt(day, { weekday: "short" }), fmt(day, { weekday: "long" }));
    }
  }

  function setMode(next) {
    mode = next;
    create.querySelectorAll("[data-meet-mode]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.meetMode === mode));
    });
    q("dates").hidden = mode !== "dates";
    q("week").hidden = mode !== "week";
  }

  function onAreaClick(e) {
    var t = e.target;
    var k = t.closest("[data-meet-clock]");
    if (k) return setClock(Number(k.dataset.meetClock));
    if (t.closest("[data-meet-pic]")) return q("file").click();
    var selectButton = t.closest(".meet-select-btn");
    if (selectButton) {
      var host = selectButton.closest("[data-meet-select]");
      return openSelect === host ? selectClose(false) : selectOpen(host);
    }
    var option = t.closest("[role=option]");
    if (option) return choose(option.closest("[data-meet-select]"), Number(option.dataset.index));
  }

  function onCreateClick(e) {
    var t = e.target;
    var m = t.closest("[data-meet-mode]");
    if (m) return setMode(m.dataset.meetMode);
    if (t.closest('[data-meet="prev"]')) {
      month = addMonths(month, -1);
      return drawCal();
    }
    if (t.closest('[data-meet="next"]')) {
      month = addMonths(month, 1);
      return drawCal();
    }
    if (t.closest('[data-meet="month"]')) return q("months").hidden ? openMonths() : closeMonths(true);
    var mp = t.closest("[data-month]");
    if (mp) {
      month = mp.dataset.month;
      closeMonths(true);
      return drawCal();
    }
    var cell = t.closest(".meet-pick-cell");
    if (cell && e.detail === 0) {
      var map = chosen[mode];
      if (map[cell.dataset.key]) delete map[cell.dataset.key];
      else map[cell.dataset.key] = true;
      cell.setAttribute("aria-pressed", String(!!map[cell.dataset.key]));
    }
  }

  function onCreateKey(e) {
    if (e.key === "Escape" && !q("months").hidden) {
      e.preventDefault();
      closeMonths(true);
    }
  }

  function pickFill(cell) {
    var map = Object.assign({}, pick.base);
    var r0 = Math.min(pick.r, Number(cell.dataset.r));
    var r1 = Math.max(pick.r, Number(cell.dataset.r));
    var c0 = Math.min(pick.c, Number(cell.dataset.c));
    var c1 = Math.max(pick.c, Number(cell.dataset.c));
    pick.grid.querySelectorAll(".meet-pick-cell").forEach(function (each) {
      var r = Number(each.dataset.r);
      var c = Number(each.dataset.c);
      if (!each.disabled && r >= r0 && r <= r1 && c >= c0 && c <= c1) {
        if (pick.value) map[each.dataset.key] = true;
        else delete map[each.dataset.key];
      }
      each.setAttribute("aria-pressed", String(!!map[each.dataset.key]));
    });
    chosen[mode] = map;
  }

  function onNoSelect(e) {
    if (!(e.target instanceof Element) || !e.target.closest("input")) e.preventDefault();
  }

  function onPickDown(e) {
    var cell = e.target.closest(".meet-pick-cell");
    if (!cell || cell.disabled || e.button > 0) return;
    e.preventDefault();
    pick = {
      grid: cell.parentNode,
      r: Number(cell.dataset.r),
      c: Number(cell.dataset.c),
      value: !chosen[mode][cell.dataset.key],
      base: Object.assign({}, chosen[mode]),
      last: cell
    };
    pick.grid.setPointerCapture(e.pointerId);
    pickFill(cell);
  }

  function onPickMove(e) {
    if (!pick) return;
    var node = document.elementFromPoint(e.clientX, e.clientY);
    var cell = node && node.closest && node.closest(".meet-pick-cell");
    if (cell && cell !== pick.last && cell.parentNode === pick.grid) {
      pick.last = cell;
      pickFill(cell);
    }
  }

  function onPickUp() {
    pick = null;
  }

  async function onCreate(e) {
    e.preventDefault();
    var title = create.elements.title.value.trim() || DEFAULT_TITLE;
    var weekly = mode === "week";
    var days = weekly
      ? Object.keys(chosen.week).map(Number).sort().map(function (d) { return M.addDays(M.weekStart(today()), d); })
      : Object.keys(chosen.dates).sort().filter(function (day) { return day >= today(); });
    if (!days.length) return say("Pick at least one day.");
    if (days.length > MAX_DAYS) return say("Pick 31 days or fewer.");
    var button = create.querySelector("button[type=submit]");
    button.disabled = true;
    say("Creating...");
    var shape = { days: days, from: range.from, to: range.to, step: 30, tz: createTz, weekly: weekly };
    try {
      var ref = await addDoc(collection(store, "events"), {
        title: title,
        days: days,
        from: range.from,
        to: range.to,
        step: 30,
        tz: createTz,
        weekly: weekly,
        clock: clock(),
        created: serverTimestamp(),
        expireAt: Timestamp.fromMillis(M.expiry(shape, Date.now(), WEEKLY_DAYS))
      });
      create.reset();
      chosen = { dates: {}, week: {} };
      location.hash = "#e=" + ref.id;
    } catch (error) {
      say("Could not create the event. Try again later.");
    } finally {
      button.disabled = false;
    }
  }

  async function openEvent(next) {
    var ticket = ++opening;
    closeEvent();
    create.hidden = true;
    panel.hidden = true;
    say("Loading...");
    var snap;
    try {
      snap = await getDoc(doc(store, "events", next));
    } catch (error) {
      say("Could not load the event. Try again later.");
      return;
    }
    if (ticket !== opening || eventId() !== next) return;
    if (!snap.exists()) {
      showCreate();
      say("This event doesn't exist. Check the link.");
      return;
    }
    if (ended(snap.data())) {
      var gone = await remove(snap.ref).then(function () { return true; }, function () { return false; });
      if (ticket !== opening || eventId() !== next) return;
      if (gone) {
        showCreate();
        say("This event has ended.");
        return;
      }
    }
    try {
      event = snap.data();
      times = M.slotTimes(event);
      per = M.slotsPerDay(event);
      free = M.decodeFree("", times.length);
      titleInput.value = event.title;
      q("grids").toggleAttribute("data-wide", event.days.length > 7);
      build(mine);
      build(group);
    } catch (error) {
      event = null;
      say("This event can't be shown.");
      return;
    }
    id = next;
    ready = false;
    panel.hidden = false;
    showClock();
    say("");
    showPic();
    setMe(recall());
    unsubscribe.push(onSnapshot(collection(store, "events", id, "people"), function (list) {
      ready = true;
      if (status.textContent === "Loading...") say("");
      people = {};
      list.forEach(function (d) { people[d.id] = d.data(); });
      if (me && !dirty && painting === null && people[M.nameKey(me)]) free = M.decodeFree(people[M.nameKey(me)].free, times.length);
      paint();
    }, function () {
      say("Lost the connection to the event. Reload to try again.");
    }));
    unsubscribe.push(onSnapshot(doc(store, "events", id), function (d) {
      if (!d.exists() || !event) return;
      event.title = d.data().title;
      if (document.activeElement !== titleInput) titleInput.value = event.title;
    }, function () {}));
  }

  function route() {
    var next = eventId();
    if (next) openEvent(next);
    else showCreate();
  }

  function onTitle() {
    if (!event || !id) return;
    var next = titleInput.value.trim() || DEFAULT_TITLE;
    titleInput.value = next;
    if (next === event.title) return;
    event.title = next;
    updateDoc(doc(store, "events", id), { title: next }).catch(function () {
      say("Could not rename the event. Reload the page and try again.");
    });
  }

  function onTitleKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      titleInput.blur();
    } else if (e.key === "Escape") {
      titleInput.value = event ? event.title : "";
      titleInput.blur();
    }
  }

  function h12() {
    return clock() === 12;
  }

  function header(day) {
    return event.weekly ? fmt(day, { weekday: "short" }) : dayLabel(day);
  }

  function build(grid) {
    var cells = [];
    grid.style.setProperty("--days", event.days.length);
    grid.replaceChildren(document.createElement("span"));
    event.days.forEach(function (day) {
      var head = document.createElement("span");
      head.className = "meet-day";
      head.textContent = header(day);
      grid.appendChild(head);
    });
    for (var r = 0; r < per; r++) {
      var label = document.createElement("span");
      label.className = "meet-time";
      var texts = [];
      for (var k = 0; k < event.days.length; k++) {
        var each = M.hourLabel(times[k * per + r], viewTz, h12());
        if (texts.indexOf(each) === -1) texts.push(each);
      }
      label.textContent = texts[0] ? texts.join("/") : "";
      grid.appendChild(label);
      for (var c = 0; c < event.days.length; c++) {
        var i = c * per + r;
        var cell = document.createElement("button");
        cell.type = "button";
        cell.className = "meet-cell";
        if (r > 0 && M.hourLabel(times[i], viewTz, false)) cell.classList.add("meet-hour");
        cell.dataset.i = i;
        cell.tabIndex = i === 0 ? 0 : -1;
        cell.setAttribute("aria-label", header(event.days[c]) + " " + M.labelFor(times[i], viewTz, h12()));
        grid.appendChild(cell);
        cells[i] = cell;
      }
    }
    grid.cells = cells;
    grid.at = 0;
    grid.shown = null;
  }

  function everyone() {
    var key = M.nameKey(me);
    var out = Object.keys(people).filter(function (k) { return !me || M.nameKey(people[k].name) !== key; }).map(function (k) { return people[k]; });
    if (me) out.push({ name: me, free: M.encodeFree(free) });
    return out;
  }

  function paint() {
    if (!event) return;
    var all = everyone();
    var t = M.tally(all, times.length);
    var joined = all.filter(function (p) { return p.free && p.free.indexOf("1") !== -1; });
    var total = joined.length;
    group.tally = t;
    group.total = total;
    group.everyone = joined.map(function (p) { return p.name; }).sort();
    q("legend-max").textContent = total + "/" + total + " free";
    q("legend-min").textContent = "0/" + total;
    for (var i = 0; i < times.length; i++) {
      if (mine.cells[i].free !== free[i]) {
        mine.cells[i].free = free[i];
        mine.cells[i].setAttribute("aria-pressed", String(free[i]));
      }
      var n = t.counts[i];
      var cell = group.cells[i];
      if (cell.count !== n + "/" + total) {
        cell.count = n + "/" + total;
        cell.dataset.level = n === 0 ? 0 : Math.max(1, Math.round((n / Math.max(total, 1)) * 4));
        cell.dataset.all = String(total > 1 && n === total);
        cell.setAttribute("aria-label", mine.cells[i].getAttribute("aria-label") + ", " + n + " of " + total + " free");
      }
      cellPics(cell, t.names[i]);
    }
    if (group.shown === null || group.shown === undefined) overview();
    else describe(group.cells[group.shown]);
  }

  function cellPics(cell, who) {
    var key = hidePics || event.days.length > 7 ? "" : who.map(function (name) { return name + ":" + picFor(name).length; }).join("\n");
    if (cell.picKey === key) return;
    cell.picKey = key;
    cell.replaceChildren();
    if (!key) return;
    var shown = who.slice().sort().slice(0, who.length > MAX_CELL_PICS ? MAX_CELL_PICS - 1 : MAX_CELL_PICS);
    shown.forEach(function (name) { cell.appendChild(avatar(name, picFor(name))); });
    if (who.length > shown.length) {
      var more = document.createElement("span");
      more.className = "meet-more";
      more.setAttribute("aria-hidden", "true");
      more.textContent = "+" + (who.length - shown.length);
      cell.appendChild(more);
    }
  }

  function nameList(target, items) {
    target.replaceChildren();
    items.forEach(function (name) {
      var item = document.createElement("li");
      var button = document.createElement("button");
      button.type = "button";
      button.className = "meet-name";
      button.dataset.name = name;
      button.append(avatar(name, picFor(name)), name);
      item.appendChild(button);
      target.appendChild(item);
    });
  }

  function picFor(name) {
    var key = M.nameKey(name);
    if (me && key === M.nameKey(me)) return pic;
    return people[key] && isPic(people[key].pic) ? people[key].pic : "";
  }

  function overview() {
    var all = group.everyone || [];
    group.shown = null;
    names.dataset.mode = "all";
    q("names-head").textContent = all.length ? all.length + " joined. Hover a time to see who's free." : "Nobody has marked hours yet.";
    q("yes-title").textContent = "Joined";
    nameList(q("yes"), all);
    nameList(q("no"), []);
  }

  function describe(cell) {
    var i = Number(cell.dataset.i);
    var yes = group.tally ? group.tally.names[i].slice().sort() : [];
    var no = (group.everyone || []).filter(function (n) { return yes.indexOf(n) === -1; });
    group.shown = i;
    names.dataset.mode = "slot";
    q("names-head").textContent = yes.length + "/" + (group.total || 0) + " free, " + mine.cells[i].getAttribute("aria-label");
    q("yes-title").textContent = "Available";
    nameList(q("yes"), yes);
    nameList(q("no"), no);
  }

  function solo(name) {
    var key = M.nameKey(name);
    var person = name ? everyone().filter(function (p) { return M.nameKey(p.name) === key; }).pop() : null;
    group.classList.toggle("meet-solo", !!person);
    group.cells.forEach(function (cell, i) {
      cell.dataset.solo = String(!!person && person.free[i] === "1");
    });
  }

  function onNameOver(e) {
    var button = e.target.closest(".meet-name");
    if (button) solo(button.dataset.name);
  }

  function onNameOut() {
    solo("");
  }

  function setMe(name) {
    var clean = String(name).trim().replace(/\s+/g, " ");
    if (!M.nameKey(clean)) {
      me = "";
      join.hidden = false;
      who.hidden = true;
      mine.setAttribute("aria-disabled", "true");
      q("gate").hidden = false;
      return false;
    }
    me = clean;
    remember(me);
    var existing = people[M.nameKey(me)];
    free = M.decodeFree(existing ? existing.free : "", times.length);
    q("me").replaceChildren("Marking hours as " + me);
    showPic();
    join.hidden = true;
    who.hidden = false;
    mine.removeAttribute("aria-disabled");
    q("gate").hidden = true;
    paint();
    return true;
  }

  function onJoin(e) {
    e.preventDefault();
    var field = join.elements.name;
    if (!setMe(field.value)) {
      field.setAttribute("aria-invalid", "true");
      field.focus();
      return;
    }
    field.removeAttribute("aria-invalid");
    say("");
  }

  function showPic() {
    area.querySelectorAll("[data-meet-pic]").forEach(function (button) {
      button.replaceChildren(pic ? avatar(me || "?", pic) : "+");
    });
  }

  async function onPicFile() {
    var input = q("file");
    var file = input.files[0];
    input.value = "";
    if (!file) return;
    if (file.size > MAX_FILE) return say("That picture is over 15 MB.");
    say("Shrinking picture...");
    var out = "";
    try {
      out = await shrink(file);
    } catch (error) {
      out = "";
    }
    if (!out) return say("Could not read that picture. Try a JPG or PNG.");
    pic = out;
    remember(pic, PIC_KEY);
    showPic();
    paint();
    say("");
    if (me && ready) schedule();
  }

  function onChange() {
    flush();
    remember("");
    join.elements.name.value = me;
    setMe("");
    join.elements.name.focus();
  }

  function schedule() {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(save, 600);
  }

  function save() {
    clearTimeout(timer);
    if (!dirty || !id || !me) return;
    dirty = false;
    var key = M.nameKey(me);
    var record = { name: me, free: M.encodeFree(free), updated: serverTimestamp() };
    if (isPic(pic)) record.pic = pic;
    if (event.expireAt) record.expireAt = event.expireAt;
    people[key] = { name: me, free: record.free, pic: pic };
    setDoc(doc(store, "events", id, "people", key), record).catch(function (error) {
      if (error && error.code === "permission-denied") say("Could not save. Reload the page and try again.");
      else say("Could not save. Check your connection.");
    });
  }

  function flush() {
    if (dirty) save();
  }

  function onHide() {
    if (document.visibilityState === "hidden") flush();
  }

  function cellAt(x, y) {
    var node = document.elementFromPoint(x, y);
    return node && node.closest && node.closest(".meet-mine .meet-cell");
  }

  function set(cell, value) {
    var i = Number(cell.dataset.i);
    if (free[i] === value) return;
    free[i] = value;
    paint();
  }

  function onDown(e) {
    tapped = e.pointerType === "touch";
    var cell = e.target.closest(".meet-cell");
    if (!cell || e.button > 0 || tapped) return;
    if (!ready) return say("Loading...");
    if (!me) return say("Type a nickname first.");
    e.preventDefault();
    anchor = Number(cell.dataset.i);
    base = free.slice();
    painting = !free[anchor];
    mine.setPointerCapture(e.pointerId);
    reach = anchor;
    fill(anchor);
  }

  function fill(to) {
    var r0 = Math.min(anchor % per, to % per);
    var r1 = Math.max(anchor % per, to % per);
    var c0 = Math.min(Math.floor(anchor / per), Math.floor(to / per));
    var c1 = Math.max(Math.floor(anchor / per), Math.floor(to / per));
    free = base.slice();
    for (var c = c0; c <= c1; c++) {
      for (var r = r0; r <= r1; r++) free[c * per + r] = painting;
    }
    paint();
  }

  function onMove(e) {
    if (painting === null) return;
    var cell = cellAt(e.clientX, e.clientY);
    if (!cell || Number(cell.dataset.i) === reach) return;
    reach = Number(cell.dataset.i);
    fill(reach);
  }

  function onUp() {
    if (painting === null) return;
    painting = null;
    schedule();
  }

  function onClick(e) {
    if (e.detail !== 0 && !tapped) return;
    var cell = e.target.closest(".meet-cell");
    if (!cell) return;
    if (!ready) return say("Loading...");
    if (!me) {
      say("Type a nickname first.");
      join.elements.name.focus();
      return;
    }
    set(cell, !free[Number(cell.dataset.i)]);
    schedule();
  }

  function onKey(grid, e) {
    var cell = e.target.closest(".meet-cell");
    if (!cell) return;
    var i = Number(cell.dataset.i);
    var r = i % per;
    var c = Math.floor(i / per);
    var days = event.days.length;
    if (e.key === "ArrowUp") r = Math.max(0, r - 1);
    else if (e.key === "ArrowDown") r = Math.min(per - 1, r + 1);
    else if (e.key === "ArrowLeft") c = Math.max(0, c - 1);
    else if (e.key === "ArrowRight") c = Math.min(days - 1, c + 1);
    else return;
    e.preventDefault();
    move(grid, c * per + r);
  }

  function move(grid, i) {
    grid.cells[grid.at].tabIndex = -1;
    grid.at = i;
    grid.cells[i].tabIndex = 0;
    grid.cells[i].focus();
    if (grid === group) describe(grid.cells[i]);
  }

  function onGroup(e) {
    var cell = e.target.closest(".meet-cell");
    if (cell) describe(cell);
  }

  function onGroupLeave() {
    if (!group.contains(document.activeElement)) overview();
  }

  function onCopy() {
    var url = location.origin + location.pathname + "#e=" + id;
    var copy = q("copy");
    var done = function () {
      copy.dataset.done = "true";
      copy.setAttribute("aria-label", "Link copied");
      clearTimeout(copyTimer);
      copyTimer = setTimeout(function () {
        delete copy.dataset.done;
        copy.setAttribute("aria-label", "Copy event link");
      }, 2000);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { window.prompt("Copy this link", url); });
    else window.prompt("Copy this link", url);
  }


  var mineKey = function (e) { onKey(mine, e); };
  var groupKey = function (e) { onKey(group, e); };
  var focusIn = function (e) {
    var grid = e.currentTarget;
    var cell = e.target.closest(".meet-cell");
    if (cell && grid.cells) {
      grid.cells[grid.at].tabIndex = -1;
      grid.at = Number(cell.dataset.i);
      cell.tabIndex = 0;
    }
  };

  ["from", "to", "tz", "view"].forEach(function (key) {
    var host = area.querySelector('[data-meet-select="' + key + '"]');
    if (host) drawSelect(host);
  });

  create.addEventListener("submit", onCreate);
  create.addEventListener("click", onCreateClick);
  create.addEventListener("keydown", onCreateKey);
  create.addEventListener("pointerdown", onPickDown);
  area.addEventListener("selectstart", onNoSelect);
  area.addEventListener("dragstart", onNoSelect);
  create.addEventListener("pointermove", onPickMove);
  create.addEventListener("pointerup", onPickUp);
  create.addEventListener("pointercancel", onPickUp);
  area.addEventListener("click", onAreaClick);
  area.addEventListener("keydown", onSelectKey);
  document.addEventListener("pointerdown", onOutside);
  q("file").addEventListener("change", onPicFile);
  q("gate").addEventListener("click", function () { join.elements.name.focus(); });
  titleInput.addEventListener("change", onTitle);
  titleInput.addEventListener("keydown", onTitleKey);
  join.addEventListener("submit", onJoin);
  q("change").addEventListener("click", onChange);
  q("copy").addEventListener("click", onCopy);
  q("pics").setAttribute("aria-pressed", String(!hidePics));
  q("pics").addEventListener("click", function (e) {
    setHidePics(!hidePics);
    e.currentTarget.setAttribute("aria-pressed", String(!hidePics));
  });
  join.elements.name.addEventListener("input", function (e) { e.target.removeAttribute("aria-invalid"); });
  mine.addEventListener("pointerdown", onDown);
  mine.addEventListener("pointermove", onMove);
  mine.addEventListener("pointerup", onUp);
  mine.addEventListener("pointercancel", onUp);
  mine.addEventListener("click", onClick);
  mine.addEventListener("keydown", mineKey);
  mine.addEventListener("focusin", focusIn);
  group.addEventListener("keydown", groupKey);
  group.addEventListener("focusin", focusIn);
  group.addEventListener("pointerover", onGroup);
  group.addEventListener("click", onGroup);
  group.addEventListener("pointerleave", onGroupLeave);
  group.addEventListener("focusout", function (e) {
    if (!group.contains(e.relatedTarget)) overview();
  });
  names.addEventListener("pointerover", onNameOver);
  names.addEventListener("pointerout", onNameOut);
  names.addEventListener("focusin", onNameOver);
  names.addEventListener("focusout", onNameOut);
  names.addEventListener("click", onNameOver);
  window.addEventListener("hashchange", route);
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", onHide);
  route();
}
