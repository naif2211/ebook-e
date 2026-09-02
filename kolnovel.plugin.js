// Harbor eBook source for kolnovel.com
// KolNovel uses /series/ pages and chapter URLs beginning with /shaag.

const BASE = "https://kolnovel.com";

async function getDoc(path) {
  const res = await harbor.http(BASE + path, {
    responseType: "text",
    timeoutMs: 20000,
  });
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

function clean(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function cleanTitle(value) {
  return clean(value).replace(/\s+(?:kol|كول)$/iu, "").trim();
}

function pageNumber(offset) {
  return Math.floor(offset / 20) + 1;
}

function seriesId(href) {
  const value = abs(href) || "";
  const match = value.match(/\/series\/([^/?#]+)\/?(?:[?#].*)?$/i);
  return match ? decodeURIComponent(match[1]) : "";
}

function seriesPath(id) {
  return "/series/" + encodeURIComponent(id) + "/";
}

function chapterNumber(text) {
  const value = clean(text);
  const m = value.match(/(?:الفصل|chapter)\s*([0-9]+(?:\.[0-9]+)?)/iu);
  return m ? m[1] : undefined;
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

  const rawTitle = clean(
    link.attr("title") ||
    node.querySelector("h2")?.text() ||
    node.querySelector("h3")?.text() ||
    link.text(),
  );

  return {
    id,
    title: cleanTitle(rawTitle),
    siteUrl: abs(href),
    isFanMade: /(?:fan[ -]?fiction|fanfic|فان\s*فيكشن|فانفيك)/iu.test(rawTitle),
  };
}

function mapSeriesResults(doc) {
  // The archive exposes the series as h2 headings containing the canonical
  // /series/ link. This avoids relying on parentElement or card classes.
  const headings = doc.querySelectorAll("h2, h3");
  const results = [];
  const seen = {};

  for (const heading of headings) {
    const item = cardToSummary(heading);
    if (!item || seen[item.id]) continue;
    seen[item.id] = true;
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

const plugin = {
  id: "kolnovel",
  name: "KolNovel",

  async popular(offset, tagId) {
    const page = pageNumber(offset);
    const { order, status } = browseParams(tagId);
    const path =
      "/series/?order=" + encodeURIComponent(order) +
      "&page=" + page +
      "&status=" + encodeURIComponent(status) +
      "&type=";
    return mapSeriesResults(await getDoc(path));
  },

  async search(query, offset, tagId) {
    const page = pageNumber(offset);
    const { order, status } = browseParams(tagId);
    const path =
      "/series/?search=" + encodeURIComponent(query) +
      "&order=" + encodeURIComponent(order) +
      "&page=" + page +
      "&status=" + encodeURIComponent(status) +
      "&type=";
    return mapSeriesResults(await getDoc(path));
  },

  async detail(id) {
    const doc = await getDoc(seriesPath(id));
    const title = cleanTitle(doc.querySelector("h1")?.text() || id);
    if (!title) return null;

    const cover = doc.querySelector(
      "img.wp-post-image, .series-cover img, .book-cover img, .summary_image img",
    );

    const author = clean(doc.querySelector(".author a, .author-content a, .author")?.text());
    const yearText = clean(doc.querySelector(".release-year, .year")?.text());
    const year = Number.parseInt(yearText, 10);

    const genres = doc
      .querySelectorAll(".genres a, .genre a, a[href*='/genre/']")
      .map((node) => clean(node.text()))
      .filter(Boolean);

    const chapterLinks = doc.querySelectorAll("a[href*='shaag']");
    let maxChapter;
    for (const a of chapterLinks) {
      const n = Number.parseFloat(chapterNumber(a.text()) || "");
      if (Number.isFinite(n) && (maxChapter === undefined || n > maxChapter)) maxChapter = n;
    }

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
      chapters: maxChapter !== undefined ? maxChapter : undefined,
      siteUrl: BASE + seriesPath(id),
      isFanMade: /(?:fan[ -]?fiction|fanfic|فان\s*فيكشن|فانفيك)/iu.test(title),
    };
  },

  async chapters(id) {
    const doc = await getDoc(seriesPath(id));

    // IMPORTANT: KolNovel's real chapter URLs are /shaag... and do not
    // consistently carry the old WP-Manga classes. Select the real URL pattern
    // directly so no chapters are lost because of a wrapper class.
    const links = doc.querySelectorAll("a[href*='shaag']");
    const chapters = [];
    const seen = {};

    for (const a of links) {
      const href = a.attr("href") || "";
      const absolute = abs(href);
      const title = clean(a.text());

      if (!absolute || !/^https?:\/\/kolnovel\.com\/shaag/i.test(absolute)) continue;
      if (!title || seen[absolute]) continue;

      // Keep chapter-looking links only; this prevents PDF/social/recommendation
      // links from becoming fake chapters.
      if (!/(?:الفصل|chapter)\s*[0-9]+/iu.test(title) && !/فصل\s*[0-9]+/iu.test(title)) continue;

      seen[absolute] = true;
      chapters.push({
        id: absolute.replace(BASE + "/", "").replace(/\/$/, ""),
        chapter: chapterNumber(title),
        title,
        position: chapters.length,
      });
    }

    return chapters;
  },

  async content(chapterId) {
    const path = "/" + chapterId.replace(/^\/+/, "").replace(/\/$/, "") + "/";
    const doc = await getDoc(path);

    // Current KolNovel chapter pages expose the prose inside one of these
    // reading containers. Use the first real container and preserve DOM order.
    const container = doc.querySelector(
      ".reading-content, .chapter-content, .text-left, .reading-area, .entry-content",
    );
    if (!container) return "";

    const blocks = container
      .querySelectorAll("p, blockquote")
      .map((node) => clean(node.text()))
      .filter(Boolean);

    return blocks.length ? blocks.join("\n\n") : clean(container.text());
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
