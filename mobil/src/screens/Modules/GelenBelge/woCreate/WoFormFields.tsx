// S16b tek form — panel klasik formunun üretim/plan inputları (Rota, Sipariş bağı, Hedef kumaş, En, Hedef metraj/kg, Hedef renk, Kat tipi,
// Planlı başlangıç/bitiş, Not). Belgeden dolan alanda "belgeden" rozeti; desen/renk önerisi "X mi? Evet" çipiyle onaylanır.
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip, Text, TextInput } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import ColorSelectField from '../../../../components/ColorSelectField';
import { SheetField } from '../../../../components/ModuleSheet';
import NumpadInput from '../../../../components/NumpadInput';
import PickerModal, { type PickerOption } from '../../../../components/PickerModal';
import { usePickableLifecycle } from '../../../../hooks/useFeatureFlags';
import { fmtDayKey } from '../../../../lib/factory-time';
import { lifecycleBadge } from '../../../../lib/item-lifecycle';
import type { FabricPropertyValue } from '../../../../services/fabricProperty.service';
import { itemService } from '../../../../services/item.service';
import { useTruncationWarning } from '../../../../hooks/useTruncationWarning';
import type { ProductionRoute } from '../../../../services/route.service';
import { colors, radius, spacing, typography } from '../../../../theme';
import OrderLinkPicker from '../../HizliIsEmri/OrderLinkPicker';
import { SCAN_ROUTE_HINT, withScanRouteOption } from '../../HizliIsEmri/scanRouteOption';
import type { AvailableOrderLine } from '../../../../services/order.service';
import { SCAN_ROUTE, isScanRoute } from './woFromDoc';
import { plannedDayOptions, type DocFilledKey, type WoFormExtras, type WoFormState } from './woForm';

interface Props {
  state: WoFormState;
  edit: (patch: Partial<WoFormExtras>) => void;
  route: ProductionRoute | null;
  /** Kısayoldan açıldıysa rota sabittir (özel iş emri); düz formda seçilir. */
  routeLocked: boolean;
  onRoute: (r: ProductionRoute) => void;
  routes: readonly ProductionRoute[];
  routesLoading: boolean;
  scanMode: boolean;
  hasTambur: boolean;
  foldValues: readonly FabricPropertyValue[];
  /** Hedef metraj/kg (`workorder.targetQuantityEnabled`); kapalıyken yalnız belgeden değer geldiyse görünür. */
  showQuantity: boolean;
  locked: boolean;
  /** Sipariş kalemi işaretlendi: boş hedef kumaş/renk/en kalemden dolar. */
  onOrderLinePicked: (line: AvailableOrderLine) => void;
}

type Picker = 'route' | 'item' | 'start' | 'end' | null;

