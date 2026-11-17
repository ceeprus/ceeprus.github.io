(function () {
  var formats = {};

  function parts(tz) {
    if (!formats[tz]) {
      formats[tz] = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric"
      });
    }
    return formats[tz];
  }

  function offset(tz, ms) {
    var f = {};
    parts(tz).formatToParts(ms).forEach(function (p) { f[p.type] = Number(p.value); });
    return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second) - Math.floor(ms / 1000) * 1000;
  }

  function wallToUtc(day, minutes, tz) {
    var d = day.split("-").map(Number);
    var guess = Date.UTC(d[0], d[1] - 1, d[2], 0, minutes);
    var first = offset(tz, guess);
    var utc = guess - first;
    var second = offset(tz, utc);
    return second === first ? utc : guess - second;
  }

  function span(event) {
    var to = event.to > event.from ? event.to : event.to + 1440;
    return to - event.from;
  }

  function slotsPerDay(event) {
    return Math.floor(span(event) / event.step);
  }

  function slotTimes(event) {
    var per = slotsPerDay(event);
    var out = [];
    event.days.forEach(function (day) {
      var start = wallToUtc(day, event.from, event.tz);
      for (var i = 0; i < per; i++) out.push(start + i * event.step * 60000);
    });
    return out;
  }

  var labels = {};

  function labelFor(ms, tz, h12) {
    var key = tz + (h12 ? "/12" : "/24");
    if (!labels[key]) {
      labels[key] = h12
        ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz })
        : new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz });
    }
    return labels[key].format(ms);
  }

  function hourLabel(ms, tz, h12) {
    var full = labelFor(ms, tz, false);
    if (full.slice(3) !== "00") return "";
    return h12 ? labelFor(ms, tz, true).replace(":00", "") : full;
  }

  function expiry(event, now, weeklyDays) {
    var end = event.weekly ? now + weeklyDays * 86400000 : slotTimes(event).pop() + event.step * 60000;
    return Math.max(end, now + 3600000);
  }

  function addDays(day, n) {
    return new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  }

  function weekday(day) {
    return (new Date(day + "T00:00:00Z").getUTCDay() + 6) % 7;
  }

  function weekStart(day) {
    return addDays(day, -weekday(day));
  }

  function nameKey(name) {
    var key = String(name).normalize("NFC").trim().replace(/\s+/g, " ").replace(/[İIı]/g, "i").toLowerCase();
    if (!key || key.length > 20 || key.indexOf("/") !== -1 || key === "." || key === ".." || /^__.*__$/.test(key)) return "";
    return key;
  }

  function encodeFree(list) {
    return list.map(function (on) { return on ? "1" : "0"; }).join("");
  }

  function decodeFree(text, count) {
    var out = [];
    var valid = typeof text === "string" && text.length === count;
    for (var i = 0; i < count; i++) out.push(valid && text[i] === "1");
    return out;
  }

  function tally(people, count) {
    var counts = [];
    var names = [];
    for (var i = 0; i < count; i++) {
      counts.push(0);
      names.push([]);
    }
    people.forEach(function (person) {
      if (typeof person.free !== "string" || person.free.length !== count) return;
      for (var j = 0; j < count; j++) {
        if (person.free[j] === "1") {
          counts[j]++;
          names[j].push(person.name);
        }
      }
    });
    return { counts: counts, names: names };
  }

  window.MeetCore = {
    slotsPerDay: slotsPerDay,
    slotTimes: slotTimes,
    expiry: expiry,
    labelFor: labelFor,
    hourLabel: hourLabel,
    addDays: addDays,
    weekday: weekday,
    weekStart: weekStart,
    nameKey: nameKey,
    encodeFree: encodeFree,
    decodeFree: decodeFree,
    tally: tally
  };
})();
