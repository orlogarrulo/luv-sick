-- Catálogo dinâmico (gestão → Produtos). Só cria; a semente (3 conjuntos + peças avulsas) é feita pelo servidor uma vez.
create table if not exists luv_products (
  id text primary key,
  sort integer not null default 0,
  active boolean not null default true,
  custom boolean not null default false,
  price_eur numeric(10,2) not null,
  price_kz integer,
  name text not null,
  material text not null default '{}',
  blurb text not null default '{}',
  alt text not null default '{}',
  images text not null default '[]',
  details text,
  video text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists luv_flags (
  key text primary key,
  value text not null
);

-- Câmbio inicial: 1350 Kz = 1 € (editável na gestão).
insert into luv_flags (key, value) values ('kz_rate', '1350')
on conflict (key) do nothing;
