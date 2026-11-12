// İş emri detayı — "Gelen" (giriş) kartı: üretime giren metre kritik rakam olarak başta, altında etiket | değer tablosu.
// Satır kararları saf `incomingView`de; kart yalnız çizer. Kaynak belge satırı belge görüntüleyiciyi (Belgeler) açar.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, Icon } from 'react-native-paper';

import { colors, spacing, radius } from '../../../theme';
import type { DetailRow, IncomingView } from './workOrderDetailView';

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.key}>{k}</Text>
      <Text style={styles.val}>{v}</Text>
    </View>
  );
}

const rowsOf = (rows: readonly DetailRow[]) => rows.map(([k, v]) => <Row key={k} k={k} v={v} />);

export default function WorkOrderIncomingCard({ view, flex, onOpenDocuments }: { view: IncomingView; flex?: number; onOpenDocuments: () => void }) {
  return (
    <View style={[styles.card, flex ? { flex } : null]} testID="ie-detay-gelen">
      <Text style={styles.title}>Gelen</Text>
      {view.empty ? (
        <Text style={styles.muted} testID="ie-detay-gelen-yok">Gelen bilgisi yok</Text>
      ) : (
        <>
          {view.meters ? (
            <View style={styles.hero}>
              <Text style={styles.key}>{view.metersLabel}</Text>
              <Text style={styles.heroVal} testID="ie-detay-gelen-metre">{view.meters}</Text>
            </View>
          ) : null}
          {rowsOf(view.rows)}
          {view.sources.length > 0 ? (
            <TouchableRipple onPress={onOpenDocuments} accessibilityRole="button" accessibilityLabel={`Kaynak belge: ${view.sources.join(', ')}`} testID="ie-detay-gelen-belge" style={styles.sourceRow} borderless={false}>
              <View style={styles.sourceInner}>
                <Text style={styles.key}>Kaynak Belge</Text>
                <View style={styles.sourceVals}>
                  {view.sources.map((s) => (
                    <Text key={s} style={styles.sourceText}>{s}</Text>
                  ))}
                </View>
                <Icon source="file-document-outline" size={22} color={colors.brand} />
              </View>
            </TouchableRipple>
          ) : null}
          {rowsOf(view.moreRows)}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  title: { fontSize: 13, fontWeight: '800', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: spacing.xs },
  hero: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  heroVal: { flex: 1, fontSize: 26, fontWeight: '800', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  key: { width: 120, color: colors.textMuted, fontWeight: '500', fontSize: 12 },
  val: { flex: 1, color: colors.text, fontWeight: '700', fontSize: 14 },
  sourceRow: { minHeight: 56, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  sourceInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  sourceVals: { flex: 1 },
  sourceText: { color: colors.brandDark, fontWeight: '700', fontSize: 14 },
  muted: { color: colors.textMuted, fontSize: 13, paddingVertical: spacing.sm },
});
