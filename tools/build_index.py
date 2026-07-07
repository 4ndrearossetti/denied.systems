#!/usr/bin/env python3
"""build_index.py — emit graph.json, search-index.json, manifest.json, wiki.html.

Called by build.sh after pandoc has rendered every topic page:

    python3 tools/build_index.py --content content --edges .build/edges.tsv \
        --site-url "$SITE_URL" --out .

Python 3 standard library ONLY — no pip packages, no yaml import. The
frontmatter shape is fixed by CONTRACT.md §2 (title, summary, inline tag
list, updated), so a few string splits are all the parsing we need.

Determinism (CONTRACT.md §3: two builds must be byte-identical):
  * every iteration is sorted (files, tags, edges, pages),
  * json.dump with indent=2 and a trailing newline,
  * no timestamps or environment-dependent values anywhere.
"""

import argparse
import html
import json
import re
import sys
from pathlib import Path

# Verbatim favicon line from CONTRACT.md §5. The xmlns URL is a namespace
# identifier inside a data: URI — not a network request.
FAVICON = (
    "<link rel=\"icon\" href=\"data:image/svg+xml,"
    "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E"
    "%3Crect width='16' height='16' fill='%23070706'/%3E"
    "%3Ccircle cx='8' cy='8' r='2.2' fill='%23d4643a'/%3E"
    "%3Ccircle cx='8' cy='8' r='5.5' fill='none' stroke='%23d4643a' "
    "stroke-opacity='.45' stroke-width='1' stroke-dasharray='2 3'/%3E%3C/svg%3E\">"
)


def parse_page(path):
    """Parse one content/<slug>.md into (meta dict, body markdown).

    Expects the exact frontmatter shape of CONTRACT.md §2:

        ---
        title: "Human-readable title"
        summary: "One sentence."
        tags: [navigation, sensor-fusion]
        updated: 2026-07-07
        ---

    Values may be bare or wrapped in single/double quotes; tags is an inline
    [a, b] list. Anything fancier is a hard error — keep authoring simple.
    """
    raw = path.read_text(encoding="utf-8")
    lines = raw.splitlines()
    if not lines or lines[0].strip() != "---":
        sys.exit(f"error: {path}: missing '---' frontmatter block")

    meta = {}
    i = 1
    while i < len(lines) and lines[i].strip() != "---":
        line = lines[i]
        i += 1
        if not line.strip():
            continue
        if ":" not in line or line[:1].isspace():
            # A non-blank line that isn't a top-level "key: value" pair means
            # multi-line/folded YAML (or a typo). Pandoc would parse it; this
            # deliberately simple parser can't — hard error per the docstring,
            # so page metadata and index metadata can never silently diverge.
            sys.exit(f"error: {path}: frontmatter line {i} is not a simple "
                     f"'key: value' pair: {line.strip()!r} — keep values on "
                     f"one line (CONTRACT.md §2)")
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip()
        if key == "tags":
            value = value.strip("[]")
            meta["tags"] = [
                t.strip().strip("\"'") for t in value.split(",") if t.strip()
            ]
        else:
            # Strip one layer of surrounding quotes, if present. Inside
            # double quotes, honor YAML's escapes for \" and \\ so titles
            # match what pandoc renders on the built page.
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                quote = value[0]
                value = value[1:-1]
                if quote == '"':
                    value = value.replace('\\"', '"').replace("\\\\", "\\")
            meta[key] = value
    if i >= len(lines):
        sys.exit(f"error: {path}: unterminated frontmatter (no closing '---')")

    for required in ("title", "summary", "tags", "updated"):
        if required not in meta:
            sys.exit(f"error: {path}: frontmatter is missing '{required}'")
        if not meta[required] and required != "tags":
            sys.exit(f"error: {path}: frontmatter is missing '{required}'")
    if not meta["tags"]:
        # Contract §2 asks for tags, but one contributor's empty tag list
        # should not abort the whole build (broken wikilinks warn too).
        # The page is grouped under "untagged" downstream, matching js/app.js.
        print(f"build_index.py: warning: {path}: empty 'tags' — page will be "
              f"grouped under 'untagged'", file=sys.stderr)

    body = "\n".join(lines[i + 1:])
    return meta, body


