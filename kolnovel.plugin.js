// Harbor eBook source plugin for kolnovel.com

const BASE = "https://kolnovel.com";

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

function cleanTitle(value) {
  return (value || "")
    .replace(/[^\p{L}\p{N}'’]+/gu, " ")
    .replace(/\s+(?:kol|كول)$/iu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function browseQuery(tagId) {
  const params = new URLSearchParams();
  if (tagId?.startsWith("status:")) params.set("status", tagId.slice(7));
  if (tagId?.startsWith("sort:")) params.set("sort", tagId.slice(5));
  const query = params.toString();
  return query ? "&" + query : "";
}

function cardToSummary(el) {
  const link = el.querySelector("a");
  const img = el.querySelector("img");
  if (!link) return null;
  const rawTitle = (link.attr("title") || el.querySelector(".title")?.text() || "").trim();
  const href = link.attr("href") || "";
  
  return {
    id: href.replace(BASE, "").replace(/^\/ebook\//, "").replace(/^\//, "").replace(/\/$/, ""),
    title: cleanTitle(rawTitle),
    cover: abs(img?.attr("data-src") || img?.attr("src")),
    isFanMade: /(?:fan[ -]?made|fan edition|نسخة\s*الفان)/iu.test(rawTitle),
  };
}

const plugin = {
  id: "kolnovel",
  name: "KolNovel",

  async popular(offset, tagId) {
    const page = Math.floor(offset / 24) + 1;
    const filters = browseQuery(tagId);
    const doc = await getDoc("/page/" + page + "/?s=&post_type=wp-manga" + filters);
    return doc.querySelectorAll(".page-item-detail, .manga, .card").map(cardToSummary).filter(Boolean);
  },

  async search(query, offset, tagId) {
    const page = Math.floor(offset / 24) + 1;
    const filters = browseQuery(tagId);
    const doc = await getDoc("/?s=" + encodeURIComponent(query) + "&post_type=wp-manga" + filters);
    return doc.querySelectorAll(".page-item-detail, .manga, .card").map(cardToSummary).filter(Boolean);
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + id + "/");
    const root = doc.querySelector(".site-content, .profile-manga, body");
    if (!root) return null;
    
    const rawTitle = doc.querySelector(".post-title h1")?.text() || id;
    
    return {
      id,
      title: cleanTitle(rawTitle),
      cover: abs(doc.querySelector(".summary_image img")?.attr("src")),
      description: doc.querySelector(".description-summary, .summary__content")?.text(),
      status: doc.querySelector(".post-status .summary-content")?.text(),
      author: doc.querySelector(".author-content")?.text(),
      genres: doc.querySelectorAll(".genres-content a").map((node) => node.text()).filter(Boolean),
    };
  },

  async chapters(id) {
    const doc = await getDoc("/manga/" + id + "/ajax/chapters/");
    const chapterElements = doc.querySelectorAll(".wp-manga-chapter");
    
    if (chapterElements.length === 0) {
      const mainDoc = await getDoc("/manga/" + id + "/");
      const list = mainDoc.querySelectorAll(".li.wp-manga-chapter, .sub-ch-list li");
      return list.map((li, position) => {
        const a = li.querySelector("a");
        const href = a?.attr("href") || "";
        return {
          id: href.replace(BASE, "").replace(/^\//, "").replace(/\/$/, ""),
          chapter: a?.text().trim(),
          position,
          title: a?.text().trim(),
          language: "ar",
          publishAt: li.querySelector(".chapter-release-date")?.text()?.trim(),
        };
      }).filter((c) => c.id);
    }

    return chapterElements.map((li, position) => {
      const a = li.querySelector("a");
      const href = a?.attr("href") || "";
      return {
        id: href.replace(BASE, "").replace(/^\//, "").replace(/\/$/, ""),
        chapter: a?.text().trim(),
        position,
        title: a?.text().trim(),
        language: "ar",
        publishAt: li.querySelector(".chapter-release-date")?.text()?.trim(),
      };
    }).filter((c) => c.id);
  },

  async content(chapterId) {
    const doc = await getDoc("/" + chapterId + "/");
    const blocks = doc.querySelectorAll(".reading-content p, .text-left p, .reading-content div");
    return blocks.map((node) => node.text().trim()).filter(Boolean).join("\n\n");
  },
};