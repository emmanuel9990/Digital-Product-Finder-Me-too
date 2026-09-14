// Blueprint Forge — calls the Gemini API directly from the browser.
// Nothing here talks to any server other than generativelanguage.googleapis.com.

const STORAGE_KEYS = {
  apiKey: 'bf_gemini_api_key',
  model: 'bf_gemini_model',
  outputs: 'bf_outputs',
};

const DEFAULT_MODEL = 'gemini-2.5-flash';

// ---------- Persistence helpers ----------

function getApiKey() {
  return localStorage.getItem(STORAGE_KEYS.apiKey) || '';
}

function getModel() {
  return localStorage.getItem(STORAGE_KEYS.model) || DEFAULT_MODEL;
}

function getSavedOutputs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.outputs) || '{}');
  } catch {
    return {};
  }
}

function saveOutput(station, text) {
  const all = getSavedOutputs();
  all[station] = text;
  localStorage.setItem(STORAGE_KEYS.outputs, JSON.stringify(all));
}

// ---------- Toast ----------

let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

// ---------- Settings dialog ----------

const settingsDialog = document.getElementById('settingsDialog');
const apiKeyInput = document.getElementById('apiKeyInput');
const modelSelect = document.getElementById('modelSelect');

document.getElementById('settingsBtn').addEventListener('click', () => {
  apiKeyInput.value = getApiKey();
  modelSelect.value = getModel();
  settingsDialog.showModal();
});

document.querySelector('.settings-form').addEventListener('submit', (e) => {
  const action = e.submitter && e.submitter.value;
  if (action === 'save') {
    localStorage.setItem(STORAGE_KEYS.apiKey, apiKeyInput.value.trim());
    localStorage.setItem(STORAGE_KEYS.model, modelSelect.value);
    showToast('API key saved on this device.');
  }
});

// ---------- Station navigation ----------

const stationButtons = document.querySelectorAll('.station');
const panels = document.querySelectorAll('.station-panel');

stationButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.station;
    stationButtons.forEach((b) => b.classList.toggle('active', b === btn));
    panels.forEach((p) => p.classList.toggle('active', p.id === `panel-${target}`));
  });
});

// ---------- Gemini call ----------

async function callGemini(prompt, options = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    settingsDialog.showModal();
    throw new Error('Add your free Gemini API key first (top right).');
  }

  const model = getModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
  };
  // Grounds the response in real, current Google Search results — used for
  // Autopilot's market/topic research calls, not the short planning prompts.
  if (options.useSearch) {
    body.tools = [{ google_search: {} }];
  }
  if (options.maxOutputTokens) {
    body.generationConfig = { maxOutputTokens: options.maxOutputTokens };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error('Hit the free-tier rate limit. Wait a minute (or until tomorrow if it says quota exceeded) and try again.');
    }
    if (res.status === 400 || res.status === 403) {
      throw new Error('That API key was rejected. Double check it in Settings — get a fresh one at aistudio.google.com/apikey.');
    }
    throw new Error(`Gemini API returned an error (status ${res.status}). Try again in a moment.`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) {
    throw new Error('Gemini returned an empty response. Try rephrasing your input and running it again.');
  }
  return text;
}

