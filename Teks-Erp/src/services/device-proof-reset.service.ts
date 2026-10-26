// =============================================================================
// TeksERP - Kanıtı doğrulanamayan cihazlar + toplu yeniden bağlama (eşleme v2, D5 · K-C5)
// =============================================================================
// Halka kaybında eski tuzların kid'i halkada yoktur: kanıt zorunluysa cihaz 503 alır. Yönetici
// seçtiği cihazlarda kanıtı SIFIRLAR (durum geçişi, atomik claim) ve deftere `PROOF_RESET`
// (`meta.beklenenHw`) yazar. Kapı: cihazın son bağlama olayı PROOF_RESET iken yeni sır YALNIZ
// aynı localId + aynı donanım özetiyle gelen announce'a verilir; uymayan/hw'siz istemci onay
// bekleyene (PENDING) düşer ve yönetici mevcut onay akışıyla yeniden onaylar.
// =============================================================================

import type { DeviceBindingEventType, DeviceKind } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { evaluateRingLoss, ringKidSet, type RingLoss } from "../lib/short-credential/ring-footprint";
import { liveDeviceWhere, writeBindingEventTx, type HwClaim } from "./helpers/device-identity.helper";

/** Bağlamayı değiştiren olaylar — kapının "en son" okuması yalnız bunlara bakar (talep/çakışma izi değil). */
const BINDING_STATE_EVENTS: DeviceBindingEventType[] = ["REGISTERED", "REBOUND", "REVOKED", "MERGED", "UNMERGED", "PROOF_RESET", "PURGED"];

export const PROOF_RESET_MAX = 200;
const SALT_KID_RE = /^([0-9a-f]{16}):/;

export type ProofResetGate = { beklenenHw: string | null } | null;
export type AnnounceGateResult = "YOK" | "GECTI" | "ONAYA_DUSTU";

export interface ProofLostDevice {
  id: string;
  deviceId: string;
  name: string;
  kind: DeviceKind;
  status: string;
  isActive: boolean;
  machine: { code: string; name: string } | null;
  lastSeenAt: Date | null;
  hasHw: boolean;
  kid: string;
}

export type ProofResetOutcome =
  | { id: string; name: string; sonuc: "SIFIRLANDI"; hasHw: boolean }
  | { id: string; name: string | null; sonuc: "ATLANDI"; neden: "YOK" | "KANIT_YOK" | "HALKADA" | "DEGISTI" };

function saltKid(salt: string | null): string | null {
  const m = salt ? SALT_KID_RE.exec(salt) : null;
  return m ? m[1]! : null;
}

function beklenenHwOf(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const v = (meta as Record<string, unknown>).beklenenHw;
  return typeof v === "string" ? v : null;
}

