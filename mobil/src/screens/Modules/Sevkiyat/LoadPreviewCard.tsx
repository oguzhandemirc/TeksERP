// Sevk öncesi yük önizlemesi (9.1) — "bu yükte hangi İE'nin kaç topu var, geride top kaldı mı, karışık müşteri var mı".
// Salt-okur ve ENGELLEMEZ: sevk düğmesi açık kalır, uyarılar sarı satır. Metinler sunucudan; istemci yalnız çizer.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { shipmentLoadService, type LoadPreview } from '../../../services/shipmentLoad.service';
import { sourceDocText, workOrderLine } from './loadEdit';
import { TERIM } from '../../../lib/terim';
import { colors, palette, radius, spacing, typography } from '../../../theme/tokens';

const fmtM = (m: number) => m.toLocaleString('tr-TR', { maximumFractionDigits: 0 });

export function LoadPreviewBody({ data }: { data: LoadPreview }) {
  return (
    <View style={styles.box} testID="sevk-onizleme">
      <Text style={styles.title}>Yükte ne var</Text>
      {data.workOrders.map((w) => (
        <View key={w.workOrderId} style={styles.row}>
          <Icon source={w.remaining > 0 ? 'alert-circle-outline' : 'check-circle-outline'} size={18} color={w.remaining > 0 ? palette.amber[700] : colors.successDark} />
          <View style={styles.rowText}>
            <Text style={styles.line}>{workOrderLine(w)}</Text>
            {sourceDocText(w) ? <Text style={styles.sub}>Belge: {sourceDocText(w)}</Text> : null}
          </View>
        </View>
      ))}
      {data.noWorkOrder.rollCount > 0 ? (
        <Text style={styles.sub}>{TERIM.terbiyeIsEmri.tekil} bağı olmayan {data.noWorkOrder.rollCount} top · {fmtM(data.noWorkOrder.meters)} m</Text>
      ) : null}
      {data.warnings.map((w) => (
        <View key={w} style={styles.warn}>
          <Icon source="alert" size={16} color={palette.amber[700]} />
          <Text style={styles.warnText}>{w}</Text>
        </View>
      ))}
    </View>
  );
}

/** Sevkiyatın önizlemesi — hata/eski sunucu sessizce gizlenir (sevki engellemez). */
export function LoadPreviewCard({ shipmentId }: { shipmentId: string | null }) {
  const q = useQuery({
    queryKey: ['shipment-load-preview', shipmentId],
    queryFn: () => shipmentLoadService.preview({ shipmentId: shipmentId! }),
    enabled: shipmentId !== null,
    retry: false,
    staleTime: 5_000,
  });
  if (q.isLoading) return <ActivityIndicator style={styles.loading} />;
  if (!q.data?.data || q.data.data.rollCount === 0) return null;
  return <LoadPreviewBody data={q.data.data} />;
}

const styles = StyleSheet.create({
  box: { marginTop: spacing.md, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: palette.slate[50], gap: 6 },
  title: { fontSize: typography.size.sm, fontWeight: '700', color: colors.textSecondary },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  rowText: { flex: 1 },
  line: { fontSize: typography.size.sm, color: colors.text, fontWeight: '600' },
  sub: { fontSize: 12, color: colors.textMuted },
  warn: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', backgroundColor: palette.amber[50], borderRadius: radius.sm, padding: 6 },
  warnText: { flex: 1, fontSize: 12, color: colors.warningText },
  loading: { marginTop: spacing.md },
});