// ---------- Very small text-to-HTML formatter ----------
// Expects loose markdown-ish text (## headings, - bullets) and renders it safely.

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderFormatted(rawText) {
  const lines = rawText.split('\n');
  let html = '';
  let inList = false;

  const closeList = () => {
    if (inList) { html += '</ul>'; inList = false; }
  };

  for (let line of lines) {
    line = line.trim();
    if (!line) { closeList(); continue; }

    const heading = line.match(/^#{1,4}\s+(.*)/);
    const bullet = line.match(/^[-*]\s+(.*)/);
    const numbered = line.match(/^\d+[\.\)]\s+(.*)/);

    if (heading) {
      closeList();
      html += `<h4>${escapeHtml(heading[1])}</h4>`;
    } else if (bullet || numbered) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${escapeHtml((bullet || numbered)[1])}</li>`;
    } else {
      closeList();
      html += `<p>${escapeHtml(line)}</p>`;
    }
  }
  closeList();
  return html;
}

function renderOutput(station, text) {
  const wrap = document.getElementById(`output-${station}`);
  const body = document.getElementById(`output-${station}-body`);
  body.innerHTML = renderFormatted(text);
  body.dataset.raw = text;
  wrap.hidden = false;
}

function renderError(station, message) {
  const wrap = document.getElementById(`output-${station}`);
  const body = document.getElementById(`output-${station}-body`);
  body.innerHTML = `<p class="error">${escapeHtml(message)}</p>`;
  wrap.hidden = false;
}

// ---------- Prompt builders ----------

function buildIdeasPrompt() {
  const skills = document.getElementById('ideasInput').value.trim();
  const audience = document.getElementById('ideasAudience').value.trim();

  if (!skills) throw new Error('Describe your skills or knowledge first.');

  return `You help people turn their skills into sellable digital products (courses, ebooks, templates, communities).

Someone has told you about their skills and knowledge:
"""
${skills}
"""
${audience ? `They're interested in helping this audience: "${audience}"` : ''}

Suggest exactly 5 digital product ideas grounded specifically in what they described — not generic advice. For each idea, use this exact format:

## [Product name]
- Format: [course / ebook / template / community / etc]
- Who it's for: [specific audience]
- The core promise: [one sentence on the transformation or result]
- Why they're credible to build this: [one sentence tying it to what they told you]

Keep the whole response under 400 words. No preamble, no closing remarks — start directly with the first idea.`;
}

function buildUvzPrompt() {
  const skills = document.getElementById('uvzSkills').value.trim();
  const struggles = document.getElementById('uvzStruggles').value.trim();

  if (!skills || !struggles) throw new Error('Fill in both what you bring and what your audience struggles with.');

  return `You help creators find their "Unique Value Zone" — the specific overlap between what they're good at and a problem their audience actually wants solved.

What they bring:
"""
${skills}
"""

What their audience struggles with:
"""
${struggles}
"""

Respond in this exact structure:

## Your Unique Value Zone
[2-3 sentences naming the specific overlap — be concrete, not generic]

## Why this is defensible
[1-2 sentences on what makes them credible here specifically, not just anyone]

## Three ways to prove this fits before building anything
- [a fast way to validate demand, tailored to their situation]
- [a second way]
- [a third way]

Keep it under 250 words. No preamble.`;
}

function buildBlueprintPrompt() {
  const product = document.getElementById('bpProduct').value.trim();
  const format = document.getElementById('bpFormat').value;
  const outcome = document.getElementById('bpOutcome').value.trim();

  if (!product) throw new Error('Describe the product idea first.');

  return `You write step-by-step product structures ("product charters") for creators building digital products.

Product idea: "${product}"
Format: ${format}
${outcome ? `The result a buyer should walk away with: "${outcome}"` : ''}

Write a product charter in this exact structure:

## Overview
[1-2 sentences on what this product is and who it's for]

## The journey: start → success
[4-7 numbered steps/modules/chapters, each one line, that take a buyer from where they start to the promised outcome. Order them logically.]

## What makes someone finish this
[1-2 sentences on the structural choice — pacing, accountability, format — that keeps a buyer engaged to the end]

Keep it under 350 words. No preamble, start directly with "## Overview".`;
}

function buildPricingPrompt() {
  const product = document.getElementById('pricingProduct').value.trim();
  const audience = document.getElementById('pricingAudience').value.trim();

  if (!product) throw new Error('Describe the product first.');

  return `You help creators price digital products sensibly — grounded suggestions to test, not guarantees.

Product: "${product}"
${audience ? `Buyer: "${audience}"` : ''}

Respond in this exact structure:

## Suggested price
[A single price or narrow range, e.g. "$47-$67"]

## Why this range
[2-3 sentences: format norms, buyer's likely budget, perceived value — be concrete, not generic]

## How to test it
- [a cheap, fast way to validate this price before a full launch]
- [a second way]

Be direct and specific with numbers. Do not hedge excessively. Keep it under 200 words. No preamble.`;
}

function buildDistributionPrompt() {
  const product = document.getElementById('distProduct').value.trim();
  const assets = document.getElementById('distAssets').value.trim();

  if (!product) throw new Error('Describe the product first.');
  if (!assets) throw new Error("Describe what you already have — even 'nothing yet' is a valid answer.");

  return `You help creators plan how to reach buyers for a new digital product using only what they already have — you never assume they have an audience, budget, or network they haven't mentioned.

Product: "${product}"
What they currently have: "${assets}"

Respond in this exact structure:

## Realistic starting point
[1-2 honest sentences on what their current assets make possible in the first two weeks — no inflated promises]

## Channels worth trying first
- [channel specific to what they described, with a one-line reason]
- [a second channel]
- [a third channel]

## First two weeks, roughly
1. [a concrete first action]
2. [a second]
3. [a third]

Keep it under 300 words. Be honest if their current assets are thin — say so plainly rather than papering over it. No preamble.`;
}

function buildDeliverPrompt() {
  const product = document.getElementById('deliverProduct').value.trim();
  const format = document.getElementById('deliverFormat').value;

  if (!product) throw new Error('Describe the product first.');

  return `You help creators design what happens in a buyer's first 24 hours after they pay for a digital product — the delivery experience that makes a purchase feel worth it immediately.

Product: "${product}"
Hosted/accessed via: ${format}

Respond in this exact structure:

## The first 24 hours
[2-3 sentences describing exactly what the buyer sees and does right after paying]

## Welcome message
[A short, ready-to-send welcome message a buyer receives immediately — 3-5 sentences, written in a warm, direct voice, no corporate tone]

## What prevents a refund request
- [a concrete thing to include that reduces buyer's-remorse or confusion]
- [a second thing]

Keep it under 300 words total. No preamble.`;
}

function buildScalePrompt() {
  const product = document.getElementById('scaleProduct').value.trim();
  const status = document.getElementById('scaleStatus').value.trim();

  if (!product) throw new Error('Describe the product first.');
  if (!status) throw new Error('Describe where it currently stands — even "zero sales yet" is fine.');

  return `You help creators decide what to do next with a digital product, grounded in where it actually stands today — you never suggest scaling tactics that assume more traction than they have.

Product: "${product}"
Current status: "${status}"

Respond in this exact structure:

## Honest read on where they are
[1-2 sentences on what this status actually means — e.g. too early to scale, ready for one specific next step, etc. Be direct.]

## Next moves, in order
1. [the single most useful next action given their status]
2. [a second]
3. [a third, only introduce upsells/referrals/repricing here if status shows real traction]

## One thing to avoid right now
[1-2 sentences on a common mistake at this exact stage]

Keep it under 280 words. No preamble.`;
}

function buildCoverPrompt() {
  const desc = document.getElementById('coverProductDesc').value.trim();
  if (!desc) throw new Error('Describe the product first.');

  return `You write short, punchy titles and taglines for digital product covers (courses, ebooks, guides).

Product: "${desc}"

Respond in this exact structure:

## Title options
- [option 1 — short, concrete, no vague hype]
- [option 2]
- [option 3]

## Tagline options
- [option 1 — one line, states the specific outcome]
- [option 2]
- [option 3]

Keep titles under 8 words and taglines under 14 words. No preamble.`;
}

function buildCoverPromptsPrompt() {
  const desc = document.getElementById('coverProductDesc').value.trim();
  const title = document.getElementById('coverTitle').value.trim();
  const subtitle = document.getElementById('coverSubtitle').value.trim();
  const styleKey = document.getElementById('coverStyle').value;
  const styleLabel = document.getElementById('coverStyle').selectedOptions[0].text;

  if (!desc) throw new Error('Describe the product first (above).');

  return `You write prompts for AI image generators (Midjourney, DALL-E, Ideogram, Stable Diffusion) to create digital product covers.

Product: "${desc}"
${title ? `Title to feature on the cover: "${title}"` : ''}
${subtitle ? `Subtitle/tagline: "${subtitle}"` : ''}
Preferred visual direction: "${styleLabel}"

Write exactly 3 distinct image-generation prompts for a cover illustration/background (not the typography — assume title text will be added separately in an editor). Each should describe: composition, subject matter, color palette, lighting/mood, and art style, in a single dense paragraph an image model can parse directly.

Respond in this exact structure:

## Prompt 1
[prompt text]

## Prompt 2
[prompt text]

## Prompt 3
[prompt text]

## Aspect ratio to request
[the aspect ratio setting to add, e.g. "--ar 4:5" for Midjourney, appropriate for a book/course cover]

No preamble, no explanation of the prompts — just the prompts themselves.`;
}

// ---------- Run buttons ----------

const promptBuilders = {
  ideas: buildIdeasPrompt,
  uvz: buildUvzPrompt,
  blueprint: buildBlueprintPrompt,
  pricing: buildPricingPrompt,
  distribution: buildDistributionPrompt,
  deliver: buildDeliverPrompt,
  scale: buildScalePrompt,
  cover: buildCoverPrompt,
  coverPrompts: buildCoverPromptsPrompt,
};

document.querySelectorAll('[data-run]').forEach((button) => {
  button.addEventListener('click', async () => {
    const station = button.dataset.run;
    let prompt;
    try {
      prompt = promptBuilders[station]();
    } catch (err) {
      renderError(station, err.message);
      return;
    }

    button.disabled = true;
    button.classList.add('loading');
    const originalLabel = button.textContent;
    button.textContent = 'Generating…';

    try {
      const text = await callGemini(prompt);
      renderOutput(station, text);
      saveOutput(station, text);
    } catch (err) {
      renderError(station, err.message || 'Something went wrong. Try again.');
    } finally {
      button.disabled = false;
      button.classList.remove('loading');
      button.textContent = originalLabel;
    }
  });
});

// ---------- Copy buttons ----------

document.querySelectorAll('[data-copy]').forEach((button) => {
  button.addEventListener('click', async () => {
    const bodyEl = document.getElementById(button.dataset.copy);
    const raw = bodyEl.dataset.raw || bodyEl.textContent;
    try {
      await navigator.clipboard.writeText(raw);
      showToast('Copied to clipboard.');
    } catch {
      showToast('Could not copy — select the text manually.');
    }
  });
});

// ---------- PDF export (via browser print) ----------
// No library needed: we open a clean, print-styled document and trigger the
// browser's native print dialog, where "Save as PDF" is a built-in destination.

const STATION_TITLES = {
  ideas: 'Product ideas',
  uvz: 'Your Unique Value Zone',
  blueprint: 'Product charter',
  pricing: 'Pricing suggestion',
  distribution: 'Distribution plan',
  deliver: 'Delivery plan',
  scale: 'Scaling suggestions',
  cover: 'Cover title & tagline options',
  coverPrompts: 'Cover image generation prompts',
};

const STATION_ORDER = ['ideas', 'uvz', 'blueprint', 'pricing', 'distribution', 'deliver', 'scale', 'cover', 'coverPrompts'];

function printDocument(pageTitle, sectionsHtml) {
  const win = window.open('', '_blank');
  if (!win) {
    showToast('Your browser blocked the print window — allow pop-ups for this page and try again.');
    return;
  }
  win.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${escapeHtml(pageTitle)}</title>
<style>
  body{
    font-family: Georgia, 'Source Serif 4', serif;
    max-width:680px;
    margin:48px auto;
    padding:0 24px;
    color:#1c2430;
    line-height:1.65;
    font-size:15px;
  }
  h1{
    font-size:24px;
    border-bottom:2px solid #1c2430;
    padding-bottom:14px;
    margin-bottom:8px;
  }
  h2.section-title{
    font-size:17px;
    margin-top:34px;
    margin-bottom:6px;
    color:#1b2a4a;
    border-bottom:1px solid #ccc;
    padding-bottom:4px;
  }
  h4{ font-size:15px; margin:18px 0 4px; }
  ul{ padding-left:20px; margin:6px 0; }
  li{ margin-bottom:5px; }
  p{ margin:8px 0; }
  .meta{ color:#777; font-size:12px; margin-bottom:28px; }
  @media print{
    body{ margin:0; padding:24px; }
  }
</style>
</head>
<body>
  <h1>${escapeHtml(pageTitle)}</h1>
  <p class="meta">Generated with Blueprint Forge · ${new Date().toLocaleDateString()}</p>
  ${sectionsHtml}
</body>
</html>`);
  win.document.close();
  win.focus();
  // Give the browser a moment to lay out the page before invoking print.
  setTimeout(() => win.print(), 350);
}

document.querySelectorAll('[data-pdf]').forEach((button) => {
  button.addEventListener('click', () => {
    const bodyEl = document.getElementById(button.dataset.pdf);
    const raw = bodyEl.dataset.raw;
    if (!raw) {
      showToast('Generate this section first.');
      return;
    }
    printDocument(button.dataset.pdfTitle || 'Blueprint Forge', renderFormatted(raw));
  });
});

document.getElementById('downloadAllBtn').addEventListener('click', () => {
  const saved = getSavedOutputs();
  const completed = STATION_ORDER.filter((s) => saved[s]);

  if (completed.length === 0) {
    showToast('Generate at least one section first.');
    return;
  }

  const sectionsHtml = completed
    .map((s) => `<h2 class="section-title">${escapeHtml(STATION_TITLES[s])}</h2>${renderFormatted(saved[s])}`)
    .join('');

  printDocument('Your product plan', sectionsHtml);
});

// ---------- Cover generator ----------
// Renders an actual cover graphic entirely client-side (SVG), so there's no
// image-generation API involved — no extra cost, no separate rate limit.

const COVER_WIDTH = 800;
const COVER_HEIGHT = 1000;

const COVER_STYLES = {
  bold: {
    background: `<rect width="${COVER_WIDTH}" height="${COVER_HEIGHT}" fill="#121d33"/>
      <rect width="${COVER_WIDTH}" height="${COVER_HEIGHT}" fill="url(#boldGrad)"/>
      <circle cx="700" cy="120" r="260" fill="#1b2a4a" opacity="0.5"/>`,
    defs: `<linearGradient id="boldGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1b2a4a"/><stop offset="100%" stop-color="#0d1526"/>
    </linearGradient>`,
    titleFill: '#f3efe6',
    subtitleFill: '#c9d2e3',
    authorFill: '#c07f2c',
    rule: '#c07f2c',
    titleFont: "'Source Serif 4', Georgia, serif",
    metaFont: "'IBM Plex Mono', monospace",
  },
  warm: {
    background: `<rect width="${COVER_WIDTH}" height="${COVER_HEIGHT}" fill="#f3efe6"/>
      <circle cx="120" cy="880" r="240" fill="#e9e3d4"/>
      <circle cx="680" cy="150" r="10" fill="#c07f2c"/>`,
    defs: '',
    titleFill: '#1c2430',
    subtitleFill: '#5c6472',
    authorFill: '#8a6a3f',
    rule: '#c07f2c',
    titleFont: "'Source Serif 4', Georgia, serif",
    metaFont: "'IBM Plex Mono', monospace",
  },
  technical: {
    background: `<rect width="${COVER_WIDTH}" height="${COVER_HEIGHT}" fill="#ffffff"/>
      ${Array.from({ length: 20 }, (_, i) => `<line x1="0" y1="${i * 50}" x2="${COVER_WIDTH}" y2="${i * 50}" stroke="#e7e2d5" stroke-width="1"/>`).join('')}
      ${Array.from({ length: 16 }, (_, i) => `<line x1="${i * 50}" y1="0" x2="${i * 50}" y2="${COVER_HEIGHT}" stroke="#e7e2d5" stroke-width="1"/>`).join('')}
      <rect x="40" y="40" width="${COVER_WIDTH - 80}" height="${COVER_HEIGHT - 80}" fill="none" stroke="#1c2430" stroke-width="2"/>`,
    defs: '',
    titleFill: '#1c2430',
    subtitleFill: '#5c6472',
    authorFill: '#1b2a4a',
    rule: '#1b2a4a',
    titleFont: "'Source Serif 4', Georgia, serif",
    metaFont: "'IBM Plex Mono', monospace",
  },
  playful: {
    background: `<rect width="${COVER_WIDTH}" height="${COVER_HEIGHT}" fill="url(#playGrad)"/>
      <circle cx="90" cy="130" r="70" fill="#ffffff" opacity="0.12"/>
      <circle cx="740" cy="900" r="140" fill="#121d33" opacity="0.15"/>`,
    defs: `<linearGradient id="playGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#c07f2c"/><stop offset="100%" stop-color="#8a5a1f"/>
    </linearGradient>`,
    titleFill: '#ffffff',
    subtitleFill: '#fbe9d3',
    authorFill: '#121d33',
    rule: '#121d33',
    titleFont: "'Source Serif 4', Georgia, serif",
    metaFont: "'IBM Plex Mono', monospace",
  },
};

// Simple manual word-wrap for SVG <text>, since SVG has no native wrapping.
function wrapSvgText(text, maxCharsPerLine) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const attempt = current ? `${current} ${word}` : word;
    if (attempt.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = attempt;
    }
  });
  if (current) lines.push(current);
  return lines;
}

