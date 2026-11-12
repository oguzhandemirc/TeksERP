// Geniş ana kesim alt şeridinin SAĞ grubu (2026-11-10, kullanıcı kararı): [METRE kipi] [KG kipi] [Bitir], eşit genişlik;
// Ölçüm kartı genişliğinde. Metre kipi `tamburCutMode`, kg kipi `tamburKgMode` (cihaz ayarı); dokun → diğer kip.
// Kg alanı yoksa (şablon kg basmıyor, zorunlu değil) KG düğmesi çizilmez.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import { palette, spacing } from '../../../theme/tokens';
import { ACTION_BUTTON_RADIUS, BAR_HEIGHT_TABLET, BitirButton } from './CutActionBar';

const MODE_BG = palette.slate[700]; // #334155

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
  // Kip düğmeleri koyu arduvaz dolgu (tur-4, 2026-11-11): Bitir yeşil · Kes mor · Kartela turuncu ile karışmaz.
  // Kip adı büyük, kip değeri küçük; Otomatikte yeşil nokta.
  const auto = p.mode === 'auto';
  return (
    <View style={[s.mode, p.busy && s.modeBusy]}>
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
        rippleColor="rgba(255,255,255,0.2)"
        style={s.inner}
        accessibilityRole="button"
        accessibilityLabel={`${p.label} ${measureModeLabel(p.mode)}. Değiştirmek için dokunun`}
        testID={p.testID}
      >
        <View style={s.center}>
          <Text style={s.kicker}>{p.kicker}</Text>
          <View style={s.valueRow}>
            {auto ? <View style={s.autoDot} testID={`${p.testID}-oto`} /> : null}
            <Text style={s.value} numberOfLines={1}>
              {measureModeLabel(p.mode)}
            </Text>
          </View>
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
  mode: { flex: 1, height: BAR_HEIGHT_TABLET, borderRadius: ACTION_BUTTON_RADIUS, overflow: 'hidden', backgroundColor: MODE_BG },
  modeBusy: { opacity: 0.55 },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  // Koyu zeminde parlak yeşil + ince açık halka → görünür.
  autoDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.emerald[500], borderWidth: 1, borderColor: palette.emerald[100] },
  inner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center' },
  kicker: { fontSize: 22, fontWeight: '900', letterSpacing: 1, color: palette.white },
  value: { fontSize: 13, fontWeight: '600', color: palette.slate[200] },
});
