// İstasyon 2. kat aksiyon çubuğunun yerleşim kararı — saf, tek kaynak.
// El terminalinde (PM68, 480 dp dikey) 6 eşit chip etiketleri tek harfe kırpıyordu
// (saha 2026-11-10): dar genişlikte en önemli birkaç aksiyon kalır, gerisi "Diğer"e iner.
import { COMPACT_MAX_WIDTH } from '../../hooks/useDeviceType';

export interface StationAction {
  id: string;
  label: string;
  icon: string;
  /** Küçük sayı = daha önemli; dar genişlikte çubukta kalanlar buna göre seçilir. */
  priority: number;
  /** false → ne çubukta ne menüde (izin/bayrak/mod koşulu). */
  visible: boolean;
  onPress: () => void;
  /** >0 → rozet (çubukta düğmede, menüde satırda; gizlideyse "Diğer"de nokta). */
  badge?: number;
  /** Açık bir MODU temsil eder (durum chip'i) — dolu amber. */
  active?: boolean;
}

/** Dar genişlikte çubukta kalan en fazla aksiyon sayısı ("Diğer" hariç). */
export const STATION_BAR_MAX_PRIMARY = 3;

export interface StationActionLayout {
  narrow: boolean;
  inline: StationAction[];
  overflow: StationAction[];
}

export function layoutStationActions(
  actions: readonly StationAction[],
  width: number,
  maxPrimary: number = STATION_BAR_MAX_PRIMARY,
): StationActionLayout {
  const visible = actions.filter((a) => a.visible);
  const narrow = width < COMPACT_MAX_WIDTH;
  // Geniş: bugünkü düzen (hepsi satırda). Dar ama "Diğer" bir yuvayı tek aksiyonla
  // takas edecekse katlamak yer kazandırmaz.
  if (!narrow || visible.length <= maxPrimary + 1) return { narrow, inline: visible, overflow: [] };
  const keep = new Set(
    [...visible]
      .map((a, i) => ({ a, i }))
      .sort((x, y) => x.a.priority - y.a.priority || x.i - y.i)
      .slice(0, maxPrimary)
      .map((x) => x.a.id),
  );
  // Çubukta bildirim sırası korunur (göz alışkanlığı), seçim önceliğe göre.
  return {
    narrow,
    inline: visible.filter((a) => keep.has(a.id)),
    overflow: visible.filter((a) => !keep.has(a.id)),
  };
}

export function overflowHasBadge(overflow: readonly StationAction[]): boolean {
  return overflow.some((a) => (a.badge ?? 0) > 0);
}
