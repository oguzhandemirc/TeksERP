import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  useWindowDimensions,
  Keyboard,
  TextInput as RNTextInput,
} from 'react-native';
import RefreshButton from './RefreshButton';
import AppModal from './AppModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDeviceType } from '../hooks/useDeviceType';
import {
  Text,
  TextInput,
  IconButton,
  Button,
  TouchableRipple,
  ActivityIndicator,
} from 'react-native-paper';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import Pager from './Pager';
import { colors } from '../theme';

export interface PickerOption {
  value: string;
  label: string;
  sublabel?: string;
  /** Zengin görünüm — çok satırlı detay (iş emri, ürün vb için) */
  details?: string[];
  /** Sağ üst köşede gösterilecek küçük renkli etiket (status chip vb) */
  badge?: { text: string; color: string };
}

export interface SortOption {
  value: string;
  label: string;
  icon?: string;
}

interface BaseProps {
  visible: boolean;
  title: string;
  options: PickerOption[];
  selectedValue?: string | null;
  onSelect: (value: string) => void;
  onDismiss: () => void;
  emptyText?: string;
  loading?: boolean;
  numColumns?: number;
  /** Header'da yenile ikonu — basıldığında parent refetch yapar. */
  onRefresh?: () => void;
  /** Yenileme veya fetch sürerken refresh ikonu döner. */
  refreshing?: boolean;
  /** Son fetch başarısız oldu mu — bitiş haptic'i + error toast için. */
  refreshError?: boolean;
  /** Hata mesajı (toast'ta gösterilir). */
  refreshErrorMessage?: string;
  /** Üstte ÇERÇEVELİ sabit grup — verilen sırada (alfabetik sıralanmaz, A-Z'ye
   *  dahil değil). Asıl liste bu çerçevenin DIŞINDA, altından başlar. Örn. "bu
   *  iş emrinde siparişi olan müşteriler". Aramayla birlikte filtrelenir. */
  pinnedOptions?: PickerOption[];
  /** Çerçevenin üstündeki küçük başlık. */
  pinnedLabel?: string;
}

interface PaginatedProps extends BaseProps {
  /**
   * Sunucu tarafı sayfalama / arama / sıralama modu.
   * - `options` parent tarafından server-side fetch ile hazırlanır
   * - In-memory filter kapalı; arama yalnızca "Ara" butonu / Enter ile tetiklenir
   * - Pagination ve sort callback'leri parent'a bildirilir
   */
  paginated: true;
  searchValue: string;
  onSearchSubmit: (q: string) => void;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  sortOptions?: SortOption[];
  selectedSort?: string;
  onSortChange?: (value: string) => void;
  fetching?: boolean;
}

interface ClientProps extends BaseProps {
  paginated?: false;
}

type Props = PaginatedProps | ClientProps;

// Modül seviyesinde kararlı referans — her render'da yeni fn üretip FlashList'i
// gereksiz yere yeniden çalıştırmasın.
const keyExtractor = (item: PickerOption) => item.value;

