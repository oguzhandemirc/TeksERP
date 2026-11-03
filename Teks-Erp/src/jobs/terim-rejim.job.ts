// =============================================================================
// K20 — İŞ EMRİ ADI REJİMİ (2026-11-03)
// =============================================================================
// `TERIM.terbiyeIsEmri` okuma anında dokuma rejiminden çözülür (dokuma kapalı → "İş Emri"). Sunucu tarafında rejim
// bayrak agregatından (`getFeatureFlags`, 30 sn TTL) gelir: agregat her hesaplandığında uygular, bu job da açılışta
// ve TTL aralığıyla tazeler — hata/bildirim metni bayrak okumayan istekte de güncel adı taşır. Okunamazsa bugünkü ad.
// =============================================================================
import { systemSettingService } from "../services/system-setting.service";

const REFRESH_MS = 30_000;
let timer: NodeJS.Timeout | null = null;

/** Rejimi DB'den bir kez çözer (best-effort; okunamazsa son bilinen ad). Katalog tohumu yazmadan önce bekler. */
export async function refreshTermRegime(): Promise<void> {
  try {
    await systemSettingService.getFeatureFlags(); // agregat rejimi kendisi uygular
  } catch {
    /* DB geçici erişilemez → son bilinen ad kalır */
  }
}

export function startTermRegimeJob(): void {
  if (timer) return;
  void refreshTermRegime();
  timer = setInterval(() => void refreshTermRegime(), REFRESH_MS);
  timer.unref();
}
