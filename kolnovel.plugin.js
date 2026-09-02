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

function clean(value) { return (value || "").replace(/\s+/g, " ").trim(); }
function cleanTitle(value) { return clean(value).replace(/\s+(?:kol|كول)$/iu, "").trim(); }
function pageNumber(offset) { return Math.floor(offset / 20) + 1; }

function seriesId(href) {
  const value = abs(href) || "";
  const match = value.match(/\/series\/([^/?#]+)\/?(?:[?#].*)?$/i);
  return match ? decodeURIComponent(match[1]) : "";
}
function seriesPath(id) { return "/series/" + encodeURIComponent(id) + "/"; }
function chapterNumber(text) {
  const m = clean(text).match(/(?:الفصل|chapter)\s*([0-9]+(?:\.[0-9]+)?)/iu);
  return m ? m[1] : undefined;
}
function statusFromText(value) {
  const text = clean(value).toLowerCase();
  if (text.includes("completed")) return "completed";
  if (text.includes("hiatus")) return "hiatus";
  if (text.includes("ongoing")) return "ongoing";
  return undefined;
}

function imageFrom(node) {
  const img = node?.querySelector("img");
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
  return {
    id,
    title: cleanTitle(rawTitle),
    cover: imageFrom(node),
    siteUrl: abs(href),
    isFanMade: /(?:fan[ -]?fiction|fanfic|فان\s*فيكشن|فانفيك)/iu.test(rawTitle),
  };
}

function mapSeriesResults(doc) {
  const results = [];
  const seen = {};
  const containers = doc.querySelectorAll("article, .page-item-detail, .c-tabs-item__content, .item-summary, .series-item, li");
  for (const node of containers) {
    const item = cardToSummary(node);
    if (!item || seen[item.id]) continue;
    seen[item.id] = true;
    results.push(item);
  }
  if (!results.length) {
    for (const link of doc.querySelectorAll("a[href*='/series/']")) {
      const id = seriesId(link.attr("href") || "");
      if (!id || seen[id]) continue;
      seen[id] = true;
      results.push({ id, title: cleanTitle(link.attr("title") || link.text()), siteUrl: abs(link.attr("href")), isFanMade: false });
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
  else if (tagId?.startsWith("genre:")) genre = tagId.slice(6);
  return { order, status, genre };
}
function browsePath(tagId, page) {
  const { order, status, genre } = browseParams(tagId);
  if (genre) return "/genre/" + encodeURIComponent(genre) + "/?page=" + page;
  return "/series/?order=" + encodeURIComponent(order) + "&page=" + page + "&status=" + encodeURIComponent(status) + "&type=";
}

const plugin = {
  id: "kolnovel",
  name: "KolNovel",

  async popular(offset, tagId) {
    return mapSeriesResults(await getDoc(browsePath(tagId, pageNumber(offset))));
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
    const cover = doc.querySelector("img.wp-post-image, .series-cover img, .book-cover img, .summary_image img, article img");
    const author = clean(doc.querySelector(".author a, .author-content a, .author")?.text());
    const yearText = clean(doc.querySelector(".release-year, .year")?.text());
    const year = Number.parseInt(yearText, 10);
    const genres = doc.querySelectorAll("a[href*='/genre/']").map((node) => clean(node.text())).filter(Boolean);
    let maxChapter;
    for (const a of doc.querySelectorAll("a[href*='shaag']")) {
      const n = Number.parseFloat(chapterNumber(a.text()) || "");
      if (Number.isFinite(n) && (maxChapter === undefined || n > maxChapter)) maxChapter = n;
    }
    return {
      id, title,
      altTitle: clean(doc.querySelector(".alternative, .alt-title, .series-alternative")?.text()) || undefined,
      cover: abs(cover?.attr("data-src") || cover?.attr("data-lazy-src") || cover?.attr("data-original") || cover?.attr("src")),
      description: clean(doc.querySelector(".description, .summary, .series-description, .desc")?.text()) || undefined,
      status: statusFromText(doc.querySelector("body")?.text() || ""),
      author: author || undefined,
      year: Number.isFinite(year) ? year : undefined,
      genres: genres.length ? genres : undefined,
      chapters: maxChapter !== undefined ? maxChapter : undefined,
      siteUrl: BASE + seriesPath(id),
      isFanMade: /(?:fan[ -]?fiction|fanfic|فان\s*فيكشن|فانفيك)/iu.test(title),
    };
  },

  async chapters(id) {
    const doc = await getDoc(seriesPath(id));
    const links = doc.querySelectorAll("a[href*='shaag']");
    const chapters = [], seen = {};
    for (const a of links) {
      const href = a.attr("href") || "";
      const absolute = abs(href);
      const title = clean(a.text());
      if (!absolute || !/^https?:\/\/kolnovel\.com\/shaag/i.test(absolute)) continue;
      if (!title || seen[absolute]) continue;
      if (!/(?:الفصل|chapter)\s*[0-9]+/iu.test(title) && !/فصل\s*[0-9]+/iu.test(title)) continue;
      seen[absolute] = true;
      chapters.push({ id: absolute.replace(BASE + "/", "").replace(/\/$/, ""), chapter: chapterNumber(title), title, position: chapters.length });
    }
    return chapters;
  },

  async content(chapterId) {
    const path = "/" + chapterId.replace(/^\/+/, "").replace(/\/$/, "") + "/";
    const doc = await getDoc(path);
    const container = doc.querySelector(".reading-content, .chapter-content, .text-left, .reading-area, .entry-content");
    if (!container) return "";
    const blocks = container.querySelectorAll("p, blockquote").map((node) => clean(node.text())).filter(Boolean);
    return blocks.length ? blocks.join("\n\n") : clean(container.text());
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
      { id: "sort:rating", name: "التقييم", group: "الترتيب" },
    ];
  },
};
