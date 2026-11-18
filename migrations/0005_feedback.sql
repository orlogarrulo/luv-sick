create table if not exists feedback (
  id text primary key,
  kind text not null,
  order_ref text not null default '',
  name text not null,
  phone text not null,
  body text not null,
  created_at timestamptz not null default now()
);
