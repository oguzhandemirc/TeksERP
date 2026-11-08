// K30-D tablet İE formu — rota adımları: sade liste; ekle (istasyon seç), çıkar, yukarı/aşağı, fason adımda firma, adım
// notu; kurşun adımının satırında "Makine seç". Kullanıcı hiç değiştirmezse liste şablondur ve gövdeye gitmez.
// Özel İE kısayolunda rota kilitli → salt okunur. Saf işlemler `woSteps.ts`te.
import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Chip, IconButton, Text, TextInput } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import PickerModal from '../../../../components/PickerModal';
import TruncatedText from '../../../../components/TruncatedText';
import type { DeskKursunMachine } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';
import { subcontractorService } from '../../../../services/subcontractor.service';
import { colors, radius, spacing, typography } from '../../../../theme';
import { FieldCaption } from './FieldCaption';
import { MachineChips } from '../desk/DeskReview';
import { addStep, isKursunStation, moveStep, patchStep, removeStep, stationsFromRoutes, stepCategoryId, type EditStep } from './woSteps';
import { TERIM } from '../../../../lib/terim';

export interface MachinePick {
  list: readonly DeskKursunMachine[];
  value: string | null;
  onChange: (id: string | null) => void;
}

interface Props {
  steps: readonly EditStep[];
  /** Kullanıcı listeyi değiştirdi (şablon değil) — "Şablona dön" görünür. */
  edited: boolean;
  editable: boolean;
  /** null = şablona dön. */
  onChange: (steps: EditStep[] | null) => void;
  /** Adım eklemenin istasyon kaynağı (rota şablonları). */
  routes: readonly ProductionRoute[];
  routesLoading: boolean;
  /** Kurşun adımı satırındaki makine seçici (⚙'de makine açık ve istasyonda makine varsa). */
  machine: MachinePick | null;
  locked: boolean;
}

export default function RouteStepsEditor(p: Props) {
  const [adding, setAdding] = useState(false);
  const seq = useRef(0);
  const firms = useFirms(p.steps);
  const stations = useMemo(() => stationsFromRoutes(p.routes), [p.routes]);
  const kursunKey = p.steps.find((s) => isKursunStation(s.station))?.key ?? null;
  const can = p.editable && !p.locked;
  const change = (next: EditStep[]) => p.onChange(next);

  return (
    <View style={styles.root} testID="ie-rota-adimlari">
      <View style={styles.head}>
        <View style={styles.grow}>
          <FieldCaption label="Rota adımları" testID="ie-serit-adimlar" />
        </View>
        {p.edited && can && (
          <Button mode="text" onPress={() => p.onChange(null)} contentStyle={styles.btn} testID="ie-adim-sablona-don">
            Şablona dön
          </Button>
        )}
      </View>
      {/* Değişmemiş şablonda açıklama yok (sade form); değiştirilince bunun kayda gideceği söylenir. */}
      {p.edited && (
        <Text style={styles.hint} testID="ie-adim-ipucu">
          {`Adımları değiştirdiniz; ${TERIM.terbiyeIsEmri.tekilKucuk} bu adımlarla açılır.`}
        </Text>
      )}
      {p.steps.map((s, i) => (
        <View key={s.key} style={styles.step} testID={`ie-adim-${i + 1}`}>
          <View style={styles.stepHead}>
            <TruncatedText style={styles.stepTitle} testID={`ie-adim-${i + 1}-ad`}>{`${i + 1}. ${s.station?.name ?? 'İstasyon'}`}</TruncatedText>
            {can && (
              <View style={styles.actions}>
                <IconButton icon="arrow-up" size={26} style={styles.icon} disabled={i === 0} onPress={() => change(moveStep(p.steps, s.key, -1))} accessibilityLabel={`${i + 1}. adımı yukarı taşı`} testID={`ie-adim-${i + 1}-yukari`} />
                <IconButton icon="arrow-down" size={26} style={styles.icon} disabled={i === p.steps.length - 1} onPress={() => change(moveStep(p.steps, s.key, 1))} accessibilityLabel={`${i + 1}. adımı aşağı taşı`} testID={`ie-adim-${i + 1}-asagi`} />
                <IconButton icon="close" size={26} style={styles.icon} onPress={() => change(removeStep(p.steps, s.key))} accessibilityLabel={`${i + 1}. adımı çıkar`} testID={`ie-adim-${i + 1}-cikar`} />
              </View>
            )}
          </View>
          <FirmRow step={s} index={i + 1} firms={firms} editable={can} onPick={(id) => change(patchStep(p.steps, s.key, { plannedSubcontractorId: id }))} />
          {can ? (
            <TextInput value={s.notes} onChangeText={(t) => change(patchStep(p.steps, s.key, { notes: t }))} mode="outlined" dense placeholder="Adım notu (isteğe bağlı)" style={styles.input} testID={`ie-adim-${i + 1}-not`} />
          ) : s.notes ? (
            <Text style={styles.hint}>{s.notes}</Text>
          ) : null}
          {s.key === kursunKey && p.machine && (
            <MachineChips list={p.machine.list} value={p.machine.value} locked={p.locked} label="Makine seç" testID="ie-form-makine" onChange={p.machine.onChange} />
          )}
        </View>
      ))}
      {can && (
        <Button mode="outlined" icon="plus" onPress={() => setAdding(true)} contentStyle={styles.btn} style={styles.add} testID="ie-adim-ekle">
          Adım ekle
        </Button>
      )}
      <PickerModal
        visible={adding}
        title="Adım ekle — istasyon"
        options={stations.map((x) => ({ value: x.id, label: x.name, sublabel: x.defaultCategory ? `Fason: ${x.defaultCategory.name}` : undefined }))}
        loading={p.routesLoading}
        onSelect={(id) => {
          setAdding(false);
          const st = stations.find((x) => x.id === id);
          seq.current += 1;
          if (st) change(addStep(p.steps, st, `n${seq.current}`));
        }}
        onDismiss={() => setAdding(false)}
        emptyText="Rota şablonlarında istasyon yok."
      />
    </View>
  );
}

