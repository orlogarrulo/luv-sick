create table if not exists luv_stock (
  product_id text not null,
  size text not null,
  qty integer not null check (qty >= 0),
  primary key (product_id, size)
);

create table if not exists luv_orders (
  id text primary key,
  ref text not null,
  created_at timestamptz not null default now(),
  customer_name text not null,
  phone text not null,
  address text not null,
  city text not null,
  market text not null,
  pay text not null,
  total_label text not null,
  lines text not null
);
