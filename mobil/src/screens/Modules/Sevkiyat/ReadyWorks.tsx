// =============================================================================
// Sevk Kapısı — sevke hazır iş çipleri (D4-J4, ister 2.4 / 2.10)
// =============================================================================
// Board'dan AYRI tek istek (`ready-works?groupBy=customer`); board SQL'ine dokunulmaz. Eski backend 404 →
// servis `null` → şerit çizilmez (tost yok). Çipe dokununca müşterinin hazır işleri; sevk MEVCUT akıştan
// (Paketleme → havuz → sevkiyat) kurulur — burada ikinci sevk yaratıcı YOK.
// =============================================================================

import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, SegmentedButtons, Text, TouchableRipple } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import ModuleSheet from '../../../components/ModuleSheet';
import TruncatedText from '../../../components/TruncatedText';
import { readyWorksService, type ReadyWorkRow } from '../../../services/readyWorks.service';
import { colors, palette, spacing } from '../../../theme/tokens';
import { TERIM } from '../../../lib/terim';

export const READY_WORKS_KEY = ['sack-store', 'ready-works'] as const;

const fmtM = (m: number) => m.toLocaleString('tr-TR', { maximumFractionDigits: 0 });

/** Çip satırları: yalnız müşterisi olan READY/PARTIAL satırlar (sunucu zaten süzer; savunma). */
export function readyChipRows(rows: ReadyWorkRow[] | null | undefined): ReadyWorkRow[] {
  if (!rows) return [];
  return rows.filter((r) => (r.state === 'READY' || r.state === 'PARTIAL') && r.readyCount > 0);
}

export function readyChipText(r: ReadyWorkRow): string {
  const head = r.state === 'READY' ? 'Hazır' : 'Kısmen hazır';
  return `${head}: ${r.readyCount} top · ${fmtM(r.readyMeters)} m`;
}

/** Müşteri başına hazır iş çipleri — ayrı istek; 404/hata/boş → hiçbir şey çizilmez. */
export function ReadyWorksStrip({ onOpen }: { onOpen: (row: ReadyWorkRow) => void }) {
  const q = useQuery({ queryKey: READY_WORKS_KEY, queryFn: readyWorksService.listCustomers, staleTime: 30_000, retry: false });
  const rows = readyChipRows(q.data);
  if (rows.length === 0) return null;
  return (
    <View style={styles.strip} testID="hazir-is-serit">
      <Text style={styles.stripTitle}>Sevke hazır işler</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stripRow}>
        {rows.map((r) => (
          <TouchableRipple
            key={r.id}
            onPress={() => onOpen(r)}
            style={[styles.chip, r.state === 'READY' ? styles.chipReady : styles.chipPartial]}
            testID={`hazir-is-cip-${r.id}`}
            accessibilityLabel={`${r.label} sevke hazır işler`}
          >
            <View style={styles.chipInner}>
              <Icon source={r.state === 'READY' ? 'truck-check' : 'progress-clock'} size={16} color={r.state === 'READY' ? colors.successDark : palette.amber[700]} />
              <View style={styles.chipTexts}>
                <TruncatedText style={styles.chipName}>{r.label}</TruncatedText>
                <Text style={styles.chipMeta}>{readyChipText(r)}</Text>
              </View>
            </View>
          </TouchableRipple>
        ))}
      </ScrollView>
    </View>
  );
}

type WorkAxis = 'workOrder' | 'deliveryNote';

/** Müşterinin hazır işleri (lazy) + "Paketlemeye geç" (mevcut sevk akışı). */
export function ReadyWorksSheet({
  customer,
  incomingDocsEnabled,
  onDismiss,
  onGoPacking,
}: {
  customer: ReadyWorkRow | null;
  incomingDocsEnabled: boolean;
  onDismiss: () => void;
  onGoPacking: (customerId: string) => void;
}) {
  const [axis, setAxis] = useState<WorkAxis>('workOrder');
  const effectiveAxis: WorkAxis = incomingDocsEnabled ? axis : 'workOrder';
  const customerId = customer?.id ?? null;
  const q = useQuery({
    queryKey: [...READY_WORKS_KEY, customerId, effectiveAxis] as const,
    queryFn: () => readyWorksService.listCustomerWorks(customerId as string, effectiveAxis),
    enabled: customerId !== null,
    retry: false,
  });
  const works = readyChipRows(q.data);
  return (
    <ModuleSheet
      visible={customer !== null}
      onDismiss={onDismiss}
      title="Sevke hazır işler"
      subtitle={customer ? `${customer.label} · ${readyChipText(customer)}` : undefined}
      footer={
        <>
          <Button onPress={onDismiss}>Kapat</Button>
          <Button
            mode="contained"
            icon="sack"
            onPress={() => customerId && onGoPacking(customerId)}
            disabled={!customerId}
            testID="hazir-is-paketleme"
          >
            Paketlemeye geç
          </Button>
        </>
      }
    >
      {incomingDocsEnabled ? (
        <SegmentedButtons
          value={effectiveAxis}
          onValueChange={(v) => setAxis(v as WorkAxis)}
          buttons={[
            { value: 'workOrder', label: TERIM.terbiyeIsEmri.tekil },
            { value: 'deliveryNote', label: 'Gelen belge' },
          ]}
        />
      ) : null}
      {q.isLoading ? <ActivityIndicator style={styles.loading} /> : null}
      {q.isError ? <Text style={styles.empty}>Hazır işler alınamadı.</Text> : null}
      {!q.isLoading && !q.isError && works.length === 0 ? (
        <Text style={styles.empty}>Bu eksende sevke hazır iş yok.</Text>
      ) : null}
      {works.map((w) => (
        <View key={w.id} style={styles.workRow} testID={`hazir-is-satir-${w.id}`}>
          <TruncatedText style={styles.workLabel}>{w.label}</TruncatedText>
          <Text style={styles.workMeta}>
            {readyChipText(w)}
            {w.inProcessCount > 0 ? ` · işlemde ${w.inProcessCount} top` : ''}
            {w.targetMeters ? ` · hedef ${fmtM(w.targetMeters)} m` : ''}
          </Text>
        </View>
      ))}
      <Text style={styles.hint}>Sevk, hazır topların çuvallanmasıyla Paketleme ekranından kurulur.</Text>
    </ModuleSheet>
  );
}

const styles = StyleSheet.create({
  strip: { paddingHorizontal: 12, paddingBottom: 8, backgroundColor: '#fff', gap: 4 },
  stripTitle: { fontSize: 12, fontWeight: '700', color: palette.slate[600] },
  stripRow: { gap: 8 },
  chip: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, minHeight: 56, justifyContent: 'center', maxWidth: 320 },
  chipReady: { backgroundColor: palette.emerald[50], borderWidth: 1, borderColor: palette.emerald[100] },
  chipPartial: { backgroundColor: palette.amber[50], borderWidth: 1, borderColor: palette.amber[300] },
  chipInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chipTexts: { flexShrink: 1 },
  chipName: { fontSize: 14, fontWeight: '700', color: colors.text },
  chipMeta: { fontSize: 12, color: palette.slate[600] },
  loading: { marginVertical: spacing.md },
  empty: { fontSize: 13, color: palette.slate[500], marginVertical: spacing.md },
  workRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  workLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  workMeta: { fontSize: 12, color: palette.slate[600] },
  hint: { fontSize: 12, color: palette.slate[500], marginTop: spacing.sm },
});
