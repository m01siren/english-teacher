create extension if not exists vector;

create table if not exists public.kb_chunks (
  id bigserial primary key,
  source_id text not null,
  chunk_index integer not null,
  content text not null,
  embedding vector(1536) not null,
  content_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists kb_chunks_source_chunk_uq
  on public.kb_chunks (source_id, chunk_index);

create index if not exists kb_chunks_embedding_ivfflat
  on public.kb_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index if not exists kb_chunks_source_idx
  on public.kb_chunks (source_id);

create or replace function public.match_kb_chunks(
  query_embedding vector(1536),
  match_count int default 5,
  filter_source text default null
)
returns table (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
language sql
stable
as $$
  select
    kb.id,
    kb.content,
    kb.metadata,
    1 - (kb.embedding <=> query_embedding) as similarity
  from public.kb_chunks kb
  where filter_source is null or kb.source_id = filter_source
  order by kb.embedding <=> query_embedding
  limit match_count;
$$;
