// Harbor eBook source plugin for Novels Paradise (np-light)
// Base: https://novelsparadise.site/np-light

const BASE = "https://novelsparadise.site/np-light";
const PAGE_SIZE = 20;

async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType: "text" });
  if (!res.ok) throw new Error("http " + res.status + " for " + path);
  return harbor.parseHtml(res.body);
}

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return "https://novelsparadise.site" + url;
  return BASE + "/" + url;
}

function cleanTitle(value) {
  return (value || "")
    .replace(/[^\p{L}\p{N}'’:\-،.!?؟]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStatus(raw) {
  const text = (raw || "").trim().toLowerCase();
  if (!text) return undefined;
  if (text.includes("مكتمل") || text.includes("completed")) return "completed";
  if (text.includes("متوقف") || text.includes("hiatus")) return "hiatus";
  if (text.includes("مستمر") || text.includes("ongoing")) return "ongoing";
  return text;
}

function extractNumber(text) {
  if (!text) return undefined;
  const match = String(text).replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : undefined;
}

function extractSeriesId(href) {
  if (!href) return "";
  const match = href.match(/\/series\/([^/?#]+)/i);
  return match ? match[1].replace(/\/$/, "") : "";
}

function browseQuery(tagId) {
  const params = new URLSearchParams();
  if (tagId === "status:ongoing") params.set("status", "Ongoing");
  if (tagId === "status:completed") params.set("status", "Completed");
  if (tagId === "status:hiatus") params.set("status", "Hiatus");
  if (tagId === "sort:popular") params.set("sort", "views");
  if (tagId === "sort:latest") params.set("sort", "latest");
  if (tagId === "sort:chapters") params.set("sort", "chapters");
  if (tagId === "sort:rating") params.set("sort", "rating");
  const query = params.toString();
  return query ? "&" + query : "";
}

function cardToSummary(el) {
  const link = el.querySelector("a[href*='/series/']") || (el.attr("href") ? el : null);
  if (!link) return null;

  const href = link.attr("href") || "";
  const id = extractSeriesId(href);
  if (!id) return null;

  const img = el.querySelector("img");
  const rawTitle = (
    el.querySelector("h2, h3, .title, .series-title, .novel-title")?.text() ||
    link.attr("title") ||
    link.text() ||
    ""
  ).trim();

  const statusText = el.querySelector(".status, .badge, [class*='status']")?.text();
  const chaptersText = el.querySelector(".chapters, [class*='chapter']")?.text();
  const ratingText = el.querySelector(".rating, .score, [class*='rating']")?.text();
  const genres = el
    .querySelectorAll("a[href*='/genre/'], .genre, .tag")
    .map((n) => n.text().trim())
    .filter(Boolean);

  return {
    id,
    title: cleanTitle(rawTitle) || id,
    cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("src")),
    status: normalizeStatus(statusText),
    genres,
    chapters: extractNumber(chaptersText),
    score: extractNumber(ratingText),
    isFanMade: /(?:fan[ -]?made|fan edition|نسخة\s*الفان)/iu.test(rawTitle),
  };
}

function parseCardList(doc) {
  const cards = doc.querySelectorAll(
    ".series-card, .novel-card, .book-card, .grid > article, .grid > div, .series-list > div"
  );
  const seen = new Set();
  const items = [];

  for (const el of cards) {
    const item = cardToSummary(el);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items;
}

const plugin = {
  id: "novels-paradise-light",
  name: "Novels Paradise (NP Light)",

  async popular(offset, tagId) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const filters = browseQuery(tagId);
    const doc = await getDoc("/series-list/?page=" + page + filters);
    return parseCardList(doc);
  },

  async search(query, offset, tagId) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const filters = browseQuery(tagId);
    const doc = await getDoc(
      "/series-list/?search=" + encodeURIComponent(query) + "&page=" + page + filters
    );
    return parseCardList(doc);
  },

  async detail(id) {
    const doc = await getDoc("/series/" + encodeURIComponent(id) + "/");
    const root = doc.querySelector("main, .series-detail, .novel-detail, body");
    if (!root) return null;

    const title = cleanTitle(root.querySelector("h1")?.text() || id);
    const coverImg = root.querySelector(
      ".series-cover img, .novel-cover img, img.poster, main img"
    );
    const description = root
      .querySelectorAll(".summary p, .description p, .synopsis p, [class*='desc'] p")
      .map((p) => p.text().trim())
      .filter((t) => t && !/^advertise here\.?$/i.test(t))
      .join("\n\n");

    const statusText = root.querySelector(".status, [class*='status']")?.text();
    const authorText = root.querySelector(".author, [class*='author']")?.text()?.trim();
    const genres = root
      .querySelectorAll("a[href*='/genre/']")
      .map((a) => a.text().trim())
      .filter(Boolean);

    const chaptersText = root.querySelector("[class*='chapter-count'], .chapters-count")?.text();
    const ratingText = root.querySelector(".rating, .score, [class*='rating']")?.text();

    return {
      id,
      title,
      cover: abs(
        coverImg?.attr("data-src") ||
          coverImg?.attr("data-lazy-src") ||
          coverImg?.attr("src")
      ),
      description: description || undefined,
      status: normalizeStatus(statusText),
      author: authorText || undefined,
      chapters: extractNumber(chaptersText),
      genres: [...new Set(genres)],
      score: extractNumber(ratingText),
    };
  },

  async chapters(id) {
    const doc = await getDoc("/series/" + encodeURIComponent(id) + "/");
    const links = doc.querySelectorAll(
      "a[href*='/series/'][href*='/chapter-'], .chapter-list a, .chapters-list a"
    );

    // Site lists chapters newest-first; reverse so position 0 is the first chapter.
    const ordered = [...links].reverse();
    const seen = new Set();
    const results = [];

    for (const a of ordered) {
      const href = a.attr("href") || "";
      const pathMatch = href.match(/\/np-light\/(.+)/i);
      const chapterId = (pathMatch ? pathMatch[1] : href)
        .replace(/^https?:\/\/[^/]+/i, "")
        .replace(/^\//, "")
        .replace(/\/$/, "");

      if (!chapterId || seen.has(chapterId)) continue;
      seen.add(chapterId);

      const rawText = a.text().replace(/\s+/g, " ").trim();
      const numMatch =
        chapterId.match(/chapter-(\d+(?:\.\d+)?)/i) || rawText.match(/^(\d+(?:\.\d+)?)/);
      const dateMatch = rawText.match(/\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}:\d{2})?/);

      const cleanName = rawText
        .replace(/\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}:\d{2})?/g, "")
        .trim();

      results.push({
        id: chapterId,
        chapter: numMatch ? numMatch[1] : undefined,
        position: results.length,
        title: cleanName || undefined,
        pages: 0,
        language: "ar",
        publishAt: dateMatch ? dateMatch[0] : undefined,
      });
    }

    return results;
  },

  async content(chapterId) {
    const doc = await getDoc("/" + chapterId + "/");
    const blocks = doc.querySelectorAll(
      ".chapter-content p, .chapter-content blockquote, .reading-content p, article p"
    );

    // Keep exact DOM order for Arabic/RTL prose; strip ad placeholders only.
    return blocks
      .map((node) => node.text().trim())
      .filter((text) => text && !/^advertise here\.?$/i.test(text))
      .join("\n\n");
  },

  async tags() {
    return [
      { id: "status:ongoing", name: "مستمرة", group: "Status" },
      { id: "status:completed", name: "مكتملة", group: "Status" },
      { id: "status:hiatus", name: "متوقفة", group: "Status" },
      { id: "sort:popular", name: "الأكثر مشاهدة", group: "Sort" },
      { id: "sort:latest", name: "آخر التحديثات", group: "Sort" },
      { id: "sort:chapters", name: "عدد الفصول", group: "Sort" },
      { id: "sort:rating", name: "التقييم", group: "Sort" },
    ];
  },
};
