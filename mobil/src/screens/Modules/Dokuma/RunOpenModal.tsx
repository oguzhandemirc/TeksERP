// =============================================================================
// KOŞUM AÇ — SAYFALI (PagedSheet): ① İş & Desen · ② Ayarlar · ③ Özet
// =============================================================================
// Gövde ekranın %70'ini aşıyordu (5 alan + uzun etiketler) → sayfa başına tek konu (kullanıcı
// kuralı 2026-09-18). İş emri (opsiyonel) seçilince desen/renk ön-dolar, kilitli değil.
// Doğrulama İleri'de O SAYFADA yazılır (`validateRunOpen`); Kaydet = `submitOpen` (kendi
// doğrulaması ve yapışkan token'ı aynen). Seçiciler `PickerModal` (`overlays`, kartın üstünde).
// =============================================================================
import React, { useMemo, useState } from 'react';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import PagedSheet, { SummaryRow, type SheetPage } from '../../../components/PagedSheet';
import { SheetField, sheet } from '../../../components/ModuleSheet';
import NumpadInput from '../../../components/NumpadInput';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import { useTruncationWarning } from '../../../hooks/useTruncationWarning';
import { useOpenSequence } from '../../../hooks/useOpenSequence';
import { itemService } from '../../../services/item.service';
import { colorService } from '../../../services/color.service';
import { colors } from '../../../theme';
import { prefillFromOrder, validateRunOpen } from './runPayload';
import type { RunPanelState } from './useRunPanel';

type PickerKind = 'order' | 'item' | 'color' | null;

function useOrderOptions(state: RunPanelState): PickerOption[] {
  return useMemo(
    () =>
      state.orders.map((o) => ({
        value: o.id,
        label: o.weavingOrderNumber,
        sublabel: `${o.item.name}${o.color ? ` · ${o.color.name}` : ''}`,
        details: o.plannedM != null ? [`Hedef ${o.plannedM} m`] : ['Açık uçlu'],
        badge: { text: o.status === 'IN_PROGRESS' ? 'Devam' : 'Plan', color: o.status === 'IN_PROGRESS' ? colors.success : colors.info },
      })),
    [state.orders]
  );
}

export default function RunOpenModal({ state }: { state: RunPanelState }) {
  const [picker, setPicker] = useState<PickerKind>(null);
  const openSeq = useOpenSequence(state.openModal);
  const orderOptions = useOrderOptions(state);
  const itemsQuery = useQuery({
    queryKey: ['items', 'dokuma', 'FABRIC'],
    queryFn: () => itemService.getAll({ page: 1, pageSize: 500, sortBy: 'code', sortOrder: 'asc', filters: { isActive: 'true', itemType: 'FABRIC' } }),
    enabled: picker === 'item',
    staleTime: 5 * 60_000,
  });
  const colorsQuery = useQuery({
    queryKey: ['colors', 'dokuma'],
    queryFn: () => colorService.listPublicForPicker({ pageSize: 500, sortBy: 'name', sortOrder: 'asc' }),
    enabled: picker === 'color',
    staleTime: 5 * 60_000,
  });
  useTruncationWarning(itemsQuery.data?.pagination, 'Desen');
  useTruncationWarning(colorsQuery.data?.pagination, 'Renk');
  const itemOptions: PickerOption[] = (itemsQuery.data?.data ?? []).map((i) => ({ value: i.id, label: i.name, sublabel: i.code }));
  const colorOptions: PickerOption[] = (colorsQuery.data?.data ?? []).map((c) => ({ value: c.id, label: c.name, sublabel: c.code }));
  const f = state.form;
  const orderLabel = state.orders.find((o) => o.id === f.weavingOrderId)?.weavingOrderNumber ?? '';
  const close = () => state.setOpenModal(false);

  const pages = buildRunOpenPages(state, orderLabel, setPicker);

  return (
    <PagedSheet
      key={openSeq}
      visible={state.openModal}
      onDismiss={close}
      onCancel={close}
      onSubmit={state.submitOpen}
      submitLabel="Koşumu Aç"
      busy={state.opening}
      title="Koşum aç"
      pages={pages}
      overlays={<RunOpenPickers state={state} picker={picker} setPicker={setPicker} orderOptions={orderOptions} itemOptions={itemOptions} colorOptions={colorOptions} itemsLoading={itemsQuery.isLoading} colorsLoading={colorsQuery.isLoading} />}
    />
  );
}

interface PickersProps {
  state: RunPanelState;
  picker: PickerKind;
  setPicker: (k: PickerKind) => void;
  orderOptions: PickerOption[];
  itemOptions: PickerOption[];
  colorOptions: PickerOption[];
  itemsLoading: boolean;
  colorsLoading: boolean;
}

