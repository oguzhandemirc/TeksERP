import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, TouchableRipple, Icon, ActivityIndicator } from 'react-native-paper';

import AppModal from '../../../../components/AppModal';
import type { FabricProperty } from '../../../../services/fabricProperty.service';
import { colors, spacing, radius } from '../../../../theme';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  options: FabricProperty[];
  loading?: boolean;
  value: string[];
  onChange: (ids: string[]) => void;
}

/**
 * Hedef üretim özellikleri — çoklu seçim (PickerModal tekil seçer).
 *
 * Yalnız rota `appliesProperty` bayraklı bir fason adımı içeriyorsa açılır;
 * backend aksi halde 400 atar ("rotada özellik veren adım yok").
 */
export default function PropertyPickerModal({
  visible,
  onDismiss,
  options,
  loading,
  value,
  onChange,
}: Props) {
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <AppModal visible={visible} onDismiss={onDismiss} position="bottom" contentStyle={styles.sheet}>
      <View style={styles.header}>
        <Text style={styles.title}>Üretim Özellikleri</Text>
        <TouchableRipple onPress={onDismiss} borderless style={styles.doneBtn}>
          <Text style={styles.doneText}>Tamam ({value.length})</Text>
        </TouchableRipple>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : options.length === 0 ? (
        <Text style={styles.empty}>Tanımlı üretim özelliği yok.</Text>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {options.map((p) => {
            const checked = value.includes(p.id);
            return (
              <TouchableRipple key={p.id} onPress={() => toggle(p.id)} style={styles.row} borderless>
                <View style={styles.rowInner}>
                  <Icon
                    source={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                    size={24}
                    color={checked ? colors.brand : colors.textMuted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {p.name}
                    </Text>
                    {p.category ? (
                      <Text style={styles.rowSub} numberOfLines={1}>
                        {p.category}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </TouchableRipple>
            );
          })}
        </ScrollView>
      )}
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: '75%',
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  doneBtn: { backgroundColor: colors.brand, borderRadius: radius.full, paddingHorizontal: spacing.lg, paddingVertical: 8 },
  doneText: { color: '#fff', fontWeight: '700' },
  list: { flexGrow: 0 },
  listContent: { paddingBottom: spacing.md },
  center: { padding: spacing.xxl, alignItems: 'center' },
  empty: { textAlign: 'center', color: colors.textMuted, padding: spacing.xl },
  row: { borderRadius: radius.sm },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 12, paddingHorizontal: spacing.sm },
  rowTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
});
