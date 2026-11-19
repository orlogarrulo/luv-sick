create table if not exists luv_reservations (
  id text primary key,
  ref text not null,
  created_at timestamptz not null default now(),
  customer_name text not null,
  phone text not null,
  email text not null,
  lines text not null,
  received_sent boolean not null default false,
  stock_sent boolean not null default false
);

create table if not exists luv_flags (
  key text primary key,
  value text not null
);

insert into luv_flags (key, value) values ('stock_in', '0')
on conflict (key) do nothing;
