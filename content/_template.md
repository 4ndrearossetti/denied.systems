---
title: "Page Title In Plain English"
summary: "One sentence. Used for the meta description, link previews, search results, and the wiki index."
tags: [primary-tag, secondary-tag]
updated: 2026-07-07
---

<!--
  content/_template.md — copy this file to content/<slug>.md and edit.
  This file itself is SKIPPED by ./build.sh.

  Rules of the road:

  * File name = slug = URL. Lowercase, hyphens, no spaces:
    content/gnss-denied-navigation.md -> topics/gnss-denied-navigation.html

  * Frontmatter must have exactly the four keys above. `tags` is an inline
    list; the FIRST tag is the page's primary tag (it decides the wiki-index
    group and the graph node color). Keep values on one line; quotes are
    optional for values without special characters.

  * `title` and `summary` are PLAIN TEXT: no raw HTML, no `<` character, and
    never the sequence `</` — they are interpolated unescaped into the page
    <head> and h1 (a literal `</title>` breaks the whole head), but entity-
    escaped on wiki.html, so markup would render on one view and not the
    other. `&`, `>` and unicode are fine. Also note: pandoc smart-quotes
    topic pages while wiki.html keeps your typed punctuation — type the exact
    quotes/dashes you want (e.g. ’ “ ”) if the two views must match.

  * Do NOT start the body with an `# h1` — the template renders the title.
    Your first heading is a `##`, like the sections below.

  * Wikilinks connect pages and draw the graph:
      [[some-other-page]]                     -> link, text = slug
      [[some-other-page|readable link text]]  -> link, custom text
    The target is the destination file name without `.md`. A link to a page
    that doesn't exist yet renders as a muted "broken" span and prints a
    warning at build time — the build still succeeds.

  * Math is written in TeX and compiled to native MathML at build time
    (no client-side JS). `$$ ... $$` for display math, `$ ... $` inline.

  * Code blocks are fenced and language-tagged; pandoc highlights them at
    build time (styled by style.css, nothing client-side):

      ```python
      ...
      ```

  After adding or editing a page, run ./build.sh and commit the regenerated
  output. Never hand-edit anything in topics/ or wiki.html.
-->

## First section

Prose goes here. Cross-reference other pages with [[some-other-page]] or
[[some-other-page|readable link text]].

## Math example

Display math becomes MathML at build time:

$$
x_{k+1} = F x_k + B u_k + w_k
$$

## Code example

```python
def example():
    return "highlighted at build time"
```
