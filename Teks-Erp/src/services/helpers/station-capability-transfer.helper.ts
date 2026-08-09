// =============================================================================
// TeksERP - Station Capability Transfer Helper
// =============================================================================
// İstasyonun özellik yeteneklerini "buradan geçen rulonun kazanacağı şeyler"
// olarak Roll'a yazar. Örnek: Kurşun istasyonuna KURSUN özelliği AUTO modunda
// atanmışsa, o istasyonda QC2 tamamlanan her top KURSUN'u otomatik kazanır.
// Boyahane fason kabulündeki kategori-bazlı kopyalamanın internal karşılığı.
//
// ⚠️ 2026-08-10 — MOD SÖZLEŞMESİ. Eskiden istasyonun TÜM özellikleri körlemesine
// kopyalanıyordu ve `schema.prisma` bunu tuzak olarak işaretlemişti ("Kurşun'un
// listesine ikinci bir özellik eklendiği gün o özellik oradan geçen HER TOPA
// sessizce yazılır"). Artık:
//   • AUTO              → her zaman yazılır (operatöre sorulmaz)
//   • OPTIONAL/REQUIRED → YALNIZ `selectedPropertyIds` içinde geliyorsa yazılır
//
// ⚠️ REQUIRED'ın "seçilmeden adım kapanmaz" kuralı BURADA uygulanmaz —
// `assertRequiredPropertiesSelected` ile operatör yolunda (kursun-qc.completeQc2)
// uygulanır. Sebep: bu helper'ı operatörsüz yollar da çağırıyor (kursun-bypass
// kapanışı, inventory.kursunFinish). Zorunluluğu buraya koymak, tabletin hiç
// dokunmadığı bir bypass kapanışını 400'e düşürürdü.
//
// Seçim gönderilmezse davranış = "yalnız AUTO" — yani eski istemci (APK) yeni
// backend'e karşı bugünkü sonucu üretmeye devam eder.
// =============================================================================

import { StationPropertyMode } from "@prisma/client";
import type { TxClient } from "./roll-step.helper";
import { AppError } from "../../utils/app-error";

export interface StationPropertyCap {
  propertyId: string;
  mode: StationPropertyMode;
  code: string;
  name: string;
}

/** İstasyonun özellik yetenekleri + modları (ekran çizimi ve doğrulama için). */
export async function loadStationPropertyCaps(
  tx: TxClient,
  stationId: string,
): Promise<StationPropertyCap[]> {
  const rows = await tx.stationProperty.findMany({
    where: { stationId, property: { isActive: true } },
    select: {
      propertyId: true,
      mode: true,
      property: { select: { code: true, name: true, sortOrder: true } },
    },
    orderBy: [{ property: { sortOrder: "asc" } }, { property: { code: "asc" } }],
  });
  return rows.map((r) => ({
    propertyId: r.propertyId,
    mode: r.mode,
    code: r.property.code,
    name: r.property.name,
  }));
}

/**
 * REQUIRED modundaki her özellik seçilmiş mi? Değilse ADIYLA 400.
 *
 * ⚠️ "Bazı özellikler eksik" DEMEZ — eldivenli operatörün ekranda hangi tuşa
 * basacağını bilmesi gerekiyor (aynı kural fason istasyon doğrulamasında da var:
 * `fabric-property.service.assertStationsCanApplyProperty`).
 */
export function assertRequiredPropertiesSelected(
  caps: StationPropertyCap[],
  selectedPropertyIds: string[] | null | undefined,
): void {
  const selected = new Set(selectedPropertyIds ?? []);
  const missing = caps
    .filter((c) => c.mode === StationPropertyMode.REQUIRED && !selected.has(c.propertyId))
    .map((c) => c.name);
  if (missing.length > 0) {
    throw AppError.badRequest(
      `Bu istasyonda zorunlu olan özellik(ler) işaretlenmedi: ${missing.join(", ")}.`,
      { code: "REQUIRED_PROPERTY_MISSING", missing },
    );
  }
}

/**
 * İstasyonun yeteneklerini Roll'a `RollProperty` olarak yazar (skipDuplicates).
 * Yazılacak küme = AUTO satırları ∪ (seçilenler ∩ istasyonun yetenekleri).
 *
 * ⚠️ Kesişim ALINIR: istemcinin gönderdiği id körlemesine yazılmaz, yoksa tablet
 * istasyonun veremeyeceği bir özelliği topa yazdırabilirdi.
 */
export async function copyStationCapabilitiesToRoll(
  tx: TxClient,
  args: {
    stationId: string;
    rollId: string;
    /** Operatörün işaretledikleri. Verilmezse yalnız AUTO yazılır. */
    selectedPropertyIds?: string[] | null;
    /** Zaten yüklenmiş yetenek listesi (ikinci sorguyu önler). */
    caps?: StationPropertyCap[];
  },
): Promise<{ propertyIds: string[] }> {
  const caps = args.caps ?? (await loadStationPropertyCaps(tx, args.stationId));
  if (caps.length === 0) return { propertyIds: [] };

  const selected = new Set(args.selectedPropertyIds ?? []);
  const propertyIds = caps
    .filter((c) => c.mode === StationPropertyMode.AUTO || selected.has(c.propertyId))
    .map((c) => c.propertyId);
  if (propertyIds.length === 0) return { propertyIds: [] };

  await tx.rollProperty.createMany({
    data: propertyIds.map((propertyId) => ({ rollId: args.rollId, propertyId })),
    skipDuplicates: true,
  });
  return { propertyIds };
}
