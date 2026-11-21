// =============================================================================
// EK MALİYET FORMÜLÜ (CostFormula) — SY-C1
// =============================================================================
// ③a DAMGALI SÜRÜM (YarnCostPrice emsali): değişim = eski aktif satırın damgası (atomik claim,
// `updateMany WHERE {id, revokedAt:null}` → 0 ise 409) + aynı kodla `versionNo + 1` yeni satır, tek
// tx. Kaldırma da damgadır; satır silinmez. Motor aktif sürümü girdiye dondurur → eski standart
// maliyet sürümü yazıldığı formülle kalır. İfade kayıtta ayrıştırılır; tanınmayan değişken/işlev 400.
// =============================================================================
import { Currency, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { ACTIVE_COST_FORMULA } from "./helpers/cost-price-validity.helper";
import { isUniqueViolation, logStampedVersionAudit, parseTextField } from "./helpers/cost-input.helper";
import { CostFormulaError, evaluateCostFormula, formulaVariables, parseCostFormula } from "./helpers/cost-formula-expr.helper";
import { COST_FORMULA_UNBOUND_VARIABLES, COST_FORMULA_VARIABLES, COST_FORMULA_VARIABLE_NAMES } from "./helpers/cost-formula-vars.helper";

export const COST_FORMULA_REVOKE_REASON = { CHANGED: "Formül değişti", REMOVED: "Formül kaldırıldı" } as const;

export const COST_FORMULA_SELECT = {
  id: true, code: true, name: true, expression: true, currency: true, sortOrder: true, versionNo: true, note: true,
  revokedAt: true, revokeReason: true, createdAt: true, createdById: true,
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.CostFormulaSelect;
export type CostFormulaRow = Prisma.CostFormulaGetPayload<{ select: typeof COST_FORMULA_SELECT }>;

export interface CostFormulaInputBody {
  code?: unknown; name?: unknown; expression?: unknown; currency?: unknown; sortOrder?: unknown; note?: unknown;
}

const CODE_RE = /^[A-Z0-9_-]{1,32}$/;
const CURRENCIES = Object.values(Currency) as string[];

function badFormula(e: CostFormulaError): AppError {
  return AppError.badRequest(e.message, { code: e.code, ...(e.detail.position ? { position: e.detail.position } : {}), ...(e.detail.name ? { name: e.detail.name } : {}) });
}

/** İfadeyi ayrıştırır; yer tutucu (henüz bağlı olmayan) değişken 400 — sessiz 0 yok. */
export function validateCostFormulaExpression(raw: unknown): { expression: string; variables: string[] } {
  if (typeof raw !== "string" || !raw.trim()) throw AppError.badRequest("Formül zorunludur.", { code: "COST_FORMULA_INVALID" });
  const expression = raw.trim();
  let variables: string[];
  try {
    variables = formulaVariables(parseCostFormula(expression, COST_FORMULA_VARIABLE_NAMES));
  } catch (e) {
    if (e instanceof CostFormulaError) throw badFormula(e);
    throw e;
  }
  const unbound = variables.filter((v) => COST_FORMULA_UNBOUND_VARIABLES.has(v));
  if (unbound.length) {
    throw AppError.badRequest(`"${unbound.join(", ")}" henüz bağlı değil — değeri olmadan formül kaydedilmez.`, { code: "COST_FORMULA_VARIABLE_UNAVAILABLE", name: unbound[0] });
  }
  return { expression, variables };
}

function parseFields(body: CostFormulaInputBody, requireCode: boolean) {
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (requireCode && !CODE_RE.test(code)) throw AppError.badRequest("Kod 1–32 karakter; harf, rakam, - ve _ olmalı.", { code: "COST_FORMULA_CODE_INVALID" });
  const name = parseTextField(body.name, "Ad", 100);
  if (!name) throw AppError.badRequest("Ad zorunludur.");
  const { expression } = validateCostFormulaExpression(body.expression);
  const currency = body.currency === undefined ? "TRY" : body.currency;
  if (typeof currency !== "string" || !CURRENCIES.includes(currency)) throw AppError.badRequest("Geçersiz para birimi.");
  const sortOrder = body.sortOrder === undefined || body.sortOrder === null || body.sortOrder === "" ? 0 : Number(body.sortOrder);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) throw AppError.badRequest("Sıra 0–999 arası tam sayı olmalı.");
  const note = parseTextField(body.note, "Not", 300) ?? null;
  return { code, name, expression, currency: currency as Currency, sortOrder, note };
}

/** Liste — varsayılan YALNIZ aktif; geçmiş açıkça istenir. */
export async function listCostFormulas(opts: { includeRevoked?: boolean; code?: string }): Promise<CostFormulaRow[]> {
  const where: Prisma.CostFormulaWhereInput = { AND: [opts.includeRevoked ? {} : ACTIVE_COST_FORMULA, opts.code ? { code: opts.code } : {}] };
  return prisma.costFormula.findMany({ where, select: COST_FORMULA_SELECT, orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { sortOrder: "asc" }, { code: "asc" }, { createdAt: "desc" }, { id: "desc" }] });
}

