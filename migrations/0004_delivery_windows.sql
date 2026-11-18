alter table orders add column if not exists slot_label text not null default '';
alter table orders add column if not exists slot_start timestamptz;
alter table orders add column if not exists slot_end timestamptz;

create table if not exists delivery_windows (
  id text primary key,
  label text not null,
  weekday int not null,
  start_min int not null,
  end_min int not null,
  capacity int not null default 12,
  active boolean not null default true
);
