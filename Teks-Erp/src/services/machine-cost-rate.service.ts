// =============================================================================
// MAKİNE SAAT ÜCRETİ (MachineCostRate) — D4-G1a, ister 4.9/5.10 kârlılık zemini
// =============================================================================
// ③a damgalı sürüm, "şu andan itibaren" (geri tarih yok): yaratma yeni satır; değişim aynı tx'te eski
// satırın damgası (`updateMany WHERE {id, revokedAt:null}`, 0 → 409) + yeni satır; kaldırma damgadır.
// Yaratma/değişim `clientToken` taşır, replay TEK boğazdan (`tokenReplay`, R kipi). Okuma yalnız
// `cost-rate-validity.helper`; audit tx DIŞINDA ve ücret DEĞERİ taşımaz (yalnız kimlik + alan adları).
// =============================================================================
import type { MachineCostRate, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { isClientTokenP2002, p2002Mentions } from "../utils/p2002";
import { AuditService } from "./audit.service";
import { tokenReplay } from "./helpers/token-replay.helper";
import { ACTIVE_COST_RATE, COST_RATE_REVOKE_REASON } from "./helpers/cost-rate-validity.helper";
import { parseDecimalField, parseTextField } from "./helpers/cost-input.helper";

const TABLE = "MACHINE_COST_RATE";

export const MACHINE_COST_RATE_SELECT = {
  id: true,
  machineId: true,
  hourRateTry: true,
  normMPerHour: true,
  note: true,
  createdAt: true,
  createdById: true,
  revokedAt: true,
  revokedById: true,
  revokeReason: true,
  machine: { select: { id: true, code: true, name: true, isActive: true } },
} satisfies Prisma.MachineCostRateSelect;

export type MachineCostRateRow = Prisma.MachineCostRateGetPayload<{ select: typeof MACHINE_COST_RATE_SELECT }>;

export interface MachineCostRateValues {
  hourRateTry: unknown;
  normMPerHour?: unknown;
  note?: unknown;
  clientToken: string;
}

interface ParsedValues {
  hourRateTry: Prisma.Decimal;
  normMPerHour: Prisma.Decimal | null;
  note: string | null;
}

export interface MachineCostRateResult {
  row: MachineCostRateRow;
  previousId: string | null;
}

function parseValues(input: MachineCostRateValues): ParsedValues {
  const hourRateTry = parseDecimalField(input.hourRateTry, { label: "Saat ücreti (TL)", min: 0, scale: 4 });
  if (hourRateTry === null || hourRateTry === undefined) throw AppError.badRequest("Saat ücreti (TL) zorunludur.");
  const normMPerHour = parseDecimalField(input.normMPerHour, { label: "Beklenen metre/saat", min: 0, minExclusive: true, scale: 2 }) ?? null;
  const note = parseTextField(input.note, "Not", 300) ?? null;
  return { hourRateTry, normMPerHour, note };
}

const conflict = (message: string, code: string, extra: Record<string, unknown> = {}): AppError => AppError.conflict(message, { code, ...extra });

const rateReplay = (machineId: string, values: ParsedValues) =>
  tokenReplay<MachineCostRate, MachineCostRateResult>({
    find: (db, clientToken) => db.machineCostRate.findUnique({ where: { clientToken } }),
    alive: (prior) => {
      if (!prior.revokedAt) return;
      throw conflict("Bu saat ücreti yazılmış ama sonra değiştirilmiş ya da kaldırılmış — listeyi yenileyip formu yeniden açın.", "COST_RATE_SUPERSEDED", { rateId: prior.id });
    },
    identity: (prior) => [
      { ad: "machineId", mevcut: prior.machineId, gelen: machineId },
      { ad: "hourRateTry", mevcut: prior.hourRateTry, gelen: values.hourRateTry },
    ],
    collision: "Bu istemci anahtarı FARKLI bir saat ücreti için kullanılmış. Formu kapatıp yeniden açın.",
    collisionEk: (prior) => ({ rateId: prior.id }),
    respond: async (prior) => ({
      row: await prisma.machineCostRate.findUniqueOrThrow({ where: { id: prior.id }, select: MACHINE_COST_RATE_SELECT }),
      previousId: null,
    }),
  });

async function assertMachineWritable(machineId: string): Promise<void> {
  const machine = await prisma.machine.findUnique({ where: { id: machineId }, select: { name: true, isActive: true } });
  if (!machine) throw AppError.notFound("Makine bulunamadı.", { code: "MACHINE_NOT_FOUND" });
  if (!machine.isActive) throw conflict(`"${machine.name}" pasif — saat ücreti yazılamaz.`, "MACHINE_INACTIVE", { machineId });
}

function activeExists(machineId: string): AppError {
  return conflict("Bu makinenin zaten aktif bir saat ücreti var — değiştirmek için mevcut satırı değiştirin.", "COST_RATE_ACTIVE_EXISTS", { machineId });
}

function logAudit(userId: string, action: "CREATE" | "UPDATE", recordId: string, newData: Record<string, unknown>): void {
  void AuditService.log({ userId, action, tableName: TABLE, recordId, newData }).catch(() => undefined);
}

export async function listMachineCostRates(opts: {
  machineId: string | { in: string[] } | null;
  includeRevoked: boolean;
}): Promise<MachineCostRateRow[]> {
  return prisma.machineCostRate.findMany({
    where: { AND: [opts.machineId ? { machineId: opts.machineId } : {}, opts.includeRevoked ? {} : ACTIVE_COST_RATE] },
    select: MACHINE_COST_RATE_SELECT,
    orderBy: [{ machineId: "asc" }, { createdAt: "desc" }, { id: "desc" }],
  });
}

/** Ücret ekranının makine seçenekleri (D4-KUC3a): `station:read` taşımayan Muhasebe de ücretsiz makineye ücret
 *  girebilsin diye `cost:read` kapsamlı hafif liste — yalnız aktif makinenin id/kod/adı (istasyon ayrıntısı yok). */
export async function listMachineCostOptions(): Promise<Array<{ id: string; code: string; name: string }>> {
  return prisma.machine.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: [{ code: "asc" }, { id: "asc" }] });
}

