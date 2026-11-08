// Çok partili belgenin sekme parçaları (İE formu + belge önizlemesi ortak): sekme şeridi ("Tümü" + parti başına, durum
// işaretli), "Tümü" tablosu (satıra dokun → o partinin sekmesi) ve kilit notu (hangi parti, neden).
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { colors, radius, spacing, typography } from '../../../../theme';
import { fmtMeters } from '../../../../utils/meters';
import type { NoteParty } from '../../../../services/inboundDoc.service';
import type { PartyOutcome, PartyRow } from './partyDraft';
import { partyLockText, STATUS_MARK, STATUS_TEXT, type PartyTab, type PartyTabKey, type PartyTabStatus } from './partyTabs';

const MARK_COLOR: Record<PartyTabStatus, string> = { error: colors.warningText, ok: colors.successText, unseen: colors.textSecondary };

export function PartyTabStrip({ tabs, active, onSelect, testID }: { tabs: readonly PartyTab[]; active: PartyTabKey; onSelect: (k: PartyTabKey) => void; testID: string }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} keyboardShouldPersistTaps="handled" testID={testID}>
      <TabButton label="Tümü" selected={active === 'all'} onPress={() => onSelect('all')} a11y="Tüm partiler" testID={`${testID}-tumu`} />
      {tabs.map((t) => (
        <TabButton key={t.blockNo} label={t.title} mark={STATUS_MARK[t.status]} markColor={MARK_COLOR[t.status]} selected={active === t.blockNo}
          onPress={() => onSelect(t.blockNo)} a11y={`${t.title}: ${STATUS_TEXT[t.status]}`} testID={`${testID}-${t.blockNo}`} />
      ))}
    </ScrollView>
  );
}

function TabButton({ label, mark, markColor, selected, onPress, a11y, testID }: { label: string; mark?: string; markColor?: string; selected: boolean; onPress: () => void; a11y: string; testID: string }) {
  return (
    <TouchableRipple onPress={onPress} style={[styles.tab, selected && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={a11y} testID={testID}>
      <View style={styles.tabInner}>
        {mark ? <Text style={[styles.mark, { color: markColor }]} testID={`${testID}-durum`}>{mark}</Text> : null}
        <Text style={[styles.tabLabel, selected && styles.tabLabelOn]}>{label}</Text>
      </View>
    </TouchableRipple>
  );
}

interface TableProps {
  tabs: readonly PartyTab[];
  rows: readonly PartyRow[];
  parties: readonly NoteParty[] | undefined;
  outcome: (blockNo: number) => PartyOutcome;
  onSelect: (k: PartyTabKey) => void;
  testID: string;
}

/** "Tümü": parti no · top · metre · durum; satır o partinin sekmesini açar. */
export function PartyAllTable({ tabs, rows, parties, outcome, onSelect, testID }: TableProps) {
  return (
    <View style={styles.table} testID={testID}>
      <View style={[styles.tr, styles.th]}>
        <Text style={[styles.td, styles.wide, styles.thText]}>Parti no</Text>
        <Text style={[styles.td, styles.thText]}>Top</Text>
        <Text style={[styles.td, styles.thText]}>Metre</Text>
        <Text style={[styles.td, styles.wide, styles.thText]}>Durum</Text>
      </View>
      {tabs.map((t) => {
        const r = rows.find((x) => x.blockNo === t.blockNo);
        const p = parties?.find((x) => x.blockNo === t.blockNo);
        const out = outcome(t.blockNo);
        const state = out?.kind === 'OPENED' ? `Açıldı: ${out.workOrderNo}` : out?.kind === 'FAILED' ? 'Açılamadı' : t.problems.length ? t.problems.join(', ') : STATUS_TEXT[t.status];
        return (
          <TouchableRipple key={t.blockNo} onPress={() => onSelect(t.blockNo)} style={styles.trTap} accessibilityRole="button" accessibilityLabel={`${t.title} sekmesini aç`} testID={`${testID}-${t.blockNo}`}>
            <View style={styles.tr}>
              <Text style={[styles.td, styles.wide, styles.strong]}>{t.title}</Text>
              <Text style={styles.td}>{p ? String(p.declaredTopCount ?? p.lineCount) : '—'}</Text>
              <Text style={styles.td}>{r?.meters != null ? fmtMeters(r.meters) : '—'}</Text>
              <Text style={[styles.td, styles.wide, { color: MARK_COLOR[t.status] }]} testID={`${testID}-${t.blockNo}-durum`}>{`${STATUS_MARK[t.status]} ${state}`}</Text>
            </View>
          </TouchableRipple>
        );
      })}
    </View>
  );
}

/** Kayıt kilitliyse hangi partinin neden kilitlediği; dokununca ilk kilitleyen partinin sekmesi açılır. */
export function PartyLockNote({ locks, onSelect, testID }: { locks: readonly PartyTab[]; onSelect: (k: PartyTabKey) => void; testID: string }) {
  const text = partyLockText(locks);
  if (!text || !locks[0]) return null;
  const first = locks[0].blockNo;
  return (
    <TouchableRipple onPress={() => onSelect(first)} style={styles.lock} accessibilityRole="button" testID={testID}>
      <Text style={styles.lockText}>{`${STATUS_MARK.error} Kayıt bekliyor — ${text}`}</Text>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.sm, paddingVertical: 2 },
  tab: { minHeight: 56, minWidth: 96, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tabOn: { borderWidth: 2, borderColor: colors.brand, backgroundColor: colors.brandContainer },
  tabInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  mark: { fontSize: typography.size.lg, fontWeight: typography.weight.bold },
  tabLabel: { fontSize: typography.size.base, color: colors.text },
  tabLabelOn: { fontWeight: typography.weight.bold },
  table: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  th: { backgroundColor: colors.surfaceMuted },
  thText: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold },
  trTap: { minHeight: 56, justifyContent: 'center', borderTopWidth: 1, borderTopColor: colors.border },
  tr: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, gap: spacing.xs },
  td: { flex: 1, fontSize: typography.size.base, color: colors.text },
  wide: { flex: 2 },
  strong: { fontWeight: typography.weight.semibold },
  lock: { minHeight: 56, justifyContent: 'center', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningContainer },
  lockText: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
});
