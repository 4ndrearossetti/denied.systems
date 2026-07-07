/* app.js — topic-page sidebar enhancement (CONTRACT §6).
 *
 * Runs on generated topics/<slug>.html pages. Fetches ../search-index.json,
 * renders #sidebar as tag-grouped page links (same grouping as wiki.html:
 * primary tag = tags[0], groups sorted alphabetically, pages by title),
 * marks the current page with .current, and adds a small substring filter
 * (input.sidebar-filter) over titles. On fetch failure: silent no-op —
 * the sidebar stays empty and CSS collapses it.
 */
(function () {
  'use strict';

  var sidebar = document.getElementById('sidebar');
  if (!sidebar || typeof fetch !== 'function') return;

  fetch('../search-index.json')
    .then(function (res) {
      if (!res.ok) throw new Error('http ' + res.status);
      return res.json();
    })
    .then(function (pages) {
      if (Array.isArray(pages) && pages.length) render(pages);
    })
    .catch(function () { /* silent no-op */ });

  function currentSlug() {
    // location.pathname ends with "/topics/<slug>.html" (or the bare file
    // name over file://) — compare on the trailing file name.
    var parts = window.location.pathname.split('/');
    return parts[parts.length - 1] || '';
  }

  function render(pages) {
    var current = currentSlug();

    // Group by primary tag (first tag); untagged pages sort under "untagged".
    var groups = {};
    pages.forEach(function (p) {
      var tag = (p.tags && p.tags.length) ? p.tags[0] : 'untagged';
      (groups[tag] = groups[tag] || []).push(p);
    });
    var tagNames = Object.keys(groups).sort(function (a, b) {
      return a.localeCompare(b);
    });

    var filter = document.createElement('input');
    filter.type = 'search';
    filter.className = 'sidebar-filter';
    filter.placeholder = 'filter pages…';
    filter.setAttribute('autocomplete', 'off');
    filter.setAttribute('aria-label', 'filter pages');
    sidebar.appendChild(filter);

    tagNames.forEach(function (tag) {
      var section = document.createElement('section');
      section.className = 'sb-group';
      section.setAttribute('data-tag', tag);

      var head = document.createElement('h2');
      head.className = 'sb-head';
      head.textContent = tag;
      section.appendChild(head);

      var ul = document.createElement('ul');
      ul.className = 'sb-list';
      groups[tag]
        .slice()
        .sort(function (a, b) {
          return String(a.title).localeCompare(String(b.title));
        })
        .forEach(function (p) {
          var li = document.createElement('li');
          var a = document.createElement('a');
          // p.url is site-root-relative ("topics/slug.html"); this page
          // lives inside topics/, so step up one level.
          a.href = '../' + p.url;
          a.textContent = p.title;
          a.setAttribute('data-title', String(p.title).toLowerCase());
          var urlFile = String(p.url).split('/').pop();
          if (urlFile === current) a.className = 'current';
          li.appendChild(a);
          ul.appendChild(li);
        });
      section.appendChild(ul);
      sidebar.appendChild(section);
    });

    // Substring filter on titles; hide emptied groups.
    filter.addEventListener('input', function () {
      var q = filter.value.trim().toLowerCase();
      var sections = sidebar.querySelectorAll('.sb-group');
      for (var i = 0; i < sections.length; i++) {
        var links = sections[i].querySelectorAll('a');
        var visible = 0;
        for (var j = 0; j < links.length; j++) {
          var hit = !q || links[j].getAttribute('data-title').indexOf(q) !== -1;
          links[j].parentElement.hidden = !hit;
          if (hit) visible++;
        }
        sections[i].hidden = visible === 0;
      }
    });
  }
})();
