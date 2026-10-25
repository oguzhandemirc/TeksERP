// Cihaz kopyalarını birleştirme (izlenebilirlik D4). Aynı fiziksel tablet, uygulama verisi
// silinip yeniden kurulunca yeni `devices` satırıyla doğuyordu; bu servis kopyaları insan
// onayıyla ana kayda bağlar. OTOMATİK DEĞİL: sezgi yanlış pozitif verdi (ölçüldü, C-R1 §3).
//
// Birleştirme DURUM GEÇİŞİDİR: kopya pasif + ana kayda bağlı olur, `MERGED` olayı deftere
// yazılır. Ayak izi tabloları (iş oturumu, oturum, audit, print/trace) TAŞINMAZ — okuyucu
// kimliği `helpers/device-identity.helper.ts` üzerinden ana kayda çözer. Geri alma `UNMERGED`
// karşı olayıdır; ileri olay silinmez, taşınan donanım bağları geri taşınmaz.
import { DeviceKind, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { ACTOR_SELECT } from "./helpers/system-account.helper";
import {
  buildMergeCandidates,
  compareVersion,
  type CandidateGroup,
  type CandidateUsage,
  type MergeConfidence,
} from "./helpers/device-merge-heuristic.helper";
import {
  claimMergeSourceTx,
  claimMergeTargetTx,
  claimUnmergeTx,
  countMergedCopies,
  liveDeviceWhere,
  MAX_DEVICE_ROWS,
  readMergeLink,
  writeBindingEventTx,
} from "./helpers/device-identity.helper";

/** Advisory kilit uzayı — envanter `helpers/period-guard.helper.ts` başlığı (8042). */
export const DEVICE_MERGE_LOCK_NS: number = 8042;
/** Tek anahtar: birleştirme ve geri alma birbirini serileştirir (düşük frekanslı yönetici işi). */
const DEVICE_MERGE_LOCK_KEY = 1;
export const MAX_MERGE_SOURCES = 50;
const RECENT_SESSION_LIMIT = 5;
const MERGE_TX_TIMEOUT_MS = 20_000;

export { buildMergeCandidates, type CandidateGroup, type CandidateMember, type CandidateRow, type CandidateUsage, type MergeConfidence } from "./helpers/device-merge-heuristic.helper";

/**
 * `devices`a işaret eden HER FK'nın birleştirmedeki kaderi (iki yönlü bekçi:
 * `test_cihaz_birlestirme` şema metnindeki FK listesini bununla karşılaştırır).
 * MOVE = yapılandırma, hedefe taşınır · STAY = defter/ayak izi, yerinde kalır ·
 * BLOCK = canlıysa birleştirmeyi engeller · SELF = birleşme bağının kendisi.
 */
export const DEVICE_MERGE_FK_POLICY: Readonly<Record<string, "MOVE" | "STAY" | "BLOCK" | "SELF">> = {
  "Device.mergedInto": "SELF",
  "DeviceBindingEvent.device": "STAY",
  "DeviceRebindRequest.target": "BLOCK",
  "PeripheralDevice.device": "MOVE",
  "DevicePeripheral.device": "MOVE",
  "WorkSession.device": "STAY",
  "RollInspection.device": "STAY",
  "PrintJob.device": "STAY",
  "RequestTrace.device": "STAY",
};

async function loadUsage(ids: string[]): Promise<Map<string, CandidateUsage>> {
  const out = new Map<string, CandidateUsage>();
  const get = (id: string) => {
    let u = out.get(id);
    if (!u) { u = { stations: new Set(), machines: new Set(), users: new Set(), versions: [] }; out.set(id, u); }
    return u;
  };
  if (ids.length === 0) return out;
  const ws = await prisma.workSession.groupBy({
    by: ["deviceId", "stationId", "machineId", "userId"],
    where: { deviceId: { in: ids } },
  });
  for (const w of ws) {
    const u = get(w.deviceId);
    u.stations.add(w.stationId);
    if (w.machineId) u.machines.add(w.machineId);
    u.users.add(w.userId);
  }
  const vs = await prisma.requestTrace.groupBy({
    by: ["deviceRefId", "appVersion"],
    where: { deviceRefId: { in: ids }, appVersion: { not: null } },
  });
  for (const v of vs) if (v.deviceRefId && v.appVersion) get(v.deviceRefId).versions.push(v.appVersion);
  for (const u of out.values()) u.versions.sort(compareVersion);
  return out;
}

interface Blocker { code: string; message: string }

type SourceRow = {
  id: string; deviceId: string; name: string; kind: DeviceKind; isActive: boolean; status: string;
  machineId: string | null; hwDigest: string | null; createdAt: Date; lastSeenAt: Date | null;
  machine: { code: string; name: string } | null;
};
const SOURCE_SELECT = {
  id: true, deviceId: true, name: true, kind: true, isActive: true, status: true, machineId: true,
  hwDigest: true, createdAt: true, lastSeenAt: true, machine: { select: { code: true, name: true } },
} as const;

type Db = Prisma.TransactionClient | typeof prisma;

/** Kaynağı engelleyen durumlar — önizleme ve uygulama AYNI listeyi kullanır (tek kaynak). */
async function sourceBlockers(db: Db, src: SourceRow, target: { id: string; kind: DeviceKind }): Promise<Blocker[]> {
  const out: Blocker[] = [];
  const link = await readMergeLink(db, src.id);
  if (link) out.push({ code: "DEVICE_MERGE_ALREADY_MERGED", message: `Kayıt zaten "${link.targetName}" ile birleştirilmiş.` });
  if (src.kind !== target.kind) out.push({ code: "DEVICE_MERGE_KIND_MISMATCH", message: "Cihaz türü hedefle aynı değil." });
  if ((await countMergedCopies(db, src.id)) > 0) {
    out.push({ code: "DEVICE_MERGE_CHAIN", message: "Bu kaydın kendi birleşmiş kopyaları var; önce onların birleştirmesini geri alın." });
  }
  const open = await db.workSession.count({ where: { deviceId: src.id, endedAt: null } });
  if (open > 0) out.push({ code: "DEVICE_MERGE_OPEN_SESSION", message: "Kayıtta açık iş oturumu var; oturum kapanmadan birleştirilemez." });
  const rebind = await db.deviceRebindRequest.count({ where: { targetDeviceId: src.id, status: "OPEN" } });
  if (rebind > 0) out.push({ code: "DEVICE_MERGE_PENDING_REBIND", message: "Kayda yönelik bekleyen yeniden bağlama talebi var; önce talebi sonuçlandırın." });
  return out;
}

function assertMergeInput(targetId: string, sourceIds: string[]): string[] {
  const uniq = [...new Set(sourceIds)];
  if (uniq.length === 0) throw AppError.badRequest("Birleştirilecek en az bir kayıt seçin.", { code: "VALIDATION_ERROR" });
  if (uniq.length > MAX_MERGE_SOURCES) {
    throw AppError.badRequest(`Tek seferde en çok ${MAX_MERGE_SOURCES} kayıt birleştirilebilir.`, { code: "VALIDATION_ERROR" });
  }
  if (uniq.includes(targetId)) throw AppError.badRequest("Ana kayıt kendisiyle birleştirilemez.", { code: "VALIDATION_ERROR" });
  return uniq.sort();
}

export class DeviceMergeService {
  /** Sezgi grupları: yalnız birleşmemiş satırlar (betik `scripts/cihaz-birlestir.ts` aynı yolu okur). */
  static async candidates(): Promise<{ groups: CandidateGroup[]; scanned: number }> {
    const rows = await prisma.device.findMany({
      where: liveDeviceWhere(),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: MAX_DEVICE_ROWS * 2,
      select: {
        id: true, deviceId: true, name: true, kind: true, status: true, isActive: true,
        machineId: true, createdAt: true, lastSeenAt: true,
      },
    });
    const usage = await loadUsage(rows.map((r) => r.id));
    return { groups: buildMergeCandidates(rows, usage), scanned: rows.length };
  }

  /** Yan etkisiz önizleme: kaynak başına etkilenen HER kayıt + engeller + notlar. */
  static async preview(targetId: string, sourceIdsIn: string[]) {
    const sourceIds = assertMergeInput(targetId, sourceIdsIn);
    const target = await prisma.device.findUnique({ where: { id: targetId }, select: SOURCE_SELECT });
    if (!target) throw AppError.notFound("Ana cihaz kaydı bulunamadı");
    const targetBlockers: Blocker[] = [];
    if (await readMergeLink(prisma, targetId)) {
      targetBlockers.push({ code: "DEVICE_MERGE_TARGET_INVALID", message: "Ana kayıt başka bir kayıtla birleştirilmiş; ana kayıt olamaz." });
    } else if (!target.isActive) {
      targetBlockers.push({ code: "DEVICE_MERGE_TARGET_INVALID", message: "Ana kayıt pasif; önce etkinleştirin." });
    }
    const targetLinks = await prisma.devicePeripheral.findMany({ where: { deviceId: targetId }, select: { peripheralId: true } });
    const onTarget = new Set(targetLinks.map((l) => l.peripheralId));

    const sources = [];
    for (const id of sourceIds) {
      const src = await prisma.device.findUnique({ where: { id }, select: SOURCE_SELECT });
      if (!src) throw AppError.notFound(`Cihaz kaydı bulunamadı (${id.slice(0, 8)})`);
      const blockers = await sourceBlockers(prisma, src, target);
      const [sessionCount, recent, links, legacy] = [
        await prisma.workSession.count({ where: { deviceId: id } }),
        await prisma.workSession.findMany({
          where: { deviceId: id },
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
          take: RECENT_SESSION_LIMIT,
          select: {
            id: true, startedAt: true, endedAt: true,
            user: { select: ACTOR_SELECT },
            station: { select: { id: true, name: true } },
            machine: { select: { id: true, code: true, name: true } },
          },
        }),
        await prisma.devicePeripheral.findMany({
          where: { deviceId: id },
          select: { peripheral: { select: { id: true, code: true, name: true, kind: true } } },
        }),
        await prisma.peripheralDevice.findMany({ where: { deviceId: id }, select: { id: true, code: true, name: true, kind: true } }),
      ];
      const notes: string[] = [];
      if (src.machineId && src.machineId !== target.machineId && src.machine) {
        notes.push(`Kaydın makine ataması (${src.machine.code}) ana kayda aktarılmaz.`);
      }
      if (src.hwDigest) notes.push("Kaydın donanım özeti ana kayda yazılmaz.");
      sources.push({
        id: src.id, deviceId: src.deviceId, name: src.name, kind: src.kind, isActive: src.isActive,
        status: src.status, createdAt: src.createdAt, lastSeenAt: src.lastSeenAt,
        blockers,
        notes,
        workSessions: { count: sessionCount, recent, staysInPlace: true },
        hardwareLinks: links.map((l) => ({ ...l.peripheral, alreadyOnTarget: onTarget.has(l.peripheral.id) })),
        legacyPeripherals: legacy,
      });
    }
    return {
      target: { id: target.id, deviceId: target.deviceId, name: target.name, kind: target.kind, isActive: target.isActive, status: target.status },
      targetBlockers,
      sources,
      undoNote: "Geri alınabilir; taşınan donanım bağları geri taşınmaz.",
    };
  }

  /** Uygula: TEK tx, kilit ilk ifade; herhangi bir kaynak claim'i tutmazsa hepsi geri döner (409). */
  static async merge(targetId: string, sourceIdsIn: string[], userId: string) {
    const sourceIds = assertMergeInput(targetId, sourceIdsIn);
    const at = new Date();
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DEVICE_MERGE_LOCK_NS}::int, ${DEVICE_MERGE_LOCK_KEY}::int)`;
      const target = await tx.device.findUnique({ where: { id: targetId }, select: SOURCE_SELECT });
      if (!target) throw AppError.notFound("Ana cihaz kaydı bulunamadı");
      if ((await claimMergeTargetTx(tx, targetId)) !== 1) {
        throw AppError.conflict("Ana kayıt birleştirilmiş ya da pasif; ana kayıt olamaz.", { code: "DEVICE_MERGE_TARGET_INVALID" });
      }
      const merged: Array<{ id: string; name: string; deviceId: string; movedLinks: number; droppedDuplicateLinks: number; movedPeripherals: number }> = [];
      for (const id of sourceIds) {
        const src = await tx.device.findUnique({ where: { id }, select: SOURCE_SELECT });
        if (!src) throw AppError.notFound(`Cihaz kaydı bulunamadı (${id.slice(0, 8)})`);
        const blockers = await sourceBlockers(tx, src, target);
        if (blockers.length > 0) {
          throw AppError.conflict(`"${src.name}": ${blockers[0]!.message}`, { code: blockers[0]!.code, deviceId: id });
        }
        if ((await claimMergeSourceTx(tx, id, targetId, at)) !== 1) {
          throw AppError.conflict(`"${src.name}" kaydı eşzamanlı değişti. Önizlemeyi yenileyin.`, { code: "DEVICE_MERGE_CONFLICT", deviceId: id });
        }
        // Saf yapılandırma pivotu: hedefte yoksa bağ hedefe geçer, varsa kaynaktaki çift satır düşer.
        let movedLinks = 0;
        let droppedDuplicateLinks = 0;
        const links = await tx.devicePeripheral.findMany({ where: { deviceId: id }, orderBy: { id: "asc" }, select: { id: true, peripheralId: true } });
        for (const l of links) {
          const exists = await tx.devicePeripheral.findUnique({
            where: { deviceId_peripheralId: { deviceId: targetId, peripheralId: l.peripheralId } },
            select: { id: true },
          });
          if (exists) {
            await tx.devicePeripheral.delete({ where: { id: l.id } });
            droppedDuplicateLinks++;
          } else {
            await tx.devicePeripheral.update({ where: { id: l.id }, data: { deviceId: targetId } });
            movedLinks++;
          }
        }
        const moved = await tx.peripheralDevice.updateMany({ where: { deviceId: id }, data: { deviceId: targetId } });
        const workSessionCount = await tx.workSession.count({ where: { deviceId: id } });
        await writeBindingEventTx(tx, {
          deviceRefId: id, localId: src.deviceId, deviceName: src.name, event: "MERGED", actorId: userId,
          hwDigest: src.hwDigest,
          meta: {
            targetId, targetName: target.name, movedLinks, droppedDuplicateLinks,
            movedPeripherals: moved.count, workSessionCount,
          },
        });
        merged.push({ id, name: src.name, deviceId: src.deviceId, movedLinks, droppedDuplicateLinks, movedPeripherals: moved.count });
      }
      return { target: { id: target.id, name: target.name }, merged, mergedAt: at };
    }, { timeout: MERGE_TX_TIMEOUT_MS });

    for (const m of result.merged) {
      await AuditService.log({
        userId, action: "UPDATE", tableName: "devices", recordId: m.id,
        oldData: { isActive: true },
        newData: { event: "MERGED", isActive: false, mergedInto: result.target.id, mergedIntoName: result.target.name },
      }).catch(() => undefined);
    }
    return result;
  }

  /** Geri al: `UNMERGED` karşı olayı; kaynak pasif + bağsız döner, ileri olay durur. */
  static async undo(sourceId: string, userId: string) {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DEVICE_MERGE_LOCK_NS}::int, ${DEVICE_MERGE_LOCK_KEY}::int)`;
      const src = await tx.device.findUnique({ where: { id: sourceId }, select: { id: true, deviceId: true, name: true } });
      if (!src) throw AppError.notFound("Cihaz kaydı bulunamadı");
      const link = await readMergeLink(tx, sourceId);
      if (!link) throw AppError.conflict("Kayıt birleştirilmiş değil.", { code: "DEVICE_MERGE_NOT_MERGED" });
      if ((await claimUnmergeTx(tx, sourceId, link.targetId)) !== 1) {
        throw AppError.conflict("Kayıt eşzamanlı değişti. Sayfayı yenileyin.", { code: "DEVICE_MERGE_CONFLICT" });
      }
      await writeBindingEventTx(tx, {
        deviceRefId: sourceId, localId: src.deviceId, deviceName: src.name, event: "UNMERGED", actorId: userId,
        meta: { targetId: link.targetId, targetName: link.targetName },
      });
      return { id: src.id, name: src.name, target: { id: link.targetId, name: link.targetName } };
    });
    await AuditService.log({
      userId, action: "UPDATE", tableName: "devices", recordId: sourceId,
      oldData: { mergedInto: result.target.id },
      newData: { event: "UNMERGED", mergedInto: null, isActive: false },
    }).catch(() => undefined);
    return result;
  }
}
