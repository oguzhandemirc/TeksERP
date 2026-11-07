// İş Emirleri — üst süzgeç BANDI (kendi yüzeyi + alt kenar/gölge): arama + Durum / İstasyon (PickerModal) + Tarih
// (DateRangeSheet) + Sütunlar + Seçenekler. Arama ve süzgeç kutuları tek dil: aynı yükseklik (56), köşe ve kenarlık.
// Tablette tek satır; dar ekranda (telefon dikey) arama üstte, düğmeler altta yatay kayar. Süzme SUNUCUDA.
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Icon, Text, TextInput, TouchableRipple } from 'react-native-paper';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import DateRangeSheet from '../../../components/filters/DateRangeSheet';
import { formatRange } from '../../../components/filters/rollHistoryFilter';
import { colors, radius, shadow, spacing, typography } from '../../../theme';
import { TERIM } from '../../../lib/terim';
import { STATUS_FILTER_OPTIONS, type ListFilters, type StatusFilter } from './workOrderRow';

const ALL_STATIONS = '__all__';

interface Props {
  value: ListFilters;
  onChange: (next: ListFilters) => void;
  stations: { id: string; name: string; dis: boolean }[];
  stationsLoading: boolean;
  searching: boolean;
  onColumns: () => void;
  /** Oluştur düğmeleri (cihaz ayarı); verilmezse kutu çizilmez (okutma kapalı). */
  onOptions?: () => void;
}

export default function FilterBar({ value, onChange, stations, stationsLoading, searching, onColumns, onOptions }: Props) {
  const [picker, setPicker] = useState<'status' | 'station' | 'date' | null>(null);
  const wide = useWindowDimensions().width >= 720;
  const set = (patch: Partial<ListFilters>) => onChange({ ...value, ...patch });

  const stationOptions: PickerOption[] = useMemo(
    () => [{ value: ALL_STATIONS, label: 'Tüm istasyonlar' }, ...stations.map((s) => ({ value: s.id, label: s.name, sublabel: s.dis ? 'Fason' : undefined }))],
    [stations],
  );
  const statusLabel = STATUS_FILTER_OPTIONS.find((o) => o.value === value.status)?.label.replace(/ \(.*\)$/, '') ?? 'Durum';
  const stationLabel = value.stationId ? (stations.find((s) => s.id === value.stationId)?.name ?? 'İstasyon') : 'Tüm istasyonlar';
  const dateLabel = value.range ? formatRange(value.range) : 'Tüm tarihler';

  const buttons = (
    <>
      <FilterButton icon="list-status" caption="Durum" label={statusLabel} active={value.status !== 'OPEN'} onPress={() => setPicker('status')} testID="ie-liste-durum" />
      <FilterButton icon="map-marker-radius-outline" caption="Şu an nerede" label={stationLabel} active={!!value.stationId} onPress={() => setPicker('station')} testID="ie-liste-istasyon" />
      <FilterButton icon="calendar-range" caption="Açılış tarihi" label={dateLabel} active={!!value.range} onPress={() => setPicker('date')} onClear={value.range ? () => set({ range: null }) : undefined} testID="ie-liste-tarih" />
      <FilterButton icon="view-column-outline" caption="Görünüm" label="Sütunlar" active={false} onPress={onColumns} testID="ie-liste-sutunlar" />
      {onOptions && (
        // Kare ikon düğme: aramaya yer bırakır; ad erişilebilirlik etiketinde, basınca sayfa başlığı "Seçenekler".
        <TouchableRipple onPress={onOptions} rippleColor={colors.brandSoft} style={[styles.btn, styles.iconBtn]} testID="ie-secenekler" accessibilityRole="button" accessibilityLabel="Seçenekler: belge okut düğmeleri">
          <Icon source="cog-outline" size={26} color={colors.textSecondary} />
        </TouchableRipple>
      )}
    </>
  );

  return (
    <View style={[styles.wrap, wide && styles.wrapWide]}>
      <TextInput
        mode="outlined"
        dense={false}
        placeholder="Ara: no, parti, müşteri, kumaş…"
        accessibilityLabel={`${TERIM.terbiyeIsEmri.tekil} ara: no, parti, müşteri, kumaş, renk, sipariş`}
        value={value.search}
        onChangeText={(search) => set({ search })}
        outlineColor={colors.borderStrong}
        activeOutlineColor={colors.brand}
        outlineStyle={styles.searchOutline}
        contentStyle={styles.searchContent}
        left={<TextInput.Icon icon={searching ? 'timer-sand' : 'magnify'} />}
        right={value.search ? <TextInput.Icon icon="close" onPress={() => set({ search: '' })} accessibilityLabel="Aramayı temizle" /> : undefined}
        style={[styles.search, wide && styles.searchWide]}
        testID="ie-liste-arama"
      />
      {wide ? <View style={styles.buttons}>{buttons}</View> : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.buttons}>{buttons}</ScrollView>}

      <PickerModal
        visible={picker === 'status'}
        title="Durum"
        options={STATUS_FILTER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        selectedValue={value.status}
        onSelect={(v) => { set({ status: v as StatusFilter }); setPicker(null); }}
        onDismiss={() => setPicker(null)}
        disableSort
      />
      <PickerModal
        visible={picker === 'station'}
        title="Şu an nerede (istasyon)"
        options={stationOptions}
        selectedValue={value.stationId ?? ALL_STATIONS}
        loading={stationsLoading}
        emptyText="İstasyon bulunamadı."
        onSelect={(v) => { set({ stationId: v === ALL_STATIONS ? null : v }); setPicker(null); }}
        onDismiss={() => setPicker(null)}
        disableSort
      />
      <DateRangeSheet visible={picker === 'date'} initial={value.range} onDismiss={() => setPicker(null)} onApply={(range) => { set({ range }); setPicker(null); }} />
    </View>
  );
}

