# Luv Sick

Loja de vestuário Luv Sick, em Portugal e Angola. O site está em [luvsickstore.com](https://luvsickstore.com).

## Arranque local

```bash
npm install
npm run dev
```

A loja abre em `/`. A gestão (stock, encomendas, reservas e cupões) está em `/gestao` e pede o código da equipa definido no servidor. Os recibos abrem em `/recibo/<referência>`.

## Prazo das reservas (lembrete às 12 h, cancelamento às 24 h)

- Uma reserva `LR-` sem comprovativo enviado e sem pagamento confirmado (manual ou Stripe) recebe um
  email de lembrete às 12 h (uma só vez, `reminder_at`) e passa a «Cancelada» às 24 h (`cancelled_at`).
  As peças voltam ao stock (só se tinham saído: `stock_held`; as reservas de ensaio nunca retiram stock)
  e o cliente recebe um email curto. O registo não é apagado: fica em «Canceladas» na gestão.
- Reservas com comprovativo (`proof_status` preenchido) ou pagas nunca são canceladas automaticamente.
- O prazo conta a partir de `clock_at`. Para as reservas que já existiam no deploy da migração
  `0019_luv_reserve_expiry.sql` (21/11/2026), `clock_at` = hora do deploy: lembrete 12 h e
  cancelamento 24 h depois do deploy, sem cancelamentos retroactivos.
- «Cancelar reserva» na gestão faz o mesmo à mão. «Confirmar pagamento» numa cancelada volta a
  pô-la activa se o stock chegar; o Stripe faz o mesmo quando um pagamento chega depois.
- Corre em `/api/cron-reservas` (Bearer `CRON_SECRET`): de hora a hora pelo GitHub Actions
  (`.github/workflows/reservas-prazo.yml`), uma vez por dia pelo Vercel Cron (limite do plano Hobby)
  e, como rede de segurança, sempre que a gestão ou o stock são lidos. É idempotente.
- Encomendas `LS-` ainda não entram neste prazo (a loja está em modo de reservas).
