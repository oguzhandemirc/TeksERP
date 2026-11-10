// =============================================================================
// Tambur metre şeridi — "Beyan · Kurşun · Kesilen · Kalan" + aşım uyarısı (bilgi, ENGEL YOK)
// =============================================================================
// Koyu başlık bandının kimlik sütununda durur (form yüksekliğine dokunmaz, tambur.md K5).
// Parçalar flexWrap ile kırılır (kesik metin yok); uç yoksa/hatalıysa hiçbir şey çizilmez.
// Sorgu anahtarı ['rolls', id, …] → kesimden sonraki `['rolls']` invalidation'ı şeridi tazeler.
// =============================================================================

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { rollService } from '../../../services/roll.service';
import { palette } from '../../../theme/tokens';
import { cutOverage, meterTrailParts, overageWarningText, type RollMeterTrail } from './meterTrail';

export function useRollMeterTrail(rollId: string | null | undefined) {
  return useQuery({
    queryKey: ['rolls', rollId ?? '', 'meter-trail'],
    queryFn: () => rollService.meterTrail(rollId as string),
    enabled: !!rollId,
    retry: false,
    staleTime: 15_000,
  });
}

/** dark = koyu başlık bandı · light = beyaz kart · onOrange = geniş künye kartının koyu turuncu zemini. */
type TrailTone = 'dark' | 'light' | 'onOrange';
type TrailViewProps = { trail: RollMeterTrail | null | undefined; pendingM: number; tone?: TrailTone; omitRemaining?: boolean };
export function TamburMeterTrailView({ trail, pendingM, tone = 'dark', omitRemaining }: TrailViewProps) {
  const light = tone === 'light';
  const orange = tone === 'onOrange';
  const parts = meterTrailParts(trail, { omitRemaining });
  if (!parts) return null;
  const over = cutOverage(trail, pendingM);
  return (
    <View style={[s.root, orange && s.rootTight]} testID="tambur-metre-serit">
      <View style={s.row}>
        {parts.map((p, i) => (
          <Text key={p} style={[s.part, light && s.partLight, orange && s.partOrange]}>
            {i > 0 ? `· ${p}` : p}
          </Text>
        ))}
      </View>
      {over != null && (
        <View style={[s.warn, orange && s.warnPill]} testID="tambur-metre-asim">
          <Icon source="alert-outline" size={14} color={orange ? palette.white : light ? WARN_LIGHT : WARN} />
          <Text style={[s.warnText, light && { color: WARN_LIGHT }, orange && { color: palette.white }]}>{overageWarningText(over)}</Text>
        </View>
      )}
    </View>
  );
}

export default function TamburMeterTrail({ rollId, ...rest }: Omit<TrailViewProps, 'trail'> & { rollId: string | null | undefined }) {
  const q = useRollMeterTrail(rollId);
  return <TamburMeterTrailView trail={q.data ?? null} {...rest} />;
}

// Koyu (#0f172a) bant üstünde okunur sarı; ikincil metin ≥12.
const WARN = palette.amber[300];
// Beyaz kart (geniş tablet bilgi kartı, 2026-11-10) üstünde okunur ton.
const WARN_LIGHT = palette.amber[700];

const s = StyleSheet.create({
  root: { marginTop: 3, gap: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 5 },
  part: { fontSize: 13, fontWeight: '600', color: palette.slate[300] },
  partLight: { fontSize: 15, color: palette.slate[600] },
  rootTight: { marginTop: 0 },
  partOrange: { fontSize: 15, fontWeight: '700', color: palette.slate[900] },
  // Turuncu zeminde uyarı koyu kehribar hap içinde beyaz (kontrast ~8:1).
  warnPill: { alignSelf: 'flex-start', marginTop: 2, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: palette.amber[900] },
  warn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  warnText: { flexShrink: 1, fontSize: 12, fontWeight: '700', color: WARN },
});
