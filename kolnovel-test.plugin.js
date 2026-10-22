const BASE = "https://kolnovel.com";
const SERIES = BASE + "/series/";

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

async function getDoc(url) {
  const res = await harbor.http(abs(url), { responseType: "text" });
  if (!res.ok) throw new Error("HTTP " + res.status + ": " + url);
  return harbor.parseHtml(res.body);
}

function text(el) {
  return (el?.text() || "").replace(/\s+/g, " ").trim();
}

function attr(el, names) {
  for (const name of names) {
    const value = el?.attr(name);
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

function imageUrl(el) {
  return abs(attr(el, [
    "data-src", "data-lazy-src", "data-original",
    "data-lazyload", "src"
  ]));
}

function pathOf(url) {
  try {
    const u = new URL(url, BASE);
    return u.origin === new URL(BASE).origin ? u.pathname : "";
  } catch (_) {
    return "";
  }
}

function isSeries(url) {
  return /^\/series\/[^/?#]+\/?$/i.test(pathOf(url));
}

function titleFromCard(a) {
  return (
    attr(a, ["title", "aria-label"]) ||
    text(a.querySelector("h2, h3, h4, .series-title, .title, .tt")) ||
    text(a)
  );
}

function coverFromCard(a) {
  return imageUrl(a.querySelector("img")) ||
    imageUrl(a.querySelector("picture img"));
}

function summaryFromLink(a) {
  const url = abs(attr(a, ["href"]));
  if (!url || !isSeries(url)) return null;

  const title = titleFromCard(a);
  if (!title) return null;

  const card = a.closest(".bs, .bsx, .utao, .item, article, .series-item") || a;

  return {
    id: pathOf(url).replace(/^\/series\//, "").replace(/\/$/, ""),
    title,
    cover: coverFromCard(a) || coverFromCard(card),
    description: text(card.querySelector(".excerpt, .summary, .des")),
    genres: card.querySelectorAll(".genres a, .mgen a, .genre a")
      .map(x => text(x)).filter(Boolean),
    status: text(card.querySelector(".status, .tsinfo .status")) || undefined,
    score: Number(text(card.querySelector(".numscore, .score"))) || undefined
  };
}

function seriesUrl(id) {
  if (/^https?:\/\//i.test(id)) {
    const path = pathOf(id);
    if (isSeries(id)) return abs(path);
  }
  const slug = String(id || "").replace(/^\/+|\/+$/g, "");
  if (!slug || slug.includes("..")) throw new Error("Invalid series ID");
  return SERIES + slug + "/";
}

function extractSeries(doc) {
  const seen = new Set();
  const out = [];

  for (const a of doc.querySelectorAll("a[href]")) {
    const url = abs(a.attr("href") || "");
    if (!url || !isSeries(url)) continue;

    const item = summaryFromLink(a);
    if (!item || seen.has(item.id)) continue;

    seen.add(item.id);
    out.push(item);
  }

  return out;
}

function findCover(doc) {
  const selectors = [
    ".seriestu img", ".thumb img", ".series-thumb img",
    ".infox img", ".poster img", ".summary_image img",
    "article img"
  ];

  for (const selector of selectors) {
    const img = doc.querySelector(selector);
    const url = imageUrl(img);
    if (url) return url;
  }
  return undefined;
}

function chapterNumber(value) {
  const match = String(value || "").match(
    /(?:chapter|chap|الفصل|فصل)\s*([0-9]+(?:\.[0-9]+)?)/i
  );
  return match ? match[1] : undefined;
}

function chapterTitle(a) {
  return text(a.querySelector(".chapternum, .chapter-title, .name")) || text(a);
}

function extractChapters(doc) {
  const seen = new Set();
  const found = [];

  for (const a of doc.querySelectorAll("a[href]")) {
    const href = abs(a.attr("href") || "");
    const path = pathOf(href);

    const chapterLike =
      /\/shaag[^/]*\/?$/i.test(path) ||
      /\/(?:chapter|chap|الفصل)[^/]*\/?$/i.test(path);

    if (!chapterLike || !href || seen.has(href)) continue;

    const title = chapterTitle(a);
    if (!title) continue;

    seen.add(href);

    const volume = text(a.closest("[data-volume], .volume, .chapter-group"));

    found.push({
      id: href,
      title,
      chapter: chapterNumber(title),
      volume: volume || undefined,
      publishAt: attr(a.querySelector("time"), ["datetime"]),
      language: "ar",
      pages: 0
    });
  }

  found.reverse();
  return found.map((c, position) => ({ ...c, position }));
}

function extractReadingText(doc) {
  const selectors = [
    ".reading-content", ".chapter-content", ".entry-content",
    ".text-left", ".reading", ".content-inner", "article"
  ];

  for (const selector of selectors) {
    const root = doc.querySelector(selector);
    if (!root) continue;

    const paragraphs = root.querySelectorAll("p, blockquote")
      .map(p => text(p))
      .filter(Boolean);

    if (paragraphs.length) return paragraphs.join("\n\n");

    const fallback = text(root);
    if (fallback.length > 100) return fallback;
  }

  return "";
}

const plugin = {
  id: "kolnovel-test",
  name: "KolNovel Test",

  async popular(offset) {
    const page = Math.floor(Number(offset || 0) / 20) + 1;
    return extractSeries(await getDoc(SERIES + "?page=" + page)).slice(0, 20);
  },

  async search(query, offset) {
    const page = Math.floor(Number(offset || 0) / 20) + 1;
    const url = SERIES + "?search=" + encodeURIComponent(query) + "&page=" + page;
    return extractSeries(await getDoc(url)).slice(0, 20);
  },

  async detail(id) {
    const doc = await getDoc(seriesUrl(id));
    const title = text(doc.querySelector("h1"));
    if (!title) return null;

    const chapters = extractChapters(doc);
    return {
      id: String(id).replace(/^\/+|\/+$/g, ""),
      title,
      cover: findCover(doc),
      description: text(doc.querySelector(
        ".entry-content .description, .seriestu .entry-content, .entry-content, .desc, .summary"
      )),
      genres: [...new Set(doc.querySelectorAll(
        ".seriestugenre a, .mgen a, .genres a, .genre a"
      ).map(x => text(x)).filter(Boolean))],
      chapters: chapters.length || undefined,
      status: text(doc.querySelector(".tsinfo .status, .status")) || undefined,
      author: text(doc.querySelector(".author, .fmed b")) || undefined,
      altTitles: doc.querySelectorAll(".alternative, .alt-title")
        .map(x => text(x)).filter(Boolean)
    };
  },

  async chapters(id) {
    const chapters = extractChapters(await getDoc(seriesUrl(id)));
    if (!chapters.length) {
      throw new Error("No chapters found; KolNovel chapter-link selectors need verification.");
    }
    return chapters;
  },

  async content(chapterId) {
    const url = abs(chapterId);
    if (!url || new URL(url).origin !== new URL(BASE).origin) {
      throw new Error("Invalid chapter URL");
    }
    const content = extractReadingText(await getDoc(url));
    if (!content) throw new Error("Chapter text not found; content selector needs verification.");
    return content;
  },

  async tags() {
    return [
      { id: "sort:popular", name: "الرائجة", group: "الترتيب" },
      { id: "sort:rating", name: "التقييم", group: "الترتيب" },
      { id: "status:ongoing", name: "مستمرة", group: "الحالة" },
      { id: "status:completed", name: "مكتملة", group: "الحالة" },
      { id: "status:hiatus", name: "متوقفة مؤقتًا", group: "الحالة" }
    ];
  }
};

return plugin;
