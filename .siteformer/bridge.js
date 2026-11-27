/* eslint-disable */
/*
 * SiteFormer editor bridge. Loaded only by the dev server (never in a production build), and only
 * active inside the SiteFormer editor's preview frame: it lets the editor pick elements for the
 * chat, edit text in place, follow the current page and see errors. It only talks to the editor
 * with postMessage and never changes files itself.
 *
 * Managed by SiteFormer: this file is rewritten automatically.
 */
(function () {
  if (typeof window === "undefined" || window.parent === window || window.__siteformer) return;
  window.__siteformer = true;

  var VERSION = 1;
  var BLUE = "#3b82f6";
  var editor = window.parent;
  var editorOrigin = null; // learned from the editor's hello
  var outbox = [];
  var mode = "none"; // none | select | text
  var hovered = null;
  var editing = null; // { el, before, editable }
  var picks = []; // elements picked for the chat: { n, el, loc, box, badge }
  var nextPick = 1;
  var ui = null;
  var frame = 0;

  function send(message) {
    message.sf = VERSION;
    if (editorOrigin) editor.postMessage(message, editorOrigin);
    else if (outbox.length < 20) outbox.push(message);
  }

  function currentPath() {
    return location.pathname + location.search + location.hash;
  }

  // ---------------------------------------------------------------- overlay (drawn in the page)

  function mountUi() {
    if (ui && ui.root.isConnected) return ui;
    var root = document.createElement("div");
    root.setAttribute("data-sf-ui", "");
    root.setAttribute("aria-hidden", "true");
    root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
    var hover = document.createElement("div");
    hover.style.cssText =
      "position:fixed;display:none;box-sizing:border-box;border-radius:4px;outline:2px dashed " +
      BLUE +
      ";outline-offset:1px;background:rgba(59,130,246,.08);";
    var label = document.createElement("div");
    label.style.cssText =
      "position:fixed;display:none;padding:1px 6px;border-radius:4px;background:" +
      BLUE +
      ";color:#fff;font:600 11px/16px ui-sans-serif,system-ui,sans-serif;white-space:nowrap;";
    root.appendChild(hover);
    root.appendChild(label);
    document.documentElement.appendChild(root);
    ui = { root: root, hover: hover, label: label };
    return ui;
  }

  function place(box, target) {
    if (!target || !target.isConnected) {
      box.style.display = "none";
      return null;
    }
    var r = target.getBoundingClientRect();
    box.style.display = "block";
    box.style.left = r.left + "px";
    box.style.top = r.top + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
    return r;
  }

  function draw() {
    frame = 0;
    if (!ui) return;
    var r = place(ui.hover, mode !== "none" ? hovered : null);
    if (r) {
      ui.label.textContent = mode === "text" ? "Edit text" : hovered.tagName.toLowerCase();
      ui.label.style.display = "block";
      ui.label.style.left = Math.max(0, r.left) + "px";
      ui.label.style.top = Math.max(0, r.top - 20) + "px";
    } else ui.label.style.display = "none";
    for (var i = 0; i < picks.length; i++) {
      var pick = picks[i];
      if (!pick.el.isConnected) pick.el = byLoc(pick.loc) || pick.el; // re-rendered by a hot update
      var p = place(pick.box, pick.el);
      if (!p) {
        pick.badge.style.display = "none";
        continue;
      }
      pick.badge.style.display = "grid";
      pick.badge.style.left = Math.min(window.innerWidth - 22, Math.max(2, p.right - 10)) + "px";
      pick.badge.style.top = Math.max(2, p.top - 10) + "px";
    }
  }

  function redraw() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  // ---------------------------------------------------------------- elements

  function byLoc(loc) {
    return loc ? document.querySelector('[data-sf-loc="' + CSS.escape(loc) + '"]') : null;
  }

  function tagged(node) {
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    if (!el || (ui && ui.root.contains(el))) return null;
    return el.closest("[data-sf-loc]");
  }

  // One plain text child: the case a direct edit can save (and React updates safely afterwards).
  function onlyText(el) {
    return el.childNodes.length === 1 && el.firstChild.nodeType === 3 && el.textContent.trim().length > 0;
  }

  // The element a click in the current mode is about (text mode: only text it can edit).
  function target(node) {
    var el = tagged(node);
    return el && mode === "text" && !onlyText(el) ? null : el;
  }

  function describe(el) {
    return {
      loc: el.getAttribute("data-sf-loc"),
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300),
      path: currentPath(),
    };
  }

  // ---------------------------------------------------------------- picks (Select)

  function pick(el) {
    // Picking an element twice doesn't add it twice.
    for (var i = 0; i < picks.length; i++) if (picks[i].el === el) return;
    mountUi();
    var n = nextPick++;
    var box = document.createElement("div");
    box.style.cssText =
      "position:fixed;display:none;box-sizing:border-box;border-radius:4px;outline:2px solid " +
      BLUE +
      ";outline-offset:1px;";
    var badge = document.createElement("div");
    badge.textContent = String(n);
    badge.style.cssText =
      "position:fixed;display:none;place-items:center;width:20px;height:20px;border-radius:999px;background:" +
      BLUE +
      ";color:#fff;font:700 11px/1 ui-sans-serif,system-ui,sans-serif;box-shadow:0 0 0 2px #fff,0 2px 6px rgba(0,0,0,.3);";
    ui.root.appendChild(box);
    ui.root.appendChild(badge);
    picks.push({ n: n, el: el, loc: el.getAttribute("data-sf-loc"), box: box, badge: badge });
    redraw();
    send({ type: "pick", n: n, element: describe(el) });
  }

  function keepPicks(numbers) {
    picks = picks.filter(function (p) {
      if (numbers.indexOf(p.n) !== -1) return true;
      p.box.remove();
      p.badge.remove();
      return false;
    });
    if (!picks.length) nextPick = 1;
    redraw();
  }

  // ---------------------------------------------------------------- text editing in place

  function startEditing(el) {
    if (editing || !onlyText(el)) return;
    editing = { el: el, before: el.textContent, editable: el.getAttribute("contenteditable") };
    hovered = null;
    redraw();
    el.setAttribute("contenteditable", "plaintext-only");
    if (el.contentEditable !== "plaintext-only") el.setAttribute("contenteditable", "true");
    el.focus();
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    send({ type: "editing" });
  }

  function stopEditing(commit) {
    if (!editing) return;
    var current = editing;
    editing = null;
    var el = current.el;
    if (current.editable === null) el.removeAttribute("contenteditable");
    else el.setAttribute("contenteditable", current.editable);
    // textContent: what was typed, before CSS (e.g. uppercase) changes how it looks.
    var after = el.textContent.replace(/ /g, " ").replace(/\s+/g, " ").trim();
    var before = current.before.replace(/\s+/g, " ").trim();
    if (!commit || !after || after === before) {
      if (el.textContent !== current.before) el.textContent = current.before;
      send({ type: "text-cancel" });
      return;
    }
    send({ type: "text-commit", loc: el.getAttribute("data-sf-loc"), before: before, after: after });
  }

  // ---------------------------------------------------------------- events in the page

  function swallow(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  function inEdit(e) {
    return editing && editing.el.contains(e.target);
  }

  document.addEventListener(
    "mousemove",
    function (e) {
      if (mode === "none" || editing) return;
      var el = target(e.target);
      if (el !== hovered) {
        hovered = el;
        mountUi();
        redraw();
      }
    },
    true,
  );
  // The pointer left the page (mouseleave on the root fires once, not per element).
  document.documentElement.addEventListener("mouseleave", function () {
    hovered = null;
    redraw();
  });
  ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick", "auxclick", "submit"].forEach(function (type) {
    document.addEventListener(
      type,
      function (e) {
        if (mode !== "none" && !inEdit(e)) swallow(e);
      },
      true,
    );
  });
  document.addEventListener(
    "click",
    function (e) {
      if (mode === "none" || inEdit(e)) return;
      swallow(e);
      if (editing) stopEditing(true);
      var el = target(e.target);
      if (!el) return;
      if (mode === "text") startEditing(el);
      else pick(el);
    },
    true,
  );
  document.addEventListener(
    "keydown",
    function (e) {
      if (editing) {
        if (e.key === "Enter" && !e.isComposing) {
          swallow(e);
          stopEditing(true);
        } else if (e.key === "Escape") {
          swallow(e);
          stopEditing(false);
        }
        return;
      }
      if (e.key === "Escape" && mode !== "none") {
        swallow(e);
        send({ type: "escape" });
      }
    },
    true,
  );
  document.addEventListener(
    "focusout",
    function (e) {
      if (editing && e.target === editing.el) stopEditing(true);
    },
    true,
  );
  window.addEventListener("scroll", redraw, true);
  window.addEventListener("resize", redraw);

  // ---------------------------------------------------------------- page location

  function announcePath() {
    send({ type: "location", path: currentPath() });
  }
  ["pushState", "replaceState"].forEach(function (name) {
    var original = history[name];
    history[name] = function () {
      var result = original.apply(this, arguments);
      setTimeout(announcePath, 0);
      return result;
    };
  });
  window.addEventListener("popstate", announcePath);
  window.addEventListener("hashchange", announcePath);

  // ---------------------------------------------------------------- errors

  var lastError = "";
  var lastErrorAt = 0;
  function reportError(message, stack, kind) {
    message = String(message || "Unknown error").slice(0, 1000);
    // React recovers from hydration mismatches by itself (often just a reload racing an edit).
    if (/hydrat/i.test(message)) return;
    var now = Date.now();
    if (message === lastError && now - lastErrorAt < 3000) return;
    lastError = message;
    lastErrorAt = now;
    send({ type: "error", kind: kind, message: message, stack: String(stack || "").slice(0, 3000), path: currentPath() });
  }
  window.addEventListener("error", function (e) {
    if (e && e.error) reportError(e.error.message || e.message, e.error.stack, "runtime");
  });
  window.addEventListener("unhandledrejection", function (e) {
    var reason = e && e.reason;
    reportError((reason && reason.message) || reason, reason && reason.stack, "runtime");
  });
  // Errors caught by the app's error boundaries are only logged.
  var consoleError = console.error;
  console.error = function () {
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] instanceof Error) {
        reportError(arguments[i].message, arguments[i].stack, "runtime");
        break;
      }
    }
    return consoleError.apply(this, arguments);
  };
  if (import.meta.hot) {
    // Build errors (a file that doesn't compile), as Vite reports them.
    import.meta.hot.on("vite:error", function (payload) {
      var err = payload && payload.err;
      if (err) reportError(err.message || "Build error", [err.id, err.frame].filter(Boolean).join("\n"), "build");
    });
    import.meta.hot.on("vite:afterUpdate", function () {
      lastError = "";
      send({ type: "updated" });
      redraw();
    });
  }

  // ---------------------------------------------------------------- messages from the editor

  function handle(data) {
    switch (data.type) {
      case "mode":
        if (editing) stopEditing(false);
        mode = data.mode === "select" || data.mode === "text" ? data.mode : "none";
        document.documentElement.style.cursor = mode === "select" ? "crosshair" : mode === "text" ? "text" : "";
        hovered = null;
        mountUi();
        redraw();
        break;
      case "picks":
        keepPicks(Array.isArray(data.keep) ? data.keep : []);
        // Numbering continues after a reload (earlier picks still sit in the chat box).
        if (typeof data.next === "number" && data.next >= nextPick) nextPick = data.next;
        break;
      case "viewport":
        send({ type: "viewport", scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY), path: currentPath() });
        break;
      case "scroll":
        // The editor's drawing layer covers the page; its wheel scrolls the page underneath.
        if (isFinite(data.x) && isFinite(data.y)) window.scrollBy(Number(data.x), Number(data.y));
        break;
    }
  }

  window.addEventListener("message", function (e) {
    if (e.source !== editor) return;
    var data = e.data;
    if (!data || data.sf !== VERSION || typeof data.type !== "string") return;
    if (data.type === "hello") {
      editorOrigin = e.origin;
      var queued = outbox;
      outbox = [];
      send({ type: "ready", path: currentPath() });
      for (var i = 0; i < queued.length; i++) send(queued[i]);
      return;
    }
    if (!editorOrigin || e.origin !== editorOrigin) return;
    try {
      handle(data);
    } catch (error) {
      // A bad command must never break the site itself.
    }
  });

  // Tell the editor the bridge is here (it answers with hello).
  editor.postMessage({ sf: VERSION, type: "here" }, "*");
})();
