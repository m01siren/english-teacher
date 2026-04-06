const {
  getFaqItems,
  getContent,
  buildAiContextSnippet,
} = require('./db');

/**
 * Ответ на свободный вопрос: при наличии OPENAI_API_KEY — запрос к API, иначе эвристика по FAQ.
 * @param {string} question
 * @param {{ openaiKey?: string, model?: string }} [opts]
 * @returns {Promise<string>}
 */
async function answerFreeformQuestion(question, opts = {}) {
  const q = (question || '').trim();
  if (!q) {
    return 'Напишите вопрос текстом — я постараюсь ответить кратко.';
  }

  const FAQ_ITEMS = getFaqItems();
  const key = opts.openaiKey || process.env.OPENAI_API_KEY;
  const model = opts.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';

  if (key) {
    try {
      const AI_CONTEXT_SNIPPET = buildAiContextSnippet();
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                'Ты помощник репетитора по английскому. Отвечай кратко и по делу, на русском. ' +
                'Используй только факты из контекста; если данных нет — скажи уточнить у репетитора. ' +
                'Контекст:\n' +
                AI_CONTEXT_SNIPPET +
                '\n\nFAQ:\n' +
                FAQ_ITEMS.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n'),
            },
            { role: 'user', content: q },
          ],
          max_tokens: 400,
          temperature: 0.3,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText);
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text) return text;
    } catch {
      return fallbackAnswer(q);
    }
  }

  return fallbackAnswer(q);
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
    return `${best.answer}\n\nЕсли нужно уточнение — выберите пункт FAQ в меню или запишитесь на пробное.`;
  }

  if (/метод|как проход|подход|урок/i.test(q)) {
    return `${METHODOLOGY_TEXT}\n\nТочные цены и время — в разделах FAQ и «Запись».`;
  }

  return (
    'Я могу кратко ответить по стоимости, длительности и формату уроков — загляните в FAQ или задайте вопрос конкретнее.\n\n' +
    `Кратко о формате: ${METHODOLOGY_TEXT.slice(0, 200)}…`
  );
}

module.exports = { answerFreeformQuestion };
