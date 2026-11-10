// Geniş tablet ana kesim sol sütunu (2026-11-10, hedef görsel): bilgi kartı · adım notu · hata metreleri ·
// Kat / En / Kalite · canlı etiket önizlemesi. Saf görünüm — state ekranın; telefon/manuel/Top Kesme kullanmaz.
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text, TouchableRipple } from 'react-native-paper';
import NumpadInput from '../../../components/NumpadInput';
import { colors, palette } from '../../../theme/tokens';
import { QualitySegment, type QualityOption } from './TamburCompactPickers';
import TamburInfoCard, { type TamburInfoCardProps } from './TamburInfoCard';
import TamburLabelPreviewCard, { type TamburLabelPreviewCardProps } from './TamburLabelPreviewCard';

export interface TamburWideCutProps {
  info: TamburInfoCardProps;
  /** İş emri adım notu şeridi (ekranın bugünkü bileşeni). */
  note: React.ReactNode;
  /** Hata kartı: hata yoksa ve muayene kapalıysa null (bölüm çizilmez). */
  defects: { count: number; critCount: number; ruler: React.ReactNode | null; onOpen: () => void; onAdd: (() => void) | null } | null;
  fold: { options: { code: string; name: string }[]; value: string | null | undefined; onPick: (code: string) => void };
  /** Şablon en basmıyorsa null (bugünkü görünürlük kuralı). */
  width: { value: string; onChange: (v: string) => void; placeholder: string } | null;
  quality: { grades: QualityOption[]; value: string | null | undefined; onPick: (g: QualityOption, active: boolean) => void };
  preview: TamburLabelPreviewCardProps;
}

function DefectCard({ d }: { d: NonNullable<TamburWideCutProps['defects']> }) {
  return (
    <TouchableRipple onPress={d.count > 0 ? d.onOpen : undefined} disabled={d.count === 0} style={s.card} testID="tambur-hata-karti">
      <View style={{ gap: 8 }}>
        <View style={s.rowCenter}>
          <Text style={s.title}>Hata metreleri</Text>
          {d.count > 0 && (
            <View style={s.badge}>
              <Text style={s.badgeText}>{`${d.count} nokta${d.critCount > 0 ? ` · ${d.critCount} kritik` : ''}`}</Text>
            </View>
          )}
          {d.count === 0 && <Text style={s.muted}>Kayıtlı hata yok</Text>}
          <View style={{ flex: 1 }} />
          {d.onAdd && (
            <Button mode="outlined" icon="plus" onPress={d.onAdd} testID="tambur-hata-gir" accessibilityLabel="Hata ekle">
              Hata ekle
            </Button>
          )}
        </View>
        {d.ruler}
      </View>
    </TouchableRipple>
  );
}

export default function TamburWideCut(p: TamburWideCutProps) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <TamburInfoCard {...p.info} />
      {p.note}
      {p.defects && <DefectCard d={p.defects} />}
      <View style={[s.card, s.settings]}>
        <View style={s.settingCol}>
          <Text style={s.label}>Tambur (kat)</Text>
          <View style={s.foldGroup} accessibilityRole="radiogroup" accessibilityLabel="Tambur katı">
            {p.fold.options.map((ft) => {
              const active = p.fold.value === ft.code;
              return (
                <TouchableRipple
                  key={ft.code}
                  borderless
                  onPress={() => p.fold.onPick(ft.code)}
                  style={[s.fold, active && s.foldActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  testID={`tambur-kat-${ft.code}`}
                >
                  <Text style={[s.foldText, active && s.foldTextActive]}>{ft.name}</Text>
                </TouchableRipple>
              );
            })}
          </View>
        </View>
        {p.width && (
          <View style={s.settingCol}>
            <Text style={s.label}>En (cm)</Text>
            <NumpadInput
              mode="outlined"
              value={p.width.value}
              onChangeText={p.width.onChange}
              numpadLabel="En (cm)"
              allowDecimal
              numpadMaxLength={6}
              placeholder={p.width.placeholder}
              style={s.input}
              testID="tambur-en-cm"
            />
          </View>
        )}
        <View style={[s.settingCol, s.qualityCol]}>
          <Text style={s.label}>Kalite</Text>
          <QualitySegment grades={p.quality.grades} value={p.quality.value} onPick={p.quality.onPick} />
        </View>
      </View>
      <TamburLabelPreviewCard {...p.preview} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { flexGrow: 1, gap: 10, padding: 12 },
  card: { backgroundColor: palette.white, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: palette.slate[200] },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 17, fontWeight: '800', color: palette.slate[900] },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, backgroundColor: palette.red[100] },
  badgeText: { fontSize: 13, fontWeight: '800', color: palette.red[700] },
  muted: { fontSize: 13, color: colors.textMuted },
  settings: { flexDirection: 'row', gap: 14, alignItems: 'flex-end' },
  settingCol: { flex: 1, gap: 6 },
  qualityCol: { flex: 1.4 },
  label: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
  foldGroup: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 12, backgroundColor: palette.slate[100] },
  fold: { flex: 1, minHeight: 56, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  foldActive: { backgroundColor: palette.blue[800] },
  foldText: { fontSize: 20, fontWeight: '700', color: palette.slate[700] },
  foldTextActive: { color: palette.white },
  input: { fontSize: 24, fontWeight: '700' },
});
