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
  for (const sel of [".kol-series-archive__item", "article", "li"]) {
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
    const h1 = doc.querySelector("h1.kol-series-editorial__title") || doc.querySelector("h1");
    if (!h1) return null;
    const title = cleanTitle(h1.text());

    // Quick facts: <dl class="kol-series-editorial__quick-facts"><div><dt>الفصول</dt><dd>559</dd>...
    const facts = {};
    doc.querySelectorAll(".kol-series-editorial__quick-facts > div").forEach((row) => {
      const k = cleanTitle(row.querySelector("dt")?.text());
      if (k) facts[k] = cleanTitle(row.querySelector("dd")?.text());
    });
    const lang = facts["اللغة"] || "";
    const originalLanguage = /صينية/.test(lang) ? "zh" : /يابانية/.test(lang) ? "ja"
      : /كورية/.test(lang) ? "ko" : /إنج/.test(lang) ? "en" : /عربية/.test(lang) ? "ar" : undefined;

    return {
      id,
      title,
      cover: abs(doc.querySelector(".kol-series-editorial__cover img")?.attr("src")),
      // The full synopsis block also contains a donation widget, so use the clean preview.
      description: cleanTitle(doc.querySelector(".kol-series-editorial__synopsis-preview")?.text()) || undefined,
      author: cleanTitle(doc.querySelector(".kol-series-editorial__byline a")?.text()) || undefined,
      status: mapStatus(doc.querySelector(".kol-series-editorial__status")?.text()),
      chapters: Number((facts["الفصول"] || "").replace(/\D/g, "")) || undefined,
      originalLanguage,
      genres: doc.querySelectorAll(".kol-series-editorial__genres a").map((a) => cleanTitle(a.text())).filter(Boolean),
    };
  },

  // The series page ships empty chapter lists. The site fills each volume through
  //   GET /wp-admin/admin-ajax.php?action=kol_series_volume_chapters
  //       &nonce=<data-kol-volume-nonce>&series_id=<data-kol-series-id>
  //       &volume=<data-kol-chapter-volume>&page=N&anchor_id=0
  // returning {success, data:{html, page, pages, total}}. Pages are newest-first, and
  // volumes are listed newest-first, so both are reversed into reading order.
  async chapters(id) {
    const main = await getDoc(seriesPath(id));
    const index = main.querySelector("[data-kol-chapter-index]");
    if (!index) return [];
    const nonce = index.attr("data-kol-volume-nonce") || "";
    const seriesNumericId = index.attr("data-kol-series-id") || "";
    const ajax = index.attr("data-kol-volume-url") || BASE + "/wp-admin/admin-ajax.php";
    const volumeNames = main.querySelectorAll("details[data-kol-chapter-volume]")
      .map((d) => d.attr("data-kol-chapter-volume") ?? "");

    async function fetchVolumePage(volume, page) {
      const url = ajax + "?action=kol_series_volume_chapters"
        + "&nonce=" + encodeURIComponent(nonce)
        + "&series_id=" + encodeURIComponent(seriesNumericId)
        + "&volume=" + encodeURIComponent(volume)
        + "&page=" + page + "&anchor_id=0";
      const res = await harbor.http(url, { responseType: "text", headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("http " + res.status + " for volume " + volume);
      const json = JSON.parse(res.body);
      if (!json?.success || typeof json.data?.html !== "string") throw new Error("bad volume response");
      return json.data;
    }

    const perVolume = [];
    for (const volume of volumeNames) {
      const rows = [];
      let pages = 1;
      for (let page = 1; page <= pages && page <= 100; page++) {
        const data = await fetchVolumePage(volume, page);
        pages = data.pages || 1;
        const doc = harbor.parseHtml("<ul>" + data.html + "</ul>");
        let items = doc.querySelectorAll("li[data-chapter-id]");
        if (!items.length) items = doc.querySelectorAll("li");
        items.forEach((li) => {
          const a = li.querySelector("a[href]");
          const href = a?.attr("href");
          if (!href) return;
          rows.push({
            href,
            number: cleanTitle(li.querySelector("[data-kol-chapter-number]")?.text()),
            title: cleanTitle(li.querySelector("[data-kol-chapter-title]")?.text()),
            label: cleanTitle(a.text()),
            date: li.querySelector("time")?.attr("datetime") || undefined,
          });
        });
      }
      perVolume.push({ volume, rows: rows.reverse() }); // oldest first inside the volume
    }
    perVolume.reverse(); // oldest volume first

    const out = [];
    const seen = new Set();
    for (const { volume, rows } of perVolume) {
      const volNumber = volume.match(/المجلد\s*([\d.]+)/)?.[1];
      for (const r of rows) {
        if (seen.has(r.href)) continue;
        seen.add(r.href);
        const parsed = parseChapterLabel(r.label);
        out.push({
          id: chapterIdFromHref(r.href),
          chapter: (r.number.match(/[\d.]+/)?.[0]) || parsed.chapter,
          position: out.length,
          title: r.title || parsed.title,
          volume: volNumber, // only when the source names it, e.g. "المجلد 12" -> "12"
          volumeTitle: volume || undefined,
          pages: 0,
          language: "ar",
          publishAt: r.date,
        });
      }
    }
    return out;
  },

  // Reader body is [data-kol-reader-content] (named in the site's reader JS); VERIFY on a chapter page.
  async content(chapterId) {
    const doc = await getDoc(chapterPath(chapterId));
    let blocks = doc.querySelectorAll("[data-kol-reader-content] p");
    if (!blocks.length) blocks = doc.querySelectorAll(".entry-content > p, .chapter-content > p");
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
