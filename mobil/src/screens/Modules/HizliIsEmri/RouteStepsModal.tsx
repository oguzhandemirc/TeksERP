import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, TouchableRipple, Icon, TextInput, Button } from 'react-native-paper';

import AppModal from '../../../components/AppModal';
import type { ProductionRoute } from '../../../services/route.service';
import { STATION_TYPE_LABEL, fasonNoteLabel, trLabel } from '../../../utils/labels';
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
  /** Her fason adımı için etkin firma id (sequence → id|null). */
  selectedFirmBySeq?: Record<number, string | null>;
  /** Kategori id → seçilebilir fason firmaları. */
  firmOptionsByCategory?: Record<string, { id: string; name: string; isFavorite?: boolean }[]>;
  /** Firma id → ad (salt-görüntüleme). */
  firmNameById?: Record<string, string>;
  onChangeSubcontractor?: (sequence: number, firmId: string) => void;
}

// Rota şablonunun adımlarını gösterir. Gelişmiş modda her istasyona not + fason firma
// girilir → parent bunları `stepPlanning` (sequence eşleşmesi) olarak quickStart'a yollar.
export default function RouteStepsModal({
  visible,
  onDismiss,
  route,
  editable = false,
  notes,
  onChangeNote,
  selectedFirmBySeq = {},
  firmOptionsByCategory = {},
  firmNameById = {},
  onChangeSubcontractor,
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
            {steps.length} adım{editable ? ' · not + fason firma girebilirsiniz' : ''}
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
          steps.map((s) => {
            const cat = s.station?.defaultCategory ?? null;
            const selectedFirmId = cat ? selectedFirmBySeq[s.sequence] ?? null : null;
            const firmOptions = cat ? firmOptionsByCategory[cat.id] ?? [] : [];
            return (
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
                    {cat ? (
                      <Text style={styles.stationCat}>
                        Fason: {cat.name}
                        {applySuffix(cat)}
                      </Text>
                    ) : null}
                  </View>
                </View>

                {editable ? (
                  <View style={styles.noteBlock}>
                    <Text style={styles.noteLabel}>
                      {cat ? fasonNoteLabel(s.station?.name) : 'İstasyon notu'}
                    </Text>
                    {cat ? <Text style={styles.noteHint}>Çeki listesine basılır</Text> : null}
                    <TextInput
                      mode="outlined"
                      dense
                      value={notes[s.sequence] ?? ''}
                      onChangeText={(t) => onChangeNote(s.sequence, t)}
                      placeholder={
                        s.defaultNotes
                          ? `Varsayılan: ${s.defaultNotes}`
                          : cat
                            ? `${fasonNoteLabel(s.station?.name)} (opsiyonel)`
                            : 'İstasyon notu (opsiyonel)'
                      }
                      multiline
                      style={styles.noteInput}
                    />
                  </View>
                ) : s.defaultNotes ? (
                  <Text style={styles.defaultNote}>{s.defaultNotes}</Text>
                ) : null}

                {/* Fason firma — sadece fason (defaultCategory'li) adımlarda */}
                {cat ? (
                  <View style={styles.firmBlock}>
                    <View style={styles.firmHeadRow}>
                      <Icon source="factory" size={14} color={colors.brand} />
                      <Text style={styles.firmLabel}>Fason firma</Text>
                      <Text style={styles.firmCurrent} numberOfLines={1}>
                        {selectedFirmId ? firmNameById[selectedFirmId] ?? '—' : 'Seçilmedi'}
                      </Text>
                    </View>
                    {editable ? (
                      firmOptions.length > 0 ? (
                        <View style={styles.firmChips}>
                          {firmOptions.map((f) => {
                            const active = selectedFirmId === f.id;
                            return (
                              <TouchableRipple
                                key={f.id}
                                onPress={() => onChangeSubcontractor?.(s.sequence, f.id)}
                                style={[styles.firmChip, active && styles.firmChipActive]}
                                borderless
                                rippleColor="rgba(79,70,229,0.12)"
                              >
                                <Text
                                  style={[styles.firmChipText, active && styles.firmChipTextActive]}
                                  numberOfLines={1}
                                >
                                  {f.isFavorite ? '★ ' : ''}
                                  {f.name}
                                </Text>
                              </TouchableRipple>
                            );
                          })}
                        </View>
                      ) : (
                        <Text style={styles.firmEmpty}>Bu kategoride kayıtlı firma yok.</Text>
                      )
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })
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
  noteBlock: { gap: 2 },
  noteLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  noteHint: { fontSize: 11, color: colors.textMuted },
  noteInput: { backgroundColor: colors.surface, minHeight: 48, marginTop: 2 },
  defaultNote: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic', paddingLeft: 40 },
  firmBlock: { gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  firmHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  firmLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  firmCurrent: { flex: 1, textAlign: 'right', fontSize: 13, fontWeight: '700', color: colors.text },
  firmChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 2 },
  firmChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    maxWidth: 200,
  },
  firmChipActive: { borderColor: colors.brand, backgroundColor: colors.brandSoft, borderWidth: 2 },
  firmChipText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  firmChipTextActive: { color: colors.brand },
  firmEmpty: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic' },
  footer: { padding: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  footerBtn: { borderRadius: radius.md },
  footerBtnContent: { height: 52 },
});
