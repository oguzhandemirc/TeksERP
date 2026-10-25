// =============================================================================
// 4 puan kural setleri (K4P-MOTOR, plan §3.2) — yapılandırma; muayene snapshot taşır
// =============================================================================
// Bantlar set kaydında tek tx'te REPLACE edilir: ③b saf yapılandırma pivotu (hard delete
// meşru — muayene `ruleSnapshot` taşıdığı için satır silinince raporlanan sayı değişmez).
// Set kendisi silinmez, pasife alınır. Tek aktif FACTORY seti partial unique ile korunur.
// =============================================================================
import { Prisma, type RuleScope, type RunningCap, type ScoreUnit } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { validateBands, type RuleBand } from "./helpers/four-point.helper";
import { RULE_SET_SELECT } from "./helpers/four-point-resolve.helper";

export const RULE_SET_AUDIT_TABLE = "FOUR_POINT_RULE_SET";

export interface BandInput {
  sortOrder: number;
  maxScore: number | string | null;
  label: string;
  accepted: boolean;
  qualityGradeId?: string | null;
}

export interface RuleSetInput {
  name: string;
  scope: RuleScope;
  customerId?: string | null;
  itemId?: string | null;
  unit?: ScoreUnit;
  runningCap?: RunningCap;
  bands: BandInput[];
}

function bad(message: string, code = "FOUR_POINT_RULE_INVALID", extra: Record<string, unknown> = {}): AppError {
  return AppError.badRequest(message, { code, ...extra });
}

function toBands(input: BandInput[]): RuleBand[] {
  return input.map((b) => ({
    sortOrder: b.sortOrder,
    maxScore: b.maxScore == null || b.maxScore === "" ? null : new Prisma.Decimal(b.maxScore),
    label: b.label ?? "",
    accepted: b.accepted,
    qualityGradeId: b.qualityGradeId ?? null,
  }));
}

/** Kapsam + bant doğrulaması; müşteri kimliği iş ortağıdır ve müşteri rolü açık olmalı. */
async function validate(input: RuleSetInput): Promise<RuleBand[]> {
  if (!input.name?.trim()) throw bad("Kural seti adı boş olamaz.");
  if (input.scope === "FACTORY" && (input.customerId || input.itemId)) throw bad("Fabrika setinde müşteri ya da ürün seçilmez.");
  if (input.scope === "CUSTOMER" && !input.customerId) throw bad("Müşteri setinde müşteri seçilmeli.");
  if (input.customerId) {
    const c = await prisma.customer.findUnique({ where: { id: input.customerId }, select: { isCustomerRole: true, isActive: true } });
    if (!c) throw bad("Müşteri bulunamadı.");
    if (!c.isCustomerRole) throw bad("Seçilen iş ortağının müşteri rolü açık değil.", "CUSTOMER_ROLE_REQUIRED");
  }
  if (input.itemId) {
    const it = await prisma.item.findUnique({ where: { id: input.itemId }, select: { id: true } });
    if (!it) throw bad("Ürün bulunamadı.");
  }
  const bands = toBands(input.bands ?? []);
  const errs = validateBands(bands, input.scope);
  if (errs.length > 0) throw bad(errs[0]!, "FOUR_POINT_BANDS_INVALID", { errors: errs });
  const gradeIds = [...new Set(bands.map((b) => b.qualityGradeId).filter((x): x is string => !!x))];
  if (gradeIds.length > 0) {
    const found = await prisma.qualityGrade.count({ where: { id: { in: gradeIds } } });
    if (found !== gradeIds.length) throw bad("Bantta tanınmayan kalite derecesi.", "FOUR_POINT_BANDS_INVALID");
  }
  return bands;
}

function uniqueConflict(err: unknown): AppError | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return null;
  return AppError.conflict("Bu kapsamda zaten aktif bir kural seti var; önce onu pasife alın.", { code: "FOUR_POINT_RULE_ACTIVE_EXISTS" });
}

function auditView(input: RuleSetInput, bands: RuleBand[]): Record<string, unknown> {
  return {
    name: input.name, scope: input.scope, customerId: input.customerId ?? null, itemId: input.itemId ?? null,
    unit: input.unit ?? "M2", runningCap: input.runningCap ?? "YARD",
    bands: bands.map((b) => `${b.label}≤${b.maxScore?.toFixed(2) ?? "∞"}`).join(" · "),
  };
}

