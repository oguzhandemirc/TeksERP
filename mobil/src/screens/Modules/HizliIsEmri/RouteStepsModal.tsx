import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, TouchableRipple, Icon, TextInput, Button } from 'react-native-paper';

import AppModal from '../../../components/AppModal';
import type { ProductionRoute } from '../../../services/route.service';
import { STATION_TYPE_LABEL, trLabel } from '../../../utils/labels';
import { colors, spacing, radius } from '../../../theme';

// Fason kategorisinin uyguladığı şeyi etikete ekler ("· renk+özellik uygular").
// Boş ise (örn. salt taşıma kategorisi) ek yok — bu adım renk/özellik uygulamaz.
const applySuffix = (cat?: { appliesColor?: boolean; appliesProperty?: boolean } | null): string => {
  const tags = [cat?.appliesColor ? 'renk' : null, cat?.appliesProperty ? 'özellik' : null].filter(Boolean);
  return tags.length ? ` · ${tags.join('+')} uygular` : '';
};

interface Props {
  visible: boolean;
  onDismiss: () => void;
  route: ProductionRoute | null;
  /** Gelişmiş modda her istasyon için not girilebilir; aksi halde salt-görüntüleme. */
  editable?: boolean;
  /** sequence → not (parent state'inde tutulur). */
  notes: Record<number, string>;
  onChangeNote: (sequence: number, text: string) => void;
}

// Rota şablonunun adımlarını gösterir. Gelişmiş modda her istasyona not girilir →
// parent bunları `stepPlanning` (sequence eşleşmesi) olarak quickStart'a yollar.
export default function RouteStepsModal({
  visible,
  onDismiss,
  route,
  editable = false,
  notes,
  onChangeNote,
}: Props) {
  const steps = route?.steps ?? [];

  return (
    <AppModal visible={visible} onDismiss={onDismiss} position="bottom" contentStyle={styles.sheet}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {route?.name ?? 'Rota Şablonu'}
          </Text>
          <Text style={styles.subtitle}>
            {steps.length} adım{editable ? ' · her istasyona not girebilirsiniz' : ''}
          </Text>
        </View>
        <TouchableRipple onPress={onDismiss} borderless style={styles.closeBtn}>
          <Icon source="close" size={24} color={colors.textSecondary} />
        </TouchableRipple>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {steps.length === 0 ? (
          <Text style={styles.empty}>Bu rotada adım tanımlı değil.</Text>
        ) : (
          steps.map((s) => (
            <View key={s.id} style={styles.stepCard}>
              <View style={styles.stepHead}>
                <Text style={styles.seq}>{s.sequence}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stationName} numberOfLines={1}>
                    {s.station?.name ?? '—'}
                  </Text>
                  {s.station?.type ? (
                    <Text style={styles.stationType}>{trLabel(STATION_TYPE_LABEL, s.station.type)}</Text>
                  ) : null}
                  {s.station?.defaultCategory ? (
                    <Text style={styles.stationCat}>
                      Fason: {s.station.defaultCategory.name}
                      {applySuffix(s.station.defaultCategory)}
                    </Text>
                  ) : null}
                </View>
              </View>
              {editable ? (
                <TextInput
                  mode="outlined"
                  dense
                  value={notes[s.sequence] ?? ''}
                  onChangeText={(t) => onChangeNote(s.sequence, t)}
                  placeholder={s.defaultNotes ? `Varsayılan: ${s.defaultNotes}` : 'İstasyon notu (opsiyonel)'}
                  multiline
                  style={styles.noteInput}
                />
              ) : s.defaultNotes ? (
                <Text style={styles.defaultNote}>{s.defaultNotes}</Text>
              ) : null}
            </View>
          ))
        )}
        <View style={{ height: spacing.md }} />
      </ScrollView>

      <View style={styles.footer}>
        <Button mode="contained" onPress={onDismiss} contentStyle={styles.footerBtnContent} style={styles.footerBtn}>
          {editable ? 'Tamam' : 'Kapat'}
        </Button>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.appBg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    height: '80%',
    width: '100%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  closeBtn: { padding: spacing.xs, borderRadius: radius.full },
  body: { padding: spacing.lg, gap: spacing.sm },
  empty: { color: colors.textMuted, fontSize: 14, textAlign: 'center', padding: spacing.xl },
  stepCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  seq: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.brandSoft,
    color: colors.brand,
    fontWeight: '800',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 28,
  },
  stationName: { fontSize: 15, fontWeight: '700', color: colors.text },
  stationType: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  stationCat: { fontSize: 12, color: colors.brand, fontWeight: '700', marginTop: 1 },
  noteInput: { backgroundColor: colors.surface, minHeight: 48 },
  defaultNote: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic', paddingLeft: 40 },
  footer: { padding: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  footerBtn: { borderRadius: radius.md },
  footerBtnContent: { height: 52 },
});
