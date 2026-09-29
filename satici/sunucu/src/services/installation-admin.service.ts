// PORTAL TARAFI kurulum eylemleri: kopya uyarısını kapat (gerekirse ölçülen parmak izini kabul et —
// meşru donanım değişimi) ve kurulumu iptal et / iptali geri al. Hepsi kurulum kaydına satır yazar
// ve zili çalar; sebep zorunlu. `…Tx` biçimi portal işlem kimliği tx'inde çağrılır.
import type { KopyaUyarisi, Prisma } from "@prisma/client";
import { recordAudit } from "../lib/audit";
import { VendorError, notFoundError, retryConflict, stateConflict } from "../lib/errors";
import { lockInstallation } from "../lib/locks";
import { prisma, type Tx } from "../lib/prisma";
import { notifyDoorbell } from "./doorbell";
import { requireReason } from "./sanction.service";

export async function findCopyAlert(alertId: string): Promise<KopyaUyarisi> {
  const alert = await prisma.kopyaUyarisi.findUnique({ where: { id: alertId } });
  if (!alert) throw notFoundError("Kopya uyarısı");
  return alert;
}

/**
 * Kopya uyarısını kapatır. `acceptOtherFingerprint`: uyarıdaki "diğer" parmak izi kabul edilen
 * küme olur (parça değişimi meşru) — o makine sonraki yoklamada kira alır. Kapanış bir durum
 * geçişidir (ACIK → KAPANDI, atomik); yeni şüphe yeni uyarı açar.
 */
export async function closeCopyAlertTx(
  tx: Tx,
  g: { alert: KopyaUyarisi; acceptOtherFingerprint: boolean; reason: string; actor: string },
): Promise<KopyaUyarisi> {
  await lockInstallation(tx, g.alert.kurulumId);
  const reason = requireReason(g.reason, "Kopya uyarısını kapatmak");
  const claim = await tx.kopyaUyarisi.updateMany({
    where: { id: g.alert.id, durum: "ACIK" },
    data: { durum: "KAPANDI", kapanisZamani: new Date(), kapatan: g.actor },
  });
  if (claim.count === 0) throw stateConflict("Kopya uyarısı zaten kapalı");
  const ayrinti: Prisma.InputJsonObject = { uyariId: g.alert.id, tur: g.alert.tur, sebep: reason, kabul: g.acceptOtherFingerprint };
  if (g.acceptOtherFingerprint) {
    const inst = await tx.kurulum.findUniqueOrThrow({ where: { id: g.alert.kurulumId } });
    const moved = await tx.kurulum.updateMany({
      where: { id: inst.id, anahtarKimligi: inst.anahtarKimligi },
      data: { kabulEdilenParmakIzi: g.alert.digerParmakIzi ?? undefined },
    });
    if (moved.count === 0) throw retryConflict();
  }
  await tx.kurulumKaydi.create({ data: { kurulumId: g.alert.kurulumId, olay: "KOPYA_UYARISI_KAPANDI", ayrinti, yapan: g.actor } });
  await notifyDoorbell(tx, g.alert.kurulumId, "lisans");
  return tx.kopyaUyarisi.findUniqueOrThrow({ where: { id: g.alert.id } });
}

export async function closeCopyAlert(g: { alertId: string; acceptOtherFingerprint: boolean; reason: string; actor: string }): Promise<void> {
  const alert = await findCopyAlert(g.alertId);
  await prisma.$transaction((tx) => closeCopyAlertTx(tx, { alert, acceptOtherFingerprint: g.acceptOtherFingerprint, reason: g.reason, actor: g.actor }));
  await recordAudit({ event: "KOPYA_UYARISI_KAPANDI", entity: "Kurulum", entityId: alert.kurulumId, actor: g.actor, summary: { uyariId: alert.id, kabul: g.acceptOtherFingerprint, sebep: g.reason } });
}

/** Kurulumu iptal eder: kira verilmez (403 KURULUM_IPTAL). Ters yol `reinstateInstallationTx`. */
export async function cancelInstallationTx(tx: Tx, g: { installationDbId: string; reason: string; actor: string }): Promise<void> {
  await lockInstallation(tx, g.installationDbId);
  const reason = requireReason(g.reason, "Kurulumu iptal etmek");
  const inst = await tx.kurulum.findUnique({ where: { id: g.installationDbId } });
  if (!inst) throw notFoundError("Kurulum");
  if (inst.durum === "IPTAL") throw new VendorError(409, "KURULUM_IPTAL", "Kurulum zaten iptal");
  const claim = await tx.kurulum.updateMany({ where: { id: inst.id, durum: inst.durum }, data: { durum: "IPTAL" } });
  if (claim.count === 0) throw retryConflict();
  await tx.etkinlestirmeKodu.updateMany({ where: { kurulumId: inst.id, durum: "AKTIF" }, data: { durum: "IPTAL" } });
  await tx.kurulumKaydi.create({ data: { kurulumId: inst.id, olay: "IPTAL", ayrinti: { onceki: inst.durum, sebep: reason }, yapan: g.actor } });
  await notifyDoorbell(tx, inst.id, "lisans");
}

export async function cancelInstallation(g: { installationDbId: string; reason: string; actor: string }): Promise<void> {
  await prisma.$transaction((tx) => cancelInstallationTx(tx, g));
  await recordAudit({ event: "KURULUM_IPTAL", entity: "Kurulum", entityId: g.installationDbId, actor: g.actor, summary: { sebep: g.reason } });
}

/** İptalin ters yolu: kurulum, iptal kaydında saklı ÖNCEKİ durumuna döner (ters satır yazılır). */
export async function reinstateInstallationTx(tx: Tx, g: { installationDbId: string; reason: string; actor: string }): Promise<void> {
  await lockInstallation(tx, g.installationDbId);
  const reason = requireReason(g.reason, "İptali geri almak");
  const cancelled = await tx.kurulumKaydi.findFirst({
    where: { kurulumId: g.installationDbId, olay: "IPTAL" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const previous = (cancelled?.ayrinti as { onceki?: unknown } | null)?.onceki;
  if (previous !== "ETKINLESMEDI" && previous !== "ETKIN" && previous !== "DEVREDILDI") {
    throw stateConflict("Önceki durum kurulum kaydında bulunamadı");
  }
  const claim = await tx.kurulum.updateMany({ where: { id: g.installationDbId, durum: "IPTAL" }, data: { durum: previous } });
  if (claim.count === 0) throw stateConflict("Kurulum iptal durumunda değil");
  await tx.kurulumKaydi.create({
    data: { kurulumId: g.installationDbId, olay: "IPTAL_GERI_ALINDI", ayrinti: { yeni: previous, sebep: reason }, yapan: g.actor },
  });
  await notifyDoorbell(tx, g.installationDbId, "lisans");
}

export async function reinstateInstallation(g: { installationDbId: string; reason: string; actor: string }): Promise<void> {
  await prisma.$transaction((tx) => reinstateInstallationTx(tx, g));
  await recordAudit({ event: "KURULUM_IPTAL_GERI_ALINDI", entity: "Kurulum", entityId: g.installationDbId, actor: g.actor, summary: { sebep: g.reason } });
}
