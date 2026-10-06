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
