// Sevk Çıkışı süzgeci: durum · cari · tarih · sıralama. Taslak sheet içinde; "Uygula" ile listeye geçer.
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import ModuleSheet, { SheetField } from '../../../../components/ModuleSheet';
import PickerModal from '../../../../components/PickerModal';
import DateRangeSheet from '../../../../components/filters/DateRangeSheet';
import { formatRange, resolveQuickRange, type DateRange } from '../../../../components/filters/rollHistoryFilter';
import { useTruncationWarning } from '../../../../hooks/useTruncationWarning';
import { customerService } from '../../../../services/customer.service';
import { emptyOrProblemText } from '../../../../utils/queryState';
import { spacing } from '../../../../theme';
import { DEFAULT_LIST_FILTER, SORT_OPTIONS, STATUS_OPTIONS, type ListFilter } from './listQuery';
import { FilledButton, Segment, ui } from './ui';

type RangeKey = 'all' | 'today' | 'last7' | 'custom';
const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'today', label: 'Bugün' },
  { key: 'last7', label: 'Son 7 gün' },
  { key: 'custom', label: 'Seç' },
];

interface Props {
  visible: boolean;
  value: ListFilter;
  onApply: (f: ListFilter) => void;
  onDismiss: () => void;
}

/** Cari seçici — liste yalnız açılınca çekilir. */
function CustomerPicker(p: { visible: boolean; selectedId: string | null; onPick: (c: { id: string; name: string }) => void; onDismiss: () => void }) {
  const custQ = useQuery({
    queryKey: ['customers', 'sevk-cikis-filtre'] as const,
    queryFn: () => customerService.getAll({ page: 1, pageSize: 500, sortBy: 'name', sortOrder: 'asc', filters: { isActive: 'true' } }),
    enabled: p.visible,
    staleTime: 60_000,
  });
  useTruncationWarning(custQ.data?.pagination, 'Cari');
  const options = useMemo(() => (custQ.data?.data ?? []).map((c) => ({ value: c.id, label: c.name, sublabel: c.code })), [custQ.data]);
  return (
    <PickerModal
      visible={p.visible}
      title="Cari"
      options={options}
      selectedValue={p.selectedId}
      loading={custQ.isLoading}
      emptyText={emptyOrProblemText(custQ, 'Aktif cari yok')}
      onRefresh={() => void custQ.refetch()}
      onSelect={(id) => p.onPick({ id, name: options.find((o) => o.value === id)?.label ?? '' })}
      onDismiss={p.onDismiss}
    />
  );
}

interface BodyProps {
  draft: ListFilter;
  setDraft: React.Dispatch<React.SetStateAction<ListFilter>>;
  rangeKey: RangeKey;
  onRange: (k: RangeKey) => void;
  onPickCustomer: () => void;
}

function FilterBody({ draft, setDraft, rangeKey, onRange, onPickCustomer }: BodyProps) {
  return (
    <>
    <View style={styles.block}>
      <Text style={ui.label}>Durum</Text>
      <Segment options={STATUS_OPTIONS} value={draft.status} onChange={(status) => setDraft((d) => ({ ...d, status }))} testID="sevk-suzgec-durum" />
    </View>
    <View style={styles.block}>
      <SheetField
        label="Cari"
        value={draft.customer?.name ?? ''}
        placeholder="Tüm cariler"
        onPress={onPickCustomer}
      />
      {draft.customer ? (
        <Text style={[ui.secondary, styles.clear]} onPress={() => setDraft((d) => ({ ...d, customer: null }))}>
          Cariyi kaldır
        </Text>
      ) : null}
    </View>
    <View style={styles.block}>
      <Text style={ui.label}>Tarih{rangeKey === 'custom' && draft.range ? ` · ${formatRange(draft.range)}` : ''}</Text>
      <Segment options={RANGE_OPTIONS} value={rangeKey} onChange={onRange} testID="sevk-suzgec-tarih" />
    </View>
    <View style={styles.block}>
      <Text style={ui.label}>Sıralama</Text>
      <Segment options={SORT_OPTIONS} value={draft.sort} onChange={(sort) => setDraft((d) => ({ ...d, sort }))} testID="sevk-suzgec-sira" />
    </View>
    </>
  );
}

export default function FilterSheet({ visible, value, onApply, onDismiss }: Props) {
  const [draft, setDraft] = useState<ListFilter>(value);
  const [rangeKey, setRangeKey] = useState<RangeKey>(value.range ? 'custom' : 'all');
  const [pickCustomer, setPickCustomer] = useState(false);
  const [pickRange, setPickRange] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDraft(value);
    setRangeKey(value.range ? 'custom' : 'all');
  }, [visible, value]);

  const chooseRange = (k: RangeKey) => {
    if (k === 'custom') {
      setPickRange(true);
      return;
    }
    setRangeKey(k);
    setDraft((d) => ({ ...d, range: k === 'all' ? null : resolveQuickRange(k, new Date()) }));
  };

  return (
    <ModuleSheet
      visible={visible}
      onDismiss={onDismiss}
      title="Süzgeç"
      size="sm"
      footer={
        <View style={ui.row}>
          <FilledButton label="Temizle" tone="neutral" onPress={() => onApply(DEFAULT_LIST_FILTER)} style={ui.flex} testID="sevk-suzgec-temizle" />
          <FilledButton label="Uygula" onPress={() => onApply(draft)} style={ui.flex} testID="sevk-suzgec-uygula" />
        </View>
      }
      overlays={
        <>
          <CustomerPicker
            visible={pickCustomer}
            selectedId={draft.customer?.id ?? null}
            onPick={(customer) => {
              setDraft((d) => ({ ...d, customer }));
              setPickCustomer(false);
            }}
            onDismiss={() => setPickCustomer(false)}
          />
          <DateRangeSheet
            visible={pickRange}
            initial={draft.range}
            onDismiss={() => setPickRange(false)}
            onApply={(range: DateRange) => {
              setRangeKey('custom');
              setDraft((d) => ({ ...d, range }));
              setPickRange(false);
            }}
          />
        </>
      }
    >
      <FilterBody draft={draft} setDraft={setDraft} rangeKey={rangeKey} onRange={chooseRange} onPickCustomer={() => setPickCustomer(true)} />
    </ModuleSheet>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm, marginBottom: spacing.md },
  clear: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
});
