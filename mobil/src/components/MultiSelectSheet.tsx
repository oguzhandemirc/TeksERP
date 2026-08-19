import React, { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, TouchableRipple, Icon, ActivityIndicator, TextInput } from 'react-native-paper';

import AppModal from './AppModal';
import { colors, spacing, radius } from '../theme';
import { foldSearchText } from '../utils/searchFold';

// =============================================================================
// Çoklu seçim alt sayfası — `PickerModal` TEKİL seçer, bu ise onay kutulu liste.
//
// Hızlı İş Emri'ndeki `PropertyPickerModal` bu desenin ilk örneğiydi; ikinci
// kullanıcı (Kumaş Ekle → izinli renkler/özellikler) gelince ortak bileşene
// çıkarıldı. O dosya kendi başlığını/verisini taşıdığı için OLDUĞU GİBİ kaldı —
// çalışan bir saha ekranını kozmetik uğruna değiştirmedim.
// =============================================================================

export interface MultiSelectOption {
  id: string;
  label: string;
  sublabel?: string | null;
  /** Sağda küçük renk noktası (renk seçiciler için). */
  swatch?: string | null;
}

interface Props {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  options: MultiSelectOption[];
  loading?: boolean;
  value: string[];
  onChange: (ids: string[]) => void;
  emptyText?: string;
  /** Sorgu hata aldıysa "boş liste" yerine sebebi göster. */
  errorText?: string | null;
  /** 15+ seçenekte arama kutusu — renk kataloğu 50+ olabiliyor. */
  searchable?: boolean;
}

export default function MultiSelectSheet({
  visible,
  onDismiss,
  title,
  options,
  loading,
  value,
  onChange,
  emptyText = 'Seçenek yok',
  errorText,
  searchable = true,
}: Props) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = foldSearchText(search);
    if (!q) return options;
    return options.filter(
      (o) =>
        foldSearchText(o.label).includes(q) ||
        foldSearchText(o.sublabel ?? '').includes(q),
    );
  }, [options, search]);

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  const showSearch = searchable && options.length >= 15;

  return (
    <AppModal visible={visible} onDismiss={onDismiss} position="center" contentStyle={styles.wrap}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <TouchableRipple onPress={onDismiss} borderless style={styles.doneBtn}>
            <Text style={styles.doneText}>Tamam ({value.length})</Text>
          </TouchableRipple>
        </View>

        {showSearch ? (
          <TextInput
            mode="outlined"
            dense
            placeholder="Ara…"
            value={search}
            onChangeText={setSearch}
            left={<TextInput.Icon icon="magnify" />}
            right={search ? <TextInput.Icon icon="close" onPress={() => setSearch('')} /> : undefined}
            style={styles.search}
          />
        ) : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : errorText ? (
          <Text style={styles.error}>{errorText}</Text>
        ) : filtered.length === 0 ? (
          <Text style={styles.empty}>{search ? 'Aramaya uyan seçenek yok' : emptyText}</Text>
        ) : (
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {filtered.map((o) => {
              const checked = value.includes(o.id);
              return (
                <TouchableRipple key={o.id} onPress={() => toggle(o.id)} style={styles.row} borderless>
                  <View style={styles.rowInner}>
                    <Icon
                      source={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                      size={24}
                      color={checked ? colors.brand : colors.textMuted}
                    />
                    <View style={styles.rowCol}>
                      <Text style={styles.rowLabel} numberOfLines={1}>
                        {o.label}
                      </Text>
                      {o.sublabel ? (
                        <Text style={styles.rowSub} numberOfLines={1}>
                          {o.sublabel}
                        </Text>
                      ) : null}
                    </View>
                    {o.swatch ? <View style={[styles.swatch, { backgroundColor: o.swatch }]} /> : null}
                  </View>
                </TouchableRipple>
              );
            })}
          </ScrollView>
        )}
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  // Genişlik VERİLMEZ — center + contentStyle'da AppModal min(ekran−32, 560) yazar.
  wrap: { maxHeight: '85%' },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, minWidth: 0, fontSize: 17, fontWeight: '800', color: colors.text },
  doneBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md },
  doneText: { color: colors.brand, fontWeight: '800', fontSize: 15 },
  search: { marginTop: spacing.sm, backgroundColor: colors.surface },
  center: { paddingVertical: spacing.xxl, alignItems: 'center' },
  empty: { paddingVertical: spacing.xl, textAlign: 'center', color: colors.textMuted },
  error: { paddingVertical: spacing.xl, textAlign: 'center', color: colors.dangerText, fontSize: 13 },
  list: { flexShrink: 1, marginTop: spacing.sm },
  listContent: { paddingBottom: spacing.sm },
  row: { borderRadius: radius.sm },
  // 56dp dokunma hedefi.
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingHorizontal: spacing.xs },
  rowCol: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 16, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textMuted },
  swatch: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: colors.border },
});