export function listCostFormulaVariables() {
  return COST_FORMULA_VARIABLES;
}

function conflictOnUnique(e: unknown): never {
  if (isUniqueViolation(e)) throw AppError.conflict("Bu kodla yürürlükte bir formül zaten var.", { code: "COST_FORMULA_CODE_TAKEN" });
  throw e;
}

/** YENİ formül (sürüm 1). Aynı kodda aktif formül varsa 409. */
export async function createCostFormula(body: CostFormulaInputBody, userId?: string): Promise<CostFormulaRow> {
  const f = parseFields(body, true);
  let id: string;
  try {
    id = (await prisma.costFormula.create({ data: { ...f, versionNo: 1, createdById: userId ?? null }, select: { id: true } })).id;
  } catch (e) {
    conflictOnUnique(e);
  }
  const row = await prisma.costFormula.findUniqueOrThrow({ where: { id }, select: COST_FORMULA_SELECT });
  void AuditService.log({ userId, action: "CREATE", tableName: "COST_FORMULA", recordId: row.id, newData: { code: row.code, name: row.name, expression: row.expression, currency: row.currency, versionNo: 1 } });
  return row;
}

/** DEĞİŞTİR — aynı değerler no-op; farklıysa eski sürüm damgalanır + `versionNo + 1` yeni satır (tek tx). */
export async function changeCostFormula(id: string, body: CostFormulaInputBody, userId?: string): Promise<{ row: CostFormulaRow; wrote: boolean }> {
  const f = parseFields(body, false);
  const at = new Date();
  let out: { id: string; wrote: boolean; previous: { expression: string; name: string; currency: Currency; versionNo: number } };
  try {
    out = await prisma.$transaction(async (tx) => {
      const cur = await tx.costFormula.findUnique({ where: { id }, select: { id: true, code: true, name: true, expression: true, currency: true, sortOrder: true, note: true, versionNo: true, revokedAt: true } });
      if (!cur) throw AppError.notFound("Formül bulunamadı.");
      if (cur.revokedAt) throw AppError.conflict("Bu formül sürümü artık yürürlükte değil — listeyi yenileyin.", { code: "COST_FORMULA_STALE" });
      if (cur.name === f.name && cur.expression === f.expression && cur.currency === f.currency && cur.sortOrder === f.sortOrder && cur.note === f.note) {
        return { id: cur.id, wrote: false, previous: cur };
      }
      const claim = await tx.costFormula.updateMany({ where: { id, ...ACTIVE_COST_FORMULA }, data: { revokedAt: at, revokedById: userId ?? null, revokeReason: COST_FORMULA_REVOKE_REASON.CHANGED } });
      if (claim.count === 0) throw AppError.conflict("Formül aynı anda başka bir işlemle değişti — listeyi yenileyip tekrar deneyin.", { code: "COST_FORMULA_STALE" });
      const created = await tx.costFormula.create({
        data: { code: cur.code, name: f.name, expression: f.expression, currency: f.currency, sortOrder: f.sortOrder, note: f.note, versionNo: cur.versionNo + 1, createdAt: at, createdById: userId ?? null },
        select: { id: true },
      });
      return { id: created.id, wrote: true, previous: cur };
    });
  } catch (e) {
    conflictOnUnique(e);
  }
  const row = await prisma.costFormula.findUniqueOrThrow({ where: { id: out.id }, select: COST_FORMULA_SELECT });
  if (out.wrote) {
    logStampedVersionAudit({
      tableName: "COST_FORMULA", userId, previousId: id, revokeReason: COST_FORMULA_REVOKE_REASON.CHANGED, rowId: row.id,
      oldData: { expression: out.previous.expression, name: out.previous.name, currency: out.previous.currency, versionNo: out.previous.versionNo },
      newData: { code: row.code, expression: row.expression, name: row.name, currency: row.currency, versionNo: row.versionNo },
    });
  }
  return { row, wrote: out.wrote };
}

