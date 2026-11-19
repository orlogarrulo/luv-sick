alter table luv_reservations add column if not exists total_label text not null default '';
alter table luv_reservations add column if not exists deposit_label text not null default '';
alter table luv_reservations add column if not exists balance_label text not null default '';
alter table luv_reservations add column if not exists pay text not null default '';
alter table luv_reservations add column if not exists market text not null default '';
alter table luv_reservations add column if not exists receipt_no text not null default '';
alter table luv_reservations add column if not exists invoice_no text not null default '';
alter table luv_reservations add column if not exists emailed_at timestamptz;
