const { Telegraf, Markup } = require('telegraf');
const db = require('./db');
const {
  getSession,
  patchSession,
  resetDraft,
  resetToMenu,
} = require('./store');
const S = require('./states');
const { answerFreeformQuestion } = require('./aiAnswer');

const MAX_NAME = 100;
const MAX_COMMENT = 500;

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Запись на урок', 'm_br')],
    [Markup.button.callback('Пробное занятие', 'm_bt')],
    [Markup.button.callback('Подход и формат уроков', 'm_inf')],
    [Markup.button.callback('Отзывы', 'm_rev')],
    [Markup.button.callback('FAQ', 'm_faq')],
    [Markup.button.callback('Задать вопрос (AI)', 'm_qa')],
    [Markup.button.callback('Отмена / перенос урока', 'm_rs')],
  ]);
}

function menuText() {
  return (
    'Привет! Я Даша — твой репетитор по английскому языку. Мои студенты путешествуют без гугл переводчика) ' +
    'Хочешь стать одним из них или у тебя какой-то другой вопрос — кликни ниже'
  );
}

/**
 * @param {import('telegraf').Context} ctx
 */
async function sendMainMenu(ctx) {
  await ctx.reply(menuText(), mainMenuKeyboard());
}

/**
 * @param {string} phone
 */
function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  return digits;
}

/**
 * @param {string} phone
 */
function isValidPhone(phone) {
  const d = normalizePhone(phone);
  return d.length >= 10 && d.length <= 15;
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {string} text
 */
async function notifyTutor(ctx, text) {
  const tutorChat = process.env.TUTOR_CHAT_ID;
  if (tutorChat) {
    try {
      await ctx.telegram.sendMessage(tutorChat, text);
      return;
    } catch (e) {
      console.error('Не удалось отправить уведомление в Telegram:', e.message);
    }
  }
  console.log('[уведомление репетитору]\n', text);
}

/**
 * @param {import('telegraf').Context} ctx
 */
function userLine(ctx) {
  const u = ctx.from;
  if (!u) return '';
  const un = u.username ? `@${u.username}` : 'без username';
  return `user_id=${u.id}, ${un}`;
}

function slotKeyboard(prefix) {
  const rows = [];
  for (const s of db.getSlots()) {
    rows.push([Markup.button.callback(s.label, `${prefix}${s.id}`)]);
  }
  rows.push([Markup.button.callback('« В меню', 'm_main')]);
  return Markup.inlineKeyboard(rows);
}

function bookingSummary(draft) {
  const typeLabel =
    draft.lessonType === 'trial' ? 'Пробное занятие' : 'Обычный урок';
  const slot = draft.slotId ? db.getSlotById(draft.slotId) : undefined;
  const slotLabel = slot ? slot.label : draft.slotId;
  return (
    `${typeLabel}\n` +
    `Время: ${slotLabel}\n` +
    `Как зовут: ${draft.name}\n` +
    `Телефон: ${draft.phone}\n` +
    `Комментарий: ${draft.comment || 'без комментария'}`
  );
}

function confirmKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Всё верно, записываем', 'cf_ok')],
    [
      Markup.button.callback('Другое время', 'cf_ed_slot'),
      Markup.button.callback('Имя', 'cf_ed_name'),
    ],
    [
      Markup.button.callback('Телефон', 'cf_ed_phone'),
      Markup.button.callback('Комментарий', 'cf_ed_com'),
    ],
    [Markup.button.callback('« В меню', 'm_main')],
  ]);
}

/**
 * @param {import('telegraf').Context} ctx
 */
async function startBooking(ctx, lessonType) {
  const uid = ctx.from.id;
  resetDraft(uid);
  patchSession(uid, {
    state: S.BOOKING_SLOT,
    draft: { lessonType },
  });
  const title =
    lessonType === 'trial'
      ? 'Супер, давай выберем время для пробного 👇'
      : 'Отлично, выбери удобный слот для урока 👇';
  await ctx.reply(title, slotKeyboard('bs_'));
}

/**
 * @param {import('telegraf').Context} ctx
 */
