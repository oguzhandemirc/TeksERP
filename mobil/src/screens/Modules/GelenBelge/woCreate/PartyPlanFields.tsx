// Tek İE formunda "her parti ayrı" kipi: parti kartının kurşun gramajı + makinesi. Seçici düğmesi → PickerModal (combobox
// yok). Değer partinin taslağına yazılır; gövdeye belge masasıyla aynı `withDeskPlan` yolundan gider.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import PickerModal from '../../../../components/PickerModal';
import { SelectButton } from '../../../../components/form/SelectButton';
import { colors, spacing, typography } from '../../../../theme';
import { MACHINE_LATER_LABEL, machineChoice } from '../desk/machineChoice';
import type { PartyRow } from './partyDraft';
import { machineLabel, partyGramajValue, partyMachineValue, type PartyPlanCtx } from './partyPlan';

// PickerModal değeri dizgedir: "Sonra seçilsin" (null) için ayraç.
const LATER = '__sonra__';

interface Props {
  ctx: PartyPlanCtx;
  party: PartyRow;
  locked: boolean;
  noteNo: string;
  onChange: (patch: Pick<PartyRow, 'machineId'> | Pick<PartyRow, 'gramajValueId'>) => void;
}

export default function PartyPlanFields({ ctx, party, locked, noteNo, onChange }: Props) {
  const [open, setOpen] = useState<'gramaj' | 'makine' | null>(null);
  const id = `${noteNo}-${party.blockNo}`;
  const gramajId = partyGramajValue(party, ctx);
  const gramaj = ctx.gramaj.find((o) => o.id === gramajId) ?? null;
  const machineId = partyMachineValue(party, ctx);
  // Değerde yalnız ayırt edici kısım ("KURŞUN MAKİNESİ 2" → "2"; masa çipleriyle aynı): dar sütunda tek satır kalır.
  const mc = machineChoice(ctx.machines, `belge-parti-makine-${id}`);
  return (
    <>
      <View style={styles.row}>
        {ctx.gramaj.length > 0 && (
          <View style={styles.cell}>
            <SelectButton label="Gramaj seç" caption="Kurşun gramajı" value={gramaj?.name ?? null} icon="weight-gram" optional
              onPress={() => setOpen('gramaj')} disabled={locked} testID={`belge-parti-gramaj-${id}`} />
          </View>
        )}
        {ctx.machines.length > 0 && (
          <View style={styles.cell}>
            <SelectButton label="Makine seç" caption="Kurşun makinesi" value={mc.shortName(machineId) ?? MACHINE_LATER_LABEL} icon="cog-transfer-outline"
              onPress={() => setOpen('makine')} disabled={locked} testID={`belge-parti-makine-${id}`} />
          </View>
        )}
      </View>
      {ctx.machineNote ? <Text style={styles.note} testID={`belge-parti-makine-not-${id}`}>{ctx.machineNote}</Text> : null}
      <PickerModal
        visible={open === 'gramaj'}
        title={`${party.blockNo}. parti · Kurşun gramajı`}
        options={ctx.gramaj.map((o) => ({ value: o.id, label: o.name, sublabel: o.isDefault ? 'Varsayılan' : undefined }))}
        selectedValue={gramajId}
        disableSort
        onSelect={(v) => { setOpen(null); onChange({ gramajValueId: v }); }}
        onDismiss={() => setOpen(null)}
        emptyText="Gramaj kataloğu boş."
      />
      <PickerModal
        visible={open === 'makine'}
        title={`${party.blockNo}. parti · Kurşun makinesi`}
        options={[{ value: LATER, label: MACHINE_LATER_LABEL }, ...ctx.machines.map((m) => ({ value: m.id, label: machineLabel(m), sublabel: m.name && m.code !== m.name ? m.code : undefined }))]}
        selectedValue={machineId ?? LATER}
        disableSort
        onSelect={(v) => { setOpen(null); onChange({ machineId: v === LATER ? null : v }); }}
        onDismiss={() => setOpen(null)}
        emptyText="Kurşun istasyonunda makine yok."
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cell: { flex: 1, minWidth: 160 },
  note: { fontSize: typography.size.sm, color: colors.textSecondary },
});
