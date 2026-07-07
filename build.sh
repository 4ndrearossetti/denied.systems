#!/usr/bin/env bash
#
# build.sh — the entire build for denied.systems.
#
# What it does, in order:
#   1. wipes and recreates the generated topics/ directory (full rebuild),
#   2. runs pandoc once per content/*.md to produce topics/<slug>.html,
#      resolving [[wikilinks]] via filters/wikilinks.lua and recording every
#      resolved link as a graph edge in .build/edges.tsv,
#   3. runs tools/build_index.py (python3 stdlib only) to emit graph.json,
#      search-index.json, manifest.json and the generated wiki.html.
#
# Requirements: bash, pandoc (>= 3.1, built with Lua support), python3.
# No Node, no pip packages, no network access — everything is local.
#
# Idempotent by design: running this twice in a row produces byte-identical
# output (no timestamps, sorted iteration everywhere, full rebuild each time).

# -e  exit immediately if any command fails
# -u  treat use of an unset variable as an error
# -o pipefail  a pipeline fails if ANY stage fails, not just the last one
set -euo pipefail

# Force a fixed locale so glob expansion / `sort` order never depends on the
# machine's language settings. This is part of the byte-identical guarantee.
export LC_ALL=C

# Always run from the repo root (the directory this script lives in), so the
# script works no matter where it is invoked from.
cd "$(dirname "${BASH_SOURCE[0]}")"

# Canonical site origin, used only to build absolute og:url values for link
# previews. Overridable for forks/mirrors: SITE_URL=https://example.org ./build.sh
# No trailing slash (the contract appends "/topics/<slug>.html" itself).
SITE_URL="${SITE_URL:-https://denied.systems}"

CONTENT_DIR="content"
OUT_TOPICS="topics"
EDGES_FILE=".build/edges.tsv"

# --- 1. clean slate -----------------------------------------------------------
# Full rebuild: delete previously generated topic pages so a removed markdown
# file cannot leave a stale HTML page behind. Only generated files live here.
rm -rf "$OUT_TOPICS"
mkdir -p "$OUT_TOPICS" .build

# Truncate the edge list. The Lua filter appends one "source<TAB>target" line
# per resolved wikilink while pandoc walks each document; starting from an
# empty file every run keeps the edge list exactly in sync with the content.
: > "$EDGES_FILE"

# --- 2. one pandoc run per markdown page --------------------------------------
# The glob expands in sorted order (LC_ALL=C above), so pages — and therefore
# the appended edge records — are always processed in the same order.
# nullglob: an unmatched glob expands to nothing instead of the literal
# string "content/*.md", so an empty content/ dir gets the clear error below
# rather than a confusing pandoc "file does not exist" failure.
shopt -s nullglob
pages=()
for src in "$CONTENT_DIR"/*.md; do
  # content/_template.md documents the authoring format; it is not a page.
  [ "$(basename "$src")" = "_template.md" ] && continue
  pages+=("$src")
done
if [ "${#pages[@]}" -eq 0 ]; then
  echo "error: no content pages found in $CONTENT_DIR/ (add a .md file — see $CONTENT_DIR/_template.md)" >&2
  exit 1
fi

for src in "${pages[@]}"; do
  # The slug is the file name without .md; it becomes the page URL and the
  # node id in graph.json.
  slug="$(basename "$src" .md)"

  echo "pandoc: $src -> $OUT_TOPICS/$slug.html"

  # Environment consumed by filters/wikilinks.lua (pandoc Lua filters cannot
  # take CLI arguments, so configuration travels via env vars):
  #   PAGE_SLUG   — the page being built, used as the edge "source" and to
  #                 skip self-links,
  #   EDGES_FILE  — where to append resolved-link edge records,
  #   CONTENT_DIR — where to look for <target-slug>.md to decide whether a
  #                 wikilink target exists (missing → styled "broken" span
  #                 + stderr warning, build continues).
  PAGE_SLUG="$slug" \
  EDGES_FILE="$EDGES_FILE" \
  CONTENT_DIR="$CONTENT_DIR" \
  pandoc \
    --from markdown+wikilinks_title_after_pipe \
    --standalone \
    --template template.html \
    --lua-filter filters/wikilinks.lua \
    --mathml \
    --wrap=none \
    --metadata pageurl="$SITE_URL/topics/$slug.html" \
    --output "$OUT_TOPICS/$slug.html" \
    "$src"

  # Why each pandoc flag is there:
  #
  # --from markdown+wikilinks_title_after_pipe
  #     Pandoc markdown plus the extension that parses [[slug]] and
  #     [[slug|display text]] into Link nodes carrying class "wikilink".
  #     Without it, wikilinks would pass through as literal brackets and the
  #     Lua filter would have nothing to rewrite.
  #
  # --standalone
  #     Emit a complete HTML document (head + body) instead of an HTML
  #     fragment. Required for --template to apply.
  #
  # --template template.html
  #     Our page shell: exact head metas (description / OpenGraph / Twitter
  #     card so shared links get real previews), the shared site header,
  #     sidebar mount point, article markup, footer. All page chrome comes
  #     from this template + frontmatter — never from post-build edits.
  #
  # --lua-filter filters/wikilinks.lua
  #     Runs inside pandoc after parsing, before writing. Rewrites wikilink
  #     targets to sibling "slug.html" pages, appends graph edges to
  #     $EDGES_FILE, and downgrades links to missing pages to a
  #     <span class="wikilink broken"> with a stderr warning (never a hard
  #     failure — a broken link should not block publishing).
  #
  # --mathml
  #     Render $$…$$ / $…$ math as native MathML at build time. Zero
  #     client-side JS, zero CDN (no KaTeX/MathJax), works offline; modern
  #     browsers render MathML natively.
  #
  # --metadata pageurl=…
  #     Injects the page's absolute canonical URL for og:url / previews.
  #     It is the only absolute URL in the page; everything else is relative.
  #
  # --wrap=none
  #     Don't re-wrap output lines at 72 columns. Pandoc's default wrapping
  #     can break <meta content="…"> attribute values across lines — legal
  #     HTML, but some link-preview scrapers parse metas naively. One long
  #     line per paragraph is safer and still deterministic.
  #
  # NOTE: --no-highlight is deliberately ABSENT. Pandoc's built-in
  # skylighting highlighter is our code highlighter: it emits token <span>s
  # (.kw .st .co …) at build time which style.css colors. No client-side
  # highlighting library. (Swappable later for a custom tokenizer if wanted.)
done

# --- 3. indexes + generated wiki page ------------------------------------------
# Reads the frontmatter of every content page plus the edge list produced
# above, then writes graph.json (nodes/edges for the graph view),
# search-index.json (client search corpus), manifest.json (for a future
# retrieval layer) and wiki.html (the browsable index page).
# Python stdlib only — no pip, no yaml module (frontmatter shape is fixed
# and parsed with a few string splits).
python3 tools/build_index.py \
  --content "$CONTENT_DIR" \
  --edges "$EDGES_FILE" \
  --site-url "$SITE_URL" \
  --out .

echo "build complete."
