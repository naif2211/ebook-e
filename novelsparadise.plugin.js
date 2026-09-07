// Harbor eBook source: Novels Paradise (np-light)
// Server-rendered HTML source. No fetch/DOM APIs outside Harbor.

const BASE="https://novelsparadise.site";
const LIGHT=BASE+"/np-light";
const SIZE=20;

async function doc(path){
  const url=/^https?:\/\//i.test(path)?path:BASE+(path.startsWith("/")?path:"/"+path);
  const r=await harbor.http(url,{responseType:"text",timeoutMs:30000});
  if(!r.ok) throw new Error("HTTP "+r.status);
  return harbor.parseHtml(r.body);
}
function abs(v){if(!v)return;v=String(v).trim();if(/^https?:\/\//i.test(v))return v;if(v.startsWith("//"))return "https:"+v;return v.startsWith("/")?BASE+v:BASE+"/"+v;}
function clean(v){return String(v||"").replace(/\u00a0/g," ").replace(/[ \t]+/g," ").replace(/\n{3,}/g,"\n\n").trim();}
function slugFrom(url){const m=(abs(url)||"").match(/\/series\/([^/?#]+)\/?(?:[?#].*)?$/i);return m?decodeURIComponent(m[1]):"";}
function imgOf(a){const i=a?.querySelector("img");if(!i)return;for(const k of ["data-src","data-lazy-src","data-original","src"]){const v=i.attr(k);if(v&&!/^data:/i.test(v))return abs(v);}}
function work(a){
  const href=a.attr("href")||"",u=abs(href),id=slugFrom(href);if(!id)return;
  let title=clean(a.attr("title")||a.attr("aria-label")||a.querySelector("img")?.attr("alt")||a.text());
  if(!title||title.length>250)return;
  title=title.replace(/\s+(?:مترجمة|رواية)\s*$/iu,"").trim();
  return {id,title,cover:imgOf(a)};
}
function works(d){
  const out=[],seen={};
  for(const a of d.querySelectorAll("a[href]")){
    const x=work(a);if(x&&!seen[x.id]){seen[x.id]=1;out.push(x);}
  }
  return out;
}
function pageOffset(o){return Math.floor(Number(o||0)/SIZE)+1;}

async function listing(paths){
  for(const p of paths){try{const d=await doc(p),x=works(d);if(x.length)return x;}catch(_){}}
  return [];
}
function chapterNo(t,u){
  t=clean(t);
  let m=t.match(/(?:الفصل|chapter|chap|الفصل\.)\s*[.:#-]*\s*(\d+(?:\.\d+)?)/iu);if(m)return m[1];
  m=(u||"").match(/(?:chapter|chap|الفصل)[\/_-]*(\d+(?:\.\d+)?)/i);if(m)return m[1];
  m=t.match(/\b(\d{1,6})\b/);return m?m[1]:undefined;
}
function chapter(a,series){
  const u=abs(a.attr("href")||"");if(!u||!/^https?:\/\/novelsparadise\.site/i.test(u))return;
  const txt=clean(a.text()||a.attr("title")||a.attr("aria-label"));
  if(!/(?:الفصل|chapter|chap)/iu.test(txt)&&!/(?:الفصل|chapter|chap)/iu.test(u))return;
  const n=chapterNo(txt,u);if(!n)return;
  const id=u.replace(/^https?:\/\/novelsparadise\.site/i,"");
  return {id,chapter:n,title:txt||("الفصل "+n),pages:0,language:"ar"};
}
function chapters(d,series){
  const out=[],seen={};
  for(const a of d.querySelectorAll("a[href]")){
    const c=chapter(a,series);if(c&&!seen[c.id]){seen[c.id]=1;out.push(c);}
  }
  return out;
}
function pagination(d){
  const p=[];
  for(const a of d.querySelectorAll("a[href]")){
    const u=abs(a.attr("href")||"");const m=(u||"").match(/[?&](?:page|paged|pg)=(\d+)/i);
    if(m)p.push(Number(m[1]));
  }
  return [...new Set(p)].sort((a,b)=>a-b);
}
async function allChapters(id){
  const base="/series/"+encodeURIComponent(id)+"/";
  const first=await doc(base),all=chapters(first,id);
  const ps=pagination(first);
  let max=ps.length?Math.max(...ps):1;
  const queue=[...ps];for(let p=2;p<=200;p++)if(!queue.includes(p))queue.push(p);
  let empty=0;
  for(const p of queue){
    try{
      const d=await doc(base+"?page="+p),before=all.length;
      all.push(...chapters(d,id));
      const more=pagination(d);if(more.length)max=Math.max(max,...more);
      if(all.length===before)empty++;else empty=0;
      if(p>max+2&&empty>=3)break;
    }catch(_){if(p>max+2)empty++;}
  }
  const u=[],seen={};for(const c of all){if(!seen[c.id]){seen[c.id]=1;u.push(c);}}
  u.sort((a,b)=>Number(a.chapter)-Number(b.chapter));
  u.forEach((c,i)=>c.position=i);return u;
}
function contentRoot(d){
  for(const s of [".reading-content",".chapter-content",".entry-content","article .content",".entry-content-single","article","main"]){
    const n=d.querySelector(s);if(n&&clean(n.text()).length>80)return n;
  }
}
function readContent(r){
  if(!r)return "";
  const ns=r.querySelectorAll("p,blockquote");
  const a=[];for(const n of ns){const t=clean(n.text());if(t)a.push(t);}
  return a.length?a.join("\n\n"):clean(r.text());
}

const plugin={
 id:"novelsparadise",
 name:"Novels Paradise",
 async popular(offset){
   const p=pageOffset(offset);
   return listing([
     LIGHT+"?page="+p,
     LIGHT+"/?page="+p,
     "/series/?page="+p,
     "/series/page/"+p+"/",
     "/?page="+p
   ]);
 },
 async search(q,offset){
   q=clean(q);if(!q)return[];
   const p=pageOffset(offset),e=encodeURIComponent(q);
   return listing([
     LIGHT+"/?s="+e+"&page="+p,
     LIGHT+"/?search="+e+"&page="+p,
     "/?s="+e+"&page="+p,
     "/series/?s="+e+"&page="+p
   ]);
 },
 async detail(id){
   const d=await doc("/series/"+encodeURIComponent(id)+"/");
   const h=clean(d.querySelector("h1")?.text()||id);if(!h)return null;
   const text=clean(d.text()),m=text.match(/(\d[\d,]*)\s*فصل/iu);
   return {
    id,title:h,
    cover:imgOf(d.querySelector("img[data-src],img[data-lazy-src],img[src]")),
    description:clean(d.querySelector(".summary,.description,.entry-content p")?.text())||undefined,
    author:clean(d.querySelector(".author,.writer")?.text())||undefined,
    chapters:m?Number(m[1].replace(/,/g,"")):undefined
   };
 },
 async chapters(id){return allChapters(id);},
 async content(chapterId){
   const d=await doc(chapterId),r=contentRoot(d);
   return readContent(r)||clean(d.text());
 }
};