# English Flow — бот

Онлайн-школа **English Flow**: Telegram-бот с записями, FAQ, отзывами и AI-ассистентом по правилам школы.

## Обновить тексты в уже существующей базе

Если база создана раньше (старый сид), подставьте актуальные тексты:

```bash
npm run seed:english-flow
```

Или удалите файл БД (`data/bot.db`) и запустите бота снова — выполнится полный seed.

## Где править контент

- Тексты для бота и AI: [`src/englishFlowSeedData.js`](src/englishFlowSeedData.js)
- Системный промпт AI: [`src/tutorSystemPrompt.js`](src/tutorSystemPrompt.js)
- Кнопки и реплики интерфейса: [`src/bot.js`](src/bot.js)

## AI

См. [OPENAI_SETUP.md](OPENAI_SETUP.md).
