create table if not exists luv_customers (
  email text primary key,
  name text not null default '',
  phone text not null default '',
  address text not null default '',
  city text not null default '',
  country text not null default '',
  postal text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists luv_login_codes (
  email text primary key,
  code text not null,
  expires_at timestamptz not null
);

create table if not exists luv_sessions (
  token text primary key,
  email text not null,
  created_at timestamptz not null default now()
);
