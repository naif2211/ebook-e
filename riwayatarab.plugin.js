// Harbor eBook source for RiwayatArab
// v1.7.0 - complete chapter pagination + ordered text extraction.
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
  let title = clean(a.attr("title") || a.attr("aria-label") || a.querySelector("img")?.attr("alt") || a.text());
  if (!title || title.length > 200) return null;
  return { id, title, cover: imageUrl(a.querySelector("img")), siteUrl: BASE + "/novel/" + encodeURIComponent(id) };
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
  return listing(["/?page="+page,"/latest?page="+page,"/novels?page="+page,"/popular?page="+page]);
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
function chapterNum(text,url) {
  let m=String(text||"").match(/(?:الفصل|فصل|chapter|chap|ch\.?)[\s:#-]*(\d+(?:\.\d+)?)/iu);
  if(m)return m[1];
  m=String(url||"").match(/\/chapter(?:[-_\/]|-)(\d+(?:\.\d+)?)/i);
  return m ? m[1] : undefined;
}
function extractChapters(doc,id) {
  const out=[],seen={};
  for(const a of doc.querySelectorAll("a[href]")) {
    const href=a.attr("href")||"", u=abs(href)||"";
    if(!u || !u.includes("riwayatarab.com") || !u.includes("/novel/"))continue;
    if(/\/chapters?(?:[/?#]|$)/i.test(u))continue;
    if(novelId(u)!==id)continue;
    const text=clean(a.text()||a.attr("title")||a.attr("aria-label")||""), n=chapterNum(text,u);
    if(!n)continue;
    const cid=u.replace(/^https?:\/\/riwayatarab\.com/i,"");
    if(seen[cid])continue;
    seen[cid]=1;
    out.push({id:cid,chapter:n,title:text||("الفصل "+n)});
  }
  return out;
}
function pagination(doc) {
  const p=[];
  for(const a of doc.querySelectorAll("a[href]")) {
    const u=abs(a.attr("href")||"")||"";
    const m=u.match(/[?&]page=(\d+)/i);
    if(m)p.push(Number(m[1]));
  }
  return p;
}
async function chapters(id) {
  const base="/novel/"+encodeURIComponent(id)+"/chapters";
  const first=await getDoc(base);
  const all=extractChapters(first,id), seen={};
  for(const c of all)seen[c.id]=1;
  const pages=pagination(first), max=pages.length?Math.max(...pages):1;
  // Probe sequentially so all chapter pages are collected even when pagination markup is incomplete.
  let empty=0;
  for(let p=2;p<=Math.max(200,max+2);p++) {
    try {
      const d=await getDoc(base+"?page="+p);
      const got=extractChapters(d,id), before=all.length;
      for(const c of got)if(!seen[c.id]){seen[c.id]=1;all.push(c);}
      if(all.length===before)empty++;else empty=0;
      if(p>max && empty>=3)break;
    } catch(_) { if(p>max) {empty++; if(empty>=3)break;} }
  }
  all.sort((a,b)=>parseFloat(a.chapter)-parseFloat(b.chapter));
  all.forEach((c,i)=>c.position=i);
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