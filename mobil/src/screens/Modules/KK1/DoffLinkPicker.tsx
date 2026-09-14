// =============================================================================
// KK1 — "Bu top dokuma mı?" → "hangi indirmeden?" (bağlanmamış indirmeler listesi)
// =============================================================================
// Yalnız `isDoffLinkVisible` doğruysa mount edilir (KK1Screen karar verir).
// Liste `GET /machine-doffs?unlinked=true` (makine VERİLMEZ — masa KK1 hepsini
// görür; tezgah başı eşleşmesini backend denetler). Cevap yoksa bağ null kalır.
// =============================================================================
import React, { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, TouchableRipple, Button, ActivityIndicator } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import AppModal from '../../../components/AppModal';
import { doffService } from '../../../services/doff.service';
import { colors, spacing, radius, typography } from '../../../theme';
import { doffRowLabel, type DoffLinkState } from './doffLink';

export const UNLINKED_DOFFS_KEY = ['doffs', 'unlinked'] as const;

interface Props {
  value: DoffLinkState;
  onChange: (next: DoffLinkState) => void;
  onBeforeOpen?: () => void;
}

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <TouchableRipple onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </TouchableRipple>
  );
}

export default function DoffLinkPicker({ value, onChange, onBeforeOpen }: Props) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: UNLINKED_DOFFS_KEY,
    queryFn: doffService.listUnlinked,
    enabled: value.weaving,
    staleTime: 15_000,
  });
  const rows = q.data?.data ?? [];
  const selected = rows.find((r) => r.id === value.doffEventId) ?? null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Bu top dokuma mı?</Text>
      <View style={styles.row}>
        <Chip on={!value.weaving} label="Hayır — dışarıdan geldi" onPress={() => onChange({ weaving: false, doffEventId: null })} />
        <Chip on={value.weaving} label="Evet — tezgahtan indi" onPress={() => onChange({ ...value, weaving: true })} />
      </View>
      {value.weaving && (
        <View style={styles.row}>
          <Text style={styles.hint} numberOfLines={2}>
            {selected ? doffRowLabel(selected) : 'İndirme seçilmedi — bağsız (doff\'suz top) kaydedilir.'}
          </Text>
          <Button
            compact
            mode="outlined"
            icon="format-list-bulleted"
            onPress={() => {
              onBeforeOpen?.();
              setOpen(true);
            }}
          >
            {selected ? 'Değiştir' : 'Hangi indirmeden?'}
          </Button>
        </View>
      )}

      <AppModal visible={open} onDismiss={() => setOpen(false)} position="center">
        <Text style={styles.title}>Bağlanmamış indirmeler (son 3 gün)</Text>
        {q.isLoading ? (
          <ActivityIndicator />
        ) : q.isError ? (
          <Text style={styles.error}>Liste yüklenemedi — bu bir “indirme yok” cevabı DEĞİLDİR.</Text>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(r) => r.id}
            style={styles.list}
            ListEmptyComponent={<Text style={styles.hint}>Bağlanmamış indirme yok.</Text>}
            renderItem={({ item }) => (
              <TouchableRipple
                onPress={() => {
                  onChange({ weaving: true, doffEventId: item.id });
                  setOpen(false);
                }}
                style={[styles.item, item.id === value.doffEventId && styles.itemOn]}
              >
                <Text style={styles.itemText}>{doffRowLabel(item)}</Text>
              </TouchableRipple>
            )}
          />
        )}
        <View style={styles.actions}>
          <Button
            onPress={() => {
              onChange({ weaving: true, doffEventId: null });
              setOpen(false);
            }}
          >
            Bağsız kaydet
          </Button>
          <Button onPress={() => setOpen(false)}>Kapat</Button>
        </View>
      </AppModal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  label: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold },
  hint: { flex: 1, fontSize: typography.size.sm, color: colors.textMuted },
  error: { color: colors.dangerText },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, minHeight: 44, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.brandContainer, borderColor: colors.brand },
  chipText: { color: colors.text },
  chipTextOn: { color: colors.brandDark, fontWeight: typography.weight.semibold },
  title: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text, marginBottom: spacing.sm },
  list: { maxHeight: 360 },
  item: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xs, backgroundColor: colors.surface },
  itemOn: { backgroundColor: colors.brandContainer, borderColor: colors.brand },
  itemText: { color: colors.text },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
});
