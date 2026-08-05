import React, { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, TouchableRipple, IconButton, Chip } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';

import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import { customerService } from '../../../services/customer.service';
import { customerBranchService } from '../../../services/customerBranch.service';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { emptyOrProblemText } from '../../../utils/queryState';
import { colors, spacing, radius } from '../../../theme';
import { DEADLINE_CHOICES, type NewOrderState } from './useNewOrder';

// =============================================================================
// ① MÜŞTERİ — kime, nereye, ne zaman.
//
// Şube alanı `branchesEnabled` KAPALIYKEN HİÇ render edilmez (kullanıcı kararı,
// 2026-08-04): şube kullanmayan fabrikada her siparişte boş bir alan sormak,
// operatöre atlaması gereken bir adım daha eklemektir.
//
// Termin ÇİPLERLE seçilir, takvim yok: takvim bileşeni yeni bir paket demekti
// (`react-native-community/datetimepicker` izinli listede değil) ve sahada
// termin zaten "şu kadar gün sonra" diye konuşulur. Kaçış yolu "Varsayılan" —
// backend `order.defaultDeadlineDays`'i uygular.
// =============================================================================

interface Props {
  state: NewOrderState;
  branchesEnabled: boolean;
}

export default function StepCustomer({ state, branchesEnabled }: Props) {
  const [picker, setPicker] = useState<'customer' | 'branch' | null>(null);
  const [custSearch, setCustSearch] = useState('');
  const debouncedSearch = useDebouncedValue(custSearch, 300);

  const custQuery = useQuery({
    queryKey: ['customers', 'new-order', debouncedSearch],
    queryFn: () =>
      customerService.getAll({
        page: 1,
        pageSize: 50,
        sortBy: 'name',
        sortOrder: 'asc',
        search: debouncedSearch || undefined,
        filters: { isActive: 'true' },
      }),
    enabled: picker === 'customer',
  });

  const custOptions = useMemo<PickerOption[]>(
    () => (custQuery.data?.data ?? []).map((c) => ({ value: c.id, label: c.name, sublabel: c.code })),
    [custQuery.data],
  );

  const branchQuery = useQuery({
    queryKey: ['customer-branches', state.customerId],
    queryFn: () => customerBranchService.list(state.customerId!),
    enabled: branchesEnabled && !!state.customerId,
    staleTime: 5 * 60 * 1000,
  });

  const branches = useMemo(
    () => (branchQuery.data?.data ?? []).filter((b) => b.isActive),
    [branchQuery.data],
  );

  const branchOptions = useMemo<PickerOption[]>(
    () =>
      branches.map((b) => ({
        value: b.id,
        label: b.name,
        sublabel: [b.district, b.city].filter(Boolean).join(' / ') || (b.code ?? undefined),
      })),
    [branches],
  );

  const deadlinePreview =
    state.deadlineDays == null
      ? 'Sistem varsayılanı uygulanacak'
      : dayjs().add(state.deadlineDays, 'day').format('DD.MM.YYYY');

  return (
    <>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <TouchableRipple onPress={() => setPicker('customer')} style={styles.field} borderless>
          <View style={styles.fieldInner}>
            <View style={styles.fieldTextCol}>
              <Text style={styles.fieldLabel}>MÜŞTERİ *</Text>
              <Text
                style={state.customerId ? styles.fieldValue : styles.fieldPlaceholder}
                numberOfLines={1}
              >
                {state.customerName || 'Müşteri seç…'}
              </Text>
            </View>
            <IconButton icon="chevron-right" size={22} style={styles.chev} />
          </View>
        </TouchableRipple>

        {/* Şube — bayrak kapalıysa HİÇ render edilmez. Müşterinin şubesi yoksa da
            gösterilmez: seçenek olmayan bir alan operatörü "eksik bıraktım mı"
            diye düşündürür. */}
        {branchesEnabled && state.customerId && branches.length > 0 && (
          <TouchableRipple onPress={() => setPicker('branch')} style={styles.field} borderless>
            <View style={styles.fieldInner}>
              <View style={styles.fieldTextCol}>
                <Text style={styles.fieldLabel}>ŞUBE (sevk noktası)</Text>
                <Text
                  style={state.branchId ? styles.fieldValue : styles.fieldPlaceholder}
                  numberOfLines={1}
                >
                  {state.branchName || 'Şube seç… (opsiyonel)'}
                </Text>
              </View>
              {state.branchId ? (
                <IconButton icon="close" size={20} onPress={() => state.selectBranch(null, '')} />
              ) : (
                <IconButton icon="chevron-right" size={22} style={styles.chev} />
              )}
            </View>
          </TouchableRipple>
        )}

        <Text style={styles.sectionLabel}>TERMİN</Text>
        <View style={styles.chipRow}>
          {DEADLINE_CHOICES.map((c) => (
            <Chip
              key={c.label}
              mode={state.deadlineDays === c.days ? 'flat' : 'outlined'}
              selected={state.deadlineDays === c.days}
              showSelectedCheck={false}
              onPress={() => state.setDeadlineDays(c.days)}
              style={[styles.chip, state.deadlineDays === c.days && styles.chipOn]}
              textStyle={state.deadlineDays === c.days ? styles.chipTextOn : undefined}
            >
              {c.label}
            </Chip>
          ))}
        </View>
        <Text style={styles.hint}>{deadlinePreview}</Text>
      </ScrollView>

      <PickerModal
        visible={picker === 'customer'}
        title="Müşteri Seç"
        options={custOptions}
        selectedValue={state.customerId}
        loading={custQuery.isLoading}
        emptyText={emptyOrProblemText(custQuery, 'Müşteri bulunamadı')}
        onRefresh={() => void custQuery.refetch()}
        paginated
        searchValue={custSearch}
        onSearchSubmit={setCustSearch}
        onSelect={(value) => {
          state.selectCustomer(value, custOptions.find((o) => o.value === value)?.label ?? '');
          setPicker(null);
        }}
        onDismiss={() => setPicker(null)}
      />

      <PickerModal
        visible={picker === 'branch'}
        title="Şube Seç"
        options={branchOptions}
        selectedValue={state.branchId}
        loading={branchQuery.isLoading}
        emptyText={emptyOrProblemText(branchQuery, 'Bu müşterinin tanımlı şubesi yok')}
        onRefresh={() => void branchQuery.refetch()}
        onSelect={(value) => {
          state.selectBranch(value, branchOptions.find((o) => o.value === value)?.label ?? '');
          setPicker(null);
        }}
        onDismiss={() => setPicker(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.md, paddingBottom: spacing.xl },
  field: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  fieldInner: { flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingLeft: spacing.md },
  fieldTextCol: { flex: 1, minWidth: 0, paddingVertical: spacing.xs },
  fieldLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, color: colors.textMuted },
  fieldValue: { fontSize: 18, fontWeight: '600', color: colors.text },
  fieldPlaceholder: { fontSize: 18, color: colors.textMuted },
  chev: { margin: 0 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: colors.textMuted,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { height: 44, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.brandContainer },
  chipTextOn: { color: colors.brandDark, fontWeight: '700' },
  hint: { marginTop: spacing.xs, color: colors.textSecondary, fontSize: 13 },
});
