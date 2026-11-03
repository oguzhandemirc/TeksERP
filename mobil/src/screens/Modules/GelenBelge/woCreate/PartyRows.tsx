// Çok partili belge (S1): "Bu belgede N parti var" — parti no + metre düzenlenir, sunucunun canlı uyarıları gösterilir,
// "Her parti ayrı iş emri | Tek iş emri" seçimi (varsayılan fabrika ayarı). Tek partili belgede çizilmez.
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip, Text, TextInput } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import NumpadInput from '../../../../components/NumpadInput';
import { inboundDocService } from '../../../../services/inboundDoc.service';
import { colors, spacing, typography } from '../../../../theme';
import { parseMeters } from '../approvalGate';
import { MODE_LABELS, type MultiPartyDraft, type PartyRow } from './partyDraft';
import type { DocRow, WoRowsState } from './useWoRows';

/** Parti özeti `gelen-belge:read` ister; izin yoksa / düşerse satır tek partili kalır (bugünkü form). */
export function useRowParties(row: DocRow, wo: WoRowsState, enabled: boolean): void {
  const q = useQuery({
    queryKey: ['gelen-belge', 'partiler', row.noteId, row.runKey],
    queryFn: () => inboundDocService.noteParties(row.noteId),
    enabled: enabled && !!row.form,
    retry: false,
  });
  const { setParties } = wo;
  useEffect(() => {
    if (q.isSuccess) setParties(row.noteId, q.data);
    else if (q.isError) setParties(row.noteId, null);
  }, [q.isSuccess, q.isError, q.data, row.noteId, setParties]);
}

export default function PartyRows({ row, wo, locked }: { row: DocRow; wo: WoRowsState; locked: boolean }) {
  const m = row.form?.multi;
  const view = row.parties;
  if (!m || !view) return null;
  const set = (next: MultiPartyDraft) => wo.setMulti(row.noteId, next);
  const setRow = (blockNo: number, patch: Partial<PartyRow>) => set({ ...m, rows: m.rows.map((r) => (r.blockNo === blockNo ? { ...r, ...patch } : r)) });
  return (
    <View style={styles.box} testID={`belge-partiler-${row.noteNo}`}>
      <Text style={styles.title}>{`Bu belgede ${m.rows.length} parti var`}</Text>
      {m.rows.map((r) => {
        const p = view.parties.find((x) => x.blockNo === r.blockNo);
        return (
          <View key={r.blockNo} style={styles.party} testID={`belge-parti-${row.noteNo}-${r.blockNo}`}>
            <Text style={styles.label}>
              {`${r.blockNo}. parti · ${p ? `${p.lineCount} satır${p.declaredTopCount !== null ? ` / ${p.declaredTopCount} TOP` : ''}` : ''}${p?.orderNo ? ` · Sipariş ${p.orderNo}` : ''}`}
            </Text>
            <View style={styles.row}>
              <TextInput mode="outlined" label="Parti no" value={r.batchNo} disabled={locked} style={styles.input}
                onChangeText={(t) => setRow(r.blockNo, { batchNo: t })} testID={`belge-parti-no-${row.noteNo}-${r.blockNo}`} />
              <MeterInput initial={r.meters} locked={locked} onChange={(meters) => setRow(r.blockNo, { meters })} testID={`belge-parti-metre-${row.noteNo}-${r.blockNo}`} />
            </View>
            {p?.warnings.map((w) => <Text key={w} style={styles.warn}>• {w}</Text>)}
          </View>
        );
      })}
      {view.warnings.map((w) => <Text key={w} style={styles.warn}>• {w}</Text>)}
      <View style={styles.chips}>
        {(['PER_PARTY', 'SINGLE'] as const).map((k) => (
          <Chip key={k} selected={m.mode === k} onPress={() => set({ ...m, mode: k })} disabled={locked} style={styles.chip} testID={`belge-parti-kip-${row.noteNo}-${k}`}>
            {MODE_LABELS[k]}
          </Chip>
        ))}
      </View>
    </View>
  );
}

/** Metin yerelde tutulur ("198," yazarken sayıya çevrilip silinmesin); sayı her tuşta üst forma gider. */
function MeterInput({ initial, locked, onChange, testID }: { initial: number | null; locked: boolean; onChange: (m: number | null) => void; testID: string }) {
  const [text, setText] = useState(initial !== null ? String(initial).replace('.', ',') : '');
  return (
    <View style={styles.input}>
      <NumpadInput value={text} label="Metre" mode="outlined" useNativeKeyboard allowDecimal editable={!locked} testID={testID}
        onChangeText={(t) => { setText(t); onChange(parseMeters(t)); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.sm },
  title: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: colors.text },
  party: { gap: spacing.xs },
  label: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  input: { flex: 1, minWidth: 160 },
  warn: { fontSize: typography.size.sm, color: colors.warningText },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 56, justifyContent: 'center' },
});
