// Harbor eBook source for RiwayatArab
// v1.8.2 - support chapter links on novel page and paginated chapter index.
const BASE = "https://riwayatarab.com";
const PAGE_SIZE = 50;

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
    title = title.split(/بقلم:|الوصف:|آخر تحديث:|\d+(?:\\.\d+)?ك\\s+\d+/u)[0];
    title = title.replace(/^(?:مستمرة|مكتملة|متوقفة|جديدة)\\s*/u, "").trim();
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
  const page=Math.floor(Number(offset||0)/PAGE_SIZE)+1;
  const paths=[
    "/?page="+page,
    "/latest?page="+page,
    "/novels?page="+page,
    "/popular?page="+page
  ];
  const out=[], seen={};
  for(const path of paths) {
    try {
      const found=works(await getDoc(path));
      for(const w of found) {
        if(!seen[w.id]) { seen[w.id]=1; out.push(w); }
      }
    } catch(_) {}
  }
  return out;
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
  const t = toWesternDigits(text);
  const u = toWesternDigits(url);
  let m = t.match(/(?:الفصل|فصل|chapter|chap|ch\\.?)[\\s:#-]*(\\d+(?:\\.\\d+)?)/iu);
  if (m) return m[1];
  m = u.match(/\\/chapter(?:[-_\\/]|-)(\\d+(?:\\.\\d+)?)(?:[/?#-]|$)/i);
  if (m) return m[1];
  m = u.match(/\\/(\\d+(?:\\.\\d+)?)(?:[/?#]|$)/);
  return m ? m[1] : undefined;
}
function extractChapters(doc,id) {
  const out=[], seen={};
  for(const a of doc.querySelectorAll("a[href]")) {
    const href=a.attr("href")||"";
    const u=abs(href)||"";
    if(!u || !/^https?:\\/\\/(?:www\\.)?riwayatarab\\.com\\//i.test(u)) continue;
    if(!/\\/novel\\//i.test(u)) continue;
    if(new URL(u).pathname.replace(/\\/$/,"").toLowerCase() === ("/novel/"+id+"/chapters").toLowerCase()) continue;
    if(novelId(u)!==id) continue;
    const text=clean(a.text()||a.attr("title")||a.attr("aria-label")||"");
    const n=chapterNum(text,u);
    if(!n) continue;
    const path=new URL(u).pathname;
    const cid=path;
    if(seen[cid]) continue;
    seen[cid]=1;
    out.push({id:cid,chapter:n,title:text||("الفصل "+n)});
  }
  return out;
}
function paginationLinks(doc, basePath) {
  const links=[], seen={};
  for(const a of doc.querySelectorAll("a[href]")) {
    const href=a.attr("href")||"";
    if(!href) continue;
    const u=abs(href);
    if(!u) continue;
    const url=new URL(u);
    if(url.hostname.replace(/^www\\./,"")!=="riwayatarab.com") continue;
    if(url.pathname.replace(/\\/$/,"")!==basePath.replace(/\\/$/,"")) continue;
    if(!/[?&](?:page|p)=\\d+/i.test(url.search)) continue;
    const key=url.pathname+url.search;
    if(!seen[key]) { seen[key]=1; links.push(key); }
  }
  return links;
}
async function chapters(id) {
  const novelPath="/novel/"+encodeURIComponent(id);
  const indexPath=novelPath+"/chapters";
  const all=[], seen={};
  function add(doc) {
    for(const ch of extractChapters(doc,id)) {
      if(!seen[ch.id]) { seen[ch.id]=1; all.push(ch); }
    }
  }

  // The detail page contains a first-page preview (20 chapters on the verified novel).
  try { add(await getDoc(novelPath)); } catch(_) {}

  let first;
  try {
    first=await getDoc(indexPath);
    add(first);
  } catch(_) {
    all.sort((x,y)=>Number(x.chapter)-Number(y.chapter));
    all.forEach((x,i)=>{x.position=i;});
    return all;
  }

  const queued=paginationLinks(first,indexPath);
  const visited={};
  // Prefer pagination URLs actually emitted by the site.
  for(const path of queued) {
    if(visited[path]) continue;
    visited[path]=1;
    try { add(await getDoc(path)); } catch(_) {}
  }

  // Fallback for sites whose pagination links are not exposed in server HTML.
  const maxPage=200;
  let empty=0;
  for(let p=2;p<=maxPage;p++) {
    const path=indexPath+"?page="+p;
    if(visited[path]) continue;
    try {
      const doc=await getDoc(path);
      const before=all.length;
      add(doc);
      if(all.length===before) empty++; else empty=0;
      if(empty>=3) break;
    } catch(_) {
      empty++;
      if(empty>=3) break;
    }
  }

  all.sort((x,y)=>Number(x.chapter)-Number(y.chapter));
  all.forEach((x,i)=>{x.position=i;});
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