Claude

// Harbor eBook source plugin, minimal annotated example. // // This whole file runs as the body of a function that receives one argument named // harbor. There is no DOM, no fetch, no storage. Reach the network only through // harbor.http and parse HTML only through harbor.parseHtml. // // Re

pasted

https://kolnovel.com/?utm_source=chatgpt.com


// Harbor eBook source plugin, minimal annotated example. // // This whole file runs as the body of a function that receives one argument named // harbor. There is no DOM, no fetch, no storage. Reach the network only through // harbor.http and parse HTML only through harbor.parseHtml. // // Re

pasted

https://kolnovel.com/series/

Read 2 pages, created a file, shared files
I’ve written a Harbor plugin for kolnovel.com in kolnovel.plugin.js, following your template, but I haven’t run it against the live site. I could only see the pages as rendered text, not their raw HTML, so many CSS selectors are guesses.

What I got from the pages

Browsing: /series/?paged=N shows 20 cards per page (273 works over 14 pages), so the page size is 20 rather than the template’s 48.
Series URLs: these are /series/<arabic-slug>/. I use the decoded slug as the id.
Filters:
Type: ?type[]=chinese|japanese|korean|english
Status: ?status=completed
Order: ?order=update
These come from the site’s own menu links, and they’re the only filters I declared in tags().
Cards: each card shows the title in an <h3>, a status label, an optional ★ 7.5 rating, and a genre line. I parse all of these from the card text.
Chapter titles: they follow the pattern الفصل N · title, which the plugin parses into a chapter number and title.
Chapter URLs: they look like /shaag24<slug>z435ggye-298131/. The numeric ids skip around, so they can’t be generated.
What you need to check

Chapter list: this is the biggest risk. The chapters table is empty in the server HTML and is filled in by JavaScript. chapters() tries three things in order:
rows already in the page,
the site’s own ?chapter_volume&chapter_page=N pages,
walking rel="next" links from the first chapter.
If you can give me the XHR or admin-ajax request the table uses, I can replace all three with one direct call.
Chapter content: I guessed the reader container (.chapter-content, .reader-content, .entry-content) and fall back to every <p> in <article> or <main>. A locked chapter will probably return nothing.
Search: I assumed the standard WordPress ?s= parameter.
Detail page: the synopsis, the English subtitle under the title, and the cover are best-effort. If any come back empty, send me the raw HTML of one series page.
More filters: the status values for ongoing and hiatus, and the sort values for popular and rating, aren’t visible in the rendered text. I left them out rather than invent them. The filter form’s <option value> attributes would show them.
Fan fiction: I set isFanMade for the genres «فان فيكشن» / «فانفيك» / «فان», so Harbor will hide those. Delete that line if you want them listed.
If you paste the raw HTML of the listing page, one series page and one chapter page, I can swap the guesses for exact selectors.

Kolnovel.plugin
JS
يظهر في الاخير والاول فقط

تشخيص مشكلة ظهور فصل أول وأخير فقط.
تشخيص مشكلة ظهور فصل أول وأخير فقط.
فهمت المشكلة: الرابطان الوحيدان المكتوبان في HTML هما «الفصل الأول» و«آخر فصل»، وقد التقطهما الكود وتوقف عندهما لأن القائمة الكاملة تُحمَّل بـ JavaScript. سأفتح صفحة فصل لأعرف كيف يُربط كل فصل بالتالي.

Read a page, ran a command, shared files
عدّلت kolnovel.plugin.js، لكن لم أجرّبه على الموقع، ولم أستطع التحقق من الإصلاح لأني لم أتمكن من فتح صفحة فصل.

السبب: جدول الفصول فارغ في HTML الذي يرسله الخادم، ويملؤه JavaScript بعد التحميل. الرابطان الوحيدان الموجودان في الصفحة هما «الفصل الأول» و«آخر فصل»، والكود التقطهما وتوقف.

ما تغيّر في chapters():

