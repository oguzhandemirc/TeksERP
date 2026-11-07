import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Icon } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';

import { colors } from '../../../../theme';
import { batchService } from '../../../../services/batch.service';

/**
 * "Son parti: P47" — adım ①'in alt çubuğunda, düğmelerin hemen üstünde tek satır (2026-11-07: üstte tablo/okutma
 * alanıyla yarışıyordu; el terminalinde kullanıcı aşağıda istedi).
 *
 * Eski başlık: "SON PARTİ: P47" — planlamacıya fikir verir (2026-08-17 saha talebi).
 *
 * Bilerek SON kullanılan yazılır, sıradaki DEĞİL: numara parti doğduğu anda
 * atanıyor ve arada açılan her parti sırayı kaydırıyor. "Sıradaki P48" yazmak
 * tutulmayacak bir söz olurdu; "son P47" ise fabrikadaki fiziksel plaka setiyle
 * karşılaştırılabilen bir GÖZLEMdir.
 *
 * Rejim kapalıysa (kısa numara bayrağı) ya da uç hata verirse hiçbir şey
 * çizilmez — sihirbazın ilk adımı bir gösterge yüzünden kırmızıya boyanmaz.
 */
export default function LastBatchHint() {
  const q = useQuery({
    queryKey: ['batch-number-state'],
    queryFn: batchService.getNumberState,
    staleTime: 30_000,
    retry: false,
  });
  const s = q.data?.data;
  if (!s?.enabled || !s.lastCode) return null;
  return (
    <View style={styles.lastBatch} testID="last-batch-hint">
      <Icon source="tag-outline" size={14} color={colors.textMuted} />
      <Text style={styles.lastBatchText} numberOfLines={1}>
        Son parti: <Text style={styles.lastBatchCode}>{s.lastCode}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  lastBatch: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  lastBatchText: { fontSize: 13, color: colors.textMuted },
  lastBatchCode: { fontSize: 13, fontWeight: '800', color: colors.text },
});
