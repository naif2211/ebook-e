// Rewayat.club - Harbor eBook Source
const BASE = "https://rewayat.club";
const API = "https://api.rewayat.club";

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

function nuxt(doc) {
  const scripts = doc.querySelectorAll("script");
  for (let i = 0; i < scripts.length; i++) {
    const text = scripts[i].text() || "";
    const marker = "window.__NUXT__=";
    const p = text.indexOf(marker);
    if (p < 0) continue;
    let raw = text.slice(p + marker.length).trim();
    if (raw.endsWith(";")) raw = raw.slice(0, -1);
    try { return JSON.parse(raw); } catch (_) {}
  }
  return null;
}

function apiCover(poster) {
  if (!poster) return undefined;
  const s = String(poster).trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  return API + (s.startsWith("/") ? s : "/" + s);
}

function uniquePush(arr, seen, item) {
  if (!item || seen[item.id]) return;
  seen[item.id] = true;
  arr.push(item);
}

function cardFromLink(a) {
  const id = novelId(a.attr("href") || "");
  if (!id) return null;
  const img = a.querySelector("img");
  const title = clean(a.attr("title") || img?.attr("alt") || a.text());
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
    uniquePush(out, seen, cardFromLink(a));
    return null;
  });
  return out;
}

function extractChapterLinks(doc, id, chapters, seen) {
  doc.querySelectorAll("a[href]").map((a) => {
    const info = chapterInfo(a.attr("href") || "");
    if (!info || info.seriesId !== id || seen[info.path]) return null;
    seen[info.path] = true;
    chapters.push({
      id: info.path,
      chapter: info.number,
      title: clean(a.text()) || ("الفصل " + info.number)
    });
    return null;
  });
}

function chaptersFromNuxt(data, id, chapters, seen) {
  try {
    const fetch0 = data && data.fetch && data.fetch[0];
    const list = fetch0 && fetch0.chapters;
    if (!list || !list.map) return 0;
    list.map((item) => {
      const number = String(item.number);
      const key = "novel/" + id + "/" + number;
      if (!seen[key]) {
        seen[key] = true;
        chapters.push({ id: key, chapter: number, title: clean(item.title) || ("الفصل " + number) });
      }
      return null;
    });
    return list.length;
  } catch (_) {
    return 0;
  }
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
    const data = nuxt(doc);
    let title = clean(doc.querySelector("h1")?.text() || doc.querySelector("title")?.text());
    let cover;
    let description = clean(doc.querySelector(".description")?.text() || doc.querySelector(".summary")?.text() || doc.querySelector("[class*='description']")?.text());

    try {
      const info = data.fetch[0].novel;
      title = clean(info.arabic || info.title || title);
      cover = apiCover(info.poster_url);
      description = clean(info.description || info.summary || description);
    } catch (_) {}

    if (!cover) {
      const meta = doc.querySelector("meta[property='og:image'], meta[name='twitter:image']");
      cover = abs(meta?.attr("content"));
    }
    if (!cover) {
      const img = doc.querySelector("img[data-src], img[data-lazy-src], img[src]");
      cover = abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("src"));
    }

    if (!title) return null;
    return { id, title, cover, description: description || undefined };
  },

  async chapters(id) {
    const chapters = [];
    const seen = {};
    const slug = String(id || "").replace(/^\\/+|\\/+$/g, "");

    function addFromDoc(doc) {
      doc.querySelectorAll("a[href]").map((a) => {
        const href = a.attr("href") || "";
        const info = chapterInfo(href);
        if (!info) return null;

        let series = info.seriesId;
        try { series = decodeURIComponent(series); } catch (_) {}

        if (series !== slug || seen[info.path]) return null;

        const number = Number(info.number);
        if (!Number.isFinite(number) || number < 1) return null;

        seen[info.path] = true;
        chapters.push({
          id: info.path,
          chapter: info.number,
          title: clean(a.text()) || ("الفصل " + info.number)
        });
        return null;
      });
    }

    function chapterCount(doc) {
      const text = clean(doc.querySelector("body")?.text() || doc.text() || "");
      const m = text.match(/الفصول\\s*[（(]\\s*(\\d+)\\s*[）)]/u);
      return m ? Number(m[1]) || 0 : 0;
    }

    const encodedSlug = encodeURIComponent(slug);
    const first = await getDoc("/novel/" + encodedSlug);
    const expected = chapterCount(first);

    addFromDoc(first);

    const pageSize = 24;
    const maxPages = expected > 0
      ? Math.ceil(expected / pageSize) + 2
      : 200;

    for (let page = 2; page <= maxPages; page++) {
      const doc = await getDoc("/novel/" + encodedSlug + "?page=" + page);
      const before = chapters.length;
      addFromDoc(doc);

      if (expected > 0 && chapters.length >= expected) break;
      if (expected === 0 && chapters.length === before) break;
    }

    const filtered = expected > 0
      ? chapters.filter((c) => {
          const n = Number(c.chapter);
          return Number.isFinite(n) && n >= 1 && n <= expected;
        })
      : chapters;

    filtered.sort((a, b) => {
      const na = Number(a.chapter);
      const nb = Number(b.chapter);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.title.localeCompare(b.title);
    });

    return filtered.map((c, i) => ({
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
    const data = nuxt(doc);

    // Rewayat stores the real chapter HTML inside NUXT contentParts.
    try {
      const fetch0 = data && data.fetch && data.fetch[0];
      const parts = fetch0 && fetch0.contentParts;
      if (parts && parts.map) {
        const html = parts.map((group) => {
          if (!group || !group.map) return "";
          return group.map((x) => String(x.content || "")).join("\n");
        }).join("\n");
        if (html.trim()) {
          const contentDoc = harbor.parseHtml("<div id='rewayat-content'>" + html + "</div>");
          const root = contentDoc.querySelector("#rewayat-content");
          if (root) {
            const blocks = root.querySelectorAll("p, h1, h2, h3, h4, blockquote, br")
              .map((node) => clean(node.text()))
              .filter(Boolean);
            if (blocks.length) return blocks.join("\n\n");
            const text = clean(root.text());
            if (text) return text;
          }
        }
      }
    } catch (_) {}

    const article = doc.querySelector(".chapter-content") || doc.querySelector("article");
    if (!article) return "";
    const blocks = article.querySelectorAll("p, blockquote").map((node) => clean(node.text())).filter(Boolean);
    if (blocks.length) return blocks.join("\n\n");
    return clean(article.text());
  },

  async tags() {
    return [];
  }
};
