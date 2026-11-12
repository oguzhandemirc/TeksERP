// "İş Emri Rotası" seçici — gerçek tuşlar; seçili tuş dolu marka rengi. Seçim mantığı üst bileşende, burada yalnız görünüm.
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { Icon, IconButton, Text, TouchableRipple } from 'react-native-paper';
import AppModal from '../../../components/AppModal';
import { foldedIncludes } from '../../../utils/searchFold';
import { colors, radius, shadow, spacing, typography } from '../../../theme';
import { SEARCH_MIN_OPTIONS, routeColumns } from './routePickerView';

export interface RouteChoice { id: string; title: string; steps?: string }
interface Props {
  visible: boolean;
  title: string;
  special: RouteChoice[];
  ready: RouteChoice[];
  specialLabel: string;
  readyLabel: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDismiss: () => void;
}

export default function RoutePickerModal({ visible, title, special, ready, specialLabel, readyLabel, selectedId, onSelect, onDismiss }: Props) {
  const { width, height } = useWindowDimensions();
  const [q, setQ] = useState('');
  const total = special.length + ready.length;
  const sheetW = Math.min(width * 0.95, 1000);
  const cols = routeColumns(sheetW);
  const match = (c: RouteChoice) => !q.trim() || foldedIncludes(`${c.title} ${c.steps ?? ''}`, q);
  const sp = useMemo(() => special.filter(match), [special, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const rd = useMemo(() => ready.filter(match), [ready, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const both = special.length > 0 && ready.length > 0;
  const group = (label: string, items: RouteChoice[], first: boolean) => items.length === 0 ? null : (
    <View key={label} style={[both && !first && styles.divided]}>
      {both && <Text style={styles.groupTitle}>{label}</Text>}
      <View style={styles.grid}>
        {items.map((c) => {
          const sel = c.id === selectedId;
          return (
            <View key={c.id} style={{ width: `${100 / cols}%`, padding: spacing.xs }}>
              <TouchableRipple onPress={() => onSelect(c.id)} style={[styles.btn, sel && styles.btnSel]} accessibilityRole="button" accessibilityState={{ selected: sel }} testID={`rota-${c.id}`}>
                <View style={styles.btnInner}>
                  <View style={styles.btnText}>
                    <Text style={[styles.btnTitle, sel && styles.onBrand]}>{c.title}</Text>
                    {!!c.steps && <Text style={[styles.btnSub, sel && styles.onBrand]}>{c.steps}</Text>}
                  </View>
                  {sel && <Icon source="check" size={22} color="#fff" />}
                </View>
              </TouchableRipple>
            </View>
          );
        })}
      </View>
    </View>
  );
  return (
    <AppModal visible={visible} onDismiss={onDismiss} contentStyle={[styles.sheet, { width: sheetW, maxHeight: height * 0.85 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <IconButton icon="close" size={22} onPress={onDismiss} accessibilityLabel="Kapat" testID="rota-kapat" />
      </View>
      {total > SEARCH_MIN_OPTIONS && (
        <TextInput value={q} onChangeText={setQ} placeholder="Ara…" placeholderTextColor={colors.textMuted} style={styles.search} testID="rota-ara" />
      )}
      <ScrollView keyboardShouldPersistTaps="handled">
        {group(specialLabel, sp, true)}
        {group(readyLabel, rd, sp.length === 0)}
        {sp.length + rd.length === 0 && <Text style={styles.empty}>Sonuç yok.</Text>}
      </ScrollView>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text },
  search: { height: 44, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  groupTitle: { fontSize: typography.size.sm, fontWeight: typography.weight.bold, color: colors.textSecondary, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs },
  divided: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.sm, paddingTop: spacing.xs },
  btn: { minHeight: 56, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface, justifyContent: 'center', ...shadow.sm },
  btnSel: { backgroundColor: colors.brand, borderColor: colors.brand },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  btnText: { flex: 1 },
  btnTitle: { fontSize: typography.size.base, fontWeight: typography.weight.bold, color: colors.text },
  btnSub: { fontSize: typography.size.sm, color: colors.textSecondary, flexWrap: 'wrap' },
  onBrand: { color: '#fff' },
  empty: { padding: spacing.lg, textAlign: 'center', color: colors.textMuted },
});
