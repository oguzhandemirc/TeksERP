// Belge masası TEK inceleme ekranı (K23): üstte "Hazır iş emirleri" (kısayol rotaları), okunan belgenin doldurulmuş
// alanları + uyarıları, kurşun planı (makine; çok partide parti başına makine + gramaj) ve "İş emri oluştur".
// Tablet yatayda iki sütun (kaydırmasız hedef), telefon dikeyde tek sütun.
import React from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Chip, Text } from 'react-native-paper';
import type { PickerOption } from '../../../../components/PickerModal';
import { TERIM } from '../../../../lib/terim';
import type { DeskKursunMachine } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';
import { colors, radius, spacing, typography } from '../../../../theme';
import DocRowCard from '../woCreate/DocRowCard';
import type { DocRow, WoRowsState } from '../woCreate/useWoRows';
import { shortcutTitle } from '../woCreate/woFromDoc';
import { machinesForRoute } from './deskPlan';

export interface DeskReviewProps {
  row: DocRow;
  wo: WoRowsState;
  shortcuts: readonly ProductionRoute[];
  route: ProductionRoute;
  onRoute: (r: ProductionRoute) => void;
  /** Tablet bağlamındaki kurşun makineleri; eski sunucu göndermez → makine seçimi çizilmez. */
  machines: readonly DeskKursunMachine[] | undefined;
  customers: PickerOption[];
  customersLoading: boolean;
  onCancel: () => void;
  onCreate: () => void;
}

export default function DeskReview(p: DeskReviewProps) {
  const { width, height } = useWindowDimensions();
  const wide = width > height;
  const done = p.row.result?.kind === 'OPENED' || p.row.result?.kind === 'DRAFT';
  const locked = done || p.wo.saving;
  const doc = <DocRowCard row={p.row} wo={p.wo} customers={p.customers} customersLoading={p.customersLoading} hideGramaj={!!p.row.form?.multi} />;
  const side = (
    <>
      <ShortcutChips shortcuts={p.shortcuts} route={p.route} onRoute={p.onRoute} locked={locked} />
      <PlanSection row={p.row} wo={p.wo} route={p.route} machines={p.machines} locked={locked} />
    </>
  );
  return (
    <View style={styles.root} testID="belge-masasi-inceleme">
      {wide ? (
        <View style={styles.cols}>
          <ScrollView style={styles.colMain} contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">{doc}</ScrollView>
          <ScrollView style={styles.colSide} contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">{side}</ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
          {side}
          {doc}
        </ScrollView>
      )}
      <ActionBar row={p.row} wo={p.wo} onCancel={p.onCancel} onCreate={p.onCreate} />
    </View>
  );
}

function ShortcutChips({ shortcuts, route, onRoute, locked }: { shortcuts: readonly ProductionRoute[]; route: ProductionRoute; onRoute: (r: ProductionRoute) => void; locked: boolean }) {
  return (
    <View style={styles.block} testID="masa-hazir-ie">
      <Text style={styles.title}>Hazır {TERIM.terbiyeIsEmri.cogulKucuk}</Text>
      <View style={styles.chips}>
        {shortcuts.map((r) => (
          <Chip key={r.id} selected={r.id === route.id} onPress={() => onRoute(r)} disabled={locked} style={styles.chip} testID={`masa-kisayol-${r.name}`}>
            {shortcutTitle(r)}
          </Chip>
        ))}
      </View>
    </View>
  );
}

interface PlanProps {
  row: DocRow;
  wo: WoRowsState;
  route: ProductionRoute;
  machines: readonly DeskKursunMachine[] | undefined;
  locked: boolean;
}

