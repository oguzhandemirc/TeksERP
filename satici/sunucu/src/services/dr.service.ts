// DR DEVRALIMI — self-servis + satıcıya anında bildirim (kullanıcı kararı). DR sınıfı kurulum,
// AYNI tesisteki üretim kurulumunu devralır: ana kurulum DEVREDILDI olur, bir sonraki yoklamada
// `devredildi: true` kirası alır (fabrikada anında KISITLI + bant — iki DB ayrışmasın).
// Ters yol: portal eylemi `revertDrTakeover` (DEVREDILDI → ETKIN, kurulum kaydına satır).
import type { Kurulum } from "@prisma/client";
import type { LicenseResponse } from "../lisans-protokol";
import { recordAudit } from "../lib/audit";
import { VendorError, stateConflict } from "../lib/errors";
import { lockInstallation, lockInstallations } from "../lib/locks";
import { prisma, type Tx } from "../lib/prisma";
import { enqueueNotificationTx } from "../notifications/outbox";
import type { VendorContext } from "./context";
import { notifyDoorbell } from "./doorbell";
import type { AuthenticatedRequest } from "./installation-auth";
import { assertBindableBeforeLease } from "./lease-binding";
import { renewLease } from "./renewal.service";
import { requireReason } from "./sanction.service";

export const DR_AMBIGUOUS_MESSAGE = "Ana kurulum kimliğini portaldan ya da ana sunucunun Lisans ekranından alın";

/**
 * Kimliksiz DR: tesisin TEK etkin ÜRETİM kurulumu. Yoksa, bu DR'nin zaten devraldığı tek ÜRETİM kurulumu
 * (yanıtı kaybolmuş isteğin yeniden denemesi aynı sonucu alsın); 0 ya da birden çok → 409 DR_ANA_BELIRSIZ.
 */
