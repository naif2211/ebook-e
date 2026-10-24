// Harbor eBook source plugin: Kol Novel (ملوك الروايات) - https://kolnovel.com
//
// Built from the rendered text of /series/ and one series page. Anything marked
// "VERIFY" is a selector guess that needs checking against the raw HTML.

const BASE = "https://kolnovel.com";
const PAGE_SIZE = 20; // /series/ shows 20 cards per page (273 works / 14 pages)

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

// Slugs are Arabic. Normalise so encoded/raw hrefs give the same stable id.
function safeDecode(s) {
  try { return decodeURIComponent(s); } catch (_) { return s; }
}
function seriesIdFromHref(href) {
  const m = (href || "").match(/\/series\/([^/?#]+)/);
  return m ? safeDecode(m[1]) : "";
}
function seriesPath(id) {
  return "/series/" + encodeURIComponent(id) + "/";
}
function chapterIdFromHref(href) {
  // Chapter URLs sit at the site root (/shaag24...-298131/). Keep the decoded path.
  return safeDecode((href || "").replace(BASE, "").replace(/^\//, "").replace(/[?#].*$/, ""));
}
function chapterPath(id) {
  return "/" + encodeURIComponent(id).replace(/%2F/gi, "/");
}

function cleanTitle(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function mapStatus(text) {
  if (/مكتملة/.test(text || "")) return "completed";
  if (/متوقفة/.test(text || "")) return "hiatus";
  if (/مستمرة/.test(text || "")) return "ongoing";
  return undefined;
}

const TYPE_LANG = { chinese: "zh", japanese: "ja", korean: "ko", english: "en" };

// Filters confirmed from the site's own menu links:
//   ?type[]=japanese|korean|english|chinese, ?status=completed, ?order=update
function browseQuery(tagId) {
  const params = [];
  if (tagId?.startsWith("type:")) params.push("type%5B%5D=" + encodeURIComponent(tagId.slice(5)));
  if (tagId?.startsWith("status:")) params.push("status=" + encodeURIComponent(tagId.slice(7)));
  if (tagId?.startsWith("sort:")) params.push("order=" + encodeURIComponent(tagId.slice(5)));
  return params.length ? "&" + params.join("&") : "";
}

const FAN_GENRES = ["فان فيكشن", "فانفيك", "فان"];

// Card = block holding an <h3><a href="/series/..."> title. The container class is
// unknown (VERIFY), so try common wrappers and keep whichever matches real cards.
function findCards(doc) {
  for (const sel of ["article", "li", ".card", ".series-card", ".novel-card"]) {
    const els = doc.querySelectorAll(sel).filter((el) => el.querySelector("h3 a[href*='/series/']"));
    if (els.length) return els;
  }
  return [];
}

function cardToSummary(el) {
  const titleLink = el.querySelector("h3 a[href*='/series/']");
  if (!titleLink) return null;
  const id = seriesIdFromHref(titleLink.attr("href"));
  if (!id) return null;

  const text = el.text() || "";
  const img = el.querySelector("img");
  const rating = text.match(/★\s*([\d.]+)/);
  const genreBlock = text.match(/التصنيفات\s*([\s\S]*?)\s*الملخص/);
  const genres = genreBlock
    ? genreBlock[1].split("·").map((g) => g.trim()).filter(Boolean)
    : [];

  return {
    id,
    title: cleanTitle(titleLink.attr("title") || titleLink.text()),
    cover: abs(img?.attr("data-src") || img?.attr("src")),
    status: mapStatus(text),
    genres,
    score: rating ? Number(rating[1]) : undefined,
    // Harbor drops entries flagged true; remove this if you want fan fiction listed.
    isFanMade: genres.some((g) => FAN_GENRES.includes(g)),
  };
}

function parseCards(doc) {
  return findCards(doc).map(cardToSummary).filter(Boolean);
}

// Chapter titles look like "الفصل 12 · عنوان" (or "الفصل 12.5 · ...").
function parseChapterLabel(label) {
  const clean = cleanTitle(label);
  const m = clean.match(/الفصل\s+([\d.]+)\s*[·\-–:]?\s*(.*)$/);
  return m ? { chapter: m[1], title: m[2] || clean } : { chapter: undefined, title: clean };
}

const plugin = {
  id: "kolnovel",
  name: "Kol Novel (ملوك الروايات)",

  async popular(offset, tagId) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const doc = await getDoc("/series/?paged=" + page + browseQuery(tagId));
    return parseCards(doc);
  },

  // VERIFY: assumes the standard WordPress search param (?s=).
  async search(query, offset, tagId) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const doc = await getDoc(
      "/?s=" + encodeURIComponent(query) + "&post_type=series&paged=" + page + browseQuery(tagId),
    );
    return parseCards(doc);
  },

  async detail(id) {
    const doc = await getDoc(seriesPath(id));
    const h1 = doc.querySelector("h1");
    if (!h1) return null;
    const title = cleanTitle(h1.text());
    const pageText = doc.querySelector("main")?.text() || doc.text?.() || "";

    // The profile block lists الفصول / صدر في / اللغة / المشاهدات as label+value pairs.
    const chaptersMatch = pageText.match(/الفصول\s*(\d+)/);
    const langMatch = pageText.match(/اللغة\s*(الصينية|اليابانية|الكورية|الإنجليزية|العربية)/);
    const langKey = { "الصينية": "chinese", "اليابانية": "japanese", "الكورية": "korean", "الإنجليزية": "english" }[langMatch?.[1]];

    // Cover: the first uploaded image whose alt equals the series title (logo alt differs).
    const cover = doc
      .querySelectorAll("img")
      .find((i) => (i.attr("alt") || "").trim() === title && /wp-content\/uploads/.test(i.attr("src") || ""));

    return {
      id,
      title,
      // VERIFY: English/original title sits right under the h1 ("Mysterious Revival").
      altTitle: cleanTitle(doc.querySelector("h1 + p, h1 + div, h1 + span")?.text()) || undefined,
      cover: abs(cover?.attr("src")),
      // VERIFY: synopsis block under "القصة"; falls back to og-free empty value.
      description: cleanTitle(
        doc.querySelector("#about .synopsis, #about .summary, #about p, .synopsis, .summary")?.text(),
      ) || undefined,
      author: cleanTitle(doc.querySelector("a[href*='/writer/']")?.text()) || undefined,
      status: mapStatus(pageText.slice(0, 600)),
      chapters: chaptersMatch ? Number(chaptersMatch[1]) : undefined,
      originalLanguage: TYPE_LANG[langKey],
      genres: doc.querySelectorAll("a[href*='/genre/']").map((a) => cleanTitle(a.text())).filter(Boolean),
    };
  },

  // The chapter table is empty in the server HTML (filled by JS), so this tries, in order:
  //   1. rows already present in the page
  //   2. the paged URL the site itself links to (?chapter_volume&chapter_page=N#chapters)
  //   3. walking first chapter -> next links (slow, last resort)
  async chapters(id) {
    const out = [];
    const seen = new Set();
    const push = (a) => {
      const href = a.attr("href") || "";
      if (!href || seen.has(href) || /\/series\/|\/genre\/|\/type\/|\/writer\/|\/translators\//.test(href)) return;
      if (!/الفصل/.test(a.text() || "") ) return;
      seen.add(href);
      const { chapter, title } = parseChapterLabel(a.text());
      out.push({
        id: chapterIdFromHref(href),
        chapter,
        position: out.length,
        title,
        pages: 0,
        language: "ar",
      });
    };

    for (let page = 1; page <= 60; page++) {
      const suffix = page === 1 ? "" : "?chapter_volume&chapter_page=" + page;
      const doc = await getDoc(seriesPath(id) + suffix);
      const before = out.length;
      doc.querySelectorAll("#chapters a, table a, [class*='chapter'] a").forEach(push);
      if (out.length === before) break; // nothing new: last page (or JS-only list)
    }
    if (out.length) return out;

    // Fallback: follow "next" links from the "ابدأ القراءة" button.
    const first = (await getDoc(seriesPath(id))).querySelector("a[href*='shaag24'], a[href*='/ابدأ']");
    let href = first?.attr("href");
    for (let i = 0; href && i < 2000 && !seen.has(href); i++) {
      seen.add(href);
      const doc = await getDoc(href);
      const { chapter, title } = parseChapterLabel(doc.querySelector("h1")?.text() || "");
      out.push({ id: chapterIdFromHref(href), chapter, position: out.length, title, pages: 0, language: "ar" });
      href = doc.querySelector("a[rel='next']")?.attr("href"); // VERIFY next-link selector
    }
    return out;
  },

  // VERIFY: reader container selector. Falls back to every <p> inside <article>/<main>.
  async content(chapterId) {
    const doc = await getDoc(chapterPath(chapterId));
    let blocks = doc.querySelectorAll(
      ".chapter-content > p, .reader-content > p, #chapter-content > p, .entry-content > p",
    );
    if (!blocks.length) blocks = doc.querySelectorAll("article p, main p");
    // Source order only: never sort, reverse, or dedupe Arabic prose.
    return blocks.map((n) => n.text().trim()).filter(Boolean).join("\n\n");
  },

  async tags() {
    return [
      { id: "type:chinese", name: "صينية", group: "Type" },
      { id: "type:japanese", name: "يابانية", group: "Type" },
      { id: "type:korean", name: "كورية", group: "Type" },
      { id: "type:english", name: "إنجليزية", group: "Type" },
      { id: "status:completed", name: "مكتملة", group: "Status" },
      { id: "sort:update", name: "آخر التحديثات", group: "Sort" },
    ];
  },
};
