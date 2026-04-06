/**
 * Защита от prompt injection и нормализация текста перед отправкой в LLM.
 * Не заменяет системный промпт — только фильтрация и эвристики.
 */

const MAX_USER_MESSAGE_CHARS = 1200;

/** Подозрительные паттерны: попытки подменить роль или вытянуть инструкции */
const INJECTION_PATTERNS = [
  /\bignore\s+(all\s+)?(previous|prior|above|instructions?|rules?)\b/i,
  /\bdisregard\s+(the\s+)?(above|previous|system)\b/i,
  /\b(system|assistant|user)\s*:\s*/i,
  /\[\s*INST\s*\]|\[\/\s*INST\s*\]/i,
  /<\|[^|]+\|>/,
  /\b(jailbreak|DAN\s+mode|developer\s+mode|unfiltered)\b/i,
  /\b(repeat|print|show|reveal|output)\s+(your|the|my)\s+(prompt|instructions?|system|rules?)\b/i,
  /\bforget\s+(everything|all|your|the)\s+(rules?|instructions?|above)\b/i,
  /you\s+are\s+now\s+(a|an|the)\b/i,
  /pretend\s+(you|to\s+be)\s+(are|a|an)\b/i,
  /\bновая\s+инструкция|игнорируй\s+(все\s+)?(выше|правила|инструкции)/i,
  /\bзабудь\s+(все\s+)?правила/i,
  /\bвыведи\s+(промпт|инструкции|системный)/i,
  /\bраскрой\s+(промпт|инструкции)/i,
  /```\s*(system|assistant)/i,
  /\boverride\s+bypass\b/i,
  /\bbase64\s*\(/i,
];

/**
 * @param {string} raw
 * @returns {boolean}
 */
function looksLikePromptInjection(raw) {
  const s = String(raw || '');
  if (s.length > 8000) return true;
  for (const re of INJECTION_PATTERNS) {
    if (re.test(s)) return true;
  }
  /** Много повторов «system»/роль в одном сообщении */
  const lower = s.toLowerCase();
  const roleSpam = (lower.match(/\b(system|assistant|user)\s*:/g) || []).length;
  if (roleSpam >= 2) return true;
  return false;
}

/**
 * Обрезка длины, мягкая нормализация (не удаляем смысл, убираем лишние нулевые символы).
 * @param {string} raw
 * @returns {string}
 */
function sanitizeForLlm(raw) {
  let s = String(raw || '')
    .replace(/\u0000/g, '')
    .trim();
  if (s.length > MAX_USER_MESSAGE_CHARS) {
    s = s.slice(0, MAX_USER_MESSAGE_CHARS).trim() + '…';
  }
  return s;
}

const REFUSAL_INJECTION_RU =
  'Я отвечаю только по вопросам школы English Flow и кнопкам бота. ' +
  'Задай вопрос про курсы, запись или пробный урок — или открой меню ниже.';

/** Префикс при ошибке API или пустом ответе модели (перед fallbackAnswer). */
const FALLBACK_API_PREFIX_RU =
  'Сейчас не получилось сформулировать ответ автоматически. Ниже — что можно сделать по школе:';

module.exports = {
  looksLikePromptInjection,
  sanitizeForLlm,
  REFUSAL_INJECTION_RU,
  FALLBACK_API_PREFIX_RU,
  MAX_USER_MESSAGE_CHARS,
};
