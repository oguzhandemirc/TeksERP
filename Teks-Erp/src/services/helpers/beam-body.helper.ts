// =============================================================================
// LEVENT GÖVDESİ DEFTERİ TEK YAZICISI — kart durumu + olay satırı AYNI tx'te (devere ek B1)
// =============================================================================
// Gövde durumu yalnız buradan değişir: doğuş `registerBeamBodyTx` (kart + REGISTER), geçiş `transitionBeamBodyTx`
// (claim `updateMany WHERE {id, status=from, isActive}` + olay), ters `reverseBeamBodyEventTx` (tipli `*_CANCEL`,
// `reversesId` tek ters). Kilit sırası sarım → gövde (B3 kancası `applyWarpBeamEventTx`ten sonra çağırır).
// Uç kapısı (`beamBodyMode`) ve gövde–tezgâh uyum kararı da burada: aynı soruyu tek yer cevaplar.
// =============================================================================
import { BeamBodyStatus, Prisma, type BeamBodyOwnerRole } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { readDevereBeamBodyMachineFit, readDevereBeamBodyMode, readDevereEnabled } from "../system-setting.service";
import { settingRowPath, settingScreenPath } from "../../constants/panel-ayar-yolu";
import { BEAM_BODY_STATUS_LABELS, cancelKindOf, type BeamBodyEventKind, type BeamBodyForwardKind } from "../../constants/beam-body";
import { beamBodyEventStampTx } from "./ledger-stamp.helper";

type Tx = Prisma.TransactionClient;
type SettingDb = Pick<Prisma.TransactionClient, "systemSetting">;

export const BEAM_BODY_TABLE = "BEAM_BODY";
export const BEAM_BODY_EVENT_TABLE = "BEAM_BODY_EVENT";

export const BEAM_BODY_EVENT_SELECT = {
  id: true, kind: true, fromStatus: true, toStatus: true, reversesId: true, reasonCode: true, reason: true, createdAt: true, createdById: true,
  warehouse: { select: { id: true, name: true } },
  subcontractor: { select: { id: true, name: true } },
  machine: { select: { id: true, code: true, name: true } },
  warpBeam: { select: { id: true, beamNo: true } },
} satisfies Prisma.BeamBodyEventSelect;
export type BeamBodyEventRow = Prisma.BeamBodyEventGetPayload<{ select: typeof BEAM_BODY_EVENT_SELECT }>;

/** "Şu an nerede" üçlüsü — CHECK `beam_bodies_location_ck` ile aynı anlam. */
export interface BeamBodyPlace {
  warehouseId: string | null;
  subcontractorId: string | null;
  machineId: string | null;
}

/**
 * Gövde uçlarının kapısı: devere modülü açık ∧ `devere.beamBodyMode ≠ OFF`. OFF'ta gövde yüzeyi yoktur → 403
 * `BEAM_BODY_MODE_OFF` (eski davranış bayt-aynı). Middleware ve servis aynı fonksiyonu çağırır.
 */
export async function assertBeamBodyEnabled(db?: SettingDb): Promise<void> {
  if (!(await readDevereEnabled(db))) {
    throw AppError.forbidden(`Devere modülü bu kurulumda kapalı. ${settingScreenPath("modules")} ekranından açılabilir.`, { code: "MODULE_DISABLED", modul: "devere" });
  }
  if ((await readDevereBeamBodyMode(db)) === "OFF") {
    throw AppError.forbidden(`Levent gövdesi takibi bu kurulumda kapalı. ${settingRowPath("devereBeamBodyMode")} ile açılır.`, { code: "BEAM_BODY_MODE_OFF" });
  }
}