function buildCoverSvg() {
  const title = document.getElementById('coverTitle').value.trim() || 'Your Product Title';
  const subtitle = document.getElementById('coverSubtitle').value.trim();
  const author = document.getElementById('coverAuthor').value.trim();
  const styleKey = document.getElementById('coverStyle').value;
  const style = COVER_STYLES[styleKey];

  const titleLines = wrapSvgText(title, 18);
  const titleFontSize = titleLines.length > 2 ? 52 : 62;
  const titleStartY = 560 - (titleLines.length - 1) * (titleFontSize * 0.6);

  const titleTspans = titleLines
    .map((line, i) => `<tspan x="70" dy="${i === 0 ? 0 : titleFontSize * 1.08}">${escapeHtml(line)}</tspan>`)
    .join('');

  const subtitleLines = subtitle ? wrapSvgText(subtitle, 40) : [];
  const subtitleTspans = subtitleLines
    .map((line, i) => `<tspan x="70" dy="${i === 0 ? 0 : 30}">${escapeHtml(line)}</tspan>`)
    .join('');

  return `<svg viewBox="0 0 ${COVER_WIDTH} ${COVER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>${style.defs}</defs>
    ${style.background}
    <line x1="70" y1="${titleStartY - titleFontSize - 30}" x2="150" y2="${titleStartY - titleFontSize - 30}" stroke="${style.rule}" stroke-width="4"/>
    <text x="70" y="${titleStartY}" font-family="${style.titleFont}" font-weight="700" font-size="${titleFontSize}" fill="${style.titleFill}">${titleTspans}</text>
    ${subtitle ? `<text x="70" y="${titleStartY + 55}" font-family="${style.metaFont}" font-size="20" fill="${style.subtitleFill}">${subtitleTspans}</text>` : ''}
    ${author ? `<text x="70" y="${COVER_HEIGHT - 60}" font-family="${style.metaFont}" font-size="17" letter-spacing="1" fill="${style.authorFill}">${escapeHtml(author.toUpperCase())}</text>` : ''}
  </svg>`;
}

