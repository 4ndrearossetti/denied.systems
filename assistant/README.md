# assistant — deferred RAG panel (disabled in v1)

This directory documents where a future bring-your-own-key assistant panel
plugs into the site. Nothing here runs in v1: the feature is deliberately
shipped as a disabled stub so it can be added later without restructuring.

## What already exists

- **Mount point.** `wiki.html` and `graph.html` both contain a hidden
  `<aside id="assistant" class="assistant-panel" hidden>` just before their
  scripts. It renders nothing and costs nothing until a script unhides it.
- **Module stub.** `js/assistant.js` defines
  `window.Assistant = { enabled: false, mount() }`. It is **not** referenced
  by any page in v1 — adding the feature starts with a `<script>` tag and a
  `mount()` call, not with edits to the build pipeline.
- **Retrieval-ready data.** The build already emits everything a client-side
  retrieval layer needs, with no extra indexing step:
  - `search-index.json` — one record per page with `id`, `title`, `summary`,
    `tags`, `updated`, `url`, and the full plain `text` of the page, ready
    for chunking and scoring in the browser.
  - `manifest.json` — `{ schema, site, pages[] }`, a compact page map for
    grounding answers and building citation links.

## How it would be wired in

1. Add `<script src="js/assistant.js"></script>` to `wiki.html` /
   `graph.html` (path-adjusted if ever used on topic pages).
2. Flip `enabled` to `true` and implement `mount(el)`: unhide the aside,
   render the panel, fetch the two JSON artifacts, and answer questions by
   retrieving relevant page text and citing `url`s.
3. Keys are the user's own, entered at runtime and kept in memory (or at
   most `sessionStorage`). Nothing is committed to the repo and the static
   site itself continues to make **zero external requests** — any model API
   call is an explicit, user-initiated action from their own browser with
   their own credentials.

## Constraints that must survive the upgrade

- No backend, no proxy, no server-side key handling.
- The wiki and graph views must work identically with the panel absent,
  hidden, or broken — the assistant is an overlay, never a dependency.
- `search-index.json` and `manifest.json` schemas are owned by the build
  (see `docs/CONTRACT.md` §4); the assistant consumes them as-is.
