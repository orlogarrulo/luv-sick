import { useState, type ChangeEvent } from "react";
import { WA, payCopyValue, payMethod, type Lang, type Market } from "@/lib/luvsick";
import { luvProofChunk, luvProofFinish, luvProofStart } from "@/server/fns";

export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
const PROOF_TYPES = ["image/jpeg", "image/png", "application/pdf"];

export const PAY_COPY: Record<
  Lang,
  {
    number: string;
    iban: string;
    amount: string;
    reference: string;
    refLater: string;
    refHint: string;
    copy: string;
    copied: string;
    soon: string;
    cardNote: string;
    proofLink: string;
  }
> = {
  pt: {
    number: "Número",
    iban: "IBAN",
    amount: "Valor exacto",
    reference: "Referência (põe no descritivo)",
    refLater: "A referência da encomenda aparece a seguir. Põe-na no descritivo do pagamento.",
    refHint: "Depois de pagares, envia o comprovativo na página do recibo ou pelo WhatsApp.",
    copy: "Copiar",
    copied: "Copiado",
    soon: "em breve",
    cardNote: "O Apple Pay ainda não está disponível. Escolhe MB WAY ou transferência.",
    proofLink: "Enviar comprovativo",
  },
  en: {
    number: "Number",
    iban: "IBAN",
    amount: "Exact amount",
    reference: "Reference (put it in the description)",
    refLater: "The order reference appears next. Put it in the payment description.",
    refHint: "Once you have paid, send the proof on the receipt page or by WhatsApp.",
    copy: "Copy",
    copied: "Copied",
    soon: "coming soon",
    cardNote: "Apple Pay is not available yet. Choose MB WAY or a bank transfer.",
    proofLink: "Send proof of payment",
  },
  fr: {
    number: "Numéro",
    iban: "IBAN",
    amount: "Montant exact",
    reference: "Référence (à mettre dans le libellé)",
    refLater: "La référence de la commande s'affiche ensuite. Mets-la dans le libellé du paiement.",
    refHint: "Une fois payé, envoie le justificatif sur la page du reçu ou par WhatsApp.",
    copy: "Copier",
    copied: "Copié",
    soon: "bientôt",
    cardNote: "Apple Pay n'est pas encore disponible. Choisis MB WAY ou un virement.",
    proofLink: "Envoyer le justificatif",
  },
};

function CopyRow({ label, value, copyValue, lang }: { label: string; value: string; copyValue?: string; lang: Lang }) {
  const [done, setDone] = useState(false);
  const t = PAY_COPY[lang];
  return (
    <div className="flex items-center justify-between gap-3 border-t border-black/10 pt-2 first:border-t-0 first:pt-0">
      <span className="grid min-w-0">
        <span className="text-xs text-[#1a1714]/60">{label}</span>
        <span className="break-all font-bold tabular-nums" data-pay-value={label}>{value}</span>
      </span>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(copyValue ?? value);
            setDone(true);
            window.setTimeout(() => setDone(false), 1800);
          } catch {
            setDone(false);
          }
        }}
        className="shrink-0 rounded-full border border-[#1a1714]/30 px-3 py-1 text-xs font-bold"
      >
        {done ? t.copied : t.copy}
      </button>
    </div>
  );
}

/** Dados do método escolhido: número ou IBAN, valor exacto e referência, cada um com botão de copiar. */
export function PayDetails({ market, pay, amountLabel, refCode, lang }: { market: Market; pay: string; amountLabel: string; refCode?: string; lang: Lang }) {
  const method = payMethod(market, pay);
  const t = PAY_COPY[lang];
  if (!method) return null;
  if (method.kind === "card") {
    return <p className="rounded-2xl bg-white p-4 text-sm text-[#1a1714]" data-pay-details>{t.cardNote}</p>;
  }
  return (
    <div className="grid gap-2 rounded-2xl bg-white p-4 text-sm text-[#1a1714]" data-pay-details>
      <p className="font-bold">{method.label}</p>
      <CopyRow label={method.kind === "iban" ? t.iban : t.number} value={method.value} copyValue={payCopyValue(method.value)} lang={lang} />
      <CopyRow label={t.amount} value={amountLabel} copyValue={amountLabel.replace(/[^\d,]/g, "")} lang={lang} />
      {refCode ? <CopyRow label={t.reference} value={refCode} lang={lang} /> : null}
      <p className="text-xs text-[#1a1714]/70">{refCode ? t.refHint : t.refLater}</p>
    </div>
  );
}

export function proofWhatsApp(market: Market, refCode: string, amountLabel: string) {
  const text = `Olá Luv Sick, envio o comprovativo do pagamento da ${refCode.startsWith("LR-") ? "reserva" : "encomenda"} ${refCode} (${amountLabel}).`;
  return `https://wa.me/${WA[market].n}?text=${encodeURIComponent(text)}`;
}

function toBase64(bytes: Uint8Array) {
  let out = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) out += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(out);
}

/** Carregar foto ou PDF do comprovativo (máx. 5 MB), enviado em pedaços para a base de dados privada. */
export function ProofUpload({ refCode, onDone }: { refCode: string; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const mime = file.type === "image/jpg" ? "image/jpeg" : file.type;
    if (!PROOF_TYPES.includes(mime)) {
      setNote("Só aceitamos JPG, PNG ou PDF.");
      return;
    }
    if (file.size > PROOF_MAX_BYTES) {
      setNote("O ficheiro tem mais de 5 MB. Envia uma foto mais pequena ou usa o WhatsApp.");
      return;
    }
    setBusy(true);
    setNote("A enviar…");
    try {
      const start = await luvProofStart({ data: { ref: refCode, name: file.name, mime, size: file.size } });
      if (!start.ok) {
        setNote(
          start.error === "paid"
            ? "Este pagamento já está confirmado."
            : start.error === "many"
              ? "Já recebemos vários comprovativos. Fala connosco pelo WhatsApp."
              : start.error === "size"
                ? "O ficheiro tem mais de 5 MB."
                : start.error === "type"
                  ? "Só aceitamos JPG, PNG ou PDF."
                  : "Não encontrámos esta referência.",
        );
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      for (let idx = 0; idx < start.chunks; idx += 1) {
        const part = bytes.subarray(idx * start.chunkBytes, (idx + 1) * start.chunkBytes);
        const sent = await luvProofChunk({ data: { id: start.id, idx, data: toBase64(part) } });
        if (!sent.ok) throw new Error("chunk");
        setNote(`A enviar… ${Math.round(((idx + 1) / start.chunks) * 100)}%`);
      }
      const done = await luvProofFinish({ data: { id: start.id } });
      if (!done.ok) throw new Error("finish");
      setNote("Comprovativo recebido. Vamos confirmar o pagamento e avisamos-te.");
      onDone();
    } catch {
      setNote("O envio falhou. Tenta outra vez ou envia pelo WhatsApp.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2">
      <label className={`btn-brown block cursor-pointer rounded-full px-5 py-3 text-center ${busy ? "pointer-events-none opacity-60" : ""}`}>
        Carregar comprovativo (foto ou PDF)
        <input type="file" accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf" onChange={pick} disabled={busy} className="sr-only" data-proof-input />
      </label>
      <p className="text-xs text-[#1a1714]/60">JPG, PNG ou PDF, até 5 MB. Só a equipa Luv Sick vê o ficheiro.</p>
      {note ? <p className="text-sm" data-proof-note>{note}</p> : null}
    </div>
  );
}