export async function listRuleSets(q: { scope?: string; customerId?: string; includeInactive?: string }) {
  const where: Prisma.FourPointRuleSetWhereInput = {};
  if (q.scope) {
    if (q.scope !== "FACTORY" && q.scope !== "CUSTOMER") throw bad("Tanınmayan kapsam süzgeci.", "FOUR_POINT_FILTER_INVALID");
    where.scope = q.scope;
  }
  if (q.customerId) where.customerId = q.customerId;
  if (q.includeInactive !== "1") where.isActive = true;
  return prisma.fourPointRuleSet.findMany({
    where,
    orderBy: [{ scope: "asc" }, { createdAt: "desc" }, { id: "asc" }],
    select: { ...RULE_SET_SELECT, isActive: true, createdAt: true, updatedAt: true, customer: { select: { id: true, name: true } }, item: { select: { id: true, code: true, name: true } } },
  });
}

export async function getRuleSet(id: string) {
  const row = await prisma.fourPointRuleSet.findUnique({
    where: { id },
    select: { ...RULE_SET_SELECT, isActive: true, createdAt: true, updatedAt: true, customer: { select: { id: true, name: true } }, item: { select: { id: true, code: true, name: true } } },
  });
  if (!row) throw AppError.notFound("Kural seti bulunamadı.", { code: "FOUR_POINT_RULE_NOT_FOUND" });
  return row;
}

export async function createRuleSet(input: RuleSetInput, userId: string) {
  const bands = await validate(input);
  let id: string;
  try {
    id = await prisma.$transaction(async (tx) => {
      const set = await tx.fourPointRuleSet.create({
        data: {
          name: input.name.trim(), scope: input.scope, customerId: input.customerId ?? null, itemId: input.itemId ?? null,
          unit: input.unit ?? "M2", runningCap: input.runningCap ?? "YARD", createdById: userId, updatedById: userId,
        },
        select: { id: true },
      });
      await tx.fourPointRuleBand.createMany({ data: bands.map((b) => ({ ...b, ruleSetId: set.id })) });
      return set.id;
    });
  } catch (err) {
    throw uniqueConflict(err) ?? err;
  }
  await AuditService.log({ userId, action: "CREATE", tableName: RULE_SET_AUDIT_TABLE, recordId: id, newData: auditView(input, bands) });
  return getRuleSet(id);
}

/** Ad/birim/tavan/bantlar güncellenir; kapsam ve müşteri/ürün kimliği değişmez (yeni set açılır). */
export async function updateRuleSet(id: string, input: Omit<RuleSetInput, "scope" | "customerId" | "itemId">, userId: string) {
  const prior = await getRuleSet(id);
  const full: RuleSetInput = { ...input, scope: prior.scope, customerId: prior.customerId, itemId: prior.itemId };
  const bands = await validate(full);
  await prisma.$transaction(async (tx) => {
    await tx.fourPointRuleSet.update({
      where: { id },
      data: { name: input.name.trim(), unit: input.unit ?? prior.unit, runningCap: input.runningCap ?? prior.runningCap, updatedById: userId },
    });
    // ③b pivot replace: bant satırları saf yapılandırmadır, geçmiş muayene snapshot'ı etkilenmez.
    await tx.fourPointRuleBand.deleteMany({ where: { ruleSetId: id } });
    await tx.fourPointRuleBand.createMany({ data: bands.map((b) => ({ ...b, ruleSetId: id })) });
  });
  await AuditService.log({
    userId, action: "UPDATE", tableName: RULE_SET_AUDIT_TABLE, recordId: id,
    oldData: auditView({ ...prior, bands: [] }, prior.bands.map((b) => ({ ...b }))), newData: auditView(full, bands),
  });
  return getRuleSet(id);
}

/** Pasife al / yeniden etkinleştir (tek aktif FACTORY ve müşteri kapsamı partial unique ile korunur). */
export async function setRuleSetActive(id: string, isActive: boolean, userId: string) {
  const prior = await getRuleSet(id);
  if (prior.isActive === isActive) return prior;
  try {
    await prisma.fourPointRuleSet.update({ where: { id }, data: { isActive, updatedById: userId } });
  } catch (err) {
    throw uniqueConflict(err) ?? err;
  }
  await AuditService.log({ userId, action: "UPDATE", tableName: RULE_SET_AUDIT_TABLE, recordId: id, oldData: { isActive: prior.isActive }, newData: { isActive } });
  return getRuleSet(id);
}
