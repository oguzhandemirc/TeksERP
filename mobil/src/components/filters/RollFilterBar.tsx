// =============================================================================
// RollFilterBar — KK1 "Tüm Girişler" + Tambur "Son Çıkan Toplar" ORTAK filtresi
// =============================================================================
// TEK YER, İKİ EKRAN (2026-08-12 kullanıcı kararı). İki modal aynı soruyu
// soruyor ("hangi tarihte, hangi kumaş"); ayrı ayrı yazılsalardı kaçınılmaz
// olarak ayrışırlardı — aynı düğme iki listede farklı aralık demeye başlardı.
//
// SADE UI: tek satır çip şeridi. Kısa yollar solda (tek dokunuş), özel tarih ve
// kumaş sağda. Filtre aktifken şerit renklenir ve "Temizle" belirir; hiçbir
// filtre yokken ekstra kutu/başlık ÇİZİLMEZ — liste bugünküyle aynı görünür.
//
// Karar mantığı burada DEĞİL, `rollHistoryFilter.ts`te (saf + test edilebilir).
// =============================================================================

import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';
import PickerModal, { type PickerOption } from '../PickerModal';
import DateRangeSheet from './DateRangeSheet';
import {
  EMPTY_ROLL_FILTER,
  QUICK_LABELS,
  effectiveRange,
  formatRange,
  hasActiveFilter,
  type QuickRangeKind,
  type RollHistoryFilterState,
} from './rollHistoryFilter';

const QUICKS: QuickRangeKind[] = ['all', 'today', 'yesterday', 'last7'];

interface Props {
  value: RollHistoryFilterState;
  onChange: (next: RollHistoryFilterState) => void;
  /** Kumaş seçenekleri (id + ad). Boşsa kumaş çipi yine çıkar, liste "yükleniyor" der. */
  itemOptions: PickerOption[];
  itemsLoading?: boolean;
  /** Kumaş listesi modalı açıldığında tazelensin diye (admin yeni kumaş eklemiş olabilir). */
  onItemPickerOpen?: () => void;
  /** OPSİYONEL eksenler (2026-08-12): verilirse çipi çizilir, verilmezse şerit
   *  bugünküyle birebir aynı kalır — Tambur bu ikisini hiç geçmez. KK1 "Tüm
   *  Girişler"de operatör çipi yalnız bayrak açıkken geçilir (kapalıyken liste
   *  zaten kişiye özel; ölü bir filtre çizmek "bastım, olmadı" üretir). */
  operatorOptions?: PickerOption[];
  operatorsLoading?: boolean;
  entryStationOptions?: PickerOption[];
  entryStationsLoading?: boolean;
  /** Ekrana özel tek-dokunuş tuşları (örn. Tambur "Bu makine") — kısa yolların
   *  hemen ardına, aynı şeridin içine çizilir; ayrı bir satır açmaz. */
  extraChips?: {
    key: string;
    label: string;
    icon?: string;
    active: boolean;
    onPress: () => void;
  }[];
  /** Şeridin dış kapsayıcısına ek stil — HİZALAMA içindir (örn. Tambur'da
   *  arama kutusuyla aynı 12px iç boşluk). Görsel kimlik burada kalır. */
  style?: StyleProp<ViewStyle>;
}

/**
 * İKİ ÇİP TÜRÜ, GÖRSEL OLARAK AYRI (2026-08-12 saha isteği):
 *  • `toggle` — tek dokunuşta uygulanan kısa yol (Bugün/Dün/…). Sonuç anında.
 *  • `picker` — DOKUNUNCA BİR EKRAN AÇAR (Tarih seç / Kumaş Seç). Beyaz zemin,
 *    daha koyu ve kalın kenarlık, sağda ▾ işareti. Aynı görünseydi operatör
 *    "bastım, bir şey olmadı" derdi — oysa açılan seçiciyi bekliyor olmalı.
 * Aktif hâl İKİSİNDE DE dolu mavidir: "filtre şu an uygulanıyor" mesajı
 * türden bağımsız aynı kalmalı.
 */
