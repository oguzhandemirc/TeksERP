// =============================================================================
// e-İrsaliye YAPILANDIRMA AYARLARI — tip + varsayılan + temizleyici (E3-AYAR)
// =============================================================================
// İki JSON ayar: `company.legalIdentity` (gönderici resmi künyesi — kimliktir,
// ileride başka e-belgeler de okur) ve `eIrsaliye.config` (bağdaştırıcı + yürürlük).
// Saf modül: DB'ye inmez; okuyucu/yazıcı `system-setting.service`te durur (emsal
// `companyLetterhead`). Okumada çöp değer varsayılana düşer, yazmada 400 (fail-closed).
// =============================================================================
import { EIRSALIYE_ADAPTERS, type EIrsaliyeAdapter } from "../../constants/e-irsaliye";

export interface CompanyLegalIdentity {
  kimlikTuru: "VKN" | "TCKN";
  kimlikNo: string;
  unvan: string;
  /** Yalnız TCKN'li (şahıs) göndericide: UBL `cac:Person` ad/soyadı zorunlu. */
  kisiAd: string;
  kisiSoyad: string;
  vergiDairesi: string;
  cadde: string;
  binaNo: string;
  ilce: string;
  il: string;
  postaKodu: string;
  ulke: string;
  mersisNo: string;
  ticaretSicilNo: string;
  telefon: string;
  eposta: string;
  web: string;
}

export const DEFAULT_COMPANY_LEGAL_IDENTITY: CompanyLegalIdentity = {
  kimlikTuru: "VKN",
  kimlikNo: "",
  unvan: "",
  kisiAd: "",
  kisiSoyad: "",
  vergiDairesi: "",
  cadde: "",
  binaNo: "",
  ilce: "",
  il: "",
  postaKodu: "",
  ulke: "TR",
  mersisNo: "",
  ticaretSicilNo: "",
  telefon: "",
  eposta: "",
  web: "",
};

/** Alan başına üst sınır (karakter) — Zod şeması ve panel formu aynı tabloyu okur. */
export const LEGAL_IDENTITY_LIMITS: Readonly<Record<Exclude<keyof CompanyLegalIdentity, "kimlikTuru">, number>> = {
  kimlikNo: 11,
  unvan: 300,
  kisiAd: 100,
  kisiSoyad: 100,
  vergiDairesi: 100,
  cadde: 200,
  binaNo: 20,
  ilce: 100,
  il: 100,
  postaKodu: 10,
  ulke: 2,
  mersisNo: 16,
  ticaretSicilNo: 32,
  telefon: 40,
  eposta: 120,
  web: 120,
};

/** Rakam dışını atan alanlar — kimlik, MERSİS, posta kodu yalnız rakamdır. */
const DIGITS_ONLY = new Set<keyof CompanyLegalIdentity>(["kimlikNo", "mersisNo", "postaKodu"]);

/** Bilinmeyen alanı atar, metni kırpar, sınırı uygular; okuma ve yazma aynı temizliği görür. */
export function sanitizeCompanyLegalIdentity(raw: unknown): CompanyLegalIdentity {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: CompanyLegalIdentity = { ...DEFAULT_COMPANY_LEGAL_IDENTITY };
  out.kimlikTuru = o.kimlikTuru === "TCKN" ? "TCKN" : "VKN";
  for (const [key, max] of Object.entries(LEGAL_IDENTITY_LIMITS) as [keyof typeof LEGAL_IDENTITY_LIMITS, number][]) {
    const v = o[key];
    let s = typeof v === "string" ? v.trim() : "";
    if (DIGITS_ONLY.has(key)) s = s.replace(/[^0-9]/g, "");
    out[key] = s.slice(0, max);
  }
  out.ulke = /^[A-Za-z]{2}$/.test(out.ulke) ? out.ulke.toUpperCase() : "TR";
  return out;
}

export interface EIrsaliyeConfig {
  adapter: EIrsaliyeAdapter;
  /** Fabrika günü "YYYY-MM-DD"; bu günden önce sevk edilmiş sevkiyata e-İrsaliye üretilmez. */
  yururlukTarihi: string | null;
}

export const DEFAULT_EIRSALIYE_CONFIG: EIrsaliyeConfig = { adapter: "yok", yururlukTarihi: null };

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isEIrsaliyeAdapter(v: unknown): v is EIrsaliyeAdapter {
  return typeof v === "string" && (EIRSALIYE_ADAPTERS as readonly string[]).includes(v);
}

/** Takvimde gerçekten var olan gün mü (31 Şubat reddi). */
export function isCalendarDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** OKUMA: çöp bağdaştırıcı `yok`a, çöp tarih null'a düşer (enum üçlü kalıbı). */
export function readEIrsaliyeConfigValue(raw: unknown): EIrsaliyeConfig {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    adapter: isEIrsaliyeAdapter(o.adapter) ? o.adapter : "yok",
    yururlukTarihi: typeof o.yururlukTarihi === "string" && isCalendarDate(o.yururlukTarihi) ? o.yururlukTarihi : null,
  };
}

/** YAZMA: tanınmayan bağdaştırıcı / bozuk tarih sessizce düzeltilmez — hata cümlesi döner. */
export function validateEIrsaliyeConfigInput(raw: unknown): { ok: true; value: EIrsaliyeConfig } | { ok: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, message: "e-İrsaliye ayarı nesne olmalı." };
  const o = raw as Record<string, unknown>;
  if (!isEIrsaliyeAdapter(o.adapter)) {
    return { ok: false, message: "Bağdaştırıcı tanınmıyor; Kapalı, Dışa aktar ya da Simülasyon seçilmeli." };
  }
  const t = o.yururlukTarihi ?? null;
  if (t !== null && (typeof t !== "string" || !isCalendarDate(t))) {
    return { ok: false, message: "Yürürlük tarihi geçerli bir gün olmalı (YYYY-AA-GG)." };
  }
  return { ok: true, value: { adapter: o.adapter, yururlukTarihi: t } };
}
