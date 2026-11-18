alter table luv_orders add column if not exists seen boolean not null default false;
update luv_orders set seen = true;
