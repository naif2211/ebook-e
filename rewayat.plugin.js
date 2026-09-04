// Rewayat.club - Harbor eBook Source
const BASE = "https://rewayat.club";
const CHAPTERS_PER_PAGE = 24;

async function getDoc(path) {
  const res = await harbor.http(BASE + (path.startsWith("/") ? path : "/" + path), { responseType: "text", timeoutMs: 20000 });
  if (!res.ok) throw new Error("http " + res.status + " for " + path);
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

function imageUrl(img) {
  if (!img) return undefined;
  return abs(
    img.attr("data-src") ||
    img.attr("data-lazy-src") ||
    img.attr("data-original") ||
    img.attr("data-image") ||
    img.attr("src")
  );
}

function cardFromLink(a) {
  const id = novelId(a.attr("href") || "");
  if (!id) return null;
  const img = a.querySelector("img[src], img[data-src], img[data-lazy-src], img[data-original]");
  const title = clean(a.attr("title") || img?.attr("alt") || a.text());
  if (!title) return null;
  return { id, title, cover: imageUrl(img) };
}

function extractNovels(doc) {
  const out = [];
  const seen = {};
  doc.querySelectorAll("a[href]").map((a) => {
    const item = cardFromLink(a);
    if (item && !seen[item.id]) {
      seen[item.id] = true;
      out.push(item);
    }
    return null;
  });
  return out;
}

function chapterCount(doc) {
  const text = clean(doc.text());
  const m = text.match(/الفصول\s*\(\s*(\d+)\s*\)/);
  return m ? Number(m[1]) : 0;
}

function addChaptersFromDoc(doc, id, chapters, seen) {
  doc.querySelectorAll("a[href]").map((a) => {
    const info = chapterInfo(a.attr("href") || "");
    if (!info || info.seriesId !== id || seen[info.path]) return null;

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

    const coverMeta = doc.querySelector("meta[property='og:image'], meta[name='twitter:image']");
    const coverImg = doc.querySelector("img[src*='/media/novel/'], img[data-src*='/media/novel/'], img[data-lazy-src*='/media/novel/'], img[data-original*='/media/novel/'], img[src], img[data-src]");
    const cover = abs(coverMeta?.attr("content")) || imageUrl(coverImg);

    const description = clean(
      doc.querySelector(".description")?.text() ||
      doc.querySelector(".summary")?.text() ||
      doc.querySelector("[class*='description']")?.text()
    );

    return {
      id,
      title,
      cover,
      description: description || undefined
    };
  },

  async chapters(id) {
    const chapters = [];
    const seen = {};

    // Rewayat paginates the chapter list at 24 chapters per page.
    // The novel page exposes the total count as: الفصول (N).
    const firstDoc = await getDoc("/novel/" + encodeURIComponent(id));
    addChaptersFromDoc(firstDoc, id, chapters, seen);

    const total = chapterCount(firstDoc);
    const totalPages = total > 0 ? Math.ceil(total / CHAPTERS_PER_PAGE) : 100;

    for (let page = 2; page <= totalPages; page++) {
      const doc = await getDoc("/novel/" + encodeURIComponent(id) + "?page=" + page);
      const before = chapters.length;
      addChaptersFromDoc(doc, id, chapters, seen);

      // If pagination stops returning new chapters, stop instead of making
      // unnecessary requests. This also handles novels whose count changes.
      if (chapters.length === before) break;
    }

    chapters.sort((a, b) => {
      const na = Number(a.chapter);
      const nb = Number(b.chapter);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.position - b.position;
    });

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

    // Rewayat's actual chapter text container.
    const root =
      doc.querySelector(".chapter-content") ||
      doc.querySelector("[class*='chapter-content']");

    if (!root) {
      const article = doc.querySelector("article");
      if (!article) return "";
      const fallback = article.querySelectorAll("p, blockquote")
        .map((node) => clean(node.text()))
        .filter(Boolean);
      return fallback.length ? fallback.join("\n\n") : clean(article.text());
    }

    const parts = root.querySelectorAll("p, blockquote")
      .map((node) => clean(node.text()))
      .filter(Boolean);

    if (parts.length) return parts.join("\n\n");
    return clean(root.text());
  },

  async tags() {
    return [];
  }
};
