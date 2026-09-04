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
  let s = String(href).split("#")[0].split("?")[0];
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

  const img = a.querySelector("img");
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
  doc.querySelectorAll("a[href]").map((a) => {
    const item = cardFromLink(a);
    if (item) uniquePush(out, seen, item);
    return null;
  });
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
    params.set("s", query);
    if (page > 1) params.set("page", String(page));
    if (tagId && tagId.indexOf("genre:") === 0) params.set("genre", tagId.slice(6));
    return extractNovels(await getDoc("/?" + params.toString()));
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
    doc.querySelectorAll("a[href*='genre']").map((a) => {
      const g = clean(a.text());
      if (g && genres.indexOf(g) < 0) genres.push(g);
      return null;
    });

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
    doc.querySelectorAll("a[href]").map((a) => {
      const href = a.attr("href") || "";
      const path = chapterPath(href);
      const m = path.match(/^novel\/([^/]+)\/(\d+)\/?$/i);
      if (!m) return null;

      let seriesId = "";
      try {
        seriesId = decodeURIComponent(m[1]);
      } catch (_) {
        seriesId = m[1];
      }
      if (seriesId !== id) return null;

      const key = path.replace(/\/$/, "");
      if (seen[key]) return null;
      seen[key] = true;

      const number = m[2];
      const title = clean(a.text()) || ("الفصل " + number);

      chapters.push({
        id: key,
        chapter: number,
        title,
        position: chapters.length,
        pages: 0,
        language: "ar"
      });
      return null;
    });

    chapters.sort((a, b) => Number(a.chapter) - Number(b.chapter));

    return chapters.map((c, i) => ({
      id: c.id,
      chapter: c.chapter,
      title: c.title,
      position: i,
      pages: c.pages,
      language: c.language
    }));
  },

  async content(chapterId) {
    const doc = await getDoc("/" + String(chapterId).replace(/^\/+/, ""));

    const root = doc.querySelector(".chapter-content");
    if (!root) return "";

    const parts = root.querySelectorAll("p, blockquote")
      .map((node) => clean(node.text()))
      .filter(Boolean);

    if (parts.length) return parts.join("\n\n");

    return clean(root.text());
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