type FirmsByCategory = { byCategory: Map<string, { id: string; name: string; isFavorite?: boolean }[]>; nameById: Map<string, string> };

/** Fason firmaları (Hızlı İE ile aynı liste); yalnız fason adım varken çekilir. */
function useFirms(steps: readonly EditStep[]): FirmsByCategory {
  const enabled = steps.some((s) => stepCategoryId(s) !== null);
  const q = useQuery({
    queryKey: ['subcontractors', 'wo-favorites'],
    queryFn: () => subcontractorService.listSubcontractors({ page: 1, pageSize: 500, sortBy: 'name', sortOrder: 'asc', filters: { isActive: 'true' } }),
    enabled,
    staleTime: 10 * 60 * 1000,
  });
  return useMemo(() => {
    const byCategory = new Map<string, { id: string; name: string; isFavorite?: boolean }[]>();
    const nameById = new Map<string, string>();
    for (const s of q.data?.data ?? []) {
      nameById.set(s.id, s.name);
      for (const c of s.categories ?? []) byCategory.set(c.categoryId, [...(byCategory.get(c.categoryId) ?? []), { id: s.id, name: s.name, isFavorite: s.isFavorite }]);
    }
    return { byCategory, nameById };
  }, [q.data]);
}

function FirmRow(p: { step: EditStep; index: number; firms: FirmsByCategory; editable: boolean; onPick: (id: string | null) => void }) {
  const cat = stepCategoryId(p.step);
  if (!cat) return null;
  const options = p.firms.byCategory.get(cat) ?? [];
  const current = p.step.plannedSubcontractorId;
  const catName = p.step.station?.defaultCategory?.name;
  if (!p.editable) {
    return <TruncatedText style={styles.hint}>{`Fason${catName ? ` (${catName})` : ''}: ${current ? p.firms.nameById.get(current) ?? 'firma seçili' : 'firma seçilmedi'}`}</TruncatedText>;
  }
  return (
    <View style={styles.firms} testID={`ie-adim-${p.index}-firma`}>
      <TruncatedText style={styles.hint}>{`Fason firma${catName ? ` (${catName})` : ''}`}</TruncatedText>
      <View style={styles.chips}>
        <Chip selected={!current} onPress={() => p.onPick(null)} style={styles.chip} testID={`ie-adim-${p.index}-firma-yok`}>
          Seçilmedi
        </Chip>
        {options.map((f) => (
          <Chip key={f.id} selected={current === f.id} onPress={() => p.onPick(f.id)} style={styles.chip} testID={`ie-adim-${p.index}-firma-${f.id}`}>
            {`${f.isFavorite ? '★ ' : ''}${f.name}`}
          </Chip>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  grow: { flex: 1 },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary },
  step: { gap: spacing.xs, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  stepHead: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  stepTitle: { flex: 1, minWidth: 160, fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  actions: { flexDirection: 'row' },
  icon: { width: 56, height: 56, margin: 0 },
  input: { backgroundColor: colors.surface },
  firms: { gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 56, justifyContent: 'center', alignSelf: 'flex-start' },
  btn: { minHeight: 56 },
  add: { alignSelf: 'flex-start' },
});
