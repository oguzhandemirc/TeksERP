// Düzenleme formu → ERP PATCH gövdesi: yalnız DEĞİŞEN alanlar (boşaltılan alan null). Sürüm (`expectedUpdatedAt`)
// yazıcıda eklenir. Bayat (409 STALE_RECORD) akışı: taze kayıt okunur, form KORUNUR; belirsiz hatadan sonraki
// tekrarda taze kayıt zaten formdaysa (ilk deneme yazılmış) başarı sayılır.
import { ApiError } from "../api/client";
import { STALE_RECORD, terminAni, type CariKaydi, type RenkGovdesi, type RenkKaydi, type SiparisKaydi } from "../api/yazma";
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

/** Cari doğuşu token'lı replay kodları (V4c fabrikası): kart pasif/birleşik · aynı token başka gövde. */
export const CUSTOMER_CREATE_GONE = "CUSTOMER_CREATE_GONE";
export const CLIENT_TOKEN_COLLISION = "CLIENT_TOKEN_COLLISION";

/**
 * Yaratma hatasını kullanıcı iletisine çevirir. `CLIENT_TOKEN_COLLISION` kesin 4xx'tir: kimlik düşer, sonraki basış
 * yeni denemedir. Eski sunucu `clientToken`ı sessizce düşürür; orada belirsiz denemeden sonraki ad mükerreri büyük
 * olasılıkla ilk denemenin kaydıdır (yeni sunucu aynı token'a kartı geri verir, bu ileti ona düşmez).
 */
export function ekleHatasi(err: unknown, belirsizOnce: boolean): unknown {
  if (!(err instanceof ApiError)) return err;
  if (err.code === CUSTOMER_CREATE_GONE) {
    return new ApiError(409, err.code, "Bu cari kaydedilmiş ama sonradan pasife alınmış; listeden seçin.", err.details);
  }
  if (err.code === CLIENT_TOKEN_COLLISION) {
    return new ApiError(409, err.code, "Önceki deneme farklı bilgilerle kaydedilmiş; yeniden göndermek için tekrar dokunun.", err.details);
  }
  if (belirsizOnce && err.code === "CUSTOMER_NAME_DUPLICATE") {
    return new ApiError(409, err.code, "Bu adda cari zaten var; önceki deneme kaydedilmiş olabilir. Cari listesini yenileyip kontrol edin.", err.details);
  }
  return err;
}

// ── Renk (V5c) ────────────────────────────────────────────────────────────────
export interface RenkFormu {
  readonly ad: string;
  readonly hex: string;
}

export const renkFormu = (k: RenkKaydi): RenkFormu => ({ ad: k.ad, hex: k.hex });

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Renk formu doğrulaması (panel şemasıyla aynı: ad 1–80, hex boş ya da #RRGGBB; '#' yazılmadıysa eklenir). */
export function renkGovdesi(f: RenkFormu): Built<RenkGovdesi> {
  const ad = f.ad.trim();
  if (!ad) return { ok: false, error: "Renk adı girin" };
  if (ad.length > 80) return { ok: false, error: "Renk adı en çok 80 karakter" };
  const ham = f.hex.trim();
  const hex = ham && !ham.startsWith("#") ? `#${ham}` : ham;
  if (hex && !HEX.test(hex)) return { ok: false, error: "Renk kodu #RRGGBB biçiminde olmalı" };
  return { ok: true, body: hex ? { ad, hex: hex.toUpperCase() } : { ad } };
}

/** Renk PATCH gövdesi: yalnız değişen alanlar (boşaltılan hex null). */
export function renkPatch(k: RenkKaydi, f: RenkFormu): Built<Patch> {
  const b = renkGovdesi(f);
  if (!b.ok) return b;
  const out: Record<string, unknown> = {};
  if (b.body.ad !== k.ad) out.name = b.body.ad;
  const hex = b.body.hex ?? null;
  if (hex !== (k.hex ? k.hex.toUpperCase() : null)) out.hex = hex;
  return { ok: true, body: out };
}

/** Renk/ürün doğuşu token'lı replay kodları (V5c fabrikası): kayıt sonradan pasif/birleşik. */
export const TANIM_CREATE_GONE = ["COLOR_CREATE_GONE", "ITEM_CREATE_GONE"] as const;

/**
 * Tanım (renk/ürün) yaratma hatası → kullanıcı iletisi. Yeni fabrika aynı deneme kimliğine ilk kaydı döner; çakışma ve
 * "sonradan pasif" kesin 409'dur. Eski fabrika kimliği düşürür: orada belirsiz denemeden sonraki ad mükerreri büyük
 * olasılıkla ilk denemedir.
 */
export function tanimEkleHatasi(err: unknown, belirsizOnce: boolean, liste: string): unknown {
  if (!(err instanceof ApiError)) return err;
  if ((TANIM_CREATE_GONE as readonly string[]).includes(err.code)) {
    return new ApiError(409, err.code, "Bu kayıt oluşturulmuş ama sonradan pasife alınmış; listeden bakın.", err.details);
  }
  if (err.code === CLIENT_TOKEN_COLLISION) {
    return new ApiError(409, err.code, "Önceki deneme farklı bilgilerle kaydedilmiş; yeniden göndermek için tekrar dokunun.", err.details);
  }
  if (belirsizOnce && err.status === 409) {
    return new ApiError(409, err.code, `Bu adda kayıt zaten var; önceki deneme kaydedilmiş olabilir. ${liste} listesini yenileyip kontrol edin.`, err.details);
  }
  return err;
}