/** Üç seçici — kartın DIŞINDA (overlays), iş emri seçilince desen/renk ön-dolar. */
function RunOpenPickers({ state, picker, setPicker, orderOptions, itemOptions, colorOptions, itemsLoading, colorsLoading }: PickersProps) {
  const f = state.form;
  return (
    <>
      <PickerModal
        visible={picker === 'order'}
        title="Dokuma işi seç"
        options={orderOptions}
        selectedValue={f.weavingOrderId ?? ''}
        loading={state.ordersLoading}
        emptyText="Açık dokuma işi yok — emirsiz koşum açabilirsiniz."
        onDismiss={() => setPicker(null)}
        onSelect={(v) => {
          state.setForm(prefillFromOrder(f, state.orders.find((o) => o.id === v) ?? null));
          setPicker(null);
        }}
      />
      <PickerModal
        visible={picker === 'item'}
        title="Desen seç"
        options={itemOptions}
        selectedValue={f.itemId ?? ''}
        loading={itemsLoading}
        onDismiss={() => setPicker(null)}
        onSelect={(v) => {
          state.setForm({ ...f, itemId: v, itemLabel: itemOptions.find((o) => o.value === v)?.label ?? '' });
          setPicker(null);
        }}
      />
      <PickerModal
        visible={picker === 'color'}
        title="Renk seç"
        options={colorOptions}
        selectedValue={f.colorId ?? ''}
        loading={colorsLoading}
        onDismiss={() => setPicker(null)}
        onSelect={(v) => {
          state.setForm({ ...f, colorId: v, colorLabel: colorOptions.find((o) => o.value === v)?.label ?? '' });
          setPicker(null);
        }}
      />
    </>
  );
}

/** Sayfa başına tek konu: ① İş & Desen ② Ayarlar (İleri'de `validateRunOpen`) ③ Özet. */
function buildRunOpenPages(state: RunPanelState, orderLabel: string, setPicker: (k: PickerKind) => void): SheetPage[] {
  const f = state.form;
  return [
    {
      key: 'is',
      title: 'İş & Desen',
      render: () => (
        <>
          {state.ordersLoading ? <ActivityIndicator /> : null}
          {state.ordersError ? <Text style={sheet.error}>İş emri listesi yüklenemedi — emirsiz koşum açılabilir.</Text> : null}
          <SheetField label="Dokuma işi (isteğe bağlı — numune koşumu meşru)" value={orderLabel} placeholder="İş emrisiz" onPress={() => setPicker('order')} />
          <SheetField label="Desen" value={f.itemLabel} placeholder="Seçilmedi" onPress={() => setPicker('item')} />
          <SheetField label="Renk" value={f.colorLabel} placeholder="Renk yok (ham)" onPress={() => setPicker('color')} />
        </>
      ),
    },
    {
      key: 'ayar',
      title: 'Ayarlar',
      render: () => (
        <>
          <Text style={sheet.label}>Hedef devir (atkı/dk) — boş: makine tanımındaki yedek</Text>
          <NumpadInput value={f.targetUnitsPerMin} onChangeText={(t) => state.setForm({ ...f, targetUnitsPerMin: t })} allowDecimal={false} numpadMaxLength={5} numpadLabel="Hedef devir" placeholder="ör. 420" style={sheet.input} />
          <Text style={sheet.label}>Atkı sıklığı (ham, atkı/cm) — boş: metre türetilmez</Text>
          <NumpadInput value={f.unitsPerCm} onChangeText={(t) => state.setForm({ ...f, unitsPerCm: t })} allowDecimal numpadMaxLength={7} numpadLabel="Atkı sıklığı" placeholder="ör. 24.5" style={sheet.input} />
        </>
      ),
      validate: () => {
        const v = validateRunOpen(f);
        return v.ok ? null : v.message;
      },
    },
    {
      key: 'ozet',
      title: 'Özet',
      render: () => (
        <>
          <SummaryRow label="Dokuma işi" value={orderLabel || 'İş emrisiz (numune)'} />
          <SummaryRow label="Desen" value={f.itemLabel} />
          <SummaryRow label="Renk" value={f.colorLabel || 'Renk yok (ham)'} />
          <SummaryRow label="Hedef devir (atkı/dk)" value={f.targetUnitsPerMin || 'makine yedeği'} />
          <SummaryRow label="Atkı sıklığı (atkı/cm)" value={f.unitsPerCm || 'türetilmez'} />
          <Text style={sheet.hint}>Açıldıktan sonra terimler donar; bu hattın indirmeleri koşuma bağlanır.</Text>
        </>
      ),
    },
  ];
}
