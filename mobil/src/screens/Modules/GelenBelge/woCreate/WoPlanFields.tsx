// K30-D tablet İE formu — panelde olup tablette eksik kalan dört alan: rota adımları (+ kurşun makinesi önerisi), iş emri
// türü, hedef özellikler. Her biri ⚙ "Alanlar"dan gizlenebilir (`show`). Dokunulmayan alan gövdeye GİTMEZ (woForm).
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useRouteDefaultTargets } from '../../../../hooks/useRouteDefaultTargets';
import { fabricPropertyService } from '../../../../services/fabricProperty.service';
import type { DeskKursunMachine } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';
import { colors, spacing, typography } from '../../../../theme';
import { ChoiceChips } from '../../../../components/form/ChoiceChips';
import { FieldCaption } from './FieldCaption';
import { machineChoice } from '../desk/machineChoice';
import RouteStepsEditor from './RouteStepsEditor';
import type { WoFieldKey } from './woFieldCatalog';
import { deriveWoType, type WoType } from './woForm';
import type { EditStep } from './woSteps';
import { TERIM_AD } from '../../../../lib/terim';

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
  /** Makine bu kipte formda seçilmiyorsa nedeni (çok partide "her parti ayrı"). */
  machineNote?: string | null;
  onMachine: (id: string | null) => void;
  customerId: string | null;
  woType: WoType | null;
  orderLineIds: readonly string[];
  onWoType: (t: WoType | null) => void;
  /** "Malın sahibi" seçimi formda: Fason oradan seçilir → tür alanı yalnız Siparişe/Stoğa (Fason'da salt okunur ifade). */
  ownerCard?: boolean;
  propertyIds: string[] | null;
  onProperties: (ids: string[] | null) => void;
}

interface BlockProps {
  plan: WoPlanCtx;
  show: (k: WoFieldKey) => boolean;
  locked: boolean;
}

/** Rota adımları: açık rotada editör (kurşun satırında makine); kilitli rotada adımlar yol satırında, burada yalnız makine şeridi. */
export function RouteStepsBlock({ plan, show, locked }: BlockProps) {
  const machineShown = show('makine') && plan.machines.length > 0;
  const machine = machineShown ? { list: plan.machines, value: plan.machineValue, onChange: plan.onMachine } : null;
  const note = plan.machineNote && show('rotaAdimlari') ? plan.machineNote : null;
  if (plan.showSteps && plan.stepsEditable && show('rotaAdimlari')) {
    return (
      <>
        <RouteStepsEditor
          steps={plan.steps}
          edited={plan.stepsEdited}
          editable
          onChange={plan.onSteps}
          routes={plan.stationRoutes}
          routesLoading={plan.stationRoutesLoading}
          machine={machine}
          locked={locked}
        />
        {note ? <MachineNote text={note} /> : null}
      </>
    );
  }
  if (!machine && !note) return null;
  return <MachineBand list={machine?.list ?? []} value={plan.machineValue} note={note} locked={locked} onChange={plan.onMachine} />;
}

function MachineNote({ text }: { text: string }) {
  return (
    <Text style={styles.hint} testID="ie-form-makine-not">
      {text}
    </Text>
  );
}

/** Makine şeridi — önek şeritte, çipte kısa ad; hap seçimi ya da "Sonra" der. */
function MachineBand(p: { list: readonly DeskKursunMachine[]; value: string | null; note: string | null; locked: boolean; onChange: (id: string | null) => void }) {
  const mc = machineChoice(p.list, 'ie-form-makine');
  const picked = mc.shortName(p.value);
  return (
    <View style={styles.block}>
      <FieldCaption label="Makine seç" aside={mc.prefix} status={p.note ? null : picked ?? 'Sonra'} testID="ie-serit-makine" />
      {p.note ? (
        <MachineNote text={p.note} />
      ) : (
        <ChoiceChips options={mc.options} value={p.value} onChange={p.onChange} disabled={p.locked} size={mc.square ? 'square' : 'md'} testID="ie-form-makine" />
      )}
    </View>
  );
}

