(function () {
  var SOURCE = "/img/a1f4c9.bin";
  var PAGE = "/site/projects.html";
  var HANDOFF_MS = 60000;
  var KEEP_MS = 30 * 24 * 60 * 60 * 1000;
  var ITERATIONS = 300000;
  var button = document.querySelector(".projects");
  if (!button) return;

  var onPage = location.pathname === PAGE;
  var packed = null;
  var views = null;
  var unlocked = false;
  var kept = false;
  var atlas = null;
  var launch = 0;
  var assets = null;
  var dialog = null;
  var form = null;
  var input = null;
  var keep = null;
  var message = null;
  var submit = null;

  function make(tag, props, parent) {
    var node = Object.assign(document.createElement(tag), props);
    if (parent) parent.appendChild(node);
    return node;
  }

  function run(mode, action) {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open("projects", 1);
      request.onupgradeneeded = function () {
        request.result.createObjectStore("s");
      };
      request.onerror = function () {
        reject(request.error);
      };
      request.onsuccess = function () {
        var db = request.result;
        var tx = db.transaction("s", mode);
        var result = action(tx.objectStore("s"));
        tx.oncomplete = function () {
          db.close();
          resolve(result.result);
        };
        tx.onerror = tx.onabort = function () {
          db.close();
          reject(tx.error);
        };
      };
    });
  }

  function saveSession(record) {
    return run("readwrite", function (store) { return store.put(record, "k"); });
  }

  function clearSession() {
    return run("readwrite", function (store) { return store.delete("k"); }).catch(function () {});
  }

  async function readSession() {
    var record = null;
    try {
      record = await run("readonly", function (store) { return store.get("k"); });
    } catch (error) {
      return null;
    }
    if (record && record.until > Date.now()) return record;
    if (record) clearSession();
    return null;
  }

  async function fetchPacked() {
    if (!packed) {
      var response = await fetch(SOURCE);
      if (!response.ok) throw new Error("missing");
      packed = new Uint8Array(await response.arrayBuffer());
    }
  }

  async function deriveKey(password) {
    await fetchPacked();
    var material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: packed.slice(0, 16), iterations: ITERATIONS, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
  }

  async function openWith(key) {
    await fetchPacked();
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: packed.slice(16, 28) }, key, packed.slice(28));
  }

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

  function show(name, focus) {
    stopAtlas();
    var holder = document.createElement("template");
    holder.innerHTML = views[name];
    var main = document.querySelector("main");
    main.replaceChildren(holder.content);
    var area = main.querySelector(".atlas");
    if (area) startAtlas(area);
    var heading = main.querySelector("h2");
    if (focus && heading) heading.focus({ preventScroll: true });
  }

  function reveal(buffer) {
    views = JSON.parse(new TextDecoder().decode(buffer)).views;
    unlocked = true;
    button.setAttribute("aria-pressed", "true");
    show("index", false);
  }

  function lock() {
    stopAtlas();
    views = null;
    unlocked = false;
    kept = false;
    document.querySelector("main").replaceChildren();
    button.setAttribute("aria-pressed", "false");
  }

  function signOut() {
    clearSession();
    lock();
  }

  function resetDialog() {
    form.reset();
    keep.setAttribute("aria-pressed", "false");
    message.textContent = "";
    input.removeAttribute("aria-invalid");
    submit.disabled = false;
  }

  async function unlock(event) {
    event.preventDefault();
    submit.disabled = true;
    input.removeAttribute("aria-invalid");
    message.textContent = "Unlocking...";
    try {
      var key = await deriveKey(input.value);
      var bytes = await openWith(key);
      var staying = keep.getAttribute("aria-pressed") === "true";
      var stored = true;
      if (staying || !onPage) {
        try {
          await saveSession({ key: key, keep: staying, until: Date.now() + (staying ? KEEP_MS : HANDOFF_MS) });
        } catch (error) {
          stored = false;
        }
      }
      if (!onPage) {
        location.href = PAGE;
        return;
      }
      kept = staying && stored;
      reveal(bytes);
      if (staying && !stored) {
        message.textContent = "This browser can't keep you signed in.";
        submit.disabled = false;
        return;
      }
      dialog.close();
    } catch (error) {
      message.textContent = error.name === "OperationError" ? "Wrong password." : "Could not unlock here. Try again.";
      if (error.name === "OperationError") input.setAttribute("aria-invalid", "true");
      submit.disabled = false;
      input.select();
    }
  }

  function build() {
    dialog = make("dialog", { className: "projects-dialog" });
    dialog.setAttribute("aria-labelledby", "ProjectsTitle");
    form = make("form", { method: "dialog" }, dialog);
    make("h2", { id: "ProjectsTitle", textContent: "Projects" }, form);
    var label = make("label", { textContent: "Password" }, form);
    input = make("input", { type: "password", required: true, autocomplete: "off" }, label);
    keep = make("button", { type: "button", className: "projects-keep", textContent: "Keep me signed in" }, form);
    keep.setAttribute("aria-pressed", "false");
    keep.addEventListener("click", function () {
      keep.setAttribute("aria-pressed", String(keep.getAttribute("aria-pressed") !== "true"));
    });
    message = make("p", { className: "projects-message" }, form);
    message.setAttribute("role", "status");
    var actions = make("div", { className: "projects-actions" }, form);
    var cancel = make("button", { type: "button", textContent: "Cancel" }, actions);
    submit = make("button", { type: "submit", className: "projects-go", textContent: "Unlock" }, actions);
    cancel.addEventListener("click", function () { dialog.close(); });
    form.addEventListener("submit", unlock);
    document.body.appendChild(dialog);
  }

  function ask() {
    if (!dialog) build();
    if (dialog.open) return;
    resetDialog();
    dialog.showModal();
  }

  async function resume() {
    var record = await readSession();
    if (!record) {
      ask();
      return;
    }
    if (!record.keep) clearSession();
    try {
      reveal(await openWith(record.key));
      kept = record.keep;
    } catch (error) {
      clearSession();
      ask();
    }
  }

  button.addEventListener("click", async function () {
    if (!onPage) {
      var record = await readSession();
      if (record && record.keep) location.href = PAGE;
      else ask();
      return;
    }
    if (kept) {
      if (views) show("index", true);
      return;
    }
    if (unlocked) lock();
    else ask();
  });

  if (onPage) {
    document.querySelector("main").addEventListener("click", function (event) {
      if (event.target.closest("[data-signout]")) {
        signOut();
        return;
      }
      var target = event.target.closest("[data-view]");
      if (target && views && views[target.dataset.view]) show(target.dataset.view, true);
    });
    resume();
  }
})();
