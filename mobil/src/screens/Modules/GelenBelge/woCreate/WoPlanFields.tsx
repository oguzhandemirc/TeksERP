// K30-D tablet İE formu — panelde olup tablette eksik kalan alanlar: rota adımları (+ kurşun makinesi önerisi), hedef
// özellikler. Her biri ⚙ "Alanlar"dan gizlenebilir (`show`). Dokunulmayan alan gövdeye GİTMEZ (woForm). İş emri türü formda
// sorulmaz: sipariş bağından türer (sunucu), Fason "Malın sahibi" kartından.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import type { DeskKursunMachine } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';
import { colors, spacing, typography } from '../../../../theme';
import { ChoiceChips } from '../../../../components/form/ChoiceChips';
import { ChoiceRow, InlineField } from '../../../../components/form/ChoiceRow';
import { machineChoice } from '../desk/machineChoice';
import RouteStepsEditor from './RouteStepsEditor';
import { useTargetProps } from './targetProps';
import type { WoFieldKey } from './woFieldCatalog';
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
  /** Makine bu kipte formda seçilmiyorsa nedeni (çok partide "her parti ayrı"). */
  machineNote?: string | null;
  onMachine: (id: string | null) => void;
  customerId: string | null;
  propertyIds: string[] | null;
  onProperties: (ids: string[] | null) => void;
  /** ⚙ "Rota adımı notu" kapalı (kişisel): boş adım notu kutusu çizilmez. */
  stepNotesHidden?: boolean;
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
          hideEmptyNotes={plan.stepNotesHidden}
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
    p.note ? (
      <InlineField label="Makine seç" aside={mc.prefix} testID="ie-serit-makine">
        <MachineNote text={p.note} />
      </InlineField>
    ) : (
      <ChoiceRow label="Makine seç" aside={mc.prefix} status={picked ?? 'Sonra'} rowTestID="ie-serit-makine"
        options={mc.options} value={p.value} onChange={p.onChange} disabled={p.locked} size={mc.square ? 'square' : 'md'} testID="ie-form-makine" />
    )
  );
}

/** Hedef özellikler (BAYRAK): dokunulmadıkça rotanın varsayılanları seçili görünür ve gövdeye gitmez (sunucu türetir). */
export function TargetPropsBlock({ plan, show, locked }: BlockProps) {
  const enabled = plan.showSteps && show('hedefOzellik');
  const tp = useTargetProps(plan.route, plan.customerId, enabled);
  // Rotanın AUTO verdiği özellik sorulmaz; kalan yoksa alan yok (seçili AUTO kimlikleri kümede kalır, gövde bugünkü gibi).
  if (!enabled || tp.empty) return null;
  // Varsayılanlar gelmeden dokunulursa küme boş varsayılandan kurulur ve rotanın özelliklerini dışlar → çipler bekler.
  const defaultsLoading = plan.propertyIds === null && (plan.route?.steps?.length ?? 0) > 0 && !tp.defaultsLoaded;
  const selected = plan.propertyIds ?? tp.defaultIds;
  const options = tp.options;
  const hint = tp.catalogLoading ? 'Özellikler yükleniyor…' : defaultsLoading ? 'Rotanın varsayılan özellikleri yükleniyor…' : options.length === 0 ? 'Tanımlı özellik yok.' : plan.propertyIds === null ? null : 'Rota bu özellikleri vermeli.';
  return (
    <View style={styles.block} testID="ie-form-ozellik">
      <InlineField label="Hedef özellikler" status={plan.propertyIds === null ? 'varsayılan' : 'elle'} testID="ie-serit-ozellik">
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
      </InlineField>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  btn: { minHeight: 56 },
});
