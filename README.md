# denied.systems

A public, contributor-friendly knowledge base on **GPS-denied /
contested-airspace drone autonomy** — GNSS-denied navigation, sensor fusion,
VIO/SLAM, EW-resistant guidance, perception-to-control on compute-constrained
airframes.

The machine is deliberately simple: markdown in, static HTML out.
**No framework, no Node, no build step to serve, zero external requests, no
CDN.** Everything the site needs is in this repo; anything that can serve a
directory can host it.

## Quick start

```sh
./build.sh                      # markdown → site (pandoc + python3, ~1s)
python3 -m http.server 8000     # any static server works
# open http://localhost:8000
```

Requirements: `bash`, `pandoc` (≥ 3.1, built with Lua — check
`pandoc --version`), `python3` (stdlib only). Nothing else. No npm, no pip.

## Adding a page

1. Copy `content/_template.md` to `content/your-page-slug.md`
   (slug: lowercase, hyphens — it becomes the URL and the graph node id).
2. Fill in the frontmatter — every field is required:

   ```yaml
   ---
   title: "Human-readable title"
   summary: "One sentence — used for link previews, search, and the wiki index."
   tags: [navigation, sensor-fusion]
   updated: 2026-07-07
   ---
   ```

3. Write the body starting at `##` (the template renders the `# h1` from
   `title`). Link to other pages with `[[target-slug]]` or
   `[[target-slug|display text]]`. Math in `$…$` / `$$…$$` becomes native
   MathML at build time; fenced code blocks with a language get highlighted
   at build time.
4. Run `./build.sh` and commit **both** your markdown and the regenerated
   output.

That's the whole contribution loop. Links to pages that don't exist yet
render as a muted "broken" span and print a build warning — they don't fail
the build, and they're how you mark pages worth writing next.

**Tags are the organizing system.** A page's first tag is its *primary* tag,
and it decides where the page lives in every divide of the site: its section
in the wiki index, its group in the topic-page sidebar, and its node color in
the graph. Introducing a new tag automatically creates a new wiki section —
no configuration anywhere.

## How the build works

`./build.sh` is the entire build, and it's written to be read — every pandoc
flag has a comment explaining why it exists. The shape:

1. **Clean slate** — `topics/` is deleted and rebuilt so removed markdown
   can't leave stale pages behind. `.build/edges.tsv` is truncated.
2. **One pandoc run per page** — `content/<slug>.md` →
   `topics/<slug>.html` through `template.html`. Two things happen inside
   pandoc:
   - `--mathml` renders math as native MathML (no KaTeX/MathJax, no client
     JS), and the built-in skylighting highlighter emits token `<span>`s
     that `style.css` colors (no highlight.js; swappable later for a custom
     tokenizer by adding `--no-highlight` and a client tokenizer).
   - `filters/wikilinks.lua` rewrites `[[wikilinks]]` into real `<a>` tags
     between sibling pages and appends one `source → target` line per link
     to `.build/edges.tsv`. Broken targets become
     `<span class="wikilink broken">` + a stderr warning.
3. **Indexing** — `tools/build_index.py` (python3 stdlib) reads every page's
   frontmatter plus the edge list and emits:
   - `graph.json` — `{nodes: [{id, title, url, tags, degree}], edges:
     [{source, target}]}`; `degree` is the backlink count and drives node
     size in the graph view.
   - `search-index.json` — one record per page (`title`, `summary`, `url`,
     `tags`, full plain `text`) for the client-side search.
   - `manifest.json` — the same catalog plus word counts, for a future
     retrieval layer (nothing consumes it in v1).
   - `wiki.html` — the generated, fully static wiki index page.

The build is **idempotent**: fixed locale, sorted iteration, no timestamps —
running it twice produces byte-identical output. That property is what makes
PRs reviewable and is enforced by CI.

## The rule that keeps contributions safe

