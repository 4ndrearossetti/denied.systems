-- filters/wikilinks.lua — resolve [[wikilinks]] and record graph edges.
--
-- Pandoc is invoked with `--from markdown+wikilinks_title_after_pipe`, which
-- parses [[target-slug]] and [[target-slug|display text]] into Link nodes
-- whose class list contains "wikilink". This filter:
--
--   1. slugifies the link target (lowercase, spaces -> hyphens, strip .md),
--   2. if content/<slug>.md exists: rewrites the target to the sibling page
--      "<slug>.html" (topic pages all live in topics/, so a bare relative
--      file name is correct) and appends one "source<TAB>target" line to
--      $EDGES_FILE — the raw edge list tools/build_index.py dedupes into
--      graph.json,
--   3. if it does not exist: emits <span class="wikilink broken">…</span>
--      and a stderr warning. A broken link never fails the build.
--
-- Configuration arrives via environment variables set by build.sh
-- (Lua filters take no CLI arguments):
--   PAGE_SLUG   — slug of the page being built (edge source, self-link check)
--   EDGES_FILE  — path of the TSV edge list to append to
--   CONTENT_DIR — directory holding the markdown sources

local page_slug = os.getenv("PAGE_SLUG") or ""
local edges_file = os.getenv("EDGES_FILE")
local content_dir = os.getenv("CONTENT_DIR") or "content"

-- Normalize a wikilink target into a slug: strip a trailing ".md" (authors
-- sometimes write [[page.md]]), trim surrounding whitespace, lowercase, and
-- turn internal whitespace runs into single hyphens.
local function slugify(target)
  local s = target
  s = s:gsub("%.md$", "")
  s = s:gsub("^%s+", ""):gsub("%s+$", "")
  s = s:lower()
  s = s:gsub("%s+", "-")
  return s
end

-- True if the wikilink target has a corresponding markdown source.
local function source_exists(slug)
  local f = io.open(content_dir .. "/" .. slug .. ".md", "r")
  if f then
    f:close()
    return true
  end
  return false
end

-- Append one edge record. Called once per resolved link, in document order,
-- with pages processed in sorted order by build.sh — so the file contents
-- are deterministic. Duplicates are fine; the indexer dedupes.
local function record_edge(target_slug)
  if not edges_file or page_slug == "" then
    return
  end
  if target_slug == page_slug then
    return -- self-links are rewritten but not recorded (contract §3)
  end
  local f = io.open(edges_file, "a")
  if f then
    f:write(page_slug .. "\t" .. target_slug .. "\n")
    f:close()
  end
end

-- True for Link nodes produced by the wikilinks_title_after_pipe extension.
-- Pandoc has marked these two ways across versions: older builds put
-- "wikilink" in the class list, current ones (e.g. 3.6.1) set the link
-- TITLE to "wikilink". Accept either so the filter survives upgrades.
local function is_wikilink(el)
  return el.classes:includes("wikilink") or el.title == "wikilink"
end

function Link(el)
  -- Only touch links produced by the wikilink extension; ordinary markdown
  -- links pass through untouched.
  if not is_wikilink(el) then
    return nil
  end

  local slug = slugify(el.target)

  if not source_exists(slug) then
    io.stderr:write(
      "wikilinks.lua: warning: broken wikilink [[" .. el.target .. "]]"
      .. " in content/" .. page_slug .. ".md"
      .. " (no " .. content_dir .. "/" .. slug .. ".md)\n")
    -- Keep the display text visible but unlinked; CSS styles
    -- .wikilink.broken as a muted dashed underline.
    return pandoc.Span(el.content, pandoc.Attr("", { "wikilink", "broken" }))
  end

  record_edge(slug)

  -- Topic pages are siblings inside topics/, so the relative target is just
  -- the file name. Keep only the "wikilink" class so CSS can style internal
  -- cross-references distinctly, and clear the "wikilink" marker title so it
  -- doesn't leak into the HTML as a tooltip.
  el.target = slug .. ".html"
  el.title = ""
  el.classes = pandoc.List({ "wikilink" })
  return el
end
