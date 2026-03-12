<script>
;(function () {
  "use strict";

  var FS_VERSION = "v0.3.3";
  var PAGE_KEY = location.pathname.replace(/[^a-z0-9]/gi, "_");
  var STORAGE_KEY = "fs_hidden_" + PAGE_KEY;
  var HIDE_EMPTY_KEY = "fs_hideEmpty_" + PAGE_KEY;
  var VOLATILE_KEY = "fs_volatile_" + PAGE_KEY;

  function pageReady() {
    return (
      document.querySelectorAll(".form-group").length > 0 ||
      document.querySelectorAll(".tab-pane, [role='tabpanel'], [class*='tab-pane']").length > 0 ||
      document.querySelectorAll("table.table, .data-table, table").length > 0 ||
      document.querySelectorAll(".panel, .card, fieldset, [class*='section']").length > 0 ||
      document.querySelectorAll("[class*='formGroup'], [class*='field-group'], .qxf-label").length > 0
    );
  }

  function waitForPage(cb, tries) {
    tries = tries || 0;
    if (pageReady()) {
      cb();
    } else if (tries < 50) {
      setTimeout(function () { waitForPage(cb, tries + 1); }, 250);
    } else {
      cb();
    }
  }

  function makeVirtualId(label) {
    return "fs_virtual_" + String(label).toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
  }

  function safeText(el) {
    return el ? (el.innerText || el.textContent || "").trim() : "";
  }

  var MAX_LABEL_LENGTH = 100;
  var MAX_LABEL_WORDS = 12;

  function trimLabel(label, fallback) {
    if (!label || label.length <= MAX_LABEL_LENGTH) {
      if (label && label.split(/\s+/).length > MAX_LABEL_WORDS) return fallback || label.substring(0, 60) + "...";
      return label || fallback;
    }
    return fallback || label.substring(0, 60) + "...";
  }

  function discoverFormFields() {
    var fields = [];
    var seenGroups = [];

    function isInFsPanel(el) {
      return !!(el && el.closest && el.closest("#fs-panel"));
    }

    function inArray(arr, el) {
      for (var i = 0; i < arr.length; i++) if (arr[i] === el) return true;
      return false;
    }

    function getTabIdFor(el) {
      var pane = el && el.closest ? el.closest(".tab-pane, [role='tabpanel']") : null;
      return pane ? (pane.id || null) : null;
    }

    function addField(id, label, group, virtual, tabId) {
      if (!group || group === document.body) return;
      if (isInFsPanel(group)) return;
      fields.push({ id: id, label: label, group: group, virtual: virtual, tabId: tabId || null });
    }

    // Pass 1: explicit form groups
    var selectors = [
      ".form-group",
      "[class*='formGroup']",
      "[class*='field-group']",
      ".field-wrapper",
      "div[class*='form-group']"
    ];
    for (var s = 0; s < selectors.length; s++) {
      var groups = document.querySelectorAll(selectors[s]);
      for (var i = 0; i < groups.length; i++) {
        var g = groups[i];
        if (!g || isInFsPanel(g)) continue;
        if (inArray(seenGroups, g)) continue;
        seenGroups.push(g);

        var labelEl = g.querySelector(".qxf-label") || g.querySelector("label") ||
          g.querySelector("[class*='label']") || g.querySelector(".control-label");
        var label = trimLabel(safeText(labelEl), "Field " + fields.length);

        var ctrl = g.querySelector(
          ".form-control, input, select, textarea, span.form-control, span.readonly, [class*='form-control']"
        );
        if (ctrl && isInFsPanel(ctrl)) ctrl = null;

        // If the group contains a big select, don't let option text pollute the label.
        if (ctrl && ctrl.tagName === "SELECT" && ctrl.options && ctrl.options.length > 10) {
          var labFor = ctrl.id && g.querySelector("label[for='" + ctrl.id + "']");
          if (labFor) label = trimLabel(safeText(labFor), label);
        }

        var id = (ctrl && ctrl.id) ? ctrl.id : makeVirtualId(label + "_" + fields.length);
        addField(id, label, g, !ctrl || !ctrl.id, getTabIdFor(g) || getTabIdFor(ctrl));
      }
    }

    // Pass 2: any remaining controls not contained in an already-added group
    var controlSelector = "input:not([type='hidden']):not([type='submit']):not([type='button']), select, textarea, span.form-control, span.readonly";
    var allControls = document.querySelectorAll(controlSelector);
    for (var j = 0; j < allControls.length; j++) {
      var ctrl = allControls[j];
      if (!ctrl || isInFsPanel(ctrl)) continue;
      if (ctrl.tagName === "OPTION" || (ctrl.parentElement && ctrl.parentElement.tagName === "OPTGROUP")) continue;

      var inExisting = false;
      for (var k = 0; k < fields.length; k++) {
        if (fields[k].group && fields[k].group.contains && fields[k].group.contains(ctrl)) {
          inExisting = true;
          break;
        }
      }
      if (inExisting) continue;

      var label = "";
      var lab = ctrl.id && document.querySelector("label[for='" + ctrl.id + "']");
      if (lab) label = safeText(lab);
      if (!label && ctrl.closest("tr")) {
        var row = ctrl.closest("tr");
        var th = row && row.querySelector("th");
        if (th) label = safeText(th);
      }
      if (!label) {
        var parent = ctrl.parentElement;
        if (parent && !isInFsPanel(parent)) {
          var first = parent.querySelector(".qxf-label, label, [class*='label'], .control-label");
          if (first && !isInFsPanel(first)) label = safeText(first);
        }
      }
      if (!label) label = (ctrl.getAttribute("placeholder") || ctrl.getAttribute("aria-label") || "Field " + fields.length);
      label = trimLabel(label, "Field " + fields.length);
      if (label.length > MAX_LABEL_LENGTH || label.split(/\s+/).length > MAX_LABEL_WORDS) continue;

      var wrapper = ctrl.closest("li, tr, .form-group, [class*='formGroup'], [class*='field-group'], .field-wrapper") || ctrl.parentElement;
      if (!wrapper || wrapper === document.body || isInFsPanel(wrapper)) continue;

      var id = ctrl.id ? ctrl.id : makeVirtualId(label + "_" + fields.length);
      addField(id, label, wrapper, !ctrl.id, getTabIdFor(wrapper) || getTabIdFor(ctrl));
    }

    return fields;
  }

  function discoverTabs() {
    var items = [];
    var navLinks = document.querySelectorAll(
      ".nav-tabs a, .nav-tabs li a, .nav-link[data-toggle='tab'], a[data-toggle='tab'], [role='tab']"
    );
    var tabPanels = document.querySelectorAll(
      ".tab-pane, [role='tabpanel'], div[class*='tab-pane'], div[data-tab]"
    );
    var paneById = {};
    for (var p = 0; p < tabPanels.length; p++) {
      var pane = tabPanels[p];
      var pid = pane.id || pane.getAttribute("id");
      if (pid) paneById[pid] = pane;
    }
    for (var n = 0; n < navLinks.length; n++) {
      var a = navLinks[n];
      var href = (a.getAttribute("href") || "").replace(/^#/, "").split("?")[0];
      var target = (a.getAttribute("data-target") || "").replace(/^#/, "").split("?")[0];
      var controls = (a.getAttribute("aria-controls") || "").split("?")[0];
      var pane = paneById[href] || paneById[target] || paneById[controls] ||
        document.getElementById(href) || document.getElementById(target) || document.getElementById(controls);
      var label = safeText(a);
      if (pane) {
        var id = pane.id || makeVirtualId("tab_" + label);
        items.push({
          id: id,
          label: label || ("Tab " + (n + 1)),
          group: pane,
          virtual: !pane.id,
          nav: a,
          navLi: a.closest ? a.closest("li") : null
        });
      }
    }
    for (var i = 0; i < tabPanels.length; i++) {
      var pane = tabPanels[i];
      var already = false;
      for (var j = 0; j < items.length; j++) { if (items[j].group === pane) { already = true; break; } }
      if (already) continue;
      var paneId = pane.id || pane.getAttribute("id");
      var label = pane.getAttribute("aria-label") || pane.getAttribute("title") ||
        safeText(pane.querySelector(".tab-pane-title, [class*='title'], h3, h4")) ||
        ("Tab " + (items.length + 1));
      var id = paneId || makeVirtualId("tab_" + label);
      items.push({ id: id, label: label, group: pane, virtual: !paneId, nav: null, navLi: null });
    }
    return items;
  }

  function discoverTables() {
    var items = [];
    var tables = document.querySelectorAll(
      "table.table, table.data-table, .table-responsive table, table"
    );
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      if (t.closest(".form-group")) continue;
      var hasTableClass = t.classList && (t.classList.contains("table") || t.classList.contains("data-table"));
      var hasThead = t.querySelector("thead");
      if (!hasTableClass && !hasThead) continue;
      var wrapper = t.closest(".panel, .card, .table-responsive, fieldset") || t.parentElement;
      var label = safeText(wrapper.querySelector("h3, h4, .panel-title, .card-title, legend")) ||
        safeText(t.querySelector("caption")) ||
        safeText(t.querySelector("thead th span, thead th label, thead th")) ||
        ("Table " + (items.length + 1));
      var id = t.id || makeVirtualId("table_" + label);
      items.push({
        id: id,
        label: label,
        group: wrapper || t,
        virtual: !t.id,
        tabId: (typeof getTabIdFor === "function" ? getTabIdFor(wrapper || t) : null) || null,
        isTable: true
      });
    }
    return items;
  }

  function discoverSections() {
    var items = [];
    var sections = document.querySelectorAll(
      ".panel, .card, fieldset[class*='section'], div[class*='section']"
    );
    for (var i = 0; i < sections.length; i++) {
      var sec = sections[i];
      if (sec.closest(".form-group") || sec.closest(".tab-pane")) continue;
      if (sec.querySelector("table")) continue;
      var label = safeText(sec.querySelector(".panel-title, .card-title, legend, h3, h4")) ||
        ("Section " + (i + 1));
      var id = sec.id || makeVirtualId("section_" + label);
      items.push({ id: id, label: label, group: sec, virtual: !sec.id });
    }
    return items;
  }

  function discoverAll() {
    var fields = discoverFormFields();
    var tabs = discoverTabs();
    var tables = discoverTables();
    var sections = discoverSections();
    return {
      fields: fields,
      tabs: tabs,
      tables: tables,
      sections: sections,
      // Only fields/tables/sections participate in the selector list.
      all: fields.concat(tables).concat(sections)
    };
  }

  var tab = document.createElement("div");
  tab.id = "fs-tab";
  tab.textContent = "FIELDS";
  tab.style.cssText =
    "position:fixed;top:200px;right:0;width:20px;height:70px;" +
    "background:#800020;color:#fff;font-weight:bold;font-size:12px;" +
    "writing-mode:vertical-rl;display:flex;align-items:center;justify-content:center;" +
    "cursor:pointer;border-radius:6px 0 0 6px;z-index:999999";
  document.body.appendChild(tab);

  var panel = document.createElement("div");
  panel.id = "fs-panel";
  panel.style.cssText =
    "position:fixed;top:0;right:-360px;width:360px;height:100vh;" +
    "background:#fff;box-shadow:-4px 0 12px rgba(0,0,0,.2);" +
    "padding:10px;font-size:13px;box-sizing:border-box;" +
    "overflow-x:hidden;overflow-y:scroll;scrollbar-gutter:stable;" +
    "transition:right .25s;z-index:999998";
  document.body.appendChild(panel);

  var open = false;
  function closePanel() {
    panel.style.right = "-360px";
    open = false;
  }

  tab.onclick = function (e) {
    e.stopPropagation();
    open = !open;
    panel.style.right = open ? "0" : "-360px";
  };

  document.addEventListener("click", function (e) {
    if (open && !panel.contains(e.target) && !tab.contains(e.target)) closePanel();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && open) closePanel();
  });

  waitForPage(function () {
    // Prevent layout "jitter" when the page scrollbar appears/disappears.
    // Hide-empty can change page height, which changes viewport width on Windows.
    try {
      var root = document.documentElement;
      if (root && !root._fsPrevOverflowY) {
        root._fsPrevOverflowY = root.style.overflowY || "";
        root.style.overflowY = "scroll";
      }
    } catch (e) {}

    // Do NOT persist selections across browser refresh.
    // We keep state only in this tab/session and clear on reload.
    try {
      if (sessionStorage && !sessionStorage.getItem(VOLATILE_KEY)) {
        sessionStorage.setItem(VOLATILE_KEY, "1");
        sessionStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(HIDE_EMPTY_KEY);
      }
    } catch (e) {}

    var hidden = {};
    var hideEmpty = false;

    // VERY conservative "empty" check for live Hide empty fields (fields only).
    function isEmpty(group) {
      if (!group) return false;

      // Handle checkbox-only groups like "Placeholder resource".
      var cbOnly = group.querySelector(".checkbox.one-option");
      if (cbOnly) {
        var real = cbOnly.querySelector("input[type='checkbox']");
        if (real) return !real.checked;
        var span = cbOnly.querySelector(".buttons");
        if (span && /checkmark_empty/.test(span.className)) return true;
      }

      // Look for a real control (ignore hidden/submit/button).
      var el = group.querySelector(
        "input:not([type='hidden']):not([type='submit']):not([type='button']), " +
        "select, textarea, span.form-control, span.readonly"
      );
      if (!el) return false;

      // Checkbox / radio with a real input.
      if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) {
        return !el.checked;
      }

      var val = (el.value !== undefined ? el.value : (el.innerText || el.textContent || ""));
      val = String(val || "").trim();

      // Treat common placeholder text as empty (e.g. "Select", "None", "-- Select --").
      if (/^(select|choose|none|\-\-?\s*(select|choose|none))/i.test(val)) return true;

      return val === "";
    }

    // Snapshot-only helpers for tables/sections (used when building Copy Script).
    function isEmptyTableSnapshot(group) {
      var table = group && group.tagName === "TABLE" ? group :
        group && group.querySelector && group.querySelector("table.editor_grid, table.readonly_grid");
      if (!table) return false;
      var body = table.querySelector("tbody");
      var rows = body ? body.querySelectorAll("tr").length : 0;
      return rows === 0;
    }

    function isEmptySectionSnapshot(group) {
      if (!group) return false;
      // No controls and only whitespace text.
      var hasCtrl = group.querySelector("input, select, textarea, span.form-control, span.readonly");
      if (hasCtrl) return false;
      var txt = (group.innerText || group.textContent || "").trim();
      return txt === "";
    }

    function applyVisibility(collection, useHideEmpty) {
      if (!collection) return;
      collection.forEach(function (f) {
        if (!f || !f.group) return;
        if (hidden[f.id] === true) {
          f.group.style.display = "none";
          if (f.navLi && f.navLi.style) f.navLi.style.display = "none";
          if (f.nav && f.nav.style) f.nav.style.display = "none";
          return;
        }
        // Live "Hide empty fields" should ONLY auto-hide true field rows,
        // i.e. real .form-group containers – never whole panes, tables, etc.
        if (
          useHideEmpty &&
          f.group.classList &&
          f.group.classList.contains("form-group") &&
          isEmpty(f.group)
        ) {
          f.group.style.display = "none";
          return;
        }
        // Default: show it.
        f.group.style.display = "";
        if (f.navLi && f.navLi.style) f.navLi.style.display = "";
        if (f.nav && f.nav.style) f.nav.style.display = "";
      });
    }

    function runDiscoveryAndApply() {
      var data = discoverAll();
      // Live "Hide empty fields" should ONLY affect field groups,
      // not whole tables or sections (otherwise the page looks blank).
      applyVisibility(data.fields, hideEmpty);
      applyVisibility(data.tabs, false);
      applyVisibility(data.tables, false);
      applyVisibility(data.sections, false);
      return data;
    }

    var data = runDiscoveryAndApply();

    panel.innerHTML =
      "<div style='display:flex;justify-content:space-between;align-items:center'>" +
        "<strong style='color:#800020'>Field Selector</strong>" +
        "<span id='fs-help' style='cursor:pointer;color:#800020;font-weight:bold'>?</span>" +
      "</div>" +
      "<div style='font-size:11px;opacity:.6;margin-bottom:6px'>" +
        "Works on any page - " + FS_VERSION +
      "</div>" +
      "<input id='fs-search' placeholder='Search fields, tabs, tables...' style='width:100%;margin:6px 0;padding:6px'>" +
      "<label><input type='checkbox' id='fs-hide-empty'> Hide empty fields</label><br>" +
      "<label><input type='checkbox' id='fs-select-all'> Select all</label>" +
      "<div style='display:flex;gap:6px;margin:6px 0'>" +
        "<button id='fs-reset' style='flex:1'>Reset</button>" +
        "<button id='fs-copy' style='flex:1'>Copy Script</button>" +
      "</div>" +
      "<div id='fs-list'></div>";

    panel.querySelector("#fs-help").onclick = function () {
      window.open(
        "https://teams.microsoft.com/l/chat/0/0?users=maverbuj@womenforwomen.org",
        "_blank"
      );
    };

    var list = panel.querySelector("#fs-list");
    var search = panel.querySelector("#fs-search");
    var hideEmptyBox = panel.querySelector("#fs-hide-empty");
    var selectAllBox = panel.querySelector("#fs-select-all");
    hideEmptyBox.checked = hideEmpty;

    var allItems = [];

    function render(filter) {
      var filterLower = filter ? filter.toLowerCase() : "";
      var prevScroll = list.scrollTop;
      list.innerHTML = "";
      allItems = [];

      var tabLabelById = {};
      (data.tabs || []).forEach(function (t) {
        if (t && t.id) tabLabelById[t.id] = t.label || t.id;
      });

      function addHeading(text) {
        var h = document.createElement("div");
        h.style.cssText = "margin:10px 0 4px;font-weight:bold;color:#333;border-top:1px solid #eee;padding-top:6px";
        h.textContent = text;
        list.appendChild(h);
      }

      function addItemRow(f) {
        allItems.push(f);
        var row = document.createElement("label");
        row.style.display = "block";
        row.innerHTML =
          "<input type='checkbox' data-id='" + String(f.id).replace(/'/g, "&#39;") + "' " +
          (hidden[f.id] !== true ? "checked" : "") + "> " +
          (function () {
            var lbl = f.label || f.id;
            if (f.isTable) lbl += " (table)";
            return lbl.length > 60 ? lbl.substring(0, 60) + "..." : lbl;
          })() + (f.virtual ? " <span style='opacity:.5'>(virtual)</span>" : "");
        list.appendChild(row);
      }

      // Fields grouped by tab
      var byTab = {};
      (data.fields || []).forEach(function (f) {
        if (!f || !f.label) return;
        if (filterLower && f.label.toLowerCase().indexOf(filterLower) === -1) return;
        var key = f.tabId || "__no_tab__";
        if (!byTab[key]) byTab[key] = [];
        byTab[key].push(f);
      });

      // Tables grouped by tab, shown inline with fields
      (data.tables || []).forEach(function (t) {
        if (!t || !t.label) return;
        if (filterLower && t.label.toLowerCase().indexOf(filterLower) === -1) return;
        var key = t.tabId || "__no_tab__";
        if (!byTab[key]) byTab[key] = [];
        byTab[key].push(t);
      });

      // Render in tab nav order first, then any un-tabbed leftovers
      var renderedKeys = {};
      if (data.tabs && data.tabs.length) {
        data.tabs.forEach(function (t) {
          var key = t.id;
          var arr = byTab[key];
          if (!arr || !arr.length) return;
          renderedKeys[key] = true;
          addHeading(t.label || "Tab");
          arr.forEach(addItemRow);
        });
      }
      // Fields without a tab-pane are ignored in the list to avoid
      // confusing "Other fields" group; on Intacct pages we care
      // about, everything lives inside a tab-pane.
      Object.keys(byTab).forEach(function (k) {
        if (k === "__no_tab__" || renderedKeys[k]) return;
        addHeading(tabLabelById[k] || k);
        byTab[k].forEach(addItemRow);
      });

      // Optional: keep non-field items in the UI too
      function renderOtherSection(title, items) {
        if (!items || !items.length) return;
        var filtered = [];
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (!it) continue;
          if (filterLower && (it.label || "").toLowerCase().indexOf(filterLower) === -1) continue;
          filtered.push(it);
        }
        if (!filtered.length) return;
        addHeading(title);
        filtered.forEach(addItemRow);
      }

      // Tabs are no longer listed; tables are now inline under each tab.
      renderOtherSection("Sections", data.sections || []);

      // Select-all reflects only currently rendered items
      var visible = allItems.length;
      var selected = 0;
      for (var i = 0; i < allItems.length; i++) {
        if (hidden[allItems[i].id] !== true) selected++;
      }
      selectAllBox.checked = visible > 0 && visible === selected;
      list.scrollTop = prevScroll;
    }

    // Keep the selector list stable while you click. We still re-apply visibility when Intacct mutates the DOM.
    var observer = new MutationObserver(function () {
      data = runDiscoveryAndApply();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    render("");
    search.oninput = function () { render(search.value); };

    list.onchange = function (e) {
      var id = e.target.dataset.id;
      if (!id) return;
      hidden[id] = !e.target.checked;
      data = runDiscoveryAndApply();
      // Avoid full re-render here to prevent scroll jumps / needing multiple clicks.
      // The checkbox state is already correct; we only need to update select-all.
      var visible = allItems.length;
      var selected = 0;
      for (var i = 0; i < allItems.length; i++) {
        if (hidden[allItems[i].id] !== true) selected++;
      }
      selectAllBox.checked = visible > 0 && visible === selected;
    };

    hideEmptyBox.onchange = function () {
      hideEmpty = hideEmptyBox.checked;
      runDiscoveryAndApply();
      render(search.value);
    };

    // (no snapshot button; hide-empty is a live helper only)

    selectAllBox.onchange = function () {
      var filterLower = search.value.toLowerCase();
      allItems.forEach(function (f) {
        if (filterLower && f.label.toLowerCase().indexOf(filterLower) === -1) return;
        hidden[f.id] = !selectAllBox.checked;
      });
      data = runDiscoveryAndApply();
      render(search.value);
    };

    panel.querySelector("#fs-reset").onclick = function () {
      location.reload();
    };

    panel.querySelector("#fs-copy").onclick = function () {
      data = runDiscoveryAndApply();
      // Build a snapshot of what should be hidden in the static script.
      // 1) Start from explicit user choices in the selector.
      var snapshotHidden = {};
      for (var key in hidden) {
        if (hidden.hasOwnProperty(key) && hidden[key] === true) {
          snapshotHidden[key] = true;
        }
      }
      // 2) If Hide empty fields is ON in the selector, we will export it as
      //    dynamic logic (hide while empty, show when filled). We do NOT
      //    snapshot empties into HIDDEN_FIELDS anymore.

      // 3) Normalise virtual IDs for checkbox-only fields: the live selector
      // may generate ids like "fs_virtual_label_23", but the copied script's
      // makeId(label) will produce "fs_virtual_label". Add alias keys without
      // the numeric suffix so they match in the copied script.
      Object.keys(snapshotHidden).forEach(function (k) {
        if (!/^fs_virtual_.+_\d+$/.test(k)) return;
        var base = k.replace(/_\d+$/, "");
        if (!snapshotHidden[base]) snapshotHidden[base] = true;
      });
      var overlay = document.createElement("div");
      overlay.style.cssText =
        "position:fixed;top:0;left:0;width:100vw;height:100vh;" +
        "background:rgba(0,0,0,.5);z-index:9999999;" +
        "display:flex;align-items:center;justify-content:center";
      var modal = document.createElement("div");
      modal.style.cssText =
        "background:#fff;padding:20px;width:640px;max-width:95vw;border-radius:6px";
      var ta = document.createElement("textarea");
      ta.style.cssText =
        "width:100%;height:400px;font-family:monospace;font-size:12px;white-space:pre";
      modal.appendChild(ta);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      overlay.onclick = function (e) {
        if (e.target === overlay) overlay.remove();
      };
      var fs = "";
      var scriptOpen = String.fromCharCode(60) + "script" + String.fromCharCode(62);
      var scriptClose = String.fromCharCode(60) + "/script" + String.fromCharCode(62);
      fs += scriptOpen + "\n";
      fs += "// FINAL FIELD VISIBILITY SCRIPT\n";
      fs += "// Version: " + FS_VERSION + "\n\n";
      fs += "var HIDDEN_FIELDS = " + JSON.stringify(snapshotHidden, null, 2) + ";\n\n";
      fs += "var HIDE_EMPTY = " + JSON.stringify(!!hideEmpty) + ";\n\n";
      fs += "(function(){\n";
      fs += "function hideSelector(){var t=document.getElementById('fs-tab');if(t)t.style.display='none';var p=document.getElementById('fs-panel');if(p)p.style.display='none';}\n";
      fs += "function makeId(l){return 'fs_virtual_'+String(l).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');}\n";
      fs += "function text(e){return e?(e.innerText||e.textContent||'').trim():'';}\n";
      fs += "function hideTabNav(pid){if(!pid)return;var sel=['.nav-tabs a[href=\"#'+pid+'\"]','.nav-tabs a[data-target=\"#'+pid+'\"]','[role=\"tab\"][aria-controls=\"'+pid+'\"]'];for(var s=0;s<sel.length;s++){var a=document.querySelector(sel[s]);if(a){var li=a.closest('li');if(li)li.style.display='none';a.style.display='none';}}\n}\n";
      fs += "function isEmptyGroup(g){if(!g)return false;var cb=g.querySelector('.checkbox.one-option');if(cb){var real=cb.querySelector('input[type=checkbox]');if(real)return !real.checked;var sp=cb.querySelector('.buttons');if(sp&&/checkmark_empty/.test(sp.className))return true;}\n";
      fs += "var el=g.querySelector('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea,span.form-control,span.readonly');if(!el)return false; if(el.tagName==='INPUT'&&(el.type==='checkbox'||el.type==='radio'))return !el.checked;var v=(el.value!==undefined?el.value:(el.innerText||el.textContent||''));v=String(v||'').trim();if(/^(select|choose|none|\\-\\-?\\s*(select|choose|none))/i.test(v))return true;return v==='';}\n";
      fs += "function apply(){\n";
      fs += "hideSelector();\n";
      fs += "var gs=document.querySelectorAll('.form-group,[class*=\"formGroup\"],[class*=\"field-group\"]');\n";
      fs += "for(var i=0;i<gs.length;i++){var g=gs[i];var l=g.querySelector('.qxf-label,label,[class*=label]');var lbl=text(l);var c=g.querySelector('.form-control,input,select,textarea,span.form-control,span.readonly');var id=(c&&c.id)?c.id:makeId(lbl||'f'+i);if(HIDDEN_FIELDS[id]===true){g.style.display='none';}else if(HIDE_EMPTY&&g.classList&&g.classList.contains('form-group')&&isEmptyGroup(g)){g.style.display='none';}else{g.style.display='';}}\n";
      fs += "var cbs=document.querySelectorAll('.checkbox.one-option');\n";
      fs += "for(var ci=0;ci<cbs.length;ci++){var box=cbs[ci];var bl=text(box.querySelector('.qxf-label,label,[class*=label]'));if(!bl)continue;var vid=makeId(bl);if(HIDDEN_FIELDS[vid]===true){var wrap=box.closest('.form-group,.qx-rangecontainer,li,tr,fieldset,.panel,.card')||box;if(wrap)wrap.style.display='none';}}\n";
      // Tabs are not dynamically hidden in this script to avoid flakiness.
      fs += "var tbls=document.querySelectorAll('table.table,table.data-table,.table-responsive table');\n";
      fs += "for(var k=0;k<tbls.length;k++){var t=tbls[k];var w=t.closest('.panel,.card,.table-responsive,fieldset')||t.parentElement;var tid=t.id||makeId('table_'+k);if(HIDDEN_FIELDS[tid]===true){if(w&&w!==t){w.style.display='none';}else{t.style.display='none';}}else{if(w&&w!==t){w.style.display='';}else{t.style.display='';}}}\n";
      fs += "var secs=document.querySelectorAll('.panel,.card,fieldset');\n";
      fs += "for(var m=0;m<secs.length;m++){var s=secs[m];if(s.closest('.form-group'))continue;var sid=s.id||makeId('section_'+m);if(HIDDEN_FIELDS[sid]===true){s.style.display='none';}else{s.style.display='';}}\n";
      fs += "}\n";
      fs += "var timer=null;function schedule(){if(timer)clearTimeout(timer);timer=setTimeout(apply,120);} \n";
      fs += "var o=new MutationObserver(schedule);o.observe(document.body,{childList:true,subtree:true});\n";
      fs += "document.addEventListener('input',schedule,true);document.addEventListener('change',schedule,true);\n";
      fs += "document.addEventListener('shown.bs.tab',function(){setTimeout(apply,180);},true);\n";
      fs += "setTimeout(apply,200);setTimeout(apply,800);\n";
      fs += "})();\n";
      fs += scriptClose;
      ta.value = fs;
      // Try to copy to clipboard automatically for convenience.
      try {
        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(fs).catch(function () {
            ta.select();
            try { document.execCommand("copy"); } catch (e) {}
          });
        } else {
          ta.select();
          try { document.execCommand("copy"); } catch (e) {}
        }
      } catch (e) {
        ta.select();
      }
    };
  });
})();
</script>