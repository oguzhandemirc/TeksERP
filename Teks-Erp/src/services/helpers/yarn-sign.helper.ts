// =============================================================================
// İPLİK HAREKETİ İŞARETİ — tek kaynak (exhaustive switch: yeni enum değeri derlemede kırılır, TS2366)
// =============================================================================
// `yarn.service.ts`ten ayrıldı (dosya tavanı, devere 1b); tüketiciler oradan re-export ile okumaya devam eder.
// Devere türleri (§4.7): çözgü çıkışı ve dip iadesinin tersi DÜŞER; çıkışın tersi ve dip iadesi ARTIRIR.
// =============================================================================
import { YarnMovementKind } from "@prisma/client";

/** Bakiyeyi ARTIRAN türler — mutabakat SQL'i ve fiş tersleri buradan türetir (elle liste yasak). */
export function yarnInboundKinds(): YarnMovementKind[] {
  return Object.values(YarnMovementKind).filter((k) => yarnMovementSign(k) > 0);
}

export function yarnMovementSign(kind: YarnMovementKind): 1 | -1 {
  switch (kind) {
    case YarnMovementKind.IN:
    case YarnMovementKind.ADJUST_IN:
      return 1;
    case YarnMovementKind.OUT:
    case YarnMovementKind.ADJUST_OUT:
      return -1;
    case YarnMovementKind.WARP_ISSUE:
    case YarnMovementKind.WARP_RETURN_REVERSAL:
      return -1;
    case YarnMovementKind.WARP_ISSUE_REVERSAL:
    case YarnMovementKind.WARP_RETURN:
      return 1;
    // G1 fason iplik (§4.7 ikizi): çıkış ve dönüş iptali DÜŞER; çıkış iptali ve dönüş ARTIRIR.
    case YarnMovementKind.SUBCONTRACT_OUT:
    case YarnMovementKind.SUBCONTRACT_RETURN_CANCEL:
      return -1;
    case YarnMovementKind.SUBCONTRACT_OUT_CANCEL:
    case YarnMovementKind.SUBCONTRACT_RETURN:
      return 1;
  }
}

