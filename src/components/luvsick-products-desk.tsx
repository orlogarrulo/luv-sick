import { useEffect, useState } from "react";
import { ALL_PRODUCTS, RATE, SIZES, formatAmount, kzFromEur, setCatalog, type Catalog, type Lang, type Product } from "@/lib/luvsick";
import { luvDeleteProduct, luvDeskCatalog, luvMoveProduct, luvSaveProduct, luvSetRate } from "@/server/fns";

type Shot = { src: string; label: string };
type Draft = {
  id?: string;
  custom: boolean;
  name: Record<Lang, string>;
  blurb: Record<Lang, string>;
  material: Record<Lang, string>;
  priceEur: string;
  priceKz: string;
  front: string;
  back: string;
  detailsFront: Shot[];
  detailsBack: Shot[];
  video: string;
  active: boolean;
  stock: string;
};

const EMPTY = { pt: "", en: "", fr: "" };

function toDraft(item?: Product): Draft {
  if (!item) {
    return { custom: true, name: { ...EMPTY }, blurb: { ...EMPTY }, material: { ...EMPTY }, priceEur: "", priceKz: "", front: "", back: "", detailsFront: [], detailsBack: [], video: "", active: true, stock: "5" };
  }
  const shots = (list?: { src: string; label: Record<Lang, string> }[]) => (list ?? []).map((entry) => ({ src: entry.src, label: entry.label.pt }));
  return {
    id: item.id,
    custom: Boolean(item.custom),
    name: { ...item.name },
    blurb: { ...item.blurb },
    material: { ...item.material },
    priceEur: String(item.priceEur),
    priceKz: item.priceKz == null ? "" : String(item.priceKz),
    front: item.images[0],
    back: item.images[1],
    detailsFront: shots(item.details?.front),
    detailsBack: shots(item.details?.back),
    video: item.video ?? "",
    active: item.active !== false,
    stock: "5",
  };
}

function cleanName(name: string) {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, "") : "";
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return `${base || "ficheiro"}${ext}`;
}

