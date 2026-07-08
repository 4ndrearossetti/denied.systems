/* graph.js — force-directed graph view over graph.json.
 *
 * Exposes window.GraphView = { focusOnNode(id) } per CONTRACT §6.
 * Requires the vendored d3 bundle (js/vendor/d3.js) loaded first.
 * Plain IIFE, no modules. Degrades to a short message if fetch fails.
 *
 * Force model & interaction feel ported from the owner's hive-mind
 * prototype: loose elastic links (d3's default link strength), strong
 * uncapped charge, a barely-there center force, hot simulation during
 * drag — nodes stretch apart and snap back like an Obsidian graph.
 */
(function () {
  'use strict';

  /* =====================================================================
   * FORCE PARAMETERS — baked, no UI sliders. Elastic "Obsidian" tuning:
   *   - link strength is d3's DEFAULT (1 / min(degree of endpoints));
   *     do NOT set it explicitly — a fixed strength makes the graph rigid.
   *   - charge has NO distanceMax — long-range repulsion spreads clusters.
   *   - the center force is ~60x weaker than a typical positioning force,
   *     so the layout drifts and breathes instead of being pinned.
   *   - alphaDecay / velocityDecay stay at d3 defaults for the same reason.
   * ===================================================================== */
  var FORCE = {
    linkDistance: 80,      // resting edge length (strength left at default!)
    chargeStrength: -250,  // many-body repulsion, uncapped range
    centerStrength: 0.001, // very weak pull toward the origin
    collidePadding: 5      // clearance beyond node radius
  };
  var ZOOM_EXTENT = [0.1, 8]; // min/max zoom scale
  var INITIAL_SCALE = 0.8;    // starting zoom (view centered on origin)
  var FOCUS_SCALE = 2.8;      // zoom level after focusOnNode
  /* Label level-of-detail tiers, keyed to zoom k:
   *   k > LOD_ALL            → every label
   *   LOD_TOP < k ≤ LOD_ALL  → only top-quartile-degree labels (min 1)
   *   k ≤ LOD_TOP            → none */
  var LOD_ALL = 0.7;
  var LOD_TOP = 0.45;
  var FADE = { node: 0.12, label: 0.06, link: 0.08 }; // faded opacities
  var LINK_OPACITY = 0.6; // resting link stroke-opacity
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
     * way. NOTE: never a bare `|| target` — always `|| e.target`. ---- */
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
    var oldW = size.w;
    var oldH = size.h;

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
    var bg = cssVar('--bg', '#070706');

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

    /* ---- label level-of-detail: top quartile by degree (min 1 — the
     * max-degree node always satisfies degree >= q3) ---- */
    var degrees = nodes.map(function (n) { return n.degree || 0; })
      .sort(function (a, b) { return a - b; });
    var q3 = degrees[Math.min(degrees.length - 1,
      Math.floor(degrees.length * 0.75))];
    function isTopDegree(d) { return (d.degree || 0) >= q3; }

    function lodTier(k) {
      if (k > LOD_ALL) return 2;
      if (k > LOD_TOP) return 1;
      return 0;
    }

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
      .attr('stroke-width', 1.2)
      .attr('stroke-opacity', LINK_OPACITY);

    var node = nodeLayer.selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('class', 'graph-node')
      .attr('r', radius)
      .attr('fill', nodeColor)
      .attr('stroke', bg)
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

    /* ---- interaction state ---- */
    var focusedNode = null;       // node datum currently focused via search
    var hoverNodeId = null;       // node id currently hovered (null if none)
    var hoverLink = null;         // edge datum currently hovered (null if none)
    var userHasInteracted = false; // manual zoom/pan since the last focus
    var currentTier = lodTier(INITIAL_SCALE);

    function labelOpacity(d) {
      if (currentTier === 2) return 1;
      if (currentTier === 1) return isTopDegree(d) ? 1 : 0;
      return 0;
    }
    /* One function decides every label's opacity from the full interaction
     * state (focus > link hover > node hover > plain LOD), and one named
     * transition channel ('label-fade') applies it everywhere — so LOD tier
     * changes and focus/hover fades can never fight over the attribute or
     * freeze each other out. Highlighted labels always follow the CURRENT
     * tier; de-emphasised ones sit at FADE.label. */
    function labelTargetOpacity(o) {
      if (focusedNode) {
        return isNeighbor(focusedNode.id, o.id) ? labelOpacity(o) : FADE.label;
      }
      if (hoverLink) {
        var s = hoverLink.source.id || hoverLink.source;
        var t = hoverLink.target.id || hoverLink.target;
        return (o.id === s || o.id === t) ? labelOpacity(o) : FADE.label;
      }
      if (hoverNodeId !== null) {
        return isNeighbor(hoverNodeId, o.id) ? labelOpacity(o) : FADE.label;
      }
      return labelOpacity(o);
    }
    function updateLabels() {
      label.transition('label-fade').duration(200)
        .attr('opacity', labelTargetOpacity);
    }

    /* ---- simulation: coordinates centered on (0,0), prototype forces ---- */
    var simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges)
        .id(function (d) { return d.id; })
        .distance(FORCE.linkDistance))
        // no .strength(): d3's default keeps the links elastic
      .force('charge', d3.forceManyBody()
        .strength(FORCE.chargeStrength))
        // no .distanceMax(): uncapped repulsion spreads the layout
      .force('center', d3.forceCenter(0, 0)
        .strength(FORCE.centerStrength))
      .force('collide', d3.forceCollide()
        .radius(function (d) { return radius(d) + FORCE.collidePadding; }));

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

    /* ---- zoom/pan: transform the container, drive label LOD off k.
     * event.sourceEvent distinguishes manual gestures from programmatic
     * transforms (initial centering, focus transitions): only a manual
     * gesture after a focus clears the focus state. ---- */
    var zoomBehavior = d3.zoom()
      .scaleExtent(ZOOM_EXTENT)
      .on('zoom', function (event) {
        if (event.sourceEvent) userHasInteracted = true;
        container.attr('transform', event.transform);
        var tier = lodTier(event.transform.k);
        if (tier !== currentTier) {
          currentTier = tier;
          updateLabels();
        }
      })
      .on('end', function (event) {
        if (focusedNode && userHasInteracted && event.sourceEvent) {
          clearFocus();
          userHasInteracted = false;
        }
      });
    svg.call(zoomBehavior);

    // Initial view: simulation space is centered on (0,0), so place the
    // origin at the viewport middle, slightly zoomed out.
    function centeredTransform(w, h) {
      return d3.zoomIdentity.translate(w / 2, h / 2).scale(INITIAL_SCALE);
    }
    svg.call(zoomBehavior.transform, centeredTransform(size.w, size.h));
    label.attr('opacity', labelTargetOpacity); // initial LOD state, no transition

    /* ---- fade: circles and links derive their opacity from the SAME
     * interaction state and priority chain as labels (focus > link hover >
     * node hover > plain), so the three channels can never disagree — e.g.
     * clearing a focus while the pointer still rests on a node lands in
     * the full hover state everywhere, not a mix. Callers set the
     * interaction state first, then call updateFade(). ---- */
    function nodeTargetOpacity(o) {
      if (focusedNode) {
        return isNeighbor(focusedNode.id, o.id) ? 1 : FADE.node;
      }
      if (hoverLink) {
        var s = hoverLink.source.id || hoverLink.source;
        var t = hoverLink.target.id || hoverLink.target;
        return (o.id === s || o.id === t) ? 1 : FADE.node;
      }
      if (hoverNodeId !== null) {
        return isNeighbor(hoverNodeId, o.id) ? 1 : FADE.node;
      }
      return 1;
    }
    function linkTargetOpacity(e) {
      if (focusedNode) return FADE.link; // all links fade in focus mode
      if (hoverLink) return e === hoverLink ? LINK_OPACITY : FADE.link;
      if (hoverNodeId !== null) {
        var s = e.source.id || e.source;
        var t = e.target.id || e.target;
        return (s === hoverNodeId || t === hoverNodeId)
          ? LINK_OPACITY : FADE.link;
      }
      return LINK_OPACITY;
    }
    function updateFade() {
      node.transition('fade').duration(200)
        .attr('opacity', nodeTargetOpacity);
      link.transition('fade').duration(200)
        .attr('stroke-opacity', linkTargetOpacity);
      updateLabels();
    }

    function clearFocus() {
      if (!focusedNode) return;
      focusedNode = null;
      node.transition('ring').duration(200) // remove the accent ring
        .attr('stroke', bg)
        .attr('stroke-width', 1.2);
      updateFade();
    }

    /* ---- hover: fade non-neighbors; inert while something is focused ---- */
    function clearHover() {
      hoverNodeId = null;
      hoverLink = null;
      if (focusedNode) return; // focus dominates every channel — no repaint
      updateFade();
    }

    node
      .on('mouseover', function (event, d) {
        if (focusedNode) return;
        hoverNodeId = d.id;
        hoverLink = null;
        updateFade();
      })
      .on('mouseout', clearHover)
      .on('click', function (event, d) {
        // graph.html sits at the site root; node.url is root-relative
        // ("topics/slug.html"), so it is usable as-is.
        window.location.href = d.url;
      });

    // Link hover: fade everything except this link and its two endpoints.
    link
      .on('mouseover', function (event, d) {
        if (focusedNode) return;
        hoverLink = d;
        hoverNodeId = null;
        updateFade();
      })
      .on('mouseout', clearHover);

    svg.on('mouseleave', clearHover);

    /* ---- drag: keep the simulation hot so neighbors follow elastically;
     * release the node on end so it springs back into the layout. A drag
     * is a manual interaction, so it also clears any focus state. ---- */
    node.call(d3.drag()
      .on('start', function (event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
        if (focusedNode) {
          clearFocus();
          userHasInteracted = false;
        }
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

    /* ---- animated focus-on-node (used by search selection): mark the
     * node with an accent ring, fade non-neighbors and all links, then
     * glide to it (translate ~1000ms, zoom in ~800ms). The programmatic
     * transitions carry no sourceEvent, so they never clear the focus;
     * the next manual pan/zoom or node drag does. ---- */
    focusImpl = function (id) {
      var target = null;
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].id === id) { target = nodes[i]; break; }
      }
      if (!target) return false; // caller (search.js) falls back to navigation

      clearFocus();
      focusedNode = target;
      userHasInteracted = false;
      updateFade(); // focus branch: fades non-neighbors and ALL links
      node.transition('ring').duration(200)
        .attr('stroke', function (o) {
          return o.id === target.id ? accent : bg;
        })
        .attr('stroke-width', function (o) {
          return o.id === target.id ? 2 : 1.2;
        });

      svg.transition('focus')
        .duration(1000)
        .call(zoomBehavior.translateTo, target.x, target.y)
        .transition()
        .duration(800)
        .call(zoomBehavior.scaleTo, FOCUS_SCALE);
      return true; // focused successfully
    };

    /* ---- resize: keep the view centered like the prototype — shift the
     * current transform by the viewport-center delta; when nothing is
     * focused, snap back to the standard centered view. ---- */
    window.addEventListener('resize', function () {
      var s = viewSize();
      if (focusedNode) {
        var cur = d3.zoomTransform(svgEl);
        // ZoomTransform.translate works in pre-scale units, hence / cur.k.
        svg.call(zoomBehavior.transform, cur.translate(
          (s.w - oldW) / 2 / cur.k,
          (s.h - oldH) / 2 / cur.k));
      } else {
        svg.call(zoomBehavior.transform, centeredTransform(s.w, s.h));
      }
      oldW = s.w;
      oldH = s.h;
    });
  }
})();
