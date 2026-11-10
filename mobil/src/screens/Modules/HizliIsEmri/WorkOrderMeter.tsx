// İE metre bloğu: liste satırı (`MeterLine`) + ayrıntı kartı (`WorkOrderMeterCard`). Biçim kararı `meterView.ts`te.
// Kart hata/403/404/boşta HİÇ çizilmez — metre yardımcı bilgidir, ayrıntı sayfasını bozmamalı.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { workOrderService } from '../../../services/workOrder.service';
import { colors, radius, spacing, typography } from '../../../theme';
import { meterDetailView, meterListView, type MeterTone, type WorkOrderMeterSummary } from './meterView';

const TONE: Record<MeterTone, { bg: string; fg: string }> = {
  over: { bg: colors.warningContainer, fg: colors.warningDark },
  short: { bg: colors.border, fg: colors.textSecondary },
};

/** Liste satırı: "Giren 241 · Çıkan 500" + rozet; metin sarar (kesik yok). `dash`: özet yoksa tablo hücresinde "—". */
export function MeterLine({ summary, testID, dash }: { summary: WorkOrderMeterSummary | null | undefined; testID?: string; dash?: boolean }) {
  const v = meterListView(summary);
  if (!v) return dash ? <Text style={styles.dash}>—</Text> : null;
  return (
    <View style={styles.line} testID={testID}>
      <Text style={styles.lineText}>{v.text}</Text>
      {v.badge ? (
        <Text style={[styles.badge, { backgroundColor: TONE[v.badge.tone].bg, color: TONE[v.badge.tone].fg }]} testID={testID ? `${testID}-rozet` : undefined}>
          {v.badge.text}
        </Text>
      ) : null}
    </View>
  );
}

export const meterComparisonKey = (id: string) => ['work-orders', 'meter-comparison', id] as const;

export function WorkOrderMeterCard({ workOrderId }: { workOrderId: string }) {
  const q = useQuery({ queryKey: meterComparisonKey(workOrderId), queryFn: () => workOrderService.meterComparison(workOrderId), retry: false });
  const v = q.isSuccess ? meterDetailView(q.data) : null;
  if (!v) return null;
  const tone = v.fazlaTone ? TONE[v.fazlaTone] : null;
  return (
    <View style={styles.card} testID="ie-detay-metre">
      <Text style={styles.title}>Metre</Text>
      <View style={styles.nums}>
        <Num label="Giren (beyan)" value={v.giren} />
        <Num label="Çıkan (ölçülen)" value={v.cikan} />
        <Num label="Beyan fazlası" value={v.fazla} color={tone?.fg} testID="ie-detay-metre-fazla" />
      </View>
      {v.billed ? <Text style={styles.billed}>{v.billed}</Text> : null}
      {v.parties.length > 0 ? (
        <View style={styles.parties}>
          <View style={styles.pRow}>
            {['Parti', 'Beyan', 'Kurşun', 'Tambur', 'Fark'].map((h, i) => (
              <Text key={h} style={[styles.pHead, i === 0 ? styles.pFirst : styles.pCell]}>{h}</Text>
            ))}
          </View>
          {v.parties.map((p) => (
            <View key={p.key} style={styles.pRow} testID={`ie-detay-metre-parti-${p.key}`}>
              <Text style={[styles.pText, styles.pFirst]}>{p.batch}</Text>
              <Text style={[styles.pText, styles.pCell]}>{p.declared}</Text>
              <Text style={[styles.pText, styles.pCell]}>{p.kursun}</Text>
              <Text style={[styles.pText, styles.pCell]}>{p.tambur}</Text>
              <Text style={[styles.pText, styles.pCell, p.tone ? { color: TONE[p.tone].fg, fontWeight: typography.weight.bold } : null]}>{p.diff}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Num({ label, value, color, testID }: { label: string; value: string; color?: string; testID?: string }) {
  return (
    <View style={styles.num}>
      <Text style={styles.numLabel}>{label}</Text>
      <Text style={[styles.numVal, color ? { color } : null]} testID={testID}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexShrink: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  dash: { fontSize: typography.size.sm, color: colors.textSecondary },
  lineText: { fontSize: typography.size.sm, color: colors.text },
  badge: { fontSize: typography.size.sm, fontWeight: typography.weight.bold, borderRadius: radius.sm, paddingHorizontal: spacing.xs, overflow: 'hidden' },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md },
  title: { fontSize: 13, fontWeight: '800', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: spacing.xs },
  nums: { flexDirection: 'row', gap: spacing.md },
  num: { flex: 1 },
  numLabel: { fontSize: typography.size.xs, color: colors.textMuted },
  numVal: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, color: colors.text },
  billed: { fontSize: typography.size.xs, color: colors.textSecondary, marginTop: 2 },
  parties: { marginTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.xs },
  pRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, gap: spacing.sm },
  pHead: { fontSize: typography.size.xs, color: colors.textMuted, fontWeight: typography.weight.bold },
  pText: { fontSize: typography.size.sm, color: colors.text },
  pFirst: { flex: 1.4 },
  pCell: { flex: 1, textAlign: 'right' },
});