function Chip({
  label,
  active,
  icon,
  onPress,
  variant = 'toggle',
}: {
  label: string;
  active?: boolean;
  icon?: string;
  onPress: () => void;
  variant?: 'toggle' | 'picker';
}) {
  const isPicker = variant === 'picker';
  const fg = active ? '#fff' : isPicker ? '#1e293b' : '#475569';
  return (
    <TouchableRipple
      onPress={onPress}
      style={[styles.chip, isPicker && styles.chipPicker, active && styles.chipActive]}
      borderless
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      accessibilityLabel={isPicker ? `${label} — seçim ekranı açar` : label}
    >
      {/* TouchableRipple TEK element çocuk ister (Children.only). */}
      <View style={styles.chipInner}>
        {icon ? <Icon source={icon} size={15} color={fg} /> : null}
        <Text
          style={[styles.chipText, isPicker && styles.chipTextPicker, active && styles.chipTextActive]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {/* ▾ = "burada bir liste açılır" — türü tek bakışta ayıran işaret. */}
        {isPicker ? <Icon source="chevron-down" size={16} color={fg} /> : null}
      </View>
    </TouchableRipple>
  );
}

export default function RollFilterBar({
  value,
  onChange,
  itemOptions,
  itemsLoading,
  onItemPickerOpen,
  operatorOptions,
  operatorsLoading,
  entryStationOptions,
  entryStationsLoading,
  extraChips,
  style,
}: Props) {
  const [dateOpen, setDateOpen] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [stationOpen, setStationOpen] = useState(false);

  // Gün sınırı SORGU ANINDA çözülür; her render'da yeni `Date` üretmek
  // (ve onu react-query anahtarına sızdırmak) listeyi sonsuz tazeletirdi.
  const now = useMemo(() => new Date(), [value]);
  const range = effectiveRange(value, now);
  const active = hasActiveFilter(value);

  return (
    <View style={[styles.wrap, style]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
      >
        {QUICKS.map((k) => (
          <Chip
            key={k}
            label={QUICK_LABELS[k]}
            // Özel aralık seçiliyken hiçbir kısa yol "seçili" görünmemeli —
            // aksi hâlde ekran iki farklı aralığı aynı anda iddia ederdi.
            active={!value.custom && value.quick === k}
            onPress={() => onChange({ ...value, quick: k, custom: null })}
          />
        ))}

        {(extraChips ?? []).map((c) => (
          <Chip key={c.key} label={c.label} icon={c.icon} active={c.active} onPress={c.onPress} />
        ))}

        <Chip
          label={value.custom ? formatRange(value.custom) : 'Tarih seç'}
          icon="calendar-range"
          variant="picker"
          active={!!value.custom}
          onPress={() => setDateOpen(true)}
        />

        <Chip
          label={value.itemLabel ?? 'Kumaş Seç'}
          icon="cube-outline"
          variant="picker"
          active={!!value.itemId}
          onPress={() => {
            onItemPickerOpen?.();
            setItemOpen(true);
          }}
        />

        {operatorOptions ? (
          <Chip
            label={value.operatorLabel ?? 'Personel'}
            icon="account-outline"
            variant="picker"
            active={!!value.operatorId}
            onPress={() => setOperatorOpen(true)}
          />
        ) : null}

        {entryStationOptions ? (
          <Chip
            label={value.entryStationLabel ?? 'Giriş İstasyonu'}
            icon="map-marker-outline"
            variant="picker"
            active={!!value.entryStationId}
            onPress={() => setStationOpen(true)}
          />
        ) : null}

        {active ? (
          <Chip
            label="Temizle"
            icon="close-circle-outline"
            onPress={() => onChange(EMPTY_ROLL_FILTER)}
          />
        ) : null}
      </ScrollView>

      {/* Seçili aralığın okunur özeti — çipe sığmayan uzun aralıkta bile net. */}
      {range && !value.custom ? (
        <Text style={styles.summary}>{formatRange(range)}</Text>
      ) : null}

      <DateRangeSheet
        visible={dateOpen}
        onDismiss={() => setDateOpen(false)}
        initial={value.custom}
        onApply={(r) => {
          setDateOpen(false);
          // Özel aralık kısa yolu EZER (tek kaynak: `custom` doluysa o geçerli).
          onChange({ ...value, custom: r, quick: 'all' });
        }}
      />

      {operatorOptions ? (
        <PickerModal
          visible={operatorOpen}
          onDismiss={() => setOperatorOpen(false)}
          title="Personel Seç"
          options={operatorOptions}
          loading={operatorsLoading}
          selectedValue={value.operatorId ?? undefined}
          onSelect={(picked) => {
            setOperatorOpen(false);
            const same = picked === value.operatorId;
            onChange({
              ...value,
              operatorId: same ? null : picked,
              operatorLabel: same
                ? null
                : (operatorOptions.find((o) => o.value === picked)?.label ?? null),
            });
          }}
        />
      ) : null}

      {entryStationOptions ? (
        <PickerModal
          visible={stationOpen}
          onDismiss={() => setStationOpen(false)}
          title="Giriş İstasyonu Seç"
          options={entryStationOptions}
          loading={entryStationsLoading}
          selectedValue={value.entryStationId ?? undefined}
          onSelect={(picked) => {
            setStationOpen(false);
            const same = picked === value.entryStationId;
            onChange({
              ...value,
              entryStationId: same ? null : picked,
              entryStationLabel: same
                ? null
                : (entryStationOptions.find((o) => o.value === picked)?.label ?? null),
            });
          }}
        />
      ) : null}

      <PickerModal
        visible={itemOpen}
        onDismiss={() => setItemOpen(false)}
        title="Kumaş Seç"
        options={itemOptions}
        loading={itemsLoading}
        selectedValue={value.itemId ?? undefined}
        onSelect={(picked) => {
          setItemOpen(false);
          // Aynı kumaşa tekrar dokunmak filtreyi KALDIRIR — ayrı bir "kaldır"
          // düğmesi aramak zorunda kalmasın (şeritteki Temizle hepsini siler).
          const same = picked === value.itemId;
          onChange({
            ...value,
            itemId: same ? null : picked,
            itemLabel: same ? null : (itemOptions.find((o) => o.value === picked)?.label ?? null),
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: 4 },
  row: { flexDirection: 'row', gap: 6, paddingVertical: 6, paddingRight: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    overflow: 'hidden',
  },
  // Seçici çipi: beyaz zemin + daha koyu/kalın kenarlık → "bu bir kapı".
  chipPicker: {
    backgroundColor: '#fff',
    borderColor: '#94a3b8',
    borderWidth: 1.5,
  },
  chipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb', borderWidth: 1.5 },
  chipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontSize: 13, fontWeight: '700', color: '#475569', maxWidth: 190 },
  chipTextPicker: { color: '#1e293b', fontWeight: '800' },
  chipTextActive: { color: '#fff' },
  summary: { fontSize: 12, color: '#64748b', paddingLeft: 4, paddingBottom: 2 },
});
