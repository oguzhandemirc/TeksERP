import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { foldedIncludes } from '../utils/searchFold';
import {
  View,
  StyleSheet,
  useWindowDimensions,
  Keyboard,
  TextInput as RNTextInput,
} from 'react-native';
import RefreshButton from './RefreshButton';
import { useManualRefresh } from '../hooks/useManualRefresh';
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
  Icon,
} from 'react-native-paper';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import Pager from './Pager';
import { colors } from '../theme';

/** Türkçe harmanlama — MODÜL SABİTİ (comparator içinde kurmak pahalıdır). */
const TR_COLLATOR = new Intl.Collator('tr', { numeric: true });

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

/**
 * Listenin BAŞINA sabitlenen aksiyon kartı (ör. KK1 "Yeni Desen").
 *
 * Diğer seçeneklerle aynı kart geometrisinde görünür ama seçenek DEĞİLDİR:
 * mor zemin + beyaz yazı ile ayrışır, alfabetik sıralama ve arama filtresi ne
 * olursa olsun **her zaman ilk hücredir**. Basılınca `onSelect`/`onDismiss`
 * ÇAĞRILMAZ — picker açık kalır, parent akışı sürdürür (ör. `quickAddSlot`
 * içindeki inline formu açar).
 */
export interface PickerLeadingAction {
  label: string;
  /** Kartın altındaki küçük açıklama (ör. "Listede yok — hemen ekle"). */
  sublabel?: string;
  /** MaterialCommunityIcons adı — etiketin soluna beyaz ikon. */
  icon?: string;
  onPress: () => void;
  /** Dokunmayı kapatır + kartı soluklaştırır (ör. offline'da). */
  disabled?: boolean;
}

/** Aksiyon kartının veri içindeki sentinel `value`'su — gerçek bir seçenek id'si
 *  ile çakışmaması için ayraçlı. */
