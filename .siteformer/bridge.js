/* eslint-disable */
/*
 * SiteFormer editor bridge. Loaded only by the dev server (never in a production build), and only
 * active inside the SiteFormer editor's preview frame: it lets the editor select elements, edit
 * text in place, pin notes, follow the current page and see errors. It only talks to the editor
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
  var mode = "none"; // none | select | annotate
  var hovered = null;
  var selected = null;
  var editing = null; // { el, before, editable }
  var pins = []; // { n, el }
  var nextPin = 1;
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

  function box(solid) {
    var el = document.createElement("div");
    el.style.cssText =
      "position:fixed;display:none;pointer-events:none;box-sizing:border-box;border-radius:4px;" +
      (solid
        ? "outline:2px solid " + BLUE + ";outline-offset:1px;"
        : "outline:2px dashed " + BLUE + ";outline-offset:1px;background:rgba(59,130,246,.08);");
    return el;
  }

  function mountUi() {
    if (ui && ui.root.isConnected) return ui;
    var root = document.createElement("div");
    root.setAttribute("data-sf-ui", "");
    root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
    var hover = box(false);
    var label = document.createElement("div");
    label.style.cssText =
      "position:fixed;display:none;pointer-events:none;padding:1px 6px;border-radius:4px;background:" +
      BLUE +
      ";color:#fff;font:600 11px/16px ui-sans-serif,system-ui,sans-serif;white-space:nowrap;";
    var picked = box(true);
    var pinLayer = document.createElement("div");
    root.appendChild(hover);
    root.appendChild(label);
    root.appendChild(picked);
    root.appendChild(pinLayer);
    document.documentElement.appendChild(root);
    ui = { root: root, hover: hover, label: label, picked: picked, pins: pinLayer };
    return ui;
  }

  function place(el, target) {
    if (!target || !target.isConnected) {
      el.style.display = "none";
      return;
    }
    var r = target.getBoundingClientRect();
    el.style.display = "block";
    el.style.left = r.left + "px";
    el.style.top = r.top + "px";
    el.style.width = r.width + "px";
    el.style.height = r.height + "px";
  }

  function draw() {
    frame = 0;
    if (!ui) return;
    place(ui.hover, mode !== "none" && hovered !== selected ? hovered : null);
    if (mode !== "none" && hovered && hovered !== selected) {
      var r = hovered.getBoundingClientRect();
      ui.label.textContent = hovered.tagName.toLowerCase();
      ui.label.style.display = "block";
      ui.label.style.left = Math.max(0, r.left) + "px";
      ui.label.style.top = Math.max(0, r.top - 20) + "px";
    } else ui.label.style.display = "none";
    place(ui.picked, selected);
    for (var i = 0; i < pins.length; i++) {
      var pin = pins[i];
      if (!pin.el.isConnected) {
        pin.dot.style.display = "none";
        continue;
      }
      var p = pin.el.getBoundingClientRect();
      pin.dot.style.display = "grid";
      pin.dot.style.left = Math.min(window.innerWidth - 22, Math.max(2, p.right - 10)) + "px";
      pin.dot.style.top = Math.max(2, p.top - 10) + "px";
    }
  }

  function redraw() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  // ---------------------------------------------------------------- elements

  function tagged(node) {
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    if (!el || (ui && ui.root.contains(el))) return null;
    return el.closest("[data-sf-loc]");
  }

  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  // One plain text child: the case a direct edit can save (and React updates safely afterwards).
  function onlyText(el) {
    return el.childNodes.length === 1 && el.firstChild.nodeType === 3 && el.textContent.trim().length > 0;
  }

  function describe(el) {
    var cs = getComputedStyle(el);
    return {
      loc: el.getAttribute("data-sf-loc"),
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300),
      textEditable: onlyText(el),
      image: el.tagName === "IMG" ? el.getAttribute("src") || "" : null,
      classes: (el.getAttribute("class") || "").slice(0, 2000),
      path: currentPath(),
      rect: rectOf(el),
      style: {
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        textAlign: cs.textAlign,
        borderRadius: cs.borderTopLeftRadius,
      },
    };
  }

  // The site's theme colors, so the editor's swatches show the real ones.
  var THEME = ["background", "foreground", "primary", "primary-foreground", "muted", "muted-foreground", "accent", "border"];
  function themeColors() {
    var cs = getComputedStyle(document.documentElement);
    var out = {};
    THEME.forEach(function (name) {
      var value = cs.getPropertyValue("--" + name).trim();
      if (value) out[name] = value;
    });
    return out;
  }

  function sameLoc(el) {
    var loc = el.getAttribute("data-sf-loc");
    return Array.prototype.slice.call(document.querySelectorAll('[data-sf-loc="' + CSS.escape(loc) + '"]'));
  }

  function select(el) {
    selected = el;
    mountUi();
    redraw();
    send({ type: "select", element: describe(el) });
  }

  function deselect() {
    stopEditing(false);
    if (!selected) return;
    selected = null;
    redraw();
  }

  // ---------------------------------------------------------------- pins

  function addPin(el) {
    mountUi();
    var n = nextPin++;
    var dot = document.createElement("div");
    dot.textContent = String(n);
    dot.style.cssText =
      "position:fixed;display:grid;place-items:center;width:20px;height:20px;border-radius:999px;background:" +
      BLUE +
      ";color:#fff;font:700 11px/1 ui-sans-serif,system-ui,sans-serif;box-shadow:0 0 0 2px #fff,0 2px 6px rgba(0,0,0,.3);";
    ui.pins.appendChild(dot);
    pins.push({ n: n, el: el, dot: dot });
    redraw();
    send({ type: "pin", n: n, element: describe(el) });
  }

  function keepPins(numbers) {
    pins = pins.filter(function (pin) {
      if (numbers.indexOf(pin.n) !== -1) return true;
      pin.dot.remove();
      return false;
    });
    if (!pins.length) nextPin = 1;
    redraw();
  }

  // ---------------------------------------------------------------- text editing in place

  function startEditing() {
    if (!selected || !onlyText(selected) || editing) return;
    var el = selected;
    editing = { el: el, before: el.textContent, editable: el.getAttribute("contenteditable") };
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
    var after = el.textContent.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    var before = current.before.replace(/\s+/g, " ").trim();
    if (!commit || !after || after === before) {
      el.textContent = current.before;
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
      var el = tagged(e.target);
      if (el !== hovered) {
        hovered = el;
        mountUi();
        redraw();
      }
    },
    true,
  );
  document.addEventListener(
    "mouseleave",
    function () {
      hovered = null;
      redraw();
    },
    true,
  );
  ["pointerdown", "mousedown", "pointerup", "mouseup", "auxclick", "submit"].forEach(function (type) {
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
      var el = tagged(e.target);
      if (!el) return;
      if (mode === "annotate") addPin(el);
      else select(el);
    },
    true,
  );
  document.addEventListener(
    "dblclick",
    function (e) {
      if (mode !== "select" || inEdit(e)) return;
      swallow(e);
      var el = tagged(e.target);
      if (!el) return;
      if (el !== selected) select(el);
      startEditing();
    },
    true,
  );
  document.addEventListener(
    "keydown",
    function (e) {
      if (editing) {
        if (e.key === "Enter") {
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

  // Drop an image file on a picture to replace it.
  function imageUnder(e) {
    var el = tagged(e.target);
    return el && el.tagName === "IMG" ? el : null;
  }
  function hasFiles(e) {
    return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") !== -1;
  }
  document.addEventListener(
    "dragover",
    function (e) {
      if (!editorOrigin || !hasFiles(e)) return;
      var img = imageUnder(e);
      if (!img) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      hovered = img;
      mountUi();
      redraw();
    },
    true,
  );
  document.addEventListener(
    "drop",
    function (e) {
      if (!editorOrigin || !hasFiles(e)) return;
      var img = imageUnder(e);
      if (!img) return;
      swallow(e);
      var file = e.dataTransfer.files[0];
      hovered = null;
      redraw();
      if (file && /^image\//.test(file.type)) send({ type: "image-drop", element: describe(img), file: file });
    },
    true,
  );

  // ---------------------------------------------------------------- page location

  function announcePath() {
    send({ type: "location", path: currentPath() });
    if (selected && !selected.isConnected) deselect();
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
      var arg = arguments[i];
      if (arg instanceof Error) {
        reportError(arg.message, arg.stack, "runtime");
        break;
      }
    }
    return consoleError.apply(this, arguments);
  };
  // Build errors show in Vite's overlay.
  new MutationObserver(function () {
    var overlay = document.querySelector("vite-error-overlay");
    if (overlay && overlay.shadowRoot) {
      var q = function (s) {
        var n = overlay.shadowRoot.querySelector(s);
        return n ? n.textContent.trim() : "";
      };
      reportError(q(".message") || "Build error", [q(".file"), q(".frame")].filter(Boolean).join("\n"), "build");
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  if (import.meta.hot) {
    import.meta.hot.on("vite:afterUpdate", function () {
      lastError = "";
      send({ type: "updated", theme: themeColors() });
      // Keep the selection on the same element after a save re-rendered it.
      if (selected && !selected.isConnected) {
        var loc = selected.getAttribute("data-sf-loc");
        selected = document.querySelector('[data-sf-loc="' + CSS.escape(loc) + '"]');
      }
      if (selected) send({ type: "select", element: describe(selected), refresh: true });
      redraw();
    });
  }

  // ---------------------------------------------------------------- messages from the editor

  window.addEventListener("message", function (e) {
    if (e.source !== editor) return;
    var data = e.data;
    if (!data || data.sf !== VERSION || typeof data.type !== "string") return;
    if (data.type === "hello") {
      editorOrigin = e.origin;
      var queued = outbox;
      outbox = [];
      send({ type: "ready", path: currentPath(), theme: themeColors() });
      for (var i = 0; i < queued.length; i++) send(queued[i]);
      return;
    }
    if (!editorOrigin || e.origin !== editorOrigin) return;
    switch (data.type) {
      case "mode":
        mode = data.mode === "select" || data.mode === "annotate" ? data.mode : "none";
        document.documentElement.style.cursor = mode === "none" ? "" : "crosshair";
        if (mode !== "select") deselect();
        hovered = null;
        mountUi();
        redraw();
        break;
      case "deselect":
        deselect();
        break;
      case "edit-text":
        startEditing();
        break;
      case "classes":
        if (selected) {
          sameLoc(selected).forEach(function (el) {
            (data.remove || []).forEach(function (c) {
              el.classList.remove(c);
            });
            (data.add || []).forEach(function (c) {
              el.classList.add(c);
            });
          });
          redraw();
        }
        break;
      case "pins":
        keepPins(Array.isArray(data.keep) ? data.keep : []);
        // Numbering continues after a reload (notes on earlier pins live in the editor).
        if (typeof data.next === "number" && data.next >= nextPin) nextPin = data.next;
        break;
      case "theme":
        var vars = data.vars || {};
        Object.keys(vars).forEach(function (name) {
          if (/^--[a-z0-9-]+$/.test(name)) {
            if (vars[name]) document.documentElement.style.setProperty(name, String(vars[name]));
            else document.documentElement.style.removeProperty(name);
          }
        });
        break;
    }
  });

  // Tell the editor the bridge is here (it answers with hello).
  editor.postMessage({ sf: VERSION, type: "here" }, "*");
})();
