// Rewayat.club - Harbor eBook Source
const BASE = "https://rewayat.club";

async function getDoc(path) {
  const res = await harbor.http(BASE + (path.startsWith("/") ? path : "/" + path), { responseType: "text" });
  if (!res.ok) throw new Error("http " + res.status + " for " + path);
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
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function pathOnly(href) {
  let s = String(href || "").split("#")[0].split("?")[0];
  s = s.replace(/^https?:\/\/[^/]+/i, "");
  return s.replace(/^\/+/, "");
}

function novelId(href) {
  const s = pathOnly(href);
  const m = s.match(/^novel\/([^/]+)\/?$/i);
  if (!m) return "";
  try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
}

function chapterInfo(href) {
  const path = pathOnly(href);
  const m = path.match(/^novel\/([^/]+)\/(\d+)\/?$/i);
  if (!m) return null;
  let seriesId = m[1];
  try { seriesId = decodeURIComponent(seriesId); } catch (_) {}
  return { path: path.replace(/\/$/, ""), seriesId, number: m[2] };
}

function cardFromLink(a) {
  const id = novelId(a.attr("href") || "");
  if (!id) return null;
  const img = a.querySelector("img");
  const title = clean(a.attr("title") || img?.attr("alt") || a.text());
  if (!title) return null;
  return { id, title, cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("src")) };
}

function extractNovels(doc) {
  const out = [];
  const seen = {};
  doc.querySelectorAll("a[href]").map((a) => {
    const item = cardFromLink(a);
    if (item && !seen[item.id]) { seen[item.id] = true; out.push(item); }
    return null;
  });
  return out;
}

const plugin = {
  id: "rewayat",
  name: "نادي الروايات",

  async popular(offset) {
    const page = Math.floor(Number(offset || 0) / 24) + 1;
    return extractNovels(await getDoc("/library?page=" + page));
  },

  async search(query, offset) {
    const page = Math.floor(Number(offset || 0) / 24) + 1;
    return extractNovels(await getDoc("/?s=" + encodeURIComponent(query) + "&page=" + page));
  },

  async detail(id) {
    const doc = await getDoc("/novel/" + encodeURIComponent(id));
    const title = clean(doc.querySelector("h1")?.text() || doc.querySelector("title")?.text());
    if (!title) return null;
    const img = doc.querySelector("img[src], img[data-src]");
    const description = clean(doc.querySelector(".description")?.text() || doc.querySelector(".summary")?.text() || doc.querySelector("[class*='description']")?.text());
    return { id, title, cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("src")), description: description || undefined };
  },

  async chapters(id) {
    const doc = await getDoc("/novel/" + encodeURIComponent(id));
    const chapters = [];
    const seen = {};

    doc.querySelectorAll("a[href]").map((a) => {
      const href = a.attr("href") || "";
      const info = chapterInfo(href);
      if (!info || info.seriesId !== id) return null;
      if (seen[info.path]) return null;
      seen[info.path] = true;

      chapters.push({
        id: info.path,
        chapter: info.number,
        title: clean(a.text()) || ("الفصل " + info.number),
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
      pages: 0,
      language: "ar"
    }));
  },

  async content(chapterId) {
    const doc = await getDoc("/" + String(chapterId).replace(/^\/+/, ""));
    const article = doc.querySelector("article");
    if (!article) return "";

    const blocks = article.querySelectorAll("p, blockquote").map((node) => clean(node.text())).filter(Boolean);
    if (blocks.length) return blocks.join("\n\n");
    return clean(article.text());
  },

  async tags() {
    return [];
  }
};
