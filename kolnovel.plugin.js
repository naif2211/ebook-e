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
function imageFrom(node) {
  const img = node && node.querySelector("img");
  if (!img) return undefined;
  return abs(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("data-image") || img.attr("src"));
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
    const cover = doc.querySelector("img.wp-post-image, .series-cover img, .book-cover img, .summary_image img, article img");
    return { id, title, cover: abs(cover?.attr("data-src") || cover?.attr("data-lazy-src") || cover?.attr("data-original") || cover?.attr("src")), description: clean(doc.querySelector(".description, .summary, .series-description, .desc")?.text()) || undefined, siteUrl: BASE + seriesPath(id), isFanMade: false };
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
    const selectors = [
      ".reading-content",
      ".chapter-content",
      ".reading-area",
      ".text-left"
    ];
    for (const selector of selectors) {
      const container = doc.querySelector(selector);
      if (!container) continue;
      const text = container.text();
      if (text && text.trim()) return text.trim();
    }
    return "";
  },
  async tags() {
    return [
      { id: "status:ongoing", name: "Ongoing", group: "الحالة" },
      { id: "status:completed", name: "Completed", group: "الحالة" },
      { id: "status:hiatus", name: "Hiatus", group: "الحالة" },
      { id: "sort:popular", name: "الرائجة", group: "الترتيب" },
      { id: "sort:rating", name: "التقييم", group: "الترتيب" }
    ];
  }
};
