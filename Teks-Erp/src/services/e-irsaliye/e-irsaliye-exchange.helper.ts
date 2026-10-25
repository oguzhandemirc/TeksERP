// =============================================================================
// e-İrsaliye GÖNDERİM ve YANIT (plan §3.2–§3.3)
// =============================================================================
// Bağdaştırıcı çağrısı tx DIŞINDA yapılır; sonuç gelince claim. Claim düşerse (yarış)
// sonuç kaybolmaz: "Durumu sorgula" düzeltir. Elle yollar (gönderildi işareti, yanıt,
// geri alma) yalnız `disaAktar` kaydında; geri alma ileri olayı SİLMEZ, karşı olay yazar.
// =============================================================================
import { AuditService } from "../audit.service";
import { Prisma, type EIrsaliye, type EIrsaliyeStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { uyari } from "../../lib/logger";
import { lockShipmentScopeTx } from "../helpers/shipment-locks.helper";
import { resolveAdapter } from "./adapters/registry";
import type { StatusResult } from "./adapters/adapter.types";
import {
  assertManualAdapter, eIrsaliyeAuditEntry, DEAD_STATUSES, loadRecord, recordView, requireReady, RESPONSE_STATUSES,
} from "./e-irsaliye-common.helper";
import { resolveEIrsaliyeGate } from "./e-irsaliye-readiness.helper";
import { SHIPMENT_STILL_DISPATCHED } from "./e-irsaliye-shipment.helper";
import { transitionEIrsaliyeTx, type EIrsaliyeTransition } from "./e-irsaliye-transition.helper";

type Step = Omit<EIrsaliyeTransition, "id" | "actorId">;

/** Kilit + geçiş + taze kayıt; audit tx DIŞINDA. */
async function applyStep(rec: EIrsaliye, userId: string | null, step: Step, auditEvent: string) {
  const fresh = await prisma.$transaction(async (tx) => {
    await lockShipmentScopeTx(tx, rec.sourceId);
    await transitionEIrsaliyeTx(tx, { ...step, id: rec.id, actorId: userId });
    return loadRecord(tx, rec.id);
  });
  await AuditService.log(eIrsaliyeAuditEntry("UPDATE", userId, fresh, { event: auditEvent, oncekiDurum: rec.status }));
  return recordView(fresh);
}

function responseStep(status: StatusResult["durum"], note: string | null, summary: unknown): Step | null {
  if (status === "GONDERILDI") return null;
  const responsePatch = { responseAt: new Date(), responseNote: note, responseSummary: (summary ?? undefined) as Prisma.InputJsonValue | undefined };
  if (status === "HATA") return { from: ["GONDERILDI"], to: "HATA", event: "HATA_ALINDI", note, patch: responsePatch };
  return { from: ["GONDERILDI"], to: status, event: "YANIT_KAYDEDILDI", note, patch: responsePatch };
}

/** Bağdaştırıcıyla gönder (simülasyon / v2 entegratör). */
export async function send(id: string, userId: string | null) {
  requireReady(await resolveEIrsaliyeGate());
  const rec = await loadRecord(prisma, id);
  const adapter = resolveAdapter(rec.adapter);
  if (!adapter.yetenek.gonder) {
    throw AppError.badRequest("Bu yöntemde gönderim elle kaydedilir: XML'i indirip portala yükleyin, sonra 'Portala yükledim' deyin.", { code: "EIRSALIYE_ADAPTER_CAPABILITY" });
  }
  if (rec.status !== "OLUSTURULDU" || !rec.currentXmlId) {
    throw AppError.conflict("Yalnız oluşturulmuş e-İrsaliye gönderilir.", { code: "EIRSALIYE_STATE_CONFLICT" });
  }
  const xml = await prisma.eIrsaliyeXml.findUniqueOrThrow({ where: { id: rec.currentXmlId }, select: { xml: true } });
  const ship = await prisma.shipment.findUnique({ where: { id: rec.sourceId }, select: { customer: { select: { taxNumber: true } } } });
  const result = await adapter.gonder({ xml: xml.xml, ettn: rec.ettn!, belgeNo: rec.documentNo!, aliciVkn: ship?.customer.taxNumber ?? "" });
  if (!result.ok && result.gecici) {
    throw AppError.conflict(`Gönderim geçici olarak başarısız: ${result.hata}. Biraz sonra yeniden deneyin.`, { code: "EIRSALIYE_SEND_TEMPORARY" });
  }
  const step: Step = result.ok
    ? { from: ["OLUSTURULDU"], to: "GONDERILDI", event: "GONDERILDI", xmlId: rec.currentXmlId, whereExtra: { currentXmlId: rec.currentXmlId, ...SHIPMENT_STILL_DISPATCHED },
        patch: { sentXmlId: rec.currentXmlId, sentAt: new Date() } }
    : { from: ["OLUSTURULDU"], to: "HATA", event: "HATA_ALINDI", note: result.hata, whereExtra: { currentXmlId: rec.currentXmlId } };
  try {
    return await applyStep(rec, userId, step, result.ok ? "GONDERILDI" : "HATA_ALINDI");
  } catch (err) {
    // Dış çağrı oldu ama kayıt yarışı kaybetti — sonuç loglanır, "Durumu sorgula" düzeltir.
    uyari("e-irsaliye", `gönderim sonucu kayda yazılamadı id=${id} ok=${result.ok}`);
    throw err;
  }
}

/** Elle: "Portala yükledim" (yalnız disaAktar). Portal numara/ETTN'i ezdiyse teyit alanları (⚠ plan R6). */
export async function markSent(id: string, body: { confirmedEttn?: string | null; confirmedNo?: string | null }, userId: string | null) {
  const rec = await loadRecord(prisma, id);
  assertManualAdapter(rec);
  return applyStep(rec, userId, {
    from: ["OLUSTURULDU"], to: "GONDERILDI", event: "GONDERILDI", xmlId: rec.currentXmlId,
    // Storno ile yarışta ikisi birden başarılı olmasın: sevkiyat hâlâ çıkmış olmalı (aynı kilit).
    whereExtra: { currentXmlId: rec.currentXmlId, ...SHIPMENT_STILL_DISPATCHED },
    patch: { sentXmlId: rec.currentXmlId, sentAt: new Date(), confirmedEttn: body.confirmedEttn ?? null, confirmedNo: body.confirmedNo ?? null },
    conflictMessage: "Yalnız sevk edilmiş sevkiyatın oluşturulmuş e-İrsaliyesi gönderildi olarak işaretlenir; sayfayı yenileyin.",
  }, "GONDERILDI");
}

/** Bağdaştırıcıdan durum sorgula; GONDERILDI dönerse kayıt değişmez. */
export async function poll(id: string, userId: string | null) {
  requireReady(await resolveEIrsaliyeGate());
  const rec = await loadRecord(prisma, id);
  const adapter = resolveAdapter(rec.adapter);
  if (!adapter.yetenek.durumSorgula) {
    throw AppError.badRequest("Bu yöntemde alıcı yanıtı elle kaydedilir.", { code: "EIRSALIYE_ADAPTER_CAPABILITY" });
  }
  if (rec.status !== "GONDERILDI") {
    throw AppError.conflict("Yalnız gönderilmiş e-İrsaliyenin durumu sorgulanır.", { code: "EIRSALIYE_STATE_CONFLICT" });
  }
  const result = await adapter.durumSorgula({ ettn: rec.ettn! });
  const step = responseStep(result.durum, result.aciklama ?? null, result.yanit);
  if (!step) return { ...recordView(rec), sorguSonucu: result.durum };
  return { ...(await applyStep(rec, userId, step, step.event)), sorguSonucu: result.durum };
}

/** Elle alıcı yanıtı (yalnız disaAktar). */
export async function recordResponse(
  id: string,
  body: { durum: "KABUL" | "KISMI_KABUL" | "REDDEDILDI" | "HATA"; not?: string | null; ozet?: unknown },
  userId: string | null,
) {
  const rec = await loadRecord(prisma, id);
  assertManualAdapter(rec);
  const step = responseStep(body.durum, body.not ?? null, body.ozet)!;
  return applyStep(rec, userId, { ...step, conflictMessage: "Yanıt yalnız gönderilmiş e-İrsaliyeye kaydedilir; sayfayı yenileyin." }, step.event);
}

/** Geri alma önizlemesi — etkiler somut listelenir; engel varsa `engel`. */
export async function getUndoPreview(id: string) {
  const rec = await loadRecord(prisma, id);
  const etkiler: string[] = [];
  let engel: string | null = rec.adapter === "disaAktar" ? null : "Geri alma yalnız dışa aktarılan e-İrsaliyede yapılır.";
  let islem: "undo-sent" | "undo-response" | null = null;
  if (rec.status === "GONDERILDI") {
    islem = "undo-sent";
    etkiler.push(`Durum "Gönderildi"den "Oluşturuldu"ya döner (e-İrsaliye no ${rec.documentNo}).`);
    etkiler.push("Gönderim kaydı silinmez; geçmişe 'gönderim geri alındı' satırı eklenir.");
    etkiler.push("Portala gerçekten yüklediyseniz belge GİB'de durur; bu işlem yalnız bizim kaydımızı düzeltir.");
  } else if (RESPONSE_STATUSES.includes(rec.status) || rec.status === "HATA") {
    islem = rec.status === "HATA" ? null : "undo-response";
    etkiler.push(`Kaydedilen yanıt geri alınır, durum "Gönderildi"ye döner (e-İrsaliye no ${rec.documentNo}).`);
    etkiler.push("Yanıt kaydı silinmez; geçmişe 'yanıt geri alındı' satırı eklenir.");
    if (rec.status === "HATA") engel ??= "Hata durumu geri alınmaz; düzeltip yeniden üretin.";
    if (rec.status === "REDDEDILDI" && (await hasLiveSibling(rec))) {
      engel ??= "Bu sevkiyat için yerine yeni e-İrsaliye açılmış; önce onu iptal edin.";
    }
  } else {
    engel ??= "Bu durumda geri alınacak gönderim ya da yanıt yok.";
  }
  return { kayit: recordView(rec), islem, etkiler, engel };
}

async function hasLiveSibling(rec: EIrsaliye): Promise<boolean> {
  const n = await prisma.eIrsaliye.count({
    where: { sourceType: rec.sourceType, sourceId: rec.sourceId, id: { not: rec.id }, status: { notIn: [...DEAD_STATUSES] } },
  });
  return n > 0;
}

/** GONDERILDI → OLUSTURULDU, karşı olay GONDERIM_GERI_ALINDI. */
export async function undoSent(id: string, userId: string | null) {
  const rec = await loadRecord(prisma, id);
  assertManualAdapter(rec);
  return applyStep(rec, userId, {
    from: ["GONDERILDI"], to: "OLUSTURULDU", event: "GONDERIM_GERI_ALINDI", xmlId: rec.sentXmlId,
    patch: { sentXmlId: null, sentAt: null, confirmedEttn: null, confirmedNo: null },
    conflictMessage: "Yalnız gönderilmiş (yanıtsız) e-İrsaliyenin gönderimi geri alınır; sayfayı yenileyin.",
  }, "GONDERIM_GERI_ALINDI");
}

/** KABUL/KISMI_KABUL/REDDEDILDI → GONDERILDI, karşı olay YANIT_GERI_ALINDI. */
export async function undoResponse(id: string, userId: string | null) {
  const rec = await loadRecord(prisma, id);
  assertManualAdapter(rec);
  if (rec.status === "REDDEDILDI" && (await hasLiveSibling(rec))) {
    throw AppError.conflict("Bu sevkiyat için yerine yeni e-İrsaliye açılmış; önce onu iptal edin.", { code: "EIRSALIYE_REPLACED" });
  }
  const from: EIrsaliyeStatus[] = [...RESPONSE_STATUSES];
  return applyStep(rec, userId, {
    from, to: "GONDERILDI", event: "YANIT_GERI_ALINDI",
    patch: { responseAt: null, responseNote: null, responseSummary: Prisma.DbNull },
    conflictMessage: "Geri alınacak yanıt yok; sayfayı yenileyin.",
  }, "YANIT_GERI_ALINDI");
}
