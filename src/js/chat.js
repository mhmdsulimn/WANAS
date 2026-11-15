/**
 * chat.js
 * Controls the Wanas AI Assistant page: reads synced vitals from localStorage,
 * tracks internet availability for Earth Control reports, renders Markdown messages
 * with a live typewriter animation, and talks to /api/chat.
 */

import { TEXT } from './data.js';
import { playClickSound } from './audio.js';
import { startStarfield } from './canvas.js';

const chatState = {
  lang: 'ar',
  history: [],
  vitals: null,
  reportItems: null,
  sending: false,
  activeTimer: null,
  activeFinish: null,
};

const el = (id) => document.getElementById(id);

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInlineMarkdown(escapedText) {
  const inlineCodes = [];
  let text = escapedText.replace(/`([^`\n]+)`/g, (_m, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${code}</code>`);
    return `@@INLINE_CODE_${idx}@@`;
  });

  // Safe links (http/https only)
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // Bold + italic, bold, and italic
  text = text.replace(/\*\*\*([^*\n]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
  text = text.replace(/(^|[\s(>])\*([^*\n]+?)\*(?=$|[\s).,!?:;؟،<])/g, '$1<em>$2</em>');

  return text.replace(/@@INLINE_CODE_(\d+)@@/g, (_m, idx) => inlineCodes[Number(idx)] || '');
}

function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableSeparator(line) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

function markdownToHtml(markdown) {
  if (!markdown) return '';

  const codeBlocks = [];
  const normalized = markdown.replace(/\r\n?/g, '\n').replace(
    /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g,
    (_m, _lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
      return `\n@@CODE_BLOCK_${idx}@@\n`;
    }
  );

  const lines = normalized.split('\n');
  const htmlParts = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    const codeMatch = trimmed.match(/^@@CODE_BLOCK_(\d+)@@$/);
    if (codeMatch) {
      htmlParts.push(codeBlocks[Number(codeMatch[1])] || '');
      i += 1;
      continue;
    }

    if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
      htmlParts.push('<hr class="md-hr" />');
      i += 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const tag = headingMatch[1].length <= 2 ? 'h3' : 'h4';
      htmlParts.push(`<${tag}>${renderInlineMarkdown(escapeHtml(headingMatch[2]))}</${tag}>`);
      i += 1;
      continue;
    }

    // Markdown table
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = parseTableRow(trimmed);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim() !== '') {
        rows.push(parseTableRow(lines[i]));
        i += 1;
      }
      const ths = headers.map((h) => `<th>${renderInlineMarkdown(escapeHtml(h))}</th>`).join('');
      const trs = rows
        .map(
          (r) =>
            `<tr>${headers
              .map((_h, col) => `<td>${renderInlineMarkdown(escapeHtml(r[col] || ''))}</td>`)
              .join('')}</tr>`
        )
        .join('');
      htmlParts.push(`<div class="md-table-wrap"><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`);
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(trimmed)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(renderInlineMarkdown(escapeHtml(lines[i].trim().replace(/^>\s?/, ''))));
        i += 1;
      }
      htmlParts.push(`<blockquote><p>${quoteLines.join('<br />')}</p></blockquote>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*•]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        const content = lines[i].replace(/^\s*[-*•]\s+/, '');
        items.push(`<li>${renderInlineMarkdown(escapeHtml(content))}</li>`);
        i += 1;
      }
      htmlParts.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        const content = lines[i].replace(/^\s*\d+[.)]\s+/, '');
        items.push(`<li>${renderInlineMarkdown(escapeHtml(content))}</li>`);
        i += 1;
      }
      htmlParts.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // Regular paragraph
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^@@CODE_BLOCK_\d+@@$/.test(lines[i].trim()) &&
      !/^#{1,6}\s+/.test(lines[i].trim()) &&
      !/^(\*{3,}|-{3,}|_{3,})$/.test(lines[i].trim()) &&
      !/^>\s?/.test(lines[i].trim()) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      paraLines.push(renderInlineMarkdown(escapeHtml(lines[i])));
      i += 1;
    }
    htmlParts.push(`<p>${paraLines.join('<br />')}</p>`);
  }

  return htmlParts.join('');
}

function placeTypingCursor(bubble) {
  const cursor = document.createElement('span');
  cursor.className = 'typing-cursor';
  cursor.setAttribute('aria-hidden', 'true');

  const last = bubble.lastElementChild;
  if (last && /^(P|H3|H4|BLOCKQUOTE)$/.test(last.tagName)) {
    last.appendChild(cursor);
  } else if (last && (last.tagName === 'UL' || last.tagName === 'OL') && last.lastElementChild) {
    last.lastElementChild.appendChild(cursor);
  } else {
    bubble.appendChild(cursor);
  }
}

function finishActiveTypewriter() {
  if (chatState.activeTimer) {
    clearInterval(chatState.activeTimer);
    chatState.activeTimer = null;
  }
  if (chatState.activeFinish) {
    const fn = chatState.activeFinish;
    chatState.activeFinish = null;
    fn();
  }
}

function typeMarkdownMessage(bubble, fullText) {
  finishActiveTypewriter();

  const container = el('chat-messages');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reducedMotion || fullText.length <= 2) {
    bubble.innerHTML = markdownToHtml(fullText);
    container.scrollTop = container.scrollHeight;
    return;
  }

  let index = 0;
  const step = Math.max(1, Math.min(4, Math.ceil(fullText.length / 150)));

  const finalize = () => {
    bubble.innerHTML = markdownToHtml(fullText);
    container.scrollTop = container.scrollHeight;
  };

  chatState.activeFinish = finalize;

  const renderStep = () => {
    index = Math.min(fullText.length, index + step);

    // Skip over markdown heading/list markers at line starts so raw # or * don't flash
    while (index < fullText.length) {
      const slice = fullText.slice(0, index);
      const lastNewline = slice.lastIndexOf('\n');
      const currentLine = slice.slice(lastNewline + 1);
      if (/^(#{1,6}|[-*•]|\d+[.)])$/.test(currentLine) && fullText[index] === ' ') {
        index += 1;
      } else if (fullText.slice(index - 2, index) === '**' && fullText[index] && fullText[index] !== '*') {
        index += 1;
      } else {
        break;
      }
    }

    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 90;
    bubble.innerHTML = markdownToHtml(fullText.slice(0, index));

    if (index >= fullText.length) {
      clearInterval(chatState.activeTimer);
      chatState.activeTimer = null;
      chatState.activeFinish = null;
    } else {
      placeTypingCursor(bubble);
    }

    if (nearBottom) {
      container.scrollTop = container.scrollHeight;
    }
  };

  renderStep();
  if (index < fullText.length) {
    chatState.activeTimer = setInterval(renderStep, 18);
  }
}

function loadVitalsFromStorage() {
  try {
    const saved = JSON.parse(localStorage.getItem('wanas_vitals') || 'null');
    if (!saved) return;
    chatState.reportItems = saved.items || null;

    if (saved.fullValues) {
      chatState.vitals = saved.fullValues;
    } else if (saved.values && Object.keys(saved.values).length > 0) {
      const raw = saved.values;
      chatState.vitals = {
        bpm: raw['input-bpm'],
        spo2: raw['input-spo2'],
        resp: raw['input-resp'],
        temp: raw['input-temp'],
        bpSys: raw['input-bp-sys'],
        bpDia: raw['input-bp-dia'],
        accel: raw['input-accel'],
        caffeine: raw['input-caffeine'],
        cortisol: raw['input-cortisol'],
        hydration: raw['input-hydration'],
        elec: raw['input-elec'],
        co2: raw['input-co2'],
      };
    }
  } catch {
    chatState.vitals = null;
    chatState.reportItems = null;
  }
}

function renderVitalsStrip() {
  const strip = el('chat-vitals-strip');
  strip.innerHTML = '';

  if (chatState.reportItems && chatState.reportItems.length > 0) {
    chatState.reportItems.forEach((item) => {
      const chip = document.createElement('span');
      chip.className = `vital-chip ${item.level}`;
      const dot = document.createElement('span');
      dot.className = `dot ${item.level}`;
      const label = document.createElement('span');
      label.textContent = `${item.name}: ${item.msg}`;
      chip.appendChild(dot);
      chip.appendChild(label);
      strip.appendChild(chip);
    });
    return;
  }

  if (chatState.vitals) {
    const entries = [
      ['النبض', chatState.vitals.bpm, 'BPM'],
      ['الأكسجين', chatState.vitals.spo2, '%'],
      ['التنفس', chatState.vitals.resp, 'RPM'],
      ['الحرارة', chatState.vitals.temp, '°C'],
      [
        'الضغط',
        chatState.vitals.bpSys && chatState.vitals.bpDia
          ? `${chatState.vitals.bpSys}/${chatState.vitals.bpDia}`
          : undefined,
        '',
      ],
      ['التسارع', chatState.vitals.accel, 'g'],
      ['الكافيين', chatState.vitals.caffeine, 'mg'],
      ['الكورتيزول', chatState.vitals.cortisol, 'μg/dL'],
      ['المياه', chatState.vitals.hydration, 'لتر'],
      ['الأملاح', chatState.vitals.elec, 'mmol/L'],
      ['CO2', chatState.vitals.co2, '%'],
    ];

    let count = 0;
    entries.forEach(([label, val, unit]) => {
      if (val === undefined) return;
      count += 1;
      const chip = document.createElement('span');
      chip.className = 'vital-chip';
      chip.textContent = `${label}: ${val}${unit ? ` ${unit}` : ''}`;
      strip.appendChild(chip);
    });

    if (count > 0) return;
  }

  const empty = document.createElement('span');
  empty.className = 'report-text';
  empty.textContent = TEXT.ar.chat.noVitals;
  strip.appendChild(empty);
}

function updateEarthLinkUI() {
  const badge = el('earth-link-badge');
  const text = el('earth-link-text');
  const dict = TEXT.ar.chat;
  const online = navigator.onLine;

  badge.classList.toggle('offline', !online);
  badge.querySelector('.dot').className = `dot ${online ? 'green' : 'yellow'}`;
  text.textContent = online ? dict.online : dict.offline;
}

function appendMessage(role, text, options = {}) {
  const { isError = false, useMarkdown = false, typewriter = false } = options;
  const container = el('chat-messages');
  const row = document.createElement('div');
  row.className = `msg-row ${role}${isError ? ' error' : ''}`;

  const sender = document.createElement('span');
  sender.className = 'msg-sender';
  sender.textContent = role === 'user' ? 'رائد الفضاء' : 'ونس (AI)';

  const bubble = document.createElement('div');
  bubble.className = `msg-bubble${useMarkdown ? ' md-content' : ''}`;

  row.appendChild(sender);
  row.appendChild(bubble);
  container.appendChild(row);

  if (typewriter && useMarkdown) {
    typeMarkdownMessage(bubble, text);
  } else if (useMarkdown) {
    bubble.innerHTML = markdownToHtml(text);
  } else {
    bubble.textContent = text;
  }

  container.scrollTop = container.scrollHeight;
  return row;
}

async function sendMessage(text, isEarthReport = false) {
  const trimmed = text.trim();
  if (!trimmed || chatState.sending) return;

  finishActiveTypewriter();
  loadVitalsFromStorage();
  renderVitalsStrip();

  chatState.sending = true;
  el('chat-send-btn').disabled = true;
  el('btn-send-earth-report').disabled = true;

  appendMessage('user', trimmed);
  const thinkingRow = appendMessage('model', TEXT.ar.chat.thinking);
  const thinkingBubble = thinkingRow.querySelector('.msg-bubble');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: trimmed,
        history: chatState.history,
        vitals: chatState.vitals,
        reportItems: chatState.reportItems,
        lang: chatState.lang,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'تعذر الاتصال بمساعد ونس');
    }

    let replyText = data.reply || '';
    if (isEarthReport) {
      const note = navigator.onLine ? TEXT.ar.chat.reportSentNote : TEXT.ar.chat.reportQueuedNote;
      replyText = `${replyText}\n\n---\n**حالة الإرسال للقاعدة:** ${note}`;
    }

    thinkingBubble.classList.add('md-content');
    typeMarkdownMessage(thinkingBubble, replyText);

    chatState.history.push({ role: 'user', text: trimmed });
    chatState.history.push({ role: 'model', text: replyText });
  } catch (err) {
    thinkingRow.classList.add('error');
    thinkingBubble.textContent = err instanceof Error ? err.message : 'خطأ في الاتصال';
  } finally {
    chatState.sending = false;
    el('chat-send-btn').disabled = false;
    el('btn-send-earth-report').disabled = false;
    el('chat-messages').scrollTop = el('chat-messages').scrollHeight;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  startStarfield(el('space-canvas'));
  loadVitalsFromStorage();

  el('menu-toggle').addEventListener('click', () => {
    el('mobile-menu').classList.toggle('hidden');
  });

  window.addEventListener('online', updateEarthLinkUI);
  window.addEventListener('offline', updateEarthLinkUI);

  document.querySelectorAll('[data-prompt-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      playClickSound();
      const key = btn.getAttribute('data-prompt-key');
      sendMessage(TEXT.ar.chat[key]);
    });
  });

  el('btn-send-earth-report').addEventListener('click', () => {
    playClickSound();
    sendMessage(TEXT.ar.chat.reportPrompt, true);
  });

  el('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    playClickSound();
    const input = el('chat-input');
    const msg = input.value;
    input.value = '';
    sendMessage(msg);
  });

  updateEarthLinkUI();
  renderVitalsStrip();
  appendMessage('model', TEXT.ar.chat.welcome, { useMarkdown: true, typewriter: true });
});