export default function PickerModal(props: Props) {
  const {
    visible,
    title,
    options,
    selectedValue,
    onSelect,
    onDismiss,
    emptyText = 'Seçenek yok',
    loading,
    numColumns = 4,
    onRefresh,
    refreshing = false,
    refreshError = false,
    refreshErrorMessage,
    pinnedOptions = [],
    pinnedLabel,
  } = props;

  const paginated = props.paginated === true;
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const device = useDeviceType();
  const isPhone = device === 'phone';
  const effectiveColumns = isPhone ? 1 : numColumns;

  // Modal dikeyde/yatayda ORTALI olduğundan, güvenli alan (durum/nav çubuğu,
  // çentik) dışına taşmaması için sheet boyutu hem oran hem de
  // (ekran − 2×max(inset)) ile sınırlanır — özellikle tablette önemli.
  const maxSheetH = winH - 2 * Math.max(insets.top, insets.bottom) - 24;
  const maxSheetW = winW - 2 * Math.max(insets.left, insets.right) - 24;
  const searchRef = useRef<RNTextInput>(null);
  const listRef = useRef<FlashListRef<PickerOption>>(null);

  // Client-mode: in-memory arama
  const [clientSearch, setClientSearch] = useState('');
  // Paginated-mode: kontrollü arama input metni (henüz submit edilmemiş)
  const [pendingSearch, setPendingSearch] = useState('');

  useEffect(() => {
    if (!visible) {
      searchRef.current?.blur();
      Keyboard.dismiss();
    }
  }, [visible]);

  // Modal açılınca paginated mode'da pending search'ü server'daki ile eşitle
  useEffect(() => {
    if (paginated && visible) {
      setPendingSearch((props as PaginatedProps).searchValue);
    }
  }, [visible, paginated]);

  // Sort yalnızca options değişiminde — her tuş basışında yeniden sıralanmasın
  // (localeCompare 'tr' büyük listelerde O(n log n) yüksek sabit faktörlü).
  const sortedOptions = useMemo(() => {
    if (paginated) return options;
    return [...options].sort((a, b) =>
      a.label.localeCompare(b.label, 'tr', { sensitivity: 'base' }),
    );
  }, [paginated, options]);

  // Filter ayrı useMemo: arama değiştikçe yalnızca filtreyi tekrar uygula.
  const listData = useMemo(() => {
    if (paginated) return sortedOptions;
    const q = clientSearch.trim().toLocaleLowerCase('tr');
    if (!q) return sortedOptions;
    return sortedOptions.filter(
      (o) =>
        o.label.toLocaleLowerCase('tr').includes(q) ||
        (o.sublabel?.toLocaleLowerCase('tr').includes(q) ?? false),
    );
  }, [paginated, sortedOptions, clientSearch]);

  // A-Z hızlı indeks (yalnız client mode) — listData zaten alfabetik sıralı, her
  // harfin ilk görünümünün index'ini tutarız. Operatör harfe basınca o gruba
  // atlar (arama kutusuna yazmak yerine — onlarca üründe pratik).
  const azIndex = useMemo(() => {
    if (paginated) return [] as { letter: string; index: number }[];
    const seen = new Map<string, number>();
    listData.forEach((o, i) => {
      const ch = (o.label?.trim()?.[0] ?? '').toLocaleUpperCase('tr');
      if (ch && !seen.has(ch)) seen.set(ch, i);
    });
    return Array.from(seen.entries()).map(([letter, index]) => ({ letter, index }));
  }, [paginated, listData]);

  const jumpToLetter = (index: number) => {
    Haptics.selectionAsync().catch(() => {});
    listRef.current?.scrollToIndex({ index, animated: true });
  };

  // Tek, kararlı seçim handler'ı — hem çerçeveli grup hem ana liste kullanır.
  // useCallback olmadan her render'da yeni closure üretir, PickerCard memo'sunu
  // kırardı (tüm görünür kartlar yeniden render).
  const handlePick = useCallback(
    (value: string) => {
      onSelect(value);
      onDismiss();
      if (!paginated) setClientSearch('');
    },
    [onSelect, onDismiss, paginated],
  );

  // Çerçeveli sabit grup — aramayla birlikte filtrelenir, alfabetik sıralanmaz.
  const filteredPinned = useMemo(() => {
    if (paginated || pinnedOptions.length === 0) return [] as PickerOption[];
    const q = clientSearch.trim().toLocaleLowerCase('tr');
    if (!q) return pinnedOptions;
    return pinnedOptions.filter(
      (o) =>
        o.label.toLocaleLowerCase('tr').includes(q) ||
        (o.sublabel?.toLocaleLowerCase('tr').includes(q) ?? false),
    );
  }, [paginated, pinnedOptions, clientSearch]);

  const pinnedHeader =
    filteredPinned.length > 0 ? (
      <View style={styles.pinnedFrame}>
        {pinnedLabel ? (
          <Text style={styles.pinnedLabel}>{pinnedLabel}</Text>
        ) : null}
        <View style={styles.pinnedGrid}>
          {filteredPinned.map((item) => (
            <View
              key={item.value}
              style={{ width: `${100 / effectiveColumns}%` as `${number}%` }}
            >
              <PickerCard
                option={item}
                selected={item.value === selectedValue}
                onPress={handlePick}
              />
            </View>
          ))}
        </View>
      </View>
    ) : null;

  // Kararlı renderItem — yalnız seçim değişince kimliği değişir; PickerCard
  // React.memo olduğundan sadece eski/yeni seçili kart yeniden render olur.
  const renderItem = useCallback(
    ({ item }: { item: PickerOption }) => (
      <PickerCard
        option={item}
        selected={item.value === selectedValue}
        onPress={handlePick}
      />
    ),
    [selectedValue, handlePick],
  );

  // Paginated submit handler
  const submitSearch = () => {
    if (!paginated) return;
    (props as PaginatedProps).onSearchSubmit(pendingSearch.trim());
    Keyboard.dismiss();
  };

  // Ortak AppModal (react-native-paper Portal+Modal). Tek opacity Animated.Value
  // backdrop + içeriği BİRLİKTE fade ettiğinden react-native-modal'ın New Arch'taki
  // "kapan→aç→kapan" desenkron flicker'ı yapısal olarak imkânsız. Ayrı native pencere
  // açmaz → eski fullscreen backdrop hack'ine de gerek kalmadı.
  return (
    <AppModal
      visible={visible}
      onDismiss={onDismiss}
      contentStyle={[
        styles.sheet,
        {
          width: Math.min(isPhone ? winW * 0.95 : winW * 0.82, maxSheetW),
          height: Math.min(isPhone ? winH * 0.85 : winH * 0.8, maxSheetH),
        },
      ]}
    >
        {/* Başlık satırı — telefonda search ayrı satıra düşer */}
        <View style={styles.header}>
          <Text variant="titleLarge" style={styles.title} numberOfLines={1}>
            {title}
          </Text>

          {onRefresh && (
            <RefreshButton
              onPress={onRefresh}
              refreshing={refreshing}
              isError={refreshError}
              errorMessage={refreshErrorMessage}
            />
          )}

          {!isPhone && (
            <SearchControls
              paginated={paginated}
              isPhone={false}
              searchRef={searchRef}
              pendingSearch={pendingSearch}
              setPendingSearch={setPendingSearch}
              clientSearch={clientSearch}
              setClientSearch={setClientSearch}
              submitSearch={submitSearch}
              onSearchSubmit={
                paginated ? (props as PaginatedProps).onSearchSubmit : undefined
              }
            />
          )}

          <IconButton
            icon="close"
            size={22}
            onPress={onDismiss}
            style={styles.headerBtn}
          />
        </View>

        {isPhone && (
          <View style={styles.headerSearchRow}>
            <SearchControls
              paginated={paginated}
              isPhone
              searchRef={searchRef}
              pendingSearch={pendingSearch}
              setPendingSearch={setPendingSearch}
              clientSearch={clientSearch}
              setClientSearch={setClientSearch}
              submitSearch={submitSearch}
              onSearchSubmit={
                paginated ? (props as PaginatedProps).onSearchSubmit : undefined
              }
            />
          </View>
        )}

        {/* Sort segments — sadece paginated modda */}
        {paginated &&
          (props as PaginatedProps).sortOptions &&
          (props as PaginatedProps).sortOptions!.length > 0 && (
            <View style={styles.sortRow}>
              {(props as PaginatedProps).sortOptions!.map((opt) => {
                const selected = (props as PaginatedProps).selectedSort === opt.value;
                return (
                  <TouchableRipple
                    key={opt.value}
                    borderless
                    rippleColor="rgba(79, 70, 229, 0.15)"
                    onPress={() =>
                      (props as PaginatedProps).onSortChange?.(opt.value)
                    }
                    style={[styles.sortChip, selected && styles.sortChipActive]}
                  >
                    <Text
                      style={[
                        styles.sortChipText,
                        selected && styles.sortChipTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableRipple>
                );
              })}
            </View>
          )}

        {/* Liste */}
        <View style={styles.listBox}>
          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color="#4f46e5" />
            </View>
          ) : listData.length === 0 && filteredPinned.length === 0 ? (
            <Text style={styles.empty}>{emptyText}</Text>
          ) : (
            <View style={styles.listRow}>
              <View style={{ flex: 1 }}>
                <FlashList
                  ref={listRef}
                  data={listData}
                  keyExtractor={keyExtractor}
                  numColumns={effectiveColumns}
                  ListHeaderComponent={pinnedHeader}
                  renderItem={renderItem}
                />
              </View>
              {/* A-Z hızlı indeks — client modda, yeterli kayıt varsa */}
              {azIndex.length > 1 && (
                <View style={styles.azStrip}>
                  {azIndex.map(({ letter, index }) => (
                    <TouchableRipple
                      key={letter}
                      borderless
                      rippleColor="rgba(79, 70, 229, 0.15)"
                      onPress={() => jumpToLetter(index)}
                      style={styles.azLetterTouch}
                      accessibilityLabel={`${letter} harfine git`}
                    >
                      <Text style={styles.azLetter}>{letter}</Text>
                    </TouchableRipple>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>

        {/* Sayfalama — paginated modda */}
        {paginated && (
          <Pager
            page={(props as PaginatedProps).page}
            totalPages={(props as PaginatedProps).totalPages}
            fetching={(props as PaginatedProps).fetching}
            onPageChange={(props as PaginatedProps).onPageChange}
            size="medium"
            style={styles.pagination}
          />
        )}
    </AppModal>
  );
}

function SearchControls({
  paginated,
  isPhone,
  searchRef,
  pendingSearch,
  setPendingSearch,
  clientSearch,
  setClientSearch,
  submitSearch,
  onSearchSubmit,
}: {
  paginated: boolean;
  isPhone: boolean;
  searchRef: React.RefObject<RNTextInput | null>;
  pendingSearch: string;
  setPendingSearch: (v: string) => void;
  clientSearch: string;
  setClientSearch: (v: string) => void;
  submitSearch: () => void;
  onSearchSubmit?: (q: string) => void;
}) {
  if (paginated) {
    return (
      <View style={[styles.searchGroup, isPhone && styles.searchGroupPhone]}>
        <TextInput
          ref={searchRef as React.Ref<any>}
          mode="outlined"
          dense
          placeholder="Ara..."
          value={pendingSearch}
          onChangeText={setPendingSearch}
          onSubmitEditing={submitSearch}
          returnKeyType="search"
          left={<TextInput.Icon icon="magnify" />}
          right={
            pendingSearch.length > 0 ? (
              <TextInput.Icon
                icon="close"
                onPress={() => {
                  setPendingSearch('');
                  onSearchSubmit?.('');
                }}
              />
            ) : undefined
          }
          style={[styles.searchInput, isPhone && styles.searchInputPhonePaginated]}
          showSoftInputOnFocus
        />
        <Button
          mode="contained"
          icon="magnify"
          onPress={submitSearch}
          style={styles.searchBtn}
          contentStyle={styles.searchBtnContent}
          labelStyle={styles.searchBtnLabel}
        >
          Ara
        </Button>
      </View>
    );
  }
  return (
    <TextInput
      ref={searchRef as React.Ref<any>}
      mode="outlined"
      dense
      placeholder="Ara..."
      value={clientSearch}
      onChangeText={setClientSearch}
      left={<TextInput.Icon icon="magnify" />}
      style={[styles.searchInput, isPhone && styles.searchInputPhone]}
      showSoftInputOnFocus
    />
  );
}

const PickerCard = React.memo(function PickerCard({
  option,
  selected,
  onPress,
}: {
  option: PickerOption;
  selected: boolean;
  onPress: (value: string) => void;
}) {
  const hasDetails = !!option.details?.length;
  return (
    <View style={styles.cardWrap}>
      <TouchableRipple
        onPress={() => onPress(option.value)}
        borderless
        rippleColor="rgba(79, 70, 229, 0.15)"
        style={[
          styles.card,
          selected && styles.cardSelected,
          hasDetails && styles.cardRich,
        ]}
      >
        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <Text variant="titleMedium" style={styles.cardLabel} numberOfLines={2}>
              {option.label}
            </Text>
            {option.badge ? (
              <View style={[styles.cardBadge, { backgroundColor: option.badge.color }]}>
                <Text style={styles.cardBadgeText}>{option.badge.text}</Text>
              </View>
            ) : null}
          </View>
          {option.sublabel ? (
            <Text variant="bodySmall" style={styles.cardSublabel} numberOfLines={1}>
              {option.sublabel}
            </Text>
          ) : null}
          {hasDetails &&
            option.details!.map((d, i) => (
              <Text key={i} style={styles.cardDetail} numberOfLines={1}>
                {d}
              </Text>
            ))}
        </View>
      </TouchableRipple>
    </View>
  );
});

const SEARCH_HEIGHT = 40;

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  headerSearchRow: { paddingTop: 2, paddingBottom: 8 },
  title: { fontWeight: '700', color: '#0f172a', flex: 1, fontSize: 16 },
  headerBtn: { margin: 0, width: 32, height: 32 },

  searchGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: SEARCH_HEIGHT,
  },
  searchGroupPhone: { width: '100%' },
  searchInput: {
    backgroundColor: '#fff',
    width: 240,
    height: SEARCH_HEIGHT,
    fontSize: 13,
  },
  // Client-mode: TextInput standalone — headerSearchRow içinde tek başına.
  // width:'100%' parent'ın tüm genişliğini alır.
  searchInputPhone: { width: '100%' },
  // Paginated-mode: searchGroup flex-row container; input flex:1 ile Button'la
  // alanı bölüşür. width:240 (searchInput) override'ı için width:'auto' şart,
  // aksi halde Button modal dışına taşıyordu.
  searchInputPhonePaginated: { flex: 1, width: 'auto' },
  searchBtn: {
    borderRadius: 8,
    height: SEARCH_HEIGHT,
    justifyContent: 'center',
    elevation: 2,
  },
  searchBtnContent: {
    height: SEARCH_HEIGHT,
    paddingHorizontal: 16,
    flexDirection: 'row',
  },
  searchBtnLabel: {
    fontSize: 14,
    fontWeight: '700',
    marginVertical: 0,
    letterSpacing: 0.3,
  },

  sortRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 2,
  },
  sortChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  sortChipActive: {
    borderColor: '#4f46e5',
    backgroundColor: '#eef2ff',
    borderWidth: 2,
  },
  sortChipText: { fontSize: 12, color: '#475569', fontWeight: '600' },
  sortChipTextActive: { color: '#4f46e5', fontWeight: '700' },

  listBox: { flex: 1 },
  listRow: { flex: 1, flexDirection: 'row' },
  // Çerçeveli sabit grup (örn. iş emrindeki müşteriler) — listenin üstünde.
  pinnedFrame: {
    borderWidth: 2,
    borderColor: '#4f46e5',
    borderRadius: 12,
    backgroundColor: '#f5f3ff',
    padding: 6,
    marginBottom: 10,
  },
  pinnedLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4f46e5',
    marginLeft: 4,
    marginBottom: 2,
  },
  pinnedGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  azStrip: {
    width: 30,
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingVertical: 4,
    marginLeft: 2,
  },
  azLetterTouch: {
    width: 28,
    minHeight: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  azLetter: { fontSize: 12, fontWeight: '700', color: colors.brand },
  empty: { textAlign: 'center', color: '#94a3b8', padding: 24 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Pager container — sadece üst kenar ayırıcı + spacing. Layout Pager içinde.
  pagination: {
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },

  cardWrap: { flex: 1, padding: 4 },
  card: {
    backgroundColor: '#fff',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 72,
    overflow: 'hidden',
  },
  cardRich: { minHeight: 96 },
  cardSelected: {
    borderColor: '#4f46e5',
    backgroundColor: '#eef2ff',
    borderWidth: 2,
  },
  cardContent: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  cardLabel: { fontWeight: '700', color: '#0f172a', fontSize: 15, flex: 1 },
  cardSublabel: {
    color: '#64748b',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  cardDetail: {
    color: '#475569',
    fontSize: 11,
    marginTop: 1,
  },
  cardBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  cardBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
});
