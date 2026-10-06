// =============================================================================
// TEST PROFİLİ BİÇİMİ + ALLOWLIST (TEK-ORTAK-PAKET §6.1, K-8)
// =============================================================================
// Profil = bir fabrikanın AYAR DÜZENİ: `scripts/test-profilleri/<ad>.json` →
// `{ ad, kaynak, alinma, ayarlar: { <FeatureFlags alanı>: değer } }`.
// Anahtarlar `PATCH /api/feature-flags` şemasının alan adlarıdır (API ad uzayı);
// uygulama servis katmanından (`setFeatureFlags`) geçer, ham SQL yazılmaz.
//
// ALLOWLIST OPT-İN'dir: tabloda (`hepsi-acik.ts`) bulunan anahtar girer, yeni anahtar
// dışarıda doğar. Sır, iş verisi ve nesne değerli ayarlar profile GİRMEZ.
// Saf modül: DB/ağ yok — `test_profil_tamligi` ve matris koşucusu aynı yüklemi çağırır.
// =============================================================================
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HEPSI_ACIK, PROFIL_DISI_ANAHTARLAR, type AyarDegeri } from "./hepsi-acik";

export const PROFIL_DIZINI = join(__dirname, "..", "test-profilleri");

export interface Profil {
  ad: string;
  kaynak: string;
  alinma: string;
  ayarlar: Record<string, AyarDegeri>;
}

export const PROFIL_ALANLARI = ["ad", "kaynak", "alinma", "ayarlar"] as const;

/** Profile girebilen anahtarlar = hepsi-açık tablosunun anahtarları. */
export const PROFIL_ALLOWLIST: ReadonlySet<string> = new Set(Object.keys(HEPSI_ACIK));

/** Sır sınıfı anahtar adları: allowlist'te olsalar bile RED (sır hijyeni, kök CLAUDE.md). */
export const SIR_DESENI = /(password|parola|secret|token|totp|hmac|quickpin|cardcode|apikey|private)/i;

export const PROFIL_AD_DESENI = /^[a-z][a-z0-9]*$/;

/** Profil nesnesinin hatalarını döner (boş = geçerli). `sema` verilirse değerler Zod'dan da geçer. */
export function profilHatalari(
  profil: unknown,
  sema?: { safeParse(v: unknown): { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } } },
): string[] {
  const hata: string[] = [];
  if (typeof profil !== "object" || profil === null || Array.isArray(profil)) return ["profil nesne değil"];
  const p = profil as Record<string, unknown>;
  for (const k of Object.keys(p)) if (!(PROFIL_ALANLARI as readonly string[]).includes(k)) hata.push(`bilinmeyen üst alan '${k}'`);
  for (const k of PROFIL_ALANLARI) if (!(k in p)) hata.push(`eksik alan '${k}'`);
  if (typeof p.ad !== "string" || !PROFIL_AD_DESENI.test(p.ad)) hata.push("ad: küçük harf+rakam, boşluksuz kısa kod olmalı");
  if (typeof p.kaynak !== "string" || p.kaynak.length === 0) hata.push("kaynak: boş olmayan metin olmalı");
  if (typeof p.alinma !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(p.alinma)) hata.push("alinma: ISO tarih olmalı");
  const ayarlar = p.ayarlar;
  if (typeof ayarlar !== "object" || ayarlar === null || Array.isArray(ayarlar)) {
    hata.push("ayarlar nesne değil");
    return hata;
  }
  for (const [k, v] of Object.entries(ayarlar)) {
    if (SIR_DESENI.test(k)) hata.push(`ayarlar.${k}: sır sınıfı anahtar`);
    else if (k in PROFIL_DISI_ANAHTARLAR) hata.push(`ayarlar.${k}: profil dışı (${PROFIL_DISI_ANAHTARLAR[k]})`);
    else if (!PROFIL_ALLOWLIST.has(k)) hata.push(`ayarlar.${k}: allowlist dışı`);
    if (!(v === null || ["boolean", "number", "string"].includes(typeof v))) hata.push(`ayarlar.${k}: değer ilkel olmalı`);
  }
  if (sema && hata.length === 0) {
    const r = sema.safeParse(ayarlar);
    if (!r.success) for (const i of r.error?.issues ?? []) hata.push(`ayarlar.${i.path.join(".")}: ${i.message}`);
  }
  return hata;
}

export function profilAdlari(): string[] {
  if (!existsSync(PROFIL_DIZINI)) return [];
  return readdirSync(PROFIL_DIZINI).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
}

export function profilOku(ad: string): Profil {
  if (!PROFIL_AD_DESENI.test(ad)) throw new Error(`geçersiz profil adı '${ad}'`);
  return JSON.parse(readFileSync(join(PROFIL_DIZINI, `${ad}.json`), "utf8")) as Profil;
}

