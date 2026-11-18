alter table deliveries add column if not exists provider_id text;
alter table deliveries add column if not exists external_id text;
alter table deliveries add column if not exists estado text not null default 'pendente';
alter table deliveries add column if not exists custo_kz int;
alter table deliveries add column if not exists taxa_cliente_kz int;
alter table deliveries add column if not exists pin_entrega text;
alter table deliveries add column if not exists estafeta_nome text;
alter table deliveries add column if not exists estafeta_telefone text;
alter table deliveries add column if not exists attempt int not null default 0;
alter table deliveries add column if not exists zone_id text;
alter table deliveries add column if not exists courier_lat double precision;
alter table deliveries add column if not exists courier_lng double precision;
alter table deliveries add column if not exists eta_min int;
alter table deliveries add column if not exists fallback_alert boolean not null default false;
alter table deliveries add column if not exists rating int;
alter table deliveries add column if not exists rating_note text;
alter table deliveries add column if not exists volumes int not null default 1;
alter table deliveries add column if not exists dispatched_at timestamptz;
alter table deliveries add column if not exists entregue_em timestamptz;
alter table deliveries add column if not exists cod_kz int;
alter table deliveries add column if not exists degraded boolean not null default false;
alter table deliveries add column if not exists status_lock boolean not null default false;

create index if not exists deliveries_estado_idx on deliveries (estado);
create index if not exists deliveries_provider_idx on deliveries (provider_id);

create table if not exists delivery_providers (
  id text primary key,
  nome text not null,
  tipo text not null,
  ativo boolean not null,
  prioridade int not null,
  config_json text not null,
  last_ok_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists delivery_zones (
  id text primary key,
  nome text not null,
  polygon_json text not null,
  taxa_cliente_kz int not null,
  free_above_kz int,
  providers_json text not null
);

create table if not exists delivery_quotes (
  id text primary key,
  order_id text not null,
  provider_id text not null,
  preco_kz int,
  eta_min int,
  expira_em timestamptz not null,
  erro text,
  criado_em timestamptz not null default now()
);

create index if not exists delivery_quotes_order_idx on delivery_quotes (order_id, criado_em desc);

create table if not exists delivery_dispatches (
  id text primary key,
  order_id text not null,
  attempt int not null,
  provider_id text not null,
  external_id text,
  estado text not null,
  custo_kz int,
  quote_id text,
  created_at timestamptz not null default now(),
  unique (order_id, attempt)
);

create index if not exists delivery_dispatches_order_idx on delivery_dispatches (order_id, created_at);

create table if not exists delivery_events (
  id text primary key,
  delivery_order_id text not null,
  estado text not null,
  origem text not null,
  payload text,
  dedupe_key text,
  created_at timestamptz not null default now()
);

create unique index if not exists delivery_events_dedupe_idx on delivery_events (dedupe_key) where dedupe_key is not null;
create index if not exists delivery_events_order_idx on delivery_events (delivery_order_id, created_at);

create table if not exists delivery_settings (
  id text primary key,
  mode text not null,
  rule text not null,
  preferred_provider text,
  price_cap_kz int,
  fallback_min int not null,
  show_carrier boolean not null default false
);

create table if not exists delivery_webhook_events (
  event_id text primary key,
  provider_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists whatsapp_outbox (
  id text primary key,
  order_id text not null,
  kind text not null,
  to_masked text not null,
  body text not null,
  created_at timestamptz not null default now(),
  unique (order_id, kind)
);

create table if not exists delivery_invoice_lines (
  id text primary key,
  provider_id text not null,
  external_id text not null,
  billed_kz int not null,
  period text not null,
  created_at timestamptz not null default now()
);

create table if not exists couriers (
  id text primary key,
  nome text not null,
  telefone text not null,
  ativo boolean not null default true,
  lat double precision,
  lng double precision
);
