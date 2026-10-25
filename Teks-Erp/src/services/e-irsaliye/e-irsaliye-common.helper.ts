// =============================================================================
// e-İrsaliye motorunun ortak parçaları (E5): kapılar, kayıt okuma, audit yükü, görünüm.
// =============================================================================
// Audit yükü yalnız AYAK İZİDİR: id · no · durum · bağdaştırıcı · XML sha — XML gövdesi
// ve TCKN (şoför/alıcı kişi) yüke GİRMEZ (sır hijyeni, plan R7).
// =============================================================================
import { createHash } from "node:crypto";
import type { EIrsaliye, EIrsaliyeStatus, Prisma } from "@prisma/client";
import { factoryYmd } from "../../constants/time";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import type { PartyInput } from "./despatch-advice.types";
import { isSimulationAdapter } from "./adapters/registry";
import type { EIrsaliyeGate } from "./e-irsaliye-readiness.helper";
import type { CompanyLegalIdentity, EIrsaliyeConfig } from "./e-irsaliye-settings";

export const AUDIT_TABLE = "E_IRSALIYE";

/** Kaynak başına TEK canlı kayıt kümesinin tümleyeni (partial unique `e_irsaliyeler_kaynak_canli_key`). */
export const DEAD_STATUSES: readonly EIrsaliyeStatus[] = ["IPTAL", "REDDEDILDI"];
/** Alanları düzenlenebilen / yerelde iptal edilebilen durumlar (GİB'e gitmemiş). */
export const LOCAL_STATUSES: readonly EIrsaliyeStatus[] = ["TASLAK", "OLUSTURULDU", "HATA"];
export const RESPONSE_STATUSES: readonly EIrsaliyeStatus[] = ["KABUL", "KISMI_KABUL", "REDDEDILDI"];

type Db = Prisma.TransactionClient | typeof prisma;

/** Fail-closed hazırlık kapısı: YAPILANDIRILMAMIS → 409 + eksikler. */
export function requireReady(gate: EIrsaliyeGate): void {
  if (gate.readiness.durum !== "HAZIR") {
    throw AppError.conflict("e-İrsaliye yapılandırılmamış; eksikler tamamlanmadan belge üretilemez.", {
      code: "EIRSALIYE_NOT_CONFIGURED",
      eksikler: gate.readiness.eksikler,
    });
  }
}

export async function loadRecord(db: Db, id: string): Promise<EIrsaliye> {
  const rec = await db.eIrsaliye.findUnique({ where: { id } });
  if (!rec) throw AppError.notFound("e-İrsaliye kaydı bulunamadı.", { code: "EIRSALIYE_NOT_FOUND" });
  return rec;
}

/** Elle kayıt yolları (gönderildi işareti, yanıt, geri alma) yalnız dışa aktar kaydında. */
export function assertManualAdapter(rec: Pick<EIrsaliye, "adapter">): void {
  if (rec.adapter !== "disaAktar") {
    throw AppError.badRequest("Bu işlem yalnız dışa aktarılan (portala elle yüklenen) e-İrsaliyelerde yapılır.", {
      code: "EIRSALIYE_MANUAL_ONLY",
      adapter: rec.adapter,
    });
  }
}

/** Sevkiyat e-İrsaliyeye uygun mu: yurt içi · sevk edilmiş · yürürlük tarihinden sonra. */
export function assertShipmentEligible(
  s: { status: string; destination: string; dispatchedAt: Date | null } | null,
  cfg: EIrsaliyeConfig,
): asserts s is { status: string; destination: string; dispatchedAt: Date } {
  if (!s) throw AppError.notFound("Sevkiyat bulunamadı.", { code: "SHIPMENT_NOT_FOUND" });
  if (s.destination !== "DOMESTIC") {
    throw AppError.badRequest("Yurt dışı sevkiyat için e-İrsaliye bu sürümde desteklenmiyor.", { code: "EIRSALIYE_EXPORT" });
  }
  if (s.status !== "DISPATCHED" || !s.dispatchedAt) {
    throw AppError.conflict("e-İrsaliye yalnız sevk edilmiş sevkiyat için hazırlanır.", { code: "EIRSALIYE_SHIPMENT_NOT_DISPATCHED" });
  }
  const gun = factoryYmd(s.dispatchedAt);
  if (cfg.yururlukTarihi && gun < cfg.yururlukTarihi) {
    throw AppError.conflict(`Bu sevkiyat e-İrsaliye yürürlük tarihinden (${cfg.yururlukTarihi}) önce sevk edilmiş; kâğıt irsaliye geçerlidir.`, {
      code: "EIRSALIYE_BEFORE_EFFECTIVE_DATE",
    });
  }
}

/** Firma resmi künyesi → UBL gönderici tarafı. */
export function supplierFromLegalIdentity(k: CompanyLegalIdentity): PartyInput {
  const opt = (v: string) => (v.trim() ? v.trim() : null);
  return {
    taxId: k.kimlikNo,
    name: k.unvan,
    person: k.kimlikTuru === "TCKN" ? { firstName: k.kisiAd, familyName: k.kisiSoyad } : null,
    taxOffice: opt(k.vergiDairesi),
    address: {
      streetName: opt(k.cadde),
      buildingNumber: opt(k.binaNo),
      citySubdivisionName: k.ilce,
      cityName: k.il,
      postalZone: opt(k.postaKodu),
      countryName: k.ulke,
    },
    mersisNo: opt(k.mersisNo),
    tradeRegistryNo: opt(k.ticaretSicilNo),
    telephone: opt(k.telefon),
    email: opt(k.eposta),
  };
}

export const sha256Hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

/** Yanıt görünümü: XML gövdesi zaten seçilmez; simülasyon kaydı her yanıtta işaretli. */
export function recordView(rec: EIrsaliye) {
  const { clientToken: _t, ...rest } = rec;
  return { ...rest, simulasyon: isSimulationAdapter(rec.adapter) };
}

/** Audit kaydı yükü; çağıran `AuditService.log`a verir (best-effort, tx DIŞINDA) — yazma yolu audit'i kendi dosyasında taşır. */
export function eIrsaliyeAuditEntry(
  action: "CREATE" | "UPDATE",
  userId: string | null,
  rec: Pick<EIrsaliye, "id" | "documentNo" | "status" | "adapter" | "shipmentId">,
  extra: { event: string; oncekiDurum?: EIrsaliyeStatus | null; xmlSha256?: string | null; alanlar?: string[] },
): Parameters<typeof AuditService.log>[0] {
  return {
    userId: userId ?? undefined,
    action,
    tableName: AUDIT_TABLE,
    recordId: rec.id,
    ...(extra.oncekiDurum ? { oldData: { status: extra.oncekiDurum } } : {}),
    newData: {
      event: extra.event,
      shipmentId: rec.shipmentId,
      documentNo: rec.documentNo,
      status: rec.status,
      adapter: rec.adapter,
      ...(extra.xmlSha256 ? { xmlSha256: extra.xmlSha256 } : {}),
      ...(extra.alanlar ? { alanlar: extra.alanlar } : {}),
    },
  };
}
