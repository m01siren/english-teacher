/**
 * Ответы без OpenAI: эвристики по ключевым словам и коротким фразам.
 * English Flow — онлайн-школа.
 */

const db = require('./db');

const ACK = /^(спасибо|благодарю|окей|ок|yes|да|угу|понятно|понял|поняла|хорошо|ладно|не надо|не нужно)\s*[!?.…]*$/i;
const GREET = /^(привет|здравствуй|добрый\s*(день|вечер)|hi|hello)\s*[!?.…]*$/i;

/** Явный off-topic — отказ без API */
const OFF_TOPIC =
  /переведи|перевод\s|проверь\s*текст|грамматик|домашн|сочинени|эссе|правильно\s*ли|как\s*сказать\s*по-англий|лучш(ий|ая)\s*(курс|школ|приложен)|chatgpt|нейросет/i;

/** Сильные сигналы к разделам бота */
const TRIAL = /пробн|попробов|хочу\s*попроб|trial|test\s*lesson/i;
const BOOK =
  /запис(ать|аться|ка)|заявк|хочу\s*урок|назначить\s*урок|есть\s*мест|начать\s*уч/i;
const CANCEL = /отмен(ить|а)|перенес(ти|ти)|не\s*могу\s*прийти|не\s*приду/i;
const REVIEWS = /отзыв|рекомендац|кто\s*учил|отклик/i;
const PRICE = /сколько\s*сто|цен(а|ы)|оплат|руб|₽|стоимост|тариф/i;
const SCHEDULE = /расписан|когда\s*(можно|есть)|во\s*сколько|выходн/i;
const HOW =
  /как\s*(у\s*вас|проход|устроен)|формат|подход|метод|english\s*flow|курс|ielts|бизнес|мини-групп|индивидуал|подрост|родител/i;
const POLICY = /8\s*час|перенос|отмен(а|ить).*урок/i;

function trimAnswer(s, max) {
  const t = (s || '').trim();
  if (t.length <= max) return t;
  return t.slice(0, max).trim() + '…';
}

/**
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
 * @param {string} raw
 * @returns {string|null}
 */
function tryScriptedReply(raw) {
  const q = (raw || '').trim();
  if (!q) {
    return 'Напиши вопрос парой слов или выбери кнопку в меню English Flow.';
  }

  if (q.length <= 2 && !/[a-zа-яё0-9]/i.test(q)) {
    return 'Не совсем понял — напиши чуть подробнее или открой меню кнопкой ниже.';
  }

  if (GREET.test(q) && q.length < 40) {
    return 'Привет! Это бот English Flow: запись, пробный, курсы, отзывы и вопросы — через кнопки ниже. Можешь написать и текстом.';
  }

  if (ACK.test(q)) {
    return 'Пожалуйста! Если ещё вопрос — пиши или выбери раздел в меню.';
  }

  if (OFF_TOPIC.test(q)) {
    return (
      'Здесь я помогаю только по школе English Flow: курсы, запись, пробный, отзывы, перенос. ' +
      'Выбери пункт меню или опиши запрос своими словами в рамках школы.'
    );
  }

  if (POLICY.test(q) && q.length < 280) {
    const p = db.getContent('lesson_format');
    if (p && p.includes('8')) {
      return trimAnswer(
        'Перенос — не позже чем за 8 часов до урока; иначе занятие считается проведённым. Управление — в разделе «Отмена / перенос».',
        500
      );
    }
  }

  if (CANCEL.test(q) && q.length < 200) {
    return 'Отмена и перенос — кнопка «Отмена / перенос урока» в меню. Выбери свою запись.';
  }

  if (REVIEWS.test(q) && q.length < 200) {
    return 'Отзывы — кнопка «Отзывы». Можно листать стрелками.';
  }

  if (TRIAL.test(q) && q.length < 220) {
    return 'Пробный урок (30 мин) — кнопка «Пробный урок», потом слот и контакты. Нужно другое время — напиши координатору после заявки.';
  }

  if (BOOK.test(q) && !PRICE.test(q) && q.length < 220) {
    return 'Запись и заявка — кнопки «Запись на занятие / заявка» или «Пробный урок», дальше слот и контакты. Так надёжнее, чем только в чате.';
  }

  const faqHit = matchFaq(q);
  if (faqHit) {
    return trimAnswer(faqHit.answer, 900) + '\n\nПодробнее — в FAQ в меню.';
  }

  if (PRICE.test(q) && q.length < 300) {
    const p = db.getContent('prices');
    if (p) return trimAnswer(p, 700) + '\n\nТочные цифры — у координатора после заявки.';
  }

  if (SCHEDULE.test(q) && q.length < 300) {
    const s = db.getContent('schedule');
    if (s) return trimAnswer(s, 500) + '\n\nСлоты — при записи через меню.';
  }

  if (HOW.test(q) && q.length < 380) {
    const m = db.getContent('methodology');
    const f = db.getContent('lesson_format');
    const block = [m, f].filter(Boolean).join('\n\n');
    if (block) return trimAnswer(block, 1000) + '\n\nТарифы — в FAQ или после заявки.';
  }

  return null;
}

/**
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
