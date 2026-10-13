---
name: html-report
description: "Format for published HTML pages (publish_page): visual, phone-first cards with highlights, tags, diagrams and a CSS-only light/dark toggle; no footnotes."
updated: 1791694182969
origin: research
---

Format for Research's published HTML pages, made with publish_page. Based on the daily briefing v3 (github-trending/2026-10-10-daily-briefing-v3.html), which the operator likes. Use it for daily briefings and, scaled up, for general reports. The reader is on a 360 to 430px phone, often in dark mode.

Principles
- Signal first, then scannable cards. Someone should get the answer in 10 seconds and the detail in 2 minutes.
- Visual through hierarchy, colour tags, cards, bold key phrases and takeaway callouts. Not through decoration.
- Explanations are plain and somewhat descriptive: what it is, why it is interesting, how to use it. Still one or two sentences per item.
- No footnotes, no notes section, no sources section. A link on the item name is the source.
- No rank numbers and no trending position.
- Keep today's and this week's gains apart. Never mix periods in one unlabelled list.

Build rules
- One complete HTML document starting with <!doctype html>. Include <meta charset="utf-8">, <meta name="viewport" content="width=device-width,initial-scale=1">, <html lang="en"> and a <title>.
- All CSS inline in one <style> block. All SVG inline. Self-contained: no script except the optional theme memory script below, no web fonts, no images, no external CSS, no external src. Links to the original sources are the only external URLs.
- Publish with publish_page under the topic the brief names (for example github-trending). publish_page answers with a check of the stored page; fix any ⚠ it lists and publish again with the same topic and title (it replaces the page). The tool may add the date to the file name; use the returned link.

