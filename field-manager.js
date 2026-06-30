/* =====================================================================
 * WFWI Sage Intacct - Field Manager (unified)
 * ---------------------------------------------------------------------
 * ONE hosted file does both jobs:
 *   - EDIT mode  -> shows the Field Selector panel so an admin can pick
 *                   what to hide and copy a compact config block.
 *   - RUNTIME    -> reads the per-page config and hides those items for
 *                   all users. No generated logic-script to paste.
 *
 * Per page you only ever paste a tiny config + this loader (see
 * page-embed-template.html). All logic lives here, so fixing a bug or
 * improving behaviour = update THIS file once; every page benefits.
 *
 * To edit a live page: append  #fsedit  to the URL and reload. The panel
 * appears only when #fsedit is present, so end users never see it.
 * ===================================================================== */
;(function () {
  "use strict";

  var VERSION = "0.4.1";

  // ---- Config (set by the per-page embed; safe defaults if absent) ----
  var CFG = (window.WFWI_FS && typeof window.WFWI_FS === "object") ? window.WFWI_FS : {};
  var PAGE_ID   = CFG.pageId || location.pathname.replace(/[^a-z0-9]/gi, "_");
  var HIDE_LIST = Array.isArray(CFG.hide) ? CFG.hide : [];
  var HIDE_SET  = {};
  for (var h = 0; h < HIDE_LIST.length; h++) HIDE_SET[HIDE_LIST[h]] = true;
  var HIDE_EMPTY = CFG.hideEmpty === true;
  // hideEmpty is dangerous in edit forms (it hides blank inputs the user
  // must fill). Default: only apply hideEmpty when the page is read-only,
  // unless the config explicitly forces it.
  var HIDE_EMPTY_FORCE = CFG.hideEmptyInEditMode === true;

  // EDIT mode is triggered ONLY by '#fsedit' in the URL. It is session/
  // navigation scoped, so it can never get stuck "on" for a user. Any legacy
  // persistent flag from earlier builds is cleared here so testers who set it
  // aren't pinned in edit mode forever.
  try { localStorage.removeItem("wfwi_fs_edit"); } catch (e) {}
  var EDIT = /(^|[#&?])fsedit(=1)?($|[#&])/i.test(location.href);

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------
  function text(el) { return el ? (el.innerText || el.textContent || "").trim() : ""; }

  function slug(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
  }

  function inPanel(el) { return !!(el && el.closest && el.closest("#fs-panel, #fs-tab")); }

  var MAX_LABEL = 100, MAX_WORDS = 12;
  function isNoiseLabel(l) {
    if (!l || l.length < 2) return true;
    if (l.length > MAX_LABEL) return true;
    if (l.split(/\s+/).length > MAX_WORDS) return true;
    if (/^Field\s*\d+$/i.test(l)) return true;
    if (/^Section\s*\d+$/i.test(l)) return true;
    if (/related\s*records/i.test(l)) return true;
    if (/^View\s*\(/i.test(l)) return true;
    return false;
  }

  // The page Intacct draws into is sometimes an iframe. The loader injects
  // us into the right document, so `document` here is already correct.
  // We still expose isReadOnly() to decide on hideEmpty.
  function isReadOnly() {
    // Heuristic: a view page has read-only spans and few editable inputs.
    var editable = document.querySelectorAll(
      "input:not([type=hidden]):not([type=submit]):not([type=button]):not([readonly]):not([disabled]), " +
      "select:not([disabled]), textarea:not([readonly]):not([disabled])"
    ).length;
    return editable <= 2;
  }

  function pageReady() {
    return (
      document.querySelectorAll(".form-group, [class*='formGroup'], [class*='field-group']").length > 0 ||
      document.querySelectorAll(".tab-pane, [role='tabpanel']").length > 0 ||
      document.querySelectorAll("table.editor_grid, table.readonly_grid, table.table, table.data-table").length > 0 ||
      document.querySelectorAll(".panel, .card, fieldset").length > 0
    );
  }

  function waitForPage(cb, tries) {
    tries = tries || 0;
    if (pageReady() || tries >= 60) return cb();
    setTimeout(function () { waitForPage(cb, tries + 1); }, 250);
  }

  // ---------------------------------------------------------------------
  // DISCOVERY  (one code path used by BOTH edit and runtime modes)
  // Each item gets a STABLE, human-readable `key`:
  //   field::<tab>::<label>   table::<label>   section::<label>   tab::<label>
  // Identity is label/tab based on purpose: Intacct element ids are often
  // auto-generated and differ between view/edit and between releases, so we
  // never key off element id or DOM index.
  // ---------------------------------------------------------------------
  function tabSlugFor(el) {
    var pane = el && el.closest ? el.closest(".tab-pane, [role='tabpanel']") : null;
    if (!pane) return "";
    // Prefer the visible nav label over the (often opaque) pane id.
    var pid = pane.id;
    if (pid) {
      var nav = document.querySelector(
        ".nav-tabs a[href='#" + pid + "'], a[data-target='#" + pid + "'], [role='tab'][aria-controls='" + pid + "']"
      );
      if (nav) return slug(text(nav));
    }
    return slug(pane.getAttribute("aria-label") || pane.getAttribute("title") || pid || "tab");
  }

  function fieldLabel(group, ctrl) {
    var lab = group.querySelector(".qxf-label, label, .control-label, [class*='label']");
    var l = text(lab);
    // For long <select> menus, prefer an explicit label[for=...].
    if (ctrl && ctrl.id) {
      var lf = group.querySelector("label[for='" + ctrl.id + "']");
      if (lf) l = text(lf) || l;
    }
    if (!l && ctrl) l = (ctrl.getAttribute("placeholder") || ctrl.getAttribute("aria-label") || ctrl.name || "").trim();
    return l;
  }

  function discover() {
    var fields = [], tables = [], sections = [];
    var seen = {};            // key -> count, for deterministic dedupe
    var usedGroups = [];

    function uniqueKey(base) {
      seen[base] = (seen[base] || 0) + 1;
      return seen[base] === 1 ? base : base + "__" + seen[base];
    }
    function groupSeen(g) {
      for (var i = 0; i < usedGroups.length; i++) if (usedGroups[i] === g) return true;
      usedGroups.push(g); return false;
    }

    // ---- FIELDS -------------------------------------------------------
    var groups = document.querySelectorAll(
      ".form-group, [class*='formGroup'], [class*='field-group'], .field-wrapper"
    );
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (!g || inPanel(g) || (g.closest && g.closest("thead"))) continue;
      if (groupSeen(g)) continue;
      var ctrl = g.querySelector(
        "input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea, span.form-control, span.readonly"
      );
      if (ctrl && inPanel(ctrl)) ctrl = null;
      var label = fieldLabel(g, ctrl);
      if (isNoiseLabel(label)) continue;
      var tslug = tabSlugFor(g) || tabSlugFor(ctrl);
      var key = uniqueKey("field::" + (tslug || "_") + "::" + slug(label));
      fields.push({ key: key, label: label, tab: tslug, group: g, kind: "field" });
    }

    // ---- TABLES / GRIDS (Intacct line-item grids included) ------------
    var tbls = document.querySelectorAll(
      "table.editor_grid, table.readonly_grid, table.table, table.data-table, .table-responsive table"
    );
    for (var t = 0; t < tbls.length; t++) {
      var tb = tbls[t];
      if (!tb || inPanel(tb) || tb.closest(".form-group")) continue;
      var hasGrid = tb.classList && (tb.classList.contains("editor_grid") ||
        tb.classList.contains("readonly_grid") || tb.classList.contains("table") ||
        tb.classList.contains("data-table"));
      if (!hasGrid && !tb.querySelector("thead")) continue;
      var wrap = tb.closest(".panel, .card, .table-responsive, fieldset") || tb.parentElement;
      var tlabel =
        text((wrap || tb).querySelector("h3, h4, .panel-title, .card-title, legend")) ||
        text(tb.querySelector("caption")) ||
        ("Table " + (tables.length + 1));
      if (isNoiseLabel(tlabel)) tlabel = "Table " + (tables.length + 1);
      var tkey = uniqueKey("table::" + slug(tlabel));
      tables.push({ key: tkey, label: tlabel, group: (wrap && wrap !== tb) ? wrap : tb, kind: "table" });
    }

    // ---- SECTIONS / PANELS (skip ones that are just a field or table) -
    var secs = document.querySelectorAll(".panel, .card, fieldset");
    for (var s = 0; s < secs.length; s++) {
      var sec = secs[s];
      if (!sec || inPanel(sec)) continue;
      if (sec.closest(".form-group") || sec.closest(".tab-pane")) continue;
      if (sec.querySelector("table")) continue; // counted as a table already
      var slabel = text(sec.querySelector(".panel-title, .card-title, legend, h3, h4"));
      if (isNoiseLabel(slabel)) continue;
      var skey = uniqueKey("section::" + slug(slabel));
      sections.push({ key: skey, label: slabel, group: sec, kind: "section" });
    }

    return { fields: fields, tables: tables, sections: sections,
             all: fields.concat(tables).concat(sections) };
  }

  // ---------------------------------------------------------------------
  // EMPTY detection (used by hideEmpty)
  // ---------------------------------------------------------------------
  function isEmpty(group) {
    if (!group) return false;
    var cb = group.querySelector(".checkbox.one-option") || group.querySelector(".checkbox");
    if (cb) {
      var real = cb.querySelector("input[type=checkbox]");
      if (real) return !real.checked;
      var sp = cb.querySelector(".buttons");
      if (sp && /checkmark_empty/.test(sp.className)) return true;
    }
    var el = group.querySelector(
      "input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea, span.form-control, span.readonly"
    );
    if (!el) return false;
    if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) return !el.checked;
    var v = String((el.value !== undefined ? el.value : (el.innerText || el.textContent || "")) || "").trim();
    if (/^(--?\s*)?(select|choose|none)\b/i.test(v)) return true;
    return v === "";
  }

  // ---------------------------------------------------------------------
  // APPLY  (runtime hiding). Debounced + observer paused during write so
  // our own style changes don't re-trigger discovery.
  // ---------------------------------------------------------------------
  var observer = null;
  function withObserverPaused(fn) {
    if (observer) observer.disconnect();
    try { fn(); } finally {
      if (observer) observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  function applyRuntime() {
    withObserverPaused(function () {
      var data = discover();
      var doEmpty = HIDE_EMPTY && (HIDE_EMPTY_FORCE || isReadOnly());
      data.all.forEach(function (it) {
        if (!it.group) return;
        var hide = HIDE_SET[it.key] === true ||
          (doEmpty && it.kind === "field" &&
            it.group.classList && it.group.classList.contains("form-group") && isEmpty(it.group));
        it.group.style.display = hide ? "none" : "";
        // Also hide the matching tab nav button if a whole pane is hidden.
        if (hide && it.group.id) {
          var nav = document.querySelector(
            ".nav-tabs a[href='#" + it.group.id + "'], a[data-target='#" + it.group.id + "'], [role='tab'][aria-controls='" + it.group.id + "']"
          );
          if (nav) { var li = nav.closest("li"); if (li) li.style.display = "none"; nav.style.display = "none"; }
        }
      });
      revealPage();
    });
  }

  // FOUC control: when we have things to hide, dim the form until the first
  // apply lands, with a hard safety timeout so we never leave a blank page.
  var formRoot = null, revealed = false;
  function dimPage() {
    if (EDIT || HIDE_LIST.length === 0) return;
    formRoot = document.querySelector(".tab-content, form, .panel, .card, body") || document.body;
    if (formRoot) { formRoot.style.transition = "opacity .12s"; formRoot.style.opacity = "0"; }
    setTimeout(revealPage, 1200); // safety net
  }
  function revealPage() {
    if (revealed) return; revealed = true;
    if (formRoot) formRoot.style.opacity = "";
  }

  // ---------------------------------------------------------------------
  // EDIT MODE UI  (selector panel)
  // ---------------------------------------------------------------------
  function buildSelector() {
    var hidden = {};               // key -> true (working copy)
    for (var k in HIDE_SET) hidden[k] = true;

    var tab = document.createElement("div");
    tab.id = "fs-tab";
    tab.textContent = "FIELDS";
    tab.style.cssText =
      "position:fixed;top:200px;right:0;width:22px;height:80px;background:#800020;color:#fff;" +
      "font:bold 12px sans-serif;writing-mode:vertical-rl;display:flex;align-items:center;" +
      "justify-content:center;cursor:pointer;border-radius:6px 0 0 6px;z-index:2147483647";
    document.body.appendChild(tab);

    var panel = document.createElement("div");
    panel.id = "fs-panel";
    panel.style.cssText =
      "position:fixed;top:0;right:-380px;width:380px;height:100vh;background:#fff;" +
      "box-shadow:-4px 0 12px rgba(0,0,0,.2);padding:12px;font:13px sans-serif;box-sizing:border-box;" +
      "overflow:auto;transition:right .25s;z-index:2147483646";
    document.body.appendChild(panel);

    var openState = false;
    function toggle(v) { openState = (v == null) ? !openState : v; panel.style.right = openState ? "0" : "-380px"; }
    tab.onclick = function (e) { e.stopPropagation(); toggle(); };
    document.addEventListener("click", function (e) {
      if (openState && !panel.contains(e.target) && !tab.contains(e.target)) toggle(false);
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") toggle(false); });

    panel.innerHTML =
      "<div style='display:flex;justify-content:space-between;align-items:center'>" +
        "<strong style='color:#800020'>Field Selector</strong>" +
        "<span style='font-size:11px;opacity:.6'>v" + VERSION + " &middot; " + PAGE_ID + "</span>" +
      "</div>" +
      "<input id='fs-search' placeholder='Search fields, tables, sections...' style='width:100%;margin:8px 0;padding:6px;box-sizing:border-box'>" +
      "<label style='display:block'><input type='checkbox' id='fs-empty'> Hide empty fields (read-only pages)</label>" +
      "<label style='display:block;margin:4px 0'><input type='checkbox' id='fs-all'> Select all (hide everything shown)</label>" +
      "<div style='display:flex;gap:6px;margin:8px 0'>" +
        "<button id='fs-clear' style='flex:1'>Show all</button>" +
        "<button id='fs-copy' style='flex:2;background:#800020;color:#fff;border:0;padding:6px;border-radius:4px;cursor:pointer'>Copy config</button>" +
      "</div>" +
      "<div style='font-size:11px;opacity:.6;margin-bottom:6px'>Checked = hidden. Paste the copied config into the page embed.</div>" +
      "<div id='fs-list'></div>";

    var list   = panel.querySelector("#fs-list");
    var search = panel.querySelector("#fs-search");
    var emptyBox = panel.querySelector("#fs-empty");
    var allBox = panel.querySelector("#fs-all");
    emptyBox.checked = HIDE_EMPTY;

    var data = discover();
    var rendered = [];

    function previewApply() {
      withObserverPaused(function () {
        data.all.forEach(function (it) {
          if (!it.group) return;
          var hide = hidden[it.key] === true ||
            (emptyBox.checked && it.kind === "field" &&
              it.group.classList && it.group.classList.contains("form-group") && isEmpty(it.group));
          it.group.style.display = hide ? "none" : "";
        });
      });
    }

    function render() {
      var f = (search.value || "").toLowerCase();
      list.innerHTML = ""; rendered = [];

      function section(title, items) {
        var shown = items.filter(function (it) {
          return !f || (it.label || "").toLowerCase().indexOf(f) !== -1;
        });
        if (!shown.length) return;
        var h = document.createElement("div");
        h.style.cssText = "margin:10px 0 4px;font-weight:bold;color:#333;border-top:1px solid #eee;padding-top:6px";
        h.textContent = title;
        list.appendChild(h);
        shown.forEach(function (it) {
          rendered.push(it);
          var row = document.createElement("label");
          row.style.cssText = "display:block;padding:1px 0";
          var lbl = it.label + (it.kind === "table" ? " (table)" : it.kind === "section" ? " (section)" : "");
          row.innerHTML = "<input type='checkbox' " + (hidden[it.key] ? "checked" : "") + "> " +
            (lbl.length > 58 ? lbl.slice(0, 58) + "..." : lbl);
          row.querySelector("input").onchange = function (e) {
            hidden[it.key] = e.target.checked ? true : false;
            if (!e.target.checked) delete hidden[it.key];
            previewApply();
            syncAll();
          };
          list.appendChild(row);
        });
      }

      // Group fields by tab for readability
      var byTab = {};
      data.fields.forEach(function (it) {
        var key = it.tab || "_general";
        (byTab[key] = byTab[key] || []).push(it);
      });
      Object.keys(byTab).forEach(function (tk) {
        section(tk === "_general" ? "Fields" : tk.replace(/_/g, " "), byTab[tk]);
      });
      section("Tables / grids", data.tables);
      section("Sections", data.sections);
      syncAll();
    }

    function syncAll() {
      var n = rendered.length, hid = 0;
      rendered.forEach(function (it) { if (hidden[it.key]) hid++; });
      allBox.checked = n > 0 && n === hid;
    }

    search.oninput = render;
    emptyBox.onchange = function () { previewApply(); };
    allBox.onchange = function () {
      rendered.forEach(function (it) {
        if (allBox.checked) hidden[it.key] = true; else delete hidden[it.key];
      });
      previewApply(); render();
    };
    panel.querySelector("#fs-clear").onclick = function () {
      hidden = {}; previewApply(); render();
    };
    panel.querySelector("#fs-copy").onclick = function () { showConfig(hidden, emptyBox.checked); };

    // Re-discover (debounced) when Intacct mutates the DOM, but keep the
    // list stable; only refresh underlying element references + preview.
    var timer = null;
    observer = new MutationObserver(function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { data = discover(); previewApply(); }, 200);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    previewApply();
    render();
    toggle(true);
  }

  function showConfig(hidden, hideEmpty) {
    var keys = Object.keys(hidden).filter(function (k) { return hidden[k] === true; }).sort();
    var cfg =
      "<!-- WFWI Field Manager config for: " + PAGE_ID + " (v" + VERSION + ") -->\n" +
      "<script>\n" +
      "window.WFWI_FS = {\n" +
      "  pageId: " + JSON.stringify(PAGE_ID) + ",\n" +
      "  hideEmpty: " + JSON.stringify(!!hideEmpty) + ",\n" +
      "  hide: [\n" +
      keys.map(function (k) { return "    " + JSON.stringify(k); }).join(",\n") +
      (keys.length ? "\n" : "") +
      "  ]\n" +
      "};\n" +
      "<\/script>";

    var overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483647;display:flex;align-items:center;justify-content:center";
    var modal = document.createElement("div");
    modal.style.cssText = "background:#fff;padding:16px;width:680px;max-width:95vw;border-radius:6px";
    modal.innerHTML = "<div style='margin-bottom:8px;font:13px sans-serif'><strong>Page config</strong> &mdash; paste this above the loader on this page, then remove <code>#fsedit</code>.</div>";
    var ta = document.createElement("textarea");
    ta.style.cssText = "width:100%;height:380px;font:12px monospace;white-space:pre;box-sizing:border-box";
    ta.value = cfg;
    modal.appendChild(ta);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    ta.select();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(cfg)["catch"](function () {});
      else document.execCommand("copy");
    } catch (e) {}
  }

  // ---------------------------------------------------------------------
  // BOOT
  // ---------------------------------------------------------------------
  waitForPage(function () {
    if (EDIT) {
      buildSelector();
    } else {
      if (HIDE_LIST.length === 0 && !HIDE_EMPTY) return; // nothing to do
      dimPage();
      var t = null;
      observer = new MutationObserver(function () {
        if (t) clearTimeout(t);
        t = setTimeout(applyRuntime, 120);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      document.addEventListener("input", function () { if (t) clearTimeout(t); t = setTimeout(applyRuntime, 120); }, true);
      document.addEventListener("change", function () { if (t) clearTimeout(t); t = setTimeout(applyRuntime, 120); }, true);
      document.addEventListener("shown.bs.tab", function () { setTimeout(applyRuntime, 160); }, true);
      applyRuntime();
      setTimeout(applyRuntime, 600);
    }
  });
})();
