/* nav.js — mobile navigation drawer (CONTRACT §6).
 *
 * On desktop the header shows the search box inline and topic/wiki pages
 * show the sidebar as a fixed column — nothing here touches that.
 *
 * On mobile (≤900px) the header is a single clean row: a hamburger button
 * left of the brand, then the brand and the wiki/graph links. Tapping the
 * hamburger slides an off-canvas drawer over the page. To avoid duplicating
 * markup, this script MOVES the page's existing `.search` and `#sidebar`
 * nodes into the drawer at ≤900px and moves them back to their original
 * homes above it (event handlers and rendered contents ride along with the
 * node). So each page's drawer holds exactly what that page has: wiki =
 * search + page index, topic pages = page index, graph = search.
 *
 * Plain IIFE, no framework. If a page has neither a search box nor a
 * sidebar (the landing page), no hamburger is added.
 */
(function () {
  'use strict';

  var head = document.querySelector('.site-head');
  var search = document.querySelector('.search');       // may be null
  var sidebar = document.getElementById('sidebar');     // may be null
  if (!head || (!search && !sidebar)) return;           // nothing to put in a drawer

  var MOBILE = '(max-width: 900px)';
  var mq = window.matchMedia(MOBILE);

  // Remember each relocatable node's original parent + following sibling so
  // it can be restored to the exact same spot when returning to desktop.
  var homes = [];
  if (search)  homes.push({ node: search,  parent: search.parentNode,  next: search.nextSibling });
  if (sidebar) homes.push({ node: sidebar, parent: sidebar.parentNode, next: sidebar.nextSibling });

  // Hamburger button, inserted as the first item in the header (left of brand).
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-toggle';
  btn.setAttribute('aria-label', 'menu');
  btn.setAttribute('aria-controls', 'drawer');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<span></span><span></span><span></span>';
  head.insertBefore(btn, head.firstChild);

  // Drawer + backdrop live at the end of <body>; empty and display:none on
  // desktop, populated only while mobile.
  var drawer = document.createElement('aside');
  drawer.className = 'drawer';
  drawer.id = 'drawer';
  drawer.setAttribute('aria-label', 'navigation');
  drawer.tabIndex = -1;
  var backdrop = document.createElement('div');
  backdrop.className = 'nav-backdrop';
  document.body.appendChild(backdrop);
  document.body.appendChild(drawer);

  function isOpen() { return document.body.classList.contains('nav-open'); }
  function open() {
    document.body.classList.add('nav-open');
    btn.setAttribute('aria-expanded', 'true');
    var first = drawer.querySelector('input, a, button');
    if (first) first.focus();
  }
  function close() {
    if (!isOpen()) return;
    document.body.classList.remove('nav-open');
    btn.setAttribute('aria-expanded', 'false');
    btn.focus();
  }
  function toggle() { isOpen() ? close() : open(); }

  btn.addEventListener('click', toggle);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.keyCode === 27) close();
  });
  // Close the drawer once the user acts on something inside it — a page link
  // or a search result (on graph, picking a result focuses a node behind the
  // drawer, so it must get out of the way).
  drawer.addEventListener('click', function (e) {
    if (e.target.closest('a, .search-out > *')) close();
  });

  // Move the relocatable nodes into the drawer (mobile) or back home (desktop).
  function place(mobile) {
    if (mobile) {
      for (var i = 0; i < homes.length; i++) drawer.appendChild(homes[i].node);
    } else {
      close();
      for (var j = 0; j < homes.length; j++) {
        var h = homes[j];
        // insertBefore(node, null) appends — correct when it was the last child.
        h.parent.insertBefore(h.node, h.next);
      }
    }
  }

  place(mq.matches);
  if (mq.addEventListener) mq.addEventListener('change', function (e) { place(e.matches); });
  else if (mq.addListener) mq.addListener(function (e) { place(e.matches); }); // Safari < 14
})();