يقرأ عدد الفصول المتوقع من «الفصول N»، وروابط أول وآخر فصل من صفحة الرواية.
إذا وجد أقل من العدد المتوقع، يبدأ من الفصل الأول ويتتبع رابط «التالي» فصلاً بعد فصل حتى يصل إلى الفصل الأخير، ثم يتأكد أن الأخير ضمن القائمة.
ما يجب أن تعرفه:

البطء: تتبع «التالي» يعني طلباً واحداً لكل فصل، فالروايات الطويلة ستستغرق وقتاً.
رابط «التالي»: لا أعرف شكله الحقيقي. جرّبت a[rel=next] ثم أي class يحتوي next ثم أي رابط نصه «التالي»، وقد لا يطابق أحدها.
الحل الأفضل: هو الاستدعاء الذي تستخدمه الصفحة لتحميل القائمة. افتح الصفحة في المتصفح، ثم Network ثم Fetch/XHR، وانتقل إلى تبويب «الفصول». إن أرسلت لي الطلب (الرابط والمعاملات) واستجابته، أستبدل المشي الطويل باستدعاء واحد يرجع كل الفصول.
بديل: أرسل لي HTML خام لصفحة فصل واحد، وأضبط عليه selector رابط «التالي» وحاوية النص.
Kolnovel.plugin
JS

<!doctype html> <html dir="rtl" lang="ar" data-starless-theme="default" data-starless-reduced-motion="false"> <head> <meta charset="UTF-8"> <meta name="viewport" content="width=device-width, initial-scale=1"> <meta name="color-scheme" content="light dark"> <meta name="darkreade

pasted

Selecting the right link patterns to scope chapters per volume
هذا HTML الخام يكشف السبب: كل مجلد (details[data-kol-chapter-volume]) تُحمَّل فصوله لاحقاً عبر series-chapters.js. سأقرأ هذا الملف لأعرف طلب التحميل بالضبط.

Read a page, ran a command, shared files
حدّثت kolnovel.plugin.js، وفيه الآن إصلاح مشكلة «الأول والأخير فقط». لم أجرّبه على الموقع، لكن الكود يمر في فحص الصياغة.

سبب المشكلة: الصفحة لا تحمل الفصول في HTML. كل مجلد يُحمَّل عبر طلب من series-chapters.js (الذي قرأته من الرابط الموجود في مستندك):

/wp-admin/admin-ajax.php?action=kol_series_volume_chapters&nonce=…&series_id=…&volume=…&page=N

والرد JSON فيه data.html (صفوف الفصول) وdata.pages.

ما يفعله chapters() الآن:

يقرأ nonce وseries_id من [data-kol-chapter-index]، وأسماء المجلدات من details[data-kol-chapter-volume].
يطلب كل صفحات كل مجلد ويحلل الصفوف.
يرتّب الفصول من الأقدم للأحدث. الصفحات والمجلدات تأتي من الموقع بالترتيب الأحدث أولاً، فعكستها.
يملأ volumeTitle باسم المجلد، وvolume برقمه عندما يكون الاسم «المجلد N».
تحسينات أخرى من HTML الذي أرسلته:

صفحة الرواية: صارت detail() تقرأ العنوان والغلاف والمؤلف والحالة وعدد الفصول واللغة والتصنيفات من الـ selectors الحقيقية. للوصف استخدمت .kol-series-editorial__synopsis-preview لأن الوصف الكامل يحتوي ودجت التبرع.
القوائم: استخدمت .kol-series-archive__item كحاوية للبطاقات، وهو اسم مأخوذ من إعدادات الموقع.
النص: استخدمت [data-kol-reader-content] p لقراءة نص الفصل.
ما زال غير متحقق منه:

