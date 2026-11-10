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

export function TamburMeterTrailView({ trail, pendingM }: { trail: RollMeterTrail | null | undefined; pendingM: number }) {
  const parts = meterTrailParts(trail);
  if (!parts) return null;
  const over = cutOverage(trail, pendingM);
  return (
    <View style={s.root} testID="tambur-metre-serit">
      <View style={s.row}>
        {parts.map((p, i) => (
          <Text key={p} style={s.part}>
            {i > 0 ? `· ${p}` : p}
          </Text>
        ))}
      </View>
      {over != null && (
        <View style={s.warn} testID="tambur-metre-asim">
          <Icon source="alert-outline" size={14} color={WARN} />
          <Text style={s.warnText}>{overageWarningText(over)}</Text>
        </View>
      )}
    </View>
  );
}

export default function TamburMeterTrail({ rollId, pendingM }: { rollId: string | null | undefined; pendingM: number }) {
  const q = useRollMeterTrail(rollId);
  return <TamburMeterTrailView trail={q.data ?? null} pendingM={pendingM} />;
}

// Koyu (#0f172a) bant üstünde okunur sarı; ikincil metin ≥12.
const WARN = palette.amber[300];

const s = StyleSheet.create({
  root: { marginTop: 3, gap: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 5 },
  part: { fontSize: 13, fontWeight: '600', color: palette.slate[300] },
  warn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  warnText: { flexShrink: 1, fontSize: 12, fontWeight: '700', color: WARN },
});
