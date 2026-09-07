const BASE = "https://novelsparadise.site";
const PAGE_SIZE = 20;

async function getDoc(path) {
  const url = /^https?:\/\//i.test(path) ? path : BASE + (path.startsWith("/") ? path : "/" + path);
  const res = await harbor.http(url, { responseType: "text", timeoutMs: 20000 });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return harbor.parseHtml(res.body);
}

function abs(url) {
  if (!url) return undefined;
  const v = String(url).trim();
  if (!v || /^data:/i.test(v)) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("//")) return "https:" + v;
  return v.startsWith("/") ? BASE + v : BASE + "/" + v;
}

function clean(v) { return String(v || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(); }
function pageNumber(offset) { return Math.floor(Number(offset || 0) / PAGE_SIZE) + 1; }

function seriesId(href) {
  const m = (abs(href) || "").match(/\/series\/([^/?#]+)\/?(?:[?#].*)?$/i);
  if (!m) return "";
  try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
}

function seriesPath(id) { return "/series/" + encodeURIComponent(id) + "/"; }

function card(link) {
  const href = link.attr("href") || "";
  const id = seriesId(href);
  if (!id) return null;

  const img = link.querySelector("img");
  const title = clean(link.attr("title") || img?.attr("alt") || img?.attr("title") || link.text());
  if (!title || title.length > 250) return null;

  return {
    id,
    title: title.replace(/^رواية\s+/iu, "").replace(/\s+مترجمة\s*$/iu, "").trim(),
    cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("data-original") || img?.attr("src")),
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

function chapterNumber(text, url) {
  const t = clean(text);
  let m = t.match(/(?:الفصل|فصل|chapter|ch\.?)\s*[#:.-]*(\d+(?:\.\d+)?)/iu);
  if (m) return m[1];
  m = String(url || "").match(/[-_/](\d+(?:\.\d+)?)(?:\/?(?:[?#].*)?)$/i);
  return m ? m[1] : undefined;
}

function chapterId(url) {
  const absolute = abs(url);
  if (!absolute) return "";
  return absolute.replace(/^https?:\/\/novelsparadise\.site/i, "").replace(/^\/+/, "/");
}

function isChapterUrl(url) {
  const absolute = abs(url) || "";
  if (!/^https?:\/\/novelsparadise\.site\//i.test(absolute)) return false;
  if (/\/series(?:\/|$)/i.test(absolute)) return false;
  return /[-_/]\d+(?:\.\d+)?(?:\/?(?:[?#].*)?)$/i.test(absolute);
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
    const number = chapterNumber(title, absolute);
    if (!number) continue;

    seen[id] = true;
    out.push({
      id,
      chapter: number,
      title: title || "الفصل " + number,
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
    "article .entry-content", "article", "main"
  ];
  for (const s of selectors) {
    const n = doc.querySelector(s);
    if (n && clean(n.text()).length > 40) return n;
  }
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

const plugin = {
  id: "novelsparadise",
  name: "Novels Paradise",

  async popular(offset, tagId) {
    const page = pageNumber(offset);
    let order = "";
    if (tagId === "sort:update") order = "update";
    else if (tagId === "sort:new") order = "new";
    else if (tagId === "sort:popular") order = "popular";

    const suffix = order ? "&order=" + encodeURIComponent(order) : "";
    return mapSeriesResults(await getDoc("/series/?page=" + page + suffix));
  },

  async search(query, offset) {
    const q = clean(query);
    if (!q) return [];

    const page = pageNumber(offset);
    const encoded = encodeURIComponent(q);

    // Novels Paradise uses the WordPress-style `search` parameter on its
    // series listing. This is the important part that the old source missed.
    const urls = [
      "/series/?search=" + encoded + "&page=" + page,
      "/series/?s=" + encoded + "&page=" + page,
      "/?search=" + encoded + "&page=" + page,
      "/?s=" + encoded + "&page=" + page
    ];

    for (const path of urls) {
      try {
        const result = mapSeriesResults(await getDoc(path));
        if (result.length) return result;
      } catch (_) {}
    }

    // Fallback: scan the paginated series index. Keep it bounded so a failed
    // search never makes Harbor appear to hang indefinitely.
    const needle = q.toLocaleLowerCase();
    const matches = [];
    const seen = {};
    for (let p = 1; p <= 30; p++) {
      let result = [];
      try { result = mapSeriesResults(await getDoc("/series/?page=" + p)); } catch (_) { break; }
      if (!result.length) break;
      for (const item of result) {
        if (!seen[item.id] && item.title.toLocaleLowerCase().includes(needle)) {
          seen[item.id] = true;
          matches.push(item);
        }
      }
    }

    const start = (page - 1) * PAGE_SIZE;
    return matches.slice(start, start + PAGE_SIZE);
  },

  async detail(id) {
    const doc = await getDoc(seriesPath(id));
    const title = clean(doc.querySelector("h1")?.text() || id);
    const cover = doc.querySelector("img.wp-post-image, .series-cover img, .book-cover img, .summary_image img, img[data-src], img[src]");

    return {
      id,
      title,
      cover: abs(cover?.attr("data-src") || cover?.attr("data-lazy-src") || cover?.attr("data-original") || cover?.attr("src")),
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
    return extractText(root) || clean(doc.text());
  },

  async tags() {
    return [
      { id: "sort:update", name: "آخر التحديثات", group: "Sort" },
      { id: "sort:new", name: "المضاف حديثاً", group: "Sort" },
      { id: "sort:popular", name: "شائع", group: "Sort" }
    ];
  }
};
