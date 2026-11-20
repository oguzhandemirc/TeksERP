// Çizim araç çubuğu — TEK satır, büyük hedefler (480×800 el terminaline sığar:
// 4 araç + renk + geri al + temizle = 7 × 56 dp). Renk düğmesi dört renk
// arasında döner (ayrı dört kutu dar ekranda satırı taşırırdı).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { IconButton } from 'react-native-paper';

import { colors, radius, spacing } from '../../theme';
import type { CizimAraci, CizimRengi } from './cizim';
import { CIZIM_RENKLERI } from './CizimTuvali';

const ARACLAR: { arac: CizimAraci; simge: string; ad: string }[] = [
  { arac: 'kalem', simge: 'draw', ad: 'Serbest çizim' },
  { arac: 'ok', simge: 'arrow-top-right', ad: 'Ok' },
  { arac: 'kutu', simge: 'rectangle-outline', ad: 'Dikdörtgen' },
  { arac: 'karart', simge: 'eye-off', ad: 'Karartma kutusu (gizle)' },
];

const RENK_SIRASI: CizimRengi[] = ['kirmizi', 'sari', 'yesil', 'mavi'];
export const sonrakiRenk = (r: CizimRengi): CizimRengi =>
  RENK_SIRASI[(RENK_SIRASI.indexOf(r) + 1) % RENK_SIRASI.length];

export default function CizimAracCubugu(p: {
  arac: CizimAraci;
  renk: CizimRengi;
  bosMu: boolean;
  onArac: (a: CizimAraci) => void;
  onRenk: (r: CizimRengi) => void;
  onGeriAl: () => void;
  onTemizle: () => void;
}) {
  return (
    <View style={styles.satir}>
      {ARACLAR.map(({ arac, simge, ad }) => (
        <IconButton
          key={arac}
          icon={simge}
          size={26}
          mode={p.arac === arac ? 'contained' : undefined}
          selected={p.arac === arac}
          onPress={() => p.onArac(arac)}
          accessibilityLabel={ad}
          style={styles.dugme}
        />
      ))}
      <IconButton
        icon="circle"
        size={30}
        iconColor={CIZIM_RENKLERI[p.renk]}
        onPress={() => p.onRenk(sonrakiRenk(p.renk))}
        accessibilityLabel="Renk değiştir"
        style={styles.dugme}
      />
      <IconButton
        icon="undo"
        size={26}
        disabled={p.bosMu}
        onPress={p.onGeriAl}
        accessibilityLabel="Geri al"
        style={styles.dugme}
      />
      <IconButton
        icon="delete-sweep-outline"
        size={26}
        disabled={p.bosMu}
        onPress={p.onTemizle}
        accessibilityLabel="Temizle"
        style={styles.dugme}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  satir: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'nowrap',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xs,
  },
  dugme: { width: 52, height: 52, margin: 2 },
});
