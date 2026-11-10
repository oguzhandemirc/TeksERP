// Geniş ana kesim alt şeridinin SAĞ grubu (2026-11-10, kullanıcı onaylı): Ölçüm kipi TEK düğme + Bitir, eşit genişlik;
// sağ sütundaki Ölçüm kartının hemen altında, onunla aynı kenarda. Kip `tamburCutMode`dur (dokun → diğer kip).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import { colors, palette, radius, spacing } from '../../../theme/tokens';
import { BAR_HEIGHT_TABLET, BitirButton } from './CutActionBar';

export function measureModeLabel(mode: 'manual' | 'auto'): string {
  return mode === 'manual' ? 'Manuel' : 'Otomatik';
}

export interface TamburModeBitirBarProps {
  mode: 'manual' | 'auto';
  onToggle: () => void;
  /** Kesim uçuşta → kip değişmez. */
  busy: boolean;
  onBitir: () => void;
  bitirLoading: boolean;
}

export default function TamburModeBitirBar(p: TamburModeBitirBarProps) {
  const manual = p.mode === 'manual';
  const bg = manual ? palette.indigo[700] : palette.emerald[600];
  return (
    <View style={s.row}>
      <View style={[s.mode, { backgroundColor: p.busy ? colors.surfaceSunken : bg }]}>
        <TouchableRipple
          onPress={
            p.busy
              ? undefined
              : () => {
                  Haptics.selectionAsync().catch(() => {});
                  p.onToggle();
                }
          }
          borderless
          style={s.inner}
          accessibilityRole="button"
          accessibilityLabel={`Ölçüm ${measureModeLabel(p.mode)}. Değiştirmek için dokunun`}
          testID="tambur-kip-dugmesi"
        >
          <View style={s.center}>
            <Text style={s.kicker}>ÖLÇÜM</Text>
            <Text style={s.value} numberOfLines={1}>
              {measureModeLabel(p.mode)}
            </Text>
          </View>
        </TouchableRipple>
      </View>
      <BitirButton onPress={p.onBitir} disabled={p.bitirLoading} compact={false} fill />
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  mode: { flex: 1, height: BAR_HEIGHT_TABLET, borderRadius: radius.md, overflow: 'hidden' },
  inner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center' },
  kicker: { fontSize: 12, fontWeight: '800', letterSpacing: 1, color: colors.textOnDark, opacity: 0.85 },
  value: { fontSize: 22, fontWeight: '900', color: colors.textOnDark },
});
