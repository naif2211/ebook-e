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
  return /^https?:\/\/kolnovel\.com\/shaag[^/?#]*(?:[/?#]|$)/i.test(absolute);
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
  const links = doc.querySelectorAll("a[href]");
  const out = [], seen = {};

  for (const a of links) {
    const href = a.attr("href") || "";
    const absolute = abs(href);
    if (!absolute || !isChapterUrl(absolute)) continue;

    const id = chapterId(absolute);
    if (!id || seen[id]) continue;

    const title = clean(a.text()) || clean(a.attr("title")) || clean(a.attr("aria-label"));
    const number = chapterNumber(title) || chapterNumberFromUrl(absolute);

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
    const an = Number(a.chapter), bn = Number(b.chapter);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return a.position - b.position;
  });
  for (let i = 0; i < out.length; i++) out[i].position = i;
  return out;
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
    const { order, status } = browseParams(tagId);
    return mapSeriesResults(await getDoc("/series/?search=" + encodeURIComponent(query) + "&order=" + encodeURIComponent(order) + "&page=" + pageNumber(offset) + "&status=" + encodeURIComponent(status) + "&type="));
  },

  async detail(id) {
    const doc = await getDoc(seriesPath(id));
    const title = clean(doc.querySelector("h1")?.text() || id);
    const cover = doc.querySelector("img.wp-post-image, .series-cover img, .book-cover img, .summary_image img, img[data-src], img[src]");
    return {
      id,
      title,
      cover: abs(cover?.attr("data-src") || cover?.attr("data-lazy-src") || cover?.attr("src")),
      description: clean(doc.querySelector(".description, .summary, .series-description, .desc")?.text()) || undefined,
      chapters: extractChapters(doc).length,
      siteUrl: BASE + seriesPath(id)
    };
  },

  async chapters(id) {
    return extractChapters(await getDoc(seriesPath(id)));
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
