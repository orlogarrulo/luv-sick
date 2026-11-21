import { useEffect, useSyncExternalStore } from "react";
import { getCatalogVersion, setCatalog, subscribeCatalog, type Catalog } from "@/lib/luvsick";
import { luvCatalog } from "@/server/fns";

let inflight: Promise<void> | null = null;

/** Vai buscar o catálogo (produtos, preços e câmbio) à BD e atualiza a loja na hora. */
export function refreshCatalog() {
  inflight ??= luvCatalog()
    .then((next) => {
      setCatalog(next as Catalog | null);
    })
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Catálogo dinâmico na loja/gestão/recibo: usa os dados do loader (SSR) já no primeiro render e
 * volta a ler a BD ao abrir, ao voltar ao separador e a cada 30 s — alterações da gestão aparecem sem redeploy.
 */
export function useCatalog(initial?: Catalog | null) {
  if (initial) setCatalog(initial, true);
  const version = useSyncExternalStore(subscribeCatalog, getCatalogVersion, getCatalogVersion);
  useEffect(() => {
    void refreshCatalog();
    const onShow = () => {
      if (document.visibilityState === "visible") void refreshCatalog();
    };
    const timer = window.setInterval(onShow, 30000);
    window.addEventListener("focus", onShow);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onShow);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);
  return version;
}
