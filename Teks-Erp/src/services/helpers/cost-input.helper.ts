// =============================================================================
// MALİYET GİRDİ DOĞRULAMASI — sayısal alan kuralları TEK yerde (MAL-1)
// =============================================================================
// Maliyet girdileri `Decimal`dir; JS float'ı Decimal kolona yazmak yasak (kök kural) →
// gövde metin ya da sayı gelir, buradan `Prisma.Decimal`e çevrilir. Aralıklar migration
// `maliyet_girdileri` CHECK'lerinin aynasıdır (DB ikinci hat; kullanıcı Türkçe 400 görür).
// =============================================================================
import { Currency, Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";

export interface DecimalRule {
  label: string;
  /** Alt sınır; `minExclusive` true ise sınır dahil değil. */
  min?: number;
  minExclusive?: boolean;
  max?: number;
  maxExclusive?: boolean;
  /** Ondalık hane tavanı (kolonun ölçeği). */
  scale: number;
  /** Tam sayı mı (Int kolon). */
  integer?: boolean;
}

/** Yüzde kuralı: 0 ≤ x < 100 (fire, genel gider, çekme). */
export const PCT_RULE = (label: string): DecimalRule => ({ label, min: 0, max: 100, maxExclusive: true, scale: 2 });
/** Randıman: 0 < x ≤ 100. */
export const EFFICIENCY_RULE = (label: string): DecimalRule => ({ label, min: 0, minExclusive: true, max: 100, scale: 2 });
/** Kâr oranı: 0 ≤ x ≤ 1000. */
export const MARKUP_RULE = (label: string): DecimalRule => ({ label, min: 0, max: 1000, scale: 2 });

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

/**
 * `undefined` → alan gönderilmedi (dokunma) · `null`/"" → temizle · aksi hâlde kurala uyan Decimal.
 * Zorunlu alanın boşluğunu ÇAĞIRAN ölçer (taslak kopyasında boş alan önceki değeri taşır).
 */
export function parseDecimalField(raw: unknown, rule: DecimalRule): Prisma.Decimal | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim().replace(",", ".") : null;
  if (text === null || !NUMERIC_RE.test(text) || (typeof raw === "number" && !Number.isFinite(raw))) {
    throw AppError.badRequest(`${rule.label} sayı olmalı.`);
  }
  const d = new Prisma.Decimal(text);
  if (rule.integer && !d.isInteger()) throw AppError.badRequest(`${rule.label} tam sayı olmalı.`);
  if (d.decimalPlaces() > rule.scale) throw AppError.badRequest(`${rule.label} en çok ${rule.scale} ondalık hane alabilir.`);
  if (rule.min !== undefined && (rule.minExclusive ? d.lte(rule.min) : d.lt(rule.min))) {
    throw AppError.badRequest(`${rule.label} ${rule.minExclusive ? "sıfırdan büyük" : `en az ${rule.min}`} olmalı.`);
  }
  if (rule.max !== undefined && (rule.maxExclusive ? d.gte(rule.max) : d.gt(rule.max))) {
    throw AppError.badRequest(`${rule.label} ${rule.maxExclusive ? `${rule.max}'den küçük` : `en çok ${rule.max}`} olmalı.`);
  }
  return d;
}

/** SY-D2 atkı ücreti (1 atkı/cm için metre başına; Excel'in "cent"i 0,02 USD) — CHECK `*_loom_pick_pair_ck` aynası. */
export const PICK_RATE_RULE: DecimalRule = { label: "Atkı ücreti", min: 0, scale: 4 };

/**
 * Ücret + döviz ÇİFTİ: ikisi birlikte gelir, birlikte dolu ya da birlikte boş (DB CHECK ikinci hat).
 * `undefined` = ikisi de gönderilmedi (dokunma).
 */
export function parsePickRatePair(rateRaw: unknown, currencyRaw: unknown): { rate: Prisma.Decimal | null; currency: Currency | null } | undefined {
  if (rateRaw === undefined && currencyRaw === undefined) return undefined;
  const rate = parseDecimalField(rateRaw, PICK_RATE_RULE) ?? null;
  const cur = currencyRaw === undefined || currencyRaw === null || currencyRaw === "" ? null : currencyRaw;
  if (cur !== null && !(typeof cur === "string" && (Object.values(Currency) as string[]).includes(cur))) {
    throw AppError.badRequest(`Atkı ücreti dövizi şunlardan biri olmalı: ${Object.values(Currency).join(", ")}`);
  }
  if ((rate === null) !== (cur === null)) {
    throw AppError.badRequest("Atkı ücreti ve dövizi birlikte girilir ya da birlikte boş bırakılır.", { code: "COST_PICK_RATE_PAIR" });
  }
  return { rate, currency: cur as Currency | null };
}

/** İsteğe bağlı kısa metin: `undefined` dokunma · boş → null · uzunluk tavanı. */
export function parseTextField(raw: unknown, label: string, maxLen: number): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") throw AppError.badRequest(`${label} metin olmalı.`);
  const t = raw.trim();
  if (t.length === 0) return null;
  if (t.length > maxLen) throw AppError.badRequest(`${label} en çok ${maxLen} karakter olabilir.`);
  return t;
}

/** Partial unique / unique yarışı: P2002 → Türkçe 409; başka hata olduğu gibi döner. */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** Damgalı sürüm değişiminin iki ayak izi (eski satır damgası + yeni satır) — iplik fiyatı ve apre tarifesi ortak. */
export function logStampedVersionAudit(opts: {
  tableName: string;
  userId?: string;
  previousId: string | null;
  revokeReason: string;
  rowId: string;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown>;
}): void {
  if (opts.previousId) {
    void AuditService.log({
      userId: opts.userId,
      action: "UPDATE",
      tableName: opts.tableName,
      recordId: opts.previousId,
      oldData: { revokeReason: null },
      newData: { revokeReason: opts.revokeReason },
    });
  }
  void AuditService.log({
    userId: opts.userId,
    action: "CREATE",
    tableName: opts.tableName,
    recordId: opts.rowId,
    oldData: opts.oldData,
    newData: opts.newData,
  });
}
