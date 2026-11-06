// Çok partili belge (S1): "Bu belgede N parti var" — parti no + metre düzenlenir, sunucunun canlı uyarıları gösterilir,
// "Her parti ayrı iş emri | Tek iş emri" seçimi (fabrika varsayılanı "her parti ayrı" ise seçim yok, K1). Tek partili belgede çizilmez.
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip, Icon, Text, TextInput } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import NumpadInput from '../../../../components/NumpadInput';
import { inboundDocService } from '../../../../services/inboundDoc.service';
import { colors, radius, spacing, typography } from '../../../../theme';
import { TERIM } from '../../../../lib/terim';
import { parseMeters } from '../approvalGate';
import { MODE_LABELS, partyFacts, partyHeading, partyOutcome, partyResultSummary, showModeChoice, type MultiPartyDraft, type PartyOutcome, type PartyRow } from './partyDraft';
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
  const result = row.result?.kind === 'OPENED' ? row.result : null;
  return (
    <View style={styles.box} testID={`belge-partiler-${row.noteNo}`}>
      <Text style={styles.title}>{`Bu belgede ${m.rows.length} parti var`}</Text>
      <ResultSummary text={partyResultSummary(result, m.rows.map((r) => r.blockNo))} testID={`belge-parti-ozet-${row.noteNo}`} />
      {m.rows.map((r) => {
        const p = view.parties.find((x) => x.blockNo === r.blockNo);
        const out = partyOutcome(result, r.blockNo);
        // Açılan partinin İE'si yeniden gönderimde sunucuda yeniden açılmaz; alanları kilitlenir.
        const partyLocked = locked || out?.kind === 'OPENED';
        return (
          <View key={r.blockNo} style={[styles.party, out?.kind === 'OPENED' && styles.partyOk, out?.kind === 'FAILED' && styles.partyFail]}
            testID={`belge-parti-${row.noteNo}-${r.blockNo}`} accessibilityLabel={partyHeading(r.blockNo, p)}>
            <Text style={styles.partyTitle}>{`${r.blockNo}. parti`}</Text>
            <View style={styles.facts}>
              {partyFacts(p).map((f) => (
                <View key={f} style={styles.fact}>
                  <Text style={styles.factText}>{f}</Text>
                </View>
              ))}
            </View>
            <View style={styles.row}>
              <TextInput mode="outlined" label="Parti no" value={r.batchNo} disabled={partyLocked} style={styles.input}
                onChangeText={(t) => setRow(r.blockNo, { batchNo: t })} testID={`belge-parti-no-${row.noteNo}-${r.blockNo}`} />
              <MeterInput initial={r.meters} locked={partyLocked} onChange={(meters) => setRow(r.blockNo, { meters })} testID={`belge-parti-metre-${row.noteNo}-${r.blockNo}`} />
            </View>
            {p?.warnings.map((w) => <Text key={w} style={styles.warn}>• {w}</Text>)}
            <OutcomeLine out={out} testID={`belge-parti-sonuc-${row.noteNo}-${r.blockNo}`} />
          </View>
        );
      })}
      {view.warnings.map((w) => <Text key={w} style={styles.warn}>• {w}</Text>)}
      {showModeChoice(view) && (
        <View style={styles.chips}>
          {(['PER_PARTY', 'SINGLE'] as const).map((k) => (
            <Chip key={k} selected={m.mode === k} onPress={() => set({ ...m, mode: k })} disabled={locked || !!result} style={styles.chip} testID={`belge-parti-kip-${row.noteNo}-${k}`}>
              {MODE_LABELS[k]}
            </Chip>
          ))}
        </View>
      )}
    </View>
  );
}

function OutcomeLine({ out, testID }: { out: PartyOutcome; testID: string }) {
  if (!out) return null;
  const ok = out.kind === 'OPENED';
  return (
    <View style={styles.outcome}>
      <Icon source={ok ? 'check-circle' : 'alert-circle'} size={22} color={ok ? colors.successDark : colors.danger} />
      <Text style={ok ? styles.ok : styles.fail} testID={testID}>
        {ok ? `${TERIM.terbiyeIsEmri.tekil} açıldı: ${out.workOrderNo}` : `Açılamadı: ${out.message}`}
      </Text>
    </View>
  );
}

/** Kısmi başarıda kartın tepesinde tek cümle: kaç parti açıldı, kaçı bekliyor, ne yapılacak. */
function ResultSummary({ text, testID }: { text: string | null; testID: string }) {
  if (!text) return null;
  return (
    <View style={styles.summary} testID={testID}>
      <Icon source="alert" size={22} color={colors.warningDark} />
      <Text style={styles.summaryText}>{text}</Text>
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
  party: { gap: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  partyOk: { borderColor: colors.success, backgroundColor: colors.successContainer },
  partyFail: { borderWidth: 2, borderColor: colors.danger },
  partyTitle: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text },
  // Künye parçaları ayrı kutularda: dar ekranda parça sınırında kırılır, "İşlem: …" kendi içinde sarar.
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  // Kutu View'da: Android'de yüzde maxWidth'li arka planlı Text yanlış yükseklik ölçüyor.
  fact: { backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2, maxWidth: '100%' },
  factText: { fontSize: typography.size.sm, color: colors.text },
  outcome: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  summary: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.warningContainer, borderRadius: radius.md, padding: spacing.md },
  summaryText: { flex: 1, fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  input: { flex: 1, minWidth: 160 },
  warn: { fontSize: typography.size.sm, color: colors.warningText },
  ok: { flex: 1, fontSize: typography.size.base, color: colors.successText, fontWeight: typography.weight.semibold },
  fail: { flex: 1, fontSize: typography.size.base, color: colors.dangerText, fontWeight: typography.weight.semibold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 56, justifyContent: 'center' },
});
