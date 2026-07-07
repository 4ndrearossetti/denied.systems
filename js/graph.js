/* graph.js — force-directed graph view over graph.json.
 *
 * Exposes window.GraphView = { focusOnNode(id) } per CONTRACT §6.
 * Requires the vendored d3 bundle (js/vendor/d3.js) loaded first.
 * Plain IIFE, no modules. Degrades to a short message if fetch fails.
 */
(function () {
  'use strict';

  /* =====================================================================
   * FORCE PARAMETERS — baked, no UI sliders. Tuned for ~10–200 nodes.
   * ===================================================================== */
  var FORCE = {
    chargeStrength: -250,   // many-body repulsion
    chargeDistanceMax: 480, // stop repelling beyond this distance
    linkDistance: 80,       // resting edge length
    linkStrength: 0.5,      // edge spring stiffness
    collidePadding: 6,      // extra clearance beyond node radius
    centerStrength: 0.06,   // pull toward viewport middle (x/y forces)
    alphaDecay: 0.03,       // settle speed
    velocityDecay: 0.35     // friction
  };
  var ZOOM_EXTENT = [0.25, 4]; // min/max zoom scale
  var LOD_K = 0.9;             // below this zoom, only top-degree labels show
  /* ===================================================================== */

  var svgEl = document.getElementById('graph');
  var wrap = document.querySelector('.graph-wrap');

  function fail(msg) {
    if (!wrap) return;
    var p = document.createElement('p');
    p.className = 'graph-error';
    p.textContent = msg;
    wrap.appendChild(p);
  }

  // Export the API so search.js can call it. focusOnNode returns false when
  // it cannot act (graph not initialised yet, or unknown id) so callers can
  // fall back to navigating to the page instead of dead-ending.
  var focusImpl = null;
  window.GraphView = {
    focusOnNode: function (id) { return focusImpl ? focusImpl(id) : false; }
  };

  // On hard failure, remove the API entirely so search.js's contract
  // fallback ("navigate if GraphView is absent") kicks in.
  function teardown() {
    if (window.GraphView && window.GraphView.focusOnNode) {
      try { delete window.GraphView; } catch (e) { window.GraphView = undefined; }
    }
  }

  if (!svgEl || typeof window.d3 === 'undefined' || typeof fetch !== 'function') {
    teardown();
    fail('graph view unavailable — this page needs JavaScript and a local graph.json.');
    return;
  }
  var d3 = window.d3;

  fetch('graph.json')
    .then(function (res) {
      if (!res.ok) throw new Error('http ' + res.status);
      return res.json();
    })
    .then(init)
    .catch(function () {
      teardown();
      fail('could not load graph.json — run ./build.sh, then serve the site.');
    });

  function init(data) {
    var nodes = data.nodes || [];
    var edges = data.edges || [];
    if (!nodes.length) { teardown(); fail('no pages in the graph yet.'); return; }

    /* ---- adjacency map, built ONCE before the simulation mutates edges.
     * At this point endpoints are still id strings, but we normalise with
     * the (e.source.id || e.source) pattern so the lookup is safe either
     * way. NOTE: never `|| target` — always `|| e.target`. ---- */
    var neighbors = {};
    edges.forEach(function (e) {
      var s = e.source.id || e.source;
      var t = e.target.id || e.target;
      (neighbors[s] = neighbors[s] || {})[t] = true;
      (neighbors[t] = neighbors[t] || {})[s] = true;
    });
    function isNeighbor(a, b) {
      return a === b || !!(neighbors[a] && neighbors[a][b]);
    }

    /* ---- sizing ---- */
    function viewSize() {
      var r = svgEl.getBoundingClientRect();
      return { w: Math.max(r.width, 320), h: Math.max(r.height, 320) };
    }
    var size = viewSize();

    /* ---- node radius: 4 + 3*sqrt(degree) ---- */
    function radius(d) { return 4 + 3 * Math.sqrt(d.degree || 0); }

    /* ---- tag palette: primary tag → --tag-1..--tag-6, assigned to tags
     * sorted by frequency desc then name asc, wrapping past 6.
     * Untagged nodes use --accent. ---- */
    var styles = getComputedStyle(document.documentElement);
    function cssVar(name, fallback) {
      var v = styles.getPropertyValue(name).trim();
      return v || fallback;
    }
    var palette = [
      cssVar('--tag-1', '#d4643a'), cssVar('--tag-2', '#8296ad'),
      cssVar('--tag-3', '#96ad82'), cssVar('--tag-4', '#c8a565'),
      cssVar('--tag-5', '#a08cb0'), cssVar('--tag-6', '#948b7e')
    ];
    var accent = cssVar('--accent', '#d4643a');

    var tagFreq = {};
    nodes.forEach(function (n) {
      var primary = (n.tags && n.tags.length) ? n.tags[0] : null;
      if (primary) tagFreq[primary] = (tagFreq[primary] || 0) + 1;
    });
    var tagOrder = Object.keys(tagFreq).sort(function (a, b) {
      return tagFreq[b] - tagFreq[a] || a.localeCompare(b);
    });
    var tagColor = {};
    tagOrder.forEach(function (tag, i) {
      tagColor[tag] = palette[i % palette.length];
    });
    function nodeColor(d) {
      var primary = (d.tags && d.tags.length) ? d.tags[0] : null;
      return primary ? tagColor[primary] : accent;
    }

    /* ---- legend ---- */
    var legend = document.getElementById('graph-legend');
    if (legend) {
      tagOrder.forEach(function (tag) {
        var item = document.createElement('span');
        item.className = 'legend-item';
        var dot = document.createElement('span');
        dot.className = 'legend-dot';
        dot.style.background = tagColor[tag];
        var label = document.createElement('span');
        label.className = 'legend-tag';
        label.textContent = tag;
        item.appendChild(dot);
        item.appendChild(label);
        legend.appendChild(item);
      });
    }

    /* ---- label level-of-detail: top quartile by degree ---- */
    var degrees = nodes.map(function (n) { return n.degree || 0; })
      .sort(function (a, b) { return a - b; });
    var q3 = degrees[Math.min(degrees.length - 1,
      Math.floor(degrees.length * 0.75))];
    function isTopDegree(d) { return (d.degree || 0) >= q3; }

    /* ---- svg scaffolding: one zoomable container g, then layers ---- */
    var svg = d3.select(svgEl);
    var container = svg.append('g').attr('class', 'graph-space');
    var linkLayer = container.append('g').attr('class', 'links');
    var nodeLayer = container.append('g').attr('class', 'nodes');
    var labelLayer = container.append('g').attr('class', 'labels');

    var link = linkLayer.selectAll('line')
      .data(edges)
      .join('line')
      .attr('class', 'graph-link')
      .attr('stroke', cssVar('--line', '#29241e'))
      .attr('stroke-width', 1);

    var node = nodeLayer.selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('class', 'graph-node')
      .attr('r', radius)
      .attr('fill', nodeColor)
      .attr('stroke', cssVar('--bg', '#070706'))
      .attr('stroke-width', 1.2)
      .style('cursor', 'pointer');

    node.append('title').text(function (d) { return d.title; });

    var label = labelLayer.selectAll('text')
      .data(nodes)
      .join('text')
      .attr('class', 'graph-label')
      .attr('text-anchor', 'middle')
      .attr('fill', cssVar('--dim', '#948b7e'))
      .attr('font-size', 11)
      .attr('pointer-events', 'none')
      .text(function (d) { return d.title; });

    /* ---- simulation (forceX/forceY centering so resize is cheap) ---- */
    var forceX = d3.forceX(size.w / 2).strength(FORCE.centerStrength);
    var forceY = d3.forceY(size.h / 2).strength(FORCE.centerStrength);
    var simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges)
        .id(function (d) { return d.id; })
        .distance(FORCE.linkDistance)
        .strength(FORCE.linkStrength))
      .force('charge', d3.forceManyBody()
        .strength(FORCE.chargeStrength)
        .distanceMax(FORCE.chargeDistanceMax))
      .force('collide', d3.forceCollide()
        .radius(function (d) { return radius(d) + FORCE.collidePadding; }))
      .force('x', forceX)
      .force('y', forceY)
      .alphaDecay(FORCE.alphaDecay)
      .velocityDecay(FORCE.velocityDecay);

    /* ---- the ONE tick handler (defined exactly once, never shadowed) ---- */
    function ticked() {
      link
        .attr('x1', function (d) { return d.source.x; })
        .attr('y1', function (d) { return d.source.y; })
        .attr('x2', function (d) { return d.target.x; })
        .attr('y2', function (d) { return d.target.y; });
      node
        .attr('cx', function (d) { return d.x; })
        .attr('cy', function (d) { return d.y; });
      label
        .attr('x', function (d) { return d.x; })
        .attr('y', function (d) { return d.y - radius(d) - 5; });
    }
    simulation.on('tick', ticked);

    /* ---- zoom/pan → transform the container; drive label LOD off k ---- */
    var currentK = 1;
    function labelOpacity(d) {
      return (currentK >= LOD_K || isTopDegree(d)) ? 1 : 0;
    }
    function updateLabels() {
      label.transition('lod').duration(250)
        .attr('opacity', labelOpacity);
    }
    var zoom = d3.zoom()
      .scaleExtent(ZOOM_EXTENT)
      .on('zoom', function (event) {
        container.attr('transform', event.transform);
        var crossed = (event.transform.k >= LOD_K) !== (currentK >= LOD_K);
        currentK = event.transform.k;
        if (crossed) updateLabels();
      });
    svg.call(zoom);
    updateLabels(); // initial state at k = 1: all labels visible

    /* ---- drag: pin while dragging, release after ---- */
    node.call(d3.drag()
      .on('start', function (event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', function (event, d) {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', function (event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      }));

    /* ---- hover: fade non-neighbors and non-incident links ---- */
    node
      .on('mouseover', function (event, d) {
        node.transition('fade').duration(150)
          .attr('opacity', function (o) {
            return isNeighbor(d.id, o.id) ? 1 : 0.12;
          });
        label.transition('fade').duration(150)
          .attr('opacity', function (o) {
            return isNeighbor(d.id, o.id) ? labelOpacity(o) : 0.06;
          });
        link.transition('fade').duration(150)
          .attr('stroke-opacity', function (e) {
            var s = e.source.id || e.source;
            var t = e.target.id || e.target;
            return (s === d.id || t === d.id) ? 1 : 0.08;
          });
      })
      .on('mouseout', function () {
        node.transition('fade').duration(200).attr('opacity', 1);
        label.transition('fade').duration(200).attr('opacity', labelOpacity);
        link.transition('fade').duration(200).attr('stroke-opacity', 0.6);
      })
      .on('click', function (event, d) {
        // graph.html sits at the site root; node.url is root-relative
        // ("topics/slug.html"), so it is usable as-is.
        window.location.href = d.url;
      });

    link.attr('stroke-opacity', 0.6);

    /* ---- animated focus-on-node (used by search selection) ---- */
    focusImpl = function (id) {
      var target = null;
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].id === id) { target = nodes[i]; break; }
      }
      if (!target) return false; // caller (search.js) falls back to navigation
      var s = viewSize();
      var k = 1.6;
      var t = d3.zoomIdentity
        .translate(s.w / 2, s.h / 2)
        .scale(k)
        .translate(-target.x, -target.y);
      svg.transition('focus').duration(700).call(zoom.transform, t)
        .on('end', pulse);
      function pulse() {
        var ring = container.append('circle')
          .attr('class', 'focus-pulse')
          .attr('cx', target.x)
          .attr('cy', target.y)
          .attr('r', radius(target) + 2)
          .attr('fill', 'none')
          .attr('stroke', accent)
          .attr('stroke-width', 2)
          .attr('opacity', 0.9);
        ring.transition('pulse').duration(650)
          .attr('r', radius(target) + 26)
          .attr('opacity', 0)
          .remove();
      }
      return true; // focused successfully
    };

    /* ---- resize: recenter the x/y forces on the new viewport middle ---- */
    window.addEventListener('resize', function () {
      var s = viewSize();
      forceX.x(s.w / 2);
      forceY.y(s.h / 2);
      simulation.alpha(0.3).restart();
    });
  }
})();
