-- Prazo das reservas (só acrescenta colunas; não apaga nem cancela nada).
-- clock_at: início do prazo de 24 h. As reservas que já existem recebem a hora desta migração
-- (= hora do deploy), por isso o lembrete sai 12 h e o cancelamento 24 h depois do deploy.
alter table luv_reservations add column if not exists clock_at timestamptz not null default now();
alter table luv_reservations add column if not exists reminder_at timestamptz;
alter table luv_reservations add column if not exists reminder_emailed boolean not null default false;
alter table luv_reservations add column if not exists cancelled_at timestamptz;
alter table luv_reservations add column if not exists cancel_reason text not null default '';
alter table luv_reservations add column if not exists cancel_emailed boolean not null default false;
alter table luv_reservations add column if not exists lang text not null default 'pt';
-- stock_held: a reserva tem peças retiradas do stock (as de ensaio nunca retiram).
alter table luv_reservations add column if not exists stock_held boolean;
update luv_reservations set stock_held = not coalesce(trial, false) where stock_held is null;
