import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import {
  Text,
  TextInput,
  IconButton,
  TouchableRipple,
  Chip,
  Icon,
  ActivityIndicator,
  Button,
  SegmentedButtons,
} from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery } from '@tanstack/react-query';

import AppModal from './AppModal';
import { SkeletonList } from './motion';
import { rollService } from '../services/roll.service';
import { useDeviceType } from '../hooks/useDeviceType';
import { ROLL_STATUS_LABEL, trLabel } from '../utils/labels';
import type { Roll } from '../types/models';

// =============================================================================
// RollPickerModal — "Listeden Top Seç" ortak modalı.
//
// FasonSevk'in top seçim modalından genelleştirildi: kamera çalışsa bile
// operatör listeden seçebilsin (Kartela Sevk / İade Girişi / Paketleme).
//
// Aday top seti `filters` ile belirlenir — backend `/rolls?mode=cursor` filtre
// sözleşmesinin AYNISI (inventory.service.buildRollWhere). Örn:
//   { status: 'WAREHOUSE', shipmentScope: 'free' }  → serbest depo (Kartela/Paket)
//   { status: 'SHIPPED' }                            → sevk edilmiş (İade)
//
// CLAUDE.md cursor kuralı: Roll yüksek hacimli tablo → withTotal yok, sabit hız.
// Her açılışta taze veri (openedAt freshness gate) — başka cihaz/akış listeyi
// değiştirmiş olabilir; bayat (ör. çoktan sevk edilmiş) top seçilmesin.
// =============================================================================

const PAGE_SIZE = 30;

interface Props {
  visible: boolean;
  onDismiss: () => void;
  /** Tekli seçim: bir satıra dokununca çağrılır. (multiSelect=false varsayılan akış.) */
  onSelect?: (roll: Roll) => void;
  /** Aday top filtre seti (backend cursor filtre sözleşmesi). */
  filters: Record<string, string | string[]>;
  title?: string;
  subtitle?: string;
  /** Zaten eklenmiş topları listeden gizle (çoklu seçim akışları için). */
  excludeIds?: string[];
  searchPlaceholder?: string;
  emptyText?: string;
  /** Satır ripple rengi (default indigo). */
  accent?: string;
  /**
   * Çoklu seçim modu — kutucukla birden çok top işaretle, alttaki "Ekle (N)" ile
   * topluca döndür. Varsayılan kapalı: mevcut tüm kullanımlar (Kartela/Paket/Fason/
   * İade) tekli `onSelect` ile aynen çalışır. Sahada deste topu hızlı eklemek için.
   */
  multiSelect?: boolean;
  /** Çoklu seçimde "Ekle" basıldığında işaretli tüm topları döndürür. */
  onConfirm?: (rolls: Roll[]) => void;
  /** Çoklu seçim onay butonu etiketi (default "Ekle"). */
  confirmLabel?: string;
  /**
   * KAPSAM SEKMELERİ (2026-08-25) — başlığın altında, TAM GENİŞLİK.
   * Verilmezse hiç çizilmez ve `filters` aynen kullanılır: mevcut beş çağıran
   * (Kartela / Paket / Fason / İade / Hızlı İş Emri) etkilenmez.
   *
   * Hızlı İş Emri iki kapsam verir: "Ham Stok" ve "Bitmiş Depo" — depodaki
   * bitmiş top yeniden üretime alınabilsin diye (backend `quick-start` zaten
   * WAREHOUSE/A1_STOCK kabul ediyor).
   *
   * ⚠️ Sekme şeridi KENDİ SATIRINDA durur; `SegmentedButtons` bir satırın içine
   * konmaz (`segmented-buttons-row.guard.test.ts` — yanındaki kutuyu sıfır
   * genişliğe iter, 2026-08-25 Fason Kabul vakası).
   */
  scopeTabs?: { key: string; label: string; filters: Record<string, string | string[]> }[];
}

