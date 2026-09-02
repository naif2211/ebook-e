// KolNovel 2 - Harbor eBook Source
const BASE = "https://kolnovel.com";

async function getDoc(path) {
  const url = /^https?:\/\//i.test(path) ? path : BASE + (path.charAt(0) === "/" ? path : "/" + path);
  const res = await harbor.http(url, { responseType: "text", timeoutMs: 20000 });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return harbor.parseHtml(res.body);
}

function abs(url) {
  if (!url) return undefined;
  var v = String(url).trim();
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.indexOf("//") === 0) return "https:" + v;
  if (v.charAt(0) === "/") return BASE + v;
  return BASE + "/" + v;
}

function clean(v) {
  return String(v || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function seriesId(href) {
  var url = abs(href);
  if (!url) return "";
  var m = url.match(/\/series\/([^/?#]+)\/?(?:[?#].*)?$/i);
  if (!m) return "";
  try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
}

function seriesPath(id) {
  return "/series/" + encodeURIComponent(id) + "/";
}

function chapterNumber(text) {
  var m = clean(text).match(/(?:الفصل|فصل|chapter|ch\.?)\s*[:#-]?\s*(\d+(?:\.\d+)?)/iu);
  return m ? m[1] : undefined;
}

function getResults(doc) {
  var links = doc.querySelectorAll("a[href]");
  var out = [];
  var seen = {};
  for (var i = 0; i < links.length; i++) {
    var href = links[i].attr("href") || "";
    if (!/\/series\//i.test(href)) continue;
    var id = seriesId(href);
    if (!id || seen[id]) continue;
    var img = links[i].querySelector("img");
    var title = clean(links[i].attr("title") || links[i].attr("aria-label") || (img && (img.attr("alt") || img.attr("title"))) || links[i].text());
    if (!title) continue;
    seen[id] = true;
    out.push({ id: id, title: title, cover: abs(img && (img.attr("data-src") || img.attr("data-lazy-src") || img.attr("src"))), isFanMade: false });
  }
  return out;
}

async function trySearch(q, offset, tagId) {
  var page = Math.floor(Number(offset || 0) / 20) + 1;
  var encoded = encodeURIComponent(q);
  var paths = [
    "/series/?search=" + encoded + "&page=" + page,
    "/series/?searchTerm=" + encoded + "&page=" + page,
    "/?s=" + encoded + "&page=" + page
  ];
  for (var i = 0; i < paths.length; i++) {
    try {
      var r = getResults(await getDoc(paths[i]));
      if (r.length) return r;
    } catch (_) {}
  }
  return [];
}

const plugin = {
  id: "kolnovel2",
  name: "KolNovel 2",

  async popular(offset) {
    var page = Math.floor(Number(offset || 0) / 20) + 1;
    return getResults(await getDoc("/series/?page=" + page));
  },

  async search(query, offset, tagId) {
    var q = clean(query);
    if (!q) return [];
    return trySearch(q, offset, tagId);
  },

  async detail(id) {
    var doc = await getDoc(seriesPath(id));
    var h1 = doc.querySelector("h1");
    var title = clean(h1 ? h1.text() : id);
    if (!title) return null;
    var img = doc.querySelector("img.wp-post-image") || doc.querySelector(".summary_image img") || doc.querySelector("img[data-src]") || doc.querySelector("img[src]");
    var desc = doc.querySelector(".description") || doc.querySelector(".summary") || doc.querySelector(".desc") || doc.querySelector(".series-description");
    var author = doc.querySelector(".author a") || doc.querySelector(".author");
    return { id: id, title: title, cover: abs(img && (img.attr("data-src") || img.attr("data-lazy-src") || img.attr("src"))), description: desc ? clean(desc.text()) : undefined, author: author ? clean(author.text()) : undefined, isFanMade: false };
  },

  async chapters(id) {
    var doc = await getDoc(seriesPath(id));
    var links = doc.querySelectorAll("a[href]");
    var out = [];
    var seen = {};
    for (var i = 0; i < links.length; i++) {
      var href = links[i].attr("href") || "";
      if (!/\/shaag/i.test(href)) continue;
      var url = abs(href);
      var title = clean(links[i].text());
      var num = chapterNumber(title);
      if (!num) {
        var m = url && url.match(/-(\d+)\/?(?:[?#].*)?$/);
        if (m) num = m[1];
      }
      if (!url || !num) continue;
      var cid = url.replace(/^https?:\/\/[^/]+\//i, "").replace(/\/$/, "");
      if (seen[cid]) continue;
      seen[cid] = true;
      out.push({ id: cid, chapter: num, title: title || ("Chapter " + num), position: out.length, pages: 0, language: "ar" });
    }
    out.sort(function(a,b) { return Number(a.chapter) - Number(b.chapter); });
    for (var j = 0; j < out.length; j++) out[j].position = j;
    return out;
  },

  async content(chapterId) {
    var doc = await getDoc("/" + String(chapterId).replace(/^\/+/, "").replace(/\/+$/, "") + "/");
    var root = doc.querySelector(".entry-content") || doc.querySelector(".reading-content") || doc.querySelector(".chapter-content") || doc.querySelector(".single-content") || doc.querySelector("article");
    if (!root) return "";
    var nodes = root.querySelectorAll("p, blockquote");
    var text = [];
    for (var i = 0; i < nodes.length; i++) { var t = clean(nodes[i].text()); if (t) text.push(t); }
    return text.length ? text.join("\n\n") : clean(root.text());
  },

  async tags() {
    return [
      { id: "sort:popular", name: "Popular", group: "Sort" },
      { id: "sort:chapters", name: "Chapters", group: "Sort" },
      { id: "sort:rating", name: "Rating", group: "Sort" },
      { id: "status:ongoing", name: "Ongoing", group: "Status" },
      { id: "status:completed", name: "Completed", group: "Status" },
      { id: "status:hiatus", name: "Hiatus", group: "Status" }
    ];
  }
};
