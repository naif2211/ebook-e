// Harbor eBook source for kolnovel.com
const BASE = "https://kolnovel.com";
async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType: "text", timeoutMs: 20000 });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + path);
  return harbor.parseHtml(res.body);
}
function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}
function clean(v) { return (v || "").replace(/\s+/g, " ").trim(); }
function cleanTitle(v) { return clean(v).replace(/\s+(?:kol|كول)$/iu, "").trim(); }
function pageNumber(offset) { return Math.floor(offset / 20) + 1; }
function seriesId(href) { const m = (abs(href) || "").match(/\/series\/([^/?#]+)\/?(?:[?#].*)?$/i); return m ? decodeURIComponent(m[1]) : ""; }
function seriesPath(id) { return "/series/" + encodeURIComponent(id) + "/"; }
function chapterNumber(text) { const m = clean(text).match(/(?:الفصل|فصل|chapter)\s*([0-9]+(?:\.[0-9]+)?)/iu); return m ? m[1] : undefined; }

// KolNovel uses several lazy-loading image attributes depending on the page/template.
function imageFrom(node) {
  if (!node) return undefined;
  const img = node.querySelector("img") || node.querySelector("picture img");
  if (img) {
    const url = img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("data-image") || img.attr("data-url") || img.attr("data-original-src") || img.attr("src") || img.attr("srcset") || img.attr("data-srcset");
    if (url) return abs(url.split(",")[0].trim().split(" ")[0]);
  }
  const link = node.querySelector("a[href*='/series/']");
  if (link) {
    const url = link.attr("data-src") || link.attr("data-image") || link.attr("data-cover") || link.attr("data-thumbnail");
    if (url) return abs(url);
  }
  return undefined;
}
function cardToSummary(node) {
  const link = node.querySelector("a[href*='/series/']");
  if (!link) return null;
  const href = link.attr("href") || "";
  const id = seriesId(href);
  if (!id) return null;
  const rawTitle = clean(link.attr("title") || node.querySelector("h2")?.text() || node.querySelector("h3")?.text() || link.text());
  return { id, title: cleanTitle(rawTitle), cover: imageFrom(node), siteUrl: abs(href), isFanMade: false };
}
function mapSeriesResults(doc) {
  const results = [], seen = {};
  const containers = doc.querySelectorAll("article, .page-item-detail, .c-tabs-item__content, .item-summary, .series-item, li");
  for (const node of containers) {
    const item = cardToSummary(node);
    if (item && !seen[item.id]) { seen[item.id] = true; results.push(item); }
  }
  if (!results.length) {
    for (const link of doc.querySelectorAll("a[href*='/series/']")) {
      const id = seriesId(link.attr("href") || "");
      if (!id || seen[id]) continue;
      seen[id] = true;
      results.push({ id, title: cleanTitle(link.attr("title") || link.text()), cover: imageFrom(link), siteUrl: abs(link.attr("href")), isFanMade: false });
    }
  }
  return results;
}
function browseParams(tagId) {
  let order = "update", status = "", genre = "";
  if (tagId === "sort:popular") order = "popular";
  else if (tagId === "sort:rating") order = "rating";
  else if (tagId === "sort:chapters") order = "chapters";
  else if (tagId === "status:ongoing") status = "ongoing";
  else if (tagId === "status:completed") status = "completed";
  else if (tagId === "status:hiatus") status = "hiatus";
  else if (tagId && tagId.indexOf("genre:") === 0) genre = tagId.slice(6);
  return { order, status, genre };
}
function browsePath(tagId, page) {
  const p = browseParams(tagId);
  if (p.genre) return "/genre/" + encodeURIComponent(p.genre) + "/?page=" + page;
  return "/series/?order=" + encodeURIComponent(p.order) + "&page=" + page + "&status=" + encodeURIComponent(p.status) + "&type=";
}
const plugin = {
  id: "kolnovel", name: "KolNovel",
  async popular(offset, tagId) { return mapSeriesResults(await getDoc(browsePath(tagId, pageNumber(offset)))); },
  async search(query, offset, tagId) {
    const p = browseParams(tagId);
    return mapSeriesResults(await getDoc("/series/?search=" + encodeURIComponent(query) + "&order=" + encodeURIComponent(p.order) + "&page=" + pageNumber(offset) + "&status=" + encodeURIComponent(p.status) + "&type="));
  },
  async detail(id) {
    const doc = await getDoc(seriesPath(id));
    const title = cleanTitle(doc.querySelector("h1")?.text() || id);
    if (!title) return null;
    const cover = doc.querySelector("img.wp-post-image, .series-cover img, .book-cover img, .summary_image img, article img, picture img");
    const author = clean(doc.querySelector(".author a, .author-content a, .author")?.text());
    const yearText = clean(doc.querySelector(".release-year, .year")?.text());
    const year = Number.parseInt(yearText, 10);
    const genres = doc.querySelectorAll("a[href*='/genre/']").map((node) => clean(node.text())).filter(Boolean);
    let maxChapter;
    for (const a of doc.querySelectorAll("a[href*='shaag']")) {
      const n = Number.parseFloat(chapterNumber(a.text()) || "");
      if (Number.isFinite(n) && (maxChapter === undefined || n > maxChapter)) maxChapter = n;
    }
    const coverUrl = abs(cover?.attr("data-src") || cover?.attr("data-lazy-src") || cover?.attr("data-original") || cover?.attr("data-image") || cover?.attr("data-original-src") || cover?.attr("src") || cover?.attr("srcset"));
    return { id, title, altTitle: clean(doc.querySelector(".alternative, .alt-title, .series-alternative")?.text()) || undefined, cover: coverUrl, description: clean(doc.querySelector(".description, .summary, .series-description, .desc")?.text()) || undefined, status: (() => { const t = clean(doc.querySelector("body")?.text() || "").toLowerCase(); if (t.includes("completed")) return "completed"; if (t.includes("hiatus")) return "hiatus"; if (t.includes("ongoing")) return "ongoing"; return undefined; })(), author: author || undefined, year: Number.isFinite(year) ? year : undefined, genres: genres.length ? genres : undefined, chapters: maxChapter !== undefined ? maxChapter : undefined, siteUrl: BASE + seriesPath(id), isFanMade: false };
  },
  async chapters(id) {
    const doc = await getDoc(seriesPath(id));
    const links = doc.querySelectorAll("a[href*='shaag']");
    const chapters = [], seen = {};
    for (const a of links) {
      const href = a.attr("href") || "";
      const absolute = abs(href);
      const title = clean(a.text());
      if (!absolute || !/^https?:\/\/kolnovel\.com\/shaag/i.test(absolute) || !title || seen[absolute]) continue;
      seen[absolute] = true;
      chapters.push({ id: absolute.replace(BASE + "/", "").replace(/\/$/, ""), chapter: chapterNumber(title), title: title, position: chapters.length });
    }
    return chapters;
  },
  async content(chapterId) {
    const path = chapterId.replace(/^https?:\/\/kolnovel\.com\/?/i, "").replace(/^\/+/, "");
    const doc = await getDoc("/" + path);
    const containers = doc.querySelectorAll(".reading-content, .chapter-content, .reading-area, .text-left, .entry-content, .entry-content-single");
    for (const container of containers) {
      const paragraphs = container.querySelectorAll("p, blockquote, h2, h3, h4, li");
      const parts = [];
      for (const node of paragraphs) { const text = clean(node.text()); if (text) parts.push(text); }
      if (parts.length) return parts.join("\n\n");
      const fallback = clean(container.text());
      if (fallback) return fallback;
    }
    return "";
  },
  async tags() {
    return [
      { id: "genre:romantic", name: "رومانسي", group: "التصنيف" },
      { id: "genre:رومانسية", name: "رومانسية", group: "التصنيف" },
      { id: "genre:action", name: "أكشن", group: "التصنيف" },
      { id: "genre:fantasy", name: "فانتازيا", group: "التصنيف" },
      { id: "genre:drama", name: "دراما", group: "التصنيف" },
      { id: "genre:harem", name: "حريم", group: "التصنيف" },
      { id: "genre:mystery", name: "غموض", group: "التصنيف" },
      { id: "genre:horror", name: "رعب", group: "التصنيف" },
      { id: "genre:martial-arts", name: "فنون قتال", group: "التصنيف" },
      { id: "genre:school-life", name: "حياة مدرسية", group: "التصنيف" },
      { id: "genre:isekai", name: "إيسيكاي", group: "التصنيف" },
      { id: "genre:comedy", name: "كوميديا", group: "التصنيف" },
      { id: "genre:psychological", name: "نفسي", group: "التصنيف" },
      { id: "genre:reincarnation", name: "تناسخ", group: "التصنيف" },
      { id: "genre:magic", name: "سحر", group: "التصنيف" },
      { id: "genre:military", name: "عسكري", group: "التصنيف" },
      { id: "genre:historical", name: "تاريخي", group: "التصنيف" },
      { id: "genre:tragedy", name: "مأساة", group: "التصنيف" },
      { id: "status:ongoing", name: "Ongoing", group: "الحالة" },
      { id: "status:completed", name: "Completed", group: "الحالة" },
      { id: "status:hiatus", name: "Hiatus", group: "الحالة" },
      { id: "sort:popular", name: "الرائجة", group: "الترتيب" },
      { id: "sort:chapters", name: "الفصول", group: "الترتيب" },
      { id: "sort:rating", name: "التقييم", group: "الترتيب" }
    ];
  }
};
