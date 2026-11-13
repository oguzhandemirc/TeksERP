// Bağlantı katmanı: uygulama ya patron BULUTUNA ya da fabrikanın ERP sunucusuna DOĞRUDAN bağlanır. Ekranlar kipi
// bilmez; yalnız `Api` (aynı tip) ve `Yetenek` görür. Taşıma ayrı alan: bugün `fetch`, ileride fabrikaya kurulan
// müşteri için "boru" yalnız yeni bir `Tasima` olarak eklenir — kip, adres ve ekranlar değişmez.
import { ApiError } from "./client";
import type { KeyValue } from "../state/browser-store";

export type Kip = "bulut" | "erp";

/** İstek taşıması — `fetch` imzası. */
export type Tasima = typeof fetch;

export interface Baglanti {
  readonly kip: Kip;
  /** Kök adres (`https://fabrika.ornek.com`); istemci `/api` ekler. */
  readonly tabanAdres: string;
  readonly tasima: Tasima;
}

/** Kalıcı kayıt: yalnız kip + adres (sır yok); gizli depoda durur. */
export const BAGLANTI_KEY = "patron.baglanti";

const varsayilanTasima: Tasima = (input, init) => fetch(input, init);

export function bulutBaglantisi(tabanAdres: string, tasima: Tasima = varsayilanTasima): Baglanti {
  return { kip: "bulut", tabanAdres, tasima };
}

export function erpBaglantisi(tabanAdres: string, tasima: Tasima = varsayilanTasima): Baglanti {
  return { kip: "erp", tabanAdres, tasima };
}

/**
 * Elle yazılan adresi düzeltir: boşluk, sondaki `/` ve `/api` atılır; şema yoksa `https://` eklenir.
 * `http://` reddedilir (parola ve 30 günlük belirteç açık ağdan geçmez). Geçersizse null.
 */
export function adresiDuzelt(girdi: string): string | null {
  let v = girdi.trim();
  if (v === "") return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `https://${v}`;
  if (!/^https:\/\//i.test(v)) return null;
  v = v.replace(/\/+$/, "").replace(/\/api$/i, "").replace(/\/+$/, "");
  const host = v.slice("https://".length).split("/")[0] ?? "";
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) || !host.includes(".")) return null;
  return `https://${v.slice("https://".length)}`;
}

export type YoklamaSonucu = { readonly tamam: true; readonly baglanti: Baglanti } | { readonly tamam: false; readonly ileti: string };

/**
 * Adres bir TeksERP sunucusu mu: `GET /api/client-policy/patron` (kimliksiz) `{success, data.minVersion}` dönerse
 * ERP kipi. Bulutta bu uç yoktur — yanlış adres ERP sanılmaz.
 */
export async function erpYokla(adres: string, tasima: Tasima = varsayilanTasima, timeoutMs = 10_000): Promise<YoklamaSonucu> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await tasima(`${adres}/api/client-policy/patron`, { method: "GET", headers: { Accept: "application/json" }, signal: ctrl.signal });
  } catch {
    return { tamam: false, ileti: "Sunucuya ulaşılamıyor; adresi ve bağlantınızı kontrol edin" };
  } finally {
    clearTimeout(timer);
  }
  const body = (await res.json().catch(() => null)) as { success?: unknown; data?: { minVersion?: unknown } } | null;
  if (res.ok && body?.success === true && typeof body.data?.minVersion === "string") {
    return { tamam: true, baglanti: erpBaglantisi(adres, tasima) };
  }
  return { tamam: false, ileti: "Bu adreste TeksERP sunucusu bulunamadı" };
}

export async function baglantiOku(store: KeyValue): Promise<{ kip: Kip; tabanAdres: string } | null> {
  try {
    const raw = await store.get(BAGLANTI_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { kip?: unknown; tabanAdres?: unknown };
    if (v.kip === "erp" && typeof v.tabanAdres === "string" && adresiDuzelt(v.tabanAdres) === v.tabanAdres) return { kip: "erp", tabanAdres: v.tabanAdres };
    return null;
  } catch {
    return null;
  }
}

export async function baglantiYaz(store: KeyValue, b: Baglanti): Promise<void> {
  await store.set(BAGLANTI_KEY, JSON.stringify({ kip: b.kip, tabanAdres: b.tabanAdres })).catch(() => undefined);
}

export async function baglantiSil(store: KeyValue): Promise<void> {
  await store.remove(BAGLANTI_KEY).catch(() => undefined);
}

/** Ağa gitmeden dönen "bu kipte yok" hatası — ekran 404 gibi ele alır (saklı kopya düşer, boş durum). */
export function kipteYok(code: "KIP_DESTEKLEMIYOR" | "KUME_SUNULMUYOR"): ApiError {
  return new ApiError(404, code, "Bu bölüm bu sunucuda henüz yok");
}
