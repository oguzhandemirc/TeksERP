// =============================================================================
// WarpEndsBand — çözgü tel düzeni bandı (react-native-svg): bir rapor, her tel iplik renginde
// =============================================================================
// Yerleşim saf `warpBandLayout.ts`ten (sunucu `endsSequence`; yoksa oransal); renk `weavePalette`.
// Devereci cağlığa hangi sırayla dizeceğini görür. Tek iplikli kart / eski sunucu → hiçbir şey çizilmez.
// `compact`: başlıksız ince şerit (liste satırı); tam hâlde harf lejantı + rapor satırı + uyarı.
// =============================================================================
import React, { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Text } from 'react-native-paper';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors, radius, spacing, typography } from '../../theme';
import type { WarpEndsSequence, WarpSpecYarnRow } from '../../services/warpBeam.service';
import { hasWarpBand, warpBandCaption, warpBandLayout } from './warpBandLayout';
import { WEAVE_COLORS, yarnColor } from './weavePalette';

export interface WarpEndsBandProps {
  yarns?: readonly WarpSpecYarnRow[] | null;
  endsSequence?: WarpEndsSequence | null;
  sequenceNote?: string | null;
  compact?: boolean;
  testID?: string;
}

export default function WarpEndsBand({ yarns, endsSequence, sequenceNote, compact = false, testID }: WarpEndsBandProps) {
  const [width, setWidth] = useState(0);
  if (!hasWarpBand({ yarns })) return null;
  const height = compact ? 12 : 28;
  const model = warpBandLayout({ yarns, endsSequence }, width, height);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.floor(e.nativeEvent.layout.width));
  const band = (
    <View onLayout={onLayout} style={[styles.bandBox, { height }]}>
      {model ? (
        <Svg width={model.width} height={height} testID={testID ? `${testID}-svg` : undefined}>
          {model.segments.map((s, i) => <Rect key={i} x={s.x} y={0} width={s.w} height={height} fill={yarnColor(s.yarn)} />)}
          {model.ticksPath ? <Path d={model.ticksPath} stroke={WEAVE_COLORS.bg} strokeWidth={1} /> : null}
        </Svg>
      ) : null}
    </View>
  );
  if (compact) return <View testID={testID}>{band}</View>;
  return (
    <View style={styles.root} testID={testID}>
      <Text style={styles.title}>{sequenceNote?.trim() && endsSequence ? `Tel düzeni · ${sequenceNote.trim()}` : 'Tel düzeni'}</Text>
      {band}
      <View style={styles.legend}>
        {yarns!.map((y, i) => (
          <View key={y.letter} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: yarnColor(i + 1) }]}>
              <Text style={styles.swatchLetter}>{y.letter}</Text>
            </View>
            <Text style={styles.legendText}>{`${y.code} · ${y.endsCount} tel`}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.caption}>{warpBandCaption({ endsSequence, sequenceNote })}</Text>
      {endsSequence && !endsSequence.matchesYarnEnds ? (
        <Text style={styles.warn} testID={testID ? `${testID}-uyari` : undefined}>Dizilim, karttaki iplik tel sayılarıyla tutmuyor — kartı panelden kontrol ettirin.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xs, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  title: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold },
  bandBox: { width: '100%', borderRadius: radius.sm, overflow: 'hidden', backgroundColor: WEAVE_COLORS.bg },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: spacing.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  swatch: { width: 22, height: 22, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  swatchLetter: { color: colors.surface, fontSize: typography.size.sm, fontWeight: typography.weight.bold },
  legendText: { fontSize: typography.size.base, color: colors.text },
  caption: { fontSize: typography.size.base, color: colors.text, fontWeight: typography.weight.semibold },
  warn: { fontSize: typography.size.sm, color: colors.warningText },
});
