require('dotenv').config();

const { initDatabase } = require('./db');
const { setupBot } = require('./bot');

try {
  initDatabase();
} catch (e) {
  console.error('Ошибка инициализации БД:', e.message);
  process.exit(1);
}

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('Ошибка: задайте BOT_TOKEN в файле .env (см. .env.example)');
  process.exit(1);
}

const bot = setupBot(token);

bot
  .launch()
  .then(() => {
    console.log('Бот запущен. Остановка: Ctrl+C');
  })
  .catch((err) => {
    console.error('Не удалось запустить бота:', err);
    process.exit(1);
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
