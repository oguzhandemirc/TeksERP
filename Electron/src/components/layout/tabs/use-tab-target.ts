import type { MouseEvent } from "react";
import { useTabsStore } from "@/store/tabs";
import { getTabOpenMode, type TabOpenMode } from "./tab-open-mode";

interface ClickLike {
  button?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/** Hedefin türü: üst düzey (menü öğesi, komut paleti, İz sür) ya da sayfa içi adım (satır → detay, hub kartı). */
export type TabOpenScope = "topLevel" | "inPage";

export type TabOpenAction =
  | { kind: "focusOrOpen" }
  | { kind: "inPlace" }
  | { kind: "newTab"; background: boolean }
  | { kind: "none" };

/**
 * TIKLAMA → SEKME KARARININ TEK YERİ. Bilinçli yeni-sekme eylemleri (sekme çubuğu +,
 * "Yeni sekmede aç" menü maddesi, kısayollar) buradan GEÇMEZ; tercihten etkilenmez.
 *  - newTab (varsayılan, bugünkü): shift/ctrl/cmd/orta/sağ tık → yeni sekme (orta/sağ arka planda);
 *    sol tık → üst düzeyde odakla-ya-da-yeni-sekme, sayfa içinde yerinde.
 *  - sameTab: sol tık → her zaman aktif sekmede; shift/ctrl/cmd/orta tık → yeni sekme; sağ tık → hiçbir şey.
 */
export function decideTabOpen(
  scope: TabOpenScope,
  e?: ClickLike,
  mode: TabOpenMode = getTabOpenMode(),
): TabOpenAction {
  const rightClick = e?.button === 2;
  const explicit = Boolean(e && (e.shiftKey || e.ctrlKey || e.metaKey || e.button === 1));
  // Orta/sağ tık odaklanmadan arka planda açar: kullanıcı mevcut ekranda kalır, peş peşe
  // birden çok sekme açabilir. shift/ctrl/cmd ile sol tık kasıtlı "oraya götür" → ön plan.
  const background = e?.button === 1 || rightClick;
  if (mode === "sameTab") {
    if (rightClick) return { kind: "none" };
    return explicit ? { kind: "newTab", background } : { kind: "inPlace" };
  }
  if (explicit || rightClick) return { kind: "newTab", background };
  return scope === "topLevel" ? { kind: "focusOrOpen" } : { kind: "inPlace" };
}

interface TabActions {
  openTab: ReturnType<typeof useTabsStore.getState>["openTab"];
  navigateActive: ReturnType<typeof useTabsStore.getState>["navigateActive"];
}

// `stateArg` boş dizi = çağıran durum vermedi → `openTab(path)`; tek elemanlı = verdi. Çağrı
// biçimi tercih öncesiyle birebir kalsın diye (çağrı kaydı testleri iki biçimi de ölçer).
interface OpenRequest {
  path: string;
  e?: ClickLike;
  stateArg: [] | [unknown];
}

function runTabOpen(actions: TabActions, scope: TabOpenScope, req: OpenRequest): void {
  const { path, e, stateArg } = req;
  const state = stateArg[0];
  const action = decideTabOpen(scope, e);
  switch (action.kind) {
    case "focusOrOpen":
      if (stateArg.length === 0) actions.openTab(path);
      else actions.openTab(path, state !== undefined ? { state } : undefined);
      return;
    case "inPlace":
      actions.navigateActive(path, { state });
      return;
    case "newTab":
      actions.openTab(path, { forceNew: true, state, background: action.background });
      return;
    case "none":
      return;
  }
}

function useTabOpener(scope: TabOpenScope) {
  const openTab = useTabsStore((s) => s.openTab);
  const navigateActive = useTabsStore((s) => s.navigateActive);
  return (path: string, e?: ClickLike, ...stateArg: [] | [unknown]) =>
    runTabOpen({ openTab, navigateActive }, scope, { path, e, stateArg });
}

/** React bağlamı dışından (tembel yüklenen bağlantılar) aynı kararla açar. */
export function openTargetNow(
  scope: TabOpenScope,
  path: string,
  e?: ClickLike,
  ...stateArg: [] | [unknown]
): void {
  runTabOpen(useTabsStore.getState(), scope, { path, e, stateArg });
}

/** Sayfa içi hedef açıcı — kararı `decideTabOpen("inPage")` verir. */
export function useOpenTarget() {
  return useTabOpener("inPage");
}

/** Üst düzey hedef açıcı (komut paleti vb. olaysız seçimler) — `decideTabOpen("topLevel")`. */
export function useOpenTopLevel() {
  return useTabOpener("topLevel");
}

/**
 * ÜST DÜZEY HEDEF açıcı (menü öğesi, hub kartı) — "odakla ya da yeni sekme".
 *
 * 2026-08-17 saha bulgusu: sol tık eskiden hedefi AKTİF SEKMEDE açıyordu, yani
 * kenar menüsünden "Siparişler"e geçmek açık olan iş emri listesini o sekmeden
 * DÜŞÜRÜYORDU; geri dönüldüğünde sayfa sıfırdan yükleniyor, filtreler ve
 * kaydırma konumu kayboluyordu. Operatör bunu "sekmeler arası geçişte liste
 * baştan yükleniyor" diye tarif etti — çünkü menü öğelerini sekme sanıyordu.
 *
 * Doğrusu tarayıcı davranışı: menüden bir yere gitmek MEVCUT işi kapatmaz.
 * `openTab` yola göre tekilleştirir → sekme çoğalması menü öğesi sayısıyla
 * sınırlı, sonsuz değil. Sayfa İÇİ geçişler (satır → detay, iş emri → sipariş)
 * eskisi gibi yerinde kalır; onlar bir zincirin adımlarıdır, ayrı bir iş değil.
 * "Aynı sekmede aç" tercihinde menü de yerinde açar (`decideTabOpen`).
 */
export function useTabTarget(path: string) {
  const open = useOpenTopLevel();
  return {
    onClick: (e: MouseEvent) => open(path, e),
    onAuxClick: (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        open(path, e);
      }
    },
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      open(path, { button: 2 });
    },
  };
}

