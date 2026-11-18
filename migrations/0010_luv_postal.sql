alter table luv_orders add column if not exists country text not null default '';
alter table luv_orders add column if not exists postal text not null default '';
