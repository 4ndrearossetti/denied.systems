/* assistant.js — DISABLED STUB (CONTRACT §9). Not loaded by any page in v1.
 *
 * This file marks the plug-in point for a future BYO-key RAG assistant
 * panel. It is intentionally inert: no API calls, no key handling, no
 * network code. See assistant/README.md for the integration plan.
 *
 * When the feature is built, the flow will be:
 *
 *   1. wiki.html / graph.html already ship a hidden mount point:
 *        <aside id="assistant" class="assistant-panel" hidden></aside>
 *   2. A page adds <script src="js/assistant.js"></script> and calls
 *        Assistant.mount(document.getElementById('assistant'))
 *   3. mount() unhides the panel and renders the UI. Retrieval runs
 *      entirely client-side over two build artifacts:
 *        - search-index.json  (per-page plain text for chunking/scoring)
 *        - manifest.json      ({ schema, site, pages[] } — the page map)
 *   4. The user supplies their own API key at runtime (never stored in
 *      the repo, never proxied through this site — the site itself stays
 *      zero-external-request; any model call is the user's own choice).
 *
 * Until then, enabled stays false and mount() refuses to do anything.
 */
(function () {
  'use strict';

  window.Assistant = {
    enabled: false,

    /**
     * Future entry point. el: the hidden <aside id="assistant"> mount.
     * Deliberately a no-op while enabled is false.
     */
    mount: function (el) {
      if (!this.enabled) {
        // Disabled by design in v1 — see assistant/README.md.
        return null;
      }
      // Future: unhide `el`, render panel UI, load search-index.json +
      // manifest.json for retrieval, accept a user-provided key.
      return el;
    }
  };
})();
