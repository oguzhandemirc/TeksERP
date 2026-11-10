// Geniş ana kesim Kat · Kalite · En satırı (2026-11-11, kullanıcı; tur-4'te En en sağa): tek satır, başlıksız — değer
// kendini anlatır ("4 Kat", "1. Kalite", "300 cm"). Üç kontrolün köşesi ACTION_BUTTON_RADIUS (Bitir ile aynı). Kat tek düğme (dokun → sıradaki kat); Kalite tek düğme + açılır liste (Paper Menu).
// Dokunma hedefleri ≥56dp. Saf görünüm — state ekranın.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Menu, TouchableRipple } from 'react-native-paper';
import TruncatedText from '../../../components/TruncatedText';
import { colors, palette, shadow } from '../../../theme/tokens';
import { ACTION_BUTTON_RADIUS } from './CutActionBar';
import type { QualityOption } from './TamburCompactPickers';
import { nextFoldCode } from './foldCycle';
import TamburUnitInput from './TamburUnitInput';

export interface TamburCutSettingsProps {
  fold: { options: { code: string; name: string }[]; value: string | null | undefined; onPick: (code: string) => void };
  /** Şablon en basmıyorsa null (bugünkü görünürlük kuralı). */
  width: { value: string; onChange: (v: string) => void; placeholder: string } | null;
  quality: { grades: QualityOption[]; value: string | null | undefined; onPick: (g: QualityOption, active: boolean) => void };
}

function QualityDropdown({ q }: { q: TamburCutSettingsProps['quality'] }) {
  const [open, setOpen] = useState(false);
  const cur = q.grades.find((g) => g.code === q.value) ?? null;
  const anchor = (
    <TouchableRipple
      onPress={() => setOpen(true)}
      disabled={q.grades.length === 0}
      style={[s.btn, s.qualityBtn]}
      accessibilityRole="button"
      accessibilityLabel={`Kalite ${cur?.name ?? 'seçilmedi'}. Değiştirmek için dokunun`}
      testID="tambur-kalite-dugmesi"
    >
      <View style={s.btnInner}>
        {cur?.color ? <View style={[s.dot, { backgroundColor: cur.color }]} /> : null}
        <TruncatedText style={s.btnText}>{cur?.name ?? 'Kalite seç'}</TruncatedText>
        <Icon source="chevron-down" size={22} color={colors.textSecondary} />
      </View>
    </TouchableRipple>
  );
  return (
    <Menu visible={open} onDismiss={() => setOpen(false)} anchor={anchor} anchorPosition="bottom">
      {q.grades.map((g) => (
        <Menu.Item
          key={g.id}
          title={g.name}
          leadingIcon={g.code === q.value ? 'check' : undefined}
          onPress={() => {
            setOpen(false);
            // Liste seçimi asla "seçimi kaldır" değildir (active=false).
            q.onPick(g, false);
          }}
          testID={`tambur-kalite-${g.code}`}
        />
      ))}
    </Menu>
  );
}

export default function TamburCutSettingsCard(p: TamburCutSettingsProps) {
  const fold = p.fold.options.find((o) => o.code === p.fold.value) ?? null;
  const next = nextFoldCode(p.fold.options, p.fold.value);
  return (
    <View style={s.card} testID="tambur-kesim-ayar-karti">
      <TouchableRipple
        onPress={next ? () => p.fold.onPick(next) : undefined}
        disabled={!next}
        style={[s.btn, s.foldBtn]}
        accessibilityRole="button"
        accessibilityLabel={`Tambur katı ${fold?.name ?? 'seçilmedi'}. Sıradakine geçmek için dokunun`}
        testID="tambur-kat-dugmesi"
      >
        <View style={s.btnInner}>
          <Icon source="swap-vertical" size={20} color={palette.white} />
          <TruncatedText style={[s.btnText, s.foldText]}>{fold?.name ?? 'Kat seç'}</TruncatedText>
        </View>
      </TouchableRipple>
      <View style={s.qualityCol}>
        <QualityDropdown q={p.quality} />
      </View>
      {p.width && (
        <View style={s.widthCol}>
          <TamburUnitInput
            value={p.width.value}
            onChange={p.width.onChange}
            unit="cm"
            unitName="santimetre"
            label="En"
            placeholder={p.width.placeholder}
            numpadMaxLength={6}
            onClear={() => p.width?.onChange('')}
            testID="tambur-en-cm"
          />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  // Ölçüm kartıyla aynı açık gri zemin: beyaz çerçevesiz En kutusu ve Kalite düğmesi bu zeminde seçilir.
  card: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.slate[100], borderRadius: 14, padding: 8 },
  btn: { minHeight: 56, borderRadius: ACTION_BUTTON_RADIUS, justifyContent: 'center', paddingHorizontal: 10 },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  btnText: { fontSize: 18, fontWeight: '800', color: palette.slate[900], flexShrink: 1 },
  foldBtn: { flex: 1, backgroundColor: palette.blue[800] },
  foldText: { color: palette.white },
  widthCol: { flex: 1 },
  qualityCol: { flex: 1.3 },
  qualityBtn: { backgroundColor: palette.white, ...shadow.sm, elevation: 1 },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