صف الفصل: يفترض الكود أن كل صف li[data-chapter-id] فيه رابط، وأن الرقم والعنوان في [data-kol-chapter-number] و[data-kol-chapter-title]. استنتجت هذه الأسماء من كود الموقع ولم أرَ صفاً فعلياً.
صفحة الفصل: لم أرَ HTML خام لفصل، فحاوية [data-kol-reader-content] مأخوذة من كود قراءة الإعدادات.
البطاقات: لم أرَ HTML خاماً لصفحة /series/، فتحليل البطاقات (الغلاف والتصنيفات) ما زال تخميناً.
البحث: يفترض ?s=، والنموذج في الموقع يرسل s وpost_type=series، وهذا ما يستخدمه الكود.
الـ nonce: قد ينتهي بعد مدة، لكنه يُجلب من الصفحة في كل استدعاء لـ chapters() فلا مشكلة.
لو ظهر خطأ في الفصول، أرسل لي رد admin-ajax لمجلد واحد (JSON)، وأضبط الصف عليه. وللبطاقات أرسل HTML خام لصفحة /series/.

Kolnovel.plugin
JS

Next time, try this in Cowork
Hand off complex tasks for Claude to handle independently. Come back to finished results.


Claude is AI and can make mistakes. Please double-check responses.
Kolnovel.plugin · JS
// Harbor eBook source plugin: Kol Novel (ملوك الروايات) - https://kolnovel.com
//
// Built from the rendered text of /series/ and one series page. Anything marked
// "VERIFY" is a selector guess that needs checking against the raw HTML.
 
const BASE = "https://kolnovel.com";
const PAGE_SIZE = 20; // /series/ shows 20 cards per page (273 works / 14 pages)
 
