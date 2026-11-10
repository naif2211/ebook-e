// Harbor eBook source for RiwayatArab
// v1.8.7 - tolerant chapter-link extraction for Harbor parsed pages.
const BASE = "https://riwayatarab.com";
const PAGE_SIZE = 20;

async function getDoc(path) {
  const url = /^https?:\/\//i.test(path) ? path : BASE + (path.startsWith("/") ? path : "/" + path);
  const res = await harbor.http(url, { responseType: "text", timeoutMs: 30000 });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return harbor.parseHtml(res.body);
}
function abs(v) {
  if (!v) return undefined;
  v = String(v).trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("//")) return "https:" + v;
  return v.startsWith("/") ? BASE + v : BASE + "/" + v;
}
function clean(v) { return String(v || "").replace(/\u00a0/g," ").replace(/[ \t]+/g," ").trim(); }
function novelId(href) {
  const u = abs(href) || "";
  const m = u.match(/\/novel\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : "";
}
function imageUrl(img) {
  if (!img) return undefined;
  for (const a of ["data-src","data-lazy-src","data-original","data-cover","src"]) {
    const v = img.attr(a);
    if (v && !/^data:/i.test(v) && !/placeholder|transparent|spacer|blank/i.test(v)) return abs(v);
  }
  return undefined;
}
function makeWork(a) {
  const id = novelId(a.attr("href") || "");
  if (!id) return null;
  const img = a.querySelector("img");
  const heading = a.querySelector("h1,h2,h3,h4,.novel-title,.book-title,.title,[class*='title']");
  let title = clean(a.attr("title") || a.attr("aria-label") || a.attr("data-title") ||
    heading?.text() || img?.attr("alt") || a.text());
  if (title.length > 200) {
    title = title.split(/بقلم:|الوصف:|آخر تحديث:|\d+(?:\.\d+)?ك\s+\d+/u)[0];
    title = title.replace(/^(?:مستمرة|مكتملة|متوقفة|جديدة)\s*/u, "").trim();
  }
  if (!title || title.length > 200) return null;
  return { id, title, cover: imageUrl(img), siteUrl: BASE + "/novel/" + encodeURIComponent(id) };
}
function works(doc) {
  const out=[], seen={};
  for (const a of doc.querySelectorAll("a[href*='/novel/']")) {
    const w=makeWork(a);
    if (w && !seen[w.id]) { seen[w.id]=1; out.push(w); }
  }
  return out;
}
async function listing(paths) {
  for (const p of paths) { try { const d=await getDoc(p), w=works(d); if(w.length)return w; } catch(_){} }
  return [];
}
async function popular(offset) {
  const off=Math.max(0,Number(offset||0));
  const page=Math.floor(off/PAGE_SIZE)+1;
  const paths=page===1 ? ["/","/latest"] : ["/latest?page="+page,"/?page="+page];
  const out=[], seen={};
  for(const path of paths) {
    try {
      const found=works(await getDoc(path));
      for(const w of found) if(!seen[w.id]) { seen[w.id]=1; out.push(w); }
    } catch(_) {}
  }
  return out.slice(0,PAGE_SIZE);
}
function norm(s) { return clean(s).toLocaleLowerCase().replace(/[ًٌٍَُِّْـ]/g,"").replace(/[إأآ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه"); }
async function search(query, offset) {
  const q=clean(query); if(!q)return [];
  const page=Math.floor(Number(offset||0)/PAGE_SIZE)+1, e=encodeURIComponent(q);
  const direct=await listing(["/search?q="+e+"&page="+page,"/search?query="+e+"&page="+page,"/search?keyword="+e+"&page="+page]);
  if(direct.length)return direct;
  const needle=norm(q), hits=[], seen={};
  for(let p=1;p<=100;p++) {
    const w=await listing(["/latest?page="+p,"/novels?page="+p,"/?page="+p]);
    if(!w.length)break;
    for(const x of w) if(!seen[x.id] && norm(x.title).includes(needle)) {seen[x.id]=1;hits.push(x);}
  }
  return hits.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
}
function toWesternDigits(value) {
  return String(value || "").replace(/[٠-٩۰-۹]/g, ch => {
    const ar = "٠١٢٣٤٥٦٧٨٩", fa = "۰۱۲۳۴۵۶۷۸۹";
    const i = ar.indexOf(ch);
    return String(i >= 0 ? i : fa.indexOf(ch));
  });
}
function chapterNum(text,url) {
  const t=toWesternDigits(clean(text));
  const u=toWesternDigits(String(url||""));
  let m=t.match(/(?:الفصل|فصل|رقم\s*الفصل|chapter|chap|ch\.?)[\s:#._-]*(\d+(?:\.\d+)?)/iu);
  if(m) return String(Number(m[1]));
  m=u.match(/\/(?:chapter|chap|ch)[-_\/]?(\d+(?:\.\d+)?)(?:[-_/?.#]|$)/i);
  if(m) return String(Number(m[1]));
  m=u.match(/(?:chapter|chap|ch)[-_](\d+(?:\.\d+)?)(?:[-_/?.#]|$)/i);
  if(m) return String(Number(m[1]));
  return undefined;
}
function urlPath(v) {
  const s=abs(v)||"";
  const m=s.match(/^https?:\/\/[^/]+([^?#]*)/i);
  return (m?m[1]:s.split(/[?#]/)[0])||"/";
}
function urlQuery(v) {
  const s=String(v||""), q=s.indexOf("?");
  return q<0?"":s.slice(q+1).split("#")[0];
}
function queryValue(q,key) {
  for(const part of String(q||"").split("&")) {
    const pair=part.split("=");
    if(pair[0]===key && /^\d+$/.test(pair[1]||"")) return Number(pair[1]);
  }
  return 0;
}
function extractChapters(doc,id) {
  const out=[], seen={};
  const slug=String(id||"").toLowerCase();
  // RiwayatArab renders chapter links as /novel/<slug>/chapter/<number>.
  // Do not depend on the anchor's displayed text or on an exact hostname:
  // both can vary in Harbor's parsed server-side HTML.
  for(const a of doc.querySelectorAll("a[href]")) {
    const raw=a.attr("href")||"";
    const u=abs(raw)||"";
    const path=urlPath(u).replace(/\/$/,"");
    const lower=path.toLowerCase();
    if(!lower.includes("/novel/"+slug+"/")) continue;
    if(!/(?:^|\/)(?:chapter|chap|ch)(?:\/|-|_)/i.test(path)) continue;
    const n=chapterNum(a.text()||a.attr("title")||a.attr("aria-label")||"",path);
    if(!n) continue;
    const key=path.toLowerCase();
    if(seen[key]) continue;
    seen[key]=1;
    out.push({id:path,chapter:n,title:clean(a.text()||a.attr("title")||"الفصل "+n)});
  }
  // Fallback: some rendered pages expose chapter URLs in data attributes.
  if(!out.length) {
    for(const node of doc.querySelectorAll("[data-href],[data-url],[data-chapter-url]")) {
      const raw=node.attr("data-href")||node.attr("data-url")||node.attr("data-chapter-url")||"";
      const path=urlPath(raw).replace(/\/$/,"");
      if(!path.toLowerCase().includes("/novel/"+slug+"/")) continue;
      const n=chapterNum(node.text(),path);
      if(!n || !/(?:^|\/)(?:chapter|chap|ch)(?:\/|-|_)/i.test(path)) continue;
      if(seen[path.toLowerCase()]) continue;
      seen[path.toLowerCase()]=1;
      out.push({id:path,chapter:n,title:clean(node.text())||("الفصل "+n)});
    }
  }
  return out;
}
function paginationLinks(doc,basePath) {
  const links=[],seen={},base=basePath.replace(/\/$/,"").toLowerCase();
  for(const a of doc.querySelectorAll("a[href]")) {
    const u=abs(a.attr("href")||"");
    if(!u || !/^https?:\/\/(?:www\.)?riwayatarab\.com\//i.test(u)) continue;
    const path=urlPath(u).replace(/\/$/,"");
    if(path.toLowerCase()!==base) continue;
    const q=urlQuery(u), page=queryValue(q,"page")||queryValue(q,"p");
    if(page<2) continue;
    const key=path+"?page="+page;
    if(!seen[key]) {seen[key]=1;links.push(key);}
  }
  links.sort((a,b)=>queryValue(urlQuery(a),"page")-queryValue(urlQuery(b),"page"));
  return links;
}
async function chapters(id) {
  const slug = novelId(id) || clean(id).replace(/^\/+|\/+$/g, "");
  if (!slug) return [];
  const indexPath = "/novel/" + encodeURIComponent(slug) + "/chapters";
  const all = [], seen = {};
  function add(doc) {
    for (const ch of extractChapters(doc, slug)) {
      if (!seen[ch.id]) { seen[ch.id] = 1; all.push(ch); }
    }
  }

  let first;
  try {
    first = await getDoc(indexPath);
    add(first);
  } catch (_) {
    try { add(await getDoc("/novel/" + encodeURIComponent(slug))); } catch (_) {}
    all.sort((a,b) => Number(a.chapter) - Number(b.chapter));
    all.forEach((x,i) => { x.position = i; });
    return all;
  }

  // The index reports its total page count (50 chapters per page).
  const pageText = clean(first.text());
  const pageMatch = pageText.match(/الصفحة\s*\d+\s*من\s*(\d+)/u);
  let totalPages = pageMatch ? Number(pageMatch[1]) : 0;

  // Fallback to the pagination anchors if the page-count label is absent.
  if (!totalPages) {
    for (const link of paginationLinks(first, indexPath)) {
      const n = queryValue(urlQuery(link), "page");
      if (n > totalPages) totalPages = n;
    }
  }
  if (!totalPages || !Number.isFinite(totalPages)) totalPages = 100;
  totalPages = Math.max(1, Math.min(totalPages, 200));

  let emptyPages = 0;
  for (let page = 2; page <= totalPages; page++) {
    try {
      const doc = await getDoc(indexPath + "?page=" + page);
      const before = all.length;
      add(doc);
      if (all.length === before) emptyPages++;
      else emptyPages = 0;
      if (!pageMatch && emptyPages >= 3) break;
    } catch (_) {
      emptyPages++;
      if (!pageMatch && emptyPages >= 3) break;
    }
  }

  all.sort((a,b) => Number(a.chapter) - Number(b.chapter));
  all.forEach((x,i) => { x.position = i; });
  return all;
}
function contentRoot(doc) {
  for(const s of [".chapter-content",".reading-content",".entry-content","[class*='chapter-content']","[class*='reading-content']","article .prose","article","main"]) {
    const n=doc.querySelector(s);
    if(n && clean(n.text()).length>100)return n;
  }
  return null;
}
function chapterContent(root) {
  if(!root)return "";
  const out=[];
  const nodes=root.querySelectorAll("p,blockquote");
  if(nodes.length) {
    for(const n of nodes) { const t=clean(n.text()); if(t)out.push(t); }
  } else return clean(root.text());
  return out.join("\n\n");
}
const provider={
  id:"riwayatarab",
  name:"رواياتعرب",
  async popular(offset){return popular(offset);},
  async search(query,offset){return search(query,offset);},
  async detail(id){
    const d=await getDoc("/novel/"+encodeURIComponent(id));
    const title=clean(d.querySelector("h1")?.text()||id);
    const img=d.querySelector("img[data-src],img[data-lazy-src],img[data-cover],img[src]");
    const desc=clean(d.querySelector("[class*='description'],[class*='summary'],.prose")?.text());
    return {id,title,cover:imageUrl(img),description:desc||undefined,siteUrl:BASE+"/novel/"+encodeURIComponent(id)};
  },
  async chapters(id){return chapters(id);},
  async content(chapterId){
    const d=await getDoc(chapterId);
    const root=contentRoot(d);
    return chapterContent(root)||clean(d.text());
  }
};
harbor.register(provider);