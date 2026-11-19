alter table luv_orders add column if not exists email text not null default '';
alter table luv_orders add column if not exists trial boolean not null default false;
alter table luv_orders add column if not exists invoice_no text not null default '';
alter table luv_reservations add column if not exists trial boolean not null default false;
