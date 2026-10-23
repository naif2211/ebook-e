const BASE = "https://kolnovel.com";

async function getDoc(path) {
  const url = /^https?:\/\//i.test(path) ? path : BASE + (path.startsWith("/") ? path : "/" + path);
  const res = await harbor.http(url, { responseType: "text", timeoutMs: 20000 });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return harbor.parseHtml(res.body);
}

function abs(url) {
  if (!url) return undefined;
  const v = String(url).trim();
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("//")) return "https:" + v;
  return v.startsWith("/") ? BASE + v : BASE + "/" + v;
}

function clean(v) { return String(v || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(); }
function pageNumber(offset) { return Math.floor(Number(offset || 0) / 20) + 1; }
function seriesId(href) {
  const m = (abs(href) || "").match(/\/series\/([^/?#]+)\/?(?:[?#].*)?$/i);
  if (!m) return "";
  try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
}
function seriesPath(id) { return "/series/" + encodeURIComponent(id) + "/"; }
function chapterArchivePath(id) { return "/shaag24category/" + encodeURIComponent(id) + "/"; }

function chapterNumber(text) {
  const s = clean(text);
  const m = s.match(/(?:الفصل|فصل|chapter|ch\.?)[\s:#-]*(\d+(?:\.\d+)?)/iu);
  return m ? m[1] : undefined;
}

function chapterNumberFromUrl(url) {
  const s = String(url || "");
  const patterns = [
    /(?:chapter|chap|ch|الفصل|فصل)[-_ ]?(\d+(?:\.\d+)?)/iu,
    /(?:-|_)(\d+(?:\.\d+)?)(?:\/?(?:[?#].*)?)$/u
  ];
  for (const re of patterns) { const m = s.match(re); if (m) return m[1]; }
  return undefined;
}

function chapterId(url) {
  const absolute = abs(url);
  if (!absolute) return "";
  // Harbor chapter IDs are kept as site-relative paths. This is important:
  // the reader passes the ID back to content(), which then resolves it with BASE.
  return absolute.replace(/^https?:\/\/kolnovel\.com/i, "").replace(/^\/+/, "/");
}

function isChapterUrl(url) {
  const absolute = abs(url) || "";
  // Accept both www/non-www and chapter slugs under the site's /shaag... route.
  return /^https?:\/\/(?:www\.)?kolnovel\.com\/shaag[^?#]*(?:[?#].*)?$/i.test(absolute);
}

function card(link) {
  const href = link.attr("href") || "";
  const id = seriesId(href);
  if (!id) return null;
  const img = link.querySelector("img");
  const title = clean(link.attr("title") || img?.attr("alt") || img?.attr("title") || link.text());
  if (!title) return null;
  return {
    id,
    title: title.replace(/\s+(?:kol|كول)$/iu, "").trim(),
    cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("src")),
    siteUrl: abs(href)
  };
}

function mapSeriesResults(doc) {
  const links = doc.querySelectorAll("a[href*='/series/']");
  const out = [], seen = {};
  for (const link of links) {
    const item = card(link);
    if (!item || seen[item.id]) continue;
    seen[item.id] = true;
    out.push(item);
  }
  return out;
}

function extractChapters(doc) {
  const out = [];
  const seen = {};
  // Important: inspect ALL anchors. A previous version stopped as soon as
  // it found any table/list anchors, even if they were only author/category
  // links, so it never reached the actual chapter links farther down the page.
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = a.attr("href") || "";
    const absolute = abs(href);
    if (!absolute || !/^https?:\/\/(?:www\.)?kolnovel\.com\//i.test(absolute)) continue;
    if (/\/series\//i.test(absolute) || /\/genre\//i.test(absolute) || /\/tag\//i.test(absolute)) continue;

    const title = clean(a.text()) || clean(a.attr("title")) || clean(a.attr("aria-label"));
    const number = chapterNumber(title) || chapterNumberFromUrl(absolute);
    const textLooksLikeChapter = /(?:الفصل|فصل|chapter|ch\.?)[\s:#-]*\d+/iu.test(title);
    const urlLooksLikeChapter = /\/(?:shaag|chapter|chap)[^/]*(?:\/|$)/i.test(absolute) ||
      /(?:chapter|chap|ch)[-_ ]?\d+/i.test(absolute);
    if (!textLooksLikeChapter && !urlLooksLikeChapter) continue;
    if (!number && !textLooksLikeChapter) continue;

    const id = chapterId(absolute);
    if (!id || seen[id]) continue;
    seen[id] = true;
    out.push({
      id,
      chapter: number || String(out.length + 1),
      title: title || "الفصل " + (number || String(out.length + 1)),
      position: out.length,
      pages: 0,
      language: "ar"
    });
  }

  out.sort((a, b) => {
    const an = Number(String(a.chapter || "").replace(/[^0-9.]/g, ""));
    const bn = Number(String(b.chapter || "").replace(/[^0-9.]/g, ""));
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return a.position - b.position;
  });
  for (let i = 0; i < out.length; i++) out[i].position = i;
  return out;
}

function findCover(doc) {
  const selectors = [
    ".series-cover img", ".book-cover img", ".summary_image img",
    ".summary_img img", ".wp-post-image", ".series-thumb img",
    ".post-thumbnail img", "figure img", "meta[property='og:image']",
    "meta[name='twitter:image']"
  ];
  for (const selector of selectors) {
    const node = doc.querySelector(selector);
    const src = imageFrom(node);
    if (src && !/placeholder|blank\.gif|no-image|default-cover/i.test(src)) return src;
  }
  // Fallback: select a likely cover image, not an arbitrary tiny site icon.
  for (const node of doc.querySelectorAll("img[data-src], img[data-lazy-src], img[data-original], img[src]")) {
    const src = imageFrom(node);
    if (src && !/logo|avatar|icon|placeholder|blank\.gif|no-image/i.test(src)) return src;
  }
  return undefined;
}

function findContent(doc) {
  const selectors = [
    ".reading-content", ".chapter-content", ".entry-content", ".text-left",
    ".reading-area", ".single-content", ".post-content", ".article-content",
    "article .entry-content", "article"
  ];
  for (const s of selectors) { const n = doc.querySelector(s); if (n) return n; }
  return null;
}

function extractText(root) {
  if (!root) return "";
  const nodes = root.querySelectorAll("p, blockquote");
  const out = [], seen = {};
  for (const n of nodes) {
    const t = clean(n.text());
    if (t && !seen[t]) { seen[t] = true; out.push(t); }
  }
  return out.length ? out.join("\n\n") : clean(root.text());
}

function browseParams(tagId) {
  let order = "update", status = "";
  if (tagId === "sort:popular") order = "popular";
  else if (tagId === "sort:rating") order = "rating";
  else if (tagId === "sort:chapters") order = "chapters";
  else if (tagId === "status:ongoing") status = "ongoing";
  else if (tagId === "status:completed") status = "completed";
  else if (tagId === "status:hiatus") status = "hiatus";
  return { order, status };
}

const plugin = {
  id: "kolnovel",
  name: "KolNovel",

  async popular(offset, tagId) {
    const { order, status } = browseParams(tagId);
    return mapSeriesResults(await getDoc("/series/?order=" + encodeURIComponent(order) + "&page=" + pageNumber(offset) + "&status=" + encodeURIComponent(status) + "&type="));
  },

  async search(query, offset, tagId) {
    const q = clean(query);
    if (!q) return [];
    const page = pageNumber(offset);
    const encoded = encodeURIComponent(q);
    // KolNovel's catalogue lives at /series/. Try its catalogue search first.
    // The home page can still render unrelated popular series for an unknown
    // query, so never treat an unfiltered home-page result as a successful search.
    const paths = [
      "/series/?search=" + encoded + "&page=" + page,
      "/series/?searchTerm=" + encoded + "&page=" + page,
      "/series/?s=" + encoded + "&page=" + page,
      "/?s=" + encoded + "&paged=" + page
    ];
    for (let i = 0; i < paths.length; i++) {
      try {
        const doc = await getDoc(paths[i]);
        const found = mapSeriesResults(doc);
        if (!found.length) continue;
        if (i === paths.length - 1) {
          const qLower = q.toLocaleLowerCase();
          const matched = found.filter(x => clean(x.title).toLocaleLowerCase().includes(qLower));
          if (matched.length) return matched;
          continue;
        }
        return found;
      } catch (_) {}
    }
    return [];
  },

  async detail(id) {
    const doc = await getDoc(seriesPath(id));
    const title = clean(doc.querySelector("h1")?.text() || id);
    const cover = findCover(doc);
    return {
      id,
      title,
      cover,
      description: clean(doc.querySelector(".description, .summary, .series-description, .desc")?.text()) || undefined,
      chapters: extractChapters(doc).length,
      siteUrl: BASE + seriesPath(id)
    };
  },

  async chapters(id) {
    // KolNovel renders a large chapter table directly on the series page.
    // Read that page once and return the list; avoid slow speculative URL scans.
    const doc = await getDoc(seriesPath(id));
    const found = extractChapters(doc);
    if (found.length) return found;

    // Only try the site's list-mode variant if the normal page has no chapters.
    try {
      const alternate = await getDoc("/series/list-mode/?series=" + encodeURIComponent(id));
      return extractChapters(alternate);
    } catch (_) {
      return [];
    }
  },

  async content(chapterId) {
    const doc = await getDoc(chapterId);
    const root = findContent(doc);
    return extractText(root) || extractText(doc);
  },

  async tags() {
    return [
      { id: "status:ongoing", name: "Ongoing", group: "Status" },
      { id: "status:completed", name: "Completed", group: "Status" },
      { id: "status:hiatus", name: "Hiatus", group: "Status" },
      { id: "sort:popular", name: "Popular", group: "Sort" },
      { id: "sort:chapters", name: "Chapters", group: "Sort" },
      { id: "sort:rating", name: "Rating", group: "Sort" }
    ];
  }
};
