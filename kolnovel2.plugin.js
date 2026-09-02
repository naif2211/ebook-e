// KolNovel 2 - Harbor eBook Source
// https://kolnovel.com

const BASE = "https://kolnovel.com";

async function getDoc(path) {
  const url = /^https?:\/\//i.test(path)
    ? path
    : BASE + (path.startsWith("/") ? path : "/" + path);

  const res = await harbor.http(url, { responseType: "text" });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return harbor.parseHtml(res.body);
}

function abs(url) {
  if (!url) return undefined;
  url = url.trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function clean(value) {
  return (value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numberFromText(value) {
  if (!value) return undefined;
  const match = String(value).match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : undefined;
}

function extractChapterNumber(text) {
  if (!text) return undefined;
  const match = String(text).match(/(?:الفصل|chapter|ch\.?)\s*[:#-]?\s*(\d+(?:\.\d+)?)/iu);
  if (match) return match[1];
  const numbers = String(text).match(/\d+(?:\.\d+)?/g);
  return numbers?.length ? numbers[numbers.length - 1] : undefined;
}

function extractSeriesId(href) {
  if (!href) return "";
  let value = href.trim();
  try {
    if (/^https?:\/\//i.test(value)) value = new URL(value).pathname;
  } catch (_) {}
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

function cardToSummary(el) {
  if (!el) return null;
  const link = el.querySelector("a[href*='/series/']") || el.querySelector("a");
  if (!link) return null;
  const href = link.attr("href") || "";
  if (!href) return null;

  const img = el.querySelector("img");
  const title = clean(
    link.attr("title") ||
    img?.attr("alt") ||
    el.querySelector("h2")?.text() ||
    el.querySelector("h3")?.text() ||
    el.querySelector(".title")?.text() ||
    link.text()
  );
  if (!title) return null;

  const scoreText = clean(
    el.querySelector(".rating")?.text() ||
    el.querySelector("[class*='rating']")?.text()
  );

  return {
    id: extractSeriesId(href),
    title,
    cover: abs(
      img?.attr("data-src") ||
      img?.attr("data-lazy-src") ||
      img?.attr("src")
    ),
    score: numberFromText(scoreText),
    genres: el.querySelectorAll("a[href*='/genre/']")
      .map((node) => clean(node.text()))
      .filter(Boolean),
  };
}

function findSeriesCards(doc) {
  const result = [];
  const seen = new Set();

  for (const link of doc.querySelectorAll("a[href*='/series/']")) {
    const href = link.attr("href") || "";
    const id = extractSeriesId(href);
    if (!id || seen.has(id)) continue;

    const parent =
      link.closest("article") ||
      link.closest(".item") ||
      link.closest(".col") ||
      link.parentElement?.parentElement ||
      link;

    const item = cardToSummary(parent);
    if (!item) continue;

    seen.add(id);
    result.push(item);
  }

  return result;
}

const plugin = {
  id: "kolnovel2",
  name: "KolNovel 2",

  async popular(offset) {
    const page = Math.floor(offset / 48) + 1;
    const doc = await getDoc(page > 1 ? "/series/?page=" + page : "/series/");
    return findSeriesCards(doc);
  },

  async search(query, offset) {
    const page = Math.floor(offset / 48) + 1;
    const params = new URLSearchParams();
    params.set("s", query);
    if (page > 1) params.set("page", String(page));
    const doc = await getDoc("/?" + params.toString());
    return findSeriesCards(doc);
  },

  async detail(id) {
    const path = id.startsWith("series/") ? "/" + id : "/series/" + id.replace(/^\/+|\/+$/g, "") + "/";
    const doc = await getDoc(path);
    const title = clean(doc.querySelector("h1")?.text() || doc.querySelector(".entry-title")?.text());
    if (!title) return null;

    const cover = doc.querySelector("img[data-src]") || doc.querySelector("img[src]");
    const description = clean(
      doc.querySelector(".summary")?.text() ||
      doc.querySelector(".description")?.text() ||
      doc.querySelector(".desc")?.text()
    );
    const author = clean(
      doc.querySelector("a[href*='/author/']")?.text() ||
      doc.querySelector(".author")?.text()
    );

    return {
      id,
      title,
      cover: abs(cover?.attr("data-src") || cover?.attr("data-lazy-src") || cover?.attr("src")),
      description,
      author,
      genres: doc.querySelectorAll("a[href*='/genre/']")
        .map((node) => clean(node.text()))
        .filter(Boolean),
      score: numberFromText(
        doc.querySelector(".rating")?.text() ||
        doc.querySelector("[class*='rating']")?.text()
      ),
    };
  },

  async chapters(id) {
    const path = id.startsWith("series/") ? "/" + id : "/series/" + id.replace(/^\/+|\/+$/g, "") + "/";
    const doc = await getDoc(path);
    const chapters = [];
    const seen = new Set();

    for (const a of doc.querySelectorAll("a[href]")) {
      const href = a.attr("href") || "";
      if (!href) continue;

      const isChapter =
        /\/shaag24[^/]*-\d+\/?$/i.test(href) ||
        /\/chapter[-_/]?\d+/i.test(href);
      if (!isChapter) continue;

      const cleanHref = href.split("#")[0];
      if (seen.has(cleanHref)) continue;

      const title = clean(a.text());
      if (!title) continue;

      const parent = a.closest("li") || a.parentElement;
      const time = parent?.querySelector("time[datetime]") || parent?.querySelector("[datetime]");

      seen.add(cleanHref);
      chapters.push({
        id: cleanHref.replace(/^\/+/, ""),
        chapter: a.attr("data-number") || a.attr("data-chapter") || extractChapterNumber(title),
        position: chapters.length,
        title,
        volume: a.attr("data-volume") || a.attr("data-vol") || undefined,
        pages: 0,
        language: "ar",
        publishAt: time?.attr("datetime") || undefined,
      });
    }

    chapters.sort((a, b) => {
      const na = Number(a.chapter);
      const nb = Number(b.chapter);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      if (Number.isFinite(na)) return -1;
      if (Number.isFinite(nb)) return 1;
      return a.position - b.position;
    });

    return chapters.map((chapter, index) => ({ ...chapter, position: index }));
  },

  async content(chapterId) {
    const doc = await getDoc("/" + chapterId.replace(/^\/+/, ""));
    const root =
      doc.querySelector(".entry-content") ||
      doc.querySelector(".chapter-content") ||
      doc.querySelector(".reading-content") ||
      doc.querySelector(".single-content") ||
      doc.querySelector("article");

    if (!root) return "";

    const paragraphs = root.querySelectorAll("p, blockquote")
      .map((node) => clean(node.text()))
      .filter(Boolean);

    return paragraphs.length ? paragraphs.join("\n\n") : clean(root.text());
  },

  async tags() {
    return [
      { id: "status:ongoing", name: "Ongoing", group: "Status" },
      { id: "status:completed", name: "Completed", group: "Status" },
      { id: "status:hiatus", name: "Hiatus", group: "Status" },
      { id: "sort:popular", name: "Popular", group: "Sort" },
      { id: "sort:rating", name: "Rating", group: "Sort" },
      { id: "sort:updated", name: "Updated", group: "Sort" },
    ];
  },
};