const TYPE_LABEL: Record<WoType, string> = { ORDER_PRODUCTION: 'Siparişe üretim', STOCK_PRODUCTION: 'Stoğa üretim', CUSTOMER_GOODS_SERVICE: TERIM_AD.fasonMusteriMali };
const TYPE_OPTIONS = (Object.keys(TYPE_LABEL) as WoType[]).map((t) => ({ value: t, label: TYPE_LABEL[t], testID: `ie-form-tur-${t}` }));

const OWN_OPTIONS = TYPE_OPTIONS.filter((o) => o.value !== 'CUSTOMER_GOODS_SERVICE');

/** İş emri türü: dokunulmadıkça otomatik (sipariş kalemi varsa siparişe, yoksa stoğa) ve gövdeye gitmez. Ayrı başlık/açıklama
 *  yok; "Otomatik" ya da "Otomatiğe dön" çiplerin yanında. Malın sahibi formdaysa Fason orada seçilir, burada salt okunur. */
export function WoTypeBlock({ plan, show, locked }: BlockProps) {
  if (!show('isEmriTuru')) return null;
  const shown = plan.woType ?? deriveWoType(plan.orderLineIds);
  if (plan.ownerCard && shown === 'CUSTOMER_GOODS_SERVICE') {
    return (
      <View style={styles.fixed} testID="ie-form-tur">
        <Text style={styles.fixedLabel}>Tür</Text>
        <Text style={styles.fixedValue} testID="ie-form-tur-sabit">{TYPE_LABEL.CUSTOMER_GOODS_SERVICE}</Text>
      </View>
    );
  }
  return (
    <View style={styles.chips} testID="ie-form-tur">
      <ChoiceChips
        options={plan.ownerCard ? OWN_OPTIONS : TYPE_OPTIONS}
        value={shown}
        onChange={(t) => t && plan.onWoType(t as WoType)}
        disabled={locked}
        testID="ie-form-tur-secim"
      />
      {plan.woType !== null ? (
        <Button mode="text" compact onPress={() => plan.onWoType(null)} disabled={locked} contentStyle={styles.btn} testID="ie-form-tur-otomatik">
          Otomatiğe dön
        </Button>
      ) : (
        <Text style={styles.hint}>Otomatik</Text>
      )}
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
  // Varsayılanlar gelmeden dokunulursa küme boş varsayılandan kurulur ve rotanın özelliklerini dışlar → çipler bekler.
  const defaultsLoading = plan.propertyIds === null && (plan.route?.steps?.length ?? 0) > 0 && !defaults.byCustomer.has(plan.customerId ?? '');
  const selected = plan.propertyIds ?? defaultIds;
  const options = catalog.data?.data ?? [];
  const hint = catalog.isLoading ? 'Özellikler yükleniyor…' : defaultsLoading ? 'Rotanın varsayılan özellikleri yükleniyor…' : options.length === 0 ? 'Tanımlı özellik yok.' : plan.propertyIds === null ? null : 'Rota bu özellikleri vermeli.';
  return (
    <View style={styles.block} testID="ie-form-ozellik">
      <FieldCaption label="Hedef özellikler" status={plan.propertyIds === null ? 'varsayılan' : 'elle'} testID="ie-serit-ozellik" />
      <View style={styles.chips}>
        <ChoiceChips
          multi
          options={options.map((o) => ({ value: o.id, label: o.name, testID: `ie-form-ozellik-${o.id}` }))}
          value={selected}
          onChange={plan.onProperties}
          disabled={locked || defaultsLoading}
          testID="ie-form-ozellik-secim"
        />
        {plan.propertyIds !== null && (
          <Button mode="text" onPress={() => plan.onProperties(null)} disabled={locked} contentStyle={styles.btn} testID="ie-form-ozellik-varsayilan">
            Varsayılana dön
          </Button>
        )}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  fixed: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40 },
  fixedLabel: { fontSize: typography.size.sm, fontWeight: typography.weight.semibold, color: colors.textSecondary },
  fixedValue: { fontSize: typography.size.base, fontWeight: typography.weight.bold, color: colors.warningDark },
  btn: { minHeight: 56 },
});