Theme toggle (required on every page; CSS-only, works without JS)
- The toggle is a visually hidden checkbox plus a label that acts as the sun/moon button. Clicking the label flips the checkbox, which flips the theme. The default follows the system setting (prefers-color-scheme). The checkbox checked state means "the opposite of the system theme", so no JS is needed to switch.
- The button is a 44px square tap target, 1px border in var(--rule), background var(--surface), fixed at top 6px, right 8px, z-index 10. It does not cover the date line or the title.
- Put the checkbox and label as the first children of body, in this order, with the exact markup:
<input type="checkbox" id="theme-check" class="theme-check" aria-label="Switch light or dark mode">
<label id="theme-toggle" for="theme-check" title="Switch light or dark mode"><span class="sr">Switch light or dark mode</span>
<svg class="ico-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
<svg class="ico-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
</label>
- Theme CSS (copy exactly). Light tokens are the base; the dark block follows the system; the two :has() rules swap the theme when the checkbox is checked:
:root{--bg:#fbfbfa;--text:#1c1f23;--muted:#5b626c;--accent:#2a5db0;--rule:#e4e6e9;--surface:#f3f5f8;--callout:#eaf1fb;--calloutline:#2a5db0;--agent-bg:rgba(42,93,176,.14);--agent-fg:#2a5db0;--skill-bg:rgba(107,63,176,.13);--skill-fg:#6b3fb0;--plugin-bg:rgba(31,122,77,.13);--plugin-fg:#1f7a4d;--workflow-bg:rgba(163,90,0,.14);--workflow-fg:#a35a00;--game-bg:rgba(176,58,58,.13);--game-fg:#b03a3a;--debug-bg:rgba(19,112,122,.14);--debug-fg:#13707a;color-scheme:light}
@media (prefers-color-scheme: dark){:root{--bg:#111315;--text:#e7e9ec;--muted:#9aa3ad;--accent:#8fb4f0;--rule:#2a2e33;--surface:#181b1f;--callout:#172235;--calloutline:#8fb4f0;--agent-bg:rgba(143,180,240,.16);--agent-fg:#8fb4f0;--skill-bg:rgba(195,166,240,.16);--skill-fg:#c3a6f0;--plugin-bg:rgba(127,211,166,.16);--plugin-fg:#7fd3a6;--workflow-bg:rgba(242,181,107,.16);--workflow-fg:#f2b56b;--game-bg:rgba(240,138,138,.16);--game-fg:#f08a8a;--debug-bg:rgba(127,208,218,.16);--debug-fg:#7fd0da;color-scheme:dark}}
@media (prefers-color-scheme: dark){:root:has(#theme-check:checked){--bg:#fbfbfa;--text:#1c1f23;--muted:#5b626c;--accent:#2a5db0;--rule:#e4e6e9;--surface:#f3f5f8;--callout:#eaf1fb;--calloutline:#2a5db0;--agent-bg:rgba(42,93,176,.14);--agent-fg:#2a5db0;--skill-bg:rgba(107,63,176,.13);--skill-fg:#6b3fb0;--plugin-bg:rgba(31,122,77,.13);--plugin-fg:#1f7a4d;--workflow-bg:rgba(163,90,0,.14);--workflow-fg:#a35a00;--game-bg:rgba(176,58,58,.13);--game-fg:#b03a3a;--debug-bg:rgba(19,112,122,.14);--debug-fg:#13707a;color-scheme:light}}
@media (prefers-color-scheme: light){:root:has(#theme-check:checked){--bg:#111315;--text:#e7e9ec;--muted:#9aa3ad;--accent:#8fb4f0;--rule:#2a2e33;--surface:#181b1f;--callout:#172235;--calloutline:#8fb4f0;--agent-bg:rgba(143,180,240,.16);--agent-fg:#8fb4f0;--skill-bg:rgba(195,166,240,.16);--skill-fg:#c3a6f0;--plugin-bg:rgba(127,211,166,.16);--plugin-fg:#7fd3a6;--workflow-bg:rgba(242,181,107,.16);--workflow-fg:#f2b56b;--game-bg:rgba(240,138,138,.16);--game-fg:#f08a8a;--debug-bg:rgba(127,208,218,.16);--debug-fg:#7fd0da;color-scheme:dark}}
- Icon and button CSS (copy exactly):
.theme-check{position:absolute;width:1px;height:1px;margin:0;opacity:0;pointer-events:none}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
#theme-toggle{position:fixed;top:6px;right:8px;z-index:10;width:44px;height:44px;border-radius:50%;border:1px solid var(--rule);background:var(--surface);color:var(--accent);display:flex;align-items:center;justify-content:center;padding:0;margin:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
#theme-check:focus-visible ~ #theme-toggle{outline:2px solid var(--accent);outline-offset:2px}
#theme-toggle svg{width:22px;height:22px}
#theme-toggle .ico-sun{display:none}
#theme-toggle .ico-moon{display:block}
@media (prefers-color-scheme: dark){#theme-toggle .ico-sun{display:block}#theme-toggle .ico-moon{display:none}}
@media (prefers-color-scheme: dark){#theme-check:checked ~ #theme-toggle .ico-sun{display:none}#theme-check:checked ~ #theme-toggle .ico-moon{display:block}}
@media (prefers-color-scheme: light){#theme-check:checked ~ #theme-toggle .ico-sun{display:block}#theme-check:checked ~ #theme-toggle .ico-moon{display:none}}
@supports not selector(:has(*)){#theme-toggle{display:none}}
- Tag colours use the variables above (.agent{background:var(--agent-bg);color:var(--agent-fg)} and so on for skill, plugin, workflow, game, debug), so they swap with the theme.
- Diagrams: colours use the CSS variables, and the arrow marker is coloured with svg marker path{fill:var(--accent)} so it switches too.
- Fallback: browsers without :has() follow the system theme only, and the button is hidden there. Each theme must still pass contrast on its own.
- Optional memory (the only script allowed; no inline handlers): place it right after the label, before main. It reads the saved choice from localStorage key "theme" inside try/catch, sets the checkbox to match, and saves the new choice on change. A saved choice wins on later visits.
<script>
(function(){
var c=document.getElementById('theme-check');if(!c)return;
var m=window.matchMedia('(prefers-color-scheme: dark)');
try{var s=localStorage.getItem('theme');if(s==='light'||s==='dark')c.checked=(s==='dark')!==m.matches}catch(e){}
c.addEventListener('change',function(){try{localStorage.setItem('theme',(m.matches!==c.checked)?'dark':'light')}catch(e){}});
})();
</script>
- Without the memory script the page still works fully; it just resets to the system theme on each visit.

Page structure, in order
1. Date line: muted, 15px, semibold, shown once. Example: "10 Oct 2026 · GitHub trending".
2. h1 title: 25px, under ten words, states the trend or answer.
3. Signal callout: a single callout box (see callout) with the tag "🎯 Today's signal" and 2 to 3 sentences. It states the trend or answer, bolds the one or two key phrases, and its counts must match the cards below. No bullets.
4. Groups: one h2 per period or kind of figure. Examples: "🔥 Gained today", "📆 Gained this week". Most important first inside each group.
5. Each group ends with a takeaway callout (tag "💡 Takeaway"), one or two sentences, when the group has three or more items. It says what the group means, not a restatement.
6. Diagrams sit inside the card they explain, at the bottom of the card. At most three per page; none is fine.

Card anatomy (every item card, same order)
- Pill row: one colour-coded category tag (see tag system).
- Name line: the repo or subject, as a link, 20px, weight 700. The link is the tap target (display inline-block, padding 6px 0).
- Stats line: 15px muted, middot-separated, four facts at most. Figures bold weight 600 in the text colour. Every gain names its period in words: "gained today" or "gained this week". Use "~" only before rounded figures; do not add the word "approximate".
- Body: one or two sentences, 18px, present tense, plain words, 60 words at most. Covers what it is and why it matters or how to use it. Start with the thing, not with "This tool".
- Optional diagram in a figure (see diagram rules).
- Do not write labels such as "What it does" or "How to use", and no licence chips, forks, ranks, badges or extra pills.
- Cards are separated by 12px. Do not use a rule line between cards.

Highlights and bold
- Bold only the single most useful phrase in each body (one <strong>, rarely two). The name and numbers are already prominent.
- In the signal, bold at most two phrases: the trend and the lead item name.
- Never bold a whole sentence. If more than about one phrase per card is bold, cut back: bold loses value when everything is bold.
- Use colour only for tags, links and callouts, never for emphasis in running text.

Tag and colour system
- Each category tag is a pill: 15px, weight 600, radius 999px, padding 2px 10px, tinted background with matching text.
- Category to colour: Agent tool, Agent skill, Agent plugins, Agent teams are blue or purple (agent = blue; skill = purple). Workflow (documents, decks) is amber. Plugins and marketplaces are green. Games are red. Debugging and developer utilities are teal.
- Keep labels consistent across runs: one label per category. Emoji in labels are fine, one per tag.
- No coloured warning boxes. Red, yellow or green are only used for category tags, never for warnings or caveats.
- Use "Watch" only when a caution changes what the reader should do, and then as plain text, not as a box.

Callouts
- Callout: rounded 10px box, 4px left border in the accent colour, tinted background, padding 14px 16px. Tag line 15px bold accent, then body at 18px.
- Use two kinds only: the signal (top) and takeaways (group ends). Not more than one per screen of content.

Diagrams: when to use one
- Use one only when a sentence cannot make a relationship or a change clear: an architecture (one agent, one server, several tools), an interaction between parts, a before and after comparison, or a lifecycle.
- Do not use one for a plain tool, a simple input, process and output chain, or a list. Do not put one on every card.
- Mark sketches as sketches in the caption only if the picture is the author's illustration and not the tool's real internals. Caption 8 words at most, 15px muted.

Diagrams: how to draw
- Inline SVG, viewBox "0 0 320 150" (or 160 for a two-row before and after), svg { width:100%; height:auto; display:block }. Never a fixed width above 340.
- At most three boxes and two arrows in a row, or four boxes in a two-row before and after.
- Box labels 14px minimum (SVG units), three words at most, no sub-labels. Row labels (for example "Without it") 14px muted.
- Boxes: rect rx="8", stroke-width 1.5, fill var(--surface), stroke var(--accent). Highlight box: fill var(--callout). Arrows: stroke var(--accent), stroke-width 1.5, with an arrowhead marker fill var(--accent). Text in var(--text). No gradients, shadows or icons.
- Numbers in a diagram must match the text.
- The figure wrapper: background var(--bg), radius 10px, padding 10px, margin-top 14px.
- Each marker id must be unique on the page (use ah, ah2, and so on).

Layout and typography
- Font stack: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif.
- Four sizes only in HTML text: 25px title, 20px name and h2, 18px body, 15px for dates, stats, tags, captions and labels. Line-height 1.6 (1.3 for headings).
- Main: max-width 680px, margin 0 auto, padding 24px 16px 56px. One column.
- Section spacing: h2 margin 32px top, 12px bottom, with 2px bottom border in var(--rule). Card padding 16px, radius 12px. Callout margin 0 0 4px.
- No uppercase labels, no letter-spacing tricks, no italics, no justified text, no hover-only content.
- Long names: word-break break-word.
- Tables: avoid. If needed, wrap in a div with overflow-x auto and at most three columns.
- Focus state on links: outline 2px accent, offset 2px.

Colour tokens (define on :root, redefine in dark mode)
Light: --bg #fbfbfa; --text #1c1f23; --muted #5b626c; --accent #2a5db0; --rule #e4e6e9; --surface #f3f5f8; --callout #eaf1fb; --calloutline #2a5db0.
Dark: --bg #111315; --text #e7e9ec; --muted #9aa3ad; --accent #8fb4f0; --rule #2a2e33; --surface #181b1f; --callout #172235; --calloutline #8fb4f0.
Set color-scheme: light dark on :root. Dark tokens apply through the CSS-only toggle rules above (system setting by default, the opposite when the checkbox is checked).
Tag tints (light / dark): agent rgba(42,93,176,.14) text #2a5db0 / rgba(143,180,240,.16) text #8fb4f0; skill rgba(107,63,176,.13) text #6b3fb0 / rgba(195,166,240,.16) text #c3a6f0; plugin rgba(31,122,77,.13) text #1f7a4d / rgba(127,211,166,.16) text #7fd3a6; workflow rgba(163,90,0,.14) text #a35a00 / rgba(242,181,107,.16) text #f2b56b; game rgba(176,58,58,.13) text #b03a3a / rgba(240,138,138,.16) text #f08a8a; debug rgba(19,112,122,.14) text #13707a / rgba(127,208,218,.16) text #7fd0da.
Contrast: muted text must reach 4.5:1 on both the background and the surface. Light muted #5b626c passes; dark muted #9aa3ad passes.
No white boxes in dark mode. Keep the body background set explicitly.

Length
- Daily page: body text about 600 words at most. About 6 to 8 cards in total, in two groups.
- Longer reports: h2 sections of four or five items, the same signal at the top, the same card anatomy, takeaway at the end of each section. Sources are not listed; the item link is the source.

Pre-publish checklist
1. Starts with <!doctype html>; viewport meta, charset and title present.
2. No script except the optional theme memory script; no inline handlers; no external src or href beyond the item and source links; no web fonts or images.
3. Date shown once; title under ten words.
4. Signal is 2 or 3 sentences, states the trend, and every count in it matches the cards. Check the arithmetic (for example "five of the six" needs five agent-tagged cards out of six in that group).
5. Every card: pill, name link, stats line, one or two sentences. Nothing else unless it is a diagram that earns its place.
6. Gains are labelled by period; today and this week sit in separate h2 groups. No trending position or rank anywhere.
7. Bold: at most one phrase per card body; at most two in the signal. No coloured warning boxes. No caveat sentences in the body. No footnotes, notes or sources sections.
8. Numbers: only figures confirmed in the research. Rounded figures carry a single "~" before them.
9. Diagrams: at most three; each shows a relationship, interaction, comparison or lifecycle; viewBox set; labels 14px or larger; nothing cut off; numbers match the text; marker ids unique.
10. HTML text uses only 25, 20, 18 and 15px.
11. Dark mode: no white boxes; text and muted contrast pass; tag tints swap.
12. Tap targets: name links have padding; cards at least 12px apart.
13. After publishing: read the check in publish_page's answer, fix any ⚠ and republish; confirm the date in the file name and that the checklist passes.
14. Theme toggle: present in the top-right corner as a 44px sun and moon button; works without JS and switches all colors including diagrams; follows the system setting by default; both themes checked for text, tags, highlights and diagram contrast.
