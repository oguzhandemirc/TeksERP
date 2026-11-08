// Belge önizlemesinin parti bölmesi (2026-11-09): İE formuyla AYNI sekmeler (durum + "bakıldı" ortak, `partyTabStore`).
// Parti sekmesi: partinin alanları + top satırları + beyan ↔ okunan uyuşmazlığı; fotoğraf o partinin satırlarına odaklanır.
// Tek partili belgede (ya da parti özeti yokken) null → önizleme bugünkü gibi yalnız fotoğraf.
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { colors, spacing, typography } from '../../../../theme';
import { fmtMeters } from '../../../../utils/meters';
import type { PreviewFocus } from '../PagePreviewModal';
import { partyFacts, partyOutcome } from './partyDraft';
import { partyFocus, partyLines } from './partyReview';
import { partyLock, partyTabs, showPartyTabs, STATUS_MARK, type PartyTabKey } from './partyTabs';
import { usePartyTabState } from './partyTabStore';
import { PartyAllTable, PartyLockNote, PartyTabStrip } from './PartyTabBar';
import type { DocRow } from './useWoRows';

export function usePartyScanReview(row: DocRow | null, pages: readonly { sha256: string }[], onPage: (i: number) => void): { side: React.ReactNode; focus: PreviewFocus | null } | null {
  const [tab, select] = usePartyTabState(row?.noteId ?? '');
  const m = row?.form?.multi;
  const view = row?.parties;
  if (!row || !m || !view || !showPartyTabs(m)) return null;
  const result = row.result?.kind === 'OPENED' ? row.result : null;
  const outcome = (b: number) => partyOutcome(result, b);
  const tabs = partyTabs(m, tab.visited, outcome);
  const active = tabs.some((t) => t.blockNo === tab.active) ? tab.active : 'all';
  const lines = row.detail?.lines;
  const focusOf = (b: number) => partyFocus(partyLines(lines, b), row.detail?.scans, pages);
  const go = (k: PartyTabKey) => {
    select(k);
    const f = k === 'all' ? null : focusOf(k);
    if (f) onPage(f.pageIndex);
  };
  const f = active === 'all' ? null : focusOf(active);
  const focus = f ? { key: `${row.noteId}:${active}`, rect: f.rect, frame: f.frame } : null;
  const id = `belge-onizleme-parti-${row.noteNo}`;
  const side = (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" testID={id}>
      <PartyLockNote locks={partyLock(tabs)} onSelect={go} testID={`${id}-kilit`} />
      <PartyTabStrip tabs={tabs} active={active} onSelect={go} testID={`${id}-sekme`} />
      {active === 'all' ? (
        <PartyAllTable tabs={tabs} rows={m.rows} parties={view.parties} outcome={outcome} onSelect={go} testID={`${id}-tablo`} />
      ) : (
        <PartyDetail row={row} blockNo={active} problems={tabs.find((t) => t.blockNo === active)?.problems ?? []} testID={`${id}-${active}`} />
      )}
    </ScrollView>
  );
  return { side, focus };
}

function PartyDetail({ row, blockNo, problems, testID }: { row: DocRow; blockNo: number; problems: readonly string[]; testID: string }) {
  const r = row.form?.multi?.rows.find((x) => x.blockNo === blockNo);
  const p = row.parties?.parties.find((x) => x.blockNo === blockNo);
  const lines = partyLines(row.detail?.lines, blockNo);
  return (
    <View style={styles.detail} testID={testID}>
      <Field label="Parti no" value={r?.batchNo.trim() || '—'} />
      <Field label="Gelen metre" value={r?.meters != null ? `${fmtMeters(r.meters)} m` : '—'} />
      <View style={styles.facts}>
        {partyFacts(p).map((x) => <Text key={x} style={styles.fact}>{x}</Text>)}
      </View>
      {problems.map((x) => <Text key={x} style={styles.problem}>{`${STATUS_MARK.error} ${x}`}</Text>)}
      {/* Bölüm beyanı ↔ okunan toplam (top adedi / ara toplam) uyuşmazlığı sunucudan, partinin kendi sekmesinde. */}
      {p?.warnings.map((w) => <Text key={w} style={styles.warn} testID={`${testID}-uyari`}>• {w}</Text>)}
      {lines.length > 0 && (
        <View style={styles.table} testID={`${testID}-toplar`}>
          <View style={styles.tr}>
            <Text style={[styles.td, styles.th]}>Sıra</Text>
            <Text style={[styles.td, styles.th]}>Top no</Text>
            <Text style={[styles.td, styles.th]}>Metre</Text>
            <Text style={[styles.td, styles.th]}>Kg</Text>
          </View>
          {lines.map((l, i) => (
            <View key={l.id} style={styles.tr}>
              <Text style={styles.td}>{String(i + 1)}</Text>
              <Text style={styles.td}>{l.senderRollNo ?? '—'}</Text>
              <Text style={styles.td}>{l.meters}</Text>
              <Text style={styles.td}>{l.weightKg ?? '—'}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.md, gap: spacing.sm },
  detail: { gap: spacing.sm },
  field: { gap: 2 },
  label: { fontSize: typography.size.sm, color: colors.textSecondary },
  value: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, color: colors.text },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  fact: { fontSize: typography.size.sm, color: colors.text, backgroundColor: colors.surfaceMuted, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  problem: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.warningText },
  warn: { fontSize: typography.size.sm, color: colors.warningText },
  table: { borderTopWidth: 1, borderTopColor: colors.border },
  tr: { flexDirection: 'row', minHeight: 40, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  td: { flex: 1, fontSize: typography.size.base, color: colors.text },
  th: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold },
});
