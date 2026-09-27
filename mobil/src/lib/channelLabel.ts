// =============================================================================
// Dağıtım kanalının GÖRÜNÜR etiketi (ör. "TEST FABRİKA") — gösterimdir, davranış değil
// =============================================================================
// Derleme anında kayıt defterinden (`deploy/kanallar.json` → `gorunurEtiket`) uygulama
// yapılandırmasına gömülür (`extra.gorunurEtiket`, `mobil/scripts/lib/kanal.cjs`).
// Üretim kanalında alan HİÇ doğmaz → null → hiçbir şey çizilmez (bugünkü görünüm).
// Tablette `Constants.expoConfig` APK'dan ya da OTA manifestinin `extra.expoClient`inden
// gelir; ikisi de aynı derleme adımında kanaldan üretilir.
// =============================================================================

type ConfigLike = { extra?: unknown } | null | undefined;

export function resolveChannelLabel(config: ConfigLike): string | null {
  const extra = config?.extra;
  if (!extra || typeof extra !== 'object') return null;
  const raw = (extra as { gorunurEtiket?: unknown }).gorunurEtiket;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}
