import { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text, TextInput, Button, TouchableRipple, ActivityIndicator, IconButton } from 'react-native-paper';
import { useQuery, useMutation } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import AppModal from '../../../components/AppModal';
import { packingService, type KartelaStockGroup } from '../../../services/packing.service';
import { colors, spacing, radius } from '../../../theme';

function groupKey(g: KartelaStockGroup): string {
  return `${g.itemId}__${g.colorId ?? 'none'}`;
}

/**
 * Seçerek kartela ekleme — kartelaların fiziksel etiketi olmadığından barkod
 * okutma yerine ürün+renk stok grubu + adet seçilir. `onAdd` parent'ta aktif
 * havuz çuvalını garantiler, backend o gruptan N müsait kartelayı atomik claim eder.
 * Online-gerektirir: stok listesi ağdan gelir (offline'da boş → eklenemez).
 */
export function KartelaStockPickerModal({
  visible,
  onDismiss,
  onAdd,
}: {
  visible: boolean;
  onDismiss: () => void;
  /** Eklemeyi gerçekleştirir (ensureActiveSack + addKartelaToSack). Eklenen adedi döndürür. */
  onAdd: (group: KartelaStockGroup, count: number) => Promise<number>;
}) {
  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [count, setCount] = useState('1');

  useEffect(() => {
    if (!visible) {
      setSearch('');
      setSelectedKey(null);
      setCount('1');
    }
  }, [visible]);

  const stockQ = useQuery({
    queryKey: ['kartela', 'stock', search],
    queryFn: () => packingService.listKartelaStock(search.trim() || undefined),
    enabled: visible,
    staleTime: 5_000,
  });

  const groups = useMemo(() => stockQ.data?.data ?? [], [stockQ.data]);
  const selected = useMemo(
    () => groups.find((g) => groupKey(g) === selectedKey) ?? null,
    [groups, selectedKey],
  );

  const n = parseInt(count, 10);
  const countValid = Number.isFinite(n) && n >= 1 && !!selected && n <= selected.count;

  const addMut = useMutation({
    mutationFn: () => onAdd(selected!, n),
    onSuccess: (added) => {
      Toast.show({ type: 'success', text1: `${added} kartela eklendi` });
      onDismiss();
    },
  });

  return (
    <AppModal visible={visible} onDismiss={onDismiss} position="bottom" contentStyle={styles.sheet}>
      <View style={styles.headerRow}>
        <Text variant="titleMedium" style={styles.title}>
          Kartela Ekle
        </Text>
        <IconButton icon="close" size={22} onPress={onDismiss} style={{ margin: 0 }} />
      </View>
      <Text variant="bodySmall" style={styles.sub}>
        Ürün + renk seç, adet gir. Seçilen kartelalar stoktan düşülerek aktif çuvala eklenir.
      </Text>

      <TextInput
        mode="outlined"
        dense
        placeholder="Ürün / renk ara…"
        value={search}
        onChangeText={setSearch}
        left={<TextInput.Icon icon="magnify" />}
        style={{ marginTop: spacing.sm }}
      />

      <ScrollView
        style={styles.list}
        contentContainerStyle={{ gap: spacing.xs, paddingVertical: spacing.xs }}
        keyboardShouldPersistTaps="handled"
      >
        {stockQ.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : groups.length === 0 ? (
          <Text style={styles.empty}>Müsait kartela stoğu yok.</Text>
        ) : (
          groups.map((g) => {
            const key = groupKey(g);
            const isSel = key === selectedKey;
            return (
              <TouchableRipple
                key={key}
                borderless
                onPress={() => {
                  setSelectedKey(key);
                  setCount((c) => {
                    const cn = parseInt(c, 10);
                    return Number.isFinite(cn) && cn >= 1 ? String(Math.min(cn, g.count)) : '1';
                  });
                }}
                style={[styles.row, isSel && styles.rowSel]}
              >
                <View style={styles.rowInner}>
                  <View style={[styles.dot, { backgroundColor: g.colorHex ?? 'transparent' }]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="bodyMedium" numberOfLines={1} style={styles.rowItem}>
                      {g.itemName}
                    </Text>
                    <Text variant="bodySmall" numberOfLines={1} style={styles.rowColor}>
                      {g.colorName ?? 'Renksiz'}
                    </Text>
                  </View>
                  <Text variant="bodySmall" style={styles.rowCount}>
                    {g.count} adet
                  </Text>
                </View>
              </TouchableRipple>
            );
          })
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TextInput
          mode="outlined"
          dense
          label="Adet"
          value={count}
          onChangeText={(v) => setCount(v.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          disabled={!selected}
          style={styles.countInput}
        />
        <Button
          mode="contained"
          icon="layers"
          buttonColor={colors.brand}
          disabled={!countValid || addMut.isPending}
          loading={addMut.isPending}
          onPress={() => addMut.mutate()}
          style={{ flex: 1 }}
        >
          {selected ? `Ekle (${selected.count} müsait)` : 'Ekle'}
        </Button>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  // position="bottom": alttan sheet klavye açılınca TAM klavye yüksekliği kadar
  // yukarı çıkar → alttaki "Adet" number-pad input'u + "Ekle" butonu kısa/yatay
  // ekranda da klavyenin üstünde kalır. alignSelf:'center' bottom wrapper'ın
  // stretch'inde sheet'i yatayda ortalar (sola yaslanmayı önler).
  sheet: { width: '92%', maxWidth: 480, padding: spacing.md, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontWeight: '700' },
  sub: { color: colors.textSecondary },
  list: { maxHeight: 200, marginTop: spacing.xs },
  center: { paddingVertical: spacing.lg, alignItems: 'center' },
  empty: { textAlign: 'center', color: colors.textSecondary, paddingVertical: spacing.lg },
  row: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  rowSel: { borderColor: colors.brand, backgroundColor: `${colors.brand}10` },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  rowItem: { fontWeight: '600', color: colors.text },
  rowColor: { color: colors.textSecondary },
  rowCount: { color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  countInput: { width: 96 },
});
