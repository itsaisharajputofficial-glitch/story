#!/usr/bin/env node
/*
 * build-html.js
 * Generates a multi-page, responsive reader:
 *   - index.html  -> cover + table of contents (hub page)
 *   - part-N.html -> one page per part, with prev/next/contents navigation
 *
 * from the part-*.md files in this directory.
 *
 * Re-run any time you add more parts (part-6.md, part-7.md, ...):
 *   node build-html.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const OUT = path.join(DIR, 'index.html');

/* ---------- small helpers ---------- */

const escapeHtml = (s) => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

// Curly double quotes — alternates open/close per call (per paragraph).
const smartQuotes = (s) => {
  let out = '';
  let open = true;
  for (const ch of s) {
    if (ch === '"') { out += open ? '\u201C' : '\u201D'; open = !open; }
    else out += ch;
  }
  return out;
};

// Inline markdown -> HTML, with smart typography.
const inline = (s) => {
  let out = escapeHtml(s);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/'/g, '\u2019'); // smart apostrophes
  out = smartQuotes(out);            // curly double quotes
  return out;
};

// Escape + smart apostrophes only (for headings/labels).
const smartApo = (s) => escapeHtml(s).replace(/'/g, '\u2019');

const ORD = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
  'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
  'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
const partName = (n) => 'Part ' + (ORD[n] || String(n));

/* ---------- read & parse parts ---------- */

const files = fs.readdirSync(DIR)
  .filter((f) => /^part-\d+\.md$/i.test(f))
  .sort((a, b) => (parseInt(a.match(/\d+/)[0], 10) || 0) - (parseInt(b.match(/\d+/)[0], 10) || 0));

function parsePart(file) {
  const n = parseInt(file.match(/\d+/)[0], 10) || 0;
  const raw = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/\r\n/g, '\n').trim();
  const lines = raw.split('\n');

  const title = lines[0].replace(/^#\s*/, '').trim();
  const tm = title.match(/^(.*?)\s*(?:—|:)\s*(PART\s+[A-Z]+)$/i);
  const seriesName = tm ? tm[1].trim() : 'A Mad Man\'s Fiction';
  const partLabel = tm ? tm[2].trim() : title;

  let epigraph = '';
  let bodyStart = 1;
  while (bodyStart < lines.length && lines[bodyStart].trim() === '') bodyStart++;
  if (bodyStart < lines.length && /^\*[^*]+\*$/.test(lines[bodyStart].trim())) {
    epigraph = lines[bodyStart].trim().slice(1, -1);
    bodyStart++;
  }

  // group body into paragraphs (blank-line separated)
  const paras = [];
  let buf = [];
  const flush = () => { if (buf.length) paras.push(buf.join('\n')); buf = []; };
  for (let i = bodyStart; i < lines.length; i++) {
    if (lines[i].trim() === '') flush();
    else buf.push(lines[i]);
  }
  flush();

  const out = [];
  let nextTeaser = '';

  for (let i = 0; i < paras.length; i++) {
    const t = paras[i].trim();

    if (t === '---') {
      out.push('<hr class="ornament" aria-hidden="true">');
      continue;
    }

    if (/^\*\*(.+?)\*\*$/.test(t)) {
      const inner = t.slice(2, -2);
      const dm = inner.match(/^DEVA\s*:?\s*(.*)$/i);
      out.push(dm
        ? '<p class="msg"><span class="who">DEVA</span><span class="sep">:</span> ' + inline(dm[1]) + '</p>'
        : '<p class="msg">' + inline(inner) + '</p>');
      continue;
    }

    if (/^\*End of Part .*\.\*$/i.test(t)) {
      let block = '<footer class="part-end"><p class="end-title">' + inline(t.slice(1, -1)) + '</p>';
      if (i + 1 < paras.length && /^\*\s*(?:—\s*)?To be continued/i.test(paras[i + 1].trim())) {
        const nt = paras[i + 1].trim().slice(1, -1);
        const mm = nt.match(/To be continued[:.]?\s*In\s+(Part\s+[A-Za-z]+)[:,]\s*(.+)$/i);
        if (mm) {
          nextTeaser = mm[2].replace(/\.\s*$/, '');
          block += '<p class="end-next">To be continued in <strong>' + mm[1] + '</strong> — <em>' + inline(mm[2]) + '</em></p>';
        } else {
          block += '<p class="end-next">' + inline(nt) + '</p>';
        }
        i++;
      }
      block += '</footer>';
      out.push(block);
      continue;
    }

    if (/^\*[^*]+\*$/.test(t)) {
      out.push('<p class="thought">' + inline(t.slice(1, -1)) + '</p>');
      continue;
    }

    out.push('<p>' + inline(t) + '</p>');
  }

  // drop cap on the first real paragraph
  for (let i = 0; i < out.length; i++) {
    if (out[i].startsWith('<p>')) { out[i] = out[i].replace('<p>', '<p class="lead">'); break; }
  }

  return { n, seriesName, partLabel, epigraph, bodyHtml: out.join('\n'), nextTeaser };
}

const parts = files.map(parsePart);
const minN = Math.min.apply(null, parts.map((p) => p.n));
const maxN = Math.max.apply(null, parts.map((p) => p.n));

/* ---------- table of contents, cover, parts ---------- */

const FALLBACK_SUB = { 1: 'the woman they think they know' };

const toc = parts.map((p, idx) => ({
  n: p.n,
  name: partName(p.n),
  sub: idx > 0 ? (parts[idx - 1].nextTeaser || '') : (FALLBACK_SUB[p.n] || '')
}));

let totalWords = 0;
for (const p of parts) {
  totalWords += fs.readFileSync(path.join(DIR, 'part-' + p.n + '.md'), 'utf8')
    .split(/\s+/).filter(Boolean).length;
}
const mins = Math.max(1, Math.round(totalWords / 250));
const readTime = mins >= 60
  ? Math.floor(mins / 60) + ' hr' + (mins % 60 ? ' ' + (mins % 60) + ' min' : '')
  : mins + ' min';

const seriesName = parts[0].seriesName;
const coverTitle = smartApo(seriesName).replace(/(Man’s)\s/, '$1<br>');
const partFile = (n) => 'part-' + n + '.html';

const tocHtml = '<ol>\n' + toc.map((e) =>
  '<li><a href="' + partFile(e.n) + '">' +
    '<span class="num">' + String(e.n).padStart(2, '0') + '</span>' +
    '<span class="name">' + escapeHtml(e.name) + '</span>' +
    (e.sub ? '<span class="sub">' + escapeHtml(e.sub) + '</span>' : '') +
  '</a></li>'
).join('\n') + '\n</ol>';

const coverHtml = [
  '<header class="cover" id="top">',
  '  <p class="cover-kicker">' + inline(parts[0].epigraph || '') + '</p>',
  '  <h1 class="cover-title">' + coverTitle + '</h1>',
  '  <p class="cover-sub">' + partName(minN) + ' – ' + partName(maxN) + ' &middot; ' + totalWords.toLocaleString('en-US') + ' words &middot; ' + readTime + ' read &middot; 18+</p>',
  '  <div class="cover-cta"><a class="cta" href="' + partFile(minN) + '">Begin reading</a></div>',
  '  <span class="scroll-hint" aria-hidden="true">↓</span>',
  '</header>'
].join('\n');

const renderPartContent = (p) => {
  const prev = p.n > minN ? p.n - 1 : null;
  const next = p.n < maxN ? p.n + 1 : null;
  return [
    '<main class="reader">',
    '  <section id="part-' + p.n + '" class="part" aria-labelledby="part-' + p.n + '-title">',
    '    <header class="part-header">',
    '      <p class="series">' + smartApo(p.seriesName) + '</p>',
    '      <h2 class="part-title" id="part-' + p.n + '-title">' + escapeHtml(partName(p.n)) + '</h2>',
    p.epigraph ? '      <p class="epigraph">' + inline(p.epigraph) + '</p>' : '',
    '    </header>',
    p.bodyHtml,
    '    <nav class="part-nav" aria-label="Part navigation">',
    prev != null
      ? '      <a class="nav-link prev" href="' + partFile(prev) + '">&larr; ' + escapeHtml(partName(prev)) + '</a>'
      : '      <a class="nav-link prev" href="index.html">&larr; Contents</a>',
    '      <a class="nav-link contents" href="index.html#toc">Contents</a>',
    next != null
      ? '      <a class="nav-link next" href="' + partFile(next) + '">' + escapeHtml(partName(next)) + ' &rarr;</a>'
      : '      <span class="nav-link next disabled">The End &bull;</span>',
    '    </nav>',
    '  </section>',
    '  <footer class="colophon">',
    '    <div class="mark">✦</div>',
    '    <p>' + escapeHtml(partName(p.n)) + ' of ' + escapeHtml(partName(maxN)) + '</p>',
    '  </footer>',
    '</main>'
  ].join('\n');
};

/* ---------- styles ---------- */

const CSS_A = `
:root{
  --font-body:"Literata",Georgia,"Iowan Old Style","Palatino Linotype","Times New Roman",serif;
  --font-display:"Cormorant Garamond","Iowan Old Style",Georgia,serif;
  --reader-scale:1;
  --bg:#f7f1e8;--surface:#fdfaf4;--text:#2a231c;--muted:#8d7d6c;--accent:#8f1d2c;
  --accent-soft:rgba(143,29,44,.07);--line:rgba(42,35,28,.15);--topbar:rgba(247,241,232,.88);
  --shadow:0 20px 60px rgba(30,20,12,.08);
}
[data-theme="sepia"]{--bg:#f1e7cf;--surface:#f7efe0;--text:#44351f;--muted:#8b7958;--accent:#7e1a29;--accent-soft:rgba(126,26,41,.08);--line:rgba(68,53,31,.18);--topbar:rgba(241,231,207,.9)}
[data-theme="dark"]{--bg:#15110e;--surface:#1c1713;--text:#ddd2c5;--muted:#9b8d7d;--accent:#e08c99;--accent-soft:rgba(224,140,153,.13);--line:rgba(221,210,197,.16);--topbar:rgba(21,17,14,.9)}

*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth;font-size:calc(1.075rem * var(--reader-scale))}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-body);line-height:1.82;font-weight:400;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;transition:background .4s ease,color .4s ease;overflow-x:hidden}
a{color:var(--accent)}
::selection{background:var(--accent);color:var(--surface)}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px}

.progress{position:fixed;top:0;left:0;height:2px;width:0;background:var(--accent);z-index:70;box-shadow:0 0 10px var(--accent)}
.topbar{position:fixed;top:0;left:0;right:0;z-index:60;display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.55rem clamp(.9rem,4vw,2rem);background:var(--topbar);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.brand{font-family:var(--font-display);font-weight:600;letter-spacing:.16em;text-transform:uppercase;font-size:.74rem;color:var(--muted);white-space:nowrap;text-decoration:none}
.controls{display:flex;align-items:center;gap:.3rem}
.icon-btn{border:1px solid var(--line);background:transparent;color:var(--text);border-radius:999px;min-width:2.1rem;height:2.1rem;padding:0 .55rem;display:inline-flex;align-items:center;justify-content:center;font:inherit;font-size:.92rem;cursor:pointer;text-decoration:none;transition:border-color .2s,color .2s,background .2s}
.icon-btn:hover{border-color:var(--accent);color:var(--accent)}

.cover{min-height:100vh;min-height:100dvh;min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:7rem 1.4rem 4rem;position:relative}
.cover::before{content:"";position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 0%,var(--accent-soft),transparent 60%);pointer-events:none}
.cover>*{position:relative}
.cover-kicker{letter-spacing:.3em;text-transform:uppercase;font-size:.66rem;color:var(--muted);margin:0 0 1.6rem;max-width:34rem;line-height:2}
.cover-title{font-family:var(--font-display);font-weight:600;font-size:clamp(3.1rem,11vw,6.5rem);line-height:.96;margin:0;letter-spacing:-.01em}
.cover-sub{font-size:.8rem;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);margin:1.8rem 0 0}
.cover-cta{margin-top:2.6rem}
.cta{display:inline-block;text-decoration:none;color:var(--surface);background:var(--accent);padding:.85rem 1.9rem;border-radius:999px;font-size:.9rem;letter-spacing:.14em;text-transform:uppercase;transition:transform .2s,box-shadow .2s;box-shadow:0 10px 30px rgba(143,29,44,.28)}
.cta:hover{transform:translateY(-2px)}
.scroll-hint{position:absolute;bottom:1.4rem;left:50%;transform:translateX(-50%);color:var(--muted);font-size:1.2rem;animation:bob 2s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translate(-50%,0)}50%{transform:translate(-50%,7px)}}

.reader{padding:0 clamp(1.2rem,4vw,2rem)}
.toc{padding:4rem 0 5rem;max-width:40rem;margin:0 auto;scroll-margin-top:5rem}
.toc-heading{font-family:var(--font-display);font-weight:600;letter-spacing:.24em;text-transform:uppercase;text-align:center;font-size:1rem;color:var(--muted);margin:0 0 2rem}
.toc-heading::after{content:"";display:block;width:3.4rem;height:1px;background:var(--accent);margin:.9rem auto 0}
.toc ol{list-style:none;margin:0;padding:0}
.toc a{display:flex;flex-direction:column;gap:.1rem;text-decoration:none;color:var(--text);padding:1.15rem .4rem;border-bottom:1px solid var(--line);transition:background .2s,padding .2s}
.toc a:hover{background:var(--accent-soft);padding-left:.9rem}
.toc .num{font-family:var(--font-display);font-size:.78rem;letter-spacing:.2em;color:var(--accent)}
.toc .name{font-family:var(--font-display);font-weight:600;font-size:1.35rem;line-height:1.1}
.toc .sub{color:var(--muted);font-style:italic;font-size:.92rem}
`;

const CSS_B = `
.part{max-width:42rem;margin:0 auto;padding:6rem 0 3rem;scroll-margin-top:4.5rem}
.part-header{text-align:center;margin-bottom:2.6rem}
.series{font-size:.68rem;letter-spacing:.28em;text-transform:uppercase;color:var(--accent);margin:0 0 .7rem}
.part-title{font-family:var(--font-display);font-weight:600;font-size:clamp(2.1rem,7vw,3.2rem);letter-spacing:.06em;line-height:1;margin:0}
.epigraph{color:var(--muted);font-style:italic;font-size:.95em;margin:1.2rem auto 0;max-width:32rem}
.part p{margin:0 0 1.4em}
.part p.lead::first-letter{font-family:var(--font-display);font-weight:600;float:left;font-size:3.3em;line-height:.8;padding:.05em .13em 0 0;color:var(--accent)}
hr.ornament{border:0;margin:2.7rem auto;text-align:center;overflow:visible}
hr.ornament::after{content:"✦ ✦ ✦";color:var(--muted);font-size:.78rem;opacity:.8}
p.msg{text-align:center;margin:2.4rem auto;max-width:28rem;background:var(--accent-soft);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:14px;padding:1.05rem 1.4rem;font-size:.98em}
p.msg .who{font-family:var(--font-display);font-weight:700;letter-spacing:.2em;text-transform:uppercase;font-size:.9em;color:var(--accent);margin-right:.35em}
p.msg .sep{color:var(--muted)}
p.thought{text-align:center;font-style:italic;font-size:1.14em;line-height:1.6;color:var(--muted);margin:2.2rem auto;max-width:30rem}
p.thought::before{content:"“ ";color:var(--accent);opacity:.55}
p.thought::after{content:" ”";color:var(--accent);opacity:.55}
.part-end{text-align:center;margin:4rem auto 0;padding-top:2.4rem;border-top:1px solid var(--line);max-width:34rem}
.end-title{font-family:var(--font-display);font-weight:600;letter-spacing:.24em;text-transform:uppercase;font-size:.82rem;color:var(--muted);margin:0 0 1rem}
.end-title::before,.end-title::after{content:"—";margin:0 .7em;opacity:.55}
.end-next{color:var(--muted);font-style:italic;margin:0}
.end-next em{color:var(--accent);font-style:italic}
.end-next strong{font-style:normal;letter-spacing:.04em}
.part-nav{display:flex;justify-content:space-between;gap:1rem;margin-top:3.2rem;padding-top:1.6rem;border-top:1px solid var(--line)}
.nav-link{text-decoration:none;color:var(--text);border:1px solid var(--line);padding:.7rem 1.15rem;border-radius:999px;font-size:.9rem;transition:border-color .2s,color .2s}
.nav-link:hover{border-color:var(--accent);color:var(--accent)}
.nav-link.contents{color:var(--muted)}
.nav-link.disabled{opacity:.35;pointer-events:none}
#toTop{position:fixed;right:1.1rem;bottom:1.1rem;z-index:55;display:none;border:1px solid var(--line);background:var(--surface);color:var(--accent);border-radius:999px;width:2.6rem;height:2.6rem;align-items:center;justify-content:center;cursor:pointer;box-shadow:var(--shadow);font-size:1rem;transition:transform .2s}
#toTop:hover{transform:translateY(-3px)}
.colophon{padding:3rem 1.25rem 5rem;text-align:center;color:var(--muted);font-size:.85rem}
.colophon .mark{font-family:var(--font-display);font-size:1.6rem;color:var(--accent)}
@media (max-width:640px){.part-nav{flex-direction:column}.nav-link{text-align:center}.brand{font-size:.66rem}}
@media (max-width:420px){.part p.lead::first-letter{font-size:2.7em}.toc a{padding:1rem .3rem}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important;animation:none!important}}
`;

/* ---------- page script ---------- */

const PAGE_JS = `
(function () {
  var root = document.documentElement;
  var THEMES = ['light', 'sepia', 'dark'];
  function readTheme() {
    var t = localStorage.getItem('ammf-theme');
    return THEMES.indexOf(t) >= 0 ? t : 'light';
  }
  function readScale() {
    var s = parseFloat(localStorage.getItem('ammf-scale'));
    return (s >= 0.8 && s <= 1.45) ? s : 1;
  }
  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    var b = document.getElementById('themeBtn');
    if (b) {
      b.textContent = (t === 'light') ? '☀' : (t === 'sepia') ? '◐' : '☾';
      b.setAttribute('aria-label', 'Theme: ' + t);
    }
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim());
  }
  function cycleTheme() {
    var i = THEMES.indexOf(root.getAttribute('data-theme') || 'light');
    var next = THEMES[(i + 1) % THEMES.length];
    applyTheme(next);
    localStorage.setItem('ammf-theme', next);
  }
  function applyScale(s) { root.style.setProperty('--reader-scale', String(s)); }
  function bumpScale(d) {
    var s = Math.min(1.45, Math.max(0.8, Math.round((readScale() + d) * 100) / 100));
    applyScale(s);
    localStorage.setItem('ammf-scale', String(s));
  }
  var bar = document.getElementById('progress');
  var toTop = document.getElementById('toTop');
  function onScroll() {
    var h = document.documentElement;
    var max = h.scrollHeight - h.clientHeight;
    if (bar) bar.style.width = (max > 0 ? (h.scrollTop / max * 100) : 0) + '%';
    if (toTop) toTop.style.display = (h.scrollTop > 700) ? 'flex' : 'none';
  }
  var tb = document.getElementById('themeBtn');
  if (tb) tb.addEventListener('click', cycleTheme);
  var fm = document.getElementById('fontMinus');
  var fp = document.getElementById('fontPlus');
  if (fm) fm.addEventListener('click', function () { bumpScale(-0.05); });
  if (fp) fp.addEventListener('click', function () { bumpScale(0.05); });
  if (toTop) toTop.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  window.addEventListener('scroll', onScroll, { passive: true });
  applyTheme(readTheme());
  applyScale(readScale());
  onScroll();
})();
`;

const CSS = CSS_A + CSS_B;

const descParts = partName(minN) + ' to ' + partName(maxN);
const favicon = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'%3E%3Ctext y=\'0.9em\' font-size=\'90\' fill=\'%238f1d2c\'%3E%E2%9C%A6%3C/text%3E%3C/svg%3E';

const head = (title, desc) =>
  '<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  '<meta name="theme-color" content="#f7f1e8">\n' +
  '<meta name="description" content="' + smartApo(desc) + '">\n' +
  '<title>' + smartApo(title) + '</title>\n' +
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,500;0,7..72,600;1,7..72,400;1,7..72,500&display=swap" rel="stylesheet">\n' +
  '<link rel="icon" href="' + favicon + '">\n' +
  '<style>' + CSS + '</style>\n';

const topbarHtml =
  '<header class="topbar">\n' +
  '  <a class="brand" href="index.html">' + smartApo(seriesName) + '</a>\n' +
  '  <div class="controls" role="group" aria-label="Reading controls">\n' +
  '    <a class="icon-btn" href="index.html#toc" aria-label="Contents" title="Contents">☰</a>\n' +
  '    <button id="fontMinus" class="icon-btn" aria-label="Decrease text size" title="Smaller text">A−</button>\n' +
  '    <button id="fontPlus" class="icon-btn" aria-label="Increase text size" title="Larger text">A+</button>\n' +
  '    <button id="themeBtn" class="icon-btn" aria-label="Change theme" title="Theme">☀</button>\n' +
  '  </div>\n' +
  '</header>\n';

const shell = (title, desc, bodyInner) =>
  '<!doctype html>\n' +
  '<html lang="en" data-theme="light">\n' +
  '<head>\n' + head(title, desc) + '</head>\n' +
  '<body>\n' +
  '<div id="progress" class="progress"></div>\n' +
  topbarHtml + '\n' +
  bodyInner + '\n' +
  '<button id="toTop" aria-label="Back to top">↑</button>\n' +
  '<script>' + PAGE_JS + '</script>\n' +
  '</body>\n</html>\n';

const colophonHtml =
  '  <footer class="colophon">\n' +
  '    <div class="mark">✦</div>\n' +
  '    <p>' + smartApo(seriesName) + ' — a work of fiction of a mad man with mad tastes.</p>\n' +
  '    <p>' + totalWords.toLocaleString('en-US') + ' words · ' + readTime + ' read · ' + parts.length + ' parts</p>\n' +
  '    <p>18+ · Adult fiction · All characters are adults</p>\n' +
  '  </footer>\n';

const hubBody =
  coverHtml + '\n' +
  '<main class="reader">\n' +
  '  <nav id="toc" class="toc" aria-label="Table of contents">\n' +
  '    <h2 class="toc-heading">Contents</h2>\n' +
  tocHtml + '\n' +
  '  </nav>\n' +
  colophonHtml +
  '</main>\n';

fs.writeFileSync(OUT, shell(
  smartApo(seriesName) + ' — ' + descParts,
  smartApo(seriesName) + ' — a serial work of fiction. ' + descParts + '.',
  hubBody
), 'utf8');
console.log('Wrote ' + OUT + ' (' + (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB)');

for (const p of parts) {
  const file = partFile(p.n);
  fs.writeFileSync(path.join(DIR, file), shell(
    smartApo(seriesName) + ' — ' + partName(p.n),
    smartApo(seriesName) + ' — ' + partName(p.n) + '. A serial work of fiction.',
    renderPartContent(p)
  ), 'utf8');
}
console.log('Parts: ' + parts.map((p) => p.n).join(', ') + ' (one page per part)');
console.log('Words: ' + totalWords.toLocaleString('en-US') + ' · ' + readTime + ' read');