/**
 * Şema evreni ↔ tablo: şemadaki her anahtarın tabloda (açık değer ya da gerekçeli varsayılan)
 * YA DA profil-dışı listede karşılığı olmalı; tabloda şemada olmayan ölü satır da hata.
 */
export function evrenHatalari(semaAnahtarlari: readonly string[]): string[] {
  const hata: string[] = [];
  const sema = new Set(semaAnahtarlari);
  for (const k of sema) {
    const tabloda = k in HEPSI_ACIK;
    const disi = k in PROFIL_DISI_ANAHTARLAR;
    if (!tabloda && !disi) hata.push(`'${k}' hepsi-açık tablosunda YOK (reçete: bayrak eklerken açık değerini yaz)`);
    if (tabloda && disi) hata.push(`'${k}' hem tabloda hem profil-dışı listede`);
  }
  for (const k of [...Object.keys(HEPSI_ACIK), ...Object.keys(PROFIL_DISI_ANAHTARLAR)]) {
    if (!sema.has(k)) hata.push(`'${k}' şemada yok — ölü tablo satırı`);
  }
  return hata;
}

// ── DIŞA AKTARMA (O13b) — gerçek fabrika profili, yedeğin `_test` kopyasından ──────

/** Üretilmiş profillerin adları; dışa aktarma bunların üstüne yazamaz. */
export const URETILMIS_PROFILLER: ReadonlySet<string> = new Set(["kapali", "acik"]);

/**
 * Dışa aktarma hedefi: yalnız `_test` ile biten, oturumun kendi kopyası. Fabrika yedeği
 * sınıfı (`tekserp_fabrika_*`), bilinen canlı/dev adları ve matrisin seed DB'leri RED.
 * Kaçış YOK: bu araç yazmaz, yanlış hedefin tek bedeli yanlış profildir. Boş = geçer.
 */
export function disaAktarmaHedefEngeli(dbAdi: string, yasakAdlar: ReadonlySet<string>): string | null {
  if (!/^[a-z0-9_]+_test$/.test(dbAdi)) return `hedef DB '${dbAdi}' '_test' ile bitmiyor — yedeği kendi tekserp_<oturum>_test kopyana geri yükle`;
  if (dbAdi.startsWith("tekserp_fabrika_")) return `hedef DB '${dbAdi}' fabrika yedeği sınıfında — ona script koşulmaz, kendi kopyanı aç`;
  if (yasakAdlar.has(dbAdi)) return `hedef DB '${dbAdi}' canlı/dev kopya olarak biliniyor`;
  if (/^tekserp_pm_/.test(dbAdi)) return `hedef DB '${dbAdi}' profil matrisinin seed DB'si — fabrika ayarı taşımaz`;
  return null;
}

/** Profil matrisinin DROP/CREATE hedefi: yalnız kendi adlandırdığı `tekserp_pm_<profil>_test`. Kaçış YOK. */
export const PM_DB_DESENI = /^tekserp_pm_[a-z0-9]+_test$/;
export function matrisHedefEngeli(dbAdi: string): string | null {
  return PM_DB_DESENI.test(dbAdi) ? null : `'${dbAdi}' matris DB adı desenine uymuyor — DROP reddedildi.`;
}

export interface DisaAktarimSonucu {
  ayarlar: Record<string, AyarDegeri>;
  /** Çıktıda olup profile GİRMEYEN anahtarlar → neden. */
  atlanan: Record<string, string>;
}

/** `getFeatureFlags()` çıktısından allowlist süzgeci; sır sınıfı ad ve ilkel olmayan değer girmez. */
export function bayraklardanAyarlar(bayraklar: Record<string, unknown>): DisaAktarimSonucu {
  const ayarlar: Record<string, AyarDegeri> = {};
  const atlanan: Record<string, string> = {};
  for (const k of Object.keys(bayraklar).sort()) {
    const v = bayraklar[k];
    if (SIR_DESENI.test(k)) atlanan[k] = "sır sınıfı ad";
    else if (k in PROFIL_DISI_ANAHTARLAR) atlanan[k] = `profil dışı: ${PROFIL_DISI_ANAHTARLAR[k]}`;
    else if (!PROFIL_ALLOWLIST.has(k)) atlanan[k] = "allowlist dışı (yazılabilir ayar değil)";
    else if (!(v === null || ["boolean", "number", "string"].includes(typeof v))) atlanan[k] = "değer ilkel değil";
    else ayarlar[k] = v as AyarDegeri;
  }
  return { ayarlar, atlanan };
}
