# denied.systems — build specification (verbatim from the project owner)

## Context
Build the frontend + build system for a public, shareable, contributor-friendly
knowledge base on **GPS-denied / contested-airspace drone autonomy** (GNSS-denied
navigation, sensor fusion, VIO/SLAM, EW-resistant guidance, perception-to-control on
compute-constrained airframes). Working title — rename freely. The owner writes all the
technical content; the machine turns markdown into a fast, indexable, good-looking
static site, plus a graph view over the same content.

Ethos (mirrors the owner's personal site): static HTML/CSS/JS, no framework, **no build
step to serve, zero external requests, no CDN**.

Working style: minimal dependencies (justify each), one verifiable step at a time,
show a working build before layering the next feature, clean prose commits.
Explain `build.sh` in the README so the owner owns it fully.

## Tech decisions — already made, implement these, don't propose alternatives
- **Build with `pandoc`, driven by a bash `build.sh`.** No Node, no npm.
- **`template.html` is a pandoc template** for article pages.
- **Math: native MathML via pandoc `--mathml`.** No KaTeX, no MathJax, no CDN.
- **Code highlighting: pandoc's built-in (skylighting) at build time**, styled in CSS.
  No highlight.js, no client-side highlighter. (May later be swapped for a custom
  tokenizer — leave it swappable.)
- **Zero external requests.** Every asset — CSS, JS, fonts, any library — is vendored
  into the repo and served locally. Nothing from a CDN.
- Vanilla JS on the client. No framework.
- Output is static HTML: no build step to serve, self-hostable on any static host.

## Architecture
- **Single-page landing** (`index.html`) — narrative "map of the terrain," linking out
  to topic pages. The shareable front door.
- **Multi-page topic deep-dives** — one markdown file → one built HTML page → one URL.
- **Two views, toggleable:**
  1. **Wiki view** — browsable pages, sidebar index, client-side search.
  2. **Graph view** — force-directed graph, pages as nodes, `[[wikilinks]]` as edges,
     click a node to open its page.

## Content model
- Markdown in `/content`, each file with YAML frontmatter: `title`, `summary`, `tags`,
  `updated` (pandoc reads these natively; expose them to `template.html`).
- `[[wikilink]]` syntax for cross-page links. Resolve at build with a **pandoc Lua
  filter** → real `<a>` tags, and record each link as a graph edge.
- Adding content = drop a `.md` in `/content`, run `./build.sh`. Provide
  `content/_template.md`.

## Build outputs
- One HTML page per markdown file via pandoc + `template.html`, with per-page `<meta>`
  + OpenGraph + Twitter card tags (title, summary, url) so shared links get real
  previews. **This is the crawling/preview fix: real pre-rendered HTML per page, not a
  client-rendered shell.**
- `index.html` = landing page.
- `graph.json` = `{ nodes: [{id, title, url, tags, degree}], edges: [{source, target}] }`,
  emitted during the build. `url` drives node navigation; `degree` (backlink count)
  drives node size.
- `search-index.json` = per page `{title, summary, url, text}` for client search.
- Emit `graph.json` + `search-index.json` with a small **Python** helper called from
  `build.sh` (stdlib only, no pip deps).

## Client JS — all vendored, no CDN
- **Graph view:** force-directed graph with this interaction layer — zoom/pan, drag,
  hover-fade-to-neighbors, animated focus-on-node, and label level-of-detail keyed to
  zoom scale `k`. Requirements:
  - Vendor d3 locally — only the modules used (`d3-selection`, `d3-force`, `d3-zoom`,
    `d3-drag`) plus their hard dependencies, not the full `d3.v7` bundle. No CDN
    `<script>` tag.
  - No hardcoded node taxonomy. Nodes are content pages: size by `degree`, color by
    primary tag or a single calm accent. No root/topic/author hierarchy.
  - Drive click navigation from each node's `url` field, not a hardcoded domain.
  - Data accessors follow the `graph.json` schema (`title`, `edges`).
  - Known latent-bug patterns to avoid: neighbor lookup must be
    `edge.target.id || edge.target` (not `edge.target.id || target`); do not declare
    `restart()` twice such that one shadows the one updating the `center` force. No
    tuning sliders in the public view — bake good force params.
  - Dark styling matching the site.
- **Search:** small custom client index over `search-index.json`. No lunr. Wire search
  into the graph view: selecting a result calls `focusOnNode`, so both views share one
  search index.

## v1 scope boundary — do NOT build these now
- **No LLM chat.** But emit the structured content index (`search-index.json` + a
  manifest) in a shape a future retrieval layer can consume, and leave a clearly-marked,
  disabled module stub (hidden `/assistant` panel) so a BYO-key RAG panel drops in later
  without restructuring. No API calls, no key handling.
- No auth, no backend, no database.

## Contribution model — important
Generated pages stay purely generated: all page-specific styling comes from
`template.html` + frontmatter, **never post-build edits**. Rebuilds and PRs must be
idempotent — a contributor drops a `.md`, runs `./build.sh`, and nothing hand-tuned
gets clobbered.

## Design / theme
- Clean, dark, technical, dense-but-legible. Its own identity. Strong typographic
  hierarchy, fast, mobile-readable.
- Native MathML and pandoc-highlighted code styled well in a single stylesheet.

## Seed content
Landing page as a short narrative stub (placeholder prose the owner will replace) +
2 example topic pages that cross-link via `[[wikilinks]]`, each with one MathML math
block and one code block — enough to exercise pipeline, graph, and search end-to-end.
Technical writing stays minimal/placeholder: the owner authors the knowledge, this
repo scaffolds the machine.

## Also deliver
- Optional CI: GitHub Actions to build on push, AND document building locally +
  committing the output — document both paths.
- README: how to add a page, how to build, how to deploy, where the deferred assistant
  module plugs in, and the no-post-build-editing rule.