export default function RollPickerModal({
  visible,
  onDismiss,
  onSelect,
  filters,
  title = 'Top Seç',
  subtitle,
  excludeIds,
  searchPlaceholder = 'Barkod / ürün ara...',
  emptyText = 'Top bulunamadı',
  accent = '#4f46e5',
  multiSelect = false,
  onConfirm,
  scopeTabs,
  confirmLabel = 'Ekle',
}: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
  const isPhone = useDeviceType() === 'phone';

  const [search, setSearch] = useState('');
  // Çoklu seçimde işaretli toplar (id → Roll). onConfirm bunları döndürür.
  const [selected, setSelected] = useState<Record<string, Roll>>({});
  // 300ms debounce: her tuş darbesinde HTTP isteği yerine yazma bittikten sonra tek request.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Etkin kapsam: sekme verilmişse seçili sekmenin filtresi, yoksa `filters`.
  // ⚠️ Sekme anahtarı sorgu anahtarına GİRER (`effectiveFilters` üzerinden):
  // girmezse sekme değişince liste tazelenmez ve operatör eski kapsamı görür.
  const [scopeKey, setScopeKey] = useState<string>(scopeTabs?.[0]?.key ?? '');
  useEffect(() => {
    // Modal her açılışta ilk kapsamda başlar — önceki seçim yapışmasın.
    if (visible && scopeTabs?.length) setScopeKey(scopeTabs[0]!.key);
  }, [visible, scopeTabs]);
  const effectiveFilters = useMemo(() => {
    if (!scopeTabs?.length) return filters;
    return (scopeTabs.find((t) => t.key === scopeKey) ?? scopeTabs[0]!).filters;
  }, [scopeTabs, scopeKey, filters]);

  const rollsQuery = useInfiniteQuery({
    queryKey: ['rolls', 'picker', effectiveFilters, debouncedSearch],
    queryFn: ({ pageParam }) =>
      rollService.getAllCursor({
        limit: PAGE_SIZE,
        cursor: pageParam,
        search: debouncedSearch.trim() || undefined,
        filters: effectiveFilters,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.pagination.hasMore ? last.pagination.nextCursor : undefined,
    enabled: visible,
  });

  // Modal her açılışında taze veri çek; o açılış anını damgala ve taze sonuç
  // gelene dek eski cache satırları YERİNE skeleton göster (bayat top seçilmesin).
  const [openedAt, setOpenedAt] = useState(0);
  useEffect(() => {
    if (visible) {
      setOpenedAt(Date.now());
      rollsQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const allRolls = rollsQuery.data?.pages.flatMap((p) => p.data) ?? [];
  const rolls = excludeIds?.length
    ? allRolls.filter((r) => !excludeIds.includes(r.id))
    : allRolls;

  const freshForThisOpen = rollsQuery.dataUpdatedAt >= openedAt;
  const showSkeleton =
    rollsQuery.isLoading || (visible && !freshForThisOpen && !rollsQuery.isError);

  // Modal kapanınca aramayı sıfırla — sonraki açılış temiz başlasın.
  useEffect(() => {
    if (!visible) setSearch('');
  }, [visible]);

  // Her açılış/kapanışta çoklu seçim işaretlerini temizle (taze başla).
  useEffect(() => {
    setSelected({});
  }, [visible]);

  const toggleSelect = (roll: Roll) =>
    setSelected((prev) => {
      const next = { ...prev };
      if (next[roll.id]) delete next[roll.id];
      else next[roll.id] = roll;
      return next;
    });
  const selectedCount = Object.keys(selected).length;
  const confirmMulti = () => {
    onConfirm?.(Object.values(selected));
    setSelected({});
  };

  return (
    <AppModal visible={visible} onDismiss={onDismiss}>
      <View
        style={[
          styles.sheet,
          isPhone && styles.sheetPhone,
          { width: isPhone ? winW * 0.95 : winW * 0.85, height: winH * 0.85 },
        ]}
      >
        <View style={[styles.header, isPhone && styles.headerPhone]}>
          <View style={{ flex: 1 }}>
            <Text variant={isPhone ? 'titleMedium' : 'titleLarge'} style={styles.title}>
              {title}
            </Text>
            {!isPhone && subtitle && (
              <Text variant="bodySmall" style={styles.subtitle}>
                {subtitle}
              </Text>
            )}
          </View>
          <IconButton
            icon="close"
            size={isPhone ? 22 : 28}
            onPress={onDismiss}
            accessibilityLabel="Kapat"
            style={{ margin: 0 }}
          />
        </View>

        {scopeTabs && scopeTabs.length > 1 ? (
          <View style={styles.scopeRow}>
            <SegmentedButtons
              value={scopeKey}
              onValueChange={setScopeKey}
              buttons={scopeTabs.map((t) => ({ value: t.key, label: t.label }))}
            />
          </View>
        ) : null}

        <TextInput
          mode="outlined"
          value={search}
          onChangeText={setSearch}
          placeholder={searchPlaceholder}
          left={<TextInput.Icon icon="magnify" />}
          style={[styles.search, isPhone && styles.searchPhone]}
          dense={isPhone}
          autoCapitalize="characters"
          autoCorrect={false}
        />

        <View style={styles.listBox}>
          {showSkeleton ? (
            <SkeletonList count={6} />
          ) : rollsQuery.isError ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Liste yüklenemedi</Text>
              <Text style={styles.emptyHint}>{(rollsQuery.error as Error).message}</Text>
            </View>
          ) : rolls.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{emptyText}</Text>
            </View>
          ) : (
            <FlashList
              data={rolls}
              keyExtractor={(r) => r.id}
              onEndReachedThreshold={0.6}
              onEndReached={() => {
                if (rollsQuery.hasNextPage && !rollsQuery.isFetchingNextPage) {
                  rollsQuery.fetchNextPage();
                }
              }}
              ListFooterComponent={
                rollsQuery.isFetchingNextPage ? (
                  <ActivityIndicator style={{ marginVertical: 12 }} />
                ) : null
              }
              renderItem={({ item }) => (
                <TouchableRipple
                  borderless
                  rippleColor={`${accent}26`}
                  onPress={() => (multiSelect ? toggleSelect(item) : onSelect?.(item))}
                  style={styles.row}
                >
                  <View
                    style={[
                      styles.rowInner,
                      isPhone && styles.rowInnerPhone,
                      multiSelect && selected[item.id] ? { borderWidth: 1.5, borderColor: accent } : null,
                    ]}
                  >
                    <View style={{ flex: 1, gap: isPhone ? 2 : 4 }}>
                      <View style={styles.rowTop}>
                        <Text
                          style={[styles.rowBarcode, isPhone && styles.rowBarcodePhone]}
                          numberOfLines={1}
                        >
                          {item.barcode ?? '—'}
                        </Text>
                        <Chip
                          compact
                          style={styles.rowStatus}
                          textStyle={isPhone ? styles.rowStatusTextPhone : undefined}
                        >
                          {trLabel(ROLL_STATUS_LABEL, item.status)}
                        </Chip>
                        {item.markedForKartela && (
                          <Chip
                            compact
                            style={styles.rowKartela}
                            textStyle={isPhone ? styles.rowKartelaTextPhone : styles.rowKartelaText}
                          >
                            kartelalık
                          </Chip>
                        )}
                      </View>
                      <Text
                        style={[styles.rowName, isPhone && styles.rowNamePhone]}
                        numberOfLines={1}
                      >
                        {item.item?.name ?? '—'}
                        {item.color?.name ? ` · ${item.color.name}` : ''}
                      </Text>
                      <View style={[styles.rowBadgeRow, isPhone && styles.rowBadgeRowPhone]}>
                        <View style={[styles.rowBadge, isPhone && styles.rowBadgePhone]}>
                          <Icon
                            source="arrow-expand-vertical"
                            size={isPhone ? 11 : 13}
                            color="#0f172a"
                          />
                          <Text
                            style={[styles.rowBadgeText, isPhone && styles.rowBadgeTextPhone]}
                          >
                            {item.currentQty} mt
                          </Text>
                        </View>
                        {item.width != null && (
                          <View style={[styles.rowBadge, isPhone && styles.rowBadgePhone]}>
                            <Icon
                              source="arrow-expand-horizontal"
                              size={isPhone ? 11 : 13}
                              color="#0f172a"
                            />
                            <Text
                              style={[styles.rowBadgeText, isPhone && styles.rowBadgeTextPhone]}
                            >
                              {item.width} cm
                            </Text>
                          </View>
                        )}
                        {item.qualityGrade && (
                          <View style={[styles.rowBadge, isPhone && styles.rowBadgePhone]}>
                            <Icon
                              source="star-circle"
                              size={isPhone ? 11 : 13}
                              color="#0f172a"
                            />
                            <Text
                              style={[styles.rowBadgeText, isPhone && styles.rowBadgeTextPhone]}
                            >
                              {item.qualityGrade}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                    {multiSelect ? (
                      <Icon
                        source={selected[item.id] ? 'checkbox-marked' : 'checkbox-blank-outline'}
                        size={isPhone ? 24 : 28}
                        color={selected[item.id] ? accent : '#94a3b8'}
                      />
                    ) : (
                      <Icon source="chevron-right" size={isPhone ? 18 : 24} color="#94a3b8" />
                    )}
                  </View>
                </TouchableRipple>
              )}
            />
          )}
        </View>

        {multiSelect ? (
          <View style={styles.footer}>
            <Button
              mode="contained"
              icon="plus"
              onPress={confirmMulti}
              disabled={selectedCount === 0}
              buttonColor={accent}
              style={styles.footerBtn}
              contentStyle={styles.footerBtnContent}
              labelStyle={styles.footerBtnLabel}
            >
              {confirmLabel} ({selectedCount})
            </Button>
          </View>
        ) : null}
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  sheetPhone: { paddingHorizontal: 6, paddingTop: 4, paddingBottom: 4, borderRadius: 12 },
  // Kapsam sekmesi KENDİ SATIRINDA, tam genişlik (bkz. Props.scopeTabs notu).
  scopeRow: { paddingHorizontal: 16, paddingBottom: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    marginBottom: 8,
  },
  headerPhone: { paddingVertical: 2, marginBottom: 6 },
  title: { fontWeight: '700', color: '#0f172a' },
  subtitle: { color: '#64748b', marginTop: 2 },
  search: { backgroundColor: '#fff', marginBottom: 8 },
  searchPhone: { marginBottom: 6 },
  listBox: { flex: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 4 },
  emptyText: { fontSize: 16, color: '#94a3b8', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#cbd5e1' },
  row: { borderRadius: 10, marginVertical: 3 },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#f8fafc',
    padding: 12,
    borderRadius: 10,
  },
  rowInnerPhone: { gap: 4, padding: 6, borderRadius: 6 },
  rowTop: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  rowBarcode: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    backgroundColor: '#dcfce7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  rowBarcodePhone: { fontSize: 10, paddingHorizontal: 3, paddingVertical: 1, flexShrink: 1 },
  rowStatus: { backgroundColor: '#e0e7ff' },
  rowStatusTextPhone: { fontSize: 10, lineHeight: 14, marginVertical: 0 },
  // Kartelalık damgası — top Tambur'da kartela için işaretlendiyse (markedForKartela).
  // KartelaSevkScreen'deki seçili-liste çipiyle aynı mor dil.
  rowKartela: { backgroundColor: '#f3e8ff' },
  rowKartelaText: { color: '#9333ea', fontWeight: '700' },
  rowKartelaTextPhone: { fontSize: 10, lineHeight: 14, marginVertical: 0, color: '#9333ea', fontWeight: '700' },
  rowName: { fontSize: 13, color: '#475569', marginTop: 4 },
  rowNamePhone: { fontSize: 11, marginTop: 0 },
  rowBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  rowBadgeRowPhone: { gap: 2, marginTop: 2 },
  rowBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  rowBadgePhone: { gap: 2, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 },
  rowBadgeText: { fontSize: 12, color: '#0f172a', fontWeight: '600' },
  rowBadgeTextPhone: { fontSize: 10 },
  footer: { paddingTop: 8, borderTopWidth: 1, borderTopColor: '#e2e8f0', marginTop: 4 },
  footerBtn: { borderRadius: 12 },
  footerBtnContent: { height: 52 },
  footerBtnLabel: { fontSize: 16, fontWeight: '800' },
});
