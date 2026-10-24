// =============================================================================
// TeksERP - Cihaz yeniden bağlama (eşleme v2, D1)
// =============================================================================
// Bilinen donanım (hwDigest) yeni bir kurulum anahtarıyla (localId) gelirse YENİ SATIR
// AÇILMAZ: eşleştirme kapalıysa aktif+onaylı cihaza otomatik bağlanır, zorunluysa (barındırılanda
// daima) ya da hedef pasif/geri alınmışsa talep açılır ve yönetici onaylar (panel ya da tablette
// yerinde). Talep `devices`a satır açmaz; onay hedef satırın etkin anahtarını değiştirir.
// =============================================================================

import { Prisma, DeviceKind } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { readDevicePairingRequired } from "./system-setting.service";
import {
  assertDeviceRowCapacity, findLiveDeviceByHw, hasHwConflictEvent, liveDeviceWhere,
  writeBindingEventTx, type HwClaim,
} from "./helpers/device-identity.helper";

type Db = Prisma.TransactionClient | typeof prisma;

/** Açık talep tavanı — `MAX_PENDING_DEVICES` ikizi (kimliksiz public uç sınırsız satır açmasın). */
export const MAX_OPEN_REBIND_REQUESTS = 200;
const REQUEST_LIST_LIMIT = 200;

export type RebindPath = "OTOMATIK" | "PANEL" | "YERINDE";

/**
 * Yeniden bağlama (atomik claim): etkin anahtar `oldLocalId` iken `newLocalId`ye geçer ve kanıt
 * alanları düşer — eski kurulumun sırrı ölür, yeni kurulum yeni sır alır. `auto` (public uç,
 * otomatik) yalnız aktif + onaylı + donanımı tutan satıra bağlar; yönetici onayı bu koşulu aramaz.
 * Dönüş: etkilenen satır (0 → çağıran 409).
 */
async function rebindDeviceTx(
  db: Db,
  p: { id: string; oldLocalId: string; newLocalId: string; auto?: { hwDigest: string } },
): Promise<number> {
  const r = await db.device.updateMany({
    where: {
      id: p.id,
      deviceId: p.oldLocalId,
      ...liveDeviceWhere(),
      ...(p.auto ? { hwDigest: p.auto.hwDigest, isActive: true, status: "APPROVED" } : {}),
    },
    data: { deviceId: p.newLocalId, proofSalt: null, proofIssuedAt: null, proofConfirmedAt: null, lastSeenAt: new Date() },
  });
  return r.count;
}

/**
 * Bilinen cihazın donanım özetini ÖĞREN (yalnız boşsa). Başka canlı satır aynı özeti taşıyorsa
 * yazılmaz → "CONFLICT" (kısmi UNIQUE yarışta da P2002 ile aynı sonuca düşer).
 */
async function learnHwDigest(id: string, hw: HwClaim): Promise<"LEARNED" | "CONFLICT" | "NOOP"> {
  const other = await findLiveDeviceByHw(prisma, hw.ozet);
  if (other) return other.id === id ? "NOOP" : "CONFLICT";
  try {
    const r = await prisma.device.updateMany({
      where: { id, hwDigest: null, ...liveDeviceWhere() },
      data: { hwDigest: hw.ozet, hwSource: hw.kaynak },
    });
    return r.count === 1 ? "LEARNED" : "NOOP";
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "CONFLICT";
    throw e;
  }
}

/** Talep yanıtı — `/devices/status` UNKNOWN biçimiyle aynı alanlar + hedef adı. */
function rebindResponse(status: "REBIND_PENDING" | "REBIND_REJECTED", targetName: string) {
  return {
    pairingRequired: true,
    unpairedPasswordLogin: false,
    status,
    machineId: null,
    machineCode: null,
    machineName: null,
    stationId: null,
    stationName: null,
    targetName,
  };
}
export type RebindResponse = ReturnType<typeof rebindResponse>;

type RouteResult = { response: RebindResponse } | { reboundDeviceId: string } | null;

