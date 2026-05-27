import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Text, IconButton } from 'react-native-paper';

// =============================================================================
// Pager — sayfalanmış listelerin alt çubuğu: [◀] N / M · X kayıt [▶]
//
// `totalPages <= 1` ise hiç render edilmez — parent koşulu yazmak zorunda
// kalmaz. `total` opsiyonel; verilirse "X kayıt" rozetini gösterir.
// Disabled davranışı (fetching) ve min/max clamp burada — caller doğrudan
// page+1/page-1 geçer.
// =============================================================================

interface Props {
  page: number;
  totalPages: number;
  /** Opsiyonel — toplam kayıt sayısı ("· 142 kayıt" olarak gösterilir). */
  total?: number;
  /** Sayfa fetch sırasında butonlar kilitlenir + tıklama yutulur. */
  fetching?: boolean;
  onPageChange: (page: number) => void;
  /** Sade görünüm (sayfa metni etrafında ufak butonlar, default). */
  size?: 'small' | 'medium';
  /** Outer container override (parent border/padding eklemek isterse). */
  style?: StyleProp<ViewStyle>;
}

export default function Pager({
  page,
  totalPages,
  total,
  fetching = false,
  onPageChange,
  size = 'small',
  style,
}: Props) {
  if (totalPages <= 1) return null;

  const iconSize = size === 'small' ? 18 : 20;
  const btnSize = size === 'small' ? 32 : 36;

  return (
    <View style={[styles.row, style]}>
      <IconButton
        icon="chevron-left"
        mode="outlined"
        size={iconSize}
        disabled={page <= 1 || fetching}
        onPress={() => onPageChange(Math.max(1, page - 1))}
        accessibilityLabel="Önceki sayfa"
        style={[styles.btn, { width: btnSize, height: btnSize }]}
      />
      <Text style={styles.text}>
        {page} / {totalPages}
        {total != null && ` · ${total} kayıt`}
      </Text>
      <IconButton
        icon="chevron-right"
        mode="outlined"
        size={iconSize}
        disabled={page >= totalPages || fetching}
        onPress={() => onPageChange(Math.min(totalPages, page + 1))}
        accessibilityLabel="Sonraki sayfa"
        style={[styles.btn, { width: btnSize, height: btnSize }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  btn: { margin: 0 },
  text: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    minWidth: 56,
    textAlign: 'center',
  },
});
