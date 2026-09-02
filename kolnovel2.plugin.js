// KolNovel 2 - Harbor eBook Source
// https://kolnovel.com
// Server-rendered HTML only. No DOM/fetch/storage APIs are used.

const BASE = "https://kolnovel.com";
const PAGE_SIZE = 20;

async function getDoc(path) {
  const url = /^https?:\/\//i.test(path)
    ? path
    : BASE + (path.startsWith("/") ? path : "/" + path);

  const res = await harbor.http(url, {
    responseType: "text",
    timeoutMs: 20000,
  });

  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return harbor.parseHtml(res.body);
}

function abs(url) {
  if (!url) return undefined;
  const value = String(url).trim();
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return "https:" + value;
  if (value.startsWith("/")) return BASE + value;
  return BASE + "/" + value;
}

function clean(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function seriesId(href) {
  const url = abs(href);
  if (!url) return "";

  const match = url.match(/\/series\/([^/?#]+)\/?(?:[?#].*)?$/i);
  if (!match) return "";

  try {
    return decodeURIComponent(match[1]);
  } catch (_) {
    return match[1];
  }
}

function seriesPath(id) {
  return "/series/" + encodeURIComponent(id) + "/";
}

function chapterNumber(text) {
  const value = clean(text);

  let match = value.match(/(?:الفصل|فصل|chapter|ch\.?)[\s:#-]*(\d+(?:\.\d+)?)/iu);
  if (match) return match[1];

  match = value.match(/(?:^|\s)(\d+(?:\.\d+)?)(?:\s|$)/);
  return match ? match[1] : undefined;
}

function cardFromLink(link) {
  if (!link) return null;

  const href = link.attr("href") || "";
  const id = seriesId(href);
  if (!id) return null;

  const img = link.querySelector("img");
  const title = clean(
    link.attr("title") ||
    img?.attr("alt") ||
    link.querySelector("h2")?.text() ||
    link.querySelector("h3")?.text() ||
    link.text()
  );

  if (!title) return null;

  return {
    id,
    title,
    cover: abs(
      img?.attr("data-src") ||
      img?.attr("data-lazy-src") ||
      img?.attr("src")
    ),
    isFanMade: /(?:fan[ -]?fiction|fanfic|فان\s*فيكشن|فانفيك)/iu.test(title),
  };
}

function seriesResults(doc) {
  const results = [];
  const seen = new Set();
  const links = doc.querySelectorAll("a[href*='/series/']");

  for (const link of links) {
    const item = cardFromLink(link);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    results.push(item);
  }

  return results;
}

function pageFromOffset(offset) {
  return Math.floor(Number(offset || 0) / PAGE_SIZE) + 1;
}

const plugin = {
  id: "kolnovel2",
  name: "KolNovel 2",

  async popular(offset, tagId) {
    const page = pageFromOffset(offset);
    const params = new URLSearchParams();

    if (page > 1) params.set("page", String(page));

    if (tagId === "sort:popular") params.set("order", "popular");
    if (tagId === "sort:chapters") params.set("order", "chapters");
    if (tagId === "sort:rating") params.set("order", "rating");
    if (tagId === "status:ongoing") params.set("status", "ongoing");
    if (tagId === "status:completed") params.set("status", "completed");
    if (tagId === "status:hiatus") params.set("status", "hiatus");

    const query = params.toString();
    const doc = await getDoc("/series/" + (query ? "?" + query : ""));
    return seriesResults(doc);
  },

  async search(query, offset, tagId) {
    const page = pageFromOffset(offset);
    const params = new URLSearchParams();

    params.set("search", query);
    if (page > 1) params.set("page", String(page));

    if (tagId === "sort:popular") params.set("order", "popular");
    if (tagId === "sort:chapters") params.set("order", "chapters");
    if (tagId === "sort:rating") params.set("order", "rating");
    if (tagId === "status:ongoing") params.set("status", "ongoing");
    if (tagId === "status:completed") params.set("status", "completed");
    if (tagId === "status:hiatus") params.set("status", "hiatus");

    const doc = await getDoc("/series/?" + params.toString());
    return seriesResults(doc);
  },

  async detail(id) {
    const doc = await getDoc(seriesPath(id));

    const title = clean(
      doc.querySelector("h1")?.text() ||
      doc.querySelector(".entry-title")?.text() ||
      id
    );

    if (!title) return null;

    const cover =
      doc.querySelector("img.wp-post-image") ||
      doc.querySelector(".summary_image img") ||
      doc.querySelector(".series-cover img") ||
      doc.querySelector("img[data-src]") ||
      doc.querySelector("img[src]");

    const description = clean(
      doc.querySelector(".description")?.text() ||
      doc.querySelector(".summary")?.text() ||
      doc.querySelector(".series-description")?.text() ||
      doc.querySelector(".desc")?.text()
    );

    const author = clean(
      doc.querySelector(".author a")?.text() ||
      doc.querySelector(".author-content a")?.text() ||
      doc.querySelector(".author")?.text()
    );

    const genres = doc
      .querySelectorAll(".genres a, .genre a, a[href*='/genre/']")
      .map((node) => clean(node.text()))
      .filter(Boolean);

    let status;
    const bodyText = clean(doc.querySelector("body")?.text() || "");
    if (/completed|مكتملة|مكتمل/iu.test(bodyText)) status = "completed";
    else if (/hiatus|متوقفة|متوقف/iu.test(bodyText)) status = "hiatus";
    else if (/ongoing|مستمرة|مستمر/iu.test(bodyText)) status = "ongoing";

    return {
      id,
      title,
      altTitle: clean(
        doc.querySelector(".alternative")?.text() ||
        doc.querySelector(".alt-title")?.text() ||
        doc.querySelector(".series-alternative")?.text()
      ) || undefined,
      cover: abs(
        cover?.attr("data-src") ||
        cover?.attr("data-lazy-src") ||
        cover?.attr("src")
      ),
      description: description || undefined,
      status,
      author: author || undefined,
      genres: genres.length ? genres : undefined,
      isFanMade: /(?:fan[ -]?fiction|fanfic|فان\s*فيكشن|فانفيك)/iu.test(title),
    };
  },

  async chapters(id) {
    const doc = await getDoc(seriesPath(id));
    const links = doc.querySelectorAll("a[href]");
    const chapters = [];
    const seen = new Set();

    for (const link of links) {
      const href = link.attr("href") || "";
      const absolute = abs(href);
      const title = clean(link.text());

      if (!absolute) continue;
      if (!/^https?:\/\/kolnovel\.com\/shaag/i.test(absolute)) continue;
      if (!title) continue;
      if (seen.has(absolute)) continue;

      const number =
        link.attr("data-number") ||
        link.attr("data-chapter") ||
        chapterNumber(title);

      // Keep only actual chapter links. The numeric suffix in the URL is
      // also accepted because some KolNovel titles don't contain "Chapter".
      if (!number && !/\/shaag[^/]*-\d+\/?(?:[?#].*)?$/i.test(absolute)) continue;

      seen.add(absolute);

      chapters.push({
        id: absolute.replace(/^https?:\/\/kolnovel\.com\//i, "").replace(/\/$/, ""),
        chapter: number,
        position: chapters.length,
        title,
        volume: link.attr("data-volume") || link.attr("data-vol") || undefined,
        pages: 0,
        language: "ar",
      });
    }

    // KolNovel lists newest chapters first. Reverse by source order, then
    // use the explicit chapter number when available. No prose is modified.
    chapters.sort((a, b) => {
      const na = Number(a.chapter);
      const nb = Number(b.chapter);

      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      if (Number.isFinite(na)) return -1;
      if (Number.isFinite(nb)) return 1;
      return a.position - b.position;
    });

    return chapters.map((item, index) => ({
      ...item,
      position: index,
    }));
  },

  async content(chapterId) {
    const path = "/" + String(chapterId).replace(/^\/+/, "").replace(/\/$/, "") + "/";
    const doc = await getDoc(path);

    const root =
      doc.querySelector(".entry-content") ||
      doc.querySelector(".reading-content") ||
      doc.querySelector(".chapter-content") ||
      doc.querySelector(".text-left") ||
      doc.querySelector(".single-content") ||
      doc.querySelector("article");

    if (!root) return "";

    const blocks = root
      .querySelectorAll("p, blockquote")
      .map((node) => clean(node.text()))
      .filter(Boolean);

    return blocks.length ? blocks.join("\n\n") : clean(root.text());
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