export class DeviceRebindService {
  /**
   * localId bilinmiyor + `hw` var: donanım canlı bir cihazla eşleşiyorsa karar burada.
   * null → eşleşme yok (çağıran bugünkü doğuşla yeni satır açar).
   */
  static async routeKnownHardware(p: {
    localId: string; hw: HwClaim; kind: DeviceKind; model?: string; pairingRequired: boolean;
  }): Promise<RouteResult> {
    const target = await findLiveDeviceByHw(prisma, p.hw.ozet);
    if (!target) return null;
    const auto = !p.pairingRequired && target.isActive && target.status === "APPROVED";
    if (auto) {
      await DeviceRebindService.autoRebind(target, p.localId, p.hw);
      return { reboundDeviceId: target.id };
    }
    return { response: await DeviceRebindService.openRequest(target, p) };
  }

  private static async autoRebind(
    target: { id: string; deviceId: string; name: string }, localId: string, hw: HwClaim,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const n = await rebindDeviceTx(tx, {
        id: target.id, oldLocalId: target.deviceId, newLocalId: localId, auto: { hwDigest: hw.ozet },
      });
      if (n === 0) {
        // Eşzamanlı ikiz announce aynı localId'yi zaten bağladıysa sonuç aynıdır (idempotent).
        const now = await tx.device.findUnique({ where: { id: target.id }, select: { deviceId: true } });
        if (now?.deviceId === localId) return;
        throw AppError.conflict("Cihaz kaydı eşzamanlı değişti. Tekrar deneyin.", { code: "DEVICE_REBIND_CONFLICT" });
      }
      await writeBindingEventTx(tx, {
        deviceRefId: target.id, localId, deviceName: target.name, event: "REBOUND", hwDigest: hw.ozet,
        meta: { yol: "OTOMATIK", eskiLocalId: target.deviceId },
      });
    });
    await AuditService.log({
      userId: undefined, action: "UPDATE", tableName: "devices", recordId: target.id,
      oldData: { deviceId: target.deviceId },
      newData: { event: "DEVICE_REBOUND_AUTO", deviceId: localId, reason: "devicePairingRequired=false" },
    }).catch(() => undefined);
  }

  /** Talep aç (localId tekil; varsa tazelenir). Kapanmış (REJECTED) talep yeniden açılmaz. */
  private static async openRequest(
    target: { id: string; name: string },
    p: { localId: string; hw: HwClaim; kind: DeviceKind; model?: string },
  ): Promise<RebindResponse> {
    const existing = await prisma.deviceRebindRequest.findUnique({
      where: { localId: p.localId }, select: { id: true, status: true },
    });
    if (existing?.status === "REJECTED") return rebindResponse("REBIND_REJECTED", target.name);
    if (existing) {
      // OPEN → tazele; APPROVED ama anahtar artık bağlı değil (sonradan başka kuruluma geçti) → yeniden aç.
      await prisma.deviceRebindRequest.updateMany({
        where: { id: existing.id, status: { in: ["OPEN", "APPROVED"] } },
        data: { status: "OPEN", decidedAt: null, decidedById: null, targetDeviceId: target.id, hwDigest: p.hw.ozet },
      });
      return rebindResponse("REBIND_PENDING", target.name);
    }
    const open = await prisma.deviceRebindRequest.count({ where: { status: "OPEN" } });
    if (open >= MAX_OPEN_REBIND_REQUESTS) {
      throw AppError.tooManyRequests(
        `Yeniden bağlama bekleyen cihaz sayısı üst sınıra ulaştı (${MAX_OPEN_REBIND_REQUESTS}). ` +
          `Yönetici panelinden bekleyen talepleri sonuçlandırın.`,
        { code: "PENDING_DEVICE_LIMIT" },
      );
    }
    const created = await prisma.$transaction(async (tx) => {
      const r = await tx.deviceRebindRequest.createMany({
        data: [{
          targetDeviceId: target.id, localId: p.localId, kind: p.kind, model: p.model ?? null, hwDigest: p.hw.ozet,
        }],
        skipDuplicates: true,
      });
      if (r.count === 0) return false; // eşzamanlı ikiz announce talebi açtı — tek talep
      await writeBindingEventTx(tx, {
        deviceRefId: target.id, localId: p.localId, deviceName: target.name, event: "REBIND_REQUESTED",
        hwDigest: p.hw.ozet, meta: { model: p.model ?? null, kind: p.kind },
      });
      return true;
    });
    if (created) {
      await AuditService.log({
        userId: undefined, action: "CREATE", tableName: "device_rebind_requests", recordId: target.id,
        newData: { event: "DEVICE_REBIND_REQUESTED", deviceId: p.localId, targetName: target.name, kind: p.kind },
      }).catch(() => undefined);
    }
    return rebindResponse("REBIND_PENDING", target.name);
  }

  /** `/devices/status`: kayıtsız localId'nin talebi varsa aynı yanıt; yoksa null (UNKNOWN). */
  static async statusFor(localId: string): Promise<RebindResponse | null> {
    const r = await prisma.deviceRebindRequest.findUnique({
      where: { localId }, select: { status: true, target: { select: { name: true } } },
    });
    if (!r || r.status === "APPROVED") return null;
    return rebindResponse(r.status === "REJECTED" ? "REBIND_REJECTED" : "REBIND_PENDING", r.target.name);
  }

  /** Bilinen cihaz `hw` gönderdi: özet boşsa öğren; başka canlı cihazın özetiyse bir kez uyar. */
  static async learnOnAnnounce(device: { id: string; deviceId: string; name: string; hwDigest: string | null }, hw: HwClaim) {
    if (device.hwDigest) return;
    const r = await learnHwDigest(device.id, hw);
    if (r === "LEARNED") {
      await AuditService.log({
        userId: undefined, action: "UPDATE", tableName: "devices", recordId: device.id,
        newData: { event: "DEVICE_HW_LEARNED", deviceId: device.deviceId, hwSource: hw.kaynak },
      }).catch(() => undefined);
    }
    if (r !== "CONFLICT" || (await hasHwConflictEvent(prisma, device.id, hw.ozet))) return;
    await writeBindingEventTx(prisma, {
      deviceRefId: device.id, localId: device.deviceId, deviceName: device.name, event: "HW_CONFLICT",
      hwDigest: hw.ozet, meta: { cakisma: true, kaynak: hw.kaynak },
    });
  }

  /** Panel: talepler (açıklar önce). */
  static async listRequests() {
    return prisma.deviceRebindRequest.findMany({
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: REQUEST_LIST_LIMIT,
      select: {
        id: true, localId: true, kind: true, model: true, hwDigest: true, status: true,
        decidedAt: true, createdAt: true, updatedAt: true,
        decidedBy: { select: { id: true, username: true, fullName: true } },
        target: {
          select: {
            id: true, name: true, kind: true, status: true, isActive: true, lastSeenAt: true, hwDigest: true,
            machine: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
  }

  /** Onay (panel ya da yerinde): talep + cihaz tek tx'te atomik claim; biri 0 → 409. */
  static async approve(id: string, actorId: string, yol: Exclude<RebindPath, "OTOMATIK">) {
    const out = await prisma.$transaction(async (tx) => {
      const req = await tx.deviceRebindRequest.findUnique({
        where: { id }, select: { localId: true, hwDigest: true, targetDeviceId: true },
      });
      if (!req) throw AppError.notFound("Yeniden bağlama talebi bulunamadı");
      const claim = await tx.deviceRebindRequest.updateMany({
        where: { id, status: "OPEN" },
        data: { status: "APPROVED", decidedById: actorId, decidedAt: new Date() },
      });
      if (claim.count === 0) throw AppError.conflict("Talep zaten sonuçlanmış.", { code: "REBIND_ALREADY_DECIDED" });
      const target = await tx.device.findUnique({
        where: { id: req.targetDeviceId }, select: { id: true, deviceId: true, name: true },
      });
      if (!target) throw AppError.notFound("Hedef cihaz bulunamadı");
      const n = await rebindDeviceTx(tx, { id: target.id, oldLocalId: target.deviceId, newLocalId: req.localId });
      if (n === 0) throw AppError.conflict("Hedef cihaz kaydı değişti. Talebi yenileyin.", { code: "DEVICE_REBIND_CONFLICT" });
      await writeBindingEventTx(tx, {
        deviceRefId: target.id, localId: req.localId, deviceName: target.name, event: "REBOUND",
        actorId, hwDigest: req.hwDigest, meta: { yol, eskiLocalId: target.deviceId, talepId: id },
      });
      return { target, localId: req.localId };
    }).catch(mapUniqueToConflict);
    await AuditService.log({
      userId: actorId, action: "UPDATE", tableName: "devices", recordId: out.target.id,
      oldData: { deviceId: out.target.deviceId },
      newData: { event: yol === "YERINDE" ? "DEVICE_REBIND_APPROVED_ONSITE" : "DEVICE_REBIND_APPROVED", deviceId: out.localId, talepId: id },
    }).catch(() => undefined);
    return { id, targetDeviceId: out.target.id, targetName: out.target.name, status: "APPROVED" as const };
  }

  /** Yerinde onay: kimliği doğrulanmış yöneticinin localId'ye ait AÇIK talebi onaylaması. */
  static async approveOnsite(localId: string, actorId: string) {
    const r = await prisma.deviceRebindRequest.findUnique({ where: { localId }, select: { id: true, status: true } });
    if (!r || r.status !== "OPEN") {
      throw AppError.notFound("Bu cihaz için bekleyen yeniden bağlama talebi yok.", { code: "REBIND_REQUEST_NOT_FOUND" });
    }
    return DeviceRebindService.approve(r.id, actorId, "YERINDE");
  }

  /**
   * Red: `REDDET` talebi kapatır; `AYRI_CIHAZ` (klon donanım kimliği) yeni kurulumu bugünkü doğuş
   * kuralıyla AYRI cihaz olarak açar (`hwDigest` boş — özet hedefte kalır).
   */
  static async reject(id: string, input: { mode: "REDDET" | "AYRI_CIHAZ"; reason?: string }, actorId: string) {
    const pairingRequired = await readDevicePairingRequired();
    const out = await prisma.$transaction(async (tx) => {
      const req = await tx.deviceRebindRequest.findUnique({
        where: { id }, select: { localId: true, kind: true, model: true, hwDigest: true, target: { select: { id: true, name: true } } },
      });
      if (!req) throw AppError.notFound("Yeniden bağlama talebi bulunamadı");
      const claim = await tx.deviceRebindRequest.updateMany({
        where: { id, status: "OPEN" }, data: { status: "REJECTED", decidedById: actorId, decidedAt: new Date() },
      });
      if (claim.count === 0) throw AppError.conflict("Talep zaten sonuçlanmış.", { code: "REBIND_ALREADY_DECIDED" });
      const created = input.mode === "AYRI_CIHAZ" ? await createSeparateDeviceTx(tx, req, pairingRequired) : null;
      await writeBindingEventTx(tx, {
        deviceRefId: req.target.id, localId: req.localId, deviceName: req.target.name, event: "REBIND_REJECTED",
        actorId, reason: input.mode === "AYRI_CIHAZ" ? "AYRI_CIHAZ" : (input.reason ?? "REDDET"), hwDigest: req.hwDigest,
        meta: { mode: input.mode, talepId: id, ...(created ? { yeniCihazId: created.id } : {}) },
      });
      if (created) {
        await writeBindingEventTx(tx, {
          deviceRefId: created.id, localId: req.localId, deviceName: created.name, event: "REGISTERED", actorId,
          meta: { kaynak: "AYRI_CIHAZ", talepId: id },
        });
      }
      return { req, created };
    }).catch(mapUniqueToConflict);
    await AuditService.log({
      userId: actorId, action: "UPDATE", tableName: "device_rebind_requests", recordId: id,
      oldData: { status: "OPEN" },
      newData: {
        event: "DEVICE_REBIND_REJECTED", mode: input.mode, deviceId: out.req.localId, targetName: out.req.target.name,
        ...(out.created ? { newDeviceRecordId: out.created.id } : {}),
      },
    }).catch(() => undefined);
    return { id, status: "REJECTED" as const, mode: input.mode, newDeviceId: out.created?.id ?? null };
  }
}

/** AYRI_CIHAZ: bugünkü doğuş kuralı (bayraktan durum) + aktif sayımlı tavan. */
async function createSeparateDeviceTx(
  tx: Prisma.TransactionClient,
  req: { localId: string; kind: DeviceKind; model: string | null },
  pairingRequired: boolean,
) {
  await assertDeviceRowCapacity(tx);
  const kindLabel = req.kind === "PHONE" ? "Telefon" : req.kind === "DESKTOP" ? "Masaüstü" : "Tablet";
  return tx.device.create({
    data: {
      deviceId: req.localId,
      name: (req.model?.trim() || `${kindLabel} ${req.localId.slice(0, 8)}`).slice(0, 100),
      kind: req.kind,
      status: pairingRequired ? "PENDING" : "APPROVED",
      isActive: true,
    },
    select: { id: true, name: true },
  });
}

/** Benzersizlik yarışı (localId başka satıra bağlandı) → 409, ham P2002 değil. */
function mapUniqueToConflict(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw AppError.conflict("Bu cihaz kimliği başka bir kayda bağlı.", { code: "DEVICE_REBIND_CONFLICT" });
  }
  throw e;
}
