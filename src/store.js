/**
 * Сессии FSM в памяти процесса (без Redis).
 * Записи клиентов и бизнес-данные — в SQLite (см. db.js).
 */

/**
 * @typedef {object} BookingDraft
 * @property {'regular'|'trial'} [lessonType]
 * @property {string} [slotId]
 * @property {string} [name]
 * @property {string} [phone]
 * @property {string} [comment]
 */

/**
 * @typedef {object} Session
 * @property {string} state
 * @property {BookingDraft} draft
 * @property {number} reviewsPage
 * @property {string|null} [rescheduleBookingId]
 * @property {'cancel'|'reschedule'|null} [rescheduleAction]
 */

/** @type {Map<number, Session>} */
const sessions = new Map();

function defaultSession() {
  return {
    state: 'main_menu',
    draft: {},
    reviewsPage: 0,
    rescheduleBookingId: null,
    rescheduleAction: null,
  };
}

/**
 * @param {number} userId
 * @returns {Session}
 */
function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, defaultSession());
  }
  return /** @type {Session} */ (sessions.get(userId));
}

/**
 * @param {number} userId
 * @param {Partial<Session>} patch
 */
function patchSession(userId, patch) {
  const s = getSession(userId);
  if (patch.draft) {
    s.draft = { ...s.draft, ...patch.draft };
  }
  for (const key of Object.keys(patch)) {
    if (key === 'draft') continue;
    s[key] = patch[key];
  }
}

/**
 * @param {number} userId
 */
function resetDraft(userId) {
  const s = getSession(userId);
  s.draft = {};
  s.rescheduleBookingId = null;
  s.rescheduleAction = null;
}

/**
 * @param {number} userId
 */
function resetToMenu(userId) {
  sessions.set(userId, defaultSession());
}

module.exports = {
  sessions,
  getSession,
  patchSession,
  resetDraft,
  resetToMenu,
};
