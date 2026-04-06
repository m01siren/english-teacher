/**
 * Подставляет тексты English Flow в существующую БД (content, faq, reviews).
 * Запуск из корня проекта: node scripts/apply-english-flow-content.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { initDatabase, getDb } = require('../src/db');
const {
  prices,
  schedule,
  methodology,
  lessonFormat,
  faqRows,
  reviewRows,
} = require('../src/englishFlowSeedData');

function run() {
  initDatabase();
  const db = getDb();

  const upsert = db.prepare(
    'INSERT OR REPLACE INTO content (key, value) VALUES (?, ?)'
  );
  upsert.run('prices', prices);
  upsert.run('schedule', schedule);
  upsert.run('methodology', methodology);
  upsert.run('lesson_format', lessonFormat);

  db.exec('DELETE FROM faq');
  const insFaq = db.prepare(
    'INSERT INTO faq (id, question, answer, sort_order) VALUES (?, ?, ?, ?)'
  );
  faqRows.forEach((row, i) => {
    insFaq.run(row.id, row.question, row.answer, i);
  });

  db.exec('DELETE FROM reviews');
  const insRev = db.prepare(
    'INSERT INTO reviews (author, body, sort_order) VALUES (?, ?, ?)'
  );
  reviewRows.forEach((r, i) => {
    insRev.run(r.author, r.text, i);
  });

  console.log('Готово: content, faq и reviews обновлены для English Flow.');
}

run();
