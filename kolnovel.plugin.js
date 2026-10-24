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

  // The chapter table is empty in the server HTML (filled by JS); only the first and
  // last chapter links are present. So:
  //   1. read the expected count and the first/last links from the series page
  //   2. try the paged URLs / any rows present
  //   3. if fewer chapters than expected were found, walk first -> next -> ... -> last
  async chapters(id) {
    const out = [];
    const seen = new Set();
    const isChapterHref = (href) =>
      href && !/\/series\/|\/genre\/|\/type\/|\/writer\/|\/translators\/|\/login|\/library|\/offline|\/account|\/customize|#/.test(href);
    const push = (href, label) => {
      if (!isChapterHref(href) || seen.has(href)) return;
      seen.add(href);
      const { chapter, title } = parseChapterLabel(label);
      out.push({ id: chapterIdFromHref(href), chapter, position: out.length, title, pages: 0, language: "ar" });
    };

    const main = await getDoc(seriesPath(id));
    const expected = Number((main.querySelector("main")?.text() || "").match(/الفصول\s*(\d+)/)?.[1]) || 0;
    const links = main.querySelectorAll("a").filter((a) => /الفصل/.test(a.text() || "") && isChapterHref(a.attr("href")));
    const firstHref = links[0]?.attr("href");
    const lastHref = links[links.length - 1]?.attr("href");

    // Step 2: rows present in the page or in the paged URLs.
    for (let page = 1; page <= 60; page++) {
      const doc = page === 1 ? main : await getDoc(seriesPath(id) + "?chapter_volume&chapter_page=" + page);
      const before = out.length;
      doc.querySelectorAll("a").forEach((a) => {
        if (/الفصل/.test(a.text() || "")) push(a.attr("href"), a.text());
      });
      if (out.length === before) break;
    }
    if (out.length >= Math.max(expected, 3)) return out;

    // Step 3: walk the next-chapter chain. Sequential by nature, so it is slow.
    out.length = 0;
    seen.clear();
    let href = firstHref;
    for (let i = 0; href && i < 3000 && !seen.has(href); i++) {
      const doc = await getDoc(href);
      const heading = doc.querySelector("h1")?.text() || doc.querySelector("title")?.text() || "";
      push(href, heading);
      if (href === lastHref) break;
      const anchors = doc.querySelectorAll("a");
      const next =
        doc.querySelector("a[rel='next']") ||
        doc.querySelector("a[class*='next']") ||
        anchors.find((a) => /التالي/.test(a.text() || "") && isChapterHref(a.attr("href")));
      href = next?.attr("href");
    }
    // Make sure the last chapter is present even if the chain broke early.
    if (lastHref && !seen.has(lastHref)) push(lastHref, "");
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
