// Harbor eBook source for نادي الروايات (rewayat.club).
// Uses the site's real /library, /novel/<slug>, and /novel/<slug>/<chapter> routes.

const BASE = "https://rewayat.club";
const PAGE_SIZE = 20;

async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType: "text" });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + path);
  return harbor.parseHtml(res.body);
}

function cleanPath(href) {
  return (href || "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .split("#")[0]
    .split("?")[0];
}

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function imageFrom(node) {
  if (!node) return undefined;
  const srcset = node.attr("data-srcset") || node.attr("srcset") || "";
  const firstSrcset = srcset.split(",")[0]?.trim().split(/\\s+/)[0];
  const style = node.attr("style") || "";
  const background = style.match(/background-image\\s*:\\s*url\\((['"]?)(.*?)\\1\\)/i)?.[2];
  return abs(
    node.attr("data-src") ||
    node.attr("data-lazy-src") ||
    node.attr("data-original") ||
    node.attr("data-image") ||
    node.attr("data-cfsrc") ||
    node.attr("src") ||
    firstSrcset ||
    background
  );
}

function pageNumber(href) {
  const m = (href || "").match(/[?&]page=(\d+)/i);
  return m ? Number(m[1]) : 0;
}

function maxPage(doc) {
  let max = 1;
  for (const a of doc.querySelectorAll("a")) {
    const n = pageNumber(a.attr("href") || "");
    if (n > max) max = n;
  }
  return max;
}

function novelId(href) {
  const p = cleanPath(href);
  const m = p.match(/^\/novel\/([^/]+)\/?$/);
  return m ? m[1] : "";
}

function cardToSummary(a) {
  const id = novelId(a.attr("href"));
  if (!id) return null;

  const text = (a.text() || "").replace(/\s+/g, " ").trim();
  const title = (a.attr("title") || text).trim();
  if (!title) return null;

  const status = /مكتملة/.test(text) ? "completed" :
    /متوقفة|متوقّفة/.test(text) ? "hiatus" :
    /مستمرة/.test(text) ? "ongoing" : undefined;

  return {
    id,
    title,
    cover,
    status,
    originalLanguage: "ar",
    isFanMade: false
  };
}

async function libraryPage(page) {
  const doc = await getDoc("/library" + (page > 1 ? "?page=" + page : ""));
  const found = [];
  const seen = new Set();
  for (const a of doc.querySelectorAll("a")) {
    const item = cardToSummary(a, doc);
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      found.push(item);
    }
  }
  return { doc, items: found };
}

function getNovelTitle(doc, id) {
  return (doc.querySelector("h1")?.text() || id).replace(/^رواية\s*/, "").trim();
}

function chapterTotal(text) {
  const m = (text || "").match(/الفصول\s*\(\s*([\d,،]+)/);
  return m ? Number(m[1].replace(/[،,]/g, "")) : undefined;
}

function chapterPageCount(doc, total) {
  let pages = maxPage(doc);
  const text = ((doc.querySelector("body") || doc).text() || "").replace(/\\s+/g, " ");
  const explicit = text.match(/الصفحة\\s*\\d+\\s*من\\s*(\\d+)/);
  if (explicit) pages = Math.max(pages, Number(explicit[1]) || 1);
  // The site displays 20 chapter rows per page.
  if (total) pages = Math.max(pages, Math.ceil(total / PAGE_SIZE));
  return Math.max(1, Math.min(pages, 500));
}

async function getDocRetry(path, attempts = 4) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await getDoc(path);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function chapterLinks(doc, id) {
  const prefix = "/novel/" + id + "/";
  const out = [];
  const seen = new Set();

  for (const a of doc.querySelectorAll("a")) {
    const href = cleanPath(a.attr("href"));
    if (!href.startsWith(prefix)) continue;
    const rest = href.slice(prefix.length);
    if (!/^\d+$/.test(rest)) continue;

    const n = Number(rest);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    const label = (a.text() || "").replace(/\s+/g, " ").trim();
    out.push({
      id: href.replace(/^\//, ""),
      number: n,
      title: label || ("الفصل " + n)
    });
  }
  return out;
}

const plugin = {
  id: "rewayat",
  name: "نادي الروايات",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    return (await libraryPage(page)).items;
  },

  async search(query, offset) {
    const q = (query || "").replace(/[\u064B-\u065F\u0670\u0640]/g, "").toLowerCase().trim();
    if (!q) return [];

    const first = await libraryPage(1);
    const last = Math.min(Math.max(maxPage(first.doc), 1), 50);
    const all = first.items.slice();
    const seen = new Set(all.map((x) => x.id));

    for (let start = 2; start <= last; start += 5) {
      const batch = [];
      for (let p = start; p < start + 5 && p <= last; p++) {
        batch.push(libraryPage(p).catch(() => ({ items: [] })));
      }
      const pages = await Promise.all(batch);
      for (const result of pages) {
        for (const item of result.items) {
          if (!seen.has(item.id)) {
            seen.add(item.id);
            all.push(item);
          }
        }
      }
    }

    const matches = all.filter((item) =>
      item.title.replace(/[\u064B-\u065F\u0670\u0640]/g, "").toLowerCase().includes(q)
    );
    return matches.slice(offset || 0, (offset || 0) + PAGE_SIZE);
  },

  async detail(id) {
    const doc = await getDoc("/novel/" + id);
    const title = getNovelTitle(doc, id);
    const body = ((doc.querySelector("body") || doc).text() || "").replace(/\s+/g, " ");
    if (!title || title === id) return null;

    const description =
      doc.querySelector("meta[name='description']")?.attr("content") ||
      doc.querySelector("meta[property='og:description']")?.attr("content") ||
      undefined;

    const cover =
      abs(doc.querySelector("meta[property='og:image']")?.attr("content")) ||
      imageFrom(doc.querySelector("img"));

    const authorMatch = body.match(/(?:الكاتب|المؤلف|بقلم)\s*:?\s*([^،|]+?)(?:\s+(?:الفصول|التعليقات)|$)/);
    const genres = doc.querySelectorAll("a")
      .filter((a) => {
        const p = a.attr("href") || "";
        return /category|genre|tag/i.test(p);
      })
      .map((a) => (a.text() || "").trim())
      .filter(Boolean);

    const status = /مكتملة/.test(body) ? "completed" :
      /متوقفة|متوقّفة/.test(body) ? "hiatus" :
      /مستمرة/.test(body) ? "ongoing" : undefined;

    return {
      id,
      title,
      cover,
      description,
      author: authorMatch ? authorMatch[1].trim() : undefined,
      status,
      chapters: chapterTotal(body),
      originalLanguage: "ar",
      genres
    };
  },

  async chapters(id) {
    const first = await getDocRetry("/novel/" + id);
    const body = ((first.querySelector("body") || first).text() || "").replace(/\\s+/g, " ");
    const total = chapterTotal(body);
    const pages = chapterPageCount(first, total);

    let records = chapterLinks(first, id);
    // Fetch every chapter-list page. Small batches with retries avoid losing pages
    // when the host temporarily rate-limits parallel requests.
    for (let start = 2; start <= pages; start += 2) {
      const batch = [];
      for (let p = start; p < start + 2 && p <= pages; p++) {
        batch.push(getDocRetry("/novel/" + id + "?page=" + p, 4).catch(() => null));
      }
      const docs = await Promise.all(batch);
      for (const doc of docs) {
        if (doc) records = records.concat(chapterLinks(doc, id));
      }
    }

    const byNumber = new Map();
    for (const item of records) {
      if (!byNumber.has(item.number)) byNumber.set(item.number, item);
    }

    return [...byNumber.values()]
      .sort((a, b) => a.number - b.number)
      .map((item, position) => ({
        id: item.id,
        chapter: String(item.number),
        position,
        title: item.title,
        pages: 0,
        language: "ar"
      }));
  },

  async content(chapterId) {
    const doc = await getDoc("/" + cleanPath(chapterId).replace(/^\//, ""));
    const scope =
      doc.querySelector(".chapter-content") ||
      doc.querySelector("article") ||
      doc.querySelector("main") ||
      doc;

    let lines = scope.querySelectorAll("p")
      .map((p) => (p.text() || "").trim())
      .filter(Boolean);

    if (!lines.length) {
      lines = (scope.text() || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
    }

    const junk = /^(إعدادات القارئ|عرض التعليقات|التعليقات|الدعم|الرئيسية|المكتبة|نادي الروايات\s*[-–].*)$/;
    return lines.filter((line) => !junk.test(line)).join("\n\n").trim();
  },

  async tags() {
    return [
      { id: "type:translated", name: "مترجمة", group: "النوع" },
      { id: "type:authored", name: "مؤلفة", group: "النوع" },
      { id: "status:ongoing", name: "مستمرة", group: "الحالة" },
      { id: "status:completed", name: "مكتملة", group: "الحالة" }
    ];
  }
};
