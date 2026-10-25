// =============================================================================
// MASAÜSTÜ BİLDİRİMİ — zil olayından yeni satır tespiti + OS bildirimi/tost + rozet aynası (saf çekirdek)
// =============================================================================
// Yalnız kullanıcının seçtiği türler (varsayılan boş = KAPALI) ve yalnız BİLDİRİM sınıfı; tezgah alarmı
// kendi kanalından bildirir. İlk okuma "taban"dır (açılışta birikmiş okunmamışlar fırtına yapmaz); aynı
// satır ikinci kez OS bildirimi üretmez (bellek-içi görülen kümesi). Köprü yoksa (web) hiçbir şey yapmaz.
// =============================================================================
import { isAppPath, type BildirimRozetRequest } from "@shared/bildirim-notify";
import type { BildirimDesktopApi } from "@shared/ipc-contract";
import type { BellState } from "./zil-istemcisi";
import type { NotificationItem } from "./types";

/** Tek seferde çekilen okunmamış satır sayısı (yeni satır tespiti için yeter; fazlası tek bildirimde sayılır). */
export const DESKTOP_SCAN_LIMIT = 20;

/** Electron köprüsü; web panelinde/testte null → masaüstü katmanı tamamen sessiz. */
export function bildirimBridge(): BildirimDesktopApi | null {
  return typeof window !== "undefined" ? (window.api?.bildirim ?? null) : null;
}

/** Bildirim üretecek yeni satırlar: okunmamış, BİLDİRİM sınıfı, seçili tür, görülmemiş; en yeni önce. */
export function pickFreshRows(
  items: readonly NotificationItem[],
  seen: ReadonlySet<string>,
  secili: ReadonlySet<string>,
): NotificationItem[] {
  return items
    .filter((b) => !b.okunduAn && b.sinif === "BILDIRIM" && secili.has(b.tur) && !seen.has(b.id) && isAppPath(b.yol))
    .sort((a, b) => (a.sonAn < b.sonAn ? 1 : a.sonAn > b.sonAn ? -1 : 0));
}

/** Bir parti yeni satır için TEK bildirim metni (en yeni + "ve N bildirim daha"). */
export function desktopTextOf(top: NotificationItem, extra: number): { baslik: string; govde?: string } {
  const title = top.baslik.slice(0, 120);
  const more = extra > 0 ? `ve ${extra} yeni bildirim daha` : "";
  const body = [top.govde, more].filter(Boolean).join(" · ").slice(0, 300);
  return body ? { baslik: title, govde: body } : { baslik: title };
}

export interface DesktopNotifierDeps {
  bridge: BildirimDesktopApi | null;
  liste: (turler: readonly string[]) => Promise<NotificationItem[]>;
  /** Pencere öndeyken (OS bildirimi çıkmadı) uygulama içi tost. */
  tost: (top: NotificationItem, extra: number) => void;
}

export interface DesktopNotifier {
  /** Seçili türleri günceller; küme değişirse yeni tabanla başlar (eski okunmamışlar bildirilmez). */
  turleriAyarla(turler: readonly string[]): void;
  /** Zil "degisti"/"tam" dedi ya da ilk açılış: yeni satırları bul, bildir. */
  kontrol(): Promise<void>;
  /** Kullanıcı değişti / çıkış: küme ve taban sıfırlanır. */
  sifirla(): void;
}

export function createDesktopNotifier(dep: DesktopNotifierDeps): DesktopNotifier {
  const seen = new Set<string>();
  let secili = new Set<string>();
  let taban = false;
  let kosuyor = false;
  let tekrar = false;

  const tur = async (): Promise<void> => {
    if (!dep.bridge || secili.size === 0) return;
    const turler = [...secili].sort();
    const items = await dep.liste(turler);
    if (!taban) {
      items.forEach((b) => seen.add(b.id));
      taban = true;
      return;
    }
    const fresh = pickFreshRows(items, seen, secili);
    fresh.forEach((b) => seen.add(b.id));
    const top = fresh[0];
    if (!top) return;
    const extra = fresh.length - 1;
    const res = await dep.bridge.notify({
      kind: top.tur,
      ...desktopTextOf(top, extra),
      yol: top.yol,
      klass: "BILDIRIM",
      bildirimId: top.id,
    });
    if (!res.shown && res.reason === "focused") dep.tost(top, extra);
  };

  // Ardışık zil olayları tek koşuya katlanır; koşu sürerken gelen olay bir tur daha ister.
  const runCheck = async (): Promise<void> => {
    if (kosuyor) {
      tekrar = true;
      return;
    }
    kosuyor = true;
    try {
      do {
        tekrar = false;
        await tur().catch(() => undefined);
      } while (tekrar);
    } finally {
      kosuyor = false;
    }
  };

  return {
    turleriAyarla(turler) {
      const yeni = new Set(turler);
      if (yeni.size === secili.size && [...yeni].every((t) => secili.has(t))) return;
      secili = yeni;
      taban = false;
    },
    kontrol: runCheck,
    sifirla() {
      seen.clear();
      taban = false;
    },
  };
}

/** Zil durumundan rozet isteği: zil çizilmiyorsa (bayrak kapalı / eski backend) null → IPC yok. */
export function rozetIstegi(s: Pick<BellState, "hazir" | "destek" | "enabled" | "okunmamis" | "alarmAcik">): BildirimRozetRequest | null {
  if (!s.hazir || !s.destek || !s.enabled) return null;
  return { okunmamis: Math.max(0, s.okunmamis), alarm: s.alarmAcik > 0 };
}
