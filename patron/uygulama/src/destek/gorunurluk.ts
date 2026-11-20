// Destek görünürlüğü ve okunmamış rozeti — modül düzeyi tek depo; HATA SESSİZ YUTULUR.
// Kural (bulut §5, §6.1, §6.8): `/destek/durum` `etkin:false` döner ya da uç YOKTUR (eski bulut → 404) → hiçbir destek
// girişi/rozeti görünmez ve başka destek isteği atılmaz. Durumun herhangi bir hatası da "kapalı" sayılır (fail-closed:
// uygulama bugünkü gibi çalışır); öne gelişte yeniden sorulur. Rozet yoklamasının hatası (502/504/429/ağ) YUTULUR:
// rozet eski değerinde kalır, ekrana hiçbir şey basılmaz. Herhangi bir destek ucu 403 `MODULE_DISABLED` dönerse giriş
// hemen gizlenir. Depo hesap + tesis kapsamlıdır (çıkışta/hesap değişince sıfırlanır).
import { useEffect, useSyncExternalStore } from "react";
import { ApiError } from "../api/client";
import type { DestekOkunmamis } from "../api/destek-wire";
import { useAppActive, useForeground } from "../state/useForeground";

/** Uygulama öndeyken rozet yoklama aralığı (merkezin dakikalık sınırı fabrikayla ortak: seyrek tutulur). */
export const ROZET_YOKLAMA_MS = 120_000;
/** Taleplerim / ayrıntı ekranı açıkken yenileme aralığı. */
export const EKRAN_YENILEME_MS = 30_000;

export const SIFIR_OKUNMAMIS: DestekOkunmamis = { count: 0, tickets: 0 };

export interface DestekApi {
  supportStatus(): Promise<{ etkin: boolean }>;
  supportUnread(scope?: "mine" | "tenant"): Promise<DestekOkunmamis>;
}

interface Durum {
  readonly anahtar: string | null;
  readonly etkin: boolean;
  readonly okunmamis: DestekOkunmamis;
}

let durum: Durum = { anahtar: null, etkin: false, okunmamis: SIFIR_OKUNMAMIS };
const dinleyiciler = new Set<() => void>();
const yaz = (d: Durum) => {
  durum = d;
  dinleyiciler.forEach((f) => f());
};
const abone = (f: () => void) => {
  dinleyiciler.add(f);
  return () => void dinleyiciler.delete(f);
};

/** Saf: durum ucunun cevabı → etkin mi (her hata "kapalı"). */
export async function durumGuvenli(getir: () => Promise<{ etkin: boolean }>): Promise<boolean> {
  try {
    const d = await getir();
    return d?.etkin === true;
  } catch {
    return false;
  }
}

/** Saf: rozet cevabı; hata → önceki değer (yoksa sıfır). Hiçbir hata yukarı çıkmaz. */
export async function okunmamisGuvenli(getir: () => Promise<DestekOkunmamis>, onceki: DestekOkunmamis | undefined): Promise<DestekOkunmamis> {
  try {
    const o = await getir();
    return typeof o?.tickets === "number" && typeof o?.count === "number" ? o : (onceki ?? SIFIR_OKUNMAMIS);
  } catch {
    return onceki ?? SIFIR_OKUNMAMIS;
  }
}

/** Rozette talep sayısı (`tickets`); 0 → rozet yok, 10+ → "9+". */
export function destekRozetMetni(o: DestekOkunmamis | undefined): string | null {
  const n = o?.tickets ?? 0;
  if (n <= 0) return null;
  return n > 9 ? "9+" : String(n);
}

export function destekDurumuAl(): Durum {
  return durum;
}

/** Çıkış / hesap değişimi / testler: kapalı ve rozetsiz. */
export function destekSifirla(anahtar: string | null = null): void {
  yaz({ anahtar, etkin: false, okunmamis: SIFIR_OKUNMAMIS });
}

/** `/destek/durum`u sorar; kapalıysa rozet de sıfırlanır. */
export async function destekDurumunuDenetle(api: DestekApi, anahtar: string): Promise<boolean> {
  const etkin = await durumGuvenli(() => api.supportStatus());
  if (durum.anahtar !== anahtar) return false; // bu arada hesap değişti: sonuç düşer
  yaz({ anahtar, etkin, okunmamis: etkin ? durum.okunmamis : SIFIR_OKUNMAMIS });
  return etkin;
}

/** Rozeti tazeler — yalnız etkinken istek atar; hata yutulur. */
export async function destekRozetiniTazele(api: DestekApi): Promise<void> {
  if (!durum.etkin) return;
  const anahtar = durum.anahtar;
  const okunmamis = await okunmamisGuvenli(() => api.supportUnread("mine"), durum.okunmamis);
  if (durum.anahtar !== anahtar || !durum.etkin) return;
  if (okunmamis.count !== durum.okunmamis.count || okunmamis.tickets !== durum.okunmamis.tickets) yaz({ ...durum, okunmamis });
}

/** Herhangi bir destek ucunun hatası: 403 `MODULE_DISABLED` → giriş hemen gizlenir. */
export function destekHatasiniIsle(err: unknown): void {
  if (err instanceof ApiError && err.status === 403 && err.code === "MODULE_DISABLED" && durum.etkin) {
    yaz({ ...durum, etkin: false, okunmamis: SIFIR_OKUNMAMIS });
  }
}

export function useDestekEtkin(): boolean {
  return useSyncExternalStore(abone, () => durum.etkin, () => durum.etkin);
}

export function useDestekOkunmamis(): DestekOkunmamis {
  return useSyncExternalStore(abone, () => durum.okunmamis, () => durum.okunmamis);
}

/**
 * Oturum hazırken bir kez kurulur (`app/(app)/_layout.tsx`): durum → (etkinse) rozet; öndeyken seyrek rozet yoklaması;
 * öne gelince durum ve rozet yeniden. `anahtar` (tesis:hesap) değişince depo sıfırlanır.
 */
export function useDestekYoklama(api: DestekApi, anahtar: string | null): void {
  const aktif = useAppActive();
  useEffect(() => {
    destekSifirla(anahtar);
    if (!anahtar) return;
    void destekDurumunuDenetle(api, anahtar).then((etkin) => (etkin ? destekRozetiniTazele(api) : undefined));
    return () => destekSifirla(null);
  }, [api, anahtar]);
  useForeground(() => {
    if (!anahtar) return;
    void destekDurumunuDenetle(api, anahtar).then((etkin) => (etkin ? destekRozetiniTazele(api) : undefined));
  });
  useEffect(() => {
    if (!anahtar || !aktif) return;
    const id = setInterval(() => void destekRozetiniTazele(api), ROZET_YOKLAMA_MS);
    return () => clearInterval(id);
  }, [api, anahtar, aktif]);
}