const LEADING_ACTION_VALUE = '__picker_leading_action__';

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
  /** Header'da yenile ikonu — basıldığında parent refetch yapar (react-query
   *  refetch ya da axios async fn). Animasyon/haptic/toast + offline & timeout
   *  davranışı useManualRefresh ile içeride yönetilir. */
  onRefresh?: () => void;
  /** Manuel yenileme başarı toast'ı başlığı. Verilmezse başarıda sessiz (haptic). */
  successMessage?: string;
  /** @deprecated Artık kullanılmıyor — yenileme durumu useManualRefresh ile
   *  içeride hesaplanır (ham isFetching offline'da yanlış sonuç veriyordu).
   *  Geriye dönük uyumluluk için prop'lar korunur ama yok sayılır. */
  refreshing?: boolean;
  /** @deprecated bkz. refreshing */
  refreshError?: boolean;
  /** @deprecated bkz. refreshing */
  refreshErrorMessage?: string;
  /** Üstte ÇERÇEVELİ sabit grup — verilen sırada (alfabetik sıralanmaz, A-Z'ye
   *  dahil değil). Asıl liste bu çerçevenin DIŞINDA, altından başlar. Örn. "bu
   *  iş emrinde siparişi olan müşteriler". Aramayla birlikte filtrelenir. */
  pinnedOptions?: PickerOption[];
  /** Çerçevenin üstündeki küçük başlık. */
  pinnedLabel?: string;
  /** Client (non-paginated) modda varsayılan alfabetik sıralamayı kapatır —
   *  `options` parent'ta zaten anlamlı bir sırayla geliyorsa (örn. rota adım
   *  sırası) o sıra korunur. */
  disableSort?: boolean;
  /** Arama satırı ile liste ARASINA yerleştirilen opsiyonel içerik (ör. yetkili
   *  operatöre "＋ Yeni Desen" hızlı ekleme formu). Verilmezse render edilmez —
   *  diğer picker kullanıcıları etkilenmez. */
  quickAddSlot?: React.ReactNode;
  /** Listenin ilk hücresine sabitlenen mor aksiyon kartı — bkz.
   *  `PickerLeadingAction`. Verilmezse hiç render edilmez. */
  leadingAction?: PickerLeadingAction;
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
  // ── Offset (pager) modu — page/totalPages/onPageChange ile. ──
  // Infinite scroll modunda bunlar VERİLMEZ; yerine onEndReached gelir.
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  // ── Cursor / infinite scroll modu ── liste sonuna yaklaşınca tetiklenir
  // (parent fetchNextPage bağlar). loadingMore → alt spinner. onEndReached
  // verildiğinde pager render EDİLMEZ.
  onEndReached?: () => void;
  loadingMore?: boolean;
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
    successMessage,
    pinnedOptions = [],
    pinnedLabel,
    disableSort = false,
    quickAddSlot,
    leadingAction,
  } = props;

  // Yenileme: ham isFetching yerine standart hook → offline guard + zaman aşımı
  // + tek tip animasyon/haptic/toast. onRefresh yoksa buton render edilmez.
  const manualRefresh = useManualRefresh(onRefresh ?? (() => {}), successMessage);

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
  // (harmanlama büyük listelerde O(n log n) yüksek sabit faktörlü). Collator
  // MODÜL SABİTİ: comparator içinde `localeCompare` çağırmak her karşılaştırmada
  // yeni bir collator kurar.
  //
  // ⚠️ `sensitivity: 'base'` KALDIRILDI (2026-08-19). O ayar ç ile c'yi, ı ile
  // i'yi EŞİT sayıyordu — yani "CAM" ile "ÇAM" karşılaştırması 0 dönüyor ve
  // ikisi dizi sırasına göre iç içe geçiyordu. Aynı ekrandaki A-Z indeksi ise
  // (aşağıda) C ve Ç için AYRI kova üretiyor: operatör Ç'ye basınca C'lerin
  // ortasına düşebiliyordu. Türkçede ç ile c AYRI harflerdir; sıralama onları
  // ayırmalı (arama tarafı tam tersini yapar — orada katlama doğrudur).
  //
  // ⚠️ `numeric: true`: "P2" < "P10" (sözlüksel sırada tersi olurdu).
  const sortedOptions = useMemo(() => {
    if (paginated || disableSort) return options;
    return [...options].sort((a, b) => TR_COLLATOR.compare(a.label, b.label));
  }, [paginated, disableSort, options]);

  // Filter ayrı useMemo: arama değiştikçe yalnızca filtreyi tekrar uygula.
  const listData = useMemo(() => {
    if (paginated) return sortedOptions;
    const q = clientSearch.trim();
    if (!q) return sortedOptions;
    return sortedOptions.filter(
      (o) =>
        foldedIncludes(o.label, q) || foldedIncludes(o.sublabel, q),
    );
  }, [paginated, sortedOptions, clientSearch]);

  // Aksiyon kartı listenin BİRİNCİ HÜCRESİ olarak veriye enjekte edilir.
  // (ListHeaderComponent olmazdı: header tüm satır genişliğini kaplar, grid
  // hücresi olmaz.) Sıralama ve arama filtresinden SONRA eklendiği için
  // alfabetik sıraya karışmaz ve arama yazılsa bile ilk sırada kalır — zaten
  // "aradığını bulamadın, ekle" akışının tam gerekli olduğu an.
  //
  // `onPress` ref'ten okunur: parent inline nesne verse bile (her render'da yeni
  // kimlik) memo bağımlılıkları primitive kalır, FlashList boşuna yenilenmez.
  const leadingActionRef = useRef(leadingAction);
  leadingActionRef.current = leadingAction;
  const leadLabel = leadingAction?.label;
  const leadSublabel = leadingAction?.sublabel;
  const leadIcon = leadingAction?.icon;
  const leadDisabled = leadingAction?.disabled === true;

  const dataWithLeading = useMemo(() => {
    if (leadLabel == null) return listData;
    return [
      { value: LEADING_ACTION_VALUE, label: leadLabel, sublabel: leadSublabel },
      ...listData,
    ];
  }, [leadLabel, leadSublabel, listData]);

  // A-Z hızlı indeks (yalnız client mode) — liste zaten alfabetik sıralı, her
  // harfin ilk görünümünün index'ini tutarız. Operatör harfe basınca o gruba
  // atlar (arama kutusuna yazmak yerine — onlarca üründe pratik). Index'ler
  // FlashList'e verilen dizide (aksiyon kartı dahil) hesaplanır — aksiyon kartı
  // her şeyi 1 kaydırdığı için listData üzerinden hesaplamak yanlış satıra
  // atlardı; kartın kendisi indekse GİRMEZ.
  const azIndex = useMemo(() => {
    if (paginated) return [] as { letter: string; index: number }[];
    const seen = new Map<string, number>();
    dataWithLeading.forEach((o, i) => {
      if (o.value === LEADING_ACTION_VALUE) return;
      const ch = (o.label?.trim()?.[0] ?? '').toLocaleUpperCase('tr');
      if (ch && !seen.has(ch)) seen.set(ch, i);
    });
    return Array.from(seen.entries()).map(([letter, index]) => ({ letter, index }));
  }, [paginated, dataWithLeading]);

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

  // Aksiyon kartı: seçim DEĞİL → onSelect/onDismiss çağrılmaz, picker açık kalır.
  const handleLeadingPress = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    leadingActionRef.current?.onPress();
  }, []);

  // Çerçeveli sabit grup — aramayla birlikte filtrelenir, alfabetik sıralanmaz.
  const filteredPinned = useMemo(() => {
    if (paginated || pinnedOptions.length === 0) return [] as PickerOption[];
    const q = clientSearch.trim();
    if (!q) return pinnedOptions;
    return pinnedOptions.filter(
      (o) =>
        foldedIncludes(o.label, q) || foldedIncludes(o.sublabel, q),
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
    ({ item }: { item: PickerOption }) =>
      item.value === LEADING_ACTION_VALUE ? (
        <ActionCard
          label={item.label}
          sublabel={item.sublabel}
          icon={leadIcon}
          disabled={leadDisabled}
          onPress={handleLeadingPress}
        />
      ) : (
        <PickerCard
          option={item}
          selected={item.value === selectedValue}
          onPress={handlePick}
        />
      ),
    [selectedValue, handlePick, leadIcon, leadDisabled, handleLeadingPress],
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
              onPress={manualRefresh.onRefresh}
              refreshing={manualRefresh.refreshing}
              isError={manualRefresh.isError}
              errorMessage={manualRefresh.errorMessage}
              successMessage={manualRefresh.successMessage}
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

        {/* Opsiyonel hızlı ekleme yuvası — arama ile liste arasında. Tipik akış:
            listedeki mor `leadingAction` kartı bu yuvadaki formu açar (KK1 "Yeni
            Desen" ad girişi). Verilmezse hiç render edilmez. */}
        {quickAddSlot ? <View style={styles.quickAddSlot}>{quickAddSlot}</View> : null}

        {/* Liste */}
        <View style={styles.listBox}>
          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color="#4f46e5" />
            </View>
          ) : (
            <>
              {/* "Seçenek yok" bilgisi aksiyon kartını GİZLEMEZ — arama boş
                  döndüğünde asıl yapılacak iş genelde "yeni ekle"dir. */}
              {listData.length === 0 && filteredPinned.length === 0 ? (
                <Text style={styles.empty}>{emptyText}</Text>
              ) : null}
              {dataWithLeading.length > 0 || filteredPinned.length > 0 ? (
                <View style={styles.listRow}>
                  <View style={{ flex: 1 }}>
                    <FlashList
                      ref={listRef}
                      data={dataWithLeading}
                      keyExtractor={keyExtractor}
                      numColumns={effectiveColumns}
                      ListHeaderComponent={pinnedHeader}
                      renderItem={renderItem}
                      onEndReachedThreshold={0.5}
                      onEndReached={
                        paginated ? (props as PaginatedProps).onEndReached : undefined
                      }
                      ListFooterComponent={
                        paginated && (props as PaginatedProps).loadingMore ? (
                          <View style={styles.loadingMore}>
                            <ActivityIndicator size="small" color="#4f46e5" />
                          </View>
                        ) : undefined
                      }
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
              ) : null}
            </>
          )}
        </View>

        {/* Sayfalama — yalnız offset (pager) modunda. Infinite scroll
            (onEndReached) modunda pager YOK; alt spinner FlashList footer'ında. */}
        {paginated &&
          (props as PaginatedProps).onPageChange &&
          !(props as PaginatedProps).onEndReached && (
            <Pager
              page={(props as PaginatedProps).page ?? 1}
              totalPages={(props as PaginatedProps).totalPages ?? 1}
              fetching={(props as PaginatedProps).fetching}
              onPageChange={(props as PaginatedProps).onPageChange!}
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

/**
 * Listenin ilk hücresindeki aksiyon kartı — normal seçenek kartıyla AYNI
 * geometri (grid'e oturur), farkı mor zemin + beyaz yazı. Seçim durumu yok:
 * hiçbir zaman "seçili" görünmez, dokununca picker kapanmaz.
 */
const ActionCard = React.memo(function ActionCard({
  label,
  sublabel,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  sublabel?: string;
  icon?: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.cardWrap}>
      <TouchableRipple
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
        borderless
        rippleColor="rgba(255,255,255,0.24)"
        style={[styles.card, styles.actionCard, disabled && styles.actionCardDisabled]}
        accessibilityRole="button"
        accessibilityLabel={sublabel ? `${label} — ${sublabel}` : label}
      >
        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            {icon ? <Icon source={icon} size={20} color="#fff" /> : null}
            <Text
              variant="titleMedium"
              style={[styles.cardLabel, styles.actionCardLabel]}
              numberOfLines={2}
            >
              {label}
            </Text>
          </View>
          {sublabel ? (
            <Text variant="bodySmall" style={styles.actionCardSublabel} numberOfLines={2}>
              {sublabel}
            </Text>
          ) : null}
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

  quickAddSlot: { paddingHorizontal: 2, paddingBottom: 4 },
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
  loadingMore: { paddingVertical: 16, alignItems: 'center' },

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
  // Mor aksiyon kartı (liste başı "yeni ekle"). Marka indigo'su seçili-kart
  // vurgusunda kullanıldığı için bilinçli olarak mor.
  actionCard: {
    backgroundColor: colors.action,
    borderColor: colors.actionDark,
    borderWidth: 1,
  },
  actionCardDisabled: { opacity: 0.5 },
  actionCardLabel: { color: '#fff' },
  actionCardSublabel: { color: 'rgba(255,255,255,0.85)', fontSize: 11 },
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