/** KALDIR — satır silinmez, damgalanır; yeni hesaplara girmez, eski sürümlerde donmuş kalır. */
export async function revokeCostFormula(id: string, userId?: string): Promise<{ id: string }> {
  const row = await prisma.costFormula.findUnique({ where: { id }, select: { id: true, code: true, revokedAt: true } });
  if (!row) throw AppError.notFound("Formül bulunamadı.");
  if (row.revokedAt) throw AppError.conflict("Bu formül zaten kaldırılmış.", { code: "COST_FORMULA_STALE" });
  const claim = await prisma.costFormula.updateMany({ where: { id, ...ACTIVE_COST_FORMULA }, data: { revokedAt: new Date(), revokedById: userId ?? null, revokeReason: COST_FORMULA_REVOKE_REASON.REMOVED } });
  if (claim.count === 0) throw AppError.conflict("Formül aynı anda başka bir işlemle değişti ya da kaldırıldı — listeyi yenileyin.", { code: "COST_FORMULA_STALE" });
  void AuditService.log({ userId, action: "UPDATE", tableName: "COST_FORMULA", recordId: id, oldData: { revokeReason: null }, newData: { code: row.code, revokeReason: COST_FORMULA_REVOKE_REASON.REMOVED } });
  return { id };
}

/**
 * ÖNİZLEME — hiçbir şey yazmaz. Örnek değerler katalogdan; istemci istediğini ezer (sayı metni).
 * Hesap hatası 200 + `hata` (canlı yazımda her tuşta 400 gürültüsü olmasın); ayrıştırma hatası 400.
 */
export function previewCostFormula(body: { expression?: unknown; values?: unknown }): { sonuc: string | null; hata: string | null; degiskenler: string[] } {
  const { expression, variables } = validateCostFormulaExpression(body.expression);
  const given = body.values && typeof body.values === "object" ? (body.values as Record<string, unknown>) : {};
  const vars = new Map<string, Prisma.Decimal>();
  for (const v of COST_FORMULA_VARIABLES) {
    if (!v.bagli) continue;
    const raw = given[v.name];
    const text = typeof raw === "number" ? String(raw) : typeof raw === "string" && raw.trim() ? raw.trim().replace(",", ".") : v.sample;
    if (!/^-?\d+(\.\d+)?$/.test(text)) throw AppError.badRequest(`"${v.name}" örnek değeri sayı olmalı.`);
    vars.set(v.name, new Prisma.Decimal(text));
  }
  try {
    const value = evaluateCostFormula(parseCostFormula(expression, COST_FORMULA_VARIABLE_NAMES), vars);
    return { sonuc: value.toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP).toString(), hata: null, degiskenler: variables };
  } catch (e) {
    if (e instanceof CostFormulaError) return { sonuc: null, hata: e.message, degiskenler: variables };
    throw e;
  }
}
