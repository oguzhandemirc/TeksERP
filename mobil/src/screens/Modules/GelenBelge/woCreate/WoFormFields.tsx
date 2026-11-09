// S16b tek form — panel klasik formunun üretim/plan inputları: Rota (+ adım yolu), Sipariş bağı, Hedef bölümü (WoTargetFields),
// Planlı başlangıç/bitiş, Not. K30-D: `show` ile yalnız seçilen alanlar çizilir; gizlenenler aynı bileşenle altta "Diğer alanlar"da
// (zone="other"). Rota adımları / makine / hedef özellikler `plan` ile WoPlanFields'tan; iş emri türü sorulmaz (bağdan türer).
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import type { BandTone } from '../../../../components/form/tone';
import { SelectButton } from '../../../../components/form/SelectButton';
import PickerModal, { type PickerOption } from '../../../../components/PickerModal';
import { usePickableLifecycle } from '../../../../hooks/useFeatureFlags';
import { fmtDayKey } from '../../../../lib/factory-time';
import { lifecycleBadge } from '../../../../lib/item-lifecycle';
import type { FabricPropertyValue } from '../../../../services/fabricProperty.service';
import { itemService } from '../../../../services/item.service';
import { useTruncationWarning } from '../../../../hooks/useTruncationWarning';
import type { ProductionRoute } from '../../../../services/route.service';
import { colors, spacing, typography } from '../../../../theme';
import OrderLinkPicker from '../../HizliIsEmri/OrderLinkPicker';
import { withScanRouteOption } from '../../HizliIsEmri/scanRouteOption';
import type { AvailableOrderLine } from '../../../../services/order.service';
import { SCAN_ROUTE, isScanRoute } from './woFromDoc';
import { plannedDayOptions, type WoFormExtras, type WoFormState } from './woForm';
import type { WoFieldKey } from './woFieldCatalog';
import { RouteStepsBlock, TargetPropsBlock, type WoPlanCtx } from './WoPlanFields';
import { DocFilled, TargetFields } from './WoTargetFields';
import type { TargetHints } from './targetPrefill';

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
  /** Hedef metraj/kg (`workorder.targetQuantityEnabled`); kapalıyken kutu çizilmez (belge değeri getirse de). */
  showQuantity: boolean;
  /** Hedef en kutusu (`workorder.targetWidthEnabled`); kapalıyken çizilmez. */
  showWidth?: boolean;
  /** Boş hedef kutularının silik ipucu ("belgede 241 m"). */
  hints?: TargetHints;
  /** Hedef metraj boşken gösterilen gelen metre (`derivedTargetQuantity`); yoksa alanın kendi değeri. */
  targetDerived?: { value: string; derived: boolean };
  locked: boolean;
  /** Sipariş kalemi işaretlendi: boş hedef kumaş/renk/en kalemden dolar. */
  onOrderLinePicked: (line: AvailableOrderLine) => void;
  /** K30-D: bu bölümde çizilecek alanlar (⚙ Alanlar); yoksa hepsi. */
  show?: (k: WoFieldKey) => boolean;
  /** 'other' = altta "Diğer alanlar" bölümü (bölüm başlığı "Üretim" çizilmez). */
  zone?: 'top' | 'other';
  /** K30-D: rota adımları + makine, hedef özellikler; yoksa çizilmez. */
  plan?: WoPlanCtx;
  /** Hedef şeridinin tonu (engellerden). */
  targetTone?: BandTone;
}

type Picker = 'route' | 'item' | 'start' | 'end' | null;
type Shown = Props & { show: (k: WoFieldKey) => boolean };
const ALL = () => true;

export default function WoFormFields(props: Props) {
  const p: Shown = { ...props, show: props.show ?? ALL };
  const { state, edit, locked, show } = p;
  const e = state.extras;
  const [picker, setPicker] = useState<Picker>(null);
  const days = useMemo(() => plannedDayOptions(), []);
  const stepPath = [...(p.route?.steps ?? [])].sort((a, b) => a.sequence - b.sequence).map((s) => s.station?.name ?? '—');
  const top = p.zone !== 'other';

  return (
    <View style={styles.root} testID={top ? 'ie-form-alanlari' : 'ie-form-alanlari-diger'}>
      {show('rota') && (
        <>
          {/* Adım yolu seçicinin ikincil satırında; "sahada belirlenir" rotasında açıklama satırı yok (ad kendini anlatır). */}
          {!p.routeLocked && (
            <SelectButton
              label="Üretim Rotası seç"
              caption="Üretim Rotası"
              value={p.route ? p.route.name : null}
              hint={p.route && !isScanRoute(p.route) && stepPath.length > 0 ? stepPath.join(' › ') : null}
              icon="map-marker-path"
              onPress={() => setPicker('route')}
              disabled={locked}
              testID="ie-form-rota"
            />
          )}
          {p.routeLocked && p.route && !isScanRoute(p.route) && (
            <Text style={styles.path} numberOfLines={1} testID="ie-rota-yolu">
              {stepPath.join(' › ')}
            </Text>
          )}
        </>
      )}
      {p.plan && <RouteStepsBlock plan={p.plan} show={show} locked={locked} />}

      {show('siparis') && (
        <View pointerEvents={locked ? 'none' : 'auto'} testID="ie-form-siparis">
          <OrderLinkPicker itemId={e.targetItemId} value={e.orderLineIds} onChange={(ids) => edit({ orderLineIds: ids })} onLinePicked={p.onOrderLinePicked} optionalInline />
        </View>
      )}

      <TargetFields {...p} customerId={p.plan?.customerId ?? null} onPickItem={() => setPicker('item')} />
      {p.plan && <TargetPropsBlock plan={p.plan} show={show} locked={locked} />}
      <FoldAndPlan {...p} onPick={setPicker} />
      <FieldPickers {...p} picker={picker} setPicker={setPicker} days={days} />
    </View>
  );
}

/** Plan tarihleri + not. */
function FoldAndPlan(p: Shown & { onPick: (x: Picker) => void }) {
  const { show } = p;
  const plan = { start: show('planBaslangic'), end: show('planBitis'), note: show('not') };
  return (
    <>
      {(plan.start || plan.end) && (
        <View style={styles.row}>
          {plan.start && (
            <View style={styles.col}>
              <SelectButton label="Planlı başlangıç" caption="Planlı başlangıç" value={p.state.extras.plannedStart ? fmtDayKey(p.state.extras.plannedStart) : null} icon="calendar-start" quiet onPress={() => p.onPick('start')} disabled={p.locked} testID="ie-form-plan-baslangic" />
            </View>
          )}
          {plan.end && (
            <View style={styles.col}>
              <SelectButton label="Planlı bitiş" caption="Planlı bitiş" value={p.state.extras.plannedEnd ? fmtDayKey(p.state.extras.plannedEnd) : null} icon="calendar-end" quiet onPress={() => p.onPick('end')} disabled={p.locked} testID="ie-form-plan-bitis" />
            </View>
          )}
        </View>
      )}
      {plan.note && (
        <DocFilled k="note" state={p.state} highlight>
          <TextInput label="Üretim notu" value={p.state.extras.note} onChangeText={(t) => p.edit({ note: t })} mode="outlined" multiline placeholder="İsteğe bağlı" disabled={p.locked} style={styles.input} testID="ie-form-not" />
        </DocFilled>
      )}
    </>
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
        title="Üretim Rotası"
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
  root: { gap: spacing.md },
  path: { minHeight: 32, textAlignVertical: 'center', fontSize: typography.size.base, color: colors.textSecondary },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  col: { flex: 1, minWidth: 180 },
  input: { backgroundColor: colors.surface },
});