/** Fotos grandes do telemóvel: reduz para 2000 px (JPEG) antes de enviar. */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 1_500_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export function ProductsDesk({ code }: { code: string }) {
  const [items, setItems] = useState<Product[]>([]);
  const [rate, setRate] = useState("");
  const [savedRate, setSavedRate] = useState(RATE.kz);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [blobOn, setBlobOn] = useState(true);

  async function load() {
    const res = await luvDeskCatalog({ data: { code } });
    if (!res.ok) {
      setNote("Não foi possível ler os produtos.");
      return;
    }
    setCatalog(res.catalog as Catalog);
    setItems([...ALL_PRODUCTS].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)));
    setSavedRate(res.catalog.rate);
    setRate(String(res.catalog.rate));
    setBlobOn(res.blob);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function uploadFile(file: File, folder: "produtos" | "videos") {
    const { upload } = await import("@vercel/blob/client");
    const ready = await shrink(file);
    setBusy(`A enviar ${ready.name}…`);
    try {
      const result = await upload(`luvsick/${folder}/${cleanName(ready.name)}`, ready, {
        access: "public",
        handleUploadUrl: "/api/luv-upload",
        headers: { "x-luv-desk": code },
        multipart: ready.size > 8 * 1024 * 1024,
        onUploadProgress: (event) => setBusy(`A enviar ${ready.name}… ${Math.round(event.percentage)}%`),
      });
      return result.url;
    } finally {
      setBusy("");
    }
  }

  async function pick(accept: string, folder: "produtos" | "videos", multiple = false): Promise<string[]> {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    const files = await new Promise<File[]>((resolve) => {
      input.onchange = () => resolve(Array.from(input.files ?? []));
      input.click();
    });
    const urls: string[] = [];
    for (const file of files) {
      try {
        urls.push(await uploadFile(file, folder));
      } catch (err) {
        setNote(`Falha ao enviar ${file.name}: ${err instanceof Error ? err.message : "erro"}`);
      }
    }
    return urls;
  }

  async function saveRate() {
    const value = Number(rate.replace(/\s/g, "").replace(",", "."));
    const res = await luvSetRate({ data: { code, rate: value } });
    if (!res.ok) {
      setNote("error" in res && res.error !== "code" ? String(res.error) : "Não foi possível guardar o câmbio.");
      return;
    }
    setNote(`Câmbio guardado: 1 € = ${formatAmount(res.rate, "AO")}. Os preços em Kz da loja já usam este valor.`);
    await load();
  }

  async function save() {
    if (!draft) return;
    const res = await luvSaveProduct({
      data: {
        code,
        product: {
          id: draft.id,
          name: draft.name,
          blurb: draft.blurb,
          material: draft.material,
          priceEur: Number(draft.priceEur.replace(",", ".")),
          priceKz: draft.priceKz.trim() ? Number(draft.priceKz.replace(/[\s.]/g, "")) : null,
          images: [draft.front, draft.back || draft.front],
          details: { front: draft.detailsFront, back: draft.detailsBack },
          video: draft.video,
          active: draft.active,
          stock: Number(draft.stock),
        },
      },
    });
    if (!res.ok) {
      setNote("error" in res && res.error !== "code" ? String(res.error) : "Não foi possível guardar.");
      return;
    }
    setNote(draft.id ? "Item guardado. A loja já mostra as alterações." : "Item criado. Já aparece na Loja.");
    setDraft(null);
    await load();
  }

  async function remove() {
    if (!draft?.id || !window.confirm(`Apagar «${draft.name.pt}» da loja? Esta ação não se desfaz.`)) return;
    const res = await luvDeleteProduct({ data: { code, id: draft.id } });
    if (!res.ok) {
      setNote("error" in res && res.error !== "code" ? String(res.error) : "Não foi possível apagar.");
      return;
    }
    setNote("Item apagado.");
    setDraft(null);
    await load();
  }

  async function move(id: string, dir: number) {
    await luvMoveProduct({ data: { code, id, dir } });
    await load();
  }

  const eur = draft ? Number(draft.priceEur.replace(",", ".")) : 0;
  const field = "w-full border border-black px-2 py-2 text-sm";

  function shotsEditor(side: "detailsFront" | "detailsBack", title: string) {
    if (!draft) return null;
    const list = draft[side];
    const set = (next: Shot[]) => setDraft({ ...draft, [side]: next });
    return (
      <div className="grid gap-2">
        <p className="text-sm font-bold">{title}</p>
        {list.map((shot, index) => (
          <div key={`${shot.src}-${index}`} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-2">
            <img src={shot.src} alt="" className="size-14 rounded object-cover ring-1 ring-black/20" />
            <input value={shot.label} onChange={(event) => set(list.map((entry, at) => (at === index ? { ...entry, label: event.target.value } : entry)))} placeholder="Legenda (ex.: Coração no peito)" aria-label={`Legenda ${index + 1}`} className={field} />
            <div className="flex gap-1">
              <button type="button" aria-label="Subir" disabled={index === 0} onClick={() => set(list.map((entry, at) => (at === index - 1 ? list[index] : at === index ? list[index - 1] : entry)))} className="px-2 py-1 ring-1 ring-black disabled:opacity-30">↑</button>
              <button type="button" aria-label="Descer" disabled={index === list.length - 1} onClick={() => set(list.map((entry, at) => (at === index + 1 ? list[index] : at === index ? list[index + 1] : entry)))} className="px-2 py-1 ring-1 ring-black disabled:opacity-30">↓</button>
              <button type="button" aria-label="Remover" onClick={() => set(list.filter((_, at) => at !== index))} className="px-2 py-1 ring-1 ring-black">×</button>
            </div>
          </div>
        ))}
        <button
          type="button"
          disabled={!blobOn || Boolean(busy)}
          onClick={async () => {
            const urls = await pick("image/*", "produtos", true);
            if (urls.length) setDraft((current) => (current ? { ...current, [side]: [...current[side], ...urls.map((src) => ({ src, label: "" }))] } : current));
          }}
          className="w-fit px-3 py-2 text-sm font-bold ring-1 ring-black disabled:opacity-40"
        >
          Carregar pormenores
        </button>
      </div>
    );
  }

  function photo(key: "front" | "back", title: string) {
    if (!draft) return null;
    return (
      <div className="grid gap-1">
        <p className="text-sm font-bold">{title}</p>
        {draft[key] ? <img src={draft[key]} alt="" className="h-32 w-28 rounded object-contain ring-1 ring-black/20" /> : <div className="grid h-32 w-28 place-items-center rounded text-xs ring-1 ring-black/20">Sem foto</div>}
        <button
          type="button"
          disabled={!blobOn || Boolean(busy)}
          onClick={async () => {
            const [url] = await pick("image/*", "produtos");
            if (url) setDraft((current) => (current ? { ...current, [key]: url } : current));
          }}
          className="w-fit px-3 py-2 text-sm font-bold ring-1 ring-black disabled:opacity-40"
        >
          {draft[key] ? "Trocar foto" : "Carregar foto"}
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-4" data-desk-products>
      <section className="grid gap-2 bg-white p-3 text-black">
        <h2 className="font-bold">Câmbio</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm">
            Câmbio (Kz por 1 €)
            <input inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} aria-label="Câmbio (Kz por 1 €)" className="w-40 border border-black px-2 py-2 text-sm" />
          </label>
          <button type="button" onClick={saveRate} className="bg-black px-3 py-2 font-bold text-white">Guardar</button>
        </div>
        <p className="text-xs text-black/60">Em vigor: 1 € = {formatAmount(savedRate, "AO")}. Os itens sem preço fixo em Kz são recalculados de imediato na loja (preço € × câmbio).</p>
      </section>

      {draft ? (
        <section className="grid gap-3 bg-white p-3 text-black" data-product-editor>
          <h2 className="font-bold">{draft.id ? `Editar · ${draft.name.pt}` : "Novo item"}</h2>
          <label className="grid gap-1 text-sm">
            Nome do item
            <input value={draft.name.pt} onChange={(event) => setDraft({ ...draft, name: { ...draft.name, pt: event.target.value } })} aria-label="Nome do item" className={field} />
          </label>
          <label className="grid gap-1 text-sm">
            Descrição curta (aparece no cartão da loja)
            <textarea value={draft.blurb.pt} onChange={(event) => setDraft({ ...draft, blurb: { ...draft.blurb, pt: event.target.value } })} rows={2} aria-label="Descrição curta" className={field} />
          </label>
          <label className="grid gap-1 text-sm">
            Material e pormenores (aparece na página do item)
            <textarea value={draft.material.pt} onChange={(event) => setDraft({ ...draft, material: { ...draft.material, pt: event.target.value } })} rows={2} aria-label="Material" className={field} />
          </label>
          <details className="text-sm">
            <summary className="cursor-pointer font-bold">Traduções (inglês e francês, opcional)</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(["en", "fr"] as const).map((lang) => (
                <div key={lang} className="grid gap-1">
                  <input value={draft.name[lang]} onChange={(event) => setDraft({ ...draft, name: { ...draft.name, [lang]: event.target.value } })} placeholder={lang === "en" ? "Nome em inglês" : "Nome em francês"} aria-label={lang === "en" ? "Nome em inglês" : "Nome em francês"} className={field} />
                  <textarea value={draft.blurb[lang]} onChange={(event) => setDraft({ ...draft, blurb: { ...draft.blurb, [lang]: event.target.value } })} rows={2} placeholder={lang === "en" ? "Descrição em inglês" : "Descrição em francês"} className={field} />
                  <textarea value={draft.material[lang]} onChange={(event) => setDraft({ ...draft, material: { ...draft.material, [lang]: event.target.value } })} rows={2} placeholder={lang === "en" ? "Material em inglês" : "Material em francês"} className={field} />
                </div>
              ))}
            </div>
            <p className="mt-1 text-xs text-black/60">Se ficar vazio, usa o texto em português.</p>
          </details>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              Preço (€)
              <input inputMode="decimal" value={draft.priceEur} onChange={(event) => setDraft({ ...draft, priceEur: event.target.value })} aria-label="Preço em euros" className={field} />
            </label>
            <label className="grid gap-1 text-sm">
              Preço fixo em Kz (vazio = pelo câmbio)
              <input inputMode="numeric" value={draft.priceKz} onChange={(event) => setDraft({ ...draft, priceKz: event.target.value })} placeholder={eur > 0 ? `${formatAmount(kzFromEur(eur), "AO")} pelo câmbio` : ""} aria-label="Preço fixo em Kz" className={field} />
            </label>
          </div>
          <div className="flex flex-wrap gap-4">
            {photo("front", "Foto da frente")}
            {photo("back", "Foto das costas")}
          </div>
          {shotsEditor("detailsFront", "Janelas de pormenores · Frente")}
          {shotsEditor("detailsBack", "Janelas de pormenores · Costas")}
          <div className="grid gap-1">
            <p className="text-sm font-bold">Vídeo (opcional, aparece na página do item)</p>
            {draft.video ? <video src={draft.video} className="h-40 w-fit rounded ring-1 ring-black/20" muted playsInline controls /> : null}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!blobOn || Boolean(busy)}
                onClick={async () => {
                  const [url] = await pick("video/mp4,video/webm,video/quicktime", "videos");
                  if (url) setDraft((current) => (current ? { ...current, video: url } : current));
                }}
                className="w-fit px-3 py-2 text-sm font-bold ring-1 ring-black disabled:opacity-40"
              >
                {draft.video ? "Trocar vídeo" : "Carregar vídeo"}
              </button>
              {draft.video ? <button type="button" onClick={() => setDraft({ ...draft, video: "" })} className="px-3 py-2 text-sm ring-1 ring-black">Retirar vídeo</button> : null}
            </div>
          </div>
          {draft.id ? null : (
            <label className="grid gap-1 text-sm">
              Stock inicial por tamanho ({SIZES.join(", ")})
              <input inputMode="numeric" value={draft.stock} onChange={(event) => setDraft({ ...draft, stock: event.target.value })} aria-label="Stock inicial por tamanho" className="w-24 border border-black px-2 py-2 text-sm" />
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />
            Ativo (visível na Loja)
          </label>
          {busy ? <p className="text-sm font-bold">{busy}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={Boolean(busy)} className="bg-black px-4 py-2 font-bold text-white disabled:opacity-40">Guardar</button>
            <button type="button" onClick={() => setDraft(null)} className="px-4 py-2 font-bold ring-1 ring-black">Cancelar</button>
            {draft.id && draft.custom ? <button type="button" onClick={remove} className="ml-auto px-4 py-2 font-bold text-red-700 ring-1 ring-red-700">Apagar item</button> : null}
          </div>
        </section>
      ) : (
        <section className="grid gap-2 bg-white p-3 text-black">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold">Itens da Loja</h2>
            <button type="button" onClick={() => setDraft(toDraft())} className="bg-black px-3 py-2 text-sm font-bold text-white">Novo item</button>
          </div>
          {items.map((item, index) => (
            <div key={item.id} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-2 border-t border-black/10 pt-2" data-product-row={item.id}>
              <img src={item.images[0]} alt="" className="size-14 rounded object-contain ring-1 ring-black/10" />
              <div className="min-w-0 text-sm">
                <p className="truncate font-bold">{item.name.pt}{item.active === false ? " · inativo" : ""}</p>
                <p>
                  {formatAmount(item.priceEur, "PT")} · {formatAmount(item.priceKz ?? kzFromEur(item.priceEur), "AO")}
                  <span className="text-black/60">{item.priceKz == null ? " (câmbio)" : " (fixo)"}</span>
                </p>
              </div>
              <div className="flex gap-1">
                <button type="button" aria-label="Subir" disabled={index === 0} onClick={() => move(item.id, -1)} className="px-2 py-1 ring-1 ring-black disabled:opacity-30">↑</button>
                <button type="button" aria-label="Descer" disabled={index === items.length - 1} onClick={() => move(item.id, 1)} className="px-2 py-1 ring-1 ring-black disabled:opacity-30">↓</button>
                <button type="button" onClick={() => setDraft(toDraft(item))} className="bg-black px-3 py-1 text-sm font-bold text-white">Editar</button>
              </div>
            </div>
          ))}
        </section>
      )}
      {note ? <p className="text-sm text-white/80" data-products-note>{note}</p> : null}
    </div>
  );
}
