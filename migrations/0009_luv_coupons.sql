create table if not exists luv_coupons (
  code text primary key,
  percent integer not null check (percent > 0 and percent <= 90),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table luv_orders add column if not exists coupon text not null default '';
