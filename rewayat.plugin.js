// Rewayat.club - Harbor eBook Source
const BASE = "https://rewayat.club";

async function getDoc(path) {
  const url = /^https?:\/\//i.test(path) ? path : BASE + (path.startsWith("/") ? path : "/" + path);
  const res = await harbor.http(url, { responseType: "text", timeoutMs: 20000 });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
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

function clean(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function novelId(href) {
  if (!href) return "";
  let s = String(href).split("#")[0].split("?")[0];
  try {
    if (/^https?:\/\//i.test(s)) s = new URL(s).pathname;
  } catch (_) {}
  const m = s.match(/^\/?novel\/([^/]+)\/?$/i);
  return m ? decodeURIComponent(m[1]) : "";
}

function chapterPath(href) {
  if (!href) return "";
  let s = String(href).split("#")[0];
  try {
    if (/^https?:\/\//i.test(s)) s = new URL(s).pathname;
  } catch (_) {}
  return s.replace(/^\//, "");
}

function chapterNumber(text) {
  const m = clean(text).match(/(?:^|\s)(\d+(?:\.\d+)?)(?:\s|$)/);
  return m ? m[1] : undefined;
}

function uniquePush(arr, seen, item) {
  if (!item || seen[item.id]) return;
  seen[item.id] = true;
  arr.push(item);
}

function cardFromLink(a) {
  const href = a.attr("href") || "";
  const id = novelId(href);
  if (!id) return null;

  const parent =
    a.parentElement ||
    a.querySelector("..");

  const img = a.querySelector("img") || (parent && parent.querySelector("img"));
  const title = clean(
    a.attr("title") ||
    img?.attr("alt") ||
    a.text()
  );

  if (!title) return null;

  return {
    id,
    title,
    cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("src"))
  };
}

function extractNovels(doc) {
  const out = [];
  const seen = {};
  const links = doc.querySelectorAll("a[href]");
  for (const a of links) {
    const item = cardFromLink(a);
    if (!item) continue;
    uniquePush(out, seen, item);
  }
  return out;
}

function statusValue(text) {
  text = clean(text);
  if (/مكتملة|مكتمل|completed/i.test(text)) return "completed";
  if (/متوقفة|متوقف|hiatus/i.test(text)) return "hiatus";
  if (/مستمرة|مستمر|ongoing/i.test(text)) return "ongoing";
  return undefined;
}

const plugin = {
  id: "rewayat",
  name: "نادي الروايات",

  async popular(offset, tagId) {
    const page = Math.floor(Number(offset || 0) / 24) + 1;
    const query = tagId && tagId.indexOf("genre:") === 0
      ? "?genre=" + encodeURIComponent(tagId.slice(6)) + "&page=" + page
      : "?page=" + page;
    return extractNovels(await getDoc("/library" + query));
  },

  async search(query, offset, tagId) {
    const page = Math.floor(Number(offset || 0) / 24) + 1;
    const params = new URLSearchParams();
    params.set("search", query);
    if (page > 1) params.set("page", String(page));
    if (tagId && tagId.indexOf("genre:") === 0) params.set("genre", tagId.slice(6));
    return extractNovels(await getDoc("/library?" + params.toString()));
  },

  async detail(id) {
    const doc = await getDoc("/novel/" + encodeURIComponent(id));

    const h1 = doc.querySelector("h1");
    const title = clean(h1?.text() || doc.querySelector("title")?.text());
    if (!title) return null;

    const allText = clean(doc.text());
    const coverNode = doc.querySelector("img[src], img[data-src]");
    const description =
      clean(
        doc.querySelector(".description")?.text() ||
        doc.querySelector(".summary")?.text() ||
        doc.querySelector("[class*='description']")?.text()
      );

    const genres = [];
    for (const a of doc.querySelectorAll("a[href*='genre']")) {
      const g = clean(a.text());
      if (g && genres.indexOf(g) < 0) genres.push(g);
    }

    return {
      id,
      title,
      cover: abs(coverNode?.attr("data-src") || coverNode?.attr("data-lazy-src") || coverNode?.attr("src")),
      description: description || undefined,
      status: statusValue(allText),
      genres: genres.length ? genres : undefined
    };
  },

  async chapters(id) {
    const doc = await getDoc("/novel/" + encodeURIComponent(id));

    const chapters = [];
    const seen = {};
    const links = doc.querySelectorAll("a[href]");

    for (const a of links) {
      const href = a.attr("href") || "";
      const path = chapterPath(href);

      const m = path.match(/^novel\/([^/]+)\/(\d+)\/?$/i);
      if (!m || decodeURIComponent(m[1]) !== id) continue;

      const title = clean(a.text());
      if (!title) continue;

      const number = a.attr("data-number") || m[2] || chapterNumber(title);
      const key = path.replace(/\/$/, "");
      if (seen[key]) continue;
      seen[key] = true;

      chapters.push({
        id: key,
        chapter: number,
        title,
        position: chapters.length,
        pages: 0,
        language: "ar"
      });
    }

    chapters.sort((a, b) => {
      const na = Number(a.chapter);
      const nb = Number(b.chapter);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.position - b.position;
    });

    return chapters.map((c, i) => ({
      ...c,
      position: i
    }));
  },

  async content(chapterId) {
    const doc = await getDoc("/" + String(chapterId).replace(/^\/+/, ""));

    const roots = [
      ".chapter-content",
      ".reading-content",
      ".chapter-body",
      ".reading-area",
      ".novel-content",
      ".content",
      "article"
    ];

    for (const selector of roots) {
      const root = doc.querySelector(selector);
      if (!root) continue;

      const parts = [];
      for (const node of root.querySelectorAll("p, blockquote")) {
        const text = clean(node.text());
        if (text) parts.push(text);
      }

      if (parts.length) return parts.join("\n\n");

      const fallback = clean(root.text());
      if (fallback) return fallback;
    }

    return "";
  },

  async tags() {
    return [
      { id: "genre:1", name: "كوميديا", group: "التصنيف" },
      { id: "genre:2", name: "أكشن", group: "التصنيف" },
      { id: "genre:3", name: "دراما", group: "التصنيف" },
      { id: "genre:4", name: "فانتازيا", group: "التصنيف" },
      { id: "genre:5", name: "مهارات القتال", group: "التصنيف" },
      { id: "genre:6", name: "مغامرة", group: "التصنيف" },
      { id: "genre:7", name: "رومانسي", group: "التصنيف" },
      { id: "genre:8", name: "حريم", group: "التصنيف" },
      { id: "genre:9", name: "قوى خارقة", group: "التصنيف" },
      { id: "genre:10", name: "سحر", group: "التصنيف" },
      { id: "genre:11", name: "رعب", group: "التصنيف" },
      { id: "genre:12", name: "خيال علمي", group: "التصنيف" },
      { id: "status:ongoing", name: "مستمرة", group: "الحالة" },
      { id: "status:completed", name: "مكتملة", group: "الحالة" }
    ];
  }
};