/**
 * HUB KARTI hedefi — "yerinde in, sağ tıkla yeni sekmede aç" (2026-08-22 kullanıcı
 * kararı).
 *
 * `useTabTarget` ile FARKI ve neden ikisi bir arada duruyor: kenar menüsü bir
 * BAŞKA İŞE geçiştir (2026-08-17 kararı — menüden Siparişler'e geçmek açık iş
 * emri listesini o sekmeden düşürmemeli), hub kartı ise AYNI İŞİN bir adımıdır:
 * Operasyon hub'ından Envanter'e inmek, listeden detaya inmekle aynı zincirdir.
 * Kart da sekme açınca iki şey birden bozuluyordu: (1) her tık yeni sekme →
 * şerit doluyor, (2) yeni sekmenin geçmişi TEK girişlik olduğu için geri oku
 * sekme geçmişi yerine breadcrumb yedeğine düşüyordu — kullanıcı bunu "geri
 * gitmiyor" diye görüyordu (yalnız hub'lı ekranlarda).
 *
 * Sözleşme: sol tık → AKTİF sekmede yerinde · shift/ctrl/cmd + sol tık ve orta
 * tık → yeni sekme (öne/arkaya, `useOpenTarget` kuralı) · SAĞ TIK → arka planda
 * yeni sekme (peş peşe birkaç kart açmak için; kullanıcı hub'da kalır).
 * "Aynı sekmede aç" tercihinde sağ tık sekme açmaz (`decideTabOpen`).
 */
export function useDrillTarget(path: string) {
  const open = useOpenTarget();
  return {
    onClick: (e: MouseEvent) => open(path, e),
    onAuxClick: (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        open(path, e);
      }
    },
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      open(path, { button: 2 });
    },
  };
}