def strip_markdown(body):
    """Markdown body -> plain text for the search index (CONTRACT.md §4).

    Wikilinks become their display text, code is kept as text (fence lines
    dropped), math is kept minus its $ fences, markdown syntax characters are
    removed, and whitespace is collapsed.

    Code and math are protected before the markdown-syntax pass so their
    raw text survives verbatim: `fuse_pitch` stays `fuse_pitch` (not
    `fusepitch`), `gyro_q * dt` keeps its `_` and `*`. Protected spans are
    swapped for \\x00<n>\\x00 placeholders (a byte that never occurs in
    markdown prose) and spliced back after the syntax strip.
    """
    text = body
    # Drop HTML comments (authors use them for editorial notes).
    text = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)

    protected = []

    def protect(match):
        protected.append(match.group(1))
        return f"\x00{len(protected) - 1}\x00"

    # Fenced code blocks: drop the ``` delimiter lines, protect the code.
    text = re.sub(r"^[ \t]*```[^\n]*\n(.*?)^[ \t]*```[ \t]*$",
                  protect, text, flags=re.MULTILINE | re.DOTALL)
    # Inline code: protect the content minus the backticks. This runs BEFORE
    # the math passes to match pandoc's own precedence — code spans bind
    # tighter than math, so a $ inside `...` is literal code, never a math
    # fence (e.g. `awk '$1 == $2'`).
    text = re.sub(r"`([^`\n]+)`", protect, text)
    # Math, display then inline: protect the content minus its $ fences.
    text = re.sub(r"\$\$(.+?)\$\$", protect, text, flags=re.DOTALL)
    text = re.sub(r"\$([^$\n]+)\$", protect, text)
    # Any stray (unpaired) fence delimiter line left over.
    text = re.sub(r"^\s*```.*$", "", text, flags=re.MULTILINE)

    # Wikilinks: [[slug|display]] -> display, [[slug]] -> slug.
    text = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", text)
    text = re.sub(r"\[\[([^\]|]+)\]\]", r"\1", text)
    # Images before links: ![alt](src) -> alt, then [text](href) -> text.
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    # Heading markers and blockquote markers at line starts.
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s{0,3}>\s?", "", text, flags=re.MULTILINE)
    # Emphasis and leftover fence characters in prose: drop the syntax.
    # (Code and math are already protected, so their *_`$ are untouched.)
    text = re.sub(r"[*_`$]", "", text)
    # Table/rule leftovers.
    text = re.sub(r"^\s*[|:\-]{3,}\s*$", "", text, flags=re.MULTILINE)

    # Splice the protected code/math spans back in, verbatim. Iterated: a
    # span protected in a later pass can contain the placeholder of an
    # earlier one (e.g. a code span nested inside display math), so a single
    # pass could leave raw \x00<n>\x00 placeholders in the output. Guaranteed
    # to terminate: protected[i] can only embed placeholders j < i (spans are
    # appended in pass order), so each pass strictly lowers the indices left.
    while re.search(r"\x00\d+\x00", text):
        text = re.sub(r"\x00(\d+)\x00",
                      lambda m: protected[int(m.group(1))], text)
    # Collapse all whitespace to single spaces.
    text = re.sub(r"\s+", " ", text).strip()
    return text


def load_pages(content_dir):
    """Return the sorted list of page dicts (skipping _template.md)."""
    pages = []
    for path in sorted(content_dir.glob("*.md")):
        if path.name == "_template.md":
            continue
        meta, body = parse_page(path)
        slug = path.stem
        pages.append({
            "id": slug,
            "title": meta["title"],
            "summary": meta["summary"],
            "tags": meta["tags"],
            "updated": meta["updated"],
            "url": f"topics/{slug}.html",  # site-root-relative, no leading /
            "text": strip_markdown(body),
        })
    return pages


def load_edges(edges_file, known_slugs):
    """Read the raw TSV edge list, dedupe, keep only edges whose endpoints
    both exist as pages, and return them sorted by (source, target)."""
    edges = set()
    if edges_file.exists():
        for line in edges_file.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) != 2:
                print(f"build_index.py: warning: malformed edge record: "
                      f"{line!r}", file=sys.stderr)
                continue
            source, target = parts[0].strip(), parts[1].strip()
            if source in known_slugs and target in known_slugs:
                edges.add((source, target))
    return sorted(edges)


def write_json(path, obj):
    """Deterministic JSON: indent=2, preserved insertion order (we always
    build dicts in schema order), trailing newline."""
    with path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")


def build_graph(pages, edges):
    """graph.json per CONTRACT.md §4. degree = backlink count, i.e. in-degree
    over the deduped edge set."""
    indegree = {p["id"]: 0 for p in pages}
    for _source, target in edges:
        indegree[target] += 1
    return {
        "nodes": [
            {
                "id": p["id"],
                "title": p["title"],
                "url": p["url"],
                "tags": p["tags"],
                "degree": indegree[p["id"]],
            }
            for p in pages
        ],
        "edges": [{"source": s, "target": t} for s, t in edges],
    }


def build_search_index(pages):
    """search-index.json per CONTRACT.md §4 — a top-level array."""
    return [
        {
            "id": p["id"],
            "title": p["title"],
            "summary": p["summary"],
            "url": p["url"],
            "tags": p["tags"],
            "updated": p["updated"],
            "text": p["text"],
        }
        for p in pages
    ]


