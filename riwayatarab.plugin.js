// Harbor eBook source for RiwayatArab
// v1.4.0 - fix work covers/search only. Chapter/content logic intentionally unchanged.

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
  return String(v || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function sameHost(url) { return /^https?:\/\/riwayatarab\.com(?:\/|$)/i.test(String(url || "")); }

function novelId(href) {
  const u = abs(href) || "";
  const m = u.match(/\/novel\/([^/?#]+)\/?(?:[?#].*)?$/i);
  if (!m) return "";
  try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
}

function novelPath(id) { return "/novel/" + encodeURIComponent(id); }

// RiwayatArab uses several lazy-image conventions. Also inspect common
// responsive-image attributes and ignore transparent/tiny placeholders.
function imageUrl(img) {
  if (!img) return undefined;
  const attrs = ["data-src", "data-lazy-src", "data-original", "data-image", "data-cover", "data-url", "data-fallback-src", "src", "srcset", "data-srcset"];
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

function imageFrom(node) {
  if (!node) return undefined;
  const direct = imageUrl(node);
  if (direct) return direct;
  const img = node.querySelector("img");
  return imageUrl(img);
}

function imageFromLink(link) {
  if (!link) return undefined;
  const direct = imageFrom(link);
  if (direct) return direct;
  // Some listing cards put the image beside the title link rather than
  // inside it. Check the immediate card/container without touching chapter code.
  try {
    const parent = link.parentElement;
    if (parent) {
      const cover = imageFrom(parent);
      if (cover) return cover;
      const imgs = parent.querySelectorAll("img");
      for (const img of imgs) {
        const cover2 = imageUrl(img);
        if (cover2) return cover2;
      }
    }
  } catch (_) {}
  return undefined;
}

function chapterNumber(text, url) {
  const s = clean(text);
  let m = s.match(/(?:الفصل|فصل|chapter|chap|ch\.?)[\s:#-]*(\d+(?:\.\d+)?)/iu);
  if (m) return m[1];
  const u = String(url || "");
  m = u.match(/\/chapter\/(\d+(?:\.\d+)?)(?:[\/?#]|$)/i);
  if (m) return m[1];
  m = u.match(/\/novel\/[^/?#]+\/(\d+(?:\.\d+)?)(?:[\/?#]|$)/i);
  return m ? m[1] : undefined;
}

function isChapterUrl(url) {
  const u = String(url || "");
  return sameHost(u) && (/\/novel\/[^/?#]+\/chapter\/[^/?#]+/i.test(u) || /\/novel\/[^/?#]+\/chapter\/?(?:[?#]|$)/i.test(u) || /\/novel\/[^/?#]+\/\d+(?:[\/?#]|$)/i.test(u));
}

function chapterId(url) {
  const u = abs(url);
  if (!u) return "";
  return u.replace(/^https?:\/\/riwayatarab\.com/i, "").replace(/^\/+/, "/");
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

function novelCard(link) {
  const href = link.attr("href") || "";
  const url = abs(href);
  if (!url || !sameHost(url)) return null;
  const id = novelId(href);
  if (!id) return null;

  const img = link.querySelector("img");
  let title = clean(link.attr("title") || link.attr("aria-label") || img?.attr("alt") || img?.attr("title") || link.text());
  if (!title || title.length > 300) {
    try {
      const parent = link.parentElement;
      if (parent) title = clean(parent.attr?.("title") || parent.text());
    } catch (_) {}
  }
  title = title.replace(/(?:\s+بقلم\s+.*)$/iu, "").replace(/(?:\s+آخر\s+تحديث.*)$/iu, "").replace(/(?:\s+\d+\s+فصل.*)$/iu, "").trim();
  if (!title || title.length > 300) return null;
  return { id, title, cover: imageFromLink(link) };
}

function extractNovelCards(doc) {
  const out = [], seen = {};
  for (const link of doc.querySelectorAll("a[href]")) {
    const item = novelCard(link);
    if (!item || seen[item.id]) continue;
    seen[item.id] = true;
    out.push(item);
  }
  return out;
}

function pageFromUrl(url) {
  const m = String(url || "").match(/[?&](?:page|p)=(\d+)/i);
  return m ? Number(m[1]) : 0;
}

async function collectWorkPage(paths) {
  for (const path of paths) {
    try {
      const doc = await getDoc(path);
      const cards = extractNovelCards(doc);
      if (cards.length) return { doc, cards };
    } catch (_) {}
  }
  return { doc: null, cards: [] };
}

async function popularWorks(offset) {
  const page = Math.floor(Number(offset || 0) / WORK_PAGE_SIZE) + 1;
  const paths = page === 1 ? ["/", "/latest", "/popular", "/new", "/novels", "/novels?page=1", "/search?sort=views&page=1", "/search?sort=popular&page=1"] : ["/latest?page=" + page, "/popular?page=" + page, "/new?page=" + page, "/novels?page=" + page, "/search?sort=views&page=" + page, "/search?sort=popular&page=" + page, "/?page=" + page];
  return (await collectWorkPage(paths)).cards;
}

async function searchWorks(query, offset) {
  const q = clean(query);
  if (!q) return [];
  const page = Math.floor(Number(offset || 0) / WORK_PAGE_SIZE) + 1;
  const encoded = encodeURIComponent(q);
  // Try the common query keys used by server-rendered search forms.
  const paths = [
    "/search?query=" + encoded + "&page=" + page,
    "/search?q=" + encoded + "&page=" + page,
    "/search?search=" + encoded + "&page=" + page,
    "/search?s=" + encoded + "&page=" + page,
    "/search?keyword=" + encoded + "&page=" + page,
    "/search?title=" + encoded + "&page=" + page,
    "/search?name=" + encoded + "&page=" + page,
    "/search?term=" + encoded + "&page=" + page,
    "/search/" + encoded + "?page=" + page,
    "/novels?search=" + encoded + "&page=" + page,
    "/novels?q=" + encoded + "&page=" + page
  ];
  const result = await collectWorkPage(paths);
  if (result.cards.length) return result.cards;

  // Reliable fallback: the site exposes paginated server-rendered latest pages.
  // Search all 37 currently indexed pages, but stop as soon as enough matches exist.
  const needle = normalizeSearch(q);
  const seen = {}, fallback = [];
  for (let p = 1; p <= 100; p++) {
    const pageResult = await collectWorkPage(["/latest?page=" + p]);
    if (!pageResult.cards.length) break;
    for (const item of pageResult.cards) {
      const hay = normalizeSearch(item.title + " " + item.id);
      if (!seen[item.id] && hay.includes(needle)) {
        seen[item.id] = true;
        fallback.push(item);
      }
    }
    if (fallback.length >= page * WORK_PAGE_SIZE) break;
  }
  const start = (page - 1) * WORK_PAGE_SIZE;
  return fallback.slice(start, start + WORK_PAGE_SIZE);
}

function extractChapterLinks(doc) {
  const out = [], seen = {};
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = a.attr("href") || "";
    const url = abs(href);
    if (!url || !isChapterUrl(url)) continue;
    const id = chapterId(url);
    if (!id || seen[id]) continue;
    const title = clean(a.text() || a.attr("title") || a.attr("aria-label") || "");
    const number = chapterNumber(title, url);
    if (!number && !/\/chapter\//i.test(url)) continue;
    seen[id] = true;
    out.push({ id, chapter: number || String(out.length + 1), title: title || ("الفصل " + (number || (out.length + 1))), pages: 0, language: "ar" });
  }
  return out;
}

function chapterPageNumbers(doc) {
  const pages = [];
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = abs(a.attr("href"));
    if (!href || !/\/chapters(?:[\/?#]|$)/i.test(href)) continue;
    const p = pageFromUrl(href);
    if (p > 1) pages.push(p);
  }
  return pages;
}

async function loadAllChapters(id) {
  const base = novelPath(id) + "/chapters";
  const first = await getDoc(base);
  const all = extractChapterLinks(first);
  const knownPages = chapterPageNumbers(first);
  let maxPage = knownPages.length ? Math.max(...knownPages) : 1;
  if (all.length === 0) {
    try {
      const detailDoc = await getDoc(novelPath(id));
      const text = clean(detailDoc.text());
      const match = text.match(/(\d[\d,]*)\s*(?:فصل|فصول|chapter|chapters)\b/iu);
      const count = match ? Number(match[1].replace(/,/g, "")) : 0;
      if (count > 0 && count <= 10000) {
        for (let n = 1; n <= count; n++) all.push({ id: novelPath(id) + "/chapter/" + n, chapter: String(n), title: "الفصل " + n, pages: 0, language: "ar", position: n - 1 });
        return all;
      }
    } catch (_) {}
  }
  let emptyStreak = 0;
  const hardLimit = Math.max(maxPage, 100);
  for (let page = 2; page <= hardLimit; page++) {
    if (page > maxPage && emptyStreak >= 2) break;
    let doc;
    try { doc = await getDoc(base + "?page=" + page); } catch (_) { emptyStreak++; if (emptyStreak >= 2 && page > maxPage) break; continue; }
    const before = all.length;
    all.push(...extractChapterLinks(doc));
    if (all.length === before) emptyStreak++; else emptyStreak = 0;
    if (all.length && page >= maxPage) {
      const more = chapterPageNumbers(doc);
      if (more.length) maxPage = Math.max(maxPage, ...more);
    }
  }
  const unique = [], seen = {};
  for (const c of all) { if (seen[c.id]) continue; seen[c.id] = true; unique.push(c); }
  unique.sort((a, b) => { const an = Number(a.chapter), bn = Number(b.chapter); if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn; return String(a.title).localeCompare(String(b.title), "ar"); });
  for (let i = 0; i < unique.length; i++) unique[i].position = i;
  return unique;
}

function findContent(doc) {
  const selectors = ["[class*='chapter-content']", "[class*='chapter_content']", "[class*='reading-content']", "[class*='reading_content']", "[class*='chapter-body']", "[class*='chapter_body']", "[id*='chapter-content']", "[id*='reading-content']", "article .entry-content", "article .chapter", "article", "main article", ".novel-content", ".prose"];
  for (const selector of selectors) { const node = doc.querySelector(selector); if (node && clean(node.text()).length > 80) return node; }
  return null;
}

function isBoilerplate(text) { return /^(?:جميع الحقوق محفوظة|حقوق .* محفوظة|الحقوق محفوظة|شكراً لدعمك|شكرًا لدعمك)\b/iu.test(text) || /(?:اقرأ.*رواياتنا|قراءة.*موقعنا|دعم.*المترجم)/iu.test(text); }

function extractContent(root) {
  if (!root) return "";
  const nodes = root.querySelectorAll("p, blockquote, div"), out = [], seen = {};
  for (const node of nodes) {
    const text = clean(node.text());
    if (!text || text.length < 2 || isBoilerplate(text)) continue;
    if (seen[text]) continue;
    seen[text] = true;
    if (node.querySelector("p, blockquote")) continue;
    out.push(text);
  }
  return out.length ? out.join("\n\n") : clean(root.text());
}

const plugin = {
  id: "riwayatarab",
  name: "رواياتعرب",
  async popular(offset) { return popularWorks(offset); },
  async search(query, offset) { return searchWorks(query, offset); },
  async detail(id) {
    const doc = await getDoc(novelPath(id));
    const title = clean(doc.querySelector("h1")?.text() || id);
    if (!title) return null;
    const img = doc.querySelector("img[data-src], img[data-lazy-src], img[data-original], img[data-image], img[data-cover], img.object-cover, img.rounded, img[srcset], img[src]");
    const description = doc.querySelector("[class*='description'], [class*='summary'], [class*='synopsis']");
    const author = doc.querySelector("[class*='author'], [class*='writer'], [rel='author']");
    const text = clean(doc.text());
    const countMatch = text.match(/(\d+)\s*(?:فصل|فصول|chapter|chapters)\b/iu);
    return { id, title, cover: imageUrl(img), description: clean(description?.text()) || undefined, author: clean(author?.text()) || undefined, chapters: countMatch ? Number(countMatch[1]) : undefined, status: /مكتملة|مكتمل/iu.test(text) ? "completed" : /مستمرة|مستمر/iu.test(text) ? "ongoing" : undefined };
  },
  async chapters(id) { return loadAllChapters(id); },
  async content(chapterId) { const doc = await getDoc(chapterId); const root = findContent(doc); return extractContent(root) || clean(doc.text()); }
};
