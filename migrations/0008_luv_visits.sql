create table if not exists luv_visits (
  id text primary key,
  visitor text not null,
  country text not null,
  city text not null,
  created_at timestamptz not null default now()
);

create index if not exists luv_visits_visitor_idx on luv_visits (visitor, created_at);
