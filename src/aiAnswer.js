const {
  getFaqItems,
  getContent,
  getSlots,
  getReviews,
} = require('./db');
const { TUTOR_SYSTEM_PROMPT_COMPACT } = require('./tutorSystemPrompt');
const {
  tryScriptedReply,
  normalizeForCache,
} = require('./intentScripts');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_TOKENS = 280;
const TEMPERATURE = 0.3;

/** Кэш ответов OpenAI: одинаковый текст → без повторного списания токенов */
const MAX_CACHE_ENTRIES = 150;
/** @type {Map<string, string>} */
const responseCache = new Map();

function clip(s, max) {
  const t = (s || '').trim();
  if (t.length <= max) return t;
  return t.slice(0, max).trim() + '…';
}

/**
 * Компактный блок фактов для API (экономия input-токенов).
 */
function buildFactsBlockCompact() {
  const parts = [];
  parts.push('ФАКТЫ (только они; не выдумывай):');
  parts.push(`Цены: ${clip(getContent('prices'), 420)}`);
  parts.push(`Расписание: ${clip(getContent('schedule'), 260)}`);
  parts.push(`Подход: ${clip(getContent('methodology'), 420)}`);
  parts.push(`Формат: ${clip(getContent('lesson_format'), 280)}`);

  const slots = getSlots();
  if (slots.length) {
    parts.push(
      `Слоты: ${slots.map((s) => s.label).join('; ')}`.slice(0, 450)
    );
  }

  const faq = getFaqItems();
  if (faq.length) {
    const block = faq
      .map((f) => `${f.question}: ${clip(f.answer, 140)}`)
      .join('\n');
    parts.push(`FAQ:\n${clip(block, 1100)}`);
  }

  const reviews = getReviews().slice(0, 3);
  if (reviews.length) {
    parts.push(
      `Отзывы: ${reviews.map((r) => clip(`${r.author}: ${r.text}`, 130)).join(' | ')}`
    );
  }

  parts.push('Меню: запись/пробное — кнопки; отмена/перенос — отдельная кнопка; FAQ и отзывы — кнопки.');

  return clip(parts.join('\n\n'), 3600);
}

function buildSystemContentCompact() {
  return `${TUTOR_SYSTEM_PROMPT_COMPACT}\n\n${buildFactsBlockCompact()}`;
}

/**
 * Решает, нужен ли вызов OpenAI. Иначе — готовый текст (скрипт, кэш или fallback без ключа).
 * @param {string} userMessage
 * @returns {{ needsOpenAI: boolean, text: string }}
 */
function planAssistantReply(userMessage) {
  const q = (userMessage || '').trim();
  if (!q) {
    return {
      needsOpenAI: false,
      text: 'Напиши вопрос парой слов или выбери кнопку в меню.',
    };
  }

  const scripted = tryScriptedReply(q);
  if (scripted) {
    return { needsOpenAI: false, text: scripted };
  }

  const key = normalizeForCache(q);
  if (responseCache.has(key)) {
    return { needsOpenAI: false, text: responseCache.get(key) };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { needsOpenAI: false, text: fallbackAnswer(q) };
  }

  return { needsOpenAI: true, text: '' };
}

/**
 * Один запрос к OpenAI (после planAssistantReply с needsOpenAI: true).
 * @param {string} userMessage
 * @param {{ apiKey?: string, model?: string }} [opts]
 * @returns {Promise<string>}
 */
async function fetchOpenAIResponse(userMessage, opts = {}) {
  const q = (userMessage || '').trim();
  const apiKey =
    opts.apiKey || opts.openaiKey || process.env.OPENAI_API_KEY;
  const model = opts.model || process.env.OPENAI_MODEL || DEFAULT_MODEL;

  if (!apiKey) {
    return fallbackAnswer(q);
  }

  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildSystemContentCompact() },
          { role: 'user', content: clip(q, 1200) },
        ],
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (text) {
      const key = normalizeForCache(q);
      responseCache.set(key, text);
      if (responseCache.size > MAX_CACHE_ENTRIES) {
        const first = responseCache.keys().next().value;
        responseCache.delete(first);
      }
      return text;
    }
  } catch (e) {
    console.error('OpenAI:', e.message);
  }

  return fallbackAnswer(q);
}

/**
 * Полный цикл (для обратной совместимости): скрипты → кэш → fallback → API.
 * @param {string} userMessage
 * @param {{ apiKey?: string, model?: string }} [opts]
 * @returns {Promise<{ text: string, usedApi: boolean }>}
 */
async function answerWithTutorAssistant(userMessage, opts = {}) {
  const plan = planAssistantReply(userMessage);
  if (!plan.needsOpenAI) {
    return { text: plan.text, usedApi: false };
  }
  const text = await fetchOpenAIResponse(userMessage, {
    apiKey: opts.apiKey || opts.openaiKey,
    model: opts.model,
  });
  return { text, usedApi: true };
}

/**
 * @param {string} question
 * @param {{ openaiKey?: string, model?: string }} [opts]
 * @returns {Promise<string>}
 */
async function answerFreeformQuestion(question, opts = {}) {
  const { text } = await answerWithTutorAssistant(question, {
    apiKey: opts.openaiKey,
    model: opts.model,
  });
  return text;
}

/**
 * @param {string} q
 */
function fallbackAnswer(q) {
  const FAQ_ITEMS = getFaqItems();
  const METHODOLOGY_TEXT = getContent('methodology');
  const lower = q.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);

  let best = null;
  let bestScore = 0;
  for (const item of FAQ_ITEMS) {
    const hay = (item.question + ' ' + item.answer).toLowerCase();
    let score = 0;
    for (const w of words) {
      if (w.length < 3) continue;
      if (hay.includes(w)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  if (best && bestScore >= 1) {
    return `${best.answer}\n\nПодробнее — в FAQ в меню или запись на пробное.`;
  }

  if (/метод|как проход|подход|урок/i.test(q)) {
    return `${METHODOLOGY_TEXT}\n\nЦены и время — в FAQ и в разделе записи.`;
  }

  return (
    'Могу помочь с записью, пробным, отзывами и форматом — загляни в меню ниже.\n\n' +
    `Кратко: ${clip(METHODOLOGY_TEXT, 220)}`
  );
}

/**
 * @param {import('telegraf').Context} ctx
 */
async function sendTyping(ctx) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  try {
    await ctx.telegram.sendChatAction(chatId, 'typing');
  } catch (e) {
    console.error('sendChatAction:', e.message);
  }
}

module.exports = {
  answerWithTutorAssistant,
  answerFreeformQuestion,
  planAssistantReply,
  fetchOpenAIResponse,
  buildFactsBlockCompact,
  fallbackAnswer,
  sendTyping,
  tryScriptedReply,
};
