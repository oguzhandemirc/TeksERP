// İş Emirleri — üst süzgeç BANDI (kendi yüzeyi + alt kenar/gölge): arama + Durum / İstasyon (PickerModal) + Tarih
// (DateRangeSheet) + Sütunlar + Seçenekler. Arama ve süzgeç kutuları tek dil: aynı yükseklik (56), köşe ve kenarlık.
// Tablette tek satır; 600–720dp'de arama üstte, düğmeler altta yatay kayar. Dar ekranda (el terminali, <600dp) arama 🔍
// düğmesine iner (dokununca aynı satırda açılır), süzgeçler tek satır kompakt çip (ikon + kısa değer). Süzme SUNUCUDA.
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Icon, Text, TextInput, TouchableRipple } from 'react-native-paper';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import DateRangeSheet from '../../../components/filters/DateRangeSheet';
import { formatRange } from '../../../components/filters/rollHistoryFilter';
import TruncatedText from '../../../components/TruncatedText';
import { useIsCompact } from '../../../hooks/useDeviceType';
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
  const compact = useIsCompact();
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

  const pickers = <FilterPickers picker={picker} close={() => setPicker(null)} value={value} set={set} stationOptions={stationOptions} stationsLoading={stationsLoading} />;

  if (compact) {
    return (
      <CompactFilterBar
        value={value}
        set={set}
        searching={searching}
        statusLabel={statusLabel}
        stationLabel={value.stationId ? stationLabel : 'Nerede'}
        dateLabel={value.range ? dateLabel : 'Tarih'}
        onPick={setPicker}
        onColumns={onColumns}
        onOptions={onOptions}
      >
        {pickers}
      </CompactFilterBar>
    );
  }

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
      {pickers}
    </View>
  );
}

