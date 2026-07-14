import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TextInput, Button, IconButton } from 'react-native-paper';
import { useMutation } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import AppModal from '../../../components/AppModal';
import { swatchService, type KartelaStockGroup } from '../../../services/swatch.service';
import { generateClientUuid } from '../../../offline/barcode';
import { colors, spacing, radius } from '../../../theme';

/**
 * Kartela stoğunu elle düşürme — kayıp/hasar/numune/sayım düzeltmesi için.
 * Kartelalar fungible ADET sayıldığından per-kayıt seçim YOK; somut grup
 * (ürün+renk) + adet + zorunlu gerekçe gösterilir. Backend FIFO ile N kartelayı
 * iptal eder (soft-cancel) → stoktan düşer. Online-gerektirir.
 */
export function KartelaStockReduceModal({
  visible,
  group,
  onDismiss,
  onReduced,
}: {
  visible: boolean;
  group: KartelaStockGroup | null;
  onDismiss: () => void;
  /** Başarılı düşüm sonrası — parent stok query'sini invalidate eder. */
  onReduced: () => void;
}) {
  const [count, setCount] = useState('1');
  const [reason, setReason] = useState('');
  // İdempotency anahtarı — modal açılışı bir form-oturumudur. Sayaç-bazlı düşümün
  // otomatik/manuel replay'i FARKLI N kartela daha iptal ederdi (çift düşüm);
  // aynı token'la 2. çağrı backend'de cached { reduced } döner. Her açılışta yenilenir.
  const [clientToken, setClientToken] = useState(generateClientUuid);

  useEffect(() => {
    if (visible) {
      setCount('1');
      setReason('');
      setClientToken(generateClientUuid());
    }
  }, [visible, group?.itemId, group?.colorId]);

  const max = group?.count ?? 0;
  const n = parseInt(count, 10);
  const countValid = Number.isFinite(n) && n >= 1 && n <= max;
  const reasonValid = reason.trim().length >= 3;

  const mut = useMutation({
    mutationFn: () =>
      swatchService.reduceStock({
        itemId: group!.itemId,
        colorId: group!.colorId,
        count: n,
        reason: reason.trim(),
        clientToken,
      }),
    onSuccess: (res) => {
      Toast.show({
        type: 'success',
        text1: res.message ?? `${res.data.reduced} kartela düşüldü`,
      });
      onReduced();
      onDismiss();
    },
    // Mobil apiClient yalnız 401'i toast'lar; 409 (bayat sayım → "Listeyi
    // yenileyin") dahil diğer tüm hatalar burada yüzeye çıkarılmalı (modal açık kalır).
    onError: (e: Error) =>
      Toast.show({ type: 'error', text1: 'Stok düşülemedi', text2: e.message }),
  });

  return (
    <AppModal visible={visible} onDismiss={onDismiss} position="center" contentStyle={styles.sheet}>
      <View style={styles.headerRow}>
        <Text variant="titleMedium" style={styles.title}>
          Stoktan Düş
        </Text>
        <IconButton icon="close" size={22} onPress={onDismiss} style={{ margin: 0 }} />
      </View>
      <Text variant="bodySmall" style={styles.sub}>
        Kayıp / hasar / numune / sayım düzeltmesi için kartela stoğunu düşürür. Geri alınamaz.
      </Text>

      {group && (
        <View style={styles.groupRow}>
          <View style={[styles.dot, { backgroundColor: group.colorHex ?? 'transparent' }]} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="bodyMedium" numberOfLines={1} style={styles.groupItem}>
              {group.itemName}
            </Text>
            <Text variant="bodySmall" numberOfLines={1} style={styles.groupColor}>
              {group.colorName ?? 'Renksiz'}
            </Text>
          </View>
          <Text variant="bodySmall" style={styles.groupCount}>
            {group.count} adet mevcut
          </Text>
        </View>
      )}

      <TextInput
        mode="outlined"
        dense
        label="Düşülecek adet"
        value={count}
        onChangeText={(v) => setCount(v.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        style={{ marginTop: spacing.sm }}
      />
      <TextInput
        mode="outlined"
        dense
        label="Gerekçe"
        placeholder="örn. kayıp, hasar, numune verildi…"
        value={reason}
        onChangeText={setReason}
        style={{ marginTop: spacing.sm }}
      />

      <View style={styles.footer}>
        <Button mode="outlined" onPress={onDismiss} disabled={mut.isPending} style={{ flex: 1 }}>
          Vazgeç
        </Button>
        <Button
          mode="contained"
          icon="minus"
          buttonColor={colors.dangerDark}
          disabled={!countValid || !reasonValid || mut.isPending}
          loading={mut.isPending}
          onPress={() => mut.mutate()}
          style={{ flex: 1 }}
        >
          Stoktan Düş
        </Button>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: { width: '92%', maxWidth: 460, padding: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontWeight: '700' },
  sub: { color: colors.textSecondary },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.brandSoft,
  },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  groupItem: { fontWeight: '600', color: colors.text },
  groupColor: { color: colors.textSecondary },
  groupCount: { color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
});
