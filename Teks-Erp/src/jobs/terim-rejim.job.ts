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

async function refreshOnce(): Promise<void> {
  try {
    await systemSettingService.getFeatureFlags(); // agregat rejimi kendisi uygular
  } catch {
    /* DB geçici erişilemez → son bilinen ad kalır */
  }
}

export function startTermRegimeJob(): void {
  if (timer) return;
  void refreshOnce();
  timer = setInterval(() => void refreshOnce(), REFRESH_MS);
  timer.unref();
}
