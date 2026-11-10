// Çok partili belge (S1): "Bu belgede N parti var" — parti no + metre düzenlenir, sunucunun canlı uyarıları gösterilir,
// kip seçimi burada YOK — belge şeridinin "Değiştir" düğmesi tek yol (2026-11-10, çift yol kaldırıldı). Tek partili belgede çizilmez.
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { inboundDocService } from '../../../../services/inboundDoc.service';
import { colors, radius, spacing, typography } from '../../../../theme';
import { TERIM } from '../../../../lib/terim';
import { parseMeters } from '../approvalGate';
import { fmtKursunMeters } from '../readResult';
import { DeclaredEditSheet, DeclaredField, declaredLayout } from './DeclaredField';
import { docIncomingWidth } from './woFromDoc';
import { PartyDeclaredRow } from './DocRowDeclaredText';
import { partyFacts, partyMeters, partyHeading, partyOutcome, partyResultSummary, type MultiPartyDraft, type PartyOutcome, type PartyRow } from './partyDraft';
import type { DocRow, WoRowsState } from './useWoRows';
import PartyPlanFields from './PartyPlanFields';
import type { PartyPlanCtx } from './partyPlan';
import type { NoteParty } from '../../../../services/inboundDoc.service';
import { partyLock, partyTabs, showPartyTabs, STATUS_MARK } from './partyTabs';
import { usePartyTabState } from './partyTabStore';
import { PartyAllTable, PartyLockNote, PartyTabStrip } from './PartyTabBar';
import { OurBatchAutoField, useOurBatchPreview } from './DocRowBatchFields';
import { batchPreviewPlan } from './ourBatchPreview';
import { useIncomingShown } from './useIncomingShown';

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
  const docWidth = docIncomingWidth(row.detail);
  const pane = (r: PartyRow) => (
    <PartyPane key={r.blockNo} r={r} docWidth={docWidth} detail={row.detail} p={view.parties.find((x) => x.blockNo === r.blockNo)} out={outcome(r.blockNo)} noteNo={row.noteNo} locked={locked} plan={plan}
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
    </View>
  );
}

interface PaneProps {
  r: PartyRow;
  /** Belgenin okunan eni (cm; belge geneli) — partide elle düzeltilmediyse gösterilir. */
  docWidth: number | null;
  detail: DocRow['detail'];
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
function PartyPane({ r, docWidth, detail, p, out, noteNo, locked, plan, problems, hidden, onChange, ourBatch }: PaneProps) {
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
      <PartyDeclared r={r} p={p} docWidth={docWidth} noteNo={noteNo} locked={partyLocked} onChange={onChange} />
      <PartyDeclaredRow r={r} p={p} detail={detail} noteNo={noteNo} locked={partyLocked} onChange={onChange} />
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

type PartyEdit = 'no' | 'metre' | 'kg' | 'en' | null;
const UNIT = { metre: 'm', kg: 'kg', en: 'cm' } as const;
const numText = (n: number | null | undefined) => (n != null ? String(n).replace('.', ',') : '');
const fmt = (n: number | null | undefined) => (n != null ? fmtKursunMeters(n) : null);

/** Partinin beyan kutuları (tek partili formla aynı `DeclaredField`): parti no · metre · gelen kg · gelen en; sarı = belgeden. */
function PartyDeclared({ r, p, docWidth, noteNo, locked, onChange }: { r: PartyRow; p: NoteParty | undefined; docWidth: number | null; noteNo: string; locked: boolean; onChange: (patch: Partial<PartyRow>) => void }) {
  const [edit, setEdit] = useState<PartyEdit>(null);
  const shown = useIncomingShown();
  const id = `${noteNo}-${r.blockNo}`;
  const docMeters = p ? partyMeters(p) : null;
  const docKg = p?.suggestedKg != null && p.suggestedKg > 0 ? p.suggestedKg : null;
  const width = r.widthEdited ? r.incomingWidth ?? null : docWidth;
  const close = () => setEdit(null);
  const save = (patch: Partial<PartyRow>) => { close(); onChange(patch); };
  const docOf = { metre: docMeters, kg: docKg, en: docWidth };
  const num = (key: 'metre' | 'kg' | 'en', title: string, initial: number | null, apply: (n: number | null) => Partial<PartyRow>) => (
    <DeclaredEditSheet title={`${r.blockNo}. parti · ${title}`} subtitle={docOf[key] != null ? `Belgede: ${fmt(docOf[key])} ${UNIT[key]}` : 'Belgede yok'} kind="number" label={title}
      initial={numText(initial)} allowEmpty={key !== 'metre'} parse={parseMeters} onDismiss={close} testID={`belge-parti-${key}-duzelt-${id}`}
      onSave={(t) => save(apply(parseMeters(t)))} />
  );
  return (
    <View style={declaredLayout.row}>
      <DeclaredField label="Parti no" value={r.batchNo || null} fromDoc={!!r.batchNo && r.batchNo === (p?.batchNo ?? '')} emptyText="Yok — dokunun"
        onPress={() => setEdit('no')} disabled={locked} testID={`belge-parti-no-${id}`} />
      <DeclaredField label="Metre" value={fmt(r.meters)} unit="m" fromDoc={r.meters != null && r.meters === docMeters} missing={r.meters == null} emptyText="Yok — dokunun"
        onPress={() => setEdit('metre')} disabled={locked} testID={`belge-parti-metre-${id}`} />
      {shown('kg') && <DeclaredField label="Gelen kg" value={fmt(r.incomingKg)} unit="kg" fromDoc={!r.kgEdited && r.incomingKg != null && r.incomingKg === docKg} emptyText="Belgede yok"
        onPress={() => setEdit('kg')} disabled={locked} testID={`belge-parti-kg-${id}`} />}
      {shown('width') && <DeclaredField label="Gelen en" value={fmt(width)} unit="cm" fromDoc={!r.widthEdited && docWidth != null} emptyText="Belgede yok"
        onPress={() => setEdit('en')} disabled={locked} testID={`belge-parti-en-${id}`} />}
      {edit === 'no' && (
        <DeclaredEditSheet title={`${r.blockNo}. parti · Parti no`} kind="text" label="Parti no" maxLength={64} initial={r.batchNo} allowEmpty onDismiss={close}
          testID={`belge-parti-no-duzelt-${id}`} onSave={(t) => save({ batchNo: t.trim() })} />
      )}
      {edit === 'metre' && num('metre', 'Metre', r.meters, (meters) => ({ meters }))}
      {/* Boş kaydetmek belgedekine döner (sunucu da anahtarsız gövdede öneriyi yazar). */}
      {edit === 'kg' && num('kg', 'Gelen kg', r.incomingKg ?? null, (n) => (n == null || n === docKg ? { incomingKg: docKg, kgEdited: false } : { incomingKg: n, kgEdited: true }))}
      {edit === 'en' && num('en', 'Gelen en (cm)', width, (n) => (n == null || n === docWidth ? { incomingWidth: null, widthEdited: false } : { incomingWidth: n, widthEdited: true }))}
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
  warn: { fontSize: typography.size.sm, color: colors.warningText },
  problem: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.warningText },
  hidden: { display: 'none' },
  ok: { flex: 1, fontSize: typography.size.base, color: colors.successText, fontWeight: typography.weight.semibold },
  fail: { flex: 1, fontSize: typography.size.base, color: colors.dangerText, fontWeight: typography.weight.semibold },
});
