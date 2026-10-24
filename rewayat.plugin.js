// Harbor eBook source plugin: رواياتعرب (RiwayatArab) - https://riwayatarab.com
//
// The site is a Next.js app. These pages are server-rendered, so plain HTML works:
//   /latest?page=N                      20 novel cards per page (37 pages)
//   /novel/<slug>                       novel page (cover, author, synopsis)
//   /novel/<slug>/chapters?page=N       50 chapter links per page, ascending
//   /novel/<slug>/chapter/<n>           chapter text
// /search is filled in by JavaScript, so search() below is a best guess (see VERIFY).

const BASE = "https://riwayatarab.com";
const PAGE_SIZE = 20;

async function getDoc(path) {
  const res = await harbor.http(path.startsWith("http") ? path : BASE + path, { responseType: "text" });
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

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch (_) { return s; }
}
function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}
function slugFromHref(href) {
  const m = (href || "").match(/\/novel\/([^/?#]+)/);
  return m ? safeDecode(m[1]) : "";
}
function novelPath(slug) {
  return "/novel/" + encodeURIComponent(slug);
}
function mapStatus(text) {
  if (/مكتملة/.test(text || "")) return "completed";
  if (/متوقفة/.test(text || "")) return "hiatus";
  if (/مستمرة/.test(text || "")) return "ongoing";
  return undefined;
}

// Card text looks like: "<title> <status> <title> بقلم: <author> <synopsis> <genre> <views> ..."
// There are no class names in the rendered text, so cards are found by their link.
function parseCards(doc) {
  const out = [];
  const seen = new Set();
  doc.querySelectorAll("a[href*='/novel/']").forEach((a) => {
    const href = a.attr("href") || "";
    if (/\/chapter\/|\/chapters/.test(href)) return;
    const id = slugFromHref(href);
    if (!id || seen.has(id)) return;
    const text = clean(a.text());
    const m = text.match(/^(.*?)\s+(مستمرة|مكتملة|متوقفة)\s/);
    if (!m) return; // navigation links have no status word
    seen.add(id);
    const img = a.querySelector("img");
    out.push({
      id,
      title: clean(m[1]),
      status: mapStatus(m[2]),
      cover: abs(img?.attr("src")),
    });
  });
  return out;
}

const plugin = {
  id: "riwayatarab",
  name: "رواياتعرب",

  // "Latest updates" is the only server-rendered listing, so it doubles as popular.
  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    return parseCards(await getDoc("/latest?page=" + page));
  },

  // VERIFY: /search is client-rendered, so this param name is a guess. If it returns
  // nothing, open DevTools > Network on /search, type a word, and send me that request.
  async search(query, offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    return parseCards(await getDoc("/search?q=" + encodeURIComponent(query) + "&page=" + page));
  },

  async detail(id) {
    const doc = await getDoc(novelPath(id));
    const h1 = doc.querySelector("h1");
    if (!h1) return null;
    const title = clean(h1.text());
    const body = clean(doc.querySelector("body")?.text() || "");

    const author = body.match(/بقلم:\s*(.+?)\s+[\d.,]+\S*\s*مشاهدة/)?.[1];
    const chapters = body.match(/(\d+)\s*فصل/)?.[1];
    const synopsis = body.match(/نبذة عن الرواية\s*([\s\S]*?)\s*قائمة الفصول/)?.[1];
    const cover = doc.querySelector("img[src*='/uploads/covers/']") || doc.querySelector("img[alt='" + title.replace(/'/g, "") + "']");

    return {
      id,
      title,
      cover: abs(cover?.attr("src")),
      description: clean(synopsis) || undefined,
      author: author && author !== "غير محدد" ? clean(author) : undefined,
      status: mapStatus(body.slice(0, body.indexOf("بقلم") > 0 ? body.indexOf("بقلم") : 400)),
      chapters: chapters ? Number(chapters) : undefined,
      originalLanguage: "ar",
      genres: doc.querySelectorAll("a[href*='/search?category=']").map((a) => clean(a.text())).filter(Boolean).slice(0, 5),
    };
  },

  // Chapter pages are 50 links each, ascending: /novel/<slug>/chapters?page=N
  // Chapter id = "<slug>::<number>".
  async chapters(id) {
    const out = [];
    const seen = new Set();
    let totalPages = 0;
    for (let page = 1; page <= 300; page++) {
      const doc = await getDoc(novelPath(id) + "/chapters" + (page > 1 ? "?page=" + page : ""));
      if (!totalPages) {
        const m = clean(doc.querySelector("body")?.text() || "").match(/الصفحة\s*\d+\s*من\s*(\d+)/);
        totalPages = m ? Number(m[1]) : 0;
      }
      const before = out.length;
      doc.querySelectorAll("a[href*='/chapter/']").forEach((a) => {
        const href = a.attr("href") || "";
        const num = href.match(/\/chapter\/([^/?#]+)/)?.[1];
        if (!num || seen.has(num)) return;
        seen.add(num);
        const text = clean(a.text());
        const views = text.replace(/^.*الفصل\s*[\d.]+\s*/, "").trim(); // trailing view count
        out.push({
          id: id + "::" + safeDecode(num),
          chapter: safeDecode(num),
          position: out.length,
          title: "الفصل " + safeDecode(num),
          pages: 0,
          language: "ar",
          views: /^[\d.,]+[كم]?$/.test(views) ? views : undefined,
        });
      });
      if (out.length === before) break;
      if (totalPages && page >= totalPages) break;
    }
    return out;
  },

  // VERIFY: paragraph container unknown. Tries article/main <p>, then every <p>.
  // The site injects watermark lines ("حقوق ... عالم الروايات ...") between paragraphs;
  // those exact spam lines are dropped, everything else stays in source order.
  async content(chapterId) {
    const [slug, num] = chapterId.split("::");
    const doc = await getDoc(novelPath(slug) + "/chapter/" + encodeURIComponent(num));
    let blocks = doc.querySelectorAll("article p, main p");
    if (blocks.length < 3) blocks = doc.querySelectorAll("p");
    const spam = /عالم الروايات|الموقع الرسمي|المحتوى المسروق|المترجم بقراءة|رواياتعرب|جميع الحقوق محفوظة/;
    return blocks
      .map((n) => n.text().trim())
      .filter((t) => t && !spam.test(t))
      .join("\n\n");
  },
};
