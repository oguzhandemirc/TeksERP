// =============================================================================
// MÜLKİYET KAPSAMI — "bu top BİZİM stok mu, müşterinin EMANETİ mi?" (genel fason F1, 2026-11-08)
// =============================================================================
// Tek soru, tek cevap: `Roll.ownerCustomerId` doluysa emanettir (doğum niteliği; `emanet-owner.helper.ts`).
// Üç biçim BOĞAZ-İKİZDİR ve birlikte değişir (`test_mulkiyet_kapsami` aynı kümeyi verdiklerini ölçer):
//   bellek `isConsignedRoll` ↔ Prisma `CONSIGNED_WHERE` / `OWN_STOCK_WHERE` ↔ SQL `consignedRollSql(alias)`.
// Stok sayan yüzey (envanter şeridi, Stok & Ölü Stok, kalem raporu, üretim bakiyesi) bu dosyadan okur;
// helper dışında yeni `ownerCustomerId` null yüklemi yazılmaz (bekçi yakalar).
// =============================================================================
import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";

/** `filter[mulkiyet]` değerleri — ALL bugünkü davranış (süzgeç yok). */
export const OWNERSHIP_SCOPES = ["ALL", "OWN", "CONSIGNED"] as const;
export type OwnershipScope = (typeof OWNERSHIP_SCOPES)[number];

/** Bizim stok: sahibi olmayan top. */
export const OWN_STOCK_WHERE = { ownerCustomerId: null } as const satisfies Prisma.RollWhereInput;
/** Emanet: müşterinin malı. */
export const CONSIGNED_WHERE = { ownerCustomerId: { not: null } } as const satisfies Prisma.RollWhereInput;

/** Bellek yüklemi — `CONSIGNED_WHERE`in ikizi. */
export function isConsignedRoll(r: { ownerCustomerId: string | null }): boolean {
  return r.ownerCustomerId !== null;
}

/** SQL ikizi — `alias` sabit tablo takma adıdır (kullanıcı girdisi DEĞİL). */
export function consignedRollSql(alias: string): Prisma.Sql {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`consignedRollSql: geçersiz takma ad ${alias}`);
  return Prisma.raw(`(${alias}."ownerCustomerId" IS NOT NULL)`);
}

/** `filter[mulkiyet]` okuyucusu — boş = ALL; tanınmayan değer 400 (fail-closed, sessiz ALL'a düşmez). */
export function readOwnershipScope(raw: unknown): OwnershipScope {
  if (raw === undefined || raw === null || raw === "") return "ALL";
  const v = typeof raw === "string" ? raw.trim().toUpperCase() : raw;
  if (typeof v === "string" && (OWNERSHIP_SCOPES as readonly string[]).includes(v)) return v as OwnershipScope;
  throw AppError.badRequest(`Geçersiz mülkiyet süzgeci: ${String(raw)} (ALL | OWN | CONSIGNED)`, {
    code: "OWNERSHIP_SCOPE_INVALID",
    allowed: [...OWNERSHIP_SCOPES],
  });
}

/** Kapsamın Prisma parçası; ALL → null (where'e hiçbir şey eklenmez = bugünkü şekil). */
export function ownershipScopeWhere(scope: OwnershipScope): Prisma.RollWhereInput | null {
  if (scope === "OWN") return OWN_STOCK_WHERE;
  if (scope === "CONSIGNED") return CONSIGNED_WHERE;
  return null;
}

/**
 * Raf/arz satırlarını bizim ↔ emanet diye böler. Emanet modülü KAPALIYKEN bölme yapılmaz
 * (hepsi `own`, `consigned` boş) — yüzeyler kapalı kurulumda bayt-aynı kalsın.
 */
export function splitByOwnership<T>(
  rows: readonly T[],
  emanetOn: boolean,
  consigned: (row: T) => boolean,
): { own: T[]; consigned: T[] } {
  if (!emanetOn) return { own: [...rows], consigned: [] };
  const own: T[] = [];
  const cons: T[] = [];
  for (const r of rows) (consigned(r) ? cons : own).push(r);
  return { own, consigned: cons };
}