/** Kurşun planı: tek partide makine; çok partide parti başına makine + gramaj (gramaj boşsa belgenin ortak gramajı). */
function PlanSection({ row, wo, route, machines, locked }: PlanProps) {
  const f = row.form;
  const list = machinesForRoute(route, machines ?? []);
  const showMachines = machines !== undefined && list.length > 0;
  const gramaj = wo.showGramaj ? wo.catalog.options : [];
  if (!f || (!showMachines && !(f.multi && gramaj.length))) return null;
  if (!f.multi) {
    return (
      <View style={styles.block} testID="masa-plan">
        <MachineChips list={list} value={f.machineId ?? null} locked={locked} testID="masa-makine" onChange={(machineId) => wo.updateForm(row.noteId, { machineId })} />
      </View>
    );
  }
  const m = f.multi;
  const setParty = (blockNo: number, patch: { machineId?: string | null; gramajValueId?: string | null }) =>
    wo.setMulti(row.noteId, { ...m, rows: m.rows.map((r) => (r.blockNo === blockNo ? { ...r, ...patch } : r)) });
  return (
    <View style={styles.block} testID="masa-plan">
      {m.rows.map((r) => (
        <View key={r.blockNo} style={styles.party}>
          <Text style={styles.title}>{`${r.blockNo}. parti${r.batchNo ? ` · ${r.batchNo}` : ''}`}</Text>
          {gramaj.length > 0 && (
            <View style={styles.chips}>
              {gramaj.map((o) => {
                const sel = (r.gramajValueId ?? f.gramajValueId) === o.id;
                return (
                  <Chip key={o.id} selected={sel} onPress={() => setParty(r.blockNo, { gramajValueId: o.id })} disabled={locked} style={styles.chip} testID={`masa-parti-gramaj-${r.blockNo}-${o.name}`}>
                    {o.name}
                  </Chip>
                );
              })}
            </View>
          )}
          {showMachines && (
            <MachineChips list={list} value={r.machineId ?? null} locked={locked} testID={`masa-parti-makine-${r.blockNo}`} onChange={(machineId) => setParty(r.blockNo, { machineId })} />
          )}
        </View>
      ))}
    </View>
  );
}

function MachineChips({ list, value, locked, testID, onChange }: { list: DeskKursunMachine[]; value: string | null; locked: boolean; testID: string; onChange: (id: string | null) => void }) {
  return (
    <View style={styles.party}>
      <Text style={styles.label}>Kurşun makinesi</Text>
      <View style={styles.chips} testID={testID}>
        <Chip selected={value === null} onPress={() => onChange(null)} disabled={locked} style={styles.chip} testID={`${testID}-yok`}>
          Sonra seçilsin
        </Chip>
        {list.map((mc) => (
          <Chip key={mc.id} selected={value === mc.id} onPress={() => onChange(mc.id)} disabled={locked} style={styles.chip} testID={`${testID}-${mc.code}`}>
            {mc.name || mc.code}
          </Chip>
        ))}
      </View>
    </View>
  );
}

function ActionBar({ row, wo, onCancel, onCreate }: { row: DocRow; wo: WoRowsState; onCancel: () => void; onCreate: () => void }) {
  const ready = !!row.form && !!row.detail && row.result?.kind !== 'OPENED' && row.result?.kind !== 'DRAFT';
  const label = wo.mode === 'SEPARATE' ? 'Taslak kaydet' : `${TERIM.terbiyeIsEmri.tekil} oluştur`;
  return (
    <View style={styles.bar}>
      <Button mode="outlined" onPress={onCancel} disabled={wo.saving} contentStyle={styles.btn} testID="masa-vazgec">
        Vazgeç
      </Button>
      <Button mode="contained" icon="check-bold" onPress={onCreate} loading={wo.saving} disabled={wo.saving || !ready} contentStyle={styles.bigBtn} labelStyle={styles.bigLabel} style={styles.grow} testID="masa-olustur">
        {label}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  cols: { flex: 1, flexDirection: 'row' },
  colMain: { flex: 3 },
  colSide: { flex: 2, borderLeftWidth: 1, borderLeftColor: colors.border },
  pad: { padding: spacing.lg, gap: spacing.md },
  block: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
  party: { gap: spacing.xs },
  title: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: colors.text },
  label: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 56, justifyContent: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  grow: { flexGrow: 1 },
  btn: { minHeight: 56 },
  bigBtn: { minHeight: 64 },
  bigLabel: { fontSize: typography.size.lg },
});
