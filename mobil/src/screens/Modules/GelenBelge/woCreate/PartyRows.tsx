// Çok partili belge (S1): "Bu belgede N parti var" — parti no + metre düzenlenir, sunucunun canlı uyarıları gösterilir,
// "Her parti ayrı iş emri | Tek iş emri" seçimi (varsayılan "her parti ayrı" ise seçim yok, K1 — belge şeridinin "Bu sefer değiştir"i açar). Tek partili belgede çizilmez.
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip, Icon, Text, TextInput } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import NumpadInput from '../../../../components/NumpadInput';
import { inboundDocService } from '../../../../services/inboundDoc.service';
import { colors, radius, spacing, typography } from '../../../../theme';
import { TERIM } from '../../../../lib/terim';
import { parseMeters } from '../approvalGate';
import { chooseMode, MODE_LABELS, partyFacts, partyHeading, partyOutcome, partyResultSummary, showModeChoice, type MultiPartyDraft, type PartyOutcome, type PartyRow } from './partyDraft';
import type { DocRow, WoRowsState } from './useWoRows';
import PartyPlanFields from './PartyPlanFields';
import type { PartyPlanCtx } from './partyPlan';
import type { NoteParty } from '../../../../services/inboundDoc.service';
import { partyLock, partyTabs, showPartyTabs, STATUS_MARK } from './partyTabs';
import { usePartyTabState } from './partyTabStore';
import { PartyAllTable, PartyLockNote, PartyTabStrip } from './PartyTabBar';
import { OurBatchAutoField, useOurBatchPreview } from './DocRowBatchFields';
import { batchPreviewPlan } from './ourBatchPreview';

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

/**
 * `plan`: tek İE formunda "her parti ayrı" kipinde parti başına gramaj + makine (belge masası kendi plan bölümünde çizer).
 * ≥2 partide sekmeler (2026-11-09): ortak satırlar (özet, kip, belge uyarıları, kilit notu) üstte; "Tümü" tablosu + parti
 * başına sekme. Bütün parti panoları bağlı kalır (gizli olan `display:none`) — yazılmakta olan metre metni sekme geçişinde kaybolmaz.
 */
export default function PartyRows({ row, wo, locked, plan }: { row: DocRow; wo: WoRowsState; locked: boolean; plan?: PartyPlanCtx | null }) {
  const m = row.form?.multi;
  const view = row.parties;
  const [tabState, select] = usePartyTabState(row.noteId);
  // Seri kipinde PER_PARTY: açılmamış partiler sırayla numara alır (sekme başına X, X+1…); SINGLE: tek İE → tek numara.
  const result = row.result?.kind === 'OPENED' ? row.result : null;
  const serial = wo.batchSource !== 'DOCUMENT';
  const pending = (m?.rows ?? []).filter((r) => partyOutcome(result, r.blockNo)?.kind !== 'OPENED').map((r) => r.blockNo);
  const batchPlan = batchPreviewPlan(m?.mode ?? 'SINGLE', pending);
  const preview = useOurBatchPreview(batchPlan.count, serial && !!view && !locked);
  if (!m || !view) return null;
  const set = (next: MultiPartyDraft) => wo.setMulti(row.noteId, next);
  const setRow = (blockNo: number, patch: Partial<PartyRow>) => set({ ...m, rows: m.rows.map((r) => (r.blockNo === blockNo ? { ...r, ...patch } : r)) });
  const outcome = (blockNo: number) => partyOutcome(result, blockNo);
  const tabbed = showPartyTabs(m);
  const tabs = partyTabs(m, tabState.visited, outcome);
  const active = tabbed && tabs.some((t) => t.blockNo === tabState.active) ? tabState.active : 'all';
  const pane = (r: PartyRow) => (
    <PartyPane key={r.blockNo} r={r} p={view.parties.find((x) => x.blockNo === r.blockNo)} out={outcome(r.blockNo)} noteNo={row.noteNo} locked={locked} plan={plan}
      problems={tabbed ? tabs.find((t) => t.blockNo === r.blockNo)?.problems ?? [] : []} hidden={tabbed && active !== r.blockNo} onChange={(patch) => setRow(r.blockNo, patch)}
      ourBatch={serial && batchPlan.perParty && pending.includes(r.blockNo) ? { code: preview[pending.indexOf(r.blockNo)] } : null} />
  );
  return (
    <View style={styles.box} testID={`belge-partiler-${row.noteNo}`}>
      <Text style={styles.title}>{`Bu belgede ${m.rows.length} parti var`}</Text>
      <ResultSummary text={partyResultSummary(result, m.rows.map((r) => r.blockNo))} testID={`belge-parti-ozet-${row.noteNo}`} />
      {serial && !batchPlan.perParty && batchPlan.count > 0 && <OurBatchAutoField code={preview[0]} testID={`belge-parti-bizim-tek-${row.noteNo}`} />}
      {tabbed && <PartyLockNote locks={partyLock(tabs)} onSelect={select} testID={`belge-parti-kilit-${row.noteNo}`} />}
      {tabbed && <PartyTabStrip tabs={tabs} active={active} onSelect={select} testID={`belge-parti-sekme-${row.noteNo}`} />}
      {tabbed && active === 'all' && (
        <PartyAllTable tabs={tabs} rows={m.rows} parties={view.parties} outcome={outcome} onSelect={select} testID={`belge-parti-tablo-${row.noteNo}`} />
      )}
      {m.rows.map(pane)}
      {view.warnings.map((w) => <Text key={w} style={styles.warn}>• {w}</Text>)}
      {(showModeChoice(view) || m.modeTouched) && (
        <View style={styles.chips}>
          {(['PER_PARTY', 'SINGLE'] as const).map((k) => (
            <Chip key={k} selected={m.mode === k} onPress={() => set(chooseMode(m, k))} disabled={locked || !!result} style={styles.chip} testID={`belge-parti-kip-${row.noteNo}-${k}`}>
              {MODE_LABELS[k]}
            </Chip>
          ))}
        </View>
      )}
    </View>
  );
}