async function askName(ctx) {
  patchSession(ctx.from.id, { state: S.BOOKING_NAME });
  await ctx.reply(
    'Как тебя зовут? Можно только имя или имя и фамилию — как тебе комфортно.',
    menuBackKeyboard()
  );
}

function menuBackKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('« В меню', 'm_main')],
  ]);
}

/**
 * @param {import('telegraf').Context} ctx
 */
async function askPhone(ctx) {
  patchSession(ctx.from.id, { state: S.BOOKING_PHONE });
  await ctx.reply(
    'Напиши номер или нажми «Поделиться контактом» — чтобы я могла написать или перезвонить. ' +
      'Передумал? Напиши «Отмена» или /menu.',
    Markup.keyboard([
      [Markup.button.contactRequest('Поделиться контактом')],
      ['Отмена'],
    ])
      .oneTime()
      .resize()
  );
}

/**
 * @param {import('telegraf').Context} ctx
 */
async function askComment(ctx) {
  patchSession(ctx.from.id, { state: S.BOOKING_COMMENT });
  await ctx.reply(
    'Хочешь что-то добавить? Например, уровень или цель — по желанию. ' +
      'Или жми «Пропустить».',
    Markup.inlineKeyboard([
      [Markup.button.callback('Пропустить', 'cm_skip')],
      [Markup.button.callback('« В меню', 'm_main')],
    ])
  );
}

/**
 * @param {import('telegraf').Context} ctx
 */
async function showConfirm(ctx) {
  patchSession(ctx.from.id, { state: S.BOOKING_CONFIRM });
  const d = getSession(ctx.from.id).draft;
  await ctx.reply(
    'Смотри, всё ли так:\n\n' + bookingSummary(d),
    confirmKeyboard()
  );
}

/**
 * @param {string} token
 */
