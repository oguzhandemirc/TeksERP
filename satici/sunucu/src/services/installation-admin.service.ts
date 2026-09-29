// PORTAL TARAFI kurulum eylemleri (1f çağırır): kopya uyarısını kapat (gerekirse ölçülen parmak
// izini kabul et — meşru donanım değişimi) ve kurulumu iptal et. İkisi de kurulum kaydına satır
// yazar ve zili çalar; sebep zorunlu.
import type { Prisma } from "@prisma/client";
import { recordAudit } from "../lib/audit";
import { VendorError, retryConflict } from "../lib/errors";
import { lockInstallation } from "../lib/locks";
import { prisma } from "../lib/prisma";
import { notifyDoorbell } from "./doorbell";

const bad = (message: string): VendorError => new VendorError(400, "GOVDE_GECERSIZ", message);

/**
 * Kopya uyarısını kapatır. `acceptOtherFingerprint`: uyarıdaki "diğer" parmak izi kabul edilen
 * küme olur (parça değişimi meşru) — o makine sonraki yoklamada kira alır. Kapanış bir durum
 * geçişidir (ACIK → KAPANDI, atomik); yeni şüphe yeni uyarı açar.
 */
export async function closeCopyAlert(g: { alertId: string; acceptOtherFingerprint: boolean; reason: string; actor: string }): Promise<void> {
  const reason = g.reason.trim();
  if (!reason) throw bad("Kopya uyarısını kapatmak için sebep zorunlu");
  const alert = await prisma.kopyaUyarisi.findUnique({ where: { id: g.alertId } });
  if (!alert) throw new VendorError(404, "GOVDE_GECERSIZ", "Kopya uyarısı bulunamadı");
  await prisma.$transaction(async (tx) => {
    await lockInstallation(tx, alert.kurulumId);
    const claim = await tx.kopyaUyarisi.updateMany({
      where: { id: alert.id, durum: "ACIK" },
      data: { durum: "KAPANDI", kapanisZamani: new Date(), kapatan: g.actor },
    });
    if (claim.count === 0) throw new VendorError(409, "GOVDE_GECERSIZ", "Kopya uyarısı zaten kapalı");
    const ayrinti: Prisma.InputJsonObject = { uyariId: alert.id, tur: alert.tur, sebep: reason, kabul: g.acceptOtherFingerprint };
    if (g.acceptOtherFingerprint) {
      const inst = await tx.kurulum.findUniqueOrThrow({ where: { id: alert.kurulumId } });
      const moved = await tx.kurulum.updateMany({
        where: { id: inst.id, anahtarKimligi: inst.anahtarKimligi },
        data: { kabulEdilenParmakIzi: alert.digerParmakIzi ?? undefined },
      });
      if (moved.count === 0) throw retryConflict();
    }
    await tx.kurulumKaydi.create({ data: { kurulumId: alert.kurulumId, olay: "KOPYA_UYARISI_KAPANDI", ayrinti, yapan: g.actor } });
    await notifyDoorbell(tx, alert.kurulumId, "lisans");
  });
  await recordAudit({ event: "KOPYA_UYARISI_KAPANDI", entity: "Kurulum", entityId: alert.kurulumId, actor: g.actor, summary: { uyariId: alert.id, kabul: g.acceptOtherFingerprint, sebep: reason } });
}

/** Kurulumu iptal eder: kira verilmez (403 KURULUM_IPTAL). Ters yol `reinstateInstallation`. */
export async function cancelInstallation(g: { installationDbId: string; reason: string; actor: string }): Promise<void> {
  const reason = g.reason.trim();
  if (!reason) throw bad("Kurulumu iptal etmek için sebep zorunlu");
  await prisma.$transaction(async (tx) => {
    await lockInstallation(tx, g.installationDbId);
    const inst = await tx.kurulum.findUniqueOrThrow({ where: { id: g.installationDbId } });
    if (inst.durum === "IPTAL") throw new VendorError(409, "KURULUM_IPTAL", "Kurulum zaten iptal");
    const claim = await tx.kurulum.updateMany({ where: { id: inst.id, durum: inst.durum }, data: { durum: "IPTAL" } });
    if (claim.count === 0) throw retryConflict();
    await tx.etkinlestirmeKodu.updateMany({ where: { kurulumId: inst.id, durum: "AKTIF" }, data: { durum: "IPTAL" } });
    await tx.kurulumKaydi.create({ data: { kurulumId: inst.id, olay: "IPTAL", ayrinti: { onceki: inst.durum, sebep: reason }, yapan: g.actor } });
    await notifyDoorbell(tx, inst.id, "lisans");
  });
  await recordAudit({ event: "KURULUM_IPTAL", entity: "Kurulum", entityId: g.installationDbId, actor: g.actor, summary: { sebep: reason } });
}

/** İptalin ters yolu: kurulum, iptal kaydında saklı ÖNCEKİ durumuna döner (ters satır yazılır). */
export async function reinstateInstallation(g: { installationDbId: string; reason: string; actor: string }): Promise<void> {
  const reason = g.reason.trim();
  if (!reason) throw bad("İptali geri almak için sebep zorunlu");
  await prisma.$transaction(async (tx) => {
    await lockInstallation(tx, g.installationDbId);
    const cancelled = await tx.kurulumKaydi.findFirst({
      where: { kurulumId: g.installationDbId, olay: "IPTAL" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const previous = (cancelled?.ayrinti as { onceki?: unknown } | null)?.onceki;
    if (previous !== "ETKINLESMEDI" && previous !== "ETKIN" && previous !== "DEVREDILDI") {
      throw new VendorError(409, "GOVDE_GECERSIZ", "Önceki durum kurulum kaydında bulunamadı");
    }
    const claim = await tx.kurulum.updateMany({ where: { id: g.installationDbId, durum: "IPTAL" }, data: { durum: previous } });
    if (claim.count === 0) throw new VendorError(409, "GOVDE_GECERSIZ", "Kurulum iptal durumunda değil");
    await tx.kurulumKaydi.create({
      data: { kurulumId: g.installationDbId, olay: "IPTAL_GERI_ALINDI", ayrinti: { yeni: previous, sebep: reason }, yapan: g.actor },
    });
    await notifyDoorbell(tx, g.installationDbId, "lisans");
  });
  await recordAudit({ event: "KURULUM_IPTAL_GERI_ALINDI", entity: "Kurulum", entityId: g.installationDbId, actor: g.actor, summary: { sebep: reason } });
}
