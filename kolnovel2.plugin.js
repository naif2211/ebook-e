// KolNovel 2 - Harbor eBook Source
// https://kolnovel.com

const BASE = "https://kolnovel.com";

async function getDoc(path) {
  const url = /^https?:\/\//i.test(path)
    ? path
    : BASE + (path.startsWith("/") ? path : "/" + path);

  const res = await harbor.http(url, { responseType: "text" });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return harbor.parseHtml(res.body);
}

function abs(url) {
  if (!url) return undefined;
  url = String(url).trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function clean(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chapterNumber(text) {
  const s = clean(text);
  let m = s.match(/الفصل\s*[:#-]?\s*(\d+(?:\.\d+)?)/iu);
  if (m) return m[1];
  m = s.match(/chapter\s*[:#-]?\s*(\d+(?:\.\d+)?)/i);
  if (m) return m[1];
  m = s.match(/(?:^|\s)(\d+(?:\.\d+)?)(?:\s|$)/);
  return m ? m[1] : undefined;
}

function seriesId(href) {
  if (!href) return "";
  let s = String(href).trim();
  if (/^https?:\/\//i.test(s)) {
    s = s.replace(/^https?:\/\/[^/]+/i, "");
  }
  s = s.split("#")[0].split("?")[0];
  return s.replace(/^\/+/, "").replace(/\/+$/, "");
}

function seriesLinks(doc) {
  const out = [];
  const seen = {};
  const links = doc.querySelectorAll("a[href]");

  for (let i = 0; i < links.length; i++) {
    const a = links[i];
    const href = a.attr("href") || "";
    if (!/\/series\//i.test(href)) continue;

    const id = seriesId(href);
    if (!id || seen[id]) continue;

    const img = a.querySelector("img");
    const title = clean(
      a.attr("title") ||
      a.attr("aria-label") ||
      img?.attr("alt") ||
      a.text()
    );

    if (!title) continue;

    seen[id] = true;
    out.push({
      id,
      title,
      cover: abs(
        img?.attr("data-src") ||
        img?.attr("data-lazy-src") ||
        img?.attr("src")
      ),
    });
  }

  return out;
}

const plugin = {
  id: "kolnovel2",
  name: "KolNovel 2",

  async popular(offset) {
    const page = Math.floor(Number(offset || 0) / 48) + 1;
    const path = page > 1 ? "/series/?page=" + page : "/series/";
    const doc = await getDoc(path);
    return seriesLinks(doc);
  },

  async search(query, offset) {
    const page = Math.floor(Number(offset || 0) / 48) + 1;
    const params = new URLSearchParams();
    params.set("s", query || "");
    if (page > 1) params.set("page", String(page));
    const doc = await getDoc("/?" + params.toString());
    return seriesLinks(doc);
  },

  async detail(id) {
    const cleanId = String(id || "").replace(/^\/+|\/+$/g, "");
    const path = cleanId.startsWith("series/") ? "/" + cleanId + "/" : "/series/" + cleanId + "/";
    const doc = await getDoc(path);

    const h1 = doc.querySelector("h1");
    const title = clean(h1?.text() || doc.querySelector(".entry-title")?.text());
    if (!title) return null;

    const imgs = doc.querySelectorAll("img");
    let cover;
    for (let i = 0; i < imgs.length; i++) {
      const src = imgs[i].attr("data-src") || imgs[i].attr("data-lazy-src") || imgs[i].attr("src");
      const alt = clean(imgs[i].attr("alt"));
      if (src && (alt === title || i < 5)) {
        cover = abs(src);
        if (alt === title) break;
      }
    }

    const description = clean(
      doc.querySelector(".summary")?.text() ||
      doc.querySelector(".description")?.text() ||
      doc.querySelector(".desc")?.text() ||
      doc.querySelector(".series-description")?.text()
    );

    const authorLinks = doc.querySelectorAll("a[href*='/author/']");
    const author = authorLinks.length ? clean(authorLinks[0].text()) : clean(doc.querySelector(".author")?.text());

    const genres = [];
    const genreLinks = doc.querySelectorAll("a[href*='/genre/']");
    for (let i = 0; i < genreLinks.length; i++) {
      const g = clean(genreLinks[i].text());
      if (g && genres.indexOf(g) < 0) genres.push(g);
    }

    const pageText = clean(doc.text());
    let status;
    if (/\bOngoing\b/i.test(pageText)) status = "ongoing";
    else if (/مكتملة|مكتمل|Completed/i.test(pageText)) status = "completed";
    else if (/متوقفة|متوقف|Hiatus/i.test(pageText)) status = "hiatus";

    return {
      id: cleanId,
      title,
      cover,
      description,
      author,
      status,
      genres,
    };
  },

  async chapters(id) {
    const cleanId = String(id || "").replace(/^\/+|\/+$/g, "");
    const path = cleanId.startsWith("series/") ? "/" + cleanId + "/" : "/series/" + cleanId + "/";
    const doc = await getDoc(path);

    // KolNovel exposes the chapter list as normal HTML links on the series page.
    // Select by the visible chapter label, not by a fragile URL/class pattern.
    const links = doc.querySelectorAll("a[href]");
    const chapters = [];
    const seen = {};

    for (let i = 0; i < links.length; i++) {
      const a = links[i];
      const href = a.attr("href") || "";
      const text = clean(a.text());
      if (!href || !text) continue;

      const n = chapterNumber(text);
      if (!n) continue;

      // Real KolNovel chapter links contain /shaag24 in their URL.
      // The text check above prevents unrelated navigation links.
      if (!/\/shaag24/i.test(href) && !/\/chapter[-_/]/i.test(href)) continue;

      const chapterId = href.split("#")[0].replace(/^\/+/, "");
      if (!chapterId || seen[chapterId]) continue;
      seen[chapterId] = true;

      chapters.push({
        id: chapterId,
        chapter: n,
        position: chapters.length,
        title: text,
        pages: 0,
        language: "ar",
      });
    }

    chapters.sort(function(a, b) {
      const na = Number(a.chapter);
      const nb = Number(b.chapter);
      if (isFinite(na) && isFinite(nb)) return na - nb;
      return a.position - b.position;
    });

    for (let i = 0; i < chapters.length; i++) chapters[i].position = i;
    return chapters;
  },

  async content(chapterId) {
    const path = "/" + String(chapterId || "").replace(/^\/+/, "");
    const doc = await getDoc(path);

    // The chapter text is server-rendered. Prefer the actual article content.
    const root =
      doc.querySelector(".entry-content") ||
      doc.querySelector(".chapter-content") ||
      doc.querySelector(".reading-content") ||
      doc.querySelector("article");

    if (!root) return "";

    const nodes = root.querySelectorAll("p, blockquote");
    const paragraphs = [];

    for (let i = 0; i < nodes.length; i++) {
      const text = clean(nodes[i].text());
      if (text) paragraphs.push(text);
    }

    return paragraphs.length ? paragraphs.join("\n\n") : clean(root.text());
  },

  async tags() {
    return [
      { id: "status:ongoing", name: "Ongoing", group: "Status" },
      { id: "status:completed", name: "Completed", group: "Status" },
      { id: "status:hiatus", name: "Hiatus", group: "Status" },
    ];
  },
};