export default function WoFormFields(p: Props) {
  const { state, edit, locked } = p;
  const e = state.extras;
  const [picker, setPicker] = useState<Picker>(null);
  const days = useMemo(() => plannedDayOptions(), []);
  const stepPath = [...(p.route?.steps ?? [])].sort((a, b) => a.sequence - b.sequence).map((s) => s.station?.name ?? '—');
  const qtyVisible = p.showQuantity || !!e.targetQuantity || !!e.targetWeight;
  const itemSug = state.suggestions.targetItem;
  const colorSug = state.suggestions.targetColor;

  return (
    <View style={styles.root} testID="ie-form-alanlari">
      <Text style={styles.section}>Üretim</Text>
      <SheetField
        label="Rota"
        value={p.route ? p.route.name : ''}
        placeholder="Rota seçin"
        onPress={() => setPicker('route')}
        disabled={locked || p.routeLocked}
        hint={p.route && isScanRoute(p.route) ? SCAN_ROUTE_HINT : stepPath.length ? stepPath.join(' → ') : undefined}
      />

      <Badged label="Sipariş (isteğe bağlı)" />
      <View pointerEvents={locked ? 'none' : 'auto'} testID="ie-form-siparis">
        <OrderLinkPicker itemId={e.targetItemId} value={e.orderLineIds} onChange={(ids) => edit({ orderLineIds: ids })} onLinePicked={p.onOrderLinePicked} />
      </View>

      <Badged label="Hedef kumaş" />
      <SheetField label="" value={e.targetItemLabel ?? ''} placeholder="Hedef kumaş seçin (isteğe bağlı)" onPress={() => setPicker('item')} disabled={locked} />
      <Suggest
        kind="desen"
        docText={state.docText.desen}
        name={itemSug ? `${itemSug.name}${itemSug.code ? ` (${itemSug.code})` : ''}` : null}
        accepted={!!itemSug && e.targetItemId === itemSug.id}
        locked={locked}
        onAccept={() => itemSug && edit({ targetItemId: itemSug.id, targetItemLabel: itemSug.name })}
      />

      <View style={styles.row}>
        <View style={styles.col}>
          <Badged label="En (cm)" k="width" state={state} />
          <NumpadInput value={e.width} onChangeText={(t) => edit({ width: t })} mode="outlined" dense useNativeKeyboard allowDecimal placeholder="örn. 150" disabled={locked} style={styles.input} testID="ie-form-en" />
        </View>
        {qtyVisible && (
          <View style={styles.col}>
            <Badged label="Hedef metraj (m)" k="targetQuantity" state={state} />
            <NumpadInput value={e.targetQuantity} onChangeText={(t) => edit({ targetQuantity: t })} mode="outlined" dense useNativeKeyboard allowDecimal placeholder="—" disabled={locked} style={styles.input} testID="ie-form-hedef-metraj" />
          </View>
        )}
        {qtyVisible && (
          <View style={styles.col}>
            <Badged label="Hedef kg" k="targetWeight" state={state} />
            <NumpadInput value={e.targetWeight} onChangeText={(t) => edit({ targetWeight: t })} mode="outlined" dense useNativeKeyboard allowDecimal placeholder="—" disabled={locked} style={styles.input} testID="ie-form-hedef-kg" />
          </View>
        )}
      </View>

      <Badged label="Hedef renk" />
      <ColorSelectField value={e.targetColorId} onChange={(id) => edit({ targetColorId: id })} disabled={locked} />
      <Suggest
        kind="renk"
        docText={state.docText.renk}
        name={colorSug?.name ?? null}
        accepted={!!colorSug && e.targetColorId === colorSug.id}
        locked={locked}
        onAccept={() => colorSug && edit({ targetColorId: colorSug.id })}
      />

      <FoldAndPlan {...p} onPick={setPicker} />
      <FieldPickers {...p} picker={picker} setPicker={setPicker} days={days} />
    </View>
  );
}

/** Kat tipi (yalnız tamburlu rota) + plan tarihleri + not. */
function FoldAndPlan(p: Props & { onPick: (x: Picker) => void }) {
  return (
    <>
      {p.hasTambur && (
        <>
          <Badged label="Kat tipi" />
          <View style={styles.chips}>
            {p.foldValues.map((f) => (
              <Chip key={f.code} selected={p.state.extras.foldType === f.code} onPress={() => p.edit({ foldType: f.code })} disabled={p.locked} style={styles.chip} testID={`ie-form-kat-${f.code}`}>
                {f.name}
              </Chip>
            ))}
          </View>
          {p.foldValues.length === 0 && <Text style={styles.warn}>Kat değeri tanımlı değil — panelden Kumaş Özellikleri → KAT ekleyin.</Text>}
        </>
      )}

      <Text style={styles.section}>Plan</Text>
      <View style={styles.row}>
        <View style={styles.col}>
          <SheetField label="Planlı başlangıç" value={p.state.extras.plannedStart ? fmtDayKey(p.state.extras.plannedStart) : ''} placeholder="Seçilmedi" onPress={() => p.onPick('start')} disabled={p.locked} />
        </View>
        <View style={styles.col}>
          <SheetField label="Planlı bitiş" value={p.state.extras.plannedEnd ? fmtDayKey(p.state.extras.plannedEnd) : ''} placeholder="Seçilmedi" onPress={() => p.onPick('end')} disabled={p.locked} />
        </View>
      </View>
      <Badged label="Not" k="note" state={p.state} />
      <TextInput value={p.state.extras.note} onChangeText={(t) => p.edit({ note: t })} mode="outlined" multiline placeholder="İsteğe bağlı" disabled={p.locked} style={styles.input} testID="ie-form-not" />
    </>
  );
}

