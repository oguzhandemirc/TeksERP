// =============================================================================
// KK1 — "Bu top dokuma mı?" → "hangi indirmeden?" (bağlanmamış indirmeler listesi)
// =============================================================================
// Yalnız `isDoffLinkVisible` doğruysa mount edilir (KK1Screen karar verir).
// Liste `GET /machine-doffs?unlinked=true` (makine VERİLMEZ — masa KK1 hepsini
// görür; tezgah başı eşleşmesini backend denetler). Cevap yoksa bağ null kalır.
// Seçici `PickerModal` (2026-09-18 iskeleti: elle liste modalı yok); "Bağsız kaydet"
// listenin üstünde `leadingAction`. Evet/Hayır ikilisi KK1 formunun kendi alanıdır, modal değil.
// =============================================================================
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, Button } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import PickerModal from '../../../components/PickerModal';
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
          <Text style={styles.hint}>{selected ? doffRowLabel(selected) : "İndirme seçilmedi — bağsız (doff'suz top) kaydedilir."}</Text>
          <Button
            compact
            mode="outlined"
            icon="format-list-bulleted"
            testID="doff-link-ac"
            onPress={() => {
              onBeforeOpen?.();
              setOpen(true);
            }}
          >
            {selected ? 'Değiştir' : 'Hangi indirmeden?'}
          </Button>
        </View>
      )}

      <PickerModal
        visible={open}
        title="Bağlanmamış indirmeler (son 3 gün)"
        options={rows.map((r) => ({ value: r.id, label: doffRowLabel(r) }))}
        selectedValue={value.doffEventId ?? ''}
        loading={q.isLoading}
        emptyText={q.isError ? 'Liste yüklenemedi — bu bir “indirme yok” cevabı DEĞİLDİR.' : 'Bağlanmamış indirme yok.'}
        onRefresh={() => void q.refetch()}
        refreshing={q.isFetching}
        refreshError={q.isError}
        refreshErrorMessage="Liste yüklenemedi"
        leadingAction={{
          label: 'Bağsız kaydet',
          sublabel: "İndirme seçilmeden — doff'suz top",
          icon: 'link-off',
          onPress: () => {
            onChange({ weaving: true, doffEventId: null });
            setOpen(false);
          },
        }}
        onSelect={(id) => {
          onChange({ weaving: true, doffEventId: id });
          setOpen(false);
        }}
        onDismiss={() => setOpen(false)}
      />
    </View>
  );
}

// Evet/Hayır ikilisi KK1 form alanı (modal değil) — chip stili KK1 formundakiyle aynı.
const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  label: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold },
  hint: { flex: 1, fontSize: typography.size.sm, color: colors.textMuted },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, minHeight: 44, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.brandContainer, borderColor: colors.brand },
  chipText: { color: colors.text },
  chipTextOn: { color: colors.brandDark, fontWeight: typography.weight.semibold },
});