/** Durum / istasyon seçicileri + tarih sayfası (geniş ve dar bant ortak). */
function FilterPickers({ picker, close, value, set, stationOptions, stationsLoading }: { picker: 'status' | 'station' | 'date' | null; close: () => void; value: ListFilters; set: (patch: Partial<ListFilters>) => void; stationOptions: PickerOption[]; stationsLoading: boolean }) {
  return (
    <>
      <PickerModal
        visible={picker === 'status'}
        title="Durum"
        options={STATUS_FILTER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        selectedValue={value.status}
        onSelect={(v) => { set({ status: v as StatusFilter }); close(); }}
        onDismiss={() => close()}
        disableSort
      />
      <PickerModal
        visible={picker === 'station'}
        title="Şu an nerede (istasyon)"
        options={stationOptions}
        selectedValue={value.stationId ?? ALL_STATIONS}
        loading={stationsLoading}
        emptyText="İstasyon bulunamadı."
        onSelect={(v) => { set({ stationId: v === ALL_STATIONS ? null : v }); close(); }}
        onDismiss={() => close()}
        disableSort
      />
      <DateRangeSheet visible={picker === 'date'} initial={value.range} onDismiss={() => close()} onApply={(range) => { set({ range }); close(); }} />
    </>
  );
}

interface CompactProps {
  value: ListFilters;
  set: (patch: Partial<ListFilters>) => void;
  searching: boolean;
  statusLabel: string;
  stationLabel: string;
  dateLabel: string;
  onPick: (p: 'status' | 'station' | 'date') => void;
  onColumns: () => void;
  onOptions?: () => void;
  children: React.ReactNode;
}

/** Dar ekran bandı: 🔍 düğmesi + kompakt çipler; arama açıkken satırı arama kutusu kaplar (✕ metni siler, ⌃ kapatır). */
function CompactFilterBar({ value, set, searching, statusLabel, stationLabel, dateLabel, onPick, onColumns, onOptions, children }: CompactProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const hasSearch = value.search.trim().length > 0;
  return (
    <View style={[styles.wrap, styles.wrapCompact]} testID="ie-liste-suzgec-dar">
      {searchOpen ? (
        <View style={styles.compactRow}>
          <TextInput
            mode="outlined"
            dense={false}
            autoFocus
            placeholder="No, parti, müşteri, kumaş…"
            accessibilityLabel={`${TERIM.terbiyeIsEmri.tekil} ara: no, parti, müşteri, kumaş, renk, sipariş`}
            value={value.search}
            onChangeText={(search) => set({ search })}
            onBlur={() => { if (!hasSearch) setSearchOpen(false); }}
            outlineColor={colors.borderStrong}
            activeOutlineColor={colors.brand}
            outlineStyle={styles.searchOutline}
            contentStyle={styles.searchContent}
            left={<TextInput.Icon icon={searching ? 'timer-sand' : 'magnify'} />}
            right={hasSearch ? <TextInput.Icon icon="close" onPress={() => set({ search: '' })} accessibilityLabel="Aramayı temizle" /> : undefined}
            style={[styles.search, styles.grow]}
            testID="ie-liste-arama"
          />
          <TouchableRipple onPress={() => setSearchOpen(false)} rippleColor={colors.brandSoft} style={[styles.btn, styles.iconBtn]} testID="ie-liste-arama-kapat" accessibilityRole="button" accessibilityLabel="Aramayı kapat">
            <Icon source="chevron-up" size={26} color={colors.textSecondary} />
          </TouchableRipple>
        </View>
      ) : (
        <View style={styles.compactRow}>
          <TouchableRipple
            onPress={() => setSearchOpen(true)}
            rippleColor={colors.brandSoft}
            style={[styles.btn, styles.iconBtn, hasSearch && styles.btnActive]}
            testID="ie-liste-arama-ac"
            accessibilityRole="button"
            accessibilityLabel={hasSearch ? `Ara: ${value.search} (etkin)` : 'Ara'}
            accessibilityState={{ selected: hasSearch }}
          >
            <View>
              <Icon source="magnify" size={26} color={hasSearch ? colors.brand : colors.textSecondary} />
              {hasSearch && <View style={styles.activeDot} testID="ie-liste-arama-etkin" />}
            </View>
          </TouchableRipple>
          {/* Tarih ikinci sırada: dar ekranda kaydırmadan görünür kalsın. */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.grow} contentContainerStyle={styles.buttons}>
            <CompactChip icon="list-status" caption="Durum" label={statusLabel} active={value.status !== 'OPEN'} onPress={() => onPick('status')} testID="ie-liste-durum" />
            <CompactChip icon="calendar-range" caption="Açılış tarihi" label={dateLabel} active={!!value.range} onPress={() => onPick('date')} onClear={value.range ? () => set({ range: null }) : undefined} testID="ie-liste-tarih" />
            <CompactChip icon="map-marker-radius-outline" caption="Şu an nerede" label={stationLabel} active={!!value.stationId} onPress={() => onPick('station')} testID="ie-liste-istasyon" />
            <TouchableRipple onPress={onColumns} rippleColor={colors.brandSoft} style={[styles.btn, styles.iconBtn]} testID="ie-liste-sutunlar" accessibilityRole="button" accessibilityLabel="Görünüm: Sütunlar">
              <Icon source="view-column-outline" size={24} color={colors.textSecondary} />
            </TouchableRipple>
            {onOptions && (
              <TouchableRipple onPress={onOptions} rippleColor={colors.brandSoft} style={[styles.btn, styles.iconBtn]} testID="ie-secenekler" accessibilityRole="button" accessibilityLabel="Seçenekler: belge okut düğmeleri">
                <Icon source="cog-outline" size={24} color={colors.textSecondary} />
              </TouchableRipple>
            )}
          </ScrollView>
        </View>
      )}
      {children}
    </View>
  );
}

/** Dar ekran çipi: ikon + kısa değer, tek satır (başlık erişilebilirlik adında); etkin tarih ✕ ile kaldırılır. */
function CompactChip({ icon, caption, label, active, onPress, onClear, testID }: { icon: string; caption: string; label: string; active: boolean; onPress: () => void; onClear?: () => void; testID: string }) {
  return (
    <TouchableRipple onPress={onPress} rippleColor={colors.brandSoft} style={[styles.btn, styles.chipCompact, active && styles.btnActive]} testID={testID} accessibilityRole="button" accessibilityLabel={`${caption}: ${label}`}>
      <View style={styles.chipInner}>
        <Icon source={icon} size={20} color={active ? colors.brand : colors.textSecondary} />
        <TruncatedText style={[styles.chipLabel, active && styles.labelActive]}>{label}</TruncatedText>
        {onClear && (
          <TouchableRipple onPress={onClear} style={styles.clearBtn} borderless accessibilityRole="button" accessibilityLabel={`${caption} süzgecini kaldır`} testID={`${testID}-kaldir`}>
            <Icon source="close-circle" size={22} color={colors.textSecondary} />
          </TouchableRipple>
        )}
      </View>
    </TouchableRipple>
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
  wrapCompact: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  activeDot: { position: 'absolute', top: -2, right: -4, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand, borderWidth: 1.5, borderColor: colors.surface },
  chipCompact: { paddingHorizontal: spacing.md },
  chipInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  chipLabel: { maxWidth: 130, fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  clearBtn: { width: 56, minHeight: 54, alignItems: 'center', justifyContent: 'center', marginRight: -spacing.sm },
});