export class DeviceProofResetService {
  /** Kapı: cihazın son bağlama olayı PROOF_RESET mi (kronoloji createdAt, eşitlik bozucu id). */
  static async gate(deviceRefId: string): Promise<ProofResetGate> {
    const last = await prisma.deviceBindingEvent.findFirst({
      where: { deviceRefId, event: { in: BINDING_STATE_EVENTS } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { event: true, meta: true },
    });
    return last?.event === "PROOF_RESET" ? { beklenenHw: beklenenHwOf(last.meta) } : null;
  }

  /**
   * Bilinen localId'nin announce'u: kapı açıkken donanım özeti beklenenle aynıysa GECTI (sır
   * verilebilir); değilse cihaz atomik claim'le PENDING'e düşer (defter REVOKED) → yönetici onayı.
   */
  static async gateOnAnnounce(localId: string, hw: HwClaim | undefined): Promise<AnnounceGateResult> {
    const row = await prisma.device.findUnique({
      where: { deviceId: localId },
      select: { id: true, name: true, status: true, proofConfirmedAt: true },
    });
    if (!row || row.status !== "APPROVED" || row.proofConfirmedAt) return "YOK";
    const g = await DeviceProofResetService.gate(row.id);
    if (!g) return "YOK";
    if (hw && g.beklenenHw && hw.ozet === g.beklenenHw) return "GECTI";
    const demoted = await prisma.$transaction(async (tx) => {
      const r = await tx.device.updateMany({
        where: { id: row.id, deviceId: localId, status: "APPROVED", proofConfirmedAt: null, ...liveDeviceWhere() },
        data: { status: "PENDING", proofSalt: null, proofIssuedAt: null },
      });
      if (r.count === 0) return false;
      await writeBindingEventTx(tx, {
        deviceRefId: row.id, localId, deviceName: row.name, event: "REVOKED",
        reason: hw ? "Kanıt sıfırlandıktan sonra farklı donanımla geldi" : "Kanıt sıfırlandıktan sonra donanım özeti göndermedi",
        hwDigest: hw?.ozet ?? null,
        meta: { neden: "PROOF_RESET_HW", hwGeldi: hw !== undefined },
      });
      return true;
    });
    if (!demoted) return "YOK";
    await AuditService.log({
      userId: undefined, action: "UPDATE", tableName: "devices", recordId: row.id,
      oldData: { status: "APPROVED" },
      newData: { event: "REVOKED", status: "PENDING", reason: "PROOF_RESET_HW", hwGeldi: hw !== undefined },
    }).catch(() => undefined);
    return "ONAYA_DUSTU";
  }

  /** Önizleme/liste (YAZMAZ): kid'i halkada olmayan tuzu taşıyan canlı cihazlar + sıfırlanıp tableti beklenenler. */
  static async listProofLost(): Promise<{ halkaKaybi: RingLoss | null; cihazlar: ProofLostDevice[]; bekleyenler: ProofLostDevice[] }> {
    const kids = ringKidSet();
    if (!kids) throw new AppError("Kısa kimlik anahtar halkası kullanılamıyor.", 503, true, { code: "SHORT_CREDENTIAL_RING_UNAVAILABLE" });
    const select = {
      id: true, deviceId: true, name: true, kind: true, status: true, isActive: true, lastSeenAt: true,
      hwDigest: true, proofSalt: true, machine: { select: { code: true, name: true } },
    } as const;
    const salted = await prisma.device.findMany({
      where: { ...liveDeviceWhere(), proofSalt: { not: null } },
      select, orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    const toRow = (d: (typeof salted)[number], kid: string): ProofLostDevice => ({
      id: d.id, deviceId: d.deviceId, name: d.name, kind: d.kind, status: d.status, isActive: d.isActive,
      machine: d.machine, lastSeenAt: d.lastSeenAt, hasHw: d.hwDigest !== null, kid,
    });
    const cihazlar = salted
      .map((d) => ({ d, kid: saltKid(d.proofSalt) }))
      .filter((x): x is { d: (typeof salted)[number]; kid: string } => x.kid !== null && !kids.has(x.kid))
      .map((x) => toRow(x.d, x.kid));
    const unsalted = await prisma.device.findMany({
      where: { ...liveDeviceWhere(), proofSalt: null, status: "APPROVED", proofConfirmedAt: null },
      select, orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    const bekleyenler: ProofLostDevice[] = [];
    for (const d of unsalted) {
      if (await DeviceProofResetService.gate(d.id)) bekleyenler.push(toRow(d, ""));
    }
    return { halkaKaybi: await evaluateRingLoss(), cihazlar, bekleyenler };
  }

  /**
   * Seçilen cihazlarda kanıtı sıfırla (kayıt kayıt): claim `WHERE {id, proofSalt: okunan}` — tuz
   * değiştiyse ya da kid halkadaysa ATLANDI. Replay ikinci defter satırı yazmaz (tuz artık null).
   */
  static async resetProofs(deviceIds: string[], actorId: string): Promise<{ sonuclar: ProofResetOutcome[] }> {
    const ids = [...new Set(deviceIds)].sort();
    if (ids.length === 0) throw AppError.badRequest("En az bir cihaz seçin.");
    if (ids.length > PROOF_RESET_MAX) throw AppError.badRequest(`Tek seferde en çok ${PROOF_RESET_MAX} cihaz seçilebilir.`);
    const kids = ringKidSet();
    if (!kids) throw new AppError("Kısa kimlik anahtar halkası kullanılamıyor.", 503, true, { code: "SHORT_CREDENTIAL_RING_UNAVAILABLE" });
    const outcomes = await prisma.$transaction(async (tx) => {
      const out: ProofResetOutcome[] = [];
      for (const id of ids) {
        const d = await tx.device.findFirst({
          where: { id, ...liveDeviceWhere() },
          select: { id: true, deviceId: true, name: true, proofSalt: true, hwDigest: true },
        });
        if (!d) { out.push({ id, name: null, sonuc: "ATLANDI", neden: "YOK" }); continue; }
        const kid = saltKid(d.proofSalt);
        if (!d.proofSalt || !kid) { out.push({ id, name: d.name, sonuc: "ATLANDI", neden: "KANIT_YOK" }); continue; }
        if (kids.has(kid)) { out.push({ id, name: d.name, sonuc: "ATLANDI", neden: "HALKADA" }); continue; }
        const r = await tx.device.updateMany({
          where: { id, proofSalt: d.proofSalt, ...liveDeviceWhere() },
          data: { proofSalt: null, proofIssuedAt: null, proofConfirmedAt: null },
        });
        if (r.count === 0) { out.push({ id, name: d.name, sonuc: "ATLANDI", neden: "DEGISTI" }); continue; }
        await writeBindingEventTx(tx, {
          deviceRefId: id, localId: d.deviceId, deviceName: d.name, event: "PROOF_RESET", actorId,
          hwDigest: d.hwDigest, meta: { beklenenHw: d.hwDigest, eskiKid: kid },
        });
        out.push({ id, name: d.name, sonuc: "SIFIRLANDI", hasHw: d.hwDigest !== null });
      }
      return out;
    });
    for (const s of outcomes) {
      if (s.sonuc !== "SIFIRLANDI") continue;
      await AuditService.log({
        userId: actorId, action: "UPDATE", tableName: "devices", recordId: s.id,
        newData: { event: "PROOF_RESET", beklenenHwVar: s.hasHw },
      }).catch(() => undefined);
    }
    return { sonuclar: outcomes };
  }
}
