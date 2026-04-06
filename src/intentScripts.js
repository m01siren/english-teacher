/**
 * Ответы без OpenAI: эвристики по ключевым словам и коротким фразам.
 * Цель — не тратить токены на типовые и простые сообщения.
 */

const db = require('./db');

const ACK = /^(спасибо|благодарю|окей|ок|yes|да|угу|понятно|понял|поняла|хорошо|ладно|не надо|не нужно)\s*[!?.…]*$/i;
const GREET = /^(привет|здравствуй|добрый\s*(день|вечер)|hi|hello)\s*[!?.…]*$/i;

/** Явный off-topic — отказ без API */
const OFF_TOPIC =
  /переведи|перевод\s|проверь\s*текст|грамматик|домашн|сочинени|эссе|правильно\s*ли|как\s*сказать\s*по-англий|репетитор\s*в\s*москве|лучш(ий|ая)\s*(курс|школ|приложен)|chatgpt|нейросет/i;

/** Сильные сигналы к разделам бота — короткие шаблоны */
const TRIAL = /пробн|попробов|хочу\s*попроб|trial|test\s*lesson/i;
const BOOK = /запис(ать|аться|ка)|хочу\s*урок|назначить\s*урок|есть\s*мест/i;
const CANCEL = /отмен(ить|а)|перенес(ти|ти)|не\s*могу\s*прийти|не\s*приду/i;
const REVIEWS = /отзыв|рекомендац|кто\s*учил|отклик/i;
const PRICE = /сколько\s*сто|цен(а|ы)|оплат|руб|₽|стоимост/i;
const SCHEDULE = /расписан|когда\s*(можно|есть)|во\s*сколько|выходн/i;
const HOW = /как\s*(у\s*вас|проход|устроен)|формат|подход|метод/i;

function trimAnswer(s, max) {
  const t = (s || '').trim();
  if (t.length <= max) return t;
  return t.slice(0, max).trim() + '…';
}

/**
 * Нормализация для кэша
 * @param {string} q
 */
function normalizeForCache(q) {
  return q
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

/**
 * Синхронный ответ без API. Возвращает null → вызывать OpenAI или fallback.
 * @param {string} raw
 * @returns {string|null}
 */
function tryScriptedReply(raw) {
  const q = (raw || '').trim();
  if (!q) {
    return 'Напиши вопрос парой слов или выбери кнопку в меню.';
  }

  if (q.length <= 2 && !/[a-zа-яё0-9]/i.test(q)) {
    return 'Не разобрала — напиши чуть подробнее или открой меню кнопкой ниже.';
  }

  if (GREET.test(q) && q.length < 40) {
    return 'Привет! Запись, пробный, отзывы и вопросы — через кнопки в меню. Можешь и текстом написать, что нужно.';
  }

  if (ACK.test(q)) {
    return 'Всегда пожалуйста! Если ещё что-то — пиши или жми кнопку в меню.';
  }

  if (OFF_TOPIC.test(q)) {
    return (
      'Такие вещи тут не разбираю — я только про занятия у этого репетитора: запись, пробный, отзывы, формат. ' +
      'Выбери пункт в меню или спроси про уроки своими словами.'
    );
  }

  if (CANCEL.test(q) && q.length < 200) {
    return 'Отмена и перенос — в меню кнопка «Отмена / перенос урока». Там выберешь запись.';
  }

  if (REVIEWS.test(q) && q.length < 200) {
    return 'Отзывы — кнопка «Отзывы» в меню. Можешь листать стрелками.';
  }

  if (TRIAL.test(q) && q.length < 220) {
    return 'Пробный — в меню кнопка «Пробное занятие», дальше выберешь время. Если окно не подошло — напиши репетитору после записи.';
  }

  if (BOOK.test(q) && !PRICE.test(q) && q.length < 220) {
    return 'Запись — кнопки «Запись на урок» или «Пробное занятие», потом слот и контакты. Так надёжнее, чем в чате.';
  }

  const faqHit = matchFaq(q);
  if (faqHit) {
    return trimAnswer(faqHit.answer, 900) + '\n\nПодробнее — в FAQ в меню.';
  }

  if (PRICE.test(q) && q.length < 300) {
    const p = db.getContent('prices');
    if (p) return trimAnswer(p, 700) + '\n\nТочные условия — в разделе FAQ или при записи.';
  }

  if (SCHEDULE.test(q) && q.length < 300) {
    const s = db.getContent('schedule');
    if (s) return trimAnswer(s, 500) + '\n\nКонкретные слоты — при записи через меню.';
  }

  if (HOW.test(q) && q.length < 350) {
    const m = db.getContent('methodology');
    const f = db.getContent('lesson_format');
    const block = [m, f].filter(Boolean).join('\n\n');
    if (block) return trimAnswer(block, 1000) + '\n\nЦены — в FAQ или кнопка записи.';
  }

  return null;
}

/**
 * Подбор FAQ по пересечению слов (без API).
 * @param {string} q
 */
function matchFaq(q) {
  const items = db.getFaqItems();
  const lower = q.toLowerCase();
  const words = lower.split(/\s+/).filter((w) => w.length >= 4);

  let best = null;
  let bestScore = 0;

  for (const item of items) {
    const hay = (item.question + ' ' + item.answer).toLowerCase();
    let score = 0;
    for (const w of words) {
      if (hay.includes(w)) score += 2;
    }
    for (const w of lower.split(/\s+/)) {
      if (w.length >= 5 && item.question.toLowerCase().includes(w)) score += 3;
    }
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  if (best && bestScore >= 3) return best;
  return null;
}

module.exports = {
  tryScriptedReply,
  normalizeForCache,
};
