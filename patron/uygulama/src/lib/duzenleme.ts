// Düzenleme formu → ERP PATCH gövdesi: yalnız DEĞİŞEN alanlar (boşaltılan alan null). Sürüm (`expectedUpdatedAt`)
// yazıcıda eklenir. Bayat (409 STALE_RECORD) akışı: taze kayıt okunur, form KORUNUR; belirsiz hatadan sonraki
// tekrarda taze kayıt zaten formdaysa (ilk deneme yazılmış) başarı sayılır.
import { ApiError } from "../api/client";
import { STALE_RECORD, terminAni, type CariKaydi, type SiparisKaydi } from "../api/yazma";
import { buildCustomer, trDateToIso, type Built } from "./forms";

export type Patch = Readonly<Record<string, unknown>>;

export interface CariFormu {
  readonly ad: string;
  readonly musteri: boolean;
  readonly tedarikci: boolean;
  readonly il: string;
  readonly vergiNo: string;
  readonly telefon: string;
  readonly eposta: string;
}

export const cariFormu = (k: CariKaydi): CariFormu => ({ ad: k.ad, musteri: k.musteri, tedarikci: k.tedarikci, il: k.il, vergiNo: k.vergiNo, telefon: k.telefon, eposta: k.eposta });

/** Cari PATCH gövdesi (ERP alan adlarıyla); doğrulama yeni cari formuyla aynı, fason rolü "en az bir rol"a sayılır. */
export function cariPatch(k: CariKaydi, f: CariFormu): Built<Patch> {
  if (!f.musteri && !f.tedarikci && !k.fason) return { ok: false, error: "En az bir rol seçin" };
  const b = buildCustomer({ ...f, musteri: true });
  if (!b.ok) return b;
  const yeni = { name: b.body.ad, city: b.body.il ?? null, taxNumber: b.body.vergiNo ?? null, contactPhone: b.body.telefon ?? null, email: b.body.eposta ?? null };
  const eski = { name: k.ad, city: k.il || null, taxNumber: k.vergiNo || null, contactPhone: k.telefon || null, email: k.eposta || null };
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(yeni) as (keyof typeof yeni)[]) if (yeni[key] !== eski[key]) out[key] = yeni[key];
  if (f.musteri !== k.musteri) out.isCustomerRole = f.musteri;
  if (f.tedarikci !== k.tedarikci) out.isSupplierRole = f.tedarikci;
  return { ok: true, body: out };
}

export interface SiparisFormu {
  readonly cariKartId: string;
  readonly cariAdi: string;
  readonly doviz: string;
  readonly termin: string;
}

export const siparisFormu = (k: SiparisKaydi): SiparisFormu => ({ cariKartId: k.cariKartId, cariAdi: k.cariAdi, doviz: k.doviz, termin: k.termin });

/** Kısmi sevk edilmiş siparişte fabrika yalnız termini yazar (diğer başlık alanını SESSİZCE düşürür). */
export const yalnizTermin = (k: SiparisKaydi): boolean => k.durum === "PARTIAL_SHIPPED";

/** Sipariş başlık PATCH gövdesi. Kalemler telefonda düzenlenmez: fabrika kalem dizisini tam değiştirir (eksik = silinir). */
export function siparisPatch(k: SiparisKaydi, f: SiparisFormu): Built<Patch> {
  const termin = trDateToIso(f.termin);
  if (termin === null) return { ok: false, error: "Termin GG.AA.YYYY biçiminde olmalı" };
  const out: Record<string, unknown> = {};
  if (trDateToIso(k.termin) !== termin) out.deadline = termin ? terminAni(termin) : null;
  if (!yalnizTermin(k)) {
    if (!f.cariKartId) return { ok: false, error: "Cari seçin" };
    // Şube cariye aittir: cari değişince şube boşaltılır (fabrika şubeyi yeni cariye karşı doğrular).
    if (f.cariKartId !== k.cariKartId) Object.assign(out, { customerId: f.cariKartId, branchId: null });
    if (f.doviz !== k.doviz) out.currency = f.doviz;
  }
  return { ok: true, body: out };
}

export type KaydetSonucu<K> = { readonly tur: "tamam"; readonly kayit: K } | { readonly tur: "bayat"; readonly taze: K };

/**
 * Sürümlü kaydet. 409 STALE_RECORD → taze kayıt okunur: `belirsizOnce` (önceki deneme ağ/5xx ile sonuçsuz) ve taze
 * kayıtta fark kalmadıysa ilk deneme yazılmıştır → "tamam"; değilse "bayat" (form korunur, kullanıcı yeniden kaydeder).
 * Diğer hatalar fırlar (ileti sunucudan, Türkçe).
 */
export async function surumluKaydet<K>(o: {
  readonly yaz: () => Promise<K>;
  readonly oku: () => Promise<K>;
  readonly farkVar: (taze: K) => boolean;
  readonly belirsizOnce: boolean;
}): Promise<KaydetSonucu<K>> {
  try {
    return { tur: "tamam", kayit: await o.yaz() };
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 409 && err.code === STALE_RECORD)) throw err;
    const taze = await o.oku();
    if (o.belirsizOnce && !o.farkVar(taze)) return { tur: "tamam", kayit: taze };
    return { tur: "bayat", taze };
  }
}

/** Bayat kayıtta kullanıcıya gösterilecek fark: "Alan: sunucudaki değer" satırları (form değişmez). */
export function farkSatirlari<F extends object>(form: F, taze: F, etiket: Readonly<Partial<Record<keyof F, string>>>): string[] {
  const out: string[] = [];
  for (const key of Object.keys(etiket) as (keyof F)[]) {
    const a = form[key];
    const b = taze[key];
    if (a !== b) out.push(`${etiket[key]}: ${typeof b === "boolean" ? (b ? "evet" : "hayır") : String(b ?? "") || "—"}`);
  }
  return out;
}

/**
 * Yaratma hatası, önceki deneme belirsizse (ağ/5xx): cari ucu işlem kimliği almadığından tekrar 409
 * `CUSTOMER_NAME_DUPLICATE` olur — büyük olasılıkla ilk deneme yazılmıştır; kullanıcıya bunu söyle.
 */
export function ekleHatasi(err: unknown, belirsizOnce: boolean): unknown {
  if (belirsizOnce && err instanceof ApiError && err.code === "CUSTOMER_NAME_DUPLICATE") {
    return new ApiError(409, err.code, "Bu adda cari zaten var; önceki deneme kaydedilmiş olabilir. Cari listesini yenileyip kontrol edin.", err.details);
  }
  return err;
}
