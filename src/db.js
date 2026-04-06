const fs = require('fs');
const path = require('path');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  console.error(
    'Требуется Node.js 22.5+ (модуль node:sqlite). Текущая версия:',
    process.version
  );
  throw new Error('node:sqlite недоступен');
}

const {
  prices,
  schedule,
  methodology,
  lessonFormat,
  faqRows,
  reviewRows,
  slotRows,
} = require('./englishFlowSeedData');

/** @type {import('node:sqlite').DatabaseSync | null} */
let db = null;

function dbPath() {
  const p = process.env.DATABASE_PATH || path.join('data', 'bot.db');
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function runMigrations() {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS content (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS slots (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      iso TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS faq (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      username TEXT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      slot_iso TEXT NOT NULL,
      slot_label TEXT NOT NULL,
      lesson_type TEXT NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (slot_id) REFERENCES slots(id)
    );

    CREATE TABLE IF NOT EXISTS students (
      user_id INTEGER PRIMARY KEY,
      username TEXT,
      display_name TEXT,
      phone TEXT,
      notes TEXT,
      first_seen_at TEXT NOT NULL,
      last_booking_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS qa_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT,
      question TEXT NOT NULL,
      answer TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings(slot_id);
    CREATE INDEX IF NOT EXISTS idx_qa_user ON qa_logs(user_id);
  `);
}

function seedIfEmpty() {
  const nSlots = db.prepare('SELECT COUNT(*) AS c FROM slots').get().c;
  if (nSlots > 0) return;

  const insertContent = db.prepare(
    'INSERT OR REPLACE INTO content (key, value) VALUES (?, ?)'
  );
  const insertSlot = db.prepare(
    'INSERT INTO slots (id, label, iso, sort_order, active) VALUES (?, ?, ?, ?, 1)'
  );
  const insertFaq = db.prepare(
    'INSERT INTO faq (id, question, answer, sort_order) VALUES (?, ?, ?, ?)'
  );
  const insertReview = db.prepare(
    'INSERT INTO reviews (author, body, sort_order) VALUES (?, ?, ?)'
  );

  db.exec('BEGIN IMMEDIATE');
  try {
    insertContent.run('prices', prices);
    insertContent.run('schedule', schedule);
    insertContent.run('methodology', methodology);
    insertContent.run('lesson_format', lessonFormat);

    for (const [id, label, iso, ord] of slotRows) {
      insertSlot.run(id, label, iso, ord);
    }

    faqRows.forEach((row, i) => {
      insertFaq.run(row.id, row.question, row.answer, i);
    });

    reviewRows.forEach((r, i) => {
      insertReview.run(r.author, r.text, i);
    });

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  console.log('БД: выполнено начальное заполнение (seed).');
}

/**
 * @returns {import('node:sqlite').DatabaseSync}
 */
function initDatabase() {
  if (db) return db;
  const file = dbPath();
  ensureDir(file);
  db = new DatabaseSync(file);
  runMigrations();
  seedIfEmpty();
  syncBookingSeqFromDb();
  return db;
}

function getDb() {
  if (!db) throw new Error('БД не инициализирована: вызовите initDatabase()');
  return db;
}

/**
 * @param {string} key
 */
function getContent(key) {
  const row = getDb()
    .prepare('SELECT value FROM content WHERE key = ?')
    .get(key);
  return row ? row.value : '';
}

/** @typedef {{ id: string, label: string, iso: string }} SlotRow */

/**
 * @returns {SlotRow[]}
 */
function getSlots() {
  return getDb()
    .prepare(
      'SELECT id, label, iso FROM slots WHERE active = 1 ORDER BY sort_order ASC, id ASC'
    )
    .all();
}

/**
 * @param {string} id
 * @returns {SlotRow|undefined}
 */
function getSlotById(id) {
  return getDb()
    .prepare('SELECT id, label, iso FROM slots WHERE id = ? AND active = 1')
    .get(id);
}

/** @typedef {{ id: string, question: string, answer: string }} FaqRow */

/**
 * @returns {FaqRow[]}
 */
function getFaqItems() {
  return getDb()
    .prepare(
      'SELECT id, question, answer FROM faq ORDER BY sort_order ASC, id ASC'
    )
    .all();
}

/**
 * @param {string} id
 * @returns {FaqRow|undefined}
 */
function getFaqById(id) {
  return getDb()
    .prepare('SELECT id, question, answer FROM faq WHERE id = ?')
    .get(id);
}

/** @typedef {{ id: number, author: string, text: string }} ReviewRow */

/**
 * @returns {ReviewRow[]}
 */
function getReviews() {
  return getDb()
    .prepare(
      'SELECT id, author, body AS text FROM reviews ORDER BY sort_order ASC, id ASC'
    )
    .all();
}

function buildAiContextSnippet() {
  const prices = getContent('prices');
  const schedule = getContent('schedule');
  const methodology = getContent('methodology');
  const lessonFormat = getContent('lesson_format');
  return [prices, schedule, methodology, lessonFormat].filter(Boolean).join('\n\n');
}

let bookingSeq = 0;

function syncBookingSeqFromDb() {
  const row = getDb()
    .prepare(
      "SELECT MAX(CAST(substr(id, 2) AS INTEGER)) AS m FROM bookings WHERE id LIKE 'b%'"
    )
    .get();
  const m = row && row.m != null ? row.m : 0;
  bookingSeq = Number.isFinite(m) ? m : 0;
}

function nextBookingId() {
  bookingSeq += 1;
  return `b${bookingSeq}`;
}

/**
 * @typedef {object} BookingInsert
 * @property {number} userId
 * @property {string} [username]
 * @property {string} name
 * @property {string} phone
 * @property {string} slotId
 * @property {string} slotIso
 * @property {string} slotLabel
 * @property {'regular'|'trial'} lessonType
 * @property {string} [comment]
 */

/**
 * @typedef {object} BookingRecord
 * @property {string} id
 * @property {number} userId
 * @property {string} [username]
 * @property {string} name
 * @property {string} phone
 * @property {string} slotId
 * @property {string} slotIso
 * @property {string} slotLabel
 * @property {'regular'|'trial'} lessonType
 * @property {string} [comment]
 * @property {string} createdAt
 */

/**
 * @param {BookingInsert} row
 * @returns {BookingRecord}
 */
function insertBooking(row) {
  const id = nextBookingId();
  const createdAt = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO bookings (
        id, user_id, username, name, phone, slot_id, slot_iso, slot_label, lesson_type, comment, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      row.userId,
      row.username ?? null,
      row.name,
      row.phone,
      row.slotId,
      row.slotIso,
      row.slotLabel,
      row.lessonType,
      row.comment ?? null,
      createdAt
    );
  return {
    id,
    userId: row.userId,
    username: row.username,
    name: row.name,
    phone: row.phone,
    slotId: row.slotId,
    slotIso: row.slotIso,
    slotLabel: row.slotLabel,
    lessonType: row.lessonType,
    comment: row.comment,
    createdAt,
  };
}

/**
 * @param {string} id
 * @returns {BookingRecord|undefined}
 */
function getBookingById(id) {
  return getDb()
    .prepare(
      `SELECT id, user_id AS userId, username, name, phone,
        slot_id AS slotId, slot_iso AS slotIso, slot_label AS slotLabel,
        lesson_type AS lessonType, comment, created_at AS createdAt
      FROM bookings WHERE id = ?`
    )
    .get(id);
}

/**
 * @param {number} userId
 * @returns {BookingRecord[]}
 */
function getBookingsForUser(userId) {
  return getDb()
    .prepare(
      `SELECT id, user_id AS userId, username, name, phone,
        slot_id AS slotId, slot_iso AS slotIso, slot_label AS slotLabel,
        lesson_type AS lessonType, comment, created_at AS createdAt
      FROM bookings WHERE user_id = ? ORDER BY created_at DESC`
    )
    .all(userId);
}

/**
 * @param {string} bookingId
 */
function deleteBooking(bookingId) {
  getDb().prepare('DELETE FROM bookings WHERE id = ?').run(bookingId);
}

/**
 * @param {string} bookingId
 * @param {string} newSlotId
 */
function updateBookingSlot(bookingId, newSlotId) {
  const slot = getSlotById(newSlotId);
  if (!slot) return false;
  const r = getDb()
    .prepare(
      `UPDATE bookings SET slot_id = ?, slot_iso = ?, slot_label = ? WHERE id = ?`
    )
    .run(slot.id, slot.iso, slot.label, bookingId);
  return r.changes > 0;
}

/**
 * @param {string} slotId
 * @param {string} [exceptBookingId]
 */
function isSlotFree(slotId, exceptBookingId) {
  if (exceptBookingId) {
    const row = getDb()
      .prepare(
        'SELECT COUNT(*) AS c FROM bookings WHERE slot_id = ? AND id != ?'
      )
      .get(slotId, exceptBookingId);
    return row.c === 0;
  }
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c FROM bookings WHERE slot_id = ?')
    .get(slotId);
  return row.c === 0;
}

/**
 * @param {object} p
 * @param {number} p.userId
 * @param {string} [p.username]
 * @param {string} p.displayName
 * @param {string} p.phone
 */
function upsertStudent(p) {
  const now = new Date().toISOString();
  const existing = getDb()
    .prepare('SELECT user_id FROM students WHERE user_id = ?')
    .get(p.userId);
  if (existing) {
    getDb()
      .prepare(
        `UPDATE students SET username = ?, display_name = ?, phone = ?, last_booking_at = ?, updated_at = ?
        WHERE user_id = ?`
      )
      .run(
        p.username ?? null,
        p.displayName,
        p.phone,
        now,
        now,
        p.userId
      );
  } else {
    getDb()
      .prepare(
        `INSERT INTO students (user_id, username, display_name, phone, first_seen_at, last_booking_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        p.userId,
        p.username ?? null,
        p.displayName,
        p.phone,
        now,
        now,
        now
      );
  }
}

/**
 * @param {object} p
 * @param {number} p.userId
 * @param {string} [p.username]
 * @param {string} p.question
 * @param {string} [p.answer]
 */
function insertQaLog(p) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      'INSERT INTO qa_logs (user_id, username, question, answer, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(p.userId, p.username ?? null, p.question, p.answer ?? null, now);
}

module.exports = {
  initDatabase,
  getDb,
  getContent,
  getSlots,
  getSlotById,
  getFaqItems,
  getFaqById,
  getReviews,
  buildAiContextSnippet,
  insertBooking,
  getBookingById,
  getBookingsForUser,
  deleteBooking,
  updateBookingSlot,
  isSlotFree,
  upsertStudent,
  insertQaLog,
};
