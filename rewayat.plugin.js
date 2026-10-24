// Harbor eBook source plugin for رواياتعرب (riwayatarab.com).
//
// Verified from the live site: URL structure, pagination, chapter-list paging, and the
// watermark lines inside chapters. Written from the rendered page text, NOT the raw HTML:
// the CSS class names are unknown, so selectors are anchor-href based with text parsing.
// Lines marked CHECK are the ones most likely to need adjusting after a first test run.

const BASE = "https://riwayatarab.com";
const PAGE = 20; // /latest shows 20 novels per page
const CH_PAGE = 50; // /novel/<slug>/chapters shows 50 chapters per page

async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType: "text" });
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

const STATUS = { "مستمرة": "ongoing", "مكتملة": "completed", "متوقفة": "hiatus" };
const STATUS_RE = /(مستمرة|مكتملة|متوقفة)/;

const stripMarks = (s) => (s || "").replace(/[\u064B-\u065F\u0670\u0640]/g, "");

// Novel cards on /latest: one <a href="/novel/<slug>"> whose text is
// "<title> <status> <title> بقلم: <author> <synopsis> <genre> <views> <chapters> 0 آخر تحديث: <date>"
function cardToSummary(a) {
  const href = a.attr("href") || "";
  if (!/^\/novel\/[^/]+\/?$/.test(href)) return null;
  const text = (a.text() || "").replace(/\s+/g, " ").trim();
  if (!text) return null;

  const st = text.match(STATUS_RE);
  let title = st ? text.slice(0, st.index) : text.split("بقلم:")[0];
  title = title.trim();
  if (!title) return null;

  const tail = text.match(/([\d.,]+\s?[كKM]?)\s+(\d+)\s+\d+\s+آخر تحديث/);
  const img = a.querySelector("img");

  return {
    id: href.replace(/^\/novel\//, "").replace(/\/$/, ""),
    title,
    cover: abs(img?.attr("src")), // CHECK: cards may carry no <img>; detail() always fills the cover
    status: st ? STATUS[st[1]] : undefined,
    chapters: tail ? Number(tail[2]) || undefined : undefined,
    trendingScore: undefined,
    isFanMade: false,
  };
}

async function latestPage(page) {
  const doc = await getDoc("/latest?page=" + page);
  const seen = new Set();
  const out = [];
  for (const a of doc.querySelectorAll("a")) {
    const s = cardToSummary(a);
    if (s && !seen.has(s.id)) {
      seen.add(s.id);
      out.push(s);
    }
  }
  return out;
}

// Chapter body: keep DOM order, drop the site's injected watermark / promo lines.
function isJunk(line) {
  const flat = line.replace(/[\s*_\-]/g, "");
  return (
    /حقوق\$\$.*\$\$/.test(flat) ||
    /عالمالروايات/.test(flat) ||
    /kol?no?vel/i.test(flat) ||
    /مو.?قع.?ملوك/.test(flat) ||
    /موقعكالمفضللقراءة/.test(flat) ||
    /جميعالحقوقمحفوظة/.test(flat)
  );
}

const plugin = {
  id: "riwayatarab",
  name: "رواياتعرب",

  // /latest is server-rendered. /search?sort=views is client-rendered, so it can't be scraped.
  async popular(offset, tagId) {
    const page = Math.floor(offset / PAGE) + 1;
    return latestPage(page);
  },

  // /search is client-rendered (empty HTML), so there is no HTML to parse. Fallback: scan
  // /latest pages (37 of them, ~740 novels) in small parallel batches and filter by title.
  // Replace this once you find the JSON endpoint the search page calls (DevTools > Network).
  async search(query, offset, tagId) {
    if (offset > 0) return []; // all matches are returned on the first call
    const q = stripMarks(query).toLowerCase().trim();
    if (!q) return [];
    const doc1 = await getDoc("/latest");
    const last = Math.max(
      1,
      ...doc1
        .querySelectorAll("a")
        .map((a) => (a.attr("href") || "").match(/^\/latest\?page=(\d+)/))
        .filter(Boolean)
        .map((m) => Number(m[1])),
    );
    const hits = [];
    const seen = new Set();
    for (let start = 1; start <= last; start += 6) {
      const batch = [];
      for (let p = start; p < start + 6 && p <= last; p++) batch.push(latestPage(p).catch(() => []));
      for (const list of await Promise.all(batch)) {
        for (const s of list) {
          if (!seen.has(s.id) && stripMarks(s.title).toLowerCase().includes(q)) {
            seen.add(s.id);
            hits.push(s);
          }
        }
      }
    }
    return hits;
  },

  async detail(id) {
    const doc = await getDoc("/novel/" + id);
    const title = doc.querySelector("h1")?.text()?.trim();
    if (!title) return null;
    const body = ((doc.querySelector("body") || doc).text?.() || "").replace(/\s+/g, " ");

    const st = body.match(STATUS_RE);
    const author = body.match(/بقلم:\s*(.+?)\s+[\d.,]+\s?[كKM]?\s*مشاهدة/)?.[1]?.trim();
    const total = body.match(/(\d+)\s*فصل/)?.[1];
    // CHECK: if text() collapses differently, fall back to the (truncated) meta description.
    const description =
      body.match(/نبذة عن الرواية\s*(.+?)\s*قائمة الفصول/)?.[1]?.trim() ||
      doc.querySelector("meta[name='description']")?.attr("content");

    const imgs = doc.querySelectorAll("img");
    const poster = imgs.find((i) => (i.attr("alt") || "").trim() === title) || imgs[0];
    const cover =
      abs(poster?.attr("src")) || abs(doc.querySelector("meta[property='og:image']")?.attr("content"));

    const genres = doc
      .querySelectorAll("a")
      .filter((a) => (a.attr("href") || "").includes("/search?category="))
      .map((a) => a.text().trim())
      .filter(Boolean);

    return {
      id,
      title,
      cover,
      description,
      status: st ? STATUS[st[1]] : undefined,
      author: author && author !== "غير محدد" ? author : undefined, // "غير محدد" = "unspecified"
      chapters: total ? Number(total) : undefined,
      originalLanguage: "ar",
      genres,
    };
  },

  // /novel/<slug>/chapters?page=N, 50 per page, ascending by default.
  async chapters(id) {
    const first = await getDoc("/novel/" + id + "/chapters");
    const pageCount = Math.max(
      1,
      Number(((first.querySelector("body") || first).text?.() || "").match(/الصفحة\s*\d+\s*من\s*(\d+)/)?.[1]) || 1,
    );

    const docs = [first];
    for (let start = 2; start <= pageCount; start += 6) {
      const batch = [];
      for (let p = start; p < start + 6 && p <= pageCount; p++) {
        batch.push(getDoc("/novel/" + id + "/chapters?page=" + p));
      }
      docs.push(...(await Promise.all(batch)));
    }

    const out = [];
    const seen = new Set();
    for (const doc of docs) {
      for (const a of doc.querySelectorAll("a")) {
        const href = a.attr("href") || "";
        const m = href.match(/^\/novel\/[^/]+\/chapter\/(\d+)\/?$/);
        if (!m || seen.has(href)) continue;
        seen.add(href);
        const text = (a.text() || "").replace(/\s+/g, " ").trim();
        // Text is "الفصل 12الفصل 12 75": label twice, then the view count.
        const views = text.match(/\s(\d[\d.,]*\s?[كKM]?)$/)?.[1];
        out.push({
          id: href.replace(/^\//, ""),
          chapter: m[1],
          position: out.length,
          title: "الفصل " + m[1],
          pages: 0,
          language: "ar",
          views: views || undefined,
        });
      }
    }
    return out;
  },

  async content(chapterId) {
    const doc = await getDoc("/" + chapterId);
    // CHECK: assumes prose is in <p>. If a chapter comes back empty, inspect the real container.
    const scope = doc.querySelector("article") || doc.querySelector("main") || doc;
    let lines = scope.querySelectorAll("p").map((p) => p.text().trim());
    if (!lines.some(Boolean)) {
      lines = (scope.text() || "").split(/\n+/).map((l) => l.trim());
    }
    return lines.filter((l) => l && !isJunk(l)).join("\n\n");
  },
};