async function getDoc(path) {
  const res = await harbor.http(path.startsWith("http") ? path : BASE + path, { responseType: "text" });
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
 
// Slugs are Arabic. Normalise so encoded/raw hrefs give the same stable id.
function safeDecode(s) {
  try { return decodeURIComponent(s); } catch (_) { return s; }
}
function seriesIdFromHref(href) {
  const m = (href || "").match(/\/series\/([^/?#]+)/);
  return m ? safeDecode(m[1]) : "";
}
function seriesPath(id) {
  return "/series/" + encodeURIComponent(id) + "/";
}
function chapterIdFromHref(href) {
  // Chapter URLs sit at the site root (/shaag24...-298131/). Keep the decoded path.
  return safeDecode((href || "").replace(BASE, "").replace(/^\//, "").replace(/[?#].*$/, ""));
}
function chapterPath(id) {
  return "/" + encodeURIComponent(id).replace(/%2F/gi, "/");
}
 
function cleanTitle(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}
 
function mapStatus(text) {
  if (/مكتملة/.test(text || "")) return "completed";
  if (/متوقفة/.test(text || "")) return "hiatus";
  if (/مستمرة/.test(text || "")) return "ongoing";
  return undefined;
}
 
const TYPE_LANG = { chinese: "zh", japanese: "ja", korean: "ko", english: "en" };
 
// Filters confirmed from the site's own menu links:
//   ?type[]=japanese|korean|english|chinese, ?status=completed, ?order=update
function browseQuery(tagId) {
  const params = [];
  if (tagId?.startsWith("type:")) params.push("type%5B%5D=" + encodeURIComponent(tagId.slice(5)));
  if (tagId?.startsWith("status:")) params.push("status=" + encodeURIComponent(tagId.slice(7)));
  if (tagId?.startsWith("sort:")) params.push("order=" + encodeURIComponent(tagId.slice(5)));
  return params.length ? "&" + params.join("&") : "";
}
 
const FAN_GENRES = ["فان فيكشن", "فانفيك", "فان"];
 
// Card = block holding an <h3><a href="/series/..."> title. The container class is
// unknown (VERIFY), so try common wrappers and keep whichever matches real cards.
function findCards(doc) {
  for (const sel of [".kol-series-archive__item", "article", "li"]) {
    const els = doc.querySelectorAll(sel).filter((el) => el.querySelector("h3 a[href*='/series/']"));
    if (els.length) return els;
  }
  return [];
}
 
function cardToSummary(el) {
  const titleLink = el.querySelector("h3 a[href*='/series/']");
  if (!titleLink) return null;
  const id = seriesIdFromHref(titleLink.attr("href"));
  if (!id) return null;
 
  const text = el.text() || "";
  const img = el.querySelector("img");
  const rating = text.match(/★\s*([\d.]+)/);
  const genreBlock = text.match(/التصنيفات\s*([\s\S]*?)\s*الملخص/);
  const genres = genreBlock
    ? genreBlock[1].split("·").map((g) => g.trim()).filter(Boolean)
    : [];
 
  return {
    id,
    title: cleanTitle(titleLink.attr("title") || titleLink.text()),
    cover: abs(img?.attr("data-src") || img?.attr("src")),
    status: mapStatus(text),
    genres,
    score: rating ? Number(rating[1]) : undefined,
    // Harbor drops entries flagged true; remove this if you want fan fiction listed.
    isFanMade: genres.some((g) => FAN_GENRES.includes(g)),
  };
}
 
function parseCards(doc) {
  return findCards(doc).map(cardToSummary).filter(Boolean);
}
 
// Chapter titles look like "الفصل 12 · عنوان" (or "الفصل 12.5 · ...").
function parseChapterLabel(label) {
  const clean = cleanTitle(label);
  const m = clean.match(/الفصل\s+([\d.]+)\s*[·\-–:]?\s*(.*)$/);
  return m ? { chapter: m[1], title: m[2] || clean } : { chapter: undefined, title: clean };
}
 
const plugin = {
  id: "kolnovel",
  name: "Kol Novel (ملوك الروايات)",
 
  async popular(offset, tagId) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const doc = await getDoc("/series/?paged=" + page + browseQuery(tagId));
    return parseCards(doc);
  },
 
  // VERIFY: assumes the standard WordPress search param (?s=).
  async search(query, offset, tagId) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const doc = await getDoc(
      "/?s=" + encodeURIComponent(query) + "&post_type=series&paged=" + page + browseQuery(tagId),
    );
    return parseCards(doc);
  },
 
  async detail(id) {
    const doc = await getDoc(seriesPath(id));
    const h1 = doc.querySelector("h1.kol-series-editorial__title") || doc.querySelector("h1");
    if (!h1) return null;
    const title = cleanTitle(h1.text());
 
    // Quick facts: <dl class="kol-series-editorial__quick-facts"><div><dt>الفصول</dt><dd>559</dd>...
    const facts = {};
    doc.querySelectorAll(".kol-series-editorial__quick-facts > div").forEach((row) => {
      const k = cleanTitle(row.querySelector("dt")?.text());
      if (k) facts[k] = cleanTitle(row.querySelector("dd")?.text());
    });
    const lang = facts["اللغة"] || "";
    const originalLanguage = /صينية/.test(lang) ? "zh" : /يابانية/.test(lang) ? "ja"
      : /كورية/.test(lang) ? "ko" : /إنج/.test(lang) ? "en" : /عربية/.test(lang) ? "ar" : undefined;
 
    return {
      id,
      title,
      cover: abs(doc.querySelector(".kol-series-editorial__cover img")?.attr("src")),
      // The full synopsis block also contains a donation widget, so use the clean preview.
      description: cleanTitle(doc.querySelector(".kol-series-editorial__synopsis-preview")?.text()) || undefined,
      author: cleanTitle(doc.querySelector(".kol-series-editorial__byline a")?.text()) || undefined,
      status: mapStatus(doc.querySelector(".kol-series-editorial__status")?.text()),
      chapters: Number((facts["الفصول"] || "").replace(/\D/g, "")) || undefined,
      originalLanguage,
      genres: doc.querySelectorAll(".kol-series-editorial__genres a").map((a) => cleanTitle(a.text())).filter(Boolean),
    };
  },
 
  // The series page ships empty chapter lists. The site fills each volume through
  //   GET /wp-admin/admin-ajax.php?action=kol_series_volume_chapters
  //       &nonce=<data-kol-volume-nonce>&series_id=<data-kol-series-id>
  //       &volume=<data-kol-chapter-volume>&page=N&anchor_id=0
  // returning {success, data:{html, page, pages, total}}. Pages are newest-first, and
  // volumes are listed newest-first, so both are reversed into reading order.
  async chapters(id) {
    const main = await getDoc(seriesPath(id));
    const index = main.querySelector("[data-kol-chapter-index]");
    if (!index) return [];
    const nonce = index.attr("data-kol-volume-nonce") || "";
    const seriesNumericId = index.attr("data-kol-series-id") || "";
    const ajax = index.attr("data-kol-volume-url") || BASE + "/wp-admin/admin-ajax.php";
    const volumeNames = main.querySelectorAll("details[data-kol-chapter-volume]")
      .map((d) => d.attr("data-kol-chapter-volume") ?? "");
 
    async function fetchVolumePage(volume, page) {
      const url = ajax + "?action=kol_series_volume_chapters"
        + "&nonce=" + encodeURIComponent(nonce)
        + "&series_id=" + encodeURIComponent(seriesNumericId)
        + "&volume=" + encodeURIComponent(volume)
        + "&page=" + page + "&anchor_id=0";
      const res = await harbor.http(url, { responseType: "text", headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("http " + res.status + " for volume " + volume);
      const json = JSON.parse(res.body);
      if (!json?.success || typeof json.data?.html !== "string") throw new Error("bad volume response");
      return json.data;
    }
 
    const perVolume = [];
    for (const volume of volumeNames) {
      const rows = [];
      let pages = 1;
      for (let page = 1; page <= pages && page <= 100; page++) {
        const data = await fetchVolumePage(volume, page);
        pages = data.pages || 1;
        const doc = harbor.parseHtml("<ul>" + data.html + "</ul>");
        let items = doc.querySelectorAll("li[data-chapter-id]");
        if (!items.length) items = doc.querySelectorAll("li");
        items.forEach((li) => {
          const a = li.querySelector("a[href]");
          const href = a?.attr("href");
          if (!href) return;
          rows.push({
            href,
            number: cleanTitle(li.querySelector("[data-kol-chapter-number]")?.text()),
            title: cleanTitle(li.querySelector("[data-kol-chapter-title]")?.text()),
            label: cleanTitle(a.text()),
            date: li.querySelector("time")?.attr("datetime") || undefined,
          });
        });
      }
      perVolume.push({ volume, rows: rows.reverse() }); // oldest first inside the volume
    }
    perVolume.reverse(); // oldest volume first
 
    const out = [];
    const seen = new Set();
    for (const { volume, rows } of perVolume) {
      const volNumber = volume.match(/المجلد\s*([\d.]+)/)?.[1];
      for (const r of rows) {
        if (seen.has(r.href)) continue;
        seen.add(r.href);
        const parsed = parseChapterLabel(r.label);
        out.push({
          id: chapterIdFromHref(r.href),
          chapter: (r.number.match(/[\d.]+/)?.[0]) || parsed.chapter,
          position: out.length,
          title: r.title || parsed.title,
          volume: volNumber, // only when the source names it, e.g. "المجلد 12" -> "12"
          volumeTitle: volume || undefined,
          pages: 0,
          language: "ar",
          publishAt: r.date,
        });
      }
    }
    return out;
  },
 
  // Reader body is [data-kol-reader-content] (named in the site's reader JS); VERIFY on a chapter page.
  async content(chapterId) {
    const doc = await getDoc(chapterPath(chapterId));
    let blocks = doc.querySelectorAll("[data-kol-reader-content] p");
    if (!blocks.length) blocks = doc.querySelectorAll(".entry-content > p, .chapter-content > p");
    if (!blocks.length) blocks = doc.querySelectorAll("article p, main p");
    // Source order only: never sort, reverse, or dedupe Arabic prose.
    return blocks.map((n) => n.text().trim()).filter(Boolean).join("\n\n");
  },
 
  async tags() {
    return [
      { id: "type:chinese", name: "صينية", group: "Type" },
      { id: "type:japanese", name: "يابانية", group: "Type" },
      { id: "type:korean", name: "كورية", group: "Type" },
      { id: "type:english", name: "إنجليزية", group: "Type" },
      { id: "status:completed", name: "مكتملة", group: "Status" },
      { id: "sort:update", name: "آخر التحديثات", group: "Sort" },
    ];
  },
};
 
Claude finished the response