function renderCoverPreview() {
  const svg = buildCoverSvg();
  document.getElementById('coverPreview').innerHTML = svg;
  document.getElementById('coverPreviewWrap').hidden = false;
}

document.getElementById('renderCoverBtn').addEventListener('click', renderCoverPreview);

function svgToPngDataUrl(svgString, width, height) {
  return new Promise((resolve, reject) => {
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

document.getElementById('downloadCoverPng').addEventListener('click', async () => {
  const svg = document.getElementById('coverPreview').querySelector('svg');
  if (!svg) { showToast('Render the cover first.'); return; }
  try {
    const dataUrl = await svgToPngDataUrl(svg.outerHTML, COVER_WIDTH * 2, COVER_HEIGHT * 2);
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'cover.png';
    a.click();
  } catch {
    showToast('Could not export PNG in this browser — try the PDF option instead.');
  }
});

document.getElementById('downloadCoverPdf').addEventListener('click', async () => {
  const svg = document.getElementById('coverPreview').querySelector('svg');
  if (!svg) { showToast('Render the cover first.'); return; }
  try {
    const dataUrl = await svgToPngDataUrl(svg.outerHTML, COVER_WIDTH * 2, COVER_HEIGHT * 2);
    const win = window.open('', '_blank');
    if (!win) { showToast('Your browser blocked the print window — allow pop-ups and try again.'); return; }
    win.document.write(`<!DOCTYPE html><html><head><title>Cover</title><style>
      body{ margin:0; display:flex; align-items:center; justify-content:center; background:#fff; }
      img{ width:100%; max-width:680px; height:auto; }
      @media print{ body{ margin:0; } img{ max-width:100%; } }
    </style></head><body><img src="${dataUrl}" alt="Cover"></body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  } catch {
    showToast('Could not prepare the PDF in this browser.');
  }
});

// ---------- Restore saved outputs on load ----------

window.addEventListener('DOMContentLoaded', () => {
  const saved = getSavedOutputs();
  Object.entries(saved).forEach(([station, text]) => {
    if (text) renderOutput(station, text);
  });

  if (!getApiKey()) {
    showToast('Add your free Gemini API key to get started.');
  }
});

// ---------- Autopilot ----------
// A self-contained, multi-step flow: research real market gaps → let the user
// pick one → research that topic for real → write it chapter by chapter →
// let the user edit → produce ONE finished long-form PDF of the product
// itself. The planning stations above (blueprint, pricing, etc.) are never
// shown to the eventual buyer — this flow never touches or displays them.

const autopilotDialog = document.getElementById('autopilotDialog');
const autopilotContent = document.getElementById('autopilotContent');
const CHAPTER_COUNT = 12;
const CHAPTER_DELAY_MS = 1800; // spaced out to stay under free-tier rate limits

let apState = null;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apSetContent(html) {
  autopilotContent.innerHTML = html;
}

function bindApClose() {
  const btn = document.getElementById('apCloseBtn');
  if (btn) btn.addEventListener('click', () => autopilotDialog.close());
}

function apLoadingView(stepTag, title, message) {
  apSetContent(`
    <p class="step-tag">${escapeHtml(stepTag)}</p>
    <h2>${escapeHtml(title)}</h2>
    <div class="ap-loading">
      <div class="ap-spinner"></div>
      <div class="ap-loading__msg">${escapeHtml(message)}</div>
    </div>
  `);
}

function renderApError(title, message, retryFn) {
  apSetContent(`
    <p class="step-tag">Autopilot</p>
    <h2>${escapeHtml(title)}</h2>
    <p class="error">${escapeHtml(message)}</p>
    <div class="autopilot-content__actions">
      <button class="ghost" id="apCloseBtn" type="button">Close</button>
      <button class="run" id="apRetryBtn" type="button">Try again</button>
    </div>
  `);
  bindApClose();
  document.getElementById('apRetryBtn').addEventListener('click', retryFn);
}

document.getElementById('autopilotBtn').addEventListener('click', () => {
  apState = { options: [], chosen: null, research: '', outline: [], chapters: [], fullText: '' };
  autopilotDialog.showModal();
  runMarketResearch();
});

// ---------- Step 1: find 3 real market gaps ----------

function buildMarketOptionsPrompt() {
  return `You are a market researcher for digital products (written guides/ebooks). Use real, current search results to find genuine content gaps — topics where people are actively searching for help right now, but the existing free and paid content online is thin, outdated, or unsatisfying.

Find exactly 3 different topics like this, spread across different areas of life so they're meaningfully different from each other. For each, respond in exactly this block format, with each block separated by a line containing only ---:

NAME: [a clear, specific working title for a guide on this topic]
AUDIENCE: [who searches for this help, specifically]
GAP: [1-2 sentences on what's missing from what's currently out there, grounded in what you found]
PROMISE: [one sentence on the concrete result/outcome this guide would deliver]

No preamble, no numbering, no closing remarks — just the 3 blocks separated by ---.`;
}

function parseOptionsText(text) {
  const blocks = text.split(/-{3,}/).map((b) => b.trim()).filter(Boolean);
  return blocks
    .map((block) => {
      const get = (label) => {
        const m = block.match(new RegExp(`${label}\\s*:\\s*(.+)`, 'i'));
        return m ? m[1].trim() : '';
      };
      return {
        name: get('NAME'),
        audience: get('AUDIENCE'),
        gap: get('GAP'),
        promise: get('PROMISE'),
      };
    })
    .filter((o) => o.name)
    .slice(0, 3);
}

const AP_STEP_TOTAL = 6;

async function runMarketResearch() {
  apLoadingView(`Autopilot · Step 1 of ${AP_STEP_TOTAL}`, 'Scanning for a real opportunity', 'Searching for underserved topics people are actively searching help for…');
  try {
    const text = await callGemini(buildMarketOptionsPrompt(), { useSearch: true });
    const options = parseOptionsText(text);
    if (options.length === 0) throw new Error('Could not read back a clear set of options — try again.');
    apState.options = options;
    renderOptionsView();
  } catch (err) {
    renderApError('Could not research product options', err.message || 'Something went wrong.', runMarketResearch);
  }
}

function renderOptionsView() {
  const cards = apState.options
    .map(
      (opt, i) => `
    <div class="ap-option">
      <span class="ap-option__label">Option ${i + 1}</span>
      <h3>${escapeHtml(opt.name)}</h3>
      <p><strong>For:</strong> ${escapeHtml(opt.audience)}</p>
      <p><strong>The gap:</strong> ${escapeHtml(opt.gap)}</p>
      <p><strong>Promise:</strong> ${escapeHtml(opt.promise)}</p>
      <button class="run" data-choose="${i}" type="button">Build this one</button>
    </div>`
    )
    .join('');

  apSetContent(`
    <p class="step-tag">Autopilot · Step 1 of ${AP_STEP_TOTAL}</p>
    <h2>Three real openings found</h2>
    <p>Pick the one you want turned into a finished, ready-to-sell guide. The other two won't be needed once you choose.</p>
    <div class="ap-options">${cards}</div>
    <div class="autopilot-content__actions">
      <button class="ghost" id="apCloseBtn" type="button">Close</button>
      <button class="ghost" id="apRegenBtn" type="button">Search again</button>
    </div>
  `);
  bindApClose();
  document.getElementById('apRegenBtn').addEventListener('click', runMarketResearch);
  document.querySelectorAll('[data-choose]').forEach((btn) => {
    btn.addEventListener('click', () => {
      apState.chosen = apState.options[Number(btn.dataset.choose)];
      apState.options = []; // the other two are discarded — only the chosen one moves forward
      runTopicResearch();
    });
  });
}

// ---------- Step 2: research the chosen topic ----------

function buildTopicResearchPrompt(opt) {
  return `You're gathering real, current, factual research notes to help write a comprehensive guide.

Topic: "${opt.name}"
Audience: ${opt.audience}
The guide should deliver on this promise: "${opt.promise}"

Use search to find real, current, credible information: context/causes, expert-recommended approaches, common mistakes, and any useful current data points. Organize as dense factual notes under short headings — no fluff, written as source material for someone about to write a guide, not for a reader directly.

Keep it under 600 words. No preamble.`;
}

async function runTopicResearch() {
  apLoadingView(`Autopilot · Step 2 of ${AP_STEP_TOTAL}`, 'Researching your chosen topic', `Gathering real, current information on "${apState.chosen.name}"…`);
  try {
    apState.research = await callGemini(buildTopicResearchPrompt(apState.chosen), { useSearch: true });
    renderResearchContinue();
  } catch (err) {
    renderApError('Could not complete the research step', err.message || 'Something went wrong.', runTopicResearch);
  }
}

function renderResearchContinue() {
  apSetContent(`
    <p class="step-tag">Autopilot · Step 2 of ${AP_STEP_TOTAL}</p>
    <h2>Research done for "${escapeHtml(apState.chosen.name)}"</h2>
    <div class="ap-edit"><textarea readonly spellcheck="false" rows="10">${escapeHtml(apState.research)}</textarea></div>
    <div class="autopilot-content__actions">
      <button class="ghost" id="apCloseBtn" type="button">Close</button>
      <button class="run" id="apContinueBtn" type="button">Continue</button>
    </div>
  `);
  bindApClose();
  document.getElementById('apContinueBtn').addEventListener('click', runOutline);
}

// ---------- Step 3: plan the chapters ----------

function buildOutlinePrompt(opt, research) {
  return `Create a chapter outline for a comprehensive, practical guide.

Title: "${opt.name}"
Audience: ${opt.audience}
Promise: "${opt.promise}"

Research notes to ground it in:
"""
${research}
"""

Respond with exactly ${CHAPTER_COUNT} lines, one per chapter, in this exact format and nothing else:
1. Chapter title — one-sentence goal for the chapter
2. Chapter title — one-sentence goal for the chapter
...continuing through ${CHAPTER_COUNT}.

Order chapters logically: understanding/context first, then practical steps, then troubleshooting or staying on track, then a closing chapter. No preamble, no other text.`;
}

function parseOutline(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const result = [];
  for (const line of lines) {
    const numMatch = line.match(/^\d+[.)]\s*(.+)$/);
    if (!numMatch) continue;
    const rest = numMatch[1];
    const sep = rest.match(/^(.*?)\s*[—–-]\s*(.+)$/);
    if (sep) {
      result.push({ title: sep[1].trim(), goal: sep[2].trim() });
    } else {
      result.push({ title: rest.trim(), goal: '' });
    }
  }
  return result;
}

async function runOutline() {
  apLoadingView(`Autopilot · Step 3 of ${AP_STEP_TOTAL}`, 'Structuring the guide', 'Planning out the chapters…');
  try {
    const text = await callGemini(buildOutlinePrompt(apState.chosen, apState.research));
    const outline = parseOutline(text);
    if (outline.length < 6) throw new Error('Could not read back a clear chapter outline — try again.');
    apState.outline = outline;
    renderOutlineContinue();
  } catch (err) {
    renderApError('Could not plan the guide structure', err.message || 'Something went wrong.', runOutline);
  }
}

function renderOutlineContinue() {
  const items = apState.outline.map((ch, i) => `<li><span class="dot"></span>Chapter ${i + 1}: ${escapeHtml(ch.title)}</li>`).join('');
  apSetContent(`
    <p class="step-tag">Autopilot · Step 3 of ${AP_STEP_TOTAL}</p>
    <h2>${apState.outline.length}-chapter plan is ready</h2>
    <p>This is the chapter list before any writing happens. Continue to have each chapter written in full.</p>
    <ul class="ap-progresslist">${items}</ul>
    <div class="autopilot-content__actions">
      <button class="ghost" id="apCloseBtn" type="button">Close</button>
      <button class="run" id="apContinueBtn" type="button">Continue</button>
    </div>
  `);
  bindApClose();
  document.getElementById('apContinueBtn').addEventListener('click', runChapters);
}

// ---------- Step 4: write every chapter in full ----------

function buildChapterPrompt(opt, chapter, research) {
  return `Write one chapter of a comprehensive, practical guide.

Guide title: "${opt.name}"
Audience: ${opt.audience}
Chapter: "${chapter.title}"
Goal of this chapter: ${chapter.goal}

Research notes to draw on where relevant:
"""
${research}
"""

Write 550-750 words of the chapter body only — direct, practical, second-person voice, no fluff or filler, no restating the chapter title, no preamble or meta-commentary about the guide itself. Use occasional "- " bullet lists for concrete steps where that helps. Start directly with the first sentence of the chapter content.`;
}

function renderProgressView(current) {
  const items = apState.outline
    .map((ch, i) => {
      const state = i < current ? 'done' : i === current ? 'active' : '';
      const mark = i < current ? '✓' : i === current ? '…' : '';
      return `<li class="${state}"><span class="dot"></span>${escapeHtml(ch.title)}${mark ? ` <span>${mark}</span>` : ''}</li>`;
    })
    .join('');
  apSetContent(`
    <p class="step-tag">Autopilot · Step 4 of ${AP_STEP_TOTAL}</p>
    <h2>Writing "${escapeHtml(apState.chosen.name)}"</h2>
    <p>Chapter ${Math.min(current + 1, apState.outline.length)} of ${apState.outline.length}. This takes a few minutes — the app is pacing itself to stay within the free API's rate limit.</p>
    <ul class="ap-progresslist">${items}</ul>
  `);
}

async function runChapters() {
  apState.chapters = [];
  for (let i = 0; i < apState.outline.length; i++) {
    renderProgressView(i);
    const chapter = apState.outline[i];
    try {
      const body = await callGemini(buildChapterPrompt(apState.chosen, chapter, apState.research), { maxOutputTokens: 2048 });
      apState.chapters.push({ title: chapter.title, body });
    } catch (err) {
      renderApError(`Could not write chapter ${i + 1} ("${chapter.title}")`, err.message || 'Something went wrong.', runChapters);
      return;
    }
    if (i < apState.outline.length - 1) await wait(CHAPTER_DELAY_MS);
  }
  assembleFullText();
  renderChaptersContinue();
}

function assembleFullText() {
  const opt = apState.chosen;
  const chaptersText = apState.chapters
    .map((ch, i) => `## Chapter ${i + 1}: ${ch.title}\n\n${ch.body}`)
    .join('\n\n');
  apState.fullText = `# ${opt.name}\n\n${opt.promise}\n\n${chaptersText}`;
}

function renderChaptersContinue() {
  const wordCount = apState.fullText.trim().split(/\s+/).length;
  const approxPages = Math.max(1, Math.round(wordCount / 380));
  apSetContent(`
    <p class="step-tag">Autopilot · Step 4 of ${AP_STEP_TOTAL}</p>
    <h2>All ${apState.chapters.length} chapters written</h2>
    <p>The full guide is done — roughly ${approxPages} pages. Continue to review and edit it before it's finalized.</p>
    <div class="autopilot-content__actions">
      <button class="ghost" id="apCloseBtn" type="button">Close</button>
      <button class="run" id="apContinueBtn" type="button">Continue</button>
    </div>
  `);
  bindApClose();
  document.getElementById('apContinueBtn').addEventListener('click', renderEditView);
}

// ---------- Step 5: human review/edit of the finished guide ----------

function renderEditView() {
  const wordCount = apState.fullText.trim().split(/\s+/).length;
  const approxPages = Math.max(1, Math.round(wordCount / 380));
  apSetContent(`
    <p class="step-tag">Autopilot · Step 5 of ${AP_STEP_TOTAL}</p>
    <h2>Review the finished guide</h2>
    <p>This is the actual guide your buyer will receive — roughly ${approxPages} pages. Edit anything you want below, then continue. The download button comes after this.</p>
    <div class="ap-edit">
      <textarea id="apEditText" spellcheck="false">${escapeHtml(apState.fullText)}</textarea>
    </div>
    <div class="autopilot-content__actions">
      <button class="ghost" id="apCloseBtn" type="button">Close</button>
      <button class="run" id="apContinueBtn" type="button">Continue</button>
    </div>
  `);
  bindApClose();
  document.getElementById('apContinueBtn').addEventListener('click', () => {
    apState.fullText = document.getElementById('apEditText').value;
    renderDownloadView();
  });
}

// ---------- Step 6: download — the finished product only, no planning trail ----------

function renderDownloadView() {
  const wordCount = apState.fullText.trim().split(/\s+/).length;
  const approxPages = Math.max(1, Math.round(wordCount / 380));
  apSetContent(`
    <p class="step-tag">Autopilot · Step 6 of ${AP_STEP_TOTAL}</p>
    <h2>Ready to download</h2>
    <p>"${escapeHtml(apState.chosen.name)}" is finished — roughly ${approxPages} pages. The PDF contains only this finished guide, nothing about how it was planned or built.</p>
    <div class="autopilot-content__actions">
      <button class="ghost" id="apCloseBtn" type="button">Close</button>
      <button class="run" id="apDownloadBtn" type="button">Download PDF</button>
    </div>
  `);
  bindApClose();
  document.getElementById('apDownloadBtn').addEventListener('click', finalizeProduct);
}

// ---------- The final PDF is the product itself — no planning trail ----------

function renderBookFormatted(rawText) {
  const lines = rawText.split('\n');
  let html = '';
  let inList = false;
  let sawChapter = false;
  const closeList = () => {
    if (inList) { html += '</ul>'; inList = false; }
  };

  for (let line of lines) {
    line = line.trim();
    if (!line) { closeList(); continue; }
    if (/^#\s+/.test(line)) continue; // the title line is rendered separately on the title page

    const chapterHeading = line.match(/^##\s+(.*)/);
    const bullet = line.match(/^[-*]\s+(.*)/);
    const numbered = line.match(/^\d+[.)]\s+(.*)/);

    if (chapterHeading) {
      closeList();
      const cls = sawChapter ? 'book-chapter' : 'book-chapter book-chapter--first';
      sawChapter = true;
      html += `<h2 class="${cls}">${escapeHtml(chapterHeading[1])}</h2>`;
    } else if (bullet || numbered) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${escapeHtml((bullet || numbered)[1])}</li>`;
    } else {
      closeList();
      html += `<p>${escapeHtml(line)}</p>`;
    }
  }
  closeList();
  return html;
}

function finalizeProduct() {
  const opt = apState.chosen;
  const bodyHtml = renderBookFormatted(apState.fullText);
  const win = window.open('', '_blank');
  if (!win) {
    showToast('Your browser blocked the print window — allow pop-ups for this page and try again.');
    return;
  }
  win.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${escapeHtml(opt.name)}</title>
<style>
  body{
    font-family: Georgia, 'Source Serif 4', serif;
    max-width:640px;
    margin:0 auto;
    padding:0 28px;
    color:#1c2430;
    line-height:1.7;
    font-size:15px;
  }
  .titlepage{
    min-height:90vh;
    display:flex;
    flex-direction:column;
    justify-content:center;
    text-align:center;
    page-break-after:always;
  }
  .titlepage h1{ font-size:32px; margin-bottom:14px; }
  .titlepage p{ color:#5c6472; font-size:15px; }
  h2.book-chapter{
    font-size:19px;
    margin-top:0;
    margin-bottom:14px;
    padding-top:40px;
    border-top:1px solid #ccc;
    page-break-before:always;
  }
  h2.book-chapter--first{ page-break-before:auto; border-top:none; padding-top:0; }
  ul{ padding-left:20px; margin:8px 0; }
  li{ margin-bottom:6px; }
  p{ margin:10px 0; }
  @media print{ body{ margin:0; padding:24px; } }
</style>
</head>
<body>
  <div class="titlepage">
    <h1>${escapeHtml(opt.name)}</h1>
    <p>${escapeHtml(opt.promise)}</p>
  </div>
  ${bodyHtml}
</body>
</html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);

  apSetContent(`
    <p class="step-tag">Autopilot · Done</p>
    <h2>Your product is ready</h2>
    <p>A print window opened with the finished guide — choose "Save as PDF" there. It contains only the guide itself, nothing about how it was planned or built.</p>
    <div class="autopilot-content__actions">
      <button class="ghost" id="apCloseBtn" type="button">Close</button>
      <button class="run" id="apReprintBtn" type="button">Open PDF again</button>
    </div>
  `);
  bindApClose();
  document.getElementById('apReprintBtn').addEventListener('click', finalizeProduct);
}