**Generated files are never hand-edited.** `topics/*.html`, `wiki.html`,
`graph.json`, `search-index.json`, `manifest.json` are pure functions of
`content/` + the templates. All page styling comes from `template.html` +
`style.css` + frontmatter. If a generated page needs to look different, fix
the generator — a rebuild must never clobber anything hand-tuned, because
nothing generated is ever hand-tuned. CI fails any push where the committed
output doesn't match a fresh rebuild.

## Site anatomy

```
index.html          hand-authored landing page — the shareable front door
wiki.html           GENERATED index of all pages, grouped by primary tag
graph.html          graph view: pages as nodes, wikilinks as edges
topics/*.html       GENERATED topic pages (one per content/*.md)
content/            the markdown sources — the only thing you edit to write
template.html       pandoc template: page shell, meta/OpenGraph/Twitter tags
style.css           the single stylesheet (theme, prose, MathML, code tokens)
filters/wikilinks.lua   [[wikilink]] → <a>, edge recording
tools/build_index.py    graph/search/manifest/wiki emitter
js/search.js        shared client search (wiki + graph use the same index)
js/graph.js         force-directed graph view (d3-force), search → focus
js/app.js           topic-page sidebar (tag-grouped page list + filter)
js/vendor/d3.js     vendored d3 modules — see below
js/assistant.js     DISABLED stub for the future assistant panel
assistant/          docs for where that future RAG panel plugs in
docs/CONTRACT.md    the interface contract all components are built against
docs/SPEC.md        the original build specification
```

Every topic page is real pre-rendered HTML with per-page `<meta>` +
OpenGraph + Twitter tags — shared links get proper previews and crawlers get
real content, not a client-rendered shell.

### The two views

- **Wiki view** (`wiki.html` + the sidebar on every topic page): browsable
  tag-grouped index with client-side search.
- **Graph view** (`graph.html`): force-directed graph over `graph.json` —
  zoom/pan, drag, hover-fades-to-neighbors, labels that appear as you zoom
  in, click a node to open its page. Node size = backlink count, node color
  = primary tag. Selecting a search result animates the view onto that node.

Both views share one search index (`search-index.json`) and one search
module (`js/search.js`).

### Vendored d3 — the one dependency, justified

The graph view uses `d3-force`/`d3-selection`/`d3-zoom`/`d3-drag` (plus
their hard dependencies, e.g. `d3-transition` for the animated focus) —
force simulation and inertial zoom are the two things not worth rewriting.
The 11 modules are concatenated into `js/vendor/d3.js` (~80 KB, roughly a
third of the full d3 bundle), pinned by version in the banner comment above
each module, license in `js/vendor/D3-LICENSE`. It is served from this repo
— there is no CDN tag anywhere. Everything else is vanilla JS.

## Deploying

Two documented paths — pick one:

**A. Build locally, commit the output (default).** The repo always contains
the built site, so any static host works with zero setup: GitHub Pages
("deploy from branch", root folder), Netlify/Cloudflare with no build
command, `rsync` to your own box, anywhere. `SITE_URL=https://your.domain
./build.sh` if you fork this to another origin (it only affects the absolute
`og:url` values in link previews).

**B. GitHub Actions** (`.github/workflows/build.yml`). On every push to
`main` it rebuilds from scratch and **fails if the committed output doesn't
match** — catching a forgotten `./build.sh` or a hand-edited generated file.
A commented-out GitHub Pages deploy job is included in the workflow; enable
it if you'd rather have CI publish than commit built output. Note in the
workflow about pinning the pandoc version for byte-identical CI rebuilds.

## The deferred assistant (v1: off)

v1 ships no LLM features, but the plug-in point exists so a
bring-your-own-key RAG panel can drop in later without restructuring:
`wiki.html`/`graph.html` contain a hidden `<aside id="assistant">` mount,
`js/assistant.js` is a documented disabled stub (not loaded by any page),
and `search-index.json` + `manifest.json` are already the retrieval corpus.
Details in `assistant/README.md`. No API calls, no key handling anywhere in
v1.
