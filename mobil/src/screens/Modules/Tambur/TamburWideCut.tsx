// Geniş tablet ana kesim sol sütunu (2026-11-10, kullanıcı): bilgi kartı · adım notu · hata metreleri · canlı etiket
// önizlemesi (kalan yüksekliğin tamamı). Kat / En / Kalite sağ sütunda (TamburCutSettingsCard). Saf görünüm — state ekranın; telefon/manuel/Top Kesme kullanmaz.
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text, TouchableRipple } from 'react-native-paper';
import { colors, palette } from '../../../theme/tokens';
import TamburInfoCard, { type TamburInfoCardProps } from './TamburInfoCard';
import TamburLabelPreviewCard, { type TamburLabelPreviewCardProps } from './TamburLabelPreviewCard';

export interface TamburWideCutProps {
  info: TamburInfoCardProps;
  /** İş emri adım notu şeridi (ekranın bugünkü bileşeni). */
  note: React.ReactNode;
  /** Hata kartı: hata yoksa ve muayene kapalıysa null (bölüm çizilmez). */
  defects: { count: number; critCount: number; ruler: React.ReactNode | null; onOpen: () => void; onAdd: (() => void) | null } | null;
  preview: TamburLabelPreviewCardProps;
}

function DefectCard({ d }: { d: NonNullable<TamburWideCutProps['defects']> }) {
  return (
    <TouchableRipple onPress={d.count > 0 ? d.onOpen : undefined} disabled={d.count === 0} style={s.card} testID="tambur-hata-karti">
      <View style={{ gap: 4 }}>
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
            <Button mode="outlined" compact icon="plus" onPress={d.onAdd} testID="tambur-hata-gir" accessibilityLabel="Hata ekle">
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
  // Bilgi + hata kartları minimum yükseklikte; kalan yüksekliğin tamamı etiket önizlemesine (kullanıcı: etiket büyük).
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" testID="tambur-genis-sol">
      <TamburInfoCard {...p.info} />
      {p.note}
      {p.defects && <DefectCard d={p.defects} />}
      <TamburLabelPreviewCard {...p.preview} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { flexGrow: 1, gap: 8, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 4 },
  card: { backgroundColor: palette.white, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: palette.slate[200] },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 15, fontWeight: '800', color: palette.slate[900] },
  badge: { paddingHorizontal: 10, paddingVertical: 2, borderRadius: 10, backgroundColor: palette.red[100] },
  badgeText: { fontSize: 13, fontWeight: '800', color: palette.red[700] },
  muted: { fontSize: 13, color: colors.textMuted },
});
