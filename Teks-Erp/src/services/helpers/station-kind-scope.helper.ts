// =============================================================================
// Duruş sebebinin İSTASYON TÜRÜ KAPSAMI — tek yüklem, iki biçim (boğaz ikizi)
// =============================================================================
// `ReasonPreset.stationKinds` boş = her istasyon; dolu = yalnız listedeki türler. Liste süzgeci
// (`GET /reason-presets?stationKind=`) Prisma parçasını, duruşa sebep YAZAN insan yolu bellek-içi
// yüklemi okur — ikisi aynı soruyu cevaplar, burada yan yana durur (`test_durus_istasyon_kapsami`).
// =============================================================================
import type { Prisma, StationKind } from "@prisma/client";
import { AppError } from "../../utils/app-error";

/** Bellek-içi yüklem: kapsam boş ya da türü içeriyor. `stationKindScopeWhere`in ikizi. */
export function stationKindInScope(stationKinds: readonly StationKind[], stationKind: StationKind): boolean {
  return stationKinds.length === 0 || stationKinds.includes(stationKind);
}

/** Prisma parçası: kapsamı boş (her istasyon) ya da verilen türü taşıyan satır. `stationKindInScope`un ikizi. */
export function stationKindScopeWhere(stationKind: StationKind): Prisma.ReasonPresetWhereInput {
  return { OR: [{ stationKinds: { isEmpty: true } }, { stationKinds: { has: stationKind } }] };
}

/**
 * YAZMA KAPISI — insan duruşa kapsamı dışında sebep yazamaz → 400 `STOP_REASON_OUT_OF_SCOPE`.
 * Makine sinyali / ham kod eşlemesi çağırmaz (eşleme fabrikanın kararı); geçmiş kayıt yeniden yazılmaz.
 */
export function assertStopReasonInScope(preset: { code: string; stationKinds: readonly StationKind[] }, stationKind: StationKind): void {
  if (stationKindInScope(preset.stationKinds, stationKind)) return;
  throw AppError.badRequest(`"${preset.code}" sebebi bu istasyon türünde kullanılamaz (Sebep Kataloğu → istasyon türü kapsamı).`, {
    code: "STOP_REASON_OUT_OF_SCOPE", reasonCode: preset.code, stationKind, stationKinds: [...preset.stationKinds],
  });
}
