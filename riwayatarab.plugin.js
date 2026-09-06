// Harbor eBook source for RiwayatArab
// v1.5.0 - broader work discovery + reliable chapter pagination/link detection.

const BASE = "https://riwayatarab.com";
const WORK_PAGE_SIZE = 48;

async function getDoc(path) {
  const url = /^https?:\/\//i.test(path) ? path : BASE + (path.startsWith("/") ? path : "/" + path);
  const res = await harbor.http(url, { responseType: "text", timeoutMs: 25000 });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return harbor.parseHtml(res.body);
}

function abs(url) {
  if (!url) return undefined;
  const v = String(url).trim();
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("//")) return "https:" + v;
  return v.startsWith("/") ? BASE + v : BASE + "/" + v;
}

function clean(v) {
  return String(v || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sameHost(url) {
  return /^https?:\/\/riwayatarab\.com(?:\/|$)/i.test(String(url || ""));
}

function novelId(href) {
  const u = abs(href) || "";
  const m = u.match(/\/novel\/([^/?#]+)\/?(?:[?#].*)?$/i);
  if (!m) return "";
  try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
}

function novelPath(id) {
  return "/novel/" + encodeURIComponent(id);
}

function imageUrl(img) {
  if (!img) return undefined;
  const attrs = ["data-src", "data-lazy-src", "data-original", "data-image", "data-cover", "data-url", "src", "srcset", "data-srcset"];
  for (const name of attrs) {
    const value = img.attr(name);
    if (!value) continue;
    const first = String(value).split(",")[0].trim().split(/\s+/)[0];
    if (!first || /^data:image\//i.test(first) || /(?:transparent|placeholder|blank|spacer)/i.test(first)) continue;
    const url = abs(first);
    if (url) return url;
  }
  return undefined;
}

function imageFromLink(link) {
  if (!link) return undefined;
  const direct = imageUrl(link.querySelector("img"));
  if (direct) return direct;
  try {
    const parent = link.parentElement;
    if (parent) return imageUrl(parent.querySelector("img"));
  } catch (_) {}
  return undefined;
}

function normalizeSearch(s) {
  return clean(s).toLocaleLowerCase()
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

function workCard(link) {
  const href = link.attr("href") || "";
  const url = abs(href);
  if (!url || !sameHost(url)) return null;
  const id = novelId(href);
  if (!id) return null;

  const img = link.querySelector("img");
  let title = clean(
    link.attr("title") ||
    link.attr("aria-label") ||
    img?.attr("alt") ||
    img?.attr("title") ||
    link.text()
  );

  if (!title || title.length > 300) {
    try {
      const parent = link.parentElement;
      if (parent) title = clean(parent.text());
    } catch (_) {}
  }

  title = title
    .replace(/\s+بقلم\s+.*$/iu, "")
    .replace(/\s+آخر\s+تحديث.*$/iu, "")
    .replace(/\s+\d+\s+فصل.*$/iu, "")
    .trim();

  if (!title || title.length > 300) return null;
  return { id, title, cover: imageFromLink(link) };
}

function extractWorks(doc) {
  const out = [];
  const seen = {};
  for (const link of doc.querySelectorAll("a[href]")) {
    const item = workCard(link);
    if (!item || seen[item.id]) continue;
    seen[item.id] = true;
    out.push(item);
  }
  return out;
}

function pageNumber(url) {
  const m = String(url || "").match(/[?&](?:page|p)=(\d+)/i);
  return m ? Number(m[1]) : 0;
}

function chapterNumber(text, url) {
  const s = clean(text);
  let m = s.match(/(?:الفصل|فصل|chapter|chap|ch\.?)[\s:#-]*(\d+(?:\.\d+)?)/iu);
  if (m) return m[1];

  const u = String(url || "");
  m = u.match(/\/chapter[-_\/]?(\d+(?:\.\d+)?)(?:[\/?#]|$)/i);
  if (m) return m[1];
  m = u.match(/\/novel\/[^/?#]+\/(\d+(?:\.\d+)?)(?:[\/?#]|$)/i);
  if (m) return m[1];

  const last = u.match(/[-_/](\d+(?:\.\d+)?)(?:[\/?#]|$)/i);
  return last ? last[1] : undefined;
}

function isChapterUrl(url, novelIdValue) {
  const u = String(url || "");
  if (!sameHost(u)) return false;
  const prefix = "/novel/" + encodeURIComponent(novelIdValue) + "/";
  if (!u.toLowerCase().includes(prefix.toLowerCase())) return false;
  if (/\/chapters?(?:[\/?#]|$)/i.test(u)) return false;
  if (/\/chapter(?:[-_/]|$)/i.test(u)) return true;
  if (/\/\d+(?:[\/?#]|$)/i.test(u)) return true;
  return !!chapterNumber("", u);
}

function chapterId(url) {
  const u = abs(url);
  if (!u) return "";
  return u.replace(/^https?:\/\/riwayatarab\.com/i, "").replace(/^\/+/, "/");
}

function extractChapterLinks(doc, novelIdValue) {
  const out = [];
  const seen = {};
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = a.attr("href") || "";
    const url = abs(href);
    if (!url || !isChapterUrl(url, novelIdValue)) continue;

    const id = chapterId(url);
    if (!id || seen[id]) continue;

    const title = clean(a.text() || a.attr("title") || a.attr("aria-label") || "");
    const number = chapterNumber(title, url);
    if (!number) continue;

    seen[id] = true;
    out.push({
      id,
      chapter: number,
      title: title || "الفصل " + number,
      pages: 0,
      language: "ar"
    });
  }
  return out;
}

function chapterPagination(doc) {
  const pages = [];
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = abs(a.attr("href"));
    if (!href || !/\/chapters?(?:[\/?#]|$)/i.test(href)) continue;
    const p = pageNumber(href);
    if (p > 1) pages.push(p);
  }
  return pages;
}

async function allChapterPages(id) {
  const base = novelPath(id) + "/chapters";
  const first = await getDoc(base);
  const all = extractChapterLinks(first, id);
  const listed = chapterPagination(first);
  let maxPage = listed.length ? Math.max(...listed) : 1;

  // Always probe subsequent pages. This fixes sites that render only a "next"
  // link without exposing the total page count.
  let empty = 0;
  for (let page = 2; page <= Math.max(100, maxPage); page++) {
    try {
      const doc = await getDoc(base + "?page=" + page);
      const found = extractChapterLinks(doc, id);
      const before = all.length;
      all.push(...found);
      const more = chapterPagination(doc);
      if (more.length) maxPage = Math.max(maxPage, ...more);
      if (all.length === before) empty++; else empty = 0;
      if (page > maxPage && empty >= 2) break;
    } catch (_) {
      if (page > maxPage) empty++;
      if (page > maxPage && empty >= 2) break;
    }
  }

  // De-duplicate and sort numerically. Never throw away a valid chapter just
  // because its title is Arabic or contains punctuation.
  const unique = [];
  const seen = {};
  for (const c of all) {
    if (seen[c.id]) continue;
    seen[c.id] = true;
    unique.push(c);
  }
  unique.sort((a, b) => {
    const an = Number(a.chapter), bn = Number(b.chapter);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return String(a.title).localeCompare(String(b.title), "ar");
  });
  for (let i = 0; i < unique.length; i++) unique[i].position = i;
  return unique;
}

async function tryWorks(paths) {
  for (const path of paths) {
    try {
      const doc = await getDoc(path);
      const works = extractWorks(doc);
      if (works.length) return works;
    } catch (_) {}
  }
  return [];
}

async function popularWorks(offset) {
  const page = Math.floor(Number(offset || 0) / WORK_PAGE_SIZE) + 1;
  const paths = [
    page === 1 ? "/" : "/?page=" + page,
    "/latest?page=" + page,
    "/novels?page=" + page,
    "/novel?page=" + page,
    "/browse?page=" + page,
    "/popular?page=" + page,
    "/new?page=" + page,
    "/search?sort=popular&page=" + page,
    "/search?sort=views&page=" + page
  ];
  return tryWorks(paths);
}

async function searchWorks(query, offset) {
  const q = clean(query);
  if (!q) return [];
  const page = Math.floor(Number(offset || 0) / WORK_PAGE_SIZE) + 1;
  const encoded = encodeURIComponent(q);
  const paths = [
    "/search?q=" + encoded + "&page=" + page,
    "/search?query=" + encoded + "&page=" + page,
    "/search?search=" + encoded + "&page=" + page,
    "/search?s=" + encoded + "&page=" + page,
    "/search?keyword=" + encoded + "&page=" + page,
    "/search?title=" + encoded + "&page=" + page,
    "/novels?search=" + encoded + "&page=" + page,
    "/novels?q=" + encoded + "&page=" + page
  ];
  const direct = await tryWorks(paths);
  if (direct.length) return direct;

  // Fallback for a server whose search form changed: scan the paginated latest
  // listing and match normalized Arabic/Latin titles.
  const needle = normalizeSearch(q);
  const matches = [];
  const seen = {};
  for (let p = 1; p <= 100; p++) {
    const works = await tryWorks(["/latest?page=" + p, "/novels?page=" + p]);
    if (!works.length) break;
    for (const item of works) {
      const hay = normalizeSearch(item.title + " " + item.id);
      if (!seen[item.id] && hay.includes(needle)) {
        seen[item.id] = true;
        matches.push(item);
      }
    }
    if (works.length < WORK_PAGE_SIZE) break;
  }
  const start = (page - 1) * WORK_PAGE_SIZE;
  return matches.slice(start, start + WORK_PAGE_SIZE);
}

function findContent(doc) {
  const selectors = [
    "[class*='chapter-content']",
    "[class*='chapter_content']",
    "[class*='reading-content']",
    "[class*='reading_content']",
    "[class*='chapter-body']",
    "[class*='chapter_body']",
    "[id*='chapter-content']",
    "[id*='reading-content']",
    ".entry-content",
    "article .prose",
    "article",
    "main article",
    ".novel-content",
    ".prose"
  ];
  for (const selector of selectors) {
    const node = doc.querySelector(selector);
    if (node && clean(node.text()).length > 80) return node;
  }
  return null;
}

function boilerplate(text) {
  return /^(?:جميع الحقوق محفوظة|حقوق .* محفوظة|الحقوق محفوظة|شكراً لدعمك|شكرًا لدعمك)\b/iu.test(text) ||
    /(?:اقرأ.*رواياتنا|قراءة.*موقعنا|دعم.*المترجم)/iu.test(text);
}

function extractContent(root) {
  if (!root) return "";
  const paragraphs = root.querySelectorAll("p, blockquote");
  const out = [];
  const seen = {};

  for (const node of paragraphs) {
    const text = clean(node.text());
    if (!text || text.length < 2 || boilerplate(text) || seen[text]) continue;
    seen[text] = true;
    out.push(text);
  }

  // Some chapters contain plain text directly inside the content container.
  // Do not return an empty chapter just because there are no <p> elements.
  if (out.length) return out.join("\n\n");
  return clean(root.text());
}

const plugin = {
  id: "riwayatarab",
  name: "رواياتعرب",

  async popular(offset) {
    return popularWorks(offset);
  },

  async search(query, offset) {
    return searchWorks(query, offset);
  },

  async detail(id) {
    const doc = await getDoc(novelPath(id));
    const title = clean(doc.querySelector("h1")?.text() || id);
    if (!title) return null;

    const img = doc.querySelector("img[data-src], img[data-lazy-src], img[data-cover], img[src]");
    const description = doc.querySelector("[class*='description'], [class*='summary'], .prose");
    const author = doc.querySelector("[class*='author'], [class*='writer']");
    const text = clean(doc.text());
    const count = text.match(/(\d[\d,]*)\s*(?:فصل|فصول|chapter|chapters)\b/iu);

    return {
      id,
      title,
      cover: imageUrl(img),
      description: clean(description?.text()) || undefined,
      author: clean(author?.text()) || undefined,
      chapters: count ? Number(count[1].replace(/,/g, "")) : undefined,
      status: /مكتملة|مكتمل/iu.test(text) ? "completed" : /مستمرة|مستمر/iu.test(text) ? "ongoing" : undefined
    };
  },

  async chapters(id) {
    return allChapterPages(id);
  },

  async content(id) {
    const doc = await getDoc(id);
    const root = findContent(doc);
    return extractContent(root) || clean(doc.text());
  }
};
