// DR DEVRALIMI — self-servis + satıcıya anında bildirim (kullanıcı kararı). DR sınıfı kurulum,
// AYNI tesisteki üretim kurulumunu devralır: ana kurulum DEVREDILDI olur, bir sonraki yoklamada
// `devredildi: true` kirası alır (fabrikada anında KISITLI + bant — iki DB ayrışmasın).
// Ters yol: portal eylemi `revertDrTakeover` (DEVREDILDI → ETKIN, kurulum kaydına satır).
import type { LicenseResponse } from "../lisans-protokol";
import { recordAudit } from "../lib/audit";
import { VendorError } from "../lib/errors";
import { lockInstallation, lockInstallations } from "../lib/locks";
import { prisma } from "../lib/prisma";
import type { VendorContext } from "./context";
import { notifyDoorbell } from "./doorbell";
import type { AuthenticatedRequest } from "./installation-auth";
import { renewLease } from "./renewal.service";

export async function processDrTakeover(
  ctx: VendorContext,
  auth: AuthenticatedRequest,
  body: { anaKurulumId: string; gerekce: string },
  nowMs: number,
): Promise<LicenseResponse> {
  const dr = auth.installation;
  if (auth.role !== "CURRENT") throw new VendorError(401, "ISTEK_KID", "İstek bu kurulumun kayıtlı anahtarıyla imzalanmamış");
  if (dr.sinif !== "DR" || dr.durum !== "ETKIN") {
    throw new VendorError(400, "GOVDE_GECERSIZ", "Üretimi yalnız ETKİN bir DR sınıfı kurulum devralabilir");
  }
  const main = await prisma.kurulum.findUnique({ where: { kurulumId: body.anaKurulumId } });
  // Başka tesisin kurulumu "bulunamadı" sayılır: varlığı sızdırılmaz.
  if (!main || main.id === dr.id || main.tesisId !== dr.tesisId || main.sinif !== "URETIM") {
    throw new VendorError(400, "GOVDE_GECERSIZ", "Ana kurulum bu tesisin üretim kurulumları arasında bulunamadı");
  }
  const changed = await prisma.$transaction(async (tx) => {
    await lockInstallations(tx, [dr.id, main.id]);
    const freshMain = await tx.kurulum.findUniqueOrThrow({ where: { id: main.id } });
    if (freshMain.durum === "DEVREDILDI") return false;
    if (freshMain.durum !== "ETKIN") throw new VendorError(400, "GOVDE_GECERSIZ", "Ana kurulum ETKİN değil; devralınacak üretim yok");
    const claim = await tx.kurulum.updateMany({ where: { id: main.id, durum: "ETKIN" }, data: { durum: "DEVREDILDI" } });
    if (claim.count === 0) return false;
    await tx.kurulumKaydi.create({
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
    // Satıcıya anında bildirim: portal (1f) bu denetim olayını ve kurulum kaydını gösterir.
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
export async function revertDrTakeover(g: { mainInstallationDbId: string; actor: string; reason: string }): Promise<void> {
  if (!g.reason.trim()) throw new VendorError(400, "GOVDE_GECERSIZ", "Geri alma için sebep zorunlu");
  await prisma.$transaction(async (tx) => {
    await lockInstallation(tx, g.mainInstallationDbId);
    const claim = await tx.kurulum.updateMany({
      where: { id: g.mainInstallationDbId, durum: "DEVREDILDI" },
      data: { durum: "ETKIN" },
    });
    if (claim.count === 0) throw new VendorError(409, "GOVDE_GECERSIZ", "Kurulum devredilmiş durumda değil");
    await tx.kurulumKaydi.create({
      data: { kurulumId: g.mainInstallationDbId, olay: "DR_GERI_ALINDI", ayrinti: { sebep: g.reason }, yapan: g.actor },
    });
    await notifyDoorbell(tx, g.mainInstallationDbId, "lisans");
  });
  await recordAudit({ event: "DR_GERI_ALINDI", entity: "Kurulum", entityId: g.mainInstallationDbId, actor: g.actor, summary: { sebep: g.reason } });
}
