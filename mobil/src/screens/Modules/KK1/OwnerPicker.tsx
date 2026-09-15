// =============================================================================
// KK1 — "Sahibi (emanet)" seçicisi: müşterinin konsinye malı hangi müşterinin? (G3t)
// =============================================================================
// Yalnız `isOwnerPickerVisible` doğruysa mount edilir (KK1Screen karar verir) → bağlam ucu
// `GET /rolls/tablet-context` yalnız o zaman çağrılır (tek izin `mobile:kk1`, yalnız id+ad;
// `customer:read` istemez). Liste PickerModal'la "Ürün Seç" geometrisinde çizilir.
// =============================================================================
import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import PickerModal, { PickerOption } from '../../../components/PickerModal';
import { rollService } from '../../../services/roll.service';
import { colors, spacing, typography } from '../../../theme';
import { EMPTY_OWNER_LINK, type OwnerLinkState } from './ownerLink';

export const ROLL_TABLET_CONTEXT_KEY = ['rolls', 'tablet-context'] as const;

interface Props {
  value: OwnerLinkState;
  onChange: (next: OwnerLinkState) => void;
  onBeforeOpen?: () => void;
}

export default function OwnerPicker({ value, onChange, onBeforeOpen }: Props) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ROLL_TABLET_CONTEXT_KEY,
    queryFn: rollService.tabletContext,
    staleTime: 60_000,
  });
  const options: PickerOption[] = useMemo(
    () => (q.data?.data.customers ?? []).map((c) => ({ value: c.id, label: c.name })),
    [q.data],
  );
  const selected = !!value.ownerCustomerId;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Sahibi (emanet mal ise müşteri)</Text>
      <View style={styles.row}>
        <Text style={[styles.hint, selected && styles.hintOn]} numberOfLines={2}>
          {selected ? value.ownerLabel : 'Emanet değil — fabrikanın malı.'}
        </Text>
        <Button
          compact
          mode="outlined"
          icon="account-outline"
          onPress={() => {
            onBeforeOpen?.();
            setOpen(true);
          }}
        >
          {selected ? 'Değiştir' : 'Müşteri seç'}
        </Button>
        {selected && (
          <Button compact onPress={() => onChange(EMPTY_OWNER_LINK)}>
            Emanet değil
          </Button>
        )}
      </View>
      <PickerModal
        visible={open}
        title="Emanet sahibi"
        options={options}
        selectedValue={value.ownerCustomerId}
        onSelect={(id) => {
          onChange({ ownerCustomerId: id, ownerLabel: options.find((o) => o.value === id)?.label ?? '' });
          setOpen(false);
        }}
        onDismiss={() => setOpen(false)}
        emptyText={q.isError ? 'Liste yüklenemedi — bu bir "müşteri yok" cevabı DEĞİLDİR.' : 'Aktif müşteri yok.'}
        loading={q.isLoading}
        onRefresh={q.refetch}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  label: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold },
  hint: { flex: 1, fontSize: typography.size.sm, color: colors.textMuted },
  hintOn: { color: colors.text, fontWeight: typography.weight.semibold },
});
