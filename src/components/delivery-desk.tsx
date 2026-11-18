import { useEffect, useMemo, useRef, useState } from "react";
import { PROGRESS_STATES, STATUS_LABEL, STORE_POINT, type DeliveryEstado, type DeskData, type DetailData, type ReconcileRow, type ReportData } from "@/lib/delivery/types";
import { formatKz } from "@/lib/pricing";
import type { StaffRole } from "@/lib/shop-types";
import {
  cancelDelivery,
  deliveryDesk,
  deliveryDetail,
  deliveryReport,
  dispatchDelivery,
  pingDeliveryProvider,
  reconcileDeliveries,
  requestDeliveryQuotes,
  saveDeliverySettings,
  sendTestWebhook,
  setDeliveryStatus,
  toggleDeliveryProvider,
  updateDeliveryZone,
} from "@/server/fns";

const STAFF_KEY = "ct-staff";

function token() {
  return localStorage.getItem(STAFF_KEY) ?? "";
}

function money(value: number | null) {
  if (value == null) return "—";
  return formatKz(value, "pt");
}

export function DeliveriesDesk({ role }: { role: StaffRole }) {
  const [desk, setDesk] = useState<DeskData | null>(null);
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [estado, setEstado] = useState("all");
  const [provider, setProvider] = useState("all");
  const [zone, setZone] = useState("all");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pin, setPin] = useState("");
  const [manual, setManual] = useState("a_caminho_do_cliente");
  const selected = useRef<string | undefined>(undefined);
  const readOnly = role === "finance";

  async function load() {
    try {
      const res = await deliveryDesk({ data: { token: token() } });
      if (!res.ok) {
        setError("O seu papel não permite ver as entregas.");
        return;
      }
      setError("");
      setDesk(res.desk);
      const id = selected.current;
      if (id) {
        const next = await deliveryDetail({ data: { token: token(), orderId: id } });
        if (next.ok) setDetail(next.detail);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar as entregas.");
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(timer);
  }, []);

  const rows = useMemo(() => {
    if (!desk) return [];
    return desk.deliveries.filter((row) => {
      if (estado !== "all" && row.estado !== estado) return false;
      if (provider !== "all" && row.providerId !== provider) return false;
      if (zone !== "all" && row.zoneId !== zone) return false;
      return true;
    });
  }, [desk, estado, provider, zone]);

  const active = rows.filter((row) => !["entregue", "cancelado", "falhou", "devolvido_a_loja"].includes(row.estado) && row.attempt > 0);

  if (!desk) return <p>{error || "A preparar as entregas…"}</p>;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <select value={estado} onChange={(e) => setEstado(e.target.value)} className="rounded-full border border-line bg-card px-3 py-2 text-sm" aria-label="Estado">
          <option value="all">Todos os estados</option>
          {Object.entries(STATUS_LABEL).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <select value={provider} onChange={(e) => setProvider(e.target.value)} className="rounded-full border border-line bg-card px-3 py-2 text-sm" aria-label="Transportadora">
          <option value="all">Todas as transportadoras</option>
          {desk.providers.map((item) => (
            <option key={item.id} value={item.id}>{item.nome}</option>
          ))}
        </select>
        <select value={zone} onChange={(e) => setZone(e.target.value)} className="rounded-full border border-line bg-card px-3 py-2 text-sm" aria-label="Zona">
          <option value="all">Todas as zonas</option>
          {desk.zones.map((item) => (
            <option key={item.id} value={item.id}>{item.nome}</option>
          ))}
        </select>
      </div>
      <FleetMap points={active.map((row) => ({ lat: row.customerLat, lng: row.customerLng, courierLat: row.courierLat, courierLng: row.courierLng }))} />
      {rows.length === 0 ? (
        <p className="rounded-lg border border-line bg-card p-4 text-sm">Quando uma encomenda for confirmada na loja, aparece aqui para pedir cotações e despachar num clique — frota própria, Yango em sandbox ou manual.</p>
      ) : (
        <ul className="grid gap-2">
          {rows.map((row) => (
            <li key={row.orderId}>
              <button type="button" onClick={() => { selected.current = row.orderId; void deliveryDetail({ data: { token: token(), orderId: row.orderId } }).then((res) => res.ok && setDetail(res.detail)); }} className="grid w-full gap-1 rounded-lg border border-line bg-card p-3 text-left">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">CT-{row.number}</span>
                  <span className="text-sm">{STATUS_LABEL[row.estado as DeliveryEstado] ?? row.estado}</span>
                </span>
                <span className="text-sm text-muted">{row.zoneName ?? "Zona geral"} · {row.providerName ?? "por despachar"} · {row.addressLabel}</span>
                <span className="text-sm tabular-nums">Taxa {money(row.feeKz)} · custo {money(row.costKz)} · margem {money(row.marginKz)}</span>
                {row.fallback ? <span className="text-sm font-semibold text-danger">Sem estafeta dentro do tempo. Pode reatribuir.</span> : null}
                {row.degraded ? <span className="text-sm text-danger">Modo manual: nenhuma API respondeu.</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {detail ? (
        <section className="grid gap-3 rounded-lg border border-line bg-card p-4">
          <h2 className="text-2xl">CT-{detail.item.number}</h2>
          <p className="text-sm text-muted">{detail.item.externalId ? `Id externo ${detail.item.externalId}` : "Ainda sem id externo"} · tentativa {detail.item.attempt || 0}</p>
          {detail.item.fallback ? <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">O estafeta não foi atribuído a tempo. Escolha outra transportadora ou a frota própria.</p> : null}
          <div className="grid gap-2 sm:grid-cols-3">
            <p className="text-sm">Taxa ao cliente<br /><strong className="tabular-nums">{money(detail.item.feeKz)}</strong></p>
            <p className="text-sm">Custo real<br /><strong className="tabular-nums">{money(detail.item.costKz)}</strong></p>
            <p className="text-sm">Margem<br /><strong className={`tabular-nums ${detail.item.marginKz != null && detail.item.marginKz < 0 ? "text-danger" : ""}`}>{money(detail.item.marginKz)}</strong></p>
          </div>
          {detail.item.codKz ? <p className="text-sm">A cobrar na entrega: {money(detail.item.codKz)}. A Yango não aceita numerário — só entra se a transportadora o suportar.</p> : null}
          {detail.item.pin ? <p className="text-sm">PIN de entrega: <span className="font-semibold tabular-nums">{detail.item.pin}</span></p> : null}
          {!readOnly && detail.item.attempt === 0 ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-full bg-blue px-4 py-2 text-sm font-semibold text-on-blue" onClick={async () => { setError(""); await requestDeliveryQuotes({ data: { token: token(), orderId: detail.item.orderId } }); await load(); }}>Pedir cotações</button>
              <button type="button" className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-on-gold" onClick={async () => { const res = await dispatchDelivery({ data: { token: token(), orderId: detail.item.orderId, providerId: "auto" } }); setError(res.ok ? "" : message(res.error)); await load(); }}>Despachar pela regra</button>
            </div>
          ) : null}
          {detail.quotes.length > 0 ? (
            <ul className="grid gap-2 sm:grid-cols-3">
              {detail.quotes.map((quote) => (
                <li key={quote.id} className="rounded-md border border-line p-3 text-sm">
                  <p className="font-semibold">{quote.providerName}</p>
                  {quote.error ? <p className="text-danger">{quote.error === "cod" ? "Não cobra numerário. Só com pagamento antecipado." : quote.error}</p> : <p className="tabular-nums">{money(quote.priceKz)} · {quote.etaMin} min</p>}
                  {!readOnly && !quote.error && detail.item.attempt === 0 ? (
                    <button type="button" className="mt-2 font-semibold text-blue" onClick={async () => { const res = await dispatchDelivery({ data: { token: token(), orderId: detail.item.orderId, providerId: quote.providerId } }); setError(res.ok ? "" : message(res.error)); await load(); }}>Despachar</button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {!readOnly && detail.item.attempt > 0 && !["entregue", "cancelado"].includes(detail.item.estado) ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                Estado manual
                <select value={manual} onChange={(e) => setManual(e.target.value)} className="rounded-md border border-line bg-paper px-3 py-2">
                  {PROGRESS_STATES.filter((state) => state !== "pendente").map((state) => (
                    <option key={state} value={state}>{STATUS_LABEL[state]}</option>
                  ))}
                  <option value="falhou">Falhou</option>
                  <option value="devolvido_a_loja">Devolvido à loja</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                PIN para marcar entregue
                <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" className="rounded-md border border-line bg-paper px-3 py-2" />
              </label>
              <button type="button" className="rounded-full bg-blue px-4 py-2 text-sm font-semibold text-on-blue" onClick={async () => { const res = await setDeliveryStatus({ data: { token: token(), orderId: detail.item.orderId, estado: manual, pin } }); setError(res.ok ? "" : message(res.error)); await load(); }}>Actualizar estado</button>
              <button type="button" className="rounded-full border border-line px-4 py-2 text-sm font-semibold" onClick={async () => { const res = await cancelDelivery({ data: { token: token(), orderId: detail.item.orderId, motivo: note || "Reatribuir" } }); setError(res.ok ? "" : message(res.error)); await load(); }}>Cancelar para reatribuir</button>
            </div>
          ) : null}
          {!readOnly && detail.item.attempt > 0 && ["cancelado", "falhou"].includes(detail.item.estado) ? (
            <button type="button" className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-on-gold" onClick={async () => { await requestDeliveryQuotes({ data: { token: token(), orderId: detail.item.orderId } }); const res = await dispatchDelivery({ data: { token: token(), orderId: detail.item.orderId, providerId: "internal" } }); setError(res.ok ? "" : message(res.error)); await load(); }}>Reatribuir à frota própria</button>
          ) : null}
          {detail.item.providerId === "yango" && !readOnly ? (
            <button type="button" className="text-left text-sm font-semibold text-blue" onClick={async () => { const res = await sendTestWebhook({ data: { token: token(), orderId: detail.item.orderId, status: "performer_found" } }); setError(res.ok ? "" : message(res.error)); await load(); }}>Simular webhook assinado da Yango</button>
          ) : null}
          <label className="grid gap-1 text-sm">
            Motivo de cancelamento
            <input value={note} onChange={(e) => setNote(e.target.value)} className="rounded-md border border-line bg-paper px-3 py-2" />
          </label>
          <ol className="grid gap-1 text-sm">
            {detail.events.map((event) => (
              <li key={event.id} className="rounded-md bg-paper px-3 py-2">{STATUS_LABEL[event.estado as DeliveryEstado] ?? event.estado} · {event.origem} · {event.at.slice(0, 16).replace("T", " ")}</li>
            ))}
          </ol>
          {detail.messages.length > 0 ? (
            <ul className="grid gap-1 text-sm">
              {detail.messages.map((msg) => (
                <li key={msg.kind} className="rounded-md bg-green-soft px-3 py-2">WhatsApp para {msg.toMasked}: {msg.body}</li>
              ))}
            </ul>
          ) : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </section>
      ) : null}
    </div>
  );
}

function message(code: string) {
  if (code === "forbidden") return "O seu papel não permite esta acção.";
  if (code === "duplicate" || code === "active") return "Esta encomenda já tem uma entrega activa.";
  if (code === "cod") return "Esta transportadora não cobra numerário. Use pagamento antecipado ou a frota própria.";
  if (code === "pin") return "O PIN não confere.";
  if (code === "quote") return "Não há cotação válida para essa transportadora.";
  if (code === "disabled") return "Transportadora desligada.";
  return code;
}

export function CarriersDesk() {
  const [desk, setDesk] = useState<DeskData | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const res = await deliveryDesk({ data: { token: token() } });
    if (res.ok) setDesk(res.desk);
    else setError("Só a administração altera transportadoras.");
  }
  useEffect(() => { void load(); }, []);
  if (!desk) return <p>{error || "A preparar…"}</p>;
  const settings = desk.settings;
  return (
    <div className="grid gap-4">
      <p className="text-sm">Desligar uma transportadora tem efeito na cotação seguinte, sem novo deploy. A chave da Yango, se existir, fica só no servidor — aqui vê-se apenas se está configurada.</p>
      <form
        className="grid gap-3 rounded-lg border border-line bg-card p-4 sm:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const res = await saveDeliverySettings({
            data: {
              token: token(),
              mode: String(data.get("mode")) === "auto" ? "auto" : "manual",
              rule: (String(data.get("rule")) as "cheapest" | "fastest" | "preferred") || "cheapest",
              preferredProvider: String(data.get("preferred") || "") || null,
              priceCapKz: data.get("cap") ? Number(data.get("cap")) : null,
              fallbackMin: Number(data.get("fallback") || 1),
              showCarrier: data.get("show") === "on",
            },
          });
          setError(res.ok ? "Regra guardada." : "Só a administração altera a regra.");
          await load();
        }}
      >
        <label className="grid gap-1 text-sm font-semibold">Modo
          <select name="mode" defaultValue={settings.mode} className="rounded-md border border-line bg-paper px-3 py-2 font-normal">
            <option value="manual">Manual — o operador escolhe</option>
            <option value="auto">Automático ao confirmar</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">Regra
          <select name="rule" defaultValue={settings.rule} className="rounded-md border border-line bg-paper px-3 py-2 font-normal">
            <option value="cheapest">Mais barata</option>
            <option value="fastest">Mais rápida</option>
            <option value="preferred">Preferida, com tecto</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">Preferida
          <select name="preferred" defaultValue={settings.preferredProvider ?? "internal"} className="rounded-md border border-line bg-paper px-3 py-2 font-normal">
            {desk.providers.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">Tecto de preço (Kz)
          <input name="cap" defaultValue={settings.priceCapKz ?? ""} inputMode="numeric" className="rounded-md border border-line bg-paper px-3 py-2 font-normal" />
        </label>
        <label className="grid gap-1 text-sm font-semibold">Minutos até avisar (fallback)
          <input name="fallback" defaultValue={settings.fallbackMin} inputMode="numeric" className="rounded-md border border-line bg-paper px-3 py-2 font-normal" />
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" name="show" value="on" defaultChecked={settings.showCarrier} />
          Mostrar o nome da transportadora ao cliente
        </label>
        <button className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-on-gold sm:col-span-2">Guardar regra</button>
        {error ? <p className="text-sm sm:col-span-2">{error}</p> : null}
        <p className="text-sm text-muted sm:col-span-2">Nesta demonstração o aviso de fallback começa em {settings.fallbackMin} min, para se poder testar. Em operação o habitual é 10.</p>
      </form>
      <ul className="grid gap-3">
        {desk.providers.map((item) => (
          <li key={item.id} className="rounded-lg border border-line bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-sans text-lg font-semibold">{item.nome}</h2>
              <button type="button" className={`rounded-full px-3 py-2 text-sm font-semibold ${item.ativo ? "bg-green text-on-green" : "bg-card ring-1 ring-line"}`} onClick={async () => { await toggleDeliveryProvider({ data: { token: token(), providerId: item.id, ativo: !item.ativo } }); await load(); }}>{item.ativo ? "Ligada" : "Desligada"}</button>
            </div>
            <p className="mt-2 text-sm text-muted">{item.note || "Sem notas."}</p>
            <p className="mt-1 text-sm">Ligação: {item.lastError ? `último erro — ${item.lastError}` : item.lastOkAt ? `último sucesso ${item.lastOkAt.slice(0, 16).replace("T", " ")}` : "ainda sem teste"}{item.tipo === "yango" ? ` · API ${item.apiConfigured ? "configurada no servidor" : "não configurada (sandbox)"}` : ""}</p>
            <button type="button" className="mt-2 text-sm font-semibold text-blue" onClick={async () => { const res = await pingDeliveryProvider({ data: { token: token(), providerId: item.id } }); setError(res.ok ? `${item.nome}: ${res.detail}` : message(res.error)); await load(); }}>Testar ligação</button>
          </li>
        ))}
      </ul>
      <h2 className="text-2xl">Zonas</h2>
      <ul className="grid gap-3">
        {desk.zones.map((zone) => (
          <li key={zone.id}>
            <form className="grid gap-2 rounded-lg border border-line bg-card p-4 sm:grid-cols-4" onSubmit={async (event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const providers = ["internal", "yango", "manual"].filter((id) => data.get(id) === "on");
              await updateDeliveryZone({ data: { token: token(), zoneId: zone.id, feeKz: Number(data.get("fee")), freeAboveKz: data.get("free") ? Number(data.get("free")) : null, providers } });
              await load();
            }}>
              <p className="font-semibold sm:col-span-4">{zone.nome}</p>
              <label className="text-sm">Taxa (Kz)<input name="fee" defaultValue={zone.feeKz} className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2" /></label>
              <label className="text-sm">Grátis acima<input name="free" defaultValue={zone.freeAboveKz ?? ""} className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2" /></label>
              <div className="flex flex-wrap items-center gap-3 text-sm sm:col-span-2">
                {["internal", "yango", "manual"].map((id) => (
                  <label key={id} className="flex items-center gap-1"><input type="checkbox" name={id} value="on" defaultChecked={zone.providers.includes(id)} />{id}</label>
                ))}
                <button className="rounded-full bg-blue px-3 py-2 font-semibold text-on-blue">Guardar zona</button>
              </div>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DeliveryReportDesk() {
  const [report, setReport] = useState<ReportData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    deliveryReport({ data: { token: token() } }).then((res) => {
      if (res.ok) setReport(res.report);
      else setError("O relatório de entregas é para administração e finanças.");
    });
  }, []);
  if (!report) return <p>{error || "A preparar o relatório…"}</p>;
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Entregues" value={String(report.delivered)} />
        <Stat label="Activas" value={String(report.active)} />
        <Stat label="Reclamações (1–2)" value={String(report.complaints)} />
      </div>
      <Table title="Por transportadora" headers={["Nome", "Entregas", "Sucesso", "Custo médio", "Minutos"]} rows={report.byProvider.map((row) => [row.nome, String(row.count), `${row.successPct}%`, money(row.avgCost), row.avgMin == null ? "—" : String(row.avgMin)])} />
      <Table title="Por zona" headers={["Zona", "Entregas", "Custo médio", "Taxa média", "Reclamações"]} rows={report.byZone.map((row) => [row.nome, String(row.count), money(row.avgCost), money(row.avgFee), String(row.complaints)])} />
      <Table title="Por dia" headers={["Dia", "Entregas"]} rows={report.byDay.map((row) => [row.day, String(row.count)])} />
      {report.byProvider.length === 0 ? <p className="text-sm text-muted">Ainda não há entregas despachadas. Os números aparecem com encomendas reais desta loja.</p> : null}
    </div>
  );
}

export function ReconcileDesk() {
  const [csv, setCsv] = useState("external_id,custo\n");
  const [rows, setRows] = useState<ReconcileRow[] | null>(null);
  const [error, setError] = useState("");
  return (
    <form className="grid gap-3" onSubmit={async (event) => {
      event.preventDefault();
      const res = await reconcileDeliveries({ data: { token: token(), csv } });
      if (!res.ok) setError(res.error === "csv" ? "Não encontrei linhas com id e custo." : "Só administração e finanças reconciliam.");
      else { setError(""); setRows(res.rows); }
    }}>
      <p className="text-sm">Cole o CSV da factura da plataforma: id externo e custo em Kz. Comparamos com o que ficou registado no despacho. A diferença é a margem que a factura não explica.</p>
      <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={6} className="rounded-lg border border-line bg-card p-3 font-mono text-sm" />
      <button className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-on-gold">Comparar</button>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {rows ? (
        <Table title="Diferenças" headers={["Id externo", "Facturado", "Registado", "Diferença", "Transportadora"]} rows={rows.map((row) => [row.externalId, money(row.billedKz), money(row.recordedKz), money(row.deltaKz), row.providerId ?? "não encontrado"])} />
      ) : null}
    </form>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="font-display text-3xl tabular-nums">{value}</p>
    </div>
  );
}

function Table({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <caption className="bg-card px-3 py-2 text-left font-semibold">{title}</caption>
        <thead className="bg-blue-soft text-ink">
          <tr>{headers.map((header) => <th key={header} className="px-3 py-2 font-semibold">{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join("|")} className="border-t border-line bg-card">
              {row.map((cell, index) => <td key={`${cell}-${index}`} className="px-3 py-2 tabular-nums">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FleetMap({ points }: { points: { lat: number; lng: number; courierLat: number | null; courierLng: number | null }[] }) {
  const zoom = 12;
  const tile = 256;
  const project = (lat: number, lng: number) => {
    const n = 2 ** zoom;
    const x = ((lng + 180) / 360) * n;
    const s = Math.sin((lat * Math.PI) / 180);
    const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
    return { x, y };
  };
  const center = project(STORE_POINT.lat, STORE_POINT.lng);
  const tiles: { x: number; y: number }[] = [];
  const cx = Math.floor(center.x);
  const cy = Math.floor(center.y);
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) tiles.push({ x: cx + dx, y: cy + dy });
  }
  const dot = (lat: number, lng: number) => {
    const p = project(lat, lng);
    return { left: `calc(50% + ${(p.x - center.x) * tile}px)`, top: `calc(50% + ${(p.y - center.y) * tile}px)` };
  };
  return (
    <div className="relative h-56 overflow-hidden rounded-lg border border-line bg-blue-soft">
      {tiles.map((item) => (
        <img key={`${item.x}-${item.y}`} alt="" className="absolute max-w-none" draggable={false} style={{ width: tile, height: tile, left: `calc(50% + ${(item.x - center.x) * tile}px)`, top: `calc(50% + ${(item.y - center.y) * tile}px)` }} src={`https://tile.openstreetmap.org/${zoom}/${item.x}/${item.y}.png`} />
      ))}
      <span className="absolute z-10 -translate-x-1/2 -translate-y-full text-center" style={dot(STORE_POINT.lat, STORE_POINT.lng)}>
        <span className="mb-0.5 block rounded-full bg-gold px-1.5 text-[10px] font-semibold text-on-gold">Loja</span>
        <span className="mx-auto block size-3 rounded-full bg-gold ring-2 ring-card" />
      </span>
      {points.map((point, index) => (
        <span key={`d-${index}`} className="absolute z-10 -translate-x-1/2 -translate-y-full text-center" style={dot(point.lat, point.lng)}>
          <span className="mb-0.5 block rounded-full bg-green px-1.5 text-[10px] font-semibold text-on-green">Cliente</span>
          <span className="mx-auto block size-3 rounded-full bg-green ring-2 ring-card" />
        </span>
      ))}
      {points.map((point, index) => point.courierLat != null && point.courierLng != null ? (
        <span key={`c-${index}`} className="absolute z-10 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue ring-2 ring-card" style={dot(point.courierLat, point.courierLng)} />
      ) : null)}
    </div>
  );
}
