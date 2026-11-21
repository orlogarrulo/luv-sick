-- Stripe Checkout: guarda a última sessão de cada encomenda (só acrescenta).
alter table luv_orders add column if not exists stripe_session text not null default '';
