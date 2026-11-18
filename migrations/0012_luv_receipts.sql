alter table luv_orders add column if not exists paid_at timestamptz;
alter table luv_orders add column if not exists nif text not null default '';
alter table luv_orders add column if not exists receipt_no text not null default '';
