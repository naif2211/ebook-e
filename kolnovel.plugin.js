// Harbor eBook source for kolnovel.com
const BASE = "https://kolnovel.com";

async function getDoc(path) {
  const url = /^https?:\/\//i.test(path)
    ? path
    : BASE + (path.startsWith("/") ? path : "/" + path);
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

function clean(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function cleanTitle(value) {
  return clean(value).replace(/\s+(?:kol|كول)$/iu, "").trim();
}

function pageNumber(offset) {
  return Math.floor(Number(offset || 0) / 20) + 1;
}

function seriesId(href) {
  const value = abs(href) || "";
  const match = value.match(/\/series\/([^/?#]+)\/?(?:[?#].*)?$/i);
  if (!match) return "";
  try { return decodeURIComponent(match[1]); } catch (_) { return match[1]; }
}

function seriesPath(id) {
  return "/series/" + encodeURIComponent(id) + "/";
}

function chapterNumber(text) {
  const value = clean(text);
  const m = value.match(/(?:الفصل|فصل|chapter|ch\.?)\s*[:#-]?\s*(\d+(?:\.\d+)?)/iu);
  return m ? m[1] : undefined;
}

function chapterNumberFromUrl(url) {
  const value = String(url || "");
  const patterns = [
    /(?:chapter|chap|ch|الفصل|فصل)[-_ ]?(\d+(?:\.\d+)?)/iu,
    /[-_](\d+(?:\.\d+)?)\/?(?:[?#].*)?$/u,
  ];
  for (const re of patterns) {
    const m = value.match(re);
    if (m) return m[1];
  }
  return undefined;
}

function chapterFromLink(node) {
  const href = node.attr("href") || "";
  const title = clean(node.text());
  return chapterNumber(title) || chapterNumberFromUrl(href);
}

function isChapterLink(href) {
  return /(?:^|\/)shaag/i.test(String(href || ""));
}

function chapterIdFromUrl(url) {
  const absolute = abs(url);
  if (!absolute) return "";
  return absolute.replace(/^https?:\/\/[^/]+\//i, "").replace(/^\/+|\/+$/g, "");
}

function statusFromText(value) {
  const text = clean(value).toLowerCase();
  if (text.includes("completed")) return "completed";
  if (text.includes("hiatus")) return "hiatus";
  if (text.includes("ongoing")) return "ongoing";
  return undefined;
}

function cardToSummary(node) {
  const link = node.querySelector("a[href*='/series/']");
  if (!link) return null;
  const href = link.attr("href") || "";
  const id = seriesId(href);
  if (!id) return null;
  const img = link.querySelector("img");
  const rawTitle = clean(
    link.attr("title") ||
    node.querySelector("h2")?.text() ||
    node.querySelector("h3")?.text() ||
    (img && (img.attr("alt") || img.attr("title"))) ||
    link.text(),
  );
  if (!rawTitle) return null;
  return {
    id,
    title: cleanTitle(rawTitle),
    cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("src")),
    siteUrl: abs(href),
    isFanMade: /(?:fan[ -]?fiction|fanfic|فان\s*فيكشن|فانفيك)/iu.test(rawTitle),
  };
}

function mapSeriesResults(doc) {
  const links = doc.querySelectorAll("a[href*='/series/']");
  const results = [];
  const seen = {};
  for (const link of links) {
    const id = seriesId(link.attr("href") || "");
    if (!id || seen[id]) continue;
    const parent = link.querySelector("h2, h3") ? link : link;
    const item = cardToSummary(parent);
    if (!item) continue;
    seen[id] = true;
    results.push(item);
  }
  return results;
}

function browseParams(tagId) {
  let order = "update";
  let status = "";
  if (tagId === "sort:popular") order = "popular";
  else if (tagId === "sort:rating") order = "rating";
  else if (tagId === "sort:chapters") order = "chapters";
  else if (tagId === "status:ongoing") status = "ongoing";
  else if (tagId === "status:completed") status = "completed";
  else if (tagId === "status:hiatus") status = "hiatus";
  return { order, status };
}

function extractChapters(doc) {
  const links = doc.querySelectorAll("a[href]");
  const chapters = [];
  const seen = {};

  for (const a of links) {
    const href = a.attr("href") || "";
    if (!isChapterLink(href)) continue;
    const absolute = abs(href);
    const id = chapterIdFromUrl(absolute);
    if (!absolute || !id || seen[id]) continue;

    const title = clean(a.text()) || clean(a.attr("title")) || clean(a.attr("aria-label"));
    const number = chapterFromLink(a);
    if (!number) continue;

    seen[id] = true;
    chapters.push({
      id,
      chapter: number,
      title: title || "Chapter " + number,
      position: chapters.length,
      pages: 0,
      language: "ar",
    });
  }

  chapters.sort(function(a, b) {
    const an = Number(a.chapter);
    const bn = Number(b.chapter);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return a.title.localeCompare(b.title, "ar");
  });
  for (let i = 0; i < chapters.length; i++) chapters[i].position = i;
  return chapters;
}

function findContentRoot(doc) {
  const selectors = [
    ".entry-content",
    ".reading-content",
    ".chapter-content",
    ".text-left",
    ".reading-area",
    ".single-content",
    ".post-content",
    ".article-content",
    ".content-area article",
    "article .entry-content",
    "article",
  ];
  for (const selector of selectors) {
    const node = doc.querySelector(selector);
    if (node) return node;
  }
  return null;
}

function extractContent(root) {
  if (!root) return "";

  const selectors = ["p", "blockquote", "div[class*='text']", "div[class*='content']"];
  const nodes = root.querySelectorAll(selectors.join(","));
  const blocks = [];
  const seen = {};

  for (const node of nodes) {
    const text = clean(node.text());
    if (!text || seen[text]) continue;
    seen[text] = true;
    blocks.push(text);
  }

  if (blocks.length) return blocks.join("\n\n");
  return clean(root.text());
}

const plugin = {
  id: "kolnovel",
  name: "KolNovel",

  async popular(offset, tagId) {
    const page = pageNumber(offset);
    const { order, status } = browseParams(tagId);
    const path = "/series/?order=" + encodeURIComponent(order) + "&page=" + page + "&status=" + encodeURIComponent(status) + "&type=";
    return mapSeriesResults(await getDoc(path));
  },

  async search(query, offset, tagId) {
    const page = pageNumber(offset);
    const { order, status } = browseParams(tagId);
    const path = "/series/?search=" + encodeURIComponent(query) + "&order=" + encodeURIComponent(order) + "&page=" + page + "&status=" + encodeURIComponent(status) + "&type=";
    return mapSeriesResults(await getDoc(path));
  },

  async detail(id) {
    const doc = await getDoc(seriesPath(id));
    const title = cleanTitle(doc.querySelector("h1")?.text() || id);
    if (!title) return null;
    const cover = doc.querySelector("img.wp-post-image, .series-cover img, .book-cover img, .summary_image img, img[data-src], img[src]");
    const author = clean(doc.querySelector(".author a, .author-content a, .author")?.text());
    const yearText = clean(doc.querySelector(".release-year, .year")?.text());
    const year = Number.parseInt(yearText, 10);
    const genres = doc.querySelectorAll(".genres a, .genre a, a[href*='/genre/']").map(function(node) { return clean(node.text()); }).filter(Boolean);
    const chapters = extractChapters(doc);
    return {
      id,
      title,
      altTitle: clean(doc.querySelector(".alternative, .alt-title, .series-alternative")?.text()) || undefined,
      cover: abs(cover?.attr("data-src") || cover?.attr("data-lazy-src") || cover?.attr("src")),
      description: clean(doc.querySelector(".description, .summary, .series-description, .desc")?.text()) || undefined,
      status: statusFromText(doc.querySelector("body")?.text() || ""),
      author: author || undefined,
      year: Number.isFinite(year) ? year : undefined,
      genres: genres.length ? genres : undefined,
      chapters: chapters.length ? Number(chapters[chapters.length - 1].chapter) : undefined,
      siteUrl: BASE + seriesPath(id),
      isFanMade: /(?:fan[ -]?fiction|fanfic|فان\s*فيكشن|فانفيك)/iu.test(title),
    };
  },

  async chapters(id) {
    const doc = await getDoc(seriesPath(id));
    return extractChapters(doc);
  },

  async content(chapterId) {
    const doc = await getDoc(chapterId);
    const root = findContentRoot(doc);
    const content = extractContent(root);
    if (content) return content;

    // Last-resort fallback: collect meaningful paragraph-like text from the document.
    const nodes = doc.querySelectorAll("p, blockquote");
    const blocks = [];
    for (const node of nodes) {
      const text = clean(node.text());
      if (text && text.length > 1) blocks.push(text);
    }
    return blocks.join("\n\n");
  },

  async tags() {
    return [
      { id: "status:ongoing", name: "Ongoing", group: "Status" },
      { id: "status:completed", name: "Completed", group: "Status" },
      { id: "status:hiatus", name: "Hiatus", group: "Status" },
      { id: "sort:popular", name: "Popular", group: "Sort" },
      { id: "sort:chapters", name: "Chapters", group: "Sort" },
      { id: "sort:rating", name: "Rating", group: "Sort" },
    ];
  },
};
