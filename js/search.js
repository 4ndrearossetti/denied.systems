/* search.js — shared client-side search for wiki.html and graph.html.
 *
 * Exposes window.SiteSearch = { boot(mode), query(q) } per CONTRACT §6.
 * Builds a tiny custom index at boot from search-index.json (both pages
 * live at the site root, so the path is page-relative). No external libs,
 * no modules — plain IIFE. Degrades silently if fetch fails.
 */
(function () {
  'use strict';

  // Field weights: title > tags > summary > text.
  var WEIGHTS = { title: 8, tags: 5, summary: 3, text: 1 };
  var MAX_RESULTS = 8;

  // Topic pages live one level down in topics/; the index and result urls
  // are site-root-relative, so from a topic page prefix everything with ../
  var prefix = (document.body && document.body.classList.contains('page-topic')) ? '../' : '';

  var docs = [];      // raw records from search-index.json
  var index = [];     // [{ doc, fields: { title: [tokens], … } }]
  var mode = 'wiki';
  var input = null;
  var out = null;
  var results = [];   // current rendered results
  var active = -1;    // highlighted row, -1 = none

  function tokenize(s) {
    if (!s) return [];
    return String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  }

  function buildIndex(records) {
    docs = records;
    index = records.map(function (d) {
      return {
        doc: d,
        fields: {
          title: tokenize(d.title),
          tags: tokenize((d.tags || []).join(' ')),
          summary: tokenize(d.summary),
          text: tokenize(d.text)
        }
      };
    });
  }

  // A term matches a token list exactly (whole word), or by prefix when the
  // term is the last one typed (still being completed).
  function fieldScore(tokens, term, isLast) {
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i] === term) return 1;
      if (isLast && tokens[i].indexOf(term) === 0) return 0.75;
    }
    return 0;
  }

  // Ranked search: every term must match somewhere (AND across terms);
  // per term take the best-weighted field hit; sum over terms.
  function query(q) {
    var terms = tokenize(q);
    if (!terms.length) return [];
    var scored = [];
    for (var i = 0; i < index.length; i++) {
      var entry = index[i];
      var total = 0;
      var ok = true;
      for (var t = 0; t < terms.length; t++) {
        var isLast = t === terms.length - 1;
        var best = 0;
        for (var f in WEIGHTS) {
          var s = fieldScore(entry.fields[f], terms[t], isLast);
          if (s * WEIGHTS[f] > best) best = s * WEIGHTS[f];
        }
        if (best === 0) { ok = false; break; }
        total += best;
      }
      if (ok) scored.push({ score: total, doc: entry.doc });
    }
    scored.sort(function (a, b) {
      return b.score - a.score ||
        String(a.doc.title).localeCompare(String(b.doc.title));
    });
    return scored.slice(0, MAX_RESULTS).map(function (r) {
      var d = r.doc;
      return { id: d.id, title: d.title, summary: d.summary, url: d.url, tags: d.tags || [] };
    });
  }

  /* ------------------------------ UI ------------------------------ */

  function hide() {
    if (!out) return;
    out.hidden = true;
    out.innerHTML = '';
    results = [];
    active = -1;
  }

  function select(r) {
    if (!r) return;
    hide();
    // In graph mode, focus the node; fall back to navigating to the page
    // when GraphView is absent (per CONTRACT §6) or when focusOnNode reports
    // it cannot act (returns false: graph failed to load, or unknown id).
    // A void/undefined return still counts as handled, so implementations
    // that return nothing keep working.
    if (mode === 'graph' && window.GraphView &&
        typeof window.GraphView.focusOnNode === 'function' &&
        window.GraphView.focusOnNode(r.id) !== false) {
      if (input) input.blur();
    } else {
      window.location.href = prefix + r.url;
    }
  }

  function setActive(i) {
    active = i;
    var rows = out.children;
    for (var k = 0; k < rows.length; k++) {
      // 'sel' is the contracted class for the keyboard-selected row
      // (CONTRACT §6) — style.css styles `.search-out > .sel`.
      rows[k].classList.toggle('sel', k === active);
    }
  }

  function render(list) {
    out.innerHTML = '';
    results = list;
    active = -1;
    if (!list.length) { hide(); return; }
    list.forEach(function (r, i) {
      var row = document.createElement('div');
      row.className = 'search-row';
      row.setAttribute('role', 'option');
      var t = document.createElement('span');
      t.className = 'sr-title';
      t.textContent = r.title;
      var s = document.createElement('span');
      s.className = 'sr-summary';
      s.textContent = r.summary || '';
      row.appendChild(t);
      row.appendChild(s);
      // mousedown fires before the input's blur, so selection wins.
      row.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        select(r);
      });
      row.addEventListener('mousemove', function () { setActive(i); });
      out.appendChild(row);
    });
    out.hidden = false;
  }

  function onKey(ev) {
    if (out.hidden && ev.key !== 'Escape') return;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (results.length) setActive((active + 1) % results.length);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (results.length) setActive((active - 1 + results.length) % results.length);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      select(results[active >= 0 ? active : 0]);
    } else if (ev.key === 'Escape') {
      hide();
      input.blur();
    }
  }

  function wire() {
    input = document.getElementById('search-in');
    out = document.getElementById('search-out');
    if (!input || !out) return;
    input.addEventListener('input', function () {
      var q = input.value.trim();
      if (!q) { hide(); return; }
      render(query(q));
    });
    input.addEventListener('keydown', onKey);
    input.addEventListener('blur', function () {
      // Delay so a mousedown selection on a row lands first.
      setTimeout(hide, 120);
    });
    input.addEventListener('focus', function () {
      var q = input.value.trim();
      if (q) render(query(q));
    });
  }

  function boot(m) {
    mode = m === 'graph' ? 'graph' : 'wiki';
    wire();
    if (typeof fetch !== 'function') return;
    fetch(prefix + 'search-index.json')
      .then(function (res) {
        if (!res.ok) throw new Error('http ' + res.status);
        return res.json();
      })
      .then(function (records) {
        if (Array.isArray(records)) buildIndex(records);
      })
      .catch(function () { /* degrade silently: search stays inert */ });
  }

  window.SiteSearch = { boot: boot, query: query };
})();
