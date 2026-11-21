-- Câmbio do momento da compra (só acrescenta colunas; as linhas existentes ficam null = preço fixo da altura).
alter table luv_orders add column if not exists kz_rate numeric(12,2);
alter table luv_reservations add column if not exists kz_rate numeric(12,2);