/** YARAT — makinenin ilk (ya da kaldırılmış sonrası) ücreti; aktif varsa 409 (değişim ayrı uçtur). */
export async function createMachineCostRate(machineId: string, input: MachineCostRateValues, userId: string): Promise<MachineCostRateResult> {
  const values = parseValues(input);
  return rateReplay(machineId, values).run(input.clientToken, async () => {
    await assertMachineWritable(machineId);
    const current = await prisma.machineCostRate.findFirst({ where: { machineId, ...ACTIVE_COST_RATE }, select: { id: true } });
    if (current) throw activeExists(machineId);
    let created: { id: string };
    try {
      created = await prisma.machineCostRate.create({
        data: { machineId, ...values, clientToken: input.clientToken, createdById: userId },
        select: { id: true },
      });
    } catch (e) {
      if (isClientTokenP2002(e)) throw e;
      if (p2002Mentions(e, /machine_cost_rates_active_machine_uq|machineId/i)) throw activeExists(machineId);
      throw e;
    }
    logAudit(userId, "CREATE", created.id, { machineId, alanlar: ["hourRateTry", "normMPerHour", "note"] });
    return { row: await prisma.machineCostRate.findUniqueOrThrow({ where: { id: created.id }, select: MACHINE_COST_RATE_SELECT }), previousId: null };
  });
}

/** DEĞİŞTİR — aynı tx'te eski aktif satırın damgası + yeni satır; eski satır artık aktif değilse 409 `COST_RATE_STALE`. */
export async function changeMachineCostRate(rateId: string, input: MachineCostRateValues, userId: string): Promise<MachineCostRateResult> {
  const values = parseValues(input);
  const old = await prisma.machineCostRate.findUnique({ where: { id: rateId }, select: { id: true, machineId: true } });
  if (!old) throw AppError.notFound("Saat ücreti bulunamadı.", { code: "COST_RATE_NOT_FOUND" });
  return rateReplay(old.machineId, values).run(input.clientToken, async () => {
    await assertMachineWritable(old.machineId);
    const at = new Date();
    let created: { id: string };
    try {
      created = await prisma.$transaction(async (tx) => {
        const claim = await tx.machineCostRate.updateMany({
          where: { id: rateId, revokedAt: null },
          data: { revokedAt: at, revokedById: userId, revokeReason: COST_RATE_REVOKE_REASON.CHANGED },
        });
        if (claim.count === 0) {
          throw conflict("Bu saat ücreti aynı anda başka bir işlemle değişti ya da kaldırıldı — listeyi yenileyin.", "COST_RATE_STALE", { rateId });
        }
        return tx.machineCostRate.create({
          data: { machineId: old.machineId, ...values, clientToken: input.clientToken, createdById: userId, createdAt: at },
          select: { id: true },
        });
      });
    } catch (e) {
      if (isClientTokenP2002(e)) throw e;
      if (p2002Mentions(e, /machine_cost_rates_active_machine_uq|machineId/i)) throw activeExists(old.machineId);
      throw e;
    }
    logAudit(userId, "UPDATE", rateId, { machineId: old.machineId, revokeReason: COST_RATE_REVOKE_REASON.CHANGED, yeniSurumId: created.id });
    logAudit(userId, "CREATE", created.id, { machineId: old.machineId, oncekiSurumId: rateId, alanlar: ["hourRateTry", "normMPerHour", "note"] });
    return {
      row: await prisma.machineCostRate.findUniqueOrThrow({ where: { id: created.id }, select: MACHINE_COST_RATE_SELECT }),
      previousId: rateId,
    };
  });
}

/** KALDIR — damga (satır silinmez); zaten damgalıysa 409. */
export async function revokeMachineCostRate(rateId: string, reason: string | null, userId: string): Promise<{ id: string }> {
  const row = await prisma.machineCostRate.findUnique({ where: { id: rateId }, select: { id: true, machineId: true, revokedAt: true } });
  if (!row) throw AppError.notFound("Saat ücreti bulunamadı.", { code: "COST_RATE_NOT_FOUND" });
  const stale = () => conflict("Bu saat ücreti zaten kaldırılmış ya da değiştirilmiş — listeyi yenileyin.", "COST_RATE_STALE", { rateId });
  if (row.revokedAt) throw stale();
  const claim = await prisma.machineCostRate.updateMany({
    where: { id: rateId, revokedAt: null },
    data: { revokedAt: new Date(), revokedById: userId, revokeReason: reason?.trim() || COST_RATE_REVOKE_REASON.REMOVED },
  });
  if (claim.count === 0) throw stale();
  logAudit(userId, "UPDATE", rateId, { machineId: row.machineId, kaldirildi: true });
  return { id: rateId };
}
