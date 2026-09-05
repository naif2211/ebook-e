// Rewayat.club - Harbor eBook Source
const BASE = "https://rewayat.club";

async function getDoc(path) {
  const url = /^https?:\/\//i.test(path) ? path : BASE + (path.charAt(0) === "/" ? path : "/" + path);
  const res = await harbor.http(url, { responseType: "text", timeoutMs: 20000 });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return harbor.parseHtml(res.body);
}

function abs(url) {
  if (!url) return undefined;
  const s = String(url).trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.indexOf("//") === 0) return "https:" + s;
  return s.charAt(0) === "/" ? BASE + s : BASE + "/" + s;
}

function clean(s) {
  return String(s || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function relativePath(href) {
  let s = String(href || "").split("#")[0].split("?")[0];
  s = s.replace(/^https?:\/\/rewayat\.club/i, "");
  return "/" + s.replace(/^\/+/, "");
}

function novelId(href) {
  const s = relativePath(href);
  const m = s.match(/^\/novel\/([^/]+)\/?$/i);
  return m ? decodeURIComponent(m[1]) : "";
}

function chapterInfo(href) {
  const s = relativePath(href);
  const m = s.match(/^\/novel\/([^/]+)\/(\d+)\/?$/i);
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
    const title = clean(a.attr("title") || (img && (img.attr("alt") || img.attr("title"))) || a.text());
    if (!title) continue;
    seen[id] = true;
    out.push({
      id: id,
      title: title,
      cover: abs(img && (img.attr("data-src") || img.attr("data-lazy-src") || img.attr("src"))),
      siteUrl: BASE + "/novel/" + encodeURIComponent(id) + "/"
    });
  }
  return out;
}

function extractChapters(doc, wanted) {
  const links = doc.querySelectorAll("a[href]");
  const out = [];
  const seen = {};
  for (let i = 0; i < links.length; i++) {
    const info = chapterInfo(links[i].attr("href") || "");
    if (!info || info.novel !== wanted || seen[info.number]) continue;
    const number = Number(info.number);
    if (!Number.isFinite(number) || number < 1 || number > 8000) continue;
    seen[info.number] = true;
    out.push({
      number: number,
      id: info.id,
      title: clean(links[i].text()) || "الفصل " + info.number
    });
  }
  out.sort(function(a, b) { return a.number - b.number; });
  return out;
}

function totalChapters(doc) {
  const text = clean(doc.text());
  const m = text.match(/الفصول\s*[\(（]\s*(\d+)\s*[\)）]/u);
  return m ? Number(m[1]) : 0;
}

function findContent(doc) {
  const selectors = [
    ".chapter-content",
    ".reading-content",
    ".entry-content",
    ".single-content",
    ".post-content",
    "article .entry-content",
    "article"
  ];
  for (let i = 0; i < selectors.length; i++) {
    const node = doc.querySelector(selectors[i]);
    if (node) return node;
  }
  return null;
}

function extractText(root) {
  if (!root) return "";
  const nodes = root.querySelectorAll("p, blockquote");
  const out = [];
  const seen = {};
  for (let i = 0; i < nodes.length; i++) {
    const text = clean(nodes[i].text());
    if (text && !seen[text]) {
      seen[text] = true;
      out.push(text);
    }
  }
  return out.length ? out.join("\n\n") : clean(root.text());
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
    const doc = await getDoc("/novel/" + encodeURIComponent(id) + "/");
    const h1 = doc.querySelector("h1");
    const og = doc.querySelector("meta[property='og:image']");
    const img = doc.querySelector("img[data-src], img[data-lazy-src], img[src]");
    const desc = doc.querySelector(".description, .summary, .novel-description, [class*='description']");
    const title = clean(h1 ? h1.text() : id);
    return {
      id: id,
      title: title,
      cover: abs(og ? og.attr("content") : (img ? (img.attr("data-src") || img.attr("data-lazy-src") || img.attr("src")) : undefined)),
      description: desc ? clean(desc.text()) : undefined,
      chapters: totalChapters(doc),
      siteUrl: BASE + "/novel/" + encodeURIComponent(id) + "/"
    };
  },

  async chapters(id) {
    const wanted = String(id || "").replace(/^\\/+|\\/+$/g, "");
    const first = await getDoc("/novel/" + encodeURIComponent(wanted) + "/");
    const total = totalChapters(first);
    const all = [];
    const seen = {};

    function add(doc) {
      const items = extractChapters(doc, wanted);
      for (let i = 0; i < items.length; i++) {
        if (!seen[items[i].id]) {
          seen[items[i].id] = true;
          all.push(items[i]);
        }
      }
    }

    add(first);

    const maxPages = total > 0 ? Math.ceil(total / 25) + 2 : 100;
    for (let page = 2; page <= maxPages; page++) {
      if (total > 0 && all.length >= total) break;
      const before = all.length;
      add(await getDoc("/novel/" + encodeURIComponent(wanted) + "/?page=" + page));
      if (all.length === before) break;
    }

    all.sort(function(a, b) {
      return Number(a.number) - Number(b.number);
    });

    return all.map(function(item, index) {
      return {
        id: item.id,
        chapter: String(item.number),
        title: item.title,
        position: index,
        pages: 0,
        language: "ar"
      };
    });
  }

  async content(chapterId) {
    const path = String(chapterId || "").replace(/^https?:\/\/rewayat\.club/i, "");
    const doc = await getDoc(path);
    return extractText(findContent(doc)) || extractText(doc);
  },

  async tags() {
    return [];
  }
};
