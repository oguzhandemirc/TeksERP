// =============================================================================
// TeksERP — TEZGAH ALARMI SORUMLULARI (A4) · tanım yüzeyi
// =============================================================================
// Üç yapılandırma tablosunun TEK yazarı: hol × vardiya sorumlusu (`HallShiftResponsible`), tek vardiya
// penceresinde nöbet değişikliği (`HallShiftDutyOverride`), kademe kuralı (`LoomAlarmTierRule`).
//   • Silme yok: kaldırma `revokedAt/revokedById` durum geçişidir (atomik claim, count 0 → tanı).
//   • Geçmiş değişmez: alıcı kademe çaldığı an RAISED'a donar; bitmiş vardiyaya nöbet yazılmaz/kaldırılmaz.
//   • Yaratma `clientToken` + `tokenReplay` (R); tekillik partial unique (kilit gerekmez).
//   • Alarmı göremeyen kişiye atama yapılır ama UYARI döner — çözüm o kişiyi düşürür (yetki genişlemez).
// Audit best-effort, tx dışında.
// =============================================================================
import { LoomAlarmRuleRecipientKind, StationKind, type Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { p2002Mentions } from "../utils/p2002";
import { AuditService } from "./audit.service";
import { readDbNow } from "./helpers/machine-run-open.helper";
import { tokenReplay } from "./helpers/token-replay.helper";
import { ALARM_ESCALATION_PERMISSION, ALARM_VIEW_PERMISSION, hasAlarmEscalation, hasAlarmView, loadEffectiveGrants } from "./helpers/loom-alarm-recipient.helper";
import { PERMISSION_CATALOG } from "../constants/permission-catalog";
import { factoryDayStart, resolveRangeEnd, resolveRangeStart } from "../constants/time";
import type { ApiResponse } from "../types/api.types";

const DAY_MS = 86_400_000;
/** Geçmiş nöbet değişiklikleri listede bu kadar gün geriye kadar görünür (salt-okunur). */
export const DUTY_OVERRIDE_HISTORY_DAYS = 7;
export const SHIFT_WINDOW_MAX_DAYS = 62;

export const AUDIT_TABLE = {
  responsible: "LOOM_ALARM_RESPONSIBLE",
  override: "LOOM_ALARM_DUTY_OVERRIDE",
  rule: "LOOM_ALARM_TIER_RULE",
} as const;

export interface DutyPersonDto { id: string; name: string; canViewAlarms: boolean }
export interface DutyResponsibleDto {
  id: string; tier: number; createdAt: Date;
  station: { id: string; name: string };
  shiftDefinition: { id: string; code: string; name: string };
  user: DutyPersonDto;
}
export interface DutyShiftInstanceDto {
  id: string; factoryDayKey: Date; startsAt: Date; endsAt: Date; isCancelled: boolean; ended: boolean;
  shiftDefinition: { id: string; code: string; name: string };
}
export interface DutyOverrideDto {
  id: string; tier: number; note: string | null; createdAt: Date;
  shiftInstance: DutyShiftInstanceDto;
  station: { id: string; name: string };
  user: DutyPersonDto;
}
export interface TierRuleDto {
  id: string; tier: number; kind: LoomAlarmRuleRecipientKind; permissionCode: string | null; createdAt: Date;
  user: DutyPersonDto | null;
}
export interface LoomAlarmDutyOverviewDto {
  responsibles: DutyResponsibleDto[];
  overrides: DutyOverrideDto[];
  rules: TierRuleDto[];
  /** Alarmı göremeyen atanmış kişiler — bildirim gitmez. */
  warnings: string[];
}
export interface DutyCandidateDto { id: string; name: string; canViewAlarms: boolean; canEscalate: boolean }

const PERSON = { select: { id: true, fullName: true } } as const;
const DEF = { select: { id: true, code: true, name: true } } as const;
const INSTANCE_SELECT = { id: true, factoryDayKey: true, startsAt: true, endsAt: true, isCancelled: true, shiftDefinition: DEF } satisfies Prisma.ShiftInstanceSelect;
const RESPONSIBLE_SELECT = {
  id: true, tier: true, createdAt: true, revokedAt: true, stationId: true, shiftDefinitionId: true, userId: true,
  station: { select: { id: true, name: true } }, shiftDefinition: DEF, user: PERSON,
} satisfies Prisma.HallShiftResponsibleSelect;
const OVERRIDE_SELECT = {
  id: true, tier: true, note: true, createdAt: true, revokedAt: true, shiftInstanceId: true, stationId: true, userId: true,
  shiftInstance: { select: INSTANCE_SELECT }, station: { select: { id: true, name: true } }, user: PERSON,
} satisfies Prisma.HallShiftDutyOverrideSelect;
const RULE_SELECT = { id: true, tier: true, kind: true, permissionCode: true, createdAt: true, revokedAt: true, userId: true, user: PERSON } satisfies Prisma.LoomAlarmTierRuleSelect;
type ResponsibleRow = Prisma.HallShiftResponsibleGetPayload<{ select: typeof RESPONSIBLE_SELECT }>;
type OverrideRow = Prisma.HallShiftDutyOverrideGetPayload<{ select: typeof OVERRIDE_SELECT }>;
type RuleRow = Prisma.LoomAlarmTierRuleGetPayload<{ select: typeof RULE_SELECT }>;

type Grants = Map<string, string[]>;
const canView = (g: Grants, userId: string): boolean => hasAlarmView(g.get(userId) ?? []);
const personDto = (u: { id: string; fullName: string }, g: Grants): DutyPersonDto => ({ id: u.id, name: u.fullName, canViewAlarms: canView(g, u.id) });
const instanceDto = (s: Prisma.ShiftInstanceGetPayload<{ select: typeof INSTANCE_SELECT }>, now: Date): DutyShiftInstanceDto => ({
  id: s.id, factoryDayKey: s.factoryDayKey, startsAt: s.startsAt, endsAt: s.endsAt, isCancelled: s.isCancelled, ended: s.endsAt.getTime() <= now.getTime(),
  shiftDefinition: s.shiftDefinition,
});
const responsibleDto = (r: ResponsibleRow, g: Grants): DutyResponsibleDto => ({
  id: r.id, tier: r.tier, createdAt: r.createdAt, station: r.station, shiftDefinition: r.shiftDefinition, user: personDto(r.user, g),
});
const overrideDto = (o: OverrideRow, g: Grants, now: Date): DutyOverrideDto => ({
  id: o.id, tier: o.tier, note: o.note, createdAt: o.createdAt, shiftInstance: instanceDto(o.shiftInstance, now), station: o.station, user: personDto(o.user, g),
});
const ruleDto = (r: RuleRow, g: Grants): TierRuleDto => ({
  id: r.id, tier: r.tier, kind: r.kind, permissionCode: r.permissionCode, createdAt: r.createdAt, user: r.user ? personDto(r.user, g) : null,
});

const noViewWarning = (name: string): string =>
  `${name} alarm görme yetkisine (loom:alarm-view) sahip değil — bildirim ona GİTMEZ. Kişiye yetkiyi verin ya da başkasını atayın.`;

async function grantsFor(userIds: readonly string[], now: Date): Promise<Grants> {
  if (userIds.length === 0) return new Map();
  return loadEffectiveGrants(prisma, [ALARM_VIEW_PERMISSION, ALARM_ESCALATION_PERMISSION], now, [...new Set(userIds)]);
}

// ── OKUMA ───────────────────────────────────────────────────────────────────
export async function getLoomAlarmDutyOverview(): Promise<LoomAlarmDutyOverviewDto> {
  const now = await readDbNow();
  const responsibles = await prisma.hallShiftResponsible.findMany({
    where: { revokedAt: null }, select: RESPONSIBLE_SELECT, orderBy: [{ tier: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const overrides = await prisma.hallShiftDutyOverride.findMany({
    where: { revokedAt: null, shiftInstance: { endsAt: { gte: new Date(now.getTime() - DUTY_OVERRIDE_HISTORY_DAYS * DAY_MS) } } },
    select: OVERRIDE_SELECT, orderBy: [{ shiftInstance: { startsAt: "asc" } }, { tier: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const rules = await prisma.loomAlarmTierRule.findMany({ where: { revokedAt: null }, select: RULE_SELECT, orderBy: [{ tier: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
  const g = await grantsFor([...responsibles.map((r) => r.userId), ...overrides.map((o) => o.userId), ...rules.flatMap((r) => (r.userId ? [r.userId] : []))], now);
  const warnings = new Set<string>();
  for (const u of [...responsibles.map((r) => r.user), ...overrides.filter((o) => o.shiftInstance.endsAt > now).map((o) => o.user), ...rules.flatMap((r) => (r.user ? [r.user] : []))]) {
    if (!canView(g, u.id)) warnings.add(noViewWarning(u.fullName));
  }
  return {
    responsibles: responsibles.map((r) => responsibleDto(r, g)),
    overrides: overrides.map((o) => overrideDto(o, g, now)),
    rules: rules.map((r) => ruleDto(r, g)),
    warnings: [...warnings],
  };
}

export interface DutyOptionsDto {
  halls: Array<{ id: string; name: string }>;
  shifts: Array<{ id: string; code: string; name: string }>;
  permissions: Array<{ code: string; description: string }>;
}

/** Ekranın başvuru verisi tek uçtan: dokuma holleri, aktif vardiya tanımları, yetki kataloğu (ayrı okuma izni istemez). */
export async function getDutyOptions(): Promise<DutyOptionsDto> {
  const halls = await prisma.station.findMany({ where: { kind: StationKind.WEAVING, isActive: true }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
  const shifts = await prisma.shiftDefinition.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
  return { halls, shifts, permissions: PERMISSION_CATALOG.map((p) => ({ code: p.code, description: p.description })) };
}

/** Atanabilir kişiler: aktif, sistem dışı kullanıcılar + alarm yetkileri (seçicide uyarı için). */
export async function listDutyCandidates(): Promise<DutyCandidateDto[]> {
  const now = await readDbNow();
  const users = await prisma.user.findMany({ where: { isActive: true, isSystemAccount: false }, select: { id: true, fullName: true }, orderBy: [{ fullName: "asc" }, { id: "asc" }] });
  const g = await loadEffectiveGrants(prisma, [ALARM_VIEW_PERMISSION, ALARM_ESCALATION_PERMISSION], now);
  return users.map((u) => ({
    id: u.id, name: u.fullName, canViewAlarms: canView(g, u.id), canEscalate: hasAlarmEscalation(g.get(u.id) ?? []),
  }));
}

/** Nöbet değişikliği için vardiya pencereleri — varsayılan bugün + 7 gün (fabrika günü). */
export async function listDutyShiftInstances(q: { from?: string; to?: string }): Promise<DutyShiftInstanceDto[]> {
  const now = await readDbNow();
  const from = q.from ? resolveRangeStart(q.from) : factoryDayStart(now);
  const to = q.to ? resolveRangeEnd(q.to) : new Date(from.getTime() + 8 * DAY_MS);
  if (to.getTime() < from.getTime()) throw AppError.badRequest("Bitiş tarihi başlangıçtan önce olamaz", { code: "INVALID_RANGE" });
  if (to.getTime() - from.getTime() > SHIFT_WINDOW_MAX_DAYS * DAY_MS) {
    throw AppError.badRequest(`Aralık en fazla ${SHIFT_WINDOW_MAX_DAYS} gün olabilir`, { code: "RANGE_TOO_LONG" });
  }
  const rows = await prisma.shiftInstance.findMany({
    where: { startsAt: { lt: to }, endsAt: { gt: from } }, select: INSTANCE_SELECT, orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });
  return rows.map((s) => instanceDto(s, now));
}

// ── ORTAK DOĞRULAMA ─────────────────────────────────────────────────────────
async function assertAssignableUser(userId: string): Promise<{ id: string; fullName: string }> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, fullName: true, isActive: true, isSystemAccount: true } });
  if (!u || !u.isActive || u.isSystemAccount) throw AppError.badRequest("Kişi bulunamadı ya da pasif", { code: "DUTY_USER_INVALID" });
  return u;
}

async function assertWeavingHall(stationId: string): Promise<void> {
  const s = await prisma.station.findUnique({ where: { id: stationId }, select: { isActive: true, kind: true } });
  if (!s || !s.isActive || s.kind !== "WEAVING") throw AppError.badRequest("Hol bulunamadı ya da dokuma holü değil", { code: "DUTY_HALL_INVALID" });
}

async function warningsForUser(userId: string, name: string): Promise<string[] | undefined> {
  const g = await grantsFor([userId], await readDbNow());
  return canView(g, userId) ? undefined : [noViewWarning(name)];
}

const revokedReplay = (what: string) =>
  AppError.conflict(`Bu ${what} sonradan kaldırıldı — aynı işlem tekrar gönderilemez; formu yeniden açın.`, { code: "CLIENT_TOKEN_REVOKED" });

function duplicate(err: unknown, re: RegExp, message: string): never {
  if (p2002Mentions(err, re)) throw AppError.conflict(message, { code: "DUTY_ALREADY_ASSIGNED" });
  throw err;
}

/** Kaldırma claim'i düştü: tanı taze okumayla (yok · zaten kaldırılmış · vardiya bitmiş). */
function revokeConflict(row: { revokedAt: Date | null } | null, what: string, ended = false): never {
  if (!row) throw AppError.notFound(`${what} bulunamadı`, { code: "DUTY_NOT_FOUND" });
  if (row.revokedAt) throw AppError.conflict(`${what} zaten kaldırılmış`, { code: "DUTY_ALREADY_REVOKED" });
  if (ended) throw AppError.conflict("Vardiya bitmiş — geçmiş nöbet değiştirilemez", { code: "SHIFT_INSTANCE_ENDED" });
  throw AppError.conflict(`${what} kaldırılamadı — ekranı yenileyin`, { code: "DUTY_REVOKE_CONFLICT" });
}

// ── HOL × VARDİYA SORUMLUSU ─────────────────────────────────────────────────
export interface ResponsibleInput { stationId: string; shiftDefinitionId: string; tier: 1 | 2; userId: string; clientToken: string }

function responsibleReplay(input: ResponsibleInput) {
  return tokenReplay<ResponsibleRow, ApiResponse<DutyResponsibleDto>>({
    find: (db, clientToken) => db.hallShiftResponsible.findUnique({ where: { clientToken }, select: RESPONSIBLE_SELECT }),
    alive: (p) => { if (p.revokedAt) throw revokedReplay("sorumlu ataması"); },
    identity: (p) => [
      { ad: "stationId", mevcut: p.stationId, gelen: input.stationId },
      { ad: "shiftDefinitionId", mevcut: p.shiftDefinitionId, gelen: input.shiftDefinitionId },
      { ad: "tier", mevcut: p.tier, gelen: input.tier },
      { ad: "userId", mevcut: p.userId, gelen: input.userId },
    ],
    collision: "Bu işlem kimliği başka bir sorumlu atamasına ait; formu yeniden açın.",
    respond: async (p) => ({ success: true, data: responsibleDto(p, await grantsFor([p.userId], await readDbNow())), message: "Sorumlu zaten atanmış." }),
  });
}

export async function createHallShiftResponsible(input: ResponsibleInput, actorId: string): Promise<ApiResponse<DutyResponsibleDto>> {
  return responsibleReplay(input).run(input.clientToken, async () => {
    await assertWeavingHall(input.stationId);
    const def = await prisma.shiftDefinition.findUnique({ where: { id: input.shiftDefinitionId }, select: { isActive: true } });
    if (!def || !def.isActive) throw AppError.badRequest("Vardiya tanımı bulunamadı ya da arşivde", { code: "DUTY_SHIFT_INVALID" });
    const user = await assertAssignableUser(input.userId);
    const row = await prisma.hallShiftResponsible
      .create({
        data: { stationId: input.stationId, shiftDefinitionId: input.shiftDefinitionId, tier: input.tier, userId: input.userId, clientToken: input.clientToken, createdById: actorId },
        select: RESPONSIBLE_SELECT,
      })
      .catch((e: unknown) => duplicate(e, /hall_shift_responsibles_live_uq/, `${user.fullName} bu hol ve vardiyada bu kademeye zaten atanmış`));
    await AuditService.log({ userId: actorId, action: "CREATE", tableName: AUDIT_TABLE.responsible, recordId: row.id, newData: { stationId: row.stationId, shiftDefinitionId: row.shiftDefinitionId, tier: row.tier, userId: row.userId } });
    const warnings = await warningsForUser(user.id, user.fullName);
    return { success: true, data: responsibleDto(row, await grantsFor([row.userId], await readDbNow())), message: "Sorumlu atandı.", ...(warnings ? { warnings } : {}) };
  });
}

export async function revokeHallShiftResponsible(id: string, actorId: string): Promise<ApiResponse<{ id: string; revokedAt: Date }>> {
  const now = await readDbNow();
  const r = await prisma.hallShiftResponsible.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now, revokedById: actorId } });
  if (r.count === 0) revokeConflict(await prisma.hallShiftResponsible.findUnique({ where: { id }, select: { revokedAt: true } }), "Sorumlu ataması");
  await AuditService.log({ userId: actorId, action: "UPDATE", tableName: AUDIT_TABLE.responsible, recordId: id, oldData: { revokedAt: null }, newData: { revokedAt: now } });
  return { success: true, data: { id, revokedAt: now }, message: "Sorumlu kaldırıldı; geçmiş alarmların alıcısı değişmez." };
}

// ── NÖBET DEĞİŞİKLİĞİ ───────────────────────────────────────────────────────
export interface OverrideInput { shiftInstanceId: string; stationId: string; tier: 1 | 2; userId: string; note?: string | null; clientToken: string }

function overrideReplay(input: OverrideInput) {
  return tokenReplay<OverrideRow, ApiResponse<DutyOverrideDto>>({
    find: (db, clientToken) => db.hallShiftDutyOverride.findUnique({ where: { clientToken }, select: OVERRIDE_SELECT }),
    alive: (p) => { if (p.revokedAt) throw revokedReplay("nöbet değişikliği"); },
    identity: (p) => [
      { ad: "shiftInstanceId", mevcut: p.shiftInstanceId, gelen: input.shiftInstanceId },
      { ad: "stationId", mevcut: p.stationId, gelen: input.stationId },
      { ad: "tier", mevcut: p.tier, gelen: input.tier },
      { ad: "userId", mevcut: p.userId, gelen: input.userId },
    ],
    collision: "Bu işlem kimliği başka bir nöbet değişikliğine ait; formu yeniden açın.",
    respond: async (p) => {
      const now = await readDbNow();
      return { success: true, data: overrideDto(p, await grantsFor([p.userId], now), now), message: "Nöbet değişikliği zaten kayıtlı." };
    },
  });
}

export async function createHallShiftDutyOverride(input: OverrideInput, actorId: string): Promise<ApiResponse<DutyOverrideDto>> {
  return overrideReplay(input).run(input.clientToken, async () => {
    const now = await readDbNow();
    const inst = await prisma.shiftInstance.findUnique({ where: { id: input.shiftInstanceId }, select: { isCancelled: true, endsAt: true } });
    if (!inst) throw AppError.badRequest("Vardiya penceresi bulunamadı", { code: "SHIFT_INSTANCE_NOT_FOUND" });
    if (inst.isCancelled) throw AppError.badRequest("Vardiya iptal edilmiş — nöbet yazılamaz", { code: "SHIFT_INSTANCE_CANCELLED" });
    if (inst.endsAt.getTime() <= now.getTime()) throw AppError.badRequest("Vardiya bitmiş — geçmiş nöbet değiştirilemez", { code: "SHIFT_INSTANCE_ENDED" });
    await assertWeavingHall(input.stationId);
    const user = await assertAssignableUser(input.userId);
    const note = input.note?.trim() ? input.note.trim() : null;
    const row = await prisma.hallShiftDutyOverride
      .create({
        data: { shiftInstanceId: input.shiftInstanceId, stationId: input.stationId, tier: input.tier, userId: input.userId, note, clientToken: input.clientToken, createdById: actorId },
        select: OVERRIDE_SELECT,
      })
      .catch((e: unknown) => duplicate(e, /hall_shift_duty_overrides_live_uq/, `${user.fullName} bu vardiyada bu hol ve kademe için zaten nöbetçi`));
    await AuditService.log({ userId: actorId, action: "CREATE", tableName: AUDIT_TABLE.override, recordId: row.id, newData: { shiftInstanceId: row.shiftInstanceId, stationId: row.stationId, tier: row.tier, userId: row.userId, note } });
    const warnings = await warningsForUser(user.id, user.fullName);
    return { success: true, data: overrideDto(row, await grantsFor([row.userId], now), now), message: "Nöbet değişikliği kaydedildi.", ...(warnings ? { warnings } : {}) };
  });
}

export async function revokeHallShiftDutyOverride(id: string, actorId: string): Promise<ApiResponse<{ id: string; revokedAt: Date }>> {
  const now = await readDbNow();
  const r = await prisma.hallShiftDutyOverride.updateMany({
    where: { id, revokedAt: null, shiftInstance: { endsAt: { gt: now } } },
    data: { revokedAt: now, revokedById: actorId },
  });
  if (r.count === 0) {
    const row = await prisma.hallShiftDutyOverride.findUnique({ where: { id }, select: { revokedAt: true, shiftInstance: { select: { endsAt: true } } } });
    revokeConflict(row, "Nöbet değişikliği", row !== null && row.shiftInstance.endsAt.getTime() <= now.getTime());
  }
  await AuditService.log({ userId: actorId, action: "UPDATE", tableName: AUDIT_TABLE.override, recordId: id, oldData: { revokedAt: null }, newData: { revokedAt: now } });
  return { success: true, data: { id, revokedAt: now }, message: "Nöbet değişikliği kaldırıldı; vardiyanın daimi sorumluları geçerli." };
}

// ── KADEME KURALI ───────────────────────────────────────────────────────────
export interface RuleInput { tier: 1 | 2; kind: LoomAlarmRuleRecipientKind; userId?: string | null; permissionCode?: string | null; clientToken: string }

const CATALOG_CODES = new Set<string>(PERMISSION_CATALOG.map((p) => p.code));

function ruleReplay(input: RuleInput) {
  return tokenReplay<RuleRow, ApiResponse<TierRuleDto>>({
    find: (db, clientToken) => db.loomAlarmTierRule.findUnique({ where: { clientToken }, select: RULE_SELECT }),
    alive: (p) => { if (p.revokedAt) throw revokedReplay("kademe kuralı"); },
    identity: (p) => [
      { ad: "tier", mevcut: p.tier, gelen: input.tier },
      { ad: "kind", mevcut: p.kind, gelen: input.kind },
      { ad: "userId", mevcut: p.userId, gelen: input.userId ?? null },
      { ad: "permissionCode", mevcut: p.permissionCode, gelen: input.permissionCode ?? null },
    ],
    collision: "Bu işlem kimliği başka bir kademe kuralına ait; formu yeniden açın.",
    respond: async (p) => ({ success: true, data: ruleDto(p, await grantsFor(p.userId ? [p.userId] : [], await readDbNow())), message: "Kural zaten kayıtlı." }),
  });
}

export async function createLoomAlarmTierRule(input: RuleInput, actorId: string): Promise<ApiResponse<TierRuleDto>> {
  return ruleReplay(input).run(input.clientToken, async () => {
    const userId = input.kind === LoomAlarmRuleRecipientKind.USER ? (input.userId ?? null) : null;
    const permissionCode = input.kind === LoomAlarmRuleRecipientKind.PERMISSION ? (input.permissionCode ?? null) : null;
    if (input.kind === LoomAlarmRuleRecipientKind.USER && !userId) throw AppError.badRequest("Kişi kuralı için kişi seçin", { code: "DUTY_RULE_INVALID" });
    if (input.kind === LoomAlarmRuleRecipientKind.PERMISSION && (!permissionCode || !CATALOG_CODES.has(permissionCode))) {
      throw AppError.badRequest("Yetki kuralı için katalogdaki bir yetki kodu seçin", { code: "DUTY_RULE_INVALID" });
    }
    if (input.kind !== LoomAlarmRuleRecipientKind.USER && input.userId) throw AppError.badRequest("Bu kural türü kişi almaz", { code: "DUTY_RULE_INVALID" });
    if (input.kind !== LoomAlarmRuleRecipientKind.PERMISSION && input.permissionCode) throw AppError.badRequest("Bu kural türü yetki kodu almaz", { code: "DUTY_RULE_INVALID" });
    const user = userId ? await assertAssignableUser(userId) : null;
    const row = await prisma.loomAlarmTierRule
      .create({ data: { tier: input.tier, kind: input.kind, userId, permissionCode, clientToken: input.clientToken, createdById: actorId }, select: RULE_SELECT })
      .catch((e: unknown) => duplicate(e, /loom_alarm_tier_rules_live_uq/, "Bu kademede aynı kural zaten var"));
    await AuditService.log({ userId: actorId, action: "CREATE", tableName: AUDIT_TABLE.rule, recordId: row.id, newData: { tier: row.tier, kind: row.kind, userId, permissionCode } });
    const warnings = user ? await warningsForUser(user.id, user.fullName) : undefined;
    return { success: true, data: ruleDto(row, await grantsFor(userId ? [userId] : [], await readDbNow())), message: "Kademe kuralı eklendi.", ...(warnings ? { warnings } : {}) };
  });
}

export async function revokeLoomAlarmTierRule(id: string, actorId: string): Promise<ApiResponse<{ id: string; revokedAt: Date }>> {
  const now = await readDbNow();
  const r = await prisma.loomAlarmTierRule.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now, revokedById: actorId } });
  if (r.count === 0) revokeConflict(await prisma.loomAlarmTierRule.findUnique({ where: { id }, select: { revokedAt: true } }), "Kademe kuralı");
  await AuditService.log({ userId: actorId, action: "UPDATE", tableName: AUDIT_TABLE.rule, recordId: id, oldData: { revokedAt: null }, newData: { revokedAt: now } });
  return { success: true, data: { id, revokedAt: now }, message: "Kademe kuralı kaldırıldı." };
}
