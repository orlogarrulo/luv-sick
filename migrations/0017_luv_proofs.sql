-- Comprovativos de pagamento (só acrescenta; não altera dados existentes).
create table if not exists luv_proofs (
  id text primary key,
  ref text not null,
  created_at timestamptz not null default now(),
  file_name text not null default '',
  mime text not null,
  size integer not null,
  chunks integer not null,
  complete boolean not null default false,
  status text not null default 'pending'
);
create index if not exists luv_proofs_ref on luv_proofs (ref);

create table if not exists luv_proof_chunks (
  proof_id text not null,
  idx integer not null,
  data text not null,
  primary key (proof_id, idx)
);

alter table luv_orders add column if not exists proof_status text not null default '';
