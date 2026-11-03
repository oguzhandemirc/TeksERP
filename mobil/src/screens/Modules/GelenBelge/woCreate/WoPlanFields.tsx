// K30-D tablet İE formu — panelde olup tablette eksik kalan dört alan: rota adımları (+ kurşun makinesi önerisi), iş emri
// türü, hedef özellikler. Her biri ⚙ "Alanlar"dan gizlenebilir (`show`). Dokunulmayan alan gövdeye GİTMEZ (woForm).
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Chip, Text } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useRouteDefaultTargets } from '../../../../hooks/useRouteDefaultTargets';
import { fabricPropertyService } from '../../../../services/fabricProperty.service';
import type { DeskKursunMachine } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';
import { colors, spacing, typography } from '../../../../theme';
import { MachineChips } from '../desk/DeskReview';
import RouteStepsEditor from './RouteStepsEditor';
import type { WoFieldKey } from './woFieldCatalog';
import { deriveWoType, type WoType } from './woForm';
import type { EditStep } from './woSteps';

export interface WoPlanCtx {
  /** Etkin rota (düzenlenmiş adımlarla); varsayılan hedefler bundan. */
  route: ProductionRoute | null;
  /** Ekranda görünen adımlar (düzenlenmiş liste ya da şablon). */
  steps: readonly EditStep[];
  stepsEdited: boolean;
  /** Rota seçili, adımlı ve rotasız değil. */
  showSteps: boolean;
  /** Özel İE kısayolunda rota kilitli → salt okunur. */
  stepsEditable: boolean;
  onSteps: (steps: EditStep[] | null) => void;
  stationRoutes: readonly ProductionRoute[];
  stationRoutesLoading: boolean;
  /** Kurşun adımı istasyonunun makineleri (çok partide boş: parti başına seçilir). */
  machines: readonly DeskKursunMachine[];
  machineValue: string | null;
  onMachine: (id: string | null) => void;
  customerId: string | null;
  woType: WoType | null;
  orderLineIds: readonly string[];
  onWoType: (t: WoType | null) => void;
  propertyIds: string[] | null;
  onProperties: (ids: string[] | null) => void;
}

interface BlockProps {
  plan: WoPlanCtx;
  show: (k: WoFieldKey) => boolean;
  locked: boolean;
}

/** Rota adımları (kurşun satırında makine); adımlar bu bölümde değil ama makine buradaysa makine tek başına. */
export function RouteStepsBlock({ plan, show, locked }: BlockProps) {
  const machineShown = show('makine') && plan.machines.length > 0;
  const machine = machineShown ? { list: plan.machines, value: plan.machineValue, onChange: plan.onMachine } : null;
  if (plan.showSteps && show('rotaAdimlari')) {
    return (
      <RouteStepsEditor
        steps={plan.steps}
        edited={plan.stepsEdited}
        editable={plan.stepsEditable}
        onChange={plan.onSteps}
        routes={plan.stationRoutes}
        routesLoading={plan.stationRoutesLoading}
        machine={machine}
        locked={locked}
      />
    );
  }
  if (!machine) return null;
  return <MachineChips list={machine.list} value={machine.value} locked={locked} label="Makine (öneri)" testID="ie-form-makine" onChange={machine.onChange} />;
}

const TYPE_LABEL: Record<WoType, string> = { ORDER_PRODUCTION: 'Siparişe üretim', STOCK_PRODUCTION: 'Stoğa üretim' };

/** İş emri türü: dokunulmadıkça otomatik (sipariş kalemi varsa siparişe, yoksa stoğa) ve gövdeye gitmez. */
export function WoTypeBlock({ plan, show, locked }: BlockProps) {
  if (!show('isEmriTuru')) return null;
  const shown = plan.woType ?? deriveWoType(plan.orderLineIds);
  return (
    <View style={styles.block} testID="ie-form-tur">
      <Text style={styles.label}>İş emri türü</Text>
      <View style={styles.chips}>
        {(Object.keys(TYPE_LABEL) as WoType[]).map((t) => (
          <Chip key={t} selected={shown === t} onPress={() => plan.onWoType(t)} disabled={locked} style={styles.chip} testID={`ie-form-tur-${t}`}>
            {TYPE_LABEL[t]}
          </Chip>
        ))}
        {plan.woType !== null && (
          <Button mode="text" onPress={() => plan.onWoType(null)} disabled={locked} contentStyle={styles.btn} testID="ie-form-tur-otomatik">
            Otomatiğe dön
          </Button>
        )}
      </View>
      <Text style={styles.hint}>
        {plan.woType === null ? 'Otomatik: sipariş kalemi bağlıysa siparişe, değilse stoğa üretim.' : plan.woType === 'ORDER_PRODUCTION' && plan.orderLineIds.length === 0 ? 'Siparişe üretim için yukarıdan sipariş kalemi seçin.' : 'Elle seçildi.'}
      </Text>
    </View>
  );
}

/** Hedef özellikler (BAYRAK): dokunulmadıkça rotanın varsayılanları seçili görünür ve gövdeye gitmez (sunucu türetir). */
export function TargetPropsBlock({ plan, show, locked }: BlockProps) {
  const enabled = plan.showSteps && show('hedefOzellik');
  const catalog = useQuery({
    queryKey: ['fabric-properties', 'wo-picker'],
    queryFn: () => fabricPropertyService.getAll({ page: 1, pageSize: 200, sortBy: 'name', sortOrder: 'asc', filters: { isActive: 'true', valueType: 'FLAG' } }),
    enabled,
    staleTime: 10 * 60 * 1000,
  });
  const defaults = useRouteDefaultTargets(plan.route, [plan.customerId], enabled);
  const list = defaults.byCustomer.get(plan.customerId ?? '');
  const defaultIds = useMemo(() => [...new Set((list ?? []).flatMap((s) => s.targets.filter((t) => t.valueType === 'FLAG').map((t) => t.propertyId)))], [list]);
  if (!enabled) return null;
  const selected = plan.propertyIds ?? defaultIds;
  const toggle = (id: string) => plan.onProperties(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const options = catalog.data?.data ?? [];
  return (
    <View style={styles.block} testID="ie-form-ozellik">
      <Text style={styles.label}>Hedef özellikler</Text>
      <View style={styles.chips}>
        {options.map((o) => (
          <Chip key={o.id} selected={selected.includes(o.id)} onPress={() => toggle(o.id)} disabled={locked} style={styles.chip} testID={`ie-form-ozellik-${o.id}`}>
            {o.name}
          </Chip>
        ))}
        {plan.propertyIds !== null && (
          <Button mode="text" onPress={() => plan.onProperties(null)} disabled={locked} contentStyle={styles.btn} testID="ie-form-ozellik-varsayilan">
            Varsayılana dön
          </Button>
        )}
      </View>
      <Text style={styles.hint}>
        {catalog.isLoading ? 'Özellikler yükleniyor…' : options.length === 0 ? 'Tanımlı özellik yok.' : plan.propertyIds === null ? 'Rotanın varsayılanları seçili.' : 'Elle seçildi; rota bu özellikleri vermeli.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.xs },
  label: { marginTop: spacing.xs, fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  chip: { minHeight: 56, justifyContent: 'center', alignSelf: 'flex-start' },
  btn: { minHeight: 56 },
});
