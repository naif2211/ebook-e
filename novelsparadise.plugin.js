// Harbor eBook source: Novels Paradise
// Robust HTML scraper for https://novelsparadise.site and /np-light/.

const BASE = "https://novelsparadise.site";
const PAGE_SIZE = 20;

async function getDoc(path) {
  const url = /^https?:\/\//i.test(path)
    ? path
    : BASE + (path.startsWith("/") ? path : "/" + path);
  const res = await harbor.http(url, { responseType: "text", timeoutMs: 30000 });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return harbor.parseHtml(res.body);
}

function abs(value) {
  if (!value) return undefined;
  const v = String(value).trim();
  if (!v || /^data:/i.test(v)) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("//")) return "https:" + v;
  return v.startsWith("/") ? BASE + v : BASE + "/" + v;
}

function clean(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sameHost(url) {
  return /^https?:\/\/novelsparadise\.site(?:\/|$)/i.test(String(url || ""));
}

function seriesId(href) {
  const url = abs(href) || "";
  const m = url.match(/\/series\/([^/?#]+)\/?(?:[?#].*)?$/i);
  if (!m) return "";
  try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
}

function imageFrom(node) {
  const img = node?.querySelector("img") || node;
  if (!img) return undefined;
  for (const key of ["data-src", "data-lazy-src", "data-original", "data-cover", "src"]) {
    const value = img.attr(key);
    if (!value) continue;
    const first = String(value).split(",")[0].trim().split(/\s+/)[0];
    if (first && !/placeholder|transparent|spacer|blank/i.test(first)) return abs(first);
  }
  return undefined;
}

function workFromAnchor(a) {
  const href = a.attr("href") || "";
  const url = abs(href);
  const id = seriesId(href);
  if (!url || !sameHost(url) || !id) return null;

  let title = clean(
    a.attr("title") ||
    a.attr("aria-label") ||
    a.querySelector("img")?.attr("alt") ||
    a.querySelector("h2,h3,h4,.title,.name")?.text() ||
    a.text()
  );

  if (!title || title.length > 250) {
    const parent = a.parentElement;
    title = clean(parent?.querySelector("h2,h3,h4,.title,.name")?.text() || "");
  }
  if (!title || title.length > 250) return null;

  title = title
    .replace(/^رواية\s+/iu, "")
    .replace(/\s+مترجمة\s*$/iu, "")
    .trim();

  return {
    id,
    title,
    cover: imageFrom(a),
  };
}

function extractWorks(doc) {
  const result = [];
  const seen = {};
  for (const a of doc.querySelectorAll("a[href]")) {
    const item = workFromAnchor(a);
    if (!item || seen[item.id]) continue;
    seen[item.id] = true;
    result.push(item);
  }
  return result;
}

function pageNumber(url) {
  const s = String(url || "");
  let m = s.match(/\/series\/page\/(\d+)\/?$/i);
  if (m) return Number(m[1]);
  m = s.match(/[?&]page=(\d+)/i);
  return m ? Number(m[1]) : 1;
}

async function getListingPage(page) {
  const paths = page <= 1
    ? ["/series/", "/np-light/", "/"]
    : ["/series/page/" + page + "/", "/series/?page=" + page, "/np-light/?page=" + page, "/page/" + page + "/"];

  for (const path of paths) {
    try {
      const doc = await getDoc(path);
      const works = extractWorks(doc);
      if (works.length) return works;
    } catch (_) {}
  }
  return [];
}

function chapterNumber(text, url) {
  const t = clean(text);
  let m = t.match(/(?:الفصل|فصل|chapter|chap)\.?\s*[#:.-]*\s*(\d+(?:\.\d+)?)/iu);
  if (m) return m[1];
  m = String(url || "").match(/[-_/](\d+(?:\.\d+)?)(?:\/?(?:[?#].*)?)$/i);
  return m ? m[1] : undefined;
}

function chapterFromAnchor(a) {
  const href = a.attr("href") || "";
  const url = abs(href);
  if (!url || !sameHost(url) || /\/series(?:\/|$)/i.test(url)) return null;

  const title = clean(a.text() || a.attr("title") || a.attr("aria-label"));
  const number = chapterNumber(title, url);
  if (!number) return null;

  // A chapter link on Novels Paradise is normally a root-level URL such as
  // /some-novel-1559/. Do not require the word "chapter" in the URL.
  const id = url.replace(/^https?:\/\/novelsparadise\.site/i, "");
  return {
    id,
    chapter: number,
    title: title || "الفصل " + number,
    pages: 0,
    language: "ar",
  };
}

function extractChapters(doc) {
  const result = [];
  const seen = {};
  for (const a of doc.querySelectorAll("a[href]")) {
    const item = chapterFromAnchor(a);
    if (!item || seen[item.id]) continue;
    seen[item.id] = true;
    result.push(item);
  }
  return result;
}

function findPaginationPages(doc) {
  const pages = [];
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = a.attr("href") || "";
    const url = abs(href) || "";
    const n = pageNumber(url);
    if (/\/series\/page\/\d+/i.test(url) || /[?&]page=\d+/i.test(url)) pages.push(n);
  }
  return [...new Set(pages)].filter((n) => n > 1).sort((a, b) => a - b);
}

async function allChapters(id) {
  const url = "/series/" + encodeURIComponent(id) + "/";
  const first = await getDoc(url);
  const all = extractChapters(first);

  // Most series pages expose the complete chapter list directly. If pagination
  // exists, follow its links too instead of assuming a fixed chapter count.
  const pages = findPaginationPages(first);
  for (const page of pages) {
    try {
      const doc = await getDoc(url + "?page=" + page);
      all.push(...extractChapters(doc));
    } catch (_) {}
  }

  const unique = [];
  const seen = {};
  for (const chapter of all) {
    if (seen[chapter.id]) continue;
    seen[chapter.id] = true;
    unique.push(chapter);
  }

  unique.sort((a, b) => {
    const x = Number(a.chapter);
    const y = Number(b.chapter);
    if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
    return String(a.title).localeCompare(String(b.title), "ar");
  });

  unique.forEach((chapter, index) => { chapter.position = index; });
  return unique;
}

function contentRoot(doc) {
  const selectors = [
    ".reading-content",
    ".chapter-content",
    ".entry-content",
    ".novel-content",
    ".content-area article",
    "article .entry-content",
    "article",
    "main"
  ];
  for (const selector of selectors) {
    const node = doc.querySelector(selector);
    if (node && clean(node.text()).length > 80) return node;
  }
  return null;
}

function extractContent(root) {
  if (!root) return "";
  const nodes = root.querySelectorAll("p, blockquote");
  const result = [];
  const seen = {};
  for (const node of nodes) {
    const text = clean(node.text());
    if (!text || seen[text]) continue;
    seen[text] = true;
    result.push(text);
  }
  return result.length ? result.join("\n\n") : clean(root.text());
}

const plugin = {
  id: "novelsparadise",
  name: "Novels Paradise",

  async popular(offset) {
    const page = Math.floor(Number(offset || 0) / PAGE_SIZE) + 1;
    return getListingPage(page);
  },

  async search(query, offset) {
    const q = clean(query);
    if (!q) return [];
    const page = Math.floor(Number(offset || 0) / PAGE_SIZE) + 1;
    const encoded = encodeURIComponent(q);

    const paths = [
      "/series/?s=" + encoded + "&page=" + page,
      "/?s=" + encoded + "&page=" + page,
      "/np-light/?s=" + encoded + "&page=" + page,
      "/search/?q=" + encoded + "&page=" + page,
      "/search?q=" + encoded + "&page=" + page,
    ];

    for (const path of paths) {
      try {
        const result = extractWorks(await getDoc(path));
        if (result.length) return result;
      } catch (_) {}
    }

    // Last-resort server-side-independent search: scan the series index.
    // This is slower but prevents the source from returning nothing when the
    // site's search parameter changes.
    const needle = q.toLocaleLowerCase();
    const matches = [];
    const seen = {};
    for (let p = 1; p <= 200; p++) {
      const result = await getListingPage(p);
      if (!result.length) break;
      for (const item of result) {
        if (!seen[item.id] && item.title.toLocaleLowerCase().includes(needle)) {
          seen[item.id] = true;
          matches.push(item);
        }
      }
    }
    const start = (page - 1) * PAGE_SIZE;
    return matches.slice(start, start + PAGE_SIZE);
  },

  async detail(id) {
    const doc = await getDoc("/series/" + encodeURIComponent(id) + "/");
    const title = clean(doc.querySelector("h1")?.text() || id);
    if (!title) return null;

    const bodyText = clean(doc.text());
    const count = bodyText.match(/(\d[\d,]*)\s*(?:فصل|فصول|chapter|chapters)\b/iu);
    const cover = imageFrom(doc.querySelector("img[data-src],img[data-lazy-src],img[data-original],img[src]"));

    return {
      id,
      title,
      cover,
      description: clean(doc.querySelector(".summary,.description,.entry-content p")?.text()) || undefined,
      author: clean(doc.querySelector(".author,.writer")?.text()) || undefined,
      chapters: count ? Number(count[1].replace(/,/g, "")) : undefined,
      status: /\b(?:Ongoing|مستمرة)\b/iu.test(bodyText) ? "ongoing" : /\b(?:Completed|مكتملة)\b/iu.test(bodyText) ? "completed" : undefined,
    };
  },

  async chapters(id) {
    return allChapters(id);
  },

  async content(chapterId) {
    const doc = await getDoc(chapterId);
    const root = contentRoot(doc);
    return extractContent(root) || clean(doc.text());
  },

  async tags() {
    return [
      { id: "sort:update", name: "آخر التحديثات", group: "Sort" },
      { id: "sort:new", name: "المضاف حديثاً", group: "Sort" },
      { id: "sort:popular", name: "شائع", group: "Sort" },
      { id: "status:ongoing", name: "مستمرة", group: "Status" },
      { id: "status:completed", name: "مكتملة", group: "Status" },
    ];
  }
};