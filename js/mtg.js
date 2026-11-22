(function () {
  var API = "https://api.scryfall.com";
  var FORMATS = [
    ["standard", "Standard"],
    ["pioneer", "Pioneer"],
    ["modern", "Modern"],
    ["legacy", "Legacy"],
    ["vintage", "Vintage"],
    ["pauper", "Pauper"],
    ["commander", "Commander"]
  ];
  var STATUS = { legal: "Legal", not_legal: "Not legal", banned: "Banned", restricted: "Restricted" };
  var symbols = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function getJson(url, signal) {
    return fetch(url, { signal: signal, headers: { Accept: "application/json" } }).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) {
          var error = new Error(data.details || "Request failed");
          error.kind = data.type || data.code || "error";
          throw error;
        }
        return data;
      });
    });
  }

  function distance(a, b) {
    var row = [];
    for (var j = 0; j <= b.length; j++) row[j] = j;
    for (var i = 1; i <= a.length; i++) {
      var prev = row[0];
      row[0] = i;
      for (var k = 1; k <= b.length; k++) {
        var next = row[k];
        row[k] = Math.min(row[k] + 1, row[k - 1] + 1, prev + (a[i - 1] === b[k - 1] ? 0 : 1));
        prev = next;
      }
    }
    return row[b.length];
  }

  function closest(query, names, count) {
    var q = query.toLowerCase().trim();
    var qWords = q.split(/[^a-z0-9']+/).filter(Boolean);
    var seen = {};
    return names
      .filter(function (name) {
        if (seen[name] || /^(.+) \/\/ \1$/.test(name)) return false;
        seen[name] = true;
        return true;
      })
      .map(function (name, index) {
        var n = name.toLowerCase();
        var words = n.split(/[^a-z0-9']+/);
        var exact = qWords.length && qWords.every(function (w) { return words.indexOf(w) !== -1; });
        var score = exact ? 0 : Math.min(distance(q, n), distance(q, n.slice(0, q.length)) + 1);
        return { name: name, score: score, index: index };
      })
      .sort(function (a, b) { return a.score - b.score || a.index - b.index; })
      .slice(0, count)
      .map(function (item) { return item.name; });
  }

  function loadSymbols() {
    if (!symbols) {
      symbols = getJson(API + "/symbology").then(function (data) {
        var map = {};
        (data.data || []).forEach(function (symbol) { map[symbol.symbol] = symbol.svg_uri; });
        return map;
      }).catch(function () {
        symbols = null;
        return {};
      });
    }
    return symbols;
  }

  function richText(text, map) {
    var frag = document.createDocumentFragment();
    String(text).split(/(\{[^}]+\})/).forEach(function (part) {
      if (!part) return;
      if (map[part]) {
        var img = el("img", "mtg-sym");
        img.src = map[part];
        img.alt = part;
        img.width = 16;
        img.height = 16;
        frag.appendChild(img);
      } else {
        frag.appendChild(document.createTextNode(part));
      }
    });
    return frag;
  }

  function decorate(root, map) {
    root.querySelectorAll(".mtg-entry dd").forEach(function (dd) {
      Array.prototype.slice.call(dd.childNodes).forEach(function (node) {
        if (node.nodeType === 3 && node.nodeValue.indexOf("{") !== -1) node.replaceWith(richText(node.nodeValue, map));
      });
    });
  }

  function faceStats(face) {
    if (face.power != null) return face.power + "/" + face.toughness;
    if (face.loyalty != null) return "Loyalty " + face.loyalty;
    if (face.defense != null) return "Defense " + face.defense;
    return "";
  }

  function renderFace(face, map) {
    var box = el("div", "mtg-face");
    var head = el("p", "mtg-face-head");
    head.appendChild(el("strong", null, face.name));
    if (face.mana_cost) {
      var cost = el("span", "mtg-cost");
      cost.appendChild(richText(face.mana_cost, map));
      head.appendChild(cost);
    }
    box.appendChild(head);
    if (face.type_line) box.appendChild(el("p", "mtg-type", face.type_line));
    if (face.oracle_text) {
      var oracle = el("p", "mtg-oracle");
      oracle.appendChild(richText(face.oracle_text, map));
      box.appendChild(oracle);
    }
    var stats = faceStats(face);
    if (stats) box.appendChild(el("p", "mtg-stats", stats));
    return box;
  }

  function images(card) {
    if (card.image_uris) return [{ src: card.image_uris.normal, alt: card.name }];
    return (card.card_faces || []).filter(function (face) { return face.image_uris; }).map(function (face) {
      return { src: face.image_uris.normal, alt: face.name };
    });
  }

  function bracket(card) {
    var status = card.legalities && card.legalities.commander;
    if (status === "banned") return { flag: "Banned in Commander", text: "Not allowed at any bracket." };
    if (status !== "legal") return { flag: null, text: "Not legal in Commander." };
    if (card.game_changer) return { flag: "Game Changer", text: "None in brackets 1-2. Counts toward the limit of 3 in bracket 3. Any number in brackets 4-5." };
    return { flag: null, text: "Not a Game Changer. Fine in any bracket." };
  }

  function render(card, map) {
    var result = el("article", "mtg-card");
    var pics = el("div", "mtg-card-pics");
    images(card).forEach(function (image) {
      var img = el("img", "mtg-card-img");
      img.src = image.src;
      img.alt = image.alt;
      img.width = 488;
      img.height = 680;
      pics.appendChild(img);
    });
    result.appendChild(pics);

    var info = el("div", "mtg-card-info");
    var faces = card.card_faces && !card.oracle_text ? card.card_faces : [card];
    faces.forEach(function (face) { info.appendChild(renderFace(face, map)); });

    var b = bracket(card);
    var bracketBox = el("div", b.flag ? "mtg-bracket mtg-bracket-flag" : "mtg-bracket");
    bracketBox.appendChild(el("h4", null, "Commander bracket"));
    if (b.flag) bracketBox.appendChild(el("p", "mtg-bracket-name", b.flag));
    bracketBox.appendChild(el("p", null, b.text));
    info.appendChild(bracketBox);

    info.appendChild(el("h4", null, "Formats"));
    var list = el("dl", "mtg-legal");
    FORMATS.forEach(function (format) {
      var status = (card.legalities && card.legalities[format[0]]) || "not_legal";
      var row = el("div", "mtg-legal-row");
      row.appendChild(el("dt", null, format[1]));
      var tag = el("dd", "mtg-status", STATUS[status] || status);
      tag.dataset.status = status;
      row.appendChild(tag);
      list.appendChild(row);
    });
    info.appendChild(list);

    var rulings = el("details", "mtg-rulings");
    rulings.appendChild(el("summary", null, "Official rulings"));
    rulings.dataset.uri = card.rulings_uri;
    info.appendChild(rulings);

    if (/^https:\/\/scryfall\.com\//.test(card.scryfall_uri)) {
      var link = el("a", "mtg-card-link", "Open on Scryfall");
      link.href = card.scryfall_uri;
      link.target = "_blank";
      link.rel = "noopener";
      info.appendChild(link);
    }

    result.appendChild(info);
    return result;
  }

  function fillRulings(details, map, signal) {
    var summary = details.querySelector("summary");
    summary.textContent = "Official rulings (loading)";
    return getJson(details.dataset.uri, signal).then(function (data) {
      var items = data.data || [];
      summary.textContent = "Official rulings (" + items.length + ")";
      if (!items.length) {
        details.appendChild(el("p", null, "No official rulings for this card."));
        return;
      }
      var ul = el("ul");
      items.forEach(function (rule) {
        var li = el("li");
        li.appendChild(el("span", "mtg-date", rule.published_at));
        li.appendChild(document.createTextNode(" "));
        li.appendChild(richText(rule.comment, map));
        ul.appendChild(li);
      });
      details.appendChild(ul);
    }).catch(function (error) {
      if (error.name === "AbortError") return;
      summary.textContent = "Official rulings (could not load, close and open to retry)";
      delete details.dataset.loaded;
    });
  }

  function start(area) {
    var form = area.querySelector('[data-mtg="card-form"]');
    var input = area.querySelector('[data-mtg="card"]');
    var list = area.querySelector('[data-mtg="names"]');
    var status = area.querySelector('[data-mtg="card-status"]');
    var more = area.querySelector('[data-mtg="did-you-mean"]');
    var slot = area.querySelector('[data-mtg="card-result"]');
    var timer = 0;
    var suggest = null;
    var lookup = null;
    var active = -1;

    loadSymbols().then(function (map) { decorate(area, map); });

    function options() {
      return list.querySelectorAll('[role="option"]');
    }

    function setActive(index) {
      var items = options();
      active = items.length ? (index + items.length) % items.length : -1;
      items.forEach(function (item, i) { item.setAttribute("aria-selected", String(i === active)); });
      if (active >= 0) {
        input.setAttribute("aria-activedescendant", items[active].id);
        items[active].scrollIntoView({ block: "nearest" });
      } else {
        input.removeAttribute("aria-activedescendant");
      }
    }

    function closeList() {
      list.hidden = true;
      list.replaceChildren();
      input.setAttribute("aria-expanded", "false");
      setActive(-1);
    }

    function cancelSuggest() {
      clearTimeout(timer);
      if (suggest) suggest.abort();
      suggest = null;
    }

    function openList(names) {
      list.replaceChildren.apply(list, names.map(function (name, i) {
        var li = el("li", "mtg-option", name);
        li.title = name;
        li.id = "MtgOption" + i;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", "false");
        return li;
      }));
      list.hidden = !names.length;
      input.setAttribute("aria-expanded", String(names.length > 0));
      setActive(-1);
    }

    function showChoices(label, names) {
      more.replaceChildren();
      if (!names.length) return;
      more.appendChild(el("p", "mtg-more-label", label));
      var row = el("div", "mtg-choices");
      names.forEach(function (name) {
        var button = el("button", "mtg-choice", name);
        button.type = "button";
        button.dataset.card = name;
        row.appendChild(button);
      });
      more.appendChild(row);
    }

    function candidates(query, signal) {
      var prefix = query.replace(/[^a-z0-9]/gi, "").slice(0, 3);
      var requests = [
        getJson(API + "/cards/search?order=edhrec&q=" + encodeURIComponent(query), signal).then(function (d) {
          return (d.data || []).map(function (c) { return c.name; });
        }),
        getJson(API + "/cards/autocomplete?q=" + encodeURIComponent(query), signal).then(function (d) { return d.data || []; })
      ];
      if (prefix.length === 3) {
        requests.push(getJson(API + "/cards/autocomplete?q=" + encodeURIComponent(prefix), signal).then(function (d) { return d.data || []; }));
      }
      return Promise.all(requests.map(function (p) { return p.catch(function (e) { if (e.name === "AbortError") throw e; return []; }); }))
        .then(function (lists) { return [].concat.apply([], lists); });
    }

    function find(query) {
      query = query.trim();
      if (!query) return;
      cancelSuggest();
      closeList();
      if (lookup) lookup.abort();
      lookup = new AbortController();
      var signal = lookup.signal;
      more.replaceChildren();
      status.textContent = "Looking up " + query + "...";
      Promise.all([getJson(API + "/cards/named?fuzzy=" + encodeURIComponent(query), signal), loadSymbols()])
        .then(function (results) {
          status.textContent = "";
          slot.replaceChildren(render(results[0], results[1]));
          slot.hidden = false;
          var rulings = slot.querySelector(".mtg-rulings");
          rulings.addEventListener("toggle", function () {
            if (!rulings.open || rulings.dataset.loaded) return;
            rulings.dataset.loaded = "true";
            fillRulings(rulings, results[1], signal);
          });
        })
        .catch(function (error) {
          if (error.name === "AbortError") return;
          slot.hidden = true;
          slot.replaceChildren();
          if (error.kind !== "ambiguous" && error.kind !== "not_found") {
            status.textContent = "Could not reach Scryfall. Check your connection and try again.";
            return;
          }
          status.textContent = "Searching for close names...";
          return candidates(query, signal).then(function (names) {
            var picks = error.kind === "ambiguous" ? closest(query, names, 10) : closest(query, names, 6);
            if (!picks.length) {
              status.textContent = "No card called \"" + query + "\". Check the spelling.";
              return;
            }
            status.textContent = error.kind === "ambiguous" ? "Several cards match \"" + query + "\"." : "No card called \"" + query + "\".";
            showChoices(error.kind === "ambiguous" ? "Which one?" : "Did you mean:", picks);
          });
        })
        .catch(function (error) {
          if (error.name !== "AbortError") status.textContent = "Could not reach Scryfall. Check your connection and try again.";
        });
    }

    function onInput() {
      cancelSuggest();
      var query = input.value.trim();
      if (query.length < 2) {
        closeList();
        return;
      }
      timer = setTimeout(function () {
        suggest = new AbortController();
        getJson(API + "/cards/autocomplete?q=" + encodeURIComponent(query), suggest.signal).then(function (data) {
          if (input.value.trim() !== query || document.activeElement !== input) return;
          openList(closest(query, data.data || [], 8));
        }).catch(function () {});
      }, 200);
    }

    function pick(name) {
      input.value = name;
      find(name);
    }

    function onKey(event) {
      var open = !list.hidden;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!open) return;
        event.preventDefault();
        setActive(active + (event.key === "ArrowDown" ? 1 : -1));
      } else if (event.key === "Enter" && open && active >= 0) {
        event.preventDefault();
        pick(options()[active].textContent);
      } else if (event.key === "Escape" && open) {
        event.preventDefault();
        cancelSuggest();
        closeList();
      }
    }

    function onListDown(event) {
      event.preventDefault();
    }

    function onListClick(event) {
      var option = event.target.closest('[role="option"]');
      if (option) pick(option.textContent);
    }

    function onMoreClick(event) {
      var button = event.target.closest("[data-card]");
      if (button) pick(button.dataset.card);
    }

    function onBlur() {
      cancelSuggest();
      closeList();
    }

    function onSubmit(event) {
      event.preventDefault();
      find(input.value);
    }

    input.addEventListener("input", onInput);
    input.addEventListener("keydown", onKey);
    input.addEventListener("blur", onBlur);
    list.addEventListener("pointerdown", onListDown);
    list.addEventListener("click", onListClick);
    more.addEventListener("click", onMoreClick);
    form.addEventListener("submit", onSubmit);
  }

  window.MtgLookup = { start: start, closest: closest, distance: distance };
})();