/** Doğuş: kart + REGISTER olayı. Çağıran tx'in ilk ifadesinde no kilidini (`lockCodeScopeTx` 8029) almış olmalı. */
export async function registerBeamBodyTx(
  tx: Tx,
  input: {
    bodyNo: string;
    clientToken: string | null;
    owner: { ownerCustomerId: string | null; ownerRole: BeamBodyOwnerRole | null };
    dims: { widthCm: Prisma.Decimal | null; flangeDiameterCm: Prisma.Decimal | null; tareKg: Prisma.Decimal | null };
    status: BeamBodyStatus;
    place: BeamBodyPlace;
    notes: string | null;
    machineIds: string[];
    userId: string;
  },
): Promise<{ bodyId: string; eventId: string }> {
  const body = await tx.beamBody.create({
    data: {
      bodyNo: input.bodyNo, clientToken: input.clientToken, ...input.owner, ...input.dims, status: input.status, ...input.place,
      notes: input.notes, createdById: input.userId, updatedById: input.userId,
    },
    select: { id: true },
  });
  if (input.machineIds.length > 0) await tx.beamBodyMachine.createMany({ data: input.machineIds.map((machineId) => ({ bodyId: body.id, machineId })) });
  const createdAt = await beamBodyEventStampTx(tx, body.id);
  const ev = await tx.beamBodyEvent.create({
    data: { bodyId: body.id, kind: "REGISTER", fromStatus: null, toStatus: input.status, ...input.place, createdById: input.userId, createdAt },
    select: { id: true },
  });
  return { bodyId: body.id, eventId: ev.id };
}

/**
 * Durum geçişi (ileri olay): claim `{id, status=from, isActive}` → kart durumu + yer AYNI ifadede, ardından olay.
 * `count === 0` → 409 `BEAM_BODY_STATE` (şu anki durumla). Yer üçlüsü olaya da kopyalanır (geçmiş "nerede" sorusu).
 */
export async function transitionBeamBodyTx(
  tx: Tx,
  input: {
    bodyId: string;
    kind: Exclude<BeamBodyForwardKind, "REGISTER">;
    from: BeamBodyStatus;
    to: BeamBodyStatus;
    place: BeamBodyPlace;
    warpBeamId?: string | null;
    reasonCode?: string | null;
    reason?: string | null;
    userId: string;
  },
): Promise<BeamBodyEventRow> {
  const claim = await tx.beamBody.updateMany({
    where: { id: input.bodyId, status: input.from, isActive: true },
    data: { status: input.to, ...input.place, updatedById: input.userId },
  });
  if (claim.count === 0) await throwStateConflict(tx, input.bodyId, input.from);
  const createdAt = await beamBodyEventStampTx(tx, input.bodyId);
  return tx.beamBodyEvent.create({
    data: {
      bodyId: input.bodyId, kind: input.kind, fromStatus: input.from, toStatus: input.to, ...input.place,
      warpBeamId: input.warpBeamId ?? null, reasonCode: input.reasonCode ?? null, reason: input.reason ?? null,
      createdById: input.userId, createdAt,
    },
    select: BEAM_BODY_EVENT_SELECT,
  });
}

/**
 * Ters kayıt: ileri olayın tipli `*_CANCEL`ı; kart ileri olayın ÖNCEKİ durum/yerine döner (claim `status = ileri.to`).
 * Çift iptal DB'de imkânsız (`reversesId @unique` → P2002 → 409). `deactivate`: REGISTER iptali kartı pasife alır.
 */