function FilterButton({ icon, caption, label, active, onPress, onClear, testID }: { icon: string; caption: string; label: string; active: boolean; onPress: () => void; onClear?: () => void; testID: string }) {
  return (
    <TouchableRipple onPress={onPress} rippleColor={colors.brandSoft} style={[styles.btn, active && styles.btnActive]} testID={testID} accessibilityRole="button" accessibilityLabel={`${caption}: ${label}`}>
      <View style={styles.btnInner}>
        <Icon source={icon} size={24} color={active ? colors.brand : colors.textSecondary} />
        <View style={styles.btnText}>
          <Text style={styles.caption}>{caption}</Text>
          <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>{label}</Text>
        </View>
        {onClear && (
          <TouchableRipple onPress={onClear} style={styles.clearBtn} borderless accessibilityRole="button" accessibilityLabel={`${caption} süzgecini kaldır`}>
            <Icon source="close-circle" size={22} color={colors.textSecondary} />
          </TouchableRipple>
        )}
        <View style={[styles.chevron, active && styles.chevronActive]}>
          <Icon source="chevron-down" size={22} color={active ? colors.brand : colors.textSecondary} />
        </View>
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  // Bant: kendi yüzeyi, tam genişlik, alt kenar + gölge — listeden ayrı bölge.
  wrap: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.borderStrong, ...shadow.sm, zIndex: 1 },
  wrapWide: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  search: { backgroundColor: colors.appBg, fontSize: typography.size.base, height: 56 },
  searchOutline: { borderRadius: radius.md, borderWidth: 1.5 },
  searchContent: { height: 56 },
  searchWide: { flex: 1, minWidth: 320 },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  btn: { height: 56, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.appBg, justifyContent: 'center', overflow: 'hidden' },
  iconBtn: { width: 56, alignItems: 'center' },
  chevron: { width: 28, height: 28, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  chevronActive: { backgroundColor: colors.surface },
  btnActive: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  btnText: { maxWidth: 150 },
  caption: { fontSize: typography.size.sm, color: colors.textMuted },
  label: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  labelActive: { color: colors.brandDark },
  clearBtn: { width: 56, minHeight: 54, alignItems: 'center', justifyContent: 'center', marginRight: -spacing.sm },
});
