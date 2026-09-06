// Harbor eBook source for RiwayatArab
// v1.6.0 - robust work/chapter discovery for changing server-rendered layouts.

const BASE = "https://riwayatarab.com";
const WORK_PAGE_SIZE = 24;

async function getDoc(path) {
  const url = /^https?:\/\//i.test(path) ? path : BASE + (path.startsWith("/") ? path : "/" + path);
  const res = await harbor.http(url, { responseType: "text", timeoutMs: 30000 });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return harbor.parseHtml(res.body);
}

function abs(url) {
  if (!url) return undefined;
  const v = String(url).trim();
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("//")) return "https:" + v;
  return v.startsWith("/") ? BASE + v : BASE + "/" + v;
}
function clean(v) { return String(v || "").replace(/\u00a0/g," ").replace(/[ \t]+/g," ").replace(/\n{3,}/g,"\n\n").trim(); }
function sameHost(u) { return /^https?:\/\/riwayatarab\.com(?:\/|$)/i.test(String(u||"")); }

function novelId(href) {
  const u=abs(href)||"";
  const m=u.match(/\/novel\/([^/?#]+)(?:\/?(?:[?#].*)?)$/i);
  if(!m) return "";
  try{return decodeURIComponent(m[1]);}catch(_){return m[1];}
}
function novelPath(id){return "/novel/"+encodeURIComponent(id);}

function imageUrl(img){
  if(!img)return undefined;
  const attrs=["data-src","data-lazy-src","data-original","data-image","data-cover","data-url","src"];
  for(const n of attrs){
    const v=img.attr(n);
    if(!v)continue;
    const u=String(v).trim().split(",")[0].split(/\s+/)[0];
    if(u&&!/^data:image/i.test(u)&&!/placeholder|transparent|spacer|blank/i.test(u))return abs(u);
  }
  return undefined;
}

function workFromLink(a){
  const href=a.attr("href")||"", url=abs(href);
  if(!url||!sameHost(url))return null;
  const id=novelId(href);
  if(!id)return null;
  let title=clean(a.attr("title")||a.attr("aria-label")||a.querySelector("img")?.attr("alt")||a.text());
  if(!title||title.length>250){
    const p=a.parentElement;
    if(p)title=clean(p.text());
  }
  title=title.replace(/\s+(?:بقلم|المؤلف|آخر تحديث|عدد الفصول|فصول)\b.*$/iu,"").trim();
  if(!title||title.length>250)return null;
  return {id,title,cover:imageUrl(a.querySelector("img"))};
}

function works(doc){
  const out=[],seen={};
  for(const a of doc.querySelectorAll("a[href]")){
    const x=workFromLink(a);
    if(x&&!seen[x.id]){seen[x.id]=1;out.push(x);}
  }
  return out;
}

function pageOf(u){
  const m=String(u||"").match(/[?&](?:page|p|paged)=(\d+)/i);
  return m?Number(m[1]):0;
}

async function getWorks(paths){
  for(const p of paths){
    try{
      const d=await getDoc(p), w=works(d);
      if(w.length)return w;
    }catch(_){}
  }
  return [];
}

async function popularWorks(offset){
  const page=Math.floor(Number(offset||0)/WORK_PAGE_SIZE)+1;
  const paths=[
    "/?page="+page,
    "/latest?page="+page,
    "/novels?page="+page,
    "/browse?page="+page,
    "/popular?page="+page,
    "/new?page="+page,
    "/search?page="+page,
    "/search?sort=popular&page="+page
  ];
  // Do not stop at the first page merely because it has cards: Harbor calls
  // with offsets, so always honor the requested offset/page.
  return getWorks(paths);
}

function norm(s){
  return clean(s).toLocaleLowerCase()
    .replace(/[ًٌٍَُِّْـ]/g,"").replace(/[إأآا]/g,"ا")
    .replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/ؤ/g,"و").replace(/ئ/g,"ي");
}

async function searchWorks(q,offset){
  q=clean(q); if(!q)return [];
  const page=Math.floor(Number(offset||0)/WORK_PAGE_SIZE)+1, e=encodeURIComponent(q);
  const direct=[
    "/search?q="+e+"&page="+page,
    "/search?query="+e+"&page="+page,
    "/search?search="+e+"&page="+page,
    "/search?keyword="+e+"&page="+page,
    "/search?title="+e+"&page="+page,
    "/novels?q="+e+"&page="+page,
    "/novels?search="+e+"&page="+page
  ];
  const d=await getWorks(direct);
  if(d.length)return d;

  // Search fallback scans all listing pages instead of assuming a fixed count.
  const needle=norm(q), hits=[],seen={};
  for(let p=1;p<=150;p++){
    const w=await getWorks(["/latest?page="+p,"/novels?page="+p,"/?page="+p]);
    if(!w.length)break;
    for(const x of w){
      if(!seen[x.id]&&norm(x.title+" "+x.id).includes(needle)){seen[x.id]=1;hits.push(x);}
    }
    if(w.length<WORK_PAGE_SIZE&&p>1)break;
  }
  const start=(page-1)*WORK_PAGE_SIZE;
  return hits.slice(start,start+WORK_PAGE_SIZE);
}

function chapterNumber(text,url){
  const s=clean(text),u=String(url||"");
  let m=s.match(/(?:الفصل|فصل|chapter|chap|ch\.?)[\s:#-]*(\d+(?:\.\d+)?)/iu);
  if(m)return m[1];
  m=u.match(/\/chapter(?:[-_\/]|-)(\d+(?:\.\d+)?)/i); if(m)return m[1];
  m=u.match(/\/novel\/[^/?#]+\/[^/?#]*?(\d+(?:\.\d+)?)(?:[/?#]|$)/i); if(m)return m[1];
  m=u.match(/[-_/](\d+(?:\.\d+)?)(?:[/?#]|$)/i); return m?m[1]:undefined;
}

function chapterLink(a,novel){
  const href=a.attr("href")||"",u=abs(href);
  if(!u||!sameHost(u))return null;
  const nid=novelId(u);
  // Accept links under the requested novel, including encoded/slug variants.
  if(nid!==novel)return null;
  if(/\/chapters?(?:[/?#]|$)/i.test(u))return null;
  const text=clean(a.text()||a.attr("title")||a.attr("aria-label")||"");
  const n=chapterNumber(text,u);
  // Do not require the literal word "chapter": some pages use only "1", "2",...
  if(!n)return null;
  const id=u.replace(/^https?:\/\/riwayatarab\.com/i,"").replace(/^\/+/,"/");
  return {id,chapter:n,title:text||"الفصل "+n,pages:0,language:"ar"};
}

function extractChapters(doc,novel){
  const out=[],seen={};
  for(const a of doc.querySelectorAll("a[href]")){
    const c=chapterLink(a,novel);
    if(c&&!seen[c.id]){seen[c.id]=1;out.push(c);}
  }
  return out;
}

function chapterPages(doc){
  const pages=[];
  for(const a of doc.querySelectorAll("a[href]")){
    const u=abs(a.attr("href")||"");
    if(!u||!/\/chapters?(?:[/?#]|$)/i.test(u))continue;
    const p=pageOf(u); if(p>1)pages.push(p);
  }
  return pages;
}

async function loadChapters(id){
  const base=novelPath(id)+"/chapters";
  const first=await getDoc(base);
  const all=extractChapters(first,id);
  const listed=chapterPages(first);
  let max=listed.length?Math.max(...listed):1;

  // Follow every visible pagination link and then probe sequential pages.
  // This avoids the previous "first page only" failure.
  const todo=[];
  for(const p of listed)if(todo.indexOf(p)<0)todo.push(p);
  for(let p=2;p<=200;p++)if(todo.indexOf(p)<0)todo.push(p);
  todo.sort((a,b)=>a-b);

  let empty=0;
  for(const p of todo){
    if(p>max+2 && empty>=3)break;
    try{
      const d=await getDoc(base+"?page="+p);
      const before=all.length;
      all.push(...extractChapters(d,id));
      const more=chapterPages(d);
      if(more.length)max=Math.max(max,...more);
      if(all.length===before)empty++;else empty=0;
      if(p>max+2&&empty>=3)break;
    }catch(_){
      if(p>max+2)empty++;
    }
  }

  const unique=[],seen={};
  for(const c of all){if(!seen[c.id]){seen[c.id]=1;unique.push(c);}}
  unique.sort((a,b)=>{
    const x=parseFloat(a.chapter),y=parseFloat(b.chapter);
    if(Number.isFinite(x)&&Number.isFinite(y))return x-y;
    return String(a.title).localeCompare(String(b.title),"ar");
  });
  for(let i=0;i<unique.length;i++)unique[i].position=i;
  return unique;
}

function contentRoot(doc){
  const selectors=[
    ".chapter-content",".reading-content",".entry-content",
    "[class*='chapter-content']","[class*='chapter_content']",
    "[class*='reading-content']","[class*='reading_content']",
    "[class*='content-body']","article .prose","article","main article",".prose"
  ];
  for(const s of selectors){
    const n=doc.querySelector(s);
    if(n&&clean(n.text()).length>50)return n;
  }
  return null;
}

function content(root){
  if(!root)return "";
  const nodes=root.querySelectorAll("p,blockquote");
  const out=[],seen={};
  for(const n of nodes){
    const t=clean(n.text());
    if(t.length<2||seen[t])continue;
    seen[t]=1;out.push(t);
  }
  return out.length?out.join("\n\n"):clean(root.text());
}

const plugin={
  id:"riwayatarab",
  name:"رواياتعرب",
  async popular(offset){return popularWorks(offset);},
  async search(query,offset){return searchWorks(query,offset);},
  async detail(id){
    const d=await getDoc(novelPath(id));
    const title=clean(d.querySelector("h1")?.text()||id);
    if(!title)return null;
    const img=d.querySelector("img[data-src],img[data-lazy-src],img[data-cover],img[src]");
    const text=clean(d.text());
    const count=text.match(/(\d[\d,]*)\s*(?:فصل|فصول|chapter|chapters)\b/iu);
    return {id,title,cover:imageUrl(img),description:clean(d.querySelector("[class*='description'],[class*='summary'],.prose")?.text())||undefined,author:clean(d.querySelector("[class*='author'],[class*='writer']")?.text())||undefined,chapters:count?Number(count[1].replace(/,/g,"")):undefined};
  },
  async chapters(id){return loadChapters(id);},
  async content(chapterId){const d=await getDoc(chapterId),r=contentRoot(d);return content(r)||clean(d.text());}
};