export async function reverseBeamBodyEventTx(
  tx: Tx,
  input: { eventId: string; restore: { status: BeamBodyStatus; place: BeamBodyPlace }; deactivate?: boolean; reason: string; userId: string },
): Promise<BeamBodyEventRow> {
  const fwd = await tx.beamBodyEvent.findUnique({ where: { id: input.eventId }, select: { id: true, bodyId: true, kind: true, toStatus: true, reversal: { select: { id: true } } } });
  if (!fwd) throw AppError.notFound("Gövde hareketi bulunamadı");
  if (fwd.kind.endsWith("_CANCEL")) throw AppError.badRequest("İptal kaydı geri alınamaz", { code: "BEAM_BODY_EVENT_IS_REVERSAL" });
  if (fwd.reversal) throw AppError.conflict("Bu gövde hareketi zaten iptal edilmiş", { code: "BEAM_BODY_EVENT_REVERSED" });
  const claim = await tx.beamBody.updateMany({
    where: { id: fwd.bodyId, status: fwd.toStatus, isActive: true },
    data: { status: input.restore.status, ...input.restore.place, ...(input.deactivate ? { isActive: false } : {}), updatedById: input.userId },
  });
  if (claim.count === 0) await throwStateConflict(tx, fwd.bodyId, fwd.toStatus);
  const createdAt = await beamBodyEventStampTx(tx, fwd.bodyId);
  try {
    return await tx.beamBodyEvent.create({
      data: {
        bodyId: fwd.bodyId, kind: cancelKindOf(fwd.kind as BeamBodyForwardKind) satisfies BeamBodyEventKind, fromStatus: fwd.toStatus, toStatus: input.restore.status,
        ...input.restore.place, reversesId: fwd.id, reason: input.reason, createdById: input.userId, createdAt,
      },
      select: BEAM_BODY_EVENT_SELECT,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw AppError.conflict("Bu gövde hareketi zaten iptal edilmiş", { code: "BEAM_BODY_EVENT_REVERSED" });
    throw e;
  }
}

async function throwStateConflict(tx: Tx, bodyId: string, expected: BeamBodyStatus): Promise<never> {
  const fresh = await tx.beamBody.findUnique({ where: { id: bodyId }, select: { bodyNo: true, status: true, isActive: true } });
  if (!fresh) throw AppError.notFound("Levent gövdesi bulunamadı");
  if (!fresh.isActive) throw AppError.conflict(`${fresh.bodyNo} pasif — hareket yazılamaz`, { code: "BEAM_BODY_INACTIVE" });
  throw AppError.conflict(
    `${fresh.bodyNo} şu an "${BEAM_BODY_STATUS_LABELS[fresh.status]}" — bu işlem yalnız "${BEAM_BODY_STATUS_LABELS[expected]}" durumunda yapılır`,
    { code: "BEAM_BODY_STATE", status: fresh.status, expected },
  );
}

/** Gövde bu tezgâha uyar mı: uyum satırı yoksa her tezgâha uyar; varsa tezgâh listede olmalı. */
export async function beamBodyFitsMachineTx(tx: Pick<Tx, "beamBodyMachine">, bodyId: string, machineId: string): Promise<boolean> {
  const rows = await tx.beamBodyMachine.findMany({ where: { bodyId }, select: { machineId: true } });
  return rows.length === 0 || rows.some((r) => r.machineId === machineId);
}

/**
 * Takma kararı (`devere.beamBodyMachineFit`): uyumsuzlukta WARN → uyarı metni döner, BLOCK → 409
 * `BEAM_BODY_MACHINE_MISFIT`. Uyumluysa boş liste. Çağıran takma yolu (B3) uyarıyı `warnings`e koyar.
 */
export async function beamBodyMachineFitVerdictTx(
  tx: Pick<Tx, "beamBodyMachine" | "beamBody" | "machine" | "systemSetting">,
  bodyId: string,
  machineId: string,
): Promise<string[]> {
  if (await beamBodyFitsMachineTx(tx, bodyId, machineId)) return [];
  const body = await tx.beamBody.findUnique({ where: { id: bodyId }, select: { bodyNo: true } });
  const machine = await tx.machine.findUnique({ where: { id: machineId }, select: { code: true, name: true } });
  const text = `${body?.bodyNo ?? "Gövde"} kartında ${machine ? `${machine.name} (${machine.code})` : "bu tezgâh"} uyumlu tezgâhlar arasında değil`;
  if ((await readDevereBeamBodyMachineFit(tx)) === "BLOCK") throw AppError.conflict(`${text} — takma engellendi.`, { code: "BEAM_BODY_MACHINE_MISFIT", bodyId, machineId });
  return [`${text}.`];
}

/** Gövde defteri audit'i — best-effort, tx DIŞINDA (kök kuralı); ileri satır CREATE, ters satır UPDATE. */
export async function logBeamBodyEventAudit(input: { userId: string; eventId: string; kind: BeamBodyEventKind; data: Record<string, unknown> }): Promise<void> {
  await AuditService.log({
    userId: input.userId,
    action: input.kind.endsWith("_CANCEL") ? "UPDATE" : "CREATE",
    tableName: BEAM_BODY_EVENT_TABLE,
    recordId: input.eventId,
    newData: { kind: input.kind, ...input.data },
  });
}