async function inferMainInstallation(dr: Kurulum): Promise<Kurulum> {
  const base = { tesisId: dr.tesisId, sinif: "URETIM" as const, aktif: true, id: { not: dr.id } };
  const active = await prisma.kurulum.findMany({ where: { ...base, durum: "ETKIN" }, take: 2 });
  if (active.length === 1) return active[0]!;
  if (active.length === 0) {
    const taken = await prisma.kurulum.findMany({ where: { ...base, durum: "DEVREDILDI" }, take: 2 });
    const mine = taken.length === 1 ? await prisma.kurulumKaydi.findFirst({ where: { kurulumId: taken[0]!.id, olay: "DEVREDILDI" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }) : null;
    const drId = mine?.ayrinti && typeof mine.ayrinti === "object" && !Array.isArray(mine.ayrinti) ? mine.ayrinti.drKurulumId : undefined;
    if (drId === dr.kurulumId) return taken[0]!;
  }
  throw new VendorError(409, "DR_ANA_BELIRSIZ", DR_AMBIGUOUS_MESSAGE);
}

/** Ucuz ön denetim (yan etkisiz, nonce'tan ÖNCE): DR sınıfı + ETKİN; ana kurulum aynı tesisin üretim kurulumu. */
export async function drTakeoverTarget(dr: Kurulum, body: { anaKurulumId?: string | undefined }): Promise<Kurulum> {
  if (dr.sinif !== "DR" || dr.durum !== "ETKIN") {
    throw new VendorError(400, "GOVDE_GECERSIZ", "Üretimi yalnız ETKİN bir DR sınıfı kurulum devralabilir");
  }
  if (body.anaKurulumId === undefined) return inferMainInstallation(dr);
  const main = await prisma.kurulum.findUnique({ where: { kurulumId: body.anaKurulumId } });
  // Başka tesisin kurulumu "bulunamadı" sayılır: varlığı sızdırılmaz.
  if (!main || main.id === dr.id || main.tesisId !== dr.tesisId || main.sinif !== "URETIM") {
    throw new VendorError(400, "GOVDE_GECERSIZ", "Ana kurulum bu tesisin üretim kurulumları arasında bulunamadı");
  }
  return main;
}

/**
 * Uç ön denetimi (nonce'tan ÖNCE): hedef (yan etkisiz) + kira bağı — DR'nin yeni kirası bağlanamayacaksa (genişlik kapısı;
 * istek elindeki HAK'ı bildirmez) devir YAZILMAZ: ana kurulum ETKİN kalır, acil kök talebi + 403; DR elindeki kirayla sürer.
 */
export async function drTakeoverPrecheck(dr: Kurulum, body: { anaKurulumId?: string | undefined }, nowMs: number): Promise<void> {
  await drTakeoverTarget(dr, body);
  await assertBindableBeforeLease({ installation: dr, nowMs });
}

export async function processDrTakeover(
  ctx: VendorContext,
  auth: AuthenticatedRequest,
  body: { anaKurulumId?: string | undefined; gerekce: string },
  nowMs: number,
): Promise<LicenseResponse> {
  const dr = auth.installation;
  const main = await drTakeoverTarget(dr, body);
  const changed = await prisma.$transaction(async (tx) => {
    await lockInstallations(tx, [dr.id, main.id]);
    const freshMain = await tx.kurulum.findUniqueOrThrow({ where: { id: main.id } });
    if (freshMain.durum === "DEVREDILDI") return false;
    if (freshMain.durum !== "ETKIN") throw new VendorError(400, "GOVDE_GECERSIZ", "Ana kurulum ETKİN değil; devralınacak üretim yok");
    const claim = await tx.kurulum.updateMany({ where: { id: main.id, durum: "ETKIN" }, data: { durum: "DEVREDILDI" } });
    if (claim.count === 0) return false;
    const handover = await tx.kurulumKaydi.create({
      data: {
        kurulumId: main.id,
        olay: "DEVREDILDI",
        ayrinti: { drKurulumId: dr.kurulumId, gerekce: body.gerekce },
        yapan: `kurulum:${dr.kurulumId}`,
      },
    });
    await tx.kurulumKaydi.create({
      data: {
        kurulumId: dr.id,
        olay: "DR_DEVRALDI",
        ayrinti: { anaKurulumId: main.kurulumId, gerekce: body.gerekce },
        yapan: `kurulum:${dr.kurulumId}`,
      },
    });
    await notifyDoorbell(tx, main.id, "lisans");
    // Satıcıya anında bildirim AYNI tx'te (devir başına bir kez; gerekçe metni GİTMEZ).
    await enqueueNotificationTx(tx, { event: "DR_DEVRI", keyParts: [handover.id], installationDbId: main.id, relatedId: main.id, portalPath: `/kurulumlar/${main.id}`, referans: `DR: ${dr.ad ?? dr.kurulumId.slice(0, 8)}` });
    return true;
  });
  if (changed) {
    await recordAudit({
      event: "DR_DEVRALINDI",
      entity: "Kurulum",
      entityId: main.id,
      actor: `kurulum:${dr.kurulumId}`,
      summary: { drKurulumId: dr.id, gerekce: body.gerekce },
    });
    // Portal (1f) bu denetim olayını ve kurulum kaydını gösterir; e-posta/Telegram giden kutusundan (tx içinde yazıldı).
    console.warn(`[satici] DR DEVRALIMI: tesis ${dr.tesisId} — üretim ${main.id} → DR ${dr.id}`);
  }
  const { response } = await renewLease(ctx, {
    installationDbId: dr.id,
    kid: auth.kid,
    presentedLeaseId: null,
    assumeAtTip: true,
    measured: null,
    clientEntitlement: null,
    telemetry: null,
    nowMs,
  });
  return response;
}

/** Portal eylemi (ters yol): devredilmiş ana kurulumu yeniden ETKİN yapar. */
export async function revertDrTakeoverTx(tx: Tx, g: { mainInstallationDbId: string; actor: string; reason: string }): Promise<void> {
  await lockInstallation(tx, g.mainInstallationDbId);
  const reason = requireReason(g.reason, "DR devrini geri almak");
  const claim = await tx.kurulum.updateMany({
    where: { id: g.mainInstallationDbId, durum: "DEVREDILDI" },
    data: { durum: "ETKIN" },
  });
  if (claim.count === 0) throw stateConflict("Kurulum devredilmiş durumda değil");
  await tx.kurulumKaydi.create({
    data: { kurulumId: g.mainInstallationDbId, olay: "DR_GERI_ALINDI", ayrinti: { sebep: reason }, yapan: g.actor },
  });
  await notifyDoorbell(tx, g.mainInstallationDbId, "lisans");
}

export async function revertDrTakeover(g: { mainInstallationDbId: string; actor: string; reason: string }): Promise<void> {
  await prisma.$transaction((tx) => revertDrTakeoverTx(tx, g));
  await recordAudit({ event: "DR_GERI_ALINDI", entity: "Kurulum", entityId: g.mainInstallationDbId, actor: g.actor, summary: { sebep: g.reason } });
}
