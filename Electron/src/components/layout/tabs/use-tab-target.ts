import type { MouseEvent } from "react";
import { useTabsStore } from "@/store/tabs";

interface ClickLike {
  button?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/** Olay yeni sekme mi istiyor? shift / ctrl / cmd / orta tık / sağ tık. */
function wantsNewTab(e?: ClickLike): boolean {
  if (!e) return false;
  return Boolean(e.shiftKey || e.ctrlKey || e.metaKey || e.button === 1 || e.button === 2);
}

/**
 * Bir hedefi açmak için olay-duyarlı fonksiyon:
 *  - sol tık → aktif sekmede yerinde aç
 *  - shift / ctrl / cmd / orta tık / sağ tık → yeni sekme
 */
export function useOpenTarget() {
  const openTab = useTabsStore((s) => s.openTab);
  const navigateActive = useTabsStore((s) => s.navigateActive);

  return (path: string, e?: ClickLike, state?: unknown) => {
    if (wantsNewTab(e)) {
      // Sağ tık (button 2) / orta tık (button 1) → odaklanmadan arka planda aç:
      // kullanıcı mevcut ekranda kalır, peş peşe birden çok sekme açabilir.
      // shift/ctrl/cmd ile sol tık ise kasıtlı "oraya götür" → ön plana al.
      const background = e?.button === 1 || e?.button === 2;
      openTab(path, { forceNew: true, state, background });
    } else navigateActive(path, { state });
  };
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
 */
export function useTabTarget(path: string) {
  const open = useOpenTarget();
  const openTab = useTabsStore((s) => s.openTab);
  return {
    onClick: (e: MouseEvent) => {
      if (wantsNewTab(e)) {
        open(path, e);
        return;
      }
      openTab(path);
    },
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
