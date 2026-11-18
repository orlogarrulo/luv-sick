create table if not exists categories (
  id text primary key,
  name text not null,
  sort_order int not null
);

create table if not exists subcategories (
  id text primary key,
  category_id text not null references categories (id),
  name text not null,
  sort_order int not null
);

create table if not exists products (
  sku text primary key,
  category_id text not null references categories (id),
  subcategory_id text not null references subcategories (id),
  name text not null,
  brand text not null,
  format text not null,
  unit text not null,
  description text not null,
  keywords text not null,
  photo_source text not null,
  photo_file text not null,
  priority text not null,
  cost_aoa int,
  price_aoa int,
  min_margin_pct int not null default 15,
  stock int not null default 0,
  expiry_date date,
  avg_daily double precision not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_cat_idx on products (category_id, subcategory_id);
create index if not exists products_priority_idx on products (priority);

create table if not exists customers (
  id text primary key,
  name text not null,
  phone text not null unique,
  otp_channel text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists customer_sessions (
  token_hash text primary key,
  customer_id text not null references customers (id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists otp_codes (
  id text primary key,
  phone text not null,
  name text not null,
  channel text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists otp_phone_idx on otp_codes (phone, created_at desc);

create table if not exists addresses (
  id text primary key,
  customer_id text not null references customers (id),
  label text not null,
  lat double precision not null,
  lng double precision not null,
  complement text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists favorites (
  customer_id text not null references customers (id),
  sku text not null references products (sku),
  created_at timestamptz not null default now(),
  primary key (customer_id, sku)
);

create table if not exists restock_alerts (
  customer_id text not null references customers (id),
  sku text not null references products (sku),
  created_at timestamptz not null default now(),
  primary key (customer_id, sku)
);

create table if not exists orders (
  id text primary key,
  number int not null unique,
  customer_id text not null references customers (id),
  status text not null,
  payment_method text not null,
  payment_status text not null,
  subtotal_aoa int not null,
  delivery_aoa int not null,
  discount_aoa int not null,
  total_aoa int not null,
  eta_label text not null,
  address_label text not null,
  lat double precision not null,
  lng double precision not null,
  complement text not null default '',
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_customer_idx on orders (customer_id, created_at desc);

create table if not exists order_items (
  id text primary key,
  order_id text not null references orders (id),
  sku text not null,
  name text not null,
  qty int not null,
  unit_price_aoa int not null,
  compare_at_aoa int,
  line_total_aoa int not null
);

create table if not exists order_events (
  id text primary key,
  order_id text not null references orders (id),
  status text not null,
  note text,
  actor text not null,
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id text primary key,
  order_id text not null references orders (id),
  provider text not null,
  external_ref text,
  status text not null,
  amount_aoa int not null,
  created_at timestamptz not null default now()
);

create table if not exists deliveries (
  order_id text primary key references orders (id),
  courier_name text,
  cash_received_aoa int,
  change_aoa int,
  confirmed_at timestamptz
);

create table if not exists staff_users (
  id text primary key,
  email text not null unique,
  name text not null,
  password_hash text not null,
  role text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists staff_challenges (
  id text primary key,
  staff_id text not null references staff_users (id),
  code_hash text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists staff_sessions (
  token_hash text primary key,
  staff_id text not null references staff_users (id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists promotions (
  id text primary key,
  sku text not null references products (sku),
  kind text not null,
  value int not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  unit_limit int,
  units_sold int not null default 0,
  min_stock_cutoff int not null default 0,
  origin text not null,
  status text not null,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists promotions_sku_idx on promotions (sku, status);

create table if not exists customer_discounts (
  id text primary key,
  customer_id text not null references customers (id),
  kind text not null,
  value int not null,
  scope text not null,
  scope_ref text,
  single_use boolean not null default true,
  used boolean not null default false,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists coupons (
  id text primary key,
  code text not null unique,
  customer_id text references customers (id),
  kind text not null,
  value int not null,
  scope text not null,
  scope_ref text,
  single_use boolean not null default true,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists coupon_redemptions (
  id text primary key,
  coupon_id text not null references coupons (id),
  customer_id text not null,
  order_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id text primary key,
  actor text not null,
  action text not null,
  entity text not null,
  entity_id text not null,
  before_json text,
  after_json text,
  created_at timestamptz not null default now()
);

create index if not exists audit_created_idx on audit_logs (created_at desc);

create table if not exists inventory_movements (
  id text primary key,
  sku text not null,
  delta int not null,
  reason text not null,
  actor text not null,
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id text primary key,
  customer_id text not null references customers (id),
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists app_meta (
  key text primary key,
  value text not null
);
