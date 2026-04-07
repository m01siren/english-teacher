/**
 * Ответы без OpenAI: эвристики по ключевым словам и коротким фразам.
 * English Flow — онлайн-школа.
 */

const db = require('./db');

const ACK = /^(спасибо|благодарю|окей|ок|yes|да|угу|понятно|понял|поняла|хорошо|ладно|не надо|не нужно)\s*[!?.…]*$/i;
const GREET = /^(привет|здравствуй|добрый\s*(день|вечер)|hi|hello)\s*[!?.…]*$/i;

/** Явный off-topic — отказ без API (не цеплять «домашние задания на платформе») */
const OFF_TOPIC =
  /переведи|перевод\s|проверь\s*текст|грамматик|сочинени|эссе|правильно\s*ли|как\s*сказать\s*по-англий|лучш(ий|ая)\s*(курс|школ|приложен)|chatgpt|нейросет|домашк|сделай\s+дз|реш(и|ить)\s+дз|помоги\s+с\s+дз/i;

/** Сравнение с конкурентами / «где лучше» — отдельный отказ */
const COMPETITOR_OR_COMPARE =
  /сравн(и|ить)|vs\b|versus|skyeng|скайенг|конкурент|друг(ая|ие|их)\s+школ|лучше\s+чем|что\s+лучше|кого\s+выбрать/i;

/** Сильные сигналы к разделам бота */
const TRIAL = /пробн|попробов|хочу\s*попроб|trial|test\s*lesson/i;
const BOOK =
  /запис(ать|аться|ка)|заявк|хочу\s*урок|назначить\s*урок|есть\s*мест|начать\s*уч/i;
const CANCEL =
  /отмен(ить|а)|перенес(ти|ти)|не\s*могу\s*прийти|не\s*приду/i;

/** Вопрос о правилах, а не команда «сделай перенос» */
const POLICY_OR_INFO_Q =
  /\?|за\s+сколько|сколько\s+(час|минут)|можно\s+ли|правил|услови|что\s+будет|сгорит|без\s+потерь|расскаж|объясн|почему|как\s+это\s+работает/i;
const REVIEWS = /отзыв|рекомендац|кто\s*учил|отклик/i;
const PRICE = /сколько\s*сто|цен(а|ы)|оплат|руб|₽|стоимост|тариф/i;
const SCHEDULE = /расписан|когда\s*(можно|есть)|во\s*сколько|выходн/i;
const HOW =
  /как\s*(у\s*вас|проход|устроен)|формат|подход|метод|english\s*flow|курс|ielts|бизнес|мини-групп|индивидуал|подрост|родител/i;
const POLICY =
  /8\s*час|\bперенос\w*|\bперенести\b|отмен(ить|а)\b.*урок|урок.*отмен/i;

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

  if (COMPETITOR_OR_COMPARE.test(q)) {
    return (
      'Мы не сравниваем English Flow с другими школами и не даём оценок конкурентам — в базе знаний нет таких данных. ' +
      'Могу рассказать про наши курсы, формат, пробный урок и правила — напиши, что интересует.'
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

  if (CANCEL.test(q) && q.length < 200 && !POLICY_OR_INFO_Q.test(q)) {
    return 'Отмена и перенос — кнопка «Отмена / перенос урока» в меню. Выбери свою запись.';
  }

  if (REVIEWS.test(q) && q.length < 200) {
    return 'Отзывы — кнопка «Отзывы». Можно листать стрелками.';
  }

  if (
    /ielts|айэлтс/i.test(q) &&
    /business|бизнес/i.test(q) &&
    /есть\s+ли|у\s+вас\s+есть|есть\s+у\s+вас|можно\s+ли|делаете\s+ли/i.test(q) &&
    q.length < 220
  ) {
    return (
      'Да: в English Flow есть подготовка к IELTS и курс Business English. ' +
      'Оба направления ведутся индивидуально; состав группы и программа уточняются при записи. Подробнее — в описании курсов или FAQ в меню.'
    );
  }

  if (
    /мини-групп/i.test(q) &&
    /онлайн|офлайн|только|в\s+офис/i.test(q) &&
    q.length < 260
  ) {
    return (
      'Да: все занятия English Flow проходят только онлайн; офлайн-формата нет. ' +
      'Доступны индивидуальные уроки и мини-группы (обычно 2–6 человек близкого уровня). Запись — через меню бота.'
    );
  }

  const asksTrialAndRegular =
    /обычн|стандартн|50\s*мин|два|оба|и\s+обычн|длительност/i.test(q);
  if (TRIAL.test(q) && q.length < 220 && !asksTrialAndRegular) {
    return 'Пробный урок (30 мин) — кнопка «Пробный урок», потом слот и контакты. Нужно другое время — напиши координатору после заявки.';
  }

  if (BOOK.test(q) && !PRICE.test(q) && q.length < 220) {
    return 'Запись и заявка — кнопки «Запись на занятие / заявка» или «Пробный урок», дальше слот и контакты. Так надёжнее, чем только в чате.';
  }

  const faqHit = matchFaq(q);
  if (faqHit) {
    return trimAnswer(faqHit.answer, 900) + '\n\nПодробнее — в FAQ в меню.';
  }

  if (PRICE.test(q) && /скидк|20\s*%|процент/i.test(q) && q.length < 400) {
    const p = db.getContent('prices');
    const head =
      'Фиксированной скидки 20% в публичной сетке English Flow нет. ' +
      'Цены зависят от формата (индивидуально / мини-группа) и пакета; персональные предложения — у координатора после заявки.';
    if (p) return trimAnswer(`${head}\n\n${p}`, 950);
    return head;
  }

  if (PRICE.test(q) && q.length < 300) {
    const p = db.getContent('prices');
    if (p) return trimAnswer(p, 700) + '\n\nТочные цифры — у координатора после заявки.';
  }

  if (SCHEDULE.test(q) && q.length < 300) {
    const s = db.getContent('schedule');
    if (s) return trimAnswer(s, 500) + '\n\nСлоты — при записи через меню.';
  }

  if (HOW.test(q) && q.length < 380 && !COMPETITOR_OR_COMPARE.test(q)) {
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
