// Rewayat.club - Harbor eBook Source
const BASE = "https://rewayat.club";

async function getDoc(path) {
  const url = /^https?:\/\//i.test(path) ? path : BASE + (path.charAt(0) === "/" ? path : "/" + path);
  const res = await harbor.http(url, { responseType: "text" });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return harbor.parseHtml(res.body);
}

function abs(url) {
  if (!url) return undefined;
  const s = String(url).trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.indexOf("//") === 0) return "https:" + s;
  if (s.charAt(0) === "/") return BASE + s;
  return BASE + "/" + s;
}

function clean(s) {
  return String(s || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function pathOnly(href) {
  let s = String(href || "").split("#")[0].split("?")[0];
  s = s.replace(/^https?:\/\/[^/]+/i, "");
  return s.replace(/^\/+/, "");
}

function novelId(href) {
  const s = pathOnly(href);
  const m = s.match(/^novel\/([^/]+)\/?$/i);
  return m ? decodeURIComponent(m[1]) : "";
}

function chapterInfo(href) {
  const s = pathOnly(href);
  const m = s.match(/^novel\/([^/]+)\/(\d+)\/?$/i);
  if (!m) return null;
  return { id: s.replace(/\/$/, ""), novel: decodeURIComponent(m[1]), number: m[2] };
}

function novelCards(doc) {
  const out = [];
  const seen = {};
  const links = doc.querySelectorAll("a[href]");
  for (let i = 0; i < links.length; i++) {
    const a = links[i];
    const id = novelId(a.attr("href") || "");
    if (!id || seen[id]) continue;
    const img = a.querySelector("img");
    const title = clean(a.attr("title") || (img && img.attr("alt")) || a.text());
    if (!title) continue;
    seen[id] = true;
    out.push({
      id: id,
      title: title,
      cover: abs(img && (img.attr("data-src") || img.attr("data-lazy-src") || img.attr("src")))
    });
  }
  return out;
}

function chaptersFromDoc(doc, wanted, out, seen) {
  const links = doc.querySelectorAll("a[href]");
  for (let i = 0; i < links.length; i++) {
    const info = chapterInfo(links[i].attr("href") || "");
    if (!info || info.novel !== wanted || seen[info.id]) continue;
    seen[info.id] = true;
    out.push({
      id: info.id,
      chapter: info.number,
      title: clean(links[i].text()) || "الفصل " + info.number
    });
  }
}

const plugin = {
  id: "rewayat",
  name: "نادي الروايات",

  async popular(offset) {
    const page = Math.floor(Number(offset || 0) / 24) + 1;
    return novelCards(await getDoc("/library?page=" + page));
  },

  async search(query, offset) {
    const page = Math.floor(Number(offset || 0) / 24) + 1;
    return novelCards(await getDoc("/?s=" + encodeURIComponent(query) + "&page=" + page));
  },

  async detail(id) {
    const doc = await getDoc("/novel/" + encodeURIComponent(id));
    const h1 = doc.querySelector("h1");
    const meta = doc.querySelector("meta[property='og:image']");
    const img = doc.querySelector("img[data-src], img[data-lazy-src], img[src]");
    const desc = doc.querySelector(".description, .summary, [class*='description']");
    const title = clean(h1 ? h1.text() : id);
    if (!title) return null;
    return {
      id: id,
      title: title,
      cover: abs(meta ? meta.attr("content") : (img ? (img.attr("data-src") || img.attr("data-lazy-src") || img.attr("src")) : undefined)),
      description: desc ? clean(desc.text()) : undefined
    };
  },

  async chapters(id) {
    const wanted = String(id || "").replace(/^\/+|\/+$/g, "");
    const out = [];
    const seen = {};

    // The novel page contains the complete chapter list for normal novels.
    // Re-scan numbered pagination pages as well, so older/large novels are not truncated.
    for (let page = 1; page <= 200; page++) {
      const path = "/novel/" + encodeURIComponent(wanted) + (page === 1 ? "/" : "?page=" + page);
      const doc = await getDoc(path);
      const before = out.length;
      chaptersFromDoc(doc, wanted, out, seen);
      if (page > 1 && out.length === before) break;
    }

    out.sort((a, b) => Number(a.chapter) - Number(b.chapter));
    return out.map((c, i) => ({
      id: c.id,
      chapter: c.chapter,
      title: c.title,
      position: i,
      pages: 0,
      language: "ar"
    }));
  },

  async content(chapterId) {
    const doc = await getDoc("/" + String(chapterId).replace(/^\/+/, ""));
    const selectors = [
      ".chapter-content p",
      ".chapter-content",
      ".reading-content p",
      ".entry-content p",
      "article p"
    ];

    for (let i = 0; i < selectors.length; i++) {
      const nodes = doc.querySelectorAll(selectors[i]);
      if (nodes.length) {
        const text = nodes.map((n) => clean(n.text())).filter(Boolean).join("\n\n");
        if (text) return text;
      }
    }

    const article = doc.querySelector("article");
    return article ? clean(article.text()) : "";
  },

  async tags() {
    return [];
  }
};