/** Belgedeki desen/renk: öneri varsa "X mi? Evet" (görevli onaylar, alana kendiliğinden yazılmaz); yoksa yalnız belgedeki yazı. */
function Suggest(p: { kind: 'desen' | 'renk'; docText: string | null; name: string | null; accepted: boolean; locked: boolean; onAccept: () => void }) {
  if (p.name && !p.accepted) {
    return (
      <Chip icon="help-circle-outline" style={styles.chip} disabled={p.locked} onPress={p.onAccept} testID={`ie-form-${p.kind}-oneri`}>
        {`${p.docText ? `Belgede “${p.docText}” — ` : ''}${p.name} mi? Evet`}
      </Chip>
    );
  }
  if (!p.name && p.docText) return <Text style={styles.hint} testID={`ie-form-${p.kind}-metni`}>{`Belgede yazan ${p.kind}: ${p.docText}`}</Text>;
  return null;
}

/** Alan etiketi; değer belgeden geldiyse yanında "belgeden" rozeti. */
function Badged({ label, k, state }: { label: string; k?: DocFilledKey; state?: WoFormState }) {
  const fromDoc = !!k && !!state?.fromDoc.includes(k);
  return (
    <View style={styles.labelRow}>
      <Text style={styles.label}>{label}</Text>
      {fromDoc && (
        <Text style={styles.badge} testID={`belgeden-${k}`}>
          belgeden
        </Text>
      )}
    </View>
  );
}

function FieldPickers(p: Props & { picker: Picker; setPicker: (x: Picker) => void; days: { value: string; label: string }[] }) {
  const { picker, setPicker, edit } = p;
  const lifecycle = usePickableLifecycle('plan');
  const items = useQuery({
    queryKey: ['items', 'wo-form', 'FABRIC', lifecycle],
    queryFn: () => itemService.getAll({ page: 1, pageSize: 500, sortBy: 'code', sortOrder: 'asc', filters: { isActive: 'true', itemType: 'FABRIC', lifecycleStatus: lifecycle } }),
    enabled: picker === 'item',
    staleTime: 60_000,
  });
  useTruncationWarning(items.data?.pagination, 'Kumaş');
  const itemOptions: PickerOption[] = (items.data?.data ?? []).map((i) => ({ value: i.id, label: i.name, sublabel: i.code, badge: lifecycleBadge(i, colors.warningText) }));
  const routeOptions = withScanRouteOption(p.routes.map((r) => ({ value: r.id, label: r.name, sublabel: r.description ?? undefined })), p.scanMode);
  const close = () => setPicker(null);
  return (
    <>
      <PickerModal
        visible={picker === 'route'}
        title="Rota"
        options={routeOptions}
        selectedValue={p.route?.id ?? null}
        loading={p.routesLoading}
        onSelect={(id) => {
          close();
          const r = isScanRoute({ id }) ? SCAN_ROUTE : p.routes.find((x) => x.id === id);
          if (r) p.onRoute(r);
        }}
        onDismiss={close}
        emptyText="Rota şablonu yok"
      />
      <PickerModal
        visible={picker === 'item'}
        title="Hedef kumaş"
        options={itemOptions}
        selectedValue={p.state.extras.targetItemId}
        loading={items.isLoading}
        onSelect={(id) => {
          close();
          edit({ targetItemId: id, targetItemLabel: itemOptions.find((o) => o.value === id)?.label ?? null });
        }}
        onDismiss={close}
        emptyText="Aktif kumaş yok."
      />
      <PickerModal
        visible={picker === 'start' || picker === 'end'}
        title={picker === 'end' ? 'Planlı bitiş' : 'Planlı başlangıç'}
        options={[{ value: '', label: 'Temizle' }, ...p.days]}
        selectedValue={(picker === 'end' ? p.state.extras.plannedEnd : p.state.extras.plannedStart) ?? ''}
        disableSort
        onSelect={(v) => {
          edit(picker === 'end' ? { plannedEnd: v || null } : { plannedStart: v || null });
          close();
        }}
        onDismiss={close}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  section: { marginTop: spacing.md, fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: colors.text },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  label: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold },
  badge: { fontSize: typography.size.xs, color: colors.brand, backgroundColor: colors.brandSoft, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2, overflow: 'hidden' },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary },
  warn: { fontSize: typography.size.sm, color: colors.warningText },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  col: { flex: 1, minWidth: 200 },
  input: { backgroundColor: colors.surface },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 56, justifyContent: 'center', alignSelf: 'flex-start' },
});
