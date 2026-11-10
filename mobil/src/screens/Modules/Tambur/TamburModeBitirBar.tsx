// Geniş ana kesim alt şeridinin SAĞ grubu (2026-11-10, kullanıcı kararı): [METRE kipi] [KG kipi] [Bitir], eşit genişlik;
// Ölçüm kartı genişliğinde. Metre kipi `tamburCutMode`, kg kipi `tamburKgMode` (cihaz ayarı); dokun → diğer kip.
// Kg alanı yoksa (şablon kg basmıyor, zorunlu değil) KG düğmesi çizilmez.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import { colors, palette, radius, spacing } from '../../../theme/tokens';
import { BAR_HEIGHT_TABLET, BitirButton } from './CutActionBar';

export function measureModeLabel(mode: 'manual' | 'auto'): string {
  return mode === 'manual' ? 'Manuel' : 'Otomatik';
}

type Mode = 'manual' | 'auto';
export interface TamburModeBitirBarProps {
  meter: { mode: Mode; onToggle: () => void };
  kg: { mode: Mode; onToggle: () => void } | null;
  /** Kesim uçuşta → kip değişmez. */
  busy: boolean;
  onBitir: () => void;
  bitirLoading: boolean;
}

function ModeButton(p: { kicker: string; label: string; mode: Mode; onToggle: () => void; busy: boolean; testID: string }) {
  const bg = p.mode === 'manual' ? palette.indigo[700] : palette.emerald[600];
  return (
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
        accessibilityLabel={`${p.label} ${measureModeLabel(p.mode)}. Değiştirmek için dokunun`}
        testID={p.testID}
      >
        <View style={s.center}>
          <Text style={s.kicker}>{p.kicker}</Text>
          <Text style={s.value} numberOfLines={1}>
            {measureModeLabel(p.mode)}
          </Text>
        </View>
      </TouchableRipple>
    </View>
  );
}

export default function TamburModeBitirBar(p: TamburModeBitirBarProps) {
  return (
    <View style={s.row}>
      <ModeButton kicker="METRE" label="Metre" mode={p.meter.mode} onToggle={p.meter.onToggle} busy={p.busy} testID="tambur-kip-dugmesi" />
      {p.kg && <ModeButton kicker="KG" label="Kg" mode={p.kg.mode} onToggle={p.kg.onToggle} busy={p.busy} testID="tambur-kg-kip-dugmesi" />}
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
  value: { fontSize: 20, fontWeight: '900', color: colors.textOnDark },
});