def build_manifest(pages, site_url):
    """manifest.json per CONTRACT.md §4 — consumed only by a future
    retrieval layer (the deferred assistant), not by v1 client JS."""
    return {
        "schema": 1,
        "site": site_url,
        "pages": [
            {
                "id": p["id"],
                "title": p["title"],
                "summary": p["summary"],
                "tags": p["tags"],
                "updated": p["updated"],
                "url": p["url"],
                "words": len(p["text"].split()),
            }
            for p in pages
        ],
    }


def build_wiki_html(pages, site_url):
    """Generated wiki.html per CONTRACT.md §5: pages grouped by primary tag
    (first tag), groups sorted alphabetically, pages sorted by title within
    each group. Pages with an empty tag list fall back to the "untagged"
    group (same fallback as js/app.js's sidebar). Ends with the assistant
    stub (§9) and the search scripts."""
    groups = {}
    for p in pages:
        primary = p["tags"][0] if p["tags"] else "untagged"
        groups.setdefault(primary, []).append(p)

    sections = []
    for tag in sorted(groups):
        items = []
        for p in sorted(groups[tag], key=lambda p: (p["title"], p["id"])):
            items.append(
                f"      <li><a href=\"{html.escape(p['url'], quote=True)}\">\n"
                f"        <span class=\"pl-title\">{html.escape(p['title'])}</span>\n"
                f"        <span class=\"pl-summary\">{html.escape(p['summary'])}</span>\n"
                f"        <span class=\"pl-meta\">updated {html.escape(p['updated'])}</span>\n"
                f"      </a></li>"
            )
        sections.append(
            f"  <section class=\"tag-group\" data-tag=\"{html.escape(tag, quote=True)}\">\n"
            f"    <h2 class=\"tag-head\">{html.escape(tag)}</h2>\n"
            f"    <ul class=\"page-list\">\n"
            + "\n".join(items) + "\n"
            f"    </ul>\n"
            f"  </section>"
        )

    return f"""<!DOCTYPE html>
<!-- generated by build.sh — do not hand-edit -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>wiki — denied.systems</title>
<meta name="description" content="Index of all pages — a field guide to autonomy in contested airspace.">
<meta property="og:title" content="wiki — denied.systems">
<meta property="og:description" content="Index of all pages — a field guide to autonomy in contested airspace.">
<meta property="og:url" content="{html.escape(site_url, quote=True)}/wiki.html">
<meta name="twitter:card" content="summary">
{FAVICON}
<link rel="stylesheet" href="style.css">
</head>
<body class="page-wiki">
<header class="site-head">
  <a class="brand" href="index.html">denied<span class="brand-tld">.systems</span></a>
  <nav class="site-nav">
    <a class="active" href="wiki.html">wiki</a>
    <a href="graph.html">graph</a>
  </nav>
  <div class="search">
    <input id="search-in" type="search" placeholder="search…" autocomplete="off">
    <div id="search-out" class="search-out" hidden></div>
  </div>
</header>
<div class="layout">
  <nav class="sidebar" id="sidebar" aria-label="all pages"></nav>
  <main class="wiki-index">
  <p class="kicker">index of all pages</p>
{chr(10).join(sections)}
  </main>
</div>
<footer class="page-foot">
  <span>denied.systems — a field guide to autonomy in contested airspace</span>
  <a href="index.html">← index</a>
</footer>
<aside id="assistant" class="assistant-panel" hidden aria-label="assistant (disabled)"></aside>
<script src="js/app.js"></script>
<script src="js/search.js"></script>
<script>SiteSearch.boot('wiki')</script>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser(
        description="Emit graph.json, search-index.json, manifest.json and "
                    "wiki.html from content/*.md + the wikilink edge list.")
    ap.add_argument("--content", required=True,
                    help="directory of markdown sources (content)")
    ap.add_argument("--edges", required=True,
                    help="TSV edge list appended by filters/wikilinks.lua")
    ap.add_argument("--site-url", required=True,
                    help="canonical site origin, no trailing slash")
    ap.add_argument("--out", required=True,
                    help="output directory (the site root)")
    args = ap.parse_args()

    content_dir = Path(args.content)
    out_dir = Path(args.out)
    site_url = args.site_url.rstrip("/")

    pages = load_pages(content_dir)
    if not pages:
        sys.exit(f"error: no pages found in {content_dir}/")
    edges = load_edges(Path(args.edges), {p["id"] for p in pages})

    write_json(out_dir / "graph.json", build_graph(pages, edges))
    write_json(out_dir / "search-index.json", build_search_index(pages))
    write_json(out_dir / "manifest.json", build_manifest(pages, site_url))
    (out_dir / "wiki.html").write_text(build_wiki_html(pages, site_url),
                                       encoding="utf-8", newline="\n")

    print(f"build_index.py: {len(pages)} pages, {len(edges)} edges -> "
          f"graph.json search-index.json manifest.json wiki.html")


if __name__ == "__main__":
    main()
