// =============================================================================
// İSTASYON EKRANINDA "BURADA BEKLEYEN İŞ" — açık kart listesinin adım yüklemi (TEK KAYNAK, 2026-11-06)
// =============================================================================
// Kurşun/KK (`kursun-qc.listOpenCards`) ve Tambur (`tambur.listOpenCards`) açık kart listeleri ile istasyonda belge
// okutmanın "bu istasyonda bekliyor mu" cevabı (`gelen-belge-istasyon-okutma.service`) aynı where'i kullanır:
// listede görünen iş = burada bekleyen iş. Biri değişirse öteki de değişir.
// =============================================================================
import { type Prisma, StationKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { STEP_FLOW_WHERE } from "./quality-station.helper";

/**
 * "Açık (pending) bypass ataması" yüklemi — `kursun-bypass-guard.helper` içindeki `findPendingBypassAssignmentTx` ile
 * BİREBİR aynı tanım (`completedAt IS NULL AND cancelledAt IS NULL`); `some`/`none` filtreleri için tek sabit.
 */
export const PENDING_BYPASS_WHERE: Prisma.KursunBypassAssignmentWhereInput = {
  completedAt: null,
  cancelledAt: null,
};

/** Hangi ekranın istasyonu: kurşun/KK kart akışı ya da tambur. Adım bu ekranın istasyonunda mı (açık/kapalı fark etmez). */
export type StationScreen = "KURSUN_QC" | "TAMBUR";

/** Ekranın istasyon türü: tambur ya da kurşun/KK kart akışı (açık kart listesi + rotasız satır kapısı aynı yüklem). */
export function stationScreenStationWhere(screen: StationScreen): Prisma.StationWhereInput {
  return screen === "TAMBUR" ? { kind: StationKind.TAMBUR } : { ...STEP_FLOW_WHERE };
}

export function stationScreenStepWhere(screen: StationScreen, stationId: string | null): Prisma.WorkOrderStepWhereInput {
  const station = stationScreenStationWhere(screen);
  // Adım KOLONU — `station` spread'ine ek anahtar yazılmaz (OR ezilir).
  return { station, ...(stationId ? { stationId } : {}) };
}

/**
 * Kurşun/KK açık kart listesinin adımı: kart akışı istasyonu, tamamlanmamış, üstünde top var, kurşun bypass'a
 * DAĞITILMAMIŞ (dağıtılmış adımda tablet yazma akışı 409 döner; liste onu hiç göstermez).
 */
export function kursunOpenStepWhere(stationId: string | null): Prisma.WorkOrderStepWhereInput {
  return {
    ...stationScreenStepWhere("KURSUN_QC", stationId),
    status: { not: "COMPLETED" },
    currentRolls: { some: {} },
    kursunBypasses: { none: PENDING_BYPASS_WHERE },
  };
}

/** Tambur açık kart listesinin adımı: tambur istasyonu, tamamlanmamış, üstünde top var. */
export function tamburOpenStepWhere(stationId: string | null): Prisma.WorkOrderStepWhereInput {
  return {
    ...stationScreenStepWhere("TAMBUR", stationId),
    status: { not: "COMPLETED" },
    currentRolls: { some: {} },
  };
}

export function stationScreenOpenStepWhere(screen: StationScreen, stationId: string | null): Prisma.WorkOrderStepWhereInput {
  return screen === "TAMBUR" ? tamburOpenStepWhere(stationId) : kursunOpenStepWhere(stationId);
}

/**
 * Tambur listesi istasyon süzgecinin kapısı (fail-closed): bilinmeyen 404, pasif ya da
 * TAMBUR olmayan istasyon 400 — sessizce boş liste dönmek "bekleyen top yok" yalanıdır.
 */
export async function assertTamburStation(stationId: string): Promise<{ name: string }> {
  const station = await prisma.station.findUnique({
    where: { id: stationId },
    select: { kind: true, isActive: true, name: true },
  });
  if (!station) throw AppError.notFound("İstasyon bulunamadı.", { code: "STATION_NOT_FOUND" });
  if (!station.isActive) throw AppError.badRequest("İstasyon pasif.", { code: "STATION_INACTIVE" });
  if (station.kind !== StationKind.TAMBUR) {
    throw AppError.badRequest("İstasyon bir Tambur istasyonu değil.", { code: "STATION_NOT_TAMBUR" });
  }
  return { name: station.name };
}
