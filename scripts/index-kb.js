/* eslint-disable no-console */
require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { OpenAIEmbeddings } = require('@langchain/openai');
const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');

const DEFAULT_SOURCE_PATH = path.resolve(process.cwd(), 'регламент.txt');
const DEFAULT_SOURCE_ID = 'reglament';
const DEFAULT_TABLE = 'kb_chunks';
const DEFAULT_EMBED_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

function mustEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Отсутствует ${name} в .env`);
  }
  return value.trim();
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function toCleanText(raw) {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
}

async function chunkText(text) {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: Number(process.env.KB_CHUNK_SIZE || 900),
    chunkOverlap: Number(process.env.KB_CHUNK_OVERLAP || 120),
    separators: ['\n## ', '\n### ', '\n\n', '\n', '. ', ' ', ''],
  });
  return splitter.splitText(text);
}

async function run() {
  const sourcePath = process.env.KB_SOURCE_PATH || DEFAULT_SOURCE_PATH;
  const sourceId = process.env.KB_SOURCE_ID || DEFAULT_SOURCE_ID;
  const tableName = process.env.KB_TABLE || DEFAULT_TABLE;
  const embedModel = process.env.OPENAI_EMBEDDINGS_MODEL || DEFAULT_EMBED_MODEL;

  const supabaseUrl = mustEnv('SUPABASE_URL');
  const supabaseKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY');
  const openAiKey = mustEnv('OPENAI_API_KEY');

  const raw = await fs.readFile(sourcePath, 'utf8');
  const docText = toCleanText(raw);
  if (!docText) {
    throw new Error(`Файл пустой: ${sourcePath}`);
  }

  console.log(`Источник: ${sourcePath}`);
  console.log(`Таблица: ${tableName}`);
  console.log('Нарезка документа...');
  const chunks = await chunkText(docText);
  if (!chunks.length) {
    throw new Error('Не получилось сформировать фрагменты для индексации.');
  }

  const embeddings = new OpenAIEmbeddings({
    openAIApiKey: openAiKey,
    model: embedModel,
  });
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log(`Генерация эмбеддингов (${chunks.length} фрагментов)...`);
  const vectors = await embeddings.embedDocuments(chunks);
  if (vectors.some((v) => !Array.isArray(v) || v.length !== EMBEDDING_DIM)) {
    throw new Error(
      `Ожидалась размерность ${EMBEDDING_DIM}. Проверь модель эмбеддингов (${embedModel}).`
    );
  }

  console.log(`Очистка старых фрагментов source_id=${sourceId}...`);
  const del = await supabase.from(tableName).delete().eq('source_id', sourceId);
  if (del.error) throw del.error;

  const nowIso = new Date().toISOString();
  const docHash = sha256(docText);
  const rows = chunks.map((content, i) => ({
    source_id: sourceId,
    chunk_index: i,
    content,
    embedding: vectors[i],
    content_hash: sha256(content),
    metadata: {
      sourcePath,
      sourceId,
      documentHash: docHash,
      chunkIndex: i,
      indexedAt: nowIso,
    },
  }));

  const BATCH_SIZE = 50;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const ins = await supabase.from(tableName).insert(batch);
    if (ins.error) throw ins.error;
    inserted += batch.length;
  }

  console.log('');
  console.log('Индексация завершена успешно.');
  console.log(`Загружено фрагментов: ${inserted}`);
  console.log('');
  console.log('Что проверить вручную:');
  console.log('1) В Supabase в таблице kb_chunks появились строки с source_id=reglament.');
  console.log('2) В .env заполнены OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.');
  console.log('3) При обновлении регламента снова запусти: npm run kb:index');
}

run().catch((err) => {
  console.error('Ошибка индексации:', err.message || err);
  process.exitCode = 1;
});
