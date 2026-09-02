// Harbor eBook source for kolnovel.com
const BASE = "https://kolnovel.com";
async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType: "text", timeoutMs: 20000 });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + path);
  return harbor.parseHtml(res.body);
}
function abs(url) {
  if (!url) return undefined;
  url = String(url).trim();
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}
function clean(v) { return String(v || "").replace(/\s+/g, " ").trim(); }
function cleanTitle(v) { return clean(v).replace(/\s+(?:kol|كول)$/iu, "").trim(); }
function pageNumber(offset) { return Math.floor(Number(offset || 0) / 20) + 1; }
function seriesId(href) { const m = (abs(href) || "").match(/\/series\/([^/?#]+)\/?(?:[?#].*)?$/i); return m ? decodeURIComponent(m[1]) : ""; }
function seriesPath(id) { return "/series/" + encodeURIComponent(id) + "/"; }
function chapterNumber(text) {
  const t = clean(text);
  const m = t.match(/(?:الفصل|فصل|chapter)\s*([0-9]+(?:\.[0-9]+)?)/iu) || t.match(/(?:^|\s)([0-9]+(?:\.[0-9]+)?)(?:\s|$)/);
  return m ? m[1] : undefined;
}
function firstText(doc, selectors) {
  for (const selector of selectors) {
    const node = doc.querySelector(selector);
    const text = clean(node?.text());
    if (text) return text;
  }
  return "";
}
function imageUrl(node) {
  if (!node) return undefined;
  const img = node.querySelector("img") || node;
  if (!img) return undefined;
  const attrs = ["data-src", "data-lazy-src", "data-original", "data-image", "data-url", "data-original-src", "src", "data-srcset", "srcset"];
  for (const attr of attrs) {
    const value = img.attr(attr);
    if (value) return abs(String(value).split(",")[0].trim().split(" ")[0]);
  }
  return undefined;
}
function imageFrom(node) {
  if (!node) return undefined;
  const url = imageUrl(node);
  if (url) return url;
  const link = node.querySelector("a[href*='/series/']");
  if (link) return abs(link.attr("data-src") || link.attr("data-image") || link.attr("data-cover") || link.attr("data-thumbnail"));
  return undefined;
}
function cardToSummary(node) {
  const link = node.querySelector("a[href*='/series/']");
  if (!link) return null;
  const href = link.attr("href") || "";
  const id = seriesId(href);
  if (!id) return null;
  const rawTitle = clean(link.attr("title") || firstText(node, ["h2", "h3", "h4"]) || link.text());
  const title = cleanTitle(rawTitle);
  if (!title) return null;
  return { id, title, cover: imageFrom(node), siteUrl: abs(href), isFanMade: false };
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
      const title = cleanTitle(link.attr("title") || link.text());
      if (!title) continue;
      seen[id] = true;
      results.push({ id, title, cover: imageFrom(link), siteUrl: abs(link.attr("href")), isFanMade: false });
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
function extractChapters(doc) {
  const chapters = [], seen = {};
  const links = doc.querySelectorAll("a[href*='shaag']");
  for (const a of links) {
    const href = String(a.attr("href") || "").trim();
    const title = clean(a.text());
    if (!href || !title) continue;
    const absolute = abs(href);
    if (!absolute || absolute.toLowerCase().indexOf(BASE + "/shaag") !== 0) continue;
    const key = absolute.replace(/\/$/, "");
    if (seen[key]) continue;
    seen[key] = true;
    chapters.push({
      id: key.replace(/^https?:\/\/kolnovel\.com\/?/i, ""),
      chapter: chapterNumber(title),
      title: title,
      position: chapters.length
    });
  }
  return chapters;
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
    const title = cleanTitle(firstText(doc, ["h1", ".summary_content h1", ".series-title", ".book-title"]) || id);
    if (!title) return null;
    const coverNode = doc.querySelector("img.wp-post-image, .series-cover img, .book-cover img, .summary_image img, .summary_image, .series-thumb img");
    const author = firstText(doc, [".author a", ".author-content a", ".author"]);
    const yearText = firstText(doc, [".release-year", ".year"]);
    const year = Number.parseInt(yearText, 10);
    const genres = [];
    for (const node of doc.querySelectorAll("a[href*='/genre/']")) {
      const g = clean(node.text());
      if (g && genres.indexOf(g) < 0) genres.push(g);
    }
    const chapterList = extractChapters(doc);
    let maxChapter;
    for (const item of chapterList) {
      const n = Number.parseFloat(item.chapter || "");
      if (Number.isFinite(n) && (maxChapter === undefined || n > maxChapter)) maxChapter = n;
    }
    const bodyText = clean(doc.body?.text() || "").toLowerCase();
    let status;
    if (/completed|مكتملة|مكتمل/.test(bodyText)) status = "completed";
    else if (/hiatus|متوقفة|متوقف/.test(bodyText)) status = "hiatus";
    else if (/ongoing|مستمرة|مستمر/.test(bodyText)) status = "ongoing";
    return {
      id, title,
      altTitle: firstText(doc, [".alternative", ".alt-title", ".series-alternative"]) || undefined,
      cover: imageUrl(coverNode),
      description: firstText(doc, [".description", ".summary__content", ".series-description", ".desc", ".summary_content .summary__content"]) || undefined,
      status, author: author || undefined,
      year: Number.isFinite(year) ? year : undefined,
      genres: genres.length ? genres : undefined,
      chapters: maxChapter !== undefined ? maxChapter : (chapterList.length ? chapterList.length : undefined),
      siteUrl: BASE + seriesPath(id), isFanMade: false
    };
  },
  async chapters(id) {
    const doc = await getDoc(seriesPath(id));
    return extractChapters(doc);
  },
  async content(chapterId) {
    const path = String(chapterId || "").replace(/^https?:\/\/kolnovel\.com\/?/i, "").replace(/^\/+/, "");
    if (!path) return "";
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