function setupBot(token) {
  const bot = new Telegraf(token);

  bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    getSession(ctx.from.id);
    return next();
  });

  bot.start(async (ctx) => {
    resetToMenu(ctx.from.id);
    await sendMainMenu(ctx);
  });

  bot.command('menu', async (ctx) => {
    resetToMenu(ctx.from.id);
    await sendMainMenu(ctx);
  });

  bot.command('cancel', async (ctx) => {
    resetToMenu(ctx.from.id);
    await ctx.reply('Окей, начнём сначала. Вот меню:', mainMenuKeyboard());
  });

  bot.action('m_main', async (ctx) => {
    await ctx.answerCbQuery();
    resetToMenu(ctx.from.id);
    await ctx.editMessageText(menuText(), mainMenuKeyboard()).catch(async () => {
      await sendMainMenu(ctx);
    });
  });

  bot.action('m_br', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
    await startBooking(ctx, 'regular');
  });

  bot.action('m_bt', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
    await startBooking(ctx, 'trial');
  });

  bot.action('m_inf', async (ctx) => {
    await ctx.answerCbQuery();
    const methodology = db.getContent('methodology');
    const lessonFormat = db.getContent('lesson_format');
    await ctx.editMessageText(
      'Рассказываю коротко, как я работаю и как проходят занятия:\n\n' +
        methodology +
        '\n\n' +
        lessonFormat,
      Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'm_main')]])
    );
  });

  bot.action('m_rev', async (ctx) => {
    await ctx.answerCbQuery();
    patchSession(ctx.from.id, { state: S.REVIEWS, reviewsPage: 0 });
    await showReviewPage(ctx, 0);
  });

  bot.action('rev_prev', async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    const p = Math.max(0, (s.reviewsPage || 0) - 1);
    patchSession(ctx.from.id, { reviewsPage: p });
    await showReviewPage(ctx, p);
  });

  bot.action('rev_next', async (ctx) => {
    await ctx.answerCbQuery();
    const reviews = db.getReviews();
    const s = getSession(ctx.from.id);
    const p = Math.min(reviews.length - 1, (s.reviewsPage || 0) + 1);
    patchSession(ctx.from.id, { reviewsPage: p });
    await showReviewPage(ctx, p);
  });

  bot.action('rev_no', async (ctx) => {
    await ctx.answerCbQuery();
  });

  bot.action('m_faq', async (ctx) => {
    await ctx.answerCbQuery();
    patchSession(ctx.from.id, { state: S.FAQ_LIST });
    const faqItems = db.getFaqItems();
    const rows = faqItems.map((f) => [
      Markup.button.callback(f.question, `faq_${f.id}`),
    ]);
    rows.push([Markup.button.callback('« Меню', 'm_main')]);
    await ctx.editMessageText(
      'Что интересует? Жми на вопрос — откроется ответ 👇',
      Markup.inlineKeyboard(rows)
    );
  });

  bot.action(/^faq_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    const f = db.getFaqById(id);
    if (!f) {
      await ctx.reply(
        'Такого пункта уже нет — зайди в FAQ из меню ещё раз.',
        mainMenuKeyboard()
      );
      return;
    }
    await ctx.editMessageText(
      `${f.question}\n\n${f.answer}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('« Другие вопросы', 'm_faq')],
        [Markup.button.callback('« Меню', 'm_main')],
      ])
    );
  });

  bot.action('m_qa', async (ctx) => {
    await ctx.answerCbQuery();
    patchSession(ctx.from.id, { state: S.QA });
    await ctx.editMessageText(
      'Напиши вопрос в чат — отвечу по возможности. Про цены и время точнее всего в FAQ или после короткого привета в личке.\n\n' +
        'Выйти: /menu или кнопка ниже.',
      Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'm_main')]])
    );
  });

  bot.action(/^bs_(s\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const slotId = ctx.match[1];
    const slot = db.getSlotById(slotId);
    if (!slot) {
      await ctx.reply(
        'Это время уже не в списке — выбери другое, пожалуйста.',
        slotKeyboard('bs_')
      );
      return;
    }
    if (!db.isSlotFree(slotId)) {
      await ctx.reply(
        'Упс, это местечко только что заняли. Посмотри другое время:',
        slotKeyboard('bs_')
      );
      return;
    }
    patchSession(ctx.from.id, {
      draft: { slotId },
    });
    await askName(ctx);
  });

  bot.action('cm_skip', async (ctx) => {
    await ctx.answerCbQuery();
    patchSession(ctx.from.id, { draft: { comment: '' } });
    await showConfirm(ctx);
  });

  bot.action('cf_ok', async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from.id;
    const d = getSession(uid).draft;
    if (!d.lessonType || !d.slotId || !d.name || !d.phone) {
      await ctx.reply(
        'Что-то пошло не так с данными — давай запишемся заново с меню.',
        mainMenuKeyboard()
      );
      resetToMenu(uid);
      return;
    }
    if (!db.isSlotFree(d.slotId)) {
      patchSession(uid, { state: S.BOOKING_SLOT });
      await ctx.reply(
        'Это время уже заняли — выбери, пожалуйста, другой слот:',
        slotKeyboard('bs_')
      );
      return;
    }

    const slot = db.getSlotById(d.slotId);
    if (!slot) {
      await ctx.reply(
        'Не могу найти это время в расписании — начни запись сначала из меню.',
        mainMenuKeyboard()
      );
      resetToMenu(uid);
      return;
    }

    let rec;
    try {
      rec = db.insertBooking({
        userId: uid,
        username: ctx.from.username,
        name: d.name.trim(),
        phone: normalizePhone(d.phone),
        slotId: d.slotId,
        slotIso: slot.iso,
        slotLabel: slot.label,
        lessonType: d.lessonType,
        comment: (d.comment || '').trim() || undefined,
      });
      db.upsertStudent({
        userId: uid,
        username: ctx.from.username,
        displayName: d.name.trim(),
        phone: normalizePhone(d.phone),
      });
    } catch (e) {
      console.error(e);
      await ctx.reply(
        'Не получилось сохранить — попробуй чуть позже или напиши мне в личку, если срочно.',
        mainMenuKeyboard()
      );
      resetToMenu(uid);
      return;
    }

    const notify =
      `Новая запись ${rec.id}\n` +
      `${userLine(ctx)}\n` +
      `${bookingSummary(d)}\n` +
      `Создано: ${rec.createdAt}`;
    await notifyTutor(ctx, notify);

    resetToMenu(uid);
    await ctx.reply(
      'Готово, я всё увидела — скоро отпишусь. Рада, что ты здесь 💛',
      mainMenuKeyboard()
    );
  });

  bot.action('cf_ed_slot', async (ctx) => {
    await ctx.answerCbQuery();
    patchSession(ctx.from.id, { state: S.BOOKING_SLOT });
    await ctx.reply('Без проблем — выбери другое время:', slotKeyboard('bs_'));
  });

  bot.action('cf_ed_name', async (ctx) => {
    await ctx.answerCbQuery();
    await askName(ctx);
  });

  bot.action('cf_ed_phone', async (ctx) => {
    await ctx.answerCbQuery();
    await askPhone(ctx);
  });

  bot.action('cf_ed_com', async (ctx) => {
    await ctx.answerCbQuery();
    await askComment(ctx);
  });

  /** --- Отмена / перенос --- */
  bot.action('m_rs', async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from.id;
    const list = db.getBookingsForUser(uid);
    if (!list.length) {
      await ctx.editMessageText(
        'Пока нет записей через бота — если хочешь занятие, жми «Запись» или «Пробное» в меню.',
        mainMenuKeyboard()
      );
      return;
    }
    patchSession(uid, { state: S.RESCHEDULE_LIST });
    const rows = list.map((b) => [
      Markup.button.callback(
        `${b.slotLabel} · ${b.lessonType === 'trial' ? 'пробное' : 'урок'}`,
        `rs_b_${b.id}`
      ),
    ]);
    rows.push([Markup.button.callback('« Меню', 'm_main')]);
    await ctx.editMessageText(
      'Какую запись меняем?',
      Markup.inlineKeyboard(rows)
    );
  });

  bot.action(/^rs_b_(b\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    const b = db.getBookingById(id);
    if (!b || b.userId !== ctx.from.id) {
      await ctx.reply(
        'Такой записи уже нет — обнови список из меню.',
        mainMenuKeyboard()
      );
      return;
    }
    patchSession(ctx.from.id, {
      state: S.RESCHEDULE_ACTION,
      rescheduleBookingId: id,
    });
    await ctx.editMessageText(
      `${b.slotLabel} · ${b.lessonType === 'trial' ? 'пробное' : 'урок'}\n\nЧто делаем?`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Отменить', `rs_ca_${id}`)],
        [Markup.button.callback('Перенести', `rs_tr_${id}`)],
        [Markup.button.callback('« К списку', 'm_rs')],
        [Markup.button.callback('« Меню', 'm_main')],
      ])
    );
  });

  bot.action(/^rs_ca_(b\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    const b = db.getBookingById(id);
    if (!b || b.userId !== ctx.from.id) {
      await ctx.reply(
        'Такой записи уже нет — зайди в меню и открой перенос ещё раз.',
        mainMenuKeyboard()
      );
      return;
    }
    db.deleteBooking(id);
    await notifyTutor(
      ctx,
      `Отмена записи ${id}\n${userLine(ctx)}\n${b.slotLabel}`
    );
    resetToMenu(ctx.from.id);
    await ctx.editMessageText(
      'Окей, эту запись убрала. Если передумаешь — ты в меню.',
      mainMenuKeyboard()
    );
  });

  bot.action(/^rs_tr_(b\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    const b = db.getBookingById(id);
    if (!b || b.userId !== ctx.from.id) {
      await ctx.reply(
        'Такой записи уже нет — начни с меню.',
        mainMenuKeyboard()
      );
      return;
    }
    patchSession(ctx.from.id, {
      state: S.RESCHEDULE_SLOT,
      rescheduleBookingId: id,
      rescheduleAction: 'reschedule',
    });
    const rows = [];
    for (const s of db.getSlots()) {
      const free = db.isSlotFree(s.id, id);
      const label = free ? s.label : `${s.label} (занято)`;
      const data = free ? `rs_sl_${id}_${s.id}` : `rs_na`;
      rows.push([Markup.button.callback(label, data)]);
    }
    rows.push([Markup.button.callback('« Меню', 'm_main')]);
    await ctx.editMessageText(
      'На какое время переносим?',
      Markup.inlineKeyboard(rows)
    );
  });

  bot.action('rs_na', async (ctx) => {
    await ctx.answerCbQuery('Это время занято');
  });

  bot.action(/^rs_sl_(b\d+)_(s\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const bookingId = ctx.match[1];
    const slotId = ctx.match[2];
    const b = db.getBookingById(bookingId);
    if (!b || b.userId !== ctx.from.id) {
      await ctx.reply('Что-то не сходится — зайди в меню и попробуй снова.', mainMenuKeyboard());
      return;
    }
    if (!db.isSlotFree(slotId, bookingId)) {
      await ctx.reply('Это время уже занято — выбери другое.');
      return;
    }
    const slot = db.getSlotById(slotId);
    patchSession(ctx.from.id, {
      state: S.RESCHEDULE_CONFIRM,
      draft: { slotId, lessonType: b.lessonType },
    });
    await ctx.editMessageText(
      `Переносим на ${slot?.label}?\nСейчас у тебя: ${b.slotLabel}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Да, перенести', `rs_cf_${bookingId}_${slotId}`)],
        [Markup.button.callback('« Назад', `rs_tr_${bookingId}`)],
      ])
    );
  });

  bot.action(/^rs_cf_(b\d+)_(s\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const bookingId = ctx.match[1];
    const slotId = ctx.match[2];
    const b = db.getBookingById(bookingId);
    if (!b || b.userId !== ctx.from.id) {
      await ctx.reply('Что-то пошло не так — открой меню и попробуй ещё раз.', mainMenuKeyboard());
      return;
    }
    if (!db.isSlotFree(slotId, bookingId)) {
      await ctx.reply(
        'Это время уже заняли — открой перенос из меню заново.',
        mainMenuKeyboard()
      );
      resetToMenu(ctx.from.id);
      return;
    }
    const ok = db.updateBookingSlot(bookingId, slotId);
    if (!ok) {
      await ctx.reply(
        'Не получилось перенести — напиши мне, разберёмся.',
        mainMenuKeyboard()
      );
      resetToMenu(ctx.from.id);
      return;
    }
    const updated = db.getBookingById(bookingId);
    await notifyTutor(
      ctx,
      `Перенос ${bookingId}\n${userLine(ctx)}\nНовое время: ${updated?.slotLabel}`
    );
    resetToMenu(ctx.from.id);
    await ctx.editMessageText(
      `Готово — перенесла на ${updated?.slotLabel}. Увидимся!`,
      mainMenuKeyboard()
    );
  });

  /** --- Текст по состояниям --- */
  bot.on('text', async (ctx, next) => {
    const uid = ctx.from.id;
    const session = getSession(uid);
    const st = session.state;
    const text = (ctx.message.text || '').trim();

    if (text === 'Отмена' && st === S.BOOKING_PHONE) {
      await ctx.reply('Окей, запись не делаем.', Markup.removeKeyboard());
      resetToMenu(uid);
      await ctx.reply(menuText(), mainMenuKeyboard());
      return;
    }

    if (st === S.MAIN_MENU || st === S.REVIEWS || st === S.FAQ_LIST) {
      await ctx.reply(
        'Удобнее нажать кнопку снизу — или /menu, если потерялся.',
        mainMenuKeyboard()
      );
      return;
    }

    if (st === S.QA) {
      const ans = await answerFreeformQuestion(text);
      await ctx.reply(ans);
      try {
        db.insertQaLog({
          userId: uid,
          username: ctx.from.username,
          question: text,
          answer: ans,
        });
      } catch (e) {
        console.error('qa_logs:', e.message);
      }
      await ctx.reply('Можешь написать ещё один вопрос или вернуться в меню:', menuBackKeyboard());
      return;
    }

    if (st === S.BOOKING_NAME) {
      if (!text || text.length > MAX_NAME) {
        await ctx.reply(`Напиши имя покороче — до ${MAX_NAME} символов.`);
        return;
      }
      patchSession(uid, { draft: { name: text } });
      await askPhone(ctx);
      return;
    }

    if (st === S.BOOKING_PHONE) {
      if (!isValidPhone(text)) {
        await ctx.reply(
          'Не похоже на номер — попробуй ещё раз (от 10 цифр) или кнопку с контактом.'
        );
        return;
      }
      patchSession(uid, { draft: { phone: normalizePhone(text) } });
      await ctx.reply('—', Markup.removeKeyboard());
      await askComment(ctx);
      return;
    }

    if (st === S.BOOKING_COMMENT) {
      if (text.length > MAX_COMMENT) {
        await ctx.reply(
          `Очень длинно — до ${MAX_COMMENT} символов, или жми «Пропустить».`
        );
        return;
      }
      patchSession(uid, { draft: { comment: text } });
      await showConfirm(ctx);
      return;
    }

    if (
      st === S.BOOKING_SLOT ||
      st === S.BOOKING_CONFIRM ||
      st === S.RESCHEDULE_LIST ||
      st === S.RESCHEDULE_ACTION ||
      st === S.RESCHEDULE_SLOT ||
      st === S.RESCHEDULE_CONFIRM
    ) {
      await ctx.reply(
        'Тут нужны кнопки под этим сообщением. Сброс: /menu.'
      );
      return;
    }

    await ctx.reply(
      'Не поняла, что сделать — открой /menu и выбери раздел.',
      mainMenuKeyboard()
    );
  });

  bot.on('contact', async (ctx) => {
    const uid = ctx.from.id;
    const session = getSession(uid);
    if (session.state !== S.BOOKING_PHONE) return;
    const c = ctx.message.contact;
    if (!c || c.user_id !== uid) {
      await ctx.reply('Нужен именно твой контакт — жми кнопку ниже.');
      return;
    }
    const phone = c.phone_number || '';
    if (!isValidPhone(phone)) {
      await ctx.reply('Не вижу номер — набери его текстом, пожалуйста.');
      return;
    }
    patchSession(uid, { draft: { phone: normalizePhone(phone) } });
    await ctx.reply('Принято, спасибо!', Markup.removeKeyboard());
    await askComment(ctx);
  });

  bot.on(['photo', 'sticker', 'voice', 'video', 'document'], async (ctx) => {
    await ctx.reply(
      'Пока умею только текст и кнопки — напиши словами или /menu.',
      mainMenuKeyboard()
    );
  });

  bot.catch((err, ctx) => {
    console.error('Ошибка в обработчике:', err);
    if (ctx && ctx.chat) {
      return ctx
        .reply('Упс, что-то пошло не так. Попробуй ещё раз или /menu.')
        .catch(() => {});
    }
  });

  return bot;
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {number} page
 */
async function showReviewPage(ctx, page) {
  const reviews = db.getReviews();
  const total = reviews.length;
  if (total === 0) {
    await ctx.editMessageText(
      'Отзывы скоро добавлю — загляни позже.',
      Markup.inlineKeyboard([[Markup.button.callback('« Меню', 'm_main')]])
    ).catch(async () => {
      await ctx.reply('Отзывы скоро добавлю — загляни позже.', mainMenuKeyboard());
    });
    return;
  }
  const i = Math.min(Math.max(page, 0), total - 1);
  const r = reviews[i];
  const nav = Markup.inlineKeyboard([
    [
      Markup.button.callback('◀', 'rev_prev'),
      Markup.button.callback(`${i + 1} / ${total}`, 'rev_no'),
      Markup.button.callback('▶', 'rev_next'),
    ],
    [Markup.button.callback('« Меню', 'm_main')],
  ]);
  const body = `Что говорят ребята (${i + 1}/${total})\n\n${r.author}:\n${r.text}`;
  await ctx.editMessageText(body, nav).catch(async () => {
    await ctx.reply(body, nav);
  });
}

module.exports = { setupBot };
