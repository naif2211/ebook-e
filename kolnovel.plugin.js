// Harbor eBook source for kolnovel.com
// The site uses /series/ for novels and keeps the chapter list on the series page.

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
  return clean(value)
    .replace(/\s+(?:kol|كول)$/iu, "")
    .trim();
}

function pageNumber(offset) {
  return Math.floor(offset / 20) + 1;
}

function seriesId(href) {
  const value = href || "";
  const match = value.match(/\/series\/([^/?#]+)\/?(?:[?#].*)?$/i);
  return match ? decodeURIComponent(match[1]) : "";
}

function seriesPath(id) {
  return "/series/" + encodeURIComponent(id) + "/";
}

function cardToSummary(card) {
  const link = card.querySelector("a[href*='/series/']");
  if (!link) return null;

  const href = link.attr("href") || "";
  const id = seriesId(href);
  if (!id) return null;

  const rawTitle = clean(
    link.attr("title") ||
    card.querySelector("h2")?.text() ||
    card.querySelector("h3")?.text() ||
    link.text(),
  );

  const img = card.querySelector("img");
  const ratingText = clean(card.querySelector(".rating, .score")?.text());
  const rating = Number.parseFloat(ratingText.replace(",", "."));

  return {
    id,
    title: cleanTitle(rawTitle),
    cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("src")),
    description: clean(card.querySelector(".summary, .excerpt, p")?.text()),
    score: Number.isFinite(rating) ? rating : undefined,
    siteUrl: abs(href),
    isFanMade: /(?:fan[ -]?fiction|fanfic|فان\s*فيكشن|فانفيك)/iu.test(rawTitle),
  };
}

function findSeriesCards(doc) {
  // The series archive is not the old WP-Manga /manga/ layout.
  // Prefer headings containing a /series/ link, then fall back to those links themselves.
  const headings = doc.querySelectorAll("h2, h3");
  const cards = headings
    .map((heading) => {
      const link = heading.querySelector("a[href*='/series/']");
      return link ? heading : null;
    })
    .filter(Boolean);

  if (cards.length) return cards;
  return doc.querySelectorAll("a[href*='/series/']");
}

function mapSeriesResults(doc) {
  const results = [];
  const seen = {};

  for (const node of findSeriesCards(doc)) {
    const card = cardToSummary(node);
    if (!card || seen[card.id]) continue;
    seen[card.id] = true;
    results.push(card);
  }

  return results;
}

function statusFromText(value) {
  const text = clean(value).toLowerCase();
  if (text.includes("completed")) return "completed";
  if (text.includes("hiatus")) return "hiatus";
  if (text.includes("ongoing")) return "ongoing";
  return undefined;
}

function chapterNumber(text) {
  const m = clean(text).match(/(?:الفصل|chapter)\s*([0-9]+(?:\.[0-9]+)?)/iu);
  return m ? m[1] : undefined;
}

function chapterFromLink(a, position) {
  const href = a?.attr("href") || "";
  if (!href || !/^https?:\/\/kolnovel\.com\//i.test(abs(href))) return null;
  if (/\/series\//i.test(href)) return null;

  const title = clean(a.text());
  const parent = a.querySelector(".") ? a : a;
  const publishAt = clean(
    a.attr("data-date") ||
    a.querySelector("time")?.attr("datetime") ||
    a.parentElement?.querySelector?.("time")?.attr("datetime") ||
    "",
  );

  return {
    id: abs(href).replace(BASE + "/", "").replace(/\/$/, ""),
    chapter: chapterNumber(title),
    title: title || undefined,
    position,
    publishAt: publishAt || undefined,
  };
}

const plugin = {
  id: "kolnovel",
  name: "KolNovel",

  async popular(offset, tagId) {
    const page = pageNumber(offset);
    let order = "update";
    let status = "";

    if (tagId === "sort:popular") order = "popular";
    else if (tagId === "sort:rating") order = "rating";
    else if (tagId === "sort:chapters") order = "chapters";
    else if (tagId?.startsWith("status:")) status = tagId.slice(7);

    const doc = await getDoc(
      "/series/?order=" + encodeURIComponent(order) +
      "&page=" + page +
      "&status=" + encodeURIComponent(status) +
      "&type=",
    );
    return mapSeriesResults(doc);
  },

  async search(query, offset, tagId) {
    const page = pageNumber(offset);
    let order = "update";
    let status = "";

    if (tagId === "sort:popular") order = "popular";
    else if (tagId === "sort:rating") order = "rating";
    else if (tagId === "sort:chapters") order = "chapters";
    else if (tagId?.startsWith("status:")) status = tagId.slice(7);

    const path =
      "/series/?search=" + encodeURIComponent(query) +
      "&order=" + encodeURIComponent(order) +
      "&page=" + page +
      "&status=" + encodeURIComponent(status) +
      "&type=";

    const doc = await getDoc(path);
    return mapSeriesResults(doc);
  },

  async detail(id) {
    const doc = await getDoc(seriesPath(id));
    const title = cleanTitle(doc.querySelector("h1")?.text() || id);
    if (!title) return null;

    const cover = doc.querySelector(
      "img.wp-post-image, .series-cover img, .summary_image img, .book-cover img",
    );

    const status = statusFromText(
      doc.querySelector("body")?.text() || "",
    );

    const author = clean(
      doc.querySelector(".author a, .author-content a, .author")?.text(),
    );

    const yearText = clean(
      doc.querySelector(".release-year, .year")?.text(),
    );
    const year = Number.parseInt(yearText, 10);

    const genres = doc
      .querySelectorAll(".genres a, .genre a, a[href*='/genre/']")
      .map((node) => clean(node.text()))
      .filter(Boolean);

    return {
      id,
      title,
      altTitle: clean(doc.querySelector(".alternative, .alt-title, .series-alternative")?.text()) || undefined,
      cover: abs(cover?.attr("data-src") || cover?.attr("data-lazy-src") || cover?.attr("src")),
      description: clean(doc.querySelector(".description, .summary, .series-description, .desc")?.text()) || undefined,
      status,
      author: author || undefined,
      year: Number.isFinite(year) ? year : undefined,
      genres: genres.length ? genres : undefined,
      siteUrl: BASE + seriesPath(id),
      isFanMade: /(?:fan[ -]?fiction|fanfic|فان\s*فيكشن|فانفيك)/iu.test(title),
    };
  },

  async chapters(id) {
    const doc = await getDoc(seriesPath(id));

    // KolNovel exposes the complete chapter list on the series page, including
    // multiple volume sections. We keep DOM order exactly as supplied by the site.
    const chapterLinks = doc.querySelectorAll(
      ".wp-manga-chapter a, .chapter-list a, .chapters-list a, a[href*='shaag'][href$='/']",
    );

    const chapters = [];
    const seen = {};

    for (const a of chapterLinks) {
      const href = a.attr("href") || "";
      const absolute = abs(href);
      if (!absolute || !/^https?:\/\/kolnovel\.com\//i.test(absolute)) continue;
      if (/\/series\//i.test(absolute)) continue;
      if (seen[absolute]) continue;

      const title = clean(a.text());
      if (!title || !/(?:الفصل|chapter)\s*[0-9]+/iu.test(title)) continue;

      seen[absolute] = true;
      const item = chapterFromLink(a, chapters.length);
      if (item) chapters.push(item);
    }

    // Fallback: the site's chapter links are ordinary links even when the
    // surrounding class names change. Limit this fallback to chapter-looking URLs/text.
    if (!chapters.length) {
      const all = doc.querySelectorAll("a");
      for (const a of all) {
        const href = a.attr("href") || "";
        const absolute = abs(href);
        const text = clean(a.text());
        if (!absolute || !/^https?:\/\/kolnovel\.com\//i.test(absolute)) continue;
        if (/\/series\//i.test(absolute) || seen[absolute]) continue;
        if (!/(?:الفصل|chapter)\s*[0-9]+/iu.test(text)) continue;
        seen[absolute] = true;
        const item = chapterFromLink(a, chapters.length);
        if (item) chapters.push(item);
      }
    }

    return chapters;
  },

  async content(chapterId) {
    const doc = await getDoc("/" + chapterId.replace(/^\/+/, "") + "/");

    // The chapter page contains navigation, ads, comments and recommendations.
    // Prefer the real reading container and preserve its original DOM order.
    const container = doc.querySelector(
      ".reading-content, .chapter-content, .text-left, .reading-area",
    );

    if (!container) return "";

    const blocks = container.querySelectorAll(
      ":scope > p, :scope > div, :scope > blockquote, :scope > h2, :scope > h3, :scope > li",
    );

    if (blocks.length) {
      return blocks
        .map((node) => clean(node.text()))
        .filter(Boolean)
        .join("\n\n");
    }

    return clean(container.text());
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
