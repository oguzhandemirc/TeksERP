// `/api/admin/health` lisans bloğu — durum ÖZETİ (belge içeriği, anahtar ve ham ölçüm yok).
import { getLicenseSnapshot } from "./runtime";
import { getDoorbellStatus, getLicenseEngineStatus, getPollStatus } from "./license-signals";
import { getIntegrityOutcome, integrityStatusForState } from "./integrity-state";
import { integrityReason } from "./integrity-check";
import { getLicenseCoreStatus } from "./native";
import { BUILD_WATERMARK } from "./watermark";
import { BUILD_ANCHOR_MODE } from "./trust-anchor";

/** `/api/admin/health` lisans bloğu — durum ÖZETİ (belge içeriği ve anahtar yok). */
export function licenseHealthBlock(): Record<string, unknown> {
  const motor = getLicenseEngineStatus();
  try {
    const snap = getLicenseSnapshot();
    const pollStatus = getPollStatus();
    const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());
    return {
      hazir: snap.hazir,
      motor: motor.durum,
      motorNeden: motor.neden,
      kip: snap.state.kip,
      gecerlilik: snap.state.gecerlilik,
      hesaplananKademe: snap.state.hesaplananKademe,
      uygulananKademe: snap.state.uygulananKademe,
      nedenler: snap.state.nedenler.map((n) => n.kod),
      sonYoklama: iso(pollStatus.lastAttemptAt),
      sonBasariliYoklama: iso(pollStatus.lastSuccessAt),
      zilBagli: getDoorbellStatus().connected,
      cekirdek: getLicenseCoreStatus().kaynak,
      capaKipi: BUILD_ANCHOR_MODE,
      butunluk: integrityStatusForState(),
      butunlukKod: getIntegrityOutcome()?.kod ?? null,
      butunlukNeden: integrityReason(getIntegrityOutcome()),
      paketId: BUILD_WATERMARK?.paketId ?? null,
    };
  } catch {
    return { hazir: false, motor: motor.durum, motorNeden: motor.neden };
  }
}
