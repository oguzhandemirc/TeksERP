// Lisans ayrıntısının `parmakIzi` bölümü: karar (kiradaki kümeyle), etken başına okuma raporu (K8 çok yollu okuma +
// 24 sa önbellek) ve kayıp etkenler. Değer ve özet YOK — yalnız "okundu mu, nereden, ne zaman". Salt-okunur.
import { getMeasuredFingerprint, type LicenseSnapshot } from "../../lib/license/runtime";
import type { LicenseDetail } from "../license-view.service";
import { currentLostFactors } from "./license-wire.helper";

export function fingerprintSection(snap: LicenseSnapshot): LicenseDetail["parmakIzi"] {
  const fp = getMeasuredFingerprint();
  const d = snap.fingerprintDecision;
  return {
    olculdu: fp?.measuredAt ?? null,
    olculen: fp?.measured ?? null,
    karar: d?.result ?? null,
    eslesen: d?.matched ?? null,
    olculebilen: d?.measurable ?? null,
    uyusmayan: d?.mismatched ?? [],
    okuma: fp?.okuma ?? null,
    kayip: currentLostFactors(),
    onbellekBozuk: fp?.onbellekBozuk === true,
  };
}
