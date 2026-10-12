// =============================================================================
// HAM DURUŞ KODU → SEBEP ÇÖZÜCÜSÜ — tek yer (makine kaynaklı duruş D2)
// =============================================================================
// Kartın bildirdiği ham kodun anlamı KART TİPİNE bağlıdır; tezgah satırı (`machineId` dolu)
// kart tipi genelini ezer. Yalnız canlı eşleme ve kullanılabilir sebep (aktif, `MACHINE_STOP`,
// kayıp sınıflı) aday olur — kullanılamaz üst-yazım genele düşer. Eşleşme yoksa NULL: duruş
// sebepsiz açılır (sınıflandırma borcu, bugünkü davranış).
// =============================================================================
import { ReasonPresetKind, type Prisma } from "@prisma/client";

type Reader = Pick<Prisma.TransactionClient, "machineStopCodeMap">;

export interface StopCodeKey {
  collectorType: string | null;
  rawStopCode: string | null;
  machineId: string;
}

export interface StopCodeCandidate {
  id: string;
  machineId: string | null;
  stopReason: { id: string; code: string };
}

export interface StopCodeResolution {
  mappingId: string;
  stopReasonId: string;
  reasonCode: string;
  /** Hangi satır kazandı — tezgah üst-yazımı mı, kart tipi geneli mi. */
  scope: "MACHINE" | "COLLECTOR_TYPE";
}

/** Eşleme adayı sorgusunun yüklemi — çözücü ve bekçi aynı parçayı okur. */
export function stopCodeCandidateWhere(key: { collectorType: string; rawStopCode: string; machineId: string }): Prisma.MachineStopCodeMapWhereInput {
  return {
    collectorType: key.collectorType,
    rawStopCode: key.rawStopCode,
    isActive: true,
    OR: [{ machineId: key.machineId }, { machineId: null }],
    stopReason: { kind: ReasonPresetKind.MACHINE_STOP, isActive: true, stopLossClass: { not: null } },
  };
}

/** Saf öncelik: tezgah satırı > kart tipi geneli > yok. */
export function pickStopCodeMapping(rows: readonly StopCodeCandidate[], machineId: string): StopCodeResolution | null {
  const own = rows.find((r) => r.machineId === machineId);
  const general = rows.find((r) => r.machineId === null);
  const hit = own ?? general;
  if (!hit) return null;
  return { mappingId: hit.id, stopReasonId: hit.stopReason.id, reasonCode: hit.stopReason.code, scope: own ? "MACHINE" : "COLLECTOR_TYPE" };
}

/** (kart tipi, ham kod, tezgah) → sebep | null. Kart tipi ya da ham kod yoksa sorgu atılmaz. */
export async function resolveMachineStopCode(db: Reader, key: StopCodeKey): Promise<StopCodeResolution | null> {
  const collectorType = key.collectorType?.trim() ?? "";
  const rawStopCode = key.rawStopCode?.trim() ?? "";
  if (collectorType.length === 0 || rawStopCode.length === 0) return null;
  const rows = await db.machineStopCodeMap.findMany({
    where: stopCodeCandidateWhere({ collectorType, rawStopCode, machineId: key.machineId }),
    select: { id: true, machineId: true, stopReason: { select: { id: true, code: true } } },
  });
  return pickStopCodeMapping(rows, key.machineId);
}