interface PaneProps {
  r: PartyRow;
  p: NoteParty | undefined;
  out: PartyOutcome;
  noteNo: string;
  locked: boolean;
  plan?: PartyPlanCtx | null;
  /** Sekmeli görünümde partiyi kilitleyen eksikler (⚠). */
  problems: readonly string[];
  hidden: boolean;
  onChange: (patch: Partial<PartyRow>) => void;
  /** Seri kipinde açılmamış parti: bizim parti no tahmini (yoksa `null` → alan çizilmez). */
  ourBatch: { code: string | undefined } | null;
}

/** Tek partinin alanları: künye (top, müşteri İE no…), parti no, gelen metre, plan, sunucu uyarıları (beyan ↔ okunan), sonuç. */
function PartyPane({ r, p, out, noteNo, locked, plan, problems, hidden, onChange, ourBatch }: PaneProps) {
  // Açılan partinin İE'si yeniden gönderimde sunucuda yeniden açılmaz; alanları kilitlenir.
  const partyLocked = locked || out?.kind === 'OPENED';
  return (
    <View style={[styles.party, out?.kind === 'OPENED' && styles.partyOk, out?.kind === 'FAILED' && styles.partyFail, hidden && styles.hidden]}
      testID={`belge-parti-${noteNo}-${r.blockNo}`} accessibilityLabel={partyHeading(r.blockNo, p)}>
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
          onChangeText={(t) => onChange({ batchNo: t })} testID={`belge-parti-no-${noteNo}-${r.blockNo}`} />
        <MeterInput initial={r.meters} locked={partyLocked} onChange={(meters) => onChange({ meters })} testID={`belge-parti-metre-${noteNo}-${r.blockNo}`} />
        <MeterInput initial={r.incomingKg ?? null} label="Gelen kg" locked={partyLocked} onChange={(incomingKg) => onChange({ incomingKg, kgEdited: true })} testID={`belge-parti-kg-${noteNo}-${r.blockNo}`} />
      </View>
      {ourBatch && <OurBatchAutoField code={ourBatch.code} testID={`belge-parti-bizim-${noteNo}-${r.blockNo}`} />}
      {problems.map((x) => <Text key={x} style={styles.problem} testID={`belge-parti-eksik-${noteNo}-${r.blockNo}`}>{`${STATUS_MARK.error} ${x}`}</Text>)}
      {plan && <PartyPlanFields ctx={plan} party={r} locked={partyLocked} noteNo={noteNo} onChange={onChange} />}
      {p?.warnings.map((w) => <Text key={w} style={styles.warn}>• {w}</Text>)}
      <OutcomeLine out={out} testID={`belge-parti-sonuc-${noteNo}-${r.blockNo}`} />
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
function MeterInput({ initial, label = 'Metre', locked, onChange, testID }: { initial: number | null; label?: string; locked: boolean; onChange: (m: number | null) => void; testID: string }) {
  const [text, setText] = useState(initial !== null ? String(initial).replace('.', ',') : '');
  return (
    <View style={styles.input}>
      <NumpadInput value={text} label={label} mode="outlined" useNativeKeyboard allowDecimal editable={!locked} testID={testID}
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
  problem: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.warningText },
  hidden: { display: 'none' },
  ok: { flex: 1, fontSize: typography.size.base, color: colors.successText, fontWeight: typography.weight.semibold },
  fail: { flex: 1, fontSize: typography.size.base, color: colors.dangerText, fontWeight: typography.weight.semibold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 56, justifyContent: 'center' },
});
