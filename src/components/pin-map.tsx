import { useMemo, useRef, useState } from "react";
import { STORE } from "@/lib/pricing";
import { useI18n } from "@/lib/i18n";

const TILE = 256;

function projectAt(lat: number, lng: number, zoom: number) {
  const n = 2 ** zoom;
  const x = ((lng + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return { x, y, n };
}

function unproject(x: number, y: number, n: number) {
  const lng = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lat, lng };
}

function fitZoom(points: { lat: number; lng: number }[]) {
  for (let zoom = 16; zoom >= 11; zoom -= 1) {
    const placed = points.map((point) => projectAt(point.lat, point.lng, zoom));
    const xs = placed.map((point) => point.x);
    const ys = placed.map((point) => point.y);
    const dx = (Math.max(...xs) - Math.min(...xs)) * TILE;
    const dy = (Math.max(...ys) - Math.min(...ys)) * TILE;
    if (dx <= 260 && dy <= 200) return zoom;
  }
  return 11;
}

export function PinMap({
  lat,
  lng,
  onChange,
  readOnly = false,
  courier,
}: {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
  readOnly?: boolean;
  courier?: { lat: number; lng: number } | null;
}) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ x: number; y: number; lat: number; lng: number; zoom: number } | null>(null);
  const points = [
    { lat, lng },
    STORE,
    ...(courier ? [courier] : []),
  ];
  const zoom = fitZoom(points);
  const placed = points.map((point) => projectAt(point.lat, point.lng, zoom));
  const cx = placed.reduce((sum, point) => sum + point.x, 0) / placed.length;
  const cy = placed.reduce((sum, point) => sum + point.y, 0) / placed.length;
  const tiles = useMemo(() => {
    const list: { x: number; y: number }[] = [];
    const tx = Math.floor(cx);
    const ty = Math.floor(cy);
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dy = -2; dy <= 2; dy += 1) list.push({ x: tx + dx, y: ty + dy });
    }
    return list;
  }, [cx, cy]);

  const spot = (pointLat: number, pointLng: number) => {
    const p = projectAt(pointLat, pointLng, zoom);
    return {
      left: `calc(50% + ${(p.x - cx) * TILE}px)`,
      top: `calc(50% + ${(p.y - cy) * TILE}px)`,
    };
  };

  return (
    <div
      className="relative h-[58vh] min-h-80 max-h-[560px] overflow-hidden rounded-lg border border-line bg-blue-soft"
      onPointerDown={(event) => {
        if (readOnly) return;
        (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY, lat, lng, zoom };
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const start = projectAt(drag.current.lat, drag.current.lng, drag.current.zoom);
        const dx = event.clientX - drag.current.x;
        const dy = event.clientY - drag.current.y;
        const next = unproject(start.x - dx / TILE, start.y - dy / TILE, start.n);
        onChange(next.lat, next.lng);
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      style={{ touchAction: "none" }}
    >
      {tiles.map((tile) => (
        <img
          key={`${zoom}-${tile.x}-${tile.y}`}
          alt=""
          draggable={false}
          className="absolute max-w-none"
          style={{
            width: TILE,
            height: TILE,
            left: `calc(50% + ${(tile.x - cx) * TILE}px)`,
            top: `calc(50% + ${(tile.y - cy) * TILE}px)`,
          }}
          src={`https://basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${tile.x}/${tile.y}.png`}
          onError={() => setFailed(true)}
        />
      ))}
      <span className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full" style={spot(STORE.lat, STORE.lng)}>
        <span className="mb-1 block rounded-full bg-gold px-2 py-0.5 text-center text-[10px] font-semibold text-on-gold">{t("mapStore")}</span>
        <span className="mx-auto block size-4 rounded-full border-2 border-card bg-gold" />
      </span>
      <span className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full" style={spot(lat, lng)}>
        <span className="mb-1 block rounded-full bg-green px-2 py-0.5 text-center text-[10px] font-semibold text-on-green">{t("mapYou")}</span>
        <span className="mx-auto block size-5 rounded-full border-2 border-card bg-green" />
      </span>
      {courier ? (
        <span className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full" style={spot(courier.lat, courier.lng)}>
          <span className="mb-1 block rounded-full bg-blue px-2 py-0.5 text-center text-[10px] font-semibold text-on-blue">{t("mapCourier")}</span>
          <span className="mx-auto block size-4 rounded-full border-2 border-card bg-blue" />
        </span>
      ) : null}
      {failed ? (
        <p className="absolute inset-x-3 bottom-3 z-10 rounded-md bg-card/95 px-3 py-2 text-sm text-ink">
          Mapa indisponível neste momento.
        </p>
      ) : (
        <p className="pointer-events-none absolute bottom-1 right-2 z-10 text-[10px] text-ink/70">© OpenStreetMap © CARTO</p>
      )}
    </div>
  );
}
