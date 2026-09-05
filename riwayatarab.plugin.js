// Harbor eBook source for RiwayatArab (riwayatarab.com)
// Focused on reliable Arabic novel chapters/content extraction.
// No DOM/fetch/storage: network only through harbor.http and HTML through harbor.parseHtml.

const BASE = "https://riwayatarab.com";
const PAGE_SIZE = 50;

async function getDoc(path) {
  const url = /^https?:\/\//i.test(path)
    ? path
    : BASE + (path.startsWith("/") ? path : "/" + path);
  const res = await harbor.http(url, { responseType: "text", timeoutMs: 20000 });
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

function novelId(href) {
  const u = abs(href) || "";
  const m = u.match(/\/novel\/([^/?#]+)(?:\/?(?:[?#].*)?)$/i);
  if (!m) return "";
  try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
}

function novelPath(id) {
  return "/novel/" + encodeURIComponent(id);
}

function chapterNumber(text, url) {
  const s = clean(text);
  let m = s.match(/(?:الفصل|فصل|chapter|ch\.?)[\s:#-]*(\d+(?:\.\d+)?)/iu);
  if (m) return m[1];
  m = String(url || "").match(/\/chapter\/(\d+(?:\.\d+)?)\/?(?:[?#].*)?$/i);
  return m ? m[1] : undefined;
}

function isChapterUrl(url) {
  return /\/novel\/[^/?#]+\/chapter\/\d+(?:[/?#]|$)/i.test(String(url || ""));
}

function chapterId(url) {
  const u = abs(url);
  if (!u) return "";
  return u.replace(/^https?:\/\/riwayatarab\.com/i, "").replace(/^\/+/, "/");
}

function novelCard(link) {
  const href = link.attr("href") || "";
  if (!/\/novel\/[^/]+\/?(?:[?#].*)?$/i.test(abs(href) || "")) return null;
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

  // Homepage cards can contain metadata/description after the title.
  title = title.split(/(?:بقلم|آخر تحديث|فصل|ك فصل)/iu)[0].trim();
  if (!title) return null;

  return {
    id,
    title,
    cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("src")),
    siteUrl: abs(href)
  };
}

function extractNovelCards(doc) {
  const links = doc.querySelectorAll("a[href]");
  const out = [];
  const seen = {};
  for (const link of links) {
    const item = novelCard(link);
    if (!item || seen[item.id]) continue;
    seen[item.id] = true;
    out.push(item);
  }
  return out;
}

function totalChapterPages(doc) {
  const text = clean(doc.text());
  const m = text.match(/الصفحة\s+\d+\s+من\s+(\d+)/iu);
  if (m) return Math.max(1, Number(m[1]));
  let max = 1;
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = a.attr("href") || "";
    const m2 = href.match(/[?&]page=(\d+)/i);
    if (m2) max = Math.max(max, Number(m2[1]));
  }
  return max;
}

function extractChapterLinks(doc) {
  const out = [];
  const seen = {};
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = a.attr("href") || "";
    const url = abs(href);
    if (!url || !isChapterUrl(url)) continue;

    const id = chapterId(url);
    if (!id || seen[id]) continue;

    const title = clean(a.text()) || clean(a.attr("title")) || clean(a.attr("aria-label"));
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

async function loadAllChapters(id) {
  const first = await getDoc(novelPath(id) + "/chapters");
  const pages = totalChapterPages(first);
  const all = extractChapterLinks(first);

  // RiwayatArab currently paginates chapter lists at 50 chapters/page.
  // Fetch every page so Harbor does not show only the first 50 chapters.
  for (let page = 2; page <= pages; page++) {
    const doc = await getDoc(novelPath(id) + "/chapters?page=" + page);
    all.push(...extractChapterLinks(doc));
  }

  const unique = [];
  const seen = {};
  for (const c of all) {
    if (seen[c.id]) continue;
    seen[c.id] = true;
    unique.push(c);
  }

  unique.sort((a, b) => {
    const an = Number(a.chapter);
    const bn = Number(b.chapter);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return String(a.chapter).localeCompare(String(b.chapter), "ar");
  });

  for (let i = 0; i < unique.length; i++) unique[i].position = i;
  return unique;
}

function findContent(doc) {
  const selectors = [
    "article .prose",
    "article .chapter-content",
    "article .reading-content",
    "article .entry-content",
    ".chapter-content",
    ".reading-content",
    ".novel-content",
    ".prose",
    "article",
    "main article",
    "main"
  ];
  for (const s of selectors) {
    const node = doc.querySelector(s);
    if (node) return node;
  }
  return null;
}

function isBoilerplate(text) {
  return /^(?:جميع الحقوق محفوظة|حقوق .* محفوظة|الحقوق محفوظة|شكراً لدعمك|شكرًا لدعمك|الفصل\s+\d+\s+من\s+\d+)\b/iu.test(text) ||
    /(?:اقرأ.*رواياتنا|قراءة.*موقعنا|دعم.*المترجم)/iu.test(text);
}

function extractContent(root) {
  if (!root) return "";
  const nodes = root.querySelectorAll("p, blockquote");
  const out = [];

  for (const node of nodes) {
    const text = clean(node.text());
    if (!text || isBoilerplate(text)) continue;
    out.push(text);
  }

  return out.length ? out.join("\n\n") : clean(root.text());
}

const plugin = {
  id: "riwayatarab",
  name: "رواياتعرب",

  async popular(offset) {
    const page = Math.floor(Number(offset || 0) / 20) + 1;
    const path = page <= 1 ? "/" : "/search?sort=views&page=" + page;
    return extractNovelCards(await getDoc(path));
  },

  async search(query, offset) {
    const q = clean(query);
    if (!q) return [];
    const page = Math.floor(Number(offset || 0) / 20) + 1;

    // The public search page is server-rendered with query parameters on some
    // deployments. Try the common parameter names; unsupported ones simply
    // return an empty result.
    const paths = [
      "/search?q=" + encodeURIComponent(q) + "&page=" + page,
      "/search?query=" + encodeURIComponent(q) + "&page=" + page,
      "/search?search=" + encodeURIComponent(q) + "&page=" + page
    ];

    for (const path of paths) {
      try {
        const results = extractNovelCards(await getDoc(path));
        if (results.length) return results;
      } catch (_) {}
    }
    return [];
  },

  async detail(id) {
    const doc = await getDoc(novelPath(id));
    const title = clean(doc.querySelector("h1")?.text() || id);
    if (!title) return null;

    const img = doc.querySelector(
      "img[alt*='لورد'], img.object-cover, img.rounded, img[data-src], img[src]"
    );

    const description = doc.querySelector(
      "[class*='description'], [class*='summary'], .prose"
    );

    const author = doc.querySelector(
      "[class*='author'], [class*='writer']"
    );

    const countText = clean(doc.text());
    const countMatch = countText.match(/(\d+)\s+فصل/iu);

    return {
      id,
      title,
      cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("src")),
      description: clean(description?.text()) || undefined,
      author: clean(author?.text()) || undefined,
      chapters: countMatch ? Number(countMatch[1]) : undefined,
      status: /مكتملة/iu.test(countText) ? "completed" : /مستمرة/iu.test(countText) ? "ongoing" : undefined,
      siteUrl: BASE + novelPath(id)
    };
  },

  async chapters(id) {
    return loadAllChapters(id);
  },

  async content(chapterId) {
    const doc = await getDoc(chapterId);
    const root = findContent(doc);
    return extractContent(root) || extractContent(doc);
  }
};
