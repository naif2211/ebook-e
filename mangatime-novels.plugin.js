// Harbor eBook source plugin for MangaTime Novels
// https://mangatime.org
// V2.2: support both singular and plural novel routes; prefer the supplied /novels catalogue.

const BASE = "https://mangatime.org";
const PAGE_SIZE = 24;

async function getDoc(path) {
  const url = /^https?:\/\//i.test(path) ? path : BASE + (path.startsWith("/") ? path : "/" + path);
  const res = await harbor.http(url, { responseType: "text" });
  if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "network error") + " for " + path);
  return harbor.parseHtml(res.body);
}

function clean(value) {
  return value == null ? "" : String(value).replace(/\s+/g, " ").trim();
}

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch (_) { return value; }
}

function abs(value) {
  if (!value) return undefined;
  const url = String(value).trim();
  if (!url || /^data:/i.test(url)) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function cleanPath(href) {
  return String(href || "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .split("#")[0]
    .split("?")[0]
    .replace(/\/+$/, "");
}

function novelIdFromHref(href) {
  const match = cleanPath(href).match(/^\/novels?\/([^/]+)$/i);
  return match ? safeDecode(match[1]) : "";
}

function novelPath(id) {
  return "/novel/" + encodeURIComponent(id);
}

function normalizeStatus(value) {
  const text = clean(value).toLowerCase();
  if (!text) return undefined;
  if (text.includes("مكتمل") || text.includes("completed")) return "completed";
  if (text.includes("متوقف") || text.includes("hiatus")) return "hiatus";
  if (text.includes("مستمر") || text.includes("ongoing")) return "ongoing";
  return undefined;
}

function numberFrom(value) {
  const match = clean(value).replace(/[,،]/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

function imageFrom(node) {
  if (!node) return undefined;
  return abs(
    node.attr("data-src") ||
    node.attr("data-lazy-src") ||
    node.attr("data-original") ||
    node.attr("src") ||
    node.attr("data-srcset") ||
    node.attr("srcset")?.split(/\s+/)[0]
  );
}

function browseQuery(tagId) {
  const params = new URLSearchParams();
  params.set("type", "novel");
  if (tagId === "status:ongoing") params.set("status", "ongoing");
  if (tagId === "status:completed") params.set("status", "completed");
  if (tagId === "status:hiatus") params.set("status", "hiatus");
  if (tagId === "sort:popular") params.set("sort", "popular");
  if (tagId === "sort:latest") params.set("sort", "latest");
  if (tagId === "sort:rating") params.set("sort", "rating");
  if (tagId === "sort:chapters") params.set("sort", "chapters");
  return params.toString();
}

function cardToSummary(link) {
  const href = link.attr("href") || "";
  const id = novelIdFromHref(href);
  if (!id) return null;

  const image = link.querySelector("img");
  const imageTitle = image?.attr("alt") || image?.attr("title") || "";
  const title = clean(
    link.attr("title") ||
    link.querySelector("h2, h3, .title, .novel-title, .post-title")?.text() ||
    link.text() ||
    imageTitle
  );
  if (!title) return null;

  const cardText = clean(link.text());
  return {
    id,
    title,
    cover: imageFrom(image),
    status: normalizeStatus(cardText),
    chapters: numberFrom(cardText.match(/[\d,،]+\s*(?:فصل|فصول|chapter)/i)?.[0]),
    originalLanguage: "ar",
    isFanMade: false
  };
}

function parseNovelCards(doc) {
  const links = doc.querySelectorAll("a[href*='/novel/'], a[href*='/novels/']");
  const seen = new Set();
  const items = [];
  for (const link of links) {
    const item = cardToSummary(link);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items;
}

async function listingPage(page, tagId, searchQuery) {
  const query = new URLSearchParams(browseQuery(tagId));
  query.set("page", String(page));
  if (searchQuery) query.set("q", searchQuery);

  // The current MangaTime catalogue is /browse; /novels is kept as a legacy fallback.
  const legacy = new URLSearchParams();
  legacy.set("page", String(page));
  if (searchQuery) legacy.set("search", searchQuery);
  const candidates = [
    "/novels?" + legacy.toString(),
    "/browse?" + query.toString(),
    "/browse?type=novels&page=" + page + (searchQuery ? "&q=" + encodeURIComponent(searchQuery) : "")
  ];

  let lastError;
  for (const path of candidates) {
    try {
      const doc = await getDoc(path);
      const items = parseNovelCards(doc);
      if (items.length) return items;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return [];
}

function chapterNumber(href, label) {
  const path = cleanPath(href);
  const fromPath = path.match(/\/chapter-(\d+(?:\.\d+)?)(?:-[^/]*)?$/i);
  if (fromPath) return fromPath[1];
  const fromText = clean(label).match(/(?:الفصل|chapter)\s*#?\s*(\d+(?:\.\d+)?)/i);
  return fromText ? fromText[1] : undefined;
}

function chapterTitle(label, number) {
  const text = clean(label);
  if (!text) return number ? "الفصل " + number : undefined;
  return text.replace(/^\s*(?:الفصل|chapter)\s*#?\s*\d+(?:\.\d+)?\s*[-–—:·.]?\s*/i, "").trim() || text;
}

function parseChapters(doc, id) {
  const prefixes = ["/novel/" + id + "/", "/novels/" + id + "/"];
  const found = [];
  const seen = new Set();

  for (const link of doc.querySelectorAll("a[href*='/chapter-']")) {
    const path = cleanPath(link.attr("href") || "");
    if (!prefixes.some((prefix) => path.startsWith(prefix))) continue;
    const number = chapterNumber(path, link.text());
    if (!number || seen.has(path)) continue;
    seen.add(path);
    found.push({
      id: path.replace(/^\/+/, ""),
      chapter: number,
      title: chapterTitle(link.text(), number),
      publishAt: link.querySelector("time")?.attr("datetime") || undefined
    });
  }

  found.sort((a, b) => Number(a.chapter) - Number(b.chapter));
  return found.map((item, index) => ({
    id: item.id,
    chapter: item.chapter,
    position: index,
    title: item.title,
    pages: 0,
    language: "ar",
    publishAt: item.publishAt
  }));
}

function getTextBlocks(doc) {
  const selectors = [
    ".chapter-content p",
    ".reading-content p",
    ".reader-content p",
    ".prose p",
    "article p",
    "main p"
  ];

  for (const selector of selectors) {
    const nodes = doc.querySelectorAll(selector);
    const lines = nodes.map((node) => clean(node.text())).filter(Boolean);
    if (lines.length) return lines;
  }

  const containers = [".chapter-content", ".reading-content", ".reader-content", "article", "main"];
  for (const selector of containers) {
    const node = doc.querySelector(selector);
    const text = node ? clean(node.text()) : "";
    if (text.length > 300) return [text];
  }
  return [];
}

const plugin = {
  id: "mangatime-novels",
  name: "MangaTime Novels",

  async popular(offset, tagId) {
    const page = Math.floor(Math.max(0, Number(offset) || 0) / PAGE_SIZE) + 1;
    return listingPage(page, tagId);
  },

  async search(query, offset, tagId) {
    const page = Math.floor(Math.max(0, Number(offset) || 0) / PAGE_SIZE) + 1;
    const q = clean(query);
    if (!q) return listingPage(page, tagId);
    const direct = await listingPage(page, tagId, q);
    if (direct.length) return direct;

    // Fallback for catalogue builds that ignore q: search titles on the current result page.
    const all = await listingPage(page, tagId);
    const needle = q.toLocaleLowerCase();
    return all.filter((item) => item.title.toLocaleLowerCase().includes(needle));
  },

  async detail(id) {
    let doc;
    try { doc = await getDoc(novelPath(id)); }
    catch (_) { doc = await getDoc("/novels/" + encodeURIComponent(id)); }
    const root = doc.querySelector("main, article, .novel-detail, .series-detail") || doc;
    const title = clean(root.querySelector("h1")?.text() || doc.querySelector("h1")?.text() || id);
    if (!title) return null;

    const metaDescription =
      doc.querySelector("meta[name='description']")?.attr("content") ||
      doc.querySelector("meta[property='og:description']")?.attr("content");
    const metaCover = doc.querySelector("meta[property='og:image']")?.attr("content");
    const coverNode = root.querySelector(".novel-cover img, .series-cover img, img[alt], img");
    const fullText = clean(root.text());
    const countMatch = fullText.match(/([\d,،]+)\s*(?:فصلًا|فصلاً|فصولًا|فصل|فصول)/i);
    const author = root.querySelector("a[href*='/author/'], a[href*='/writer/'], .author")?.text();
    const descriptionNodes = root.querySelectorAll(
      ".summary p, .description p, .synopsis p, [class*='description'] p"
    );
    const description = descriptionNodes.map((p) => clean(p.text())).filter(Boolean).join("\n\n");
    const genres = root.querySelectorAll("a[href*='/genre/'], a[href*='/tag/']")
      .map((a) => clean(a.text())).filter(Boolean);

    return {
      id,
      title,
      cover: abs(metaCover) || imageFrom(coverNode),
      description: clean(description) || clean(metaDescription) || undefined,
      status: normalizeStatus(fullText),
      author: clean(author) || undefined,
      chapters: countMatch ? numberFrom(countMatch[1]) : undefined,
      genres: [...new Set(genres)],
      originalLanguage: "ar",
      isFanMade: false
    };
  },

  async chapters(id) {
    let doc;
    try { doc = await getDoc(novelPath(id)); }
    catch (_) { doc = await getDoc("/novels/" + encodeURIComponent(id)); }
    return parseChapters(doc, id);
  },

  async content(chapterId) {
    const path = "/" + String(chapterId || "").replace(/^\/+/, "");
    const doc = await getDoc(path);
    const lines = getTextBlocks(doc)
      .map((line) => line.replace(/\u00a0/g, " ").trim())
      .filter((line) => line && !/^(?:الرئيسية|الروايات|استكشف|التعليقات|اترك تعليقًا)$/i.test(line));
    if (!lines.length) throw new Error("لم يتم العثور على نص الفصل في صفحة MangaTime");
    return lines.join("\n\n");
  },

  async tags() {
    return [
      { id: "status:ongoing", name: "مستمرة", group: "الحالة" },
      { id: "status:completed", name: "مكتملة", group: "الحالة" },
      { id: "status:hiatus", name: "متوقفة", group: "الحالة" },
      { id: "sort:popular", name: "الأكثر قراءة", group: "الترتيب" },
      { id: "sort:latest", name: "آخر التحديثات", group: "الترتيب" },
      { id: "sort:rating", name: "الأعلى تقييمًا", group: "الترتيب" },
      { id: "sort:chapters", name: "عدد الفصول", group: "الترتيب" }
    ];
  }
};

return plugin;
