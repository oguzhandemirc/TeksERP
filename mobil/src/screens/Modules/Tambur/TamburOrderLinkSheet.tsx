import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, Icon, ActivityIndicator, TextInput } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';

import ResizableSheetModal from '../../../components/ResizableSheetModal';
import ConfirmDialog from '../../../components/ConfirmDialog';
import RefreshButton from '../../../components/RefreshButton';
import { useManualRefresh } from '../../../hooks/useManualRefresh';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { usePermissions } from '../../../hooks/usePermission';
import OrderLineFilterSheet, {
  EMPTY_ORDER_LINE_FILTERS,
  activeFilterCount,
  type OrderLineFilters,
} from '../HizliIsEmri/OrderLineFilterSheet';
import { orderService, type AvailableOrderLine } from '../../../services/order.service';
import {
  workOrderService,
  type LinkableOrderLine,
  type OrderLinkOverrideResult,
} from '../../../services/workOrder.service';
import { colors, spacing, radius } from '../../../theme';

const PAGE_SIZE = 20;
// OrderLinkPicker ile aynı gerekçe: "yazmayı bıraktım" sinyali, hecede bir istek değil.
const SEARCH_DEBOUNCE_MS = 800;

type Tab = 'uygun' | 'tumu';

/** Satırın iş emri hedefiyle uyumu — null = uyumlu, doluysa kısa sebep listesi. */
interface Mismatch {
  itemDiff: boolean;
  colorDiff: boolean;
  widthDiff: boolean;
}

interface Props {
  visible: boolean;
  onDismiss: () => void;
  workOrderId: string;
  /** Bağ kurulunca (normal ya da override) çağrılır — ekran kart bağlamını tazeler. */
  onLinked?: () => void;
}

// =============================================================================
// Tambur "Sipariş Bağla" (2026-08-19, kullanıcı kararı — v1 + v2 tek pakette)
// =============================================================================
// Üst şeritteki tuştan açılır (yalnız workorder:write taşıyan kişi görür).
// İki sekme:
//   • UYGUN — iş emrinin hedefiyle kumaş+renk uyumlu açık satırlar
//     (backend süzer: linkable-order-lines; en farkı UYARIDIR, engel değil).
//   • TÜMÜ — tüm açık satırlar (arama + müşteri/kumaş/renk/en filtreli,
//     debounce'lu, cursor sayfalı). Uyumsuz satır GRİ ve sebebi üstünde yazar.
//
// Uyumsuz seçim YETKİYLE açılır, soruyla değil (mükerrer-modal dersi: acele
// eden operatör onay ekranını okumaz): roll:manual-adjust TAŞIMAYAN kullanıcı
// için satır ölüdür; taşıyan süpervizör seçince "elindeki GERÇEKTEN bu mu?"
// onayı + zorunlu sebep alır ve backend zinciri üç işi sırayla yapar
// (plan düzelt + topları eşitle + bağla). KUMAŞ farkı HER YOLDA ölü —
// topun cinsi düzeltilemez, o satırın çözümü doğru kumaşlı iş emridir.
// =============================================================================
export default function TamburOrderLinkSheet({ visible, onDismiss, workOrderId, onLinked }: Props) {
  const qc = useQueryClient();
  const { has: hasPermission } = usePermissions();
  const canOverride = hasPermission('roll:manual-adjust');

  const [tab, setTab] = useState<Tab>('uygun');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), SEARCH_DEBOUNCE_MS);
  const [filters, setFilters] = useState<OrderLineFilters>(EMPTY_ORDER_LINE_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [widthInput, setWidthInput] = useState('');
  const widthFilterRaw = useDebouncedValue(widthInput.trim(), SEARCH_DEBOUNCE_MS);
  const widthFilter = widthFilterRaw && Number.isFinite(Number(widthFilterRaw)) ? Number(widthFilterRaw) : null;
  const filterCount = activeFilterCount(filters) + (widthFilter != null ? 1 : 0);

  // Onay state'leri — uyumlu bağ (yanlış dokunuşa karşı basit onay) ve
  // süpervizör override'ı (sorular + zorunlu sebep) ayrı modallar.
  const [confirmLink, setConfirmLink] = useState<{ lineId: string; label: string } | null>(null);
  const [confirmOverride, setConfirmOverride] = useState<{
    lineId: string;
    label: string;
    questions: string[];
  } | null>(null);

  // İş emri hedefi — uyum kararının referansı. Kart bağlamı (TamburContext)
  // hedef taşımıyor; tek istek, sheet açıkken çekilir.
  const woQ = useQuery({
    queryKey: ['work-order-detail', workOrderId],
    queryFn: () => workOrderService.getById(workOrderId),
    enabled: visible,
    staleTime: 30_000,
  });
  const wo = woQ.data?.data;
  const woTarget = {
    itemId: wo?.targetItemId ?? null,
    itemName: wo?.targetItem?.name ?? null,
    colorId: wo?.targetColorId ?? null,
    colorName: wo?.targetColor?.name ?? null,
    width: wo?.width != null ? Number(wo.width) : null,
  };

  // UYGUN sekmesi — backend süzülü, sayfasız (linkable zaten take:200 sınırlı).
  const linkableQ = useQuery({
    queryKey: ['tambur', 'linkable-order-lines', workOrderId],
    queryFn: () => workOrderService.getLinkableOrderLines(workOrderId),
    enabled: visible && tab === 'uygun',
    staleTime: 30_000,
  });

  // TÜMÜ sekmesi — cursor + backend araması + filtreler (OrderLinkPicker deseni).
  const allQ = useInfiniteQuery({
    queryKey: [
      'tambur', 'all-order-lines', workOrderId,
      search, filters.customerId, filters.itemId, filters.colorId, widthFilter,
    ],
    queryFn: ({ pageParam }) =>
      orderService.getAvailableOrderLinesCursor({
        itemId: filters.itemId,
        customerId: filters.customerId,
        colorId: filters.colorId,
        width: widthFilter,
        search,
        cursor: pageParam,
        limit: PAGE_SIZE,
        withTotal: !pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pagination.hasMore ? last.pagination.nextCursor : undefined),
    enabled: visible && tab === 'tumu',
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const allLines = useMemo(() => allQ.data?.pages.flatMap((p) => p.data) ?? [], [allQ.data]);

  const refresh = useManualRefresh(async () => {
    if (tab === 'uygun') await linkableQ.refetch();
    else await allQ.refetch();
  });

  /** Uyum hesabı — backend `linkOrderLines` doğrulamasının aynası (kumaş+renk
   *  sert, en uyarı). Hedefi olmayan alanda kısıt yok ("hedef VARSA ona uy"). */
  const mismatchOf = useCallback(
    (line: { itemId: string; colorId: string | null; width: number | null }): Mismatch => ({
      itemDiff: !!woTarget.itemId && line.itemId !== woTarget.itemId,
      colorDiff: !!woTarget.colorId && (line.colorId ?? null) !== woTarget.colorId,
      widthDiff:
        woTarget.width != null && line.width != null && Number(line.width) !== woTarget.width,
    }),
    [woTarget.itemId, woTarget.colorId, woTarget.width],
  );

  const invalidateAfterLink = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['tambur', 'linkable-order-lines', workOrderId] });
    void qc.invalidateQueries({ queryKey: ['tambur', 'all-order-lines', workOrderId] });
    void qc.invalidateQueries({ queryKey: ['work-order-detail', workOrderId] });
    // Kesim "Kime?" kısayolları kart bağlamından (context.orders) besleniyor —
    // onu ekran tazeler (onLinked → refetchActiveJob).
    onLinked?.();
  }, [qc, workOrderId, onLinked]);

  const linkMut = useMutation({
    mutationFn: (lineId: string) => workOrderService.linkOrderLines(workOrderId, [lineId]),
    onSuccess: (res) => {
      Toast.show({ type: 'success', text1: res.message ?? 'Sipariş bağlandı' });
      for (const w of res.data.warnings) Toast.show({ type: 'info', text1: w });
      invalidateAfterLink();
    },
    onError: (err: Error) => {
      Toast.show({ type: 'error', text1: 'Bağlanamadı', text2: err.message });
    },
  });

  const overrideMut = useMutation({
    mutationFn: (vars: { lineId: string; reason: string }) =>
      workOrderService.linkOrderLineWithOverride(workOrderId, {
        orderLineId: vars.lineId,
        reason: vars.reason,
      }),
    onSuccess: (res) => {
      const d: OrderLinkOverrideResult = res.data;
      Toast.show({ type: 'success', text1: res.message ?? 'Sipariş bağlandı' });
      // Kısmi başarı SESSİZ GEÇİLMEZ: düzeltilemeyen top (fasonda/sevkte)
      // süpervizörün gözüne sokulur — o toplar hâlâ eski değeri taşıyor.
      for (const f of d.rollsFailed) {
        Toast.show({ type: 'info', text1: `${f.barcode ?? 'barkodsuz'} değişmedi`, text2: f.message });
      }
      for (const w of d.warnings) Toast.show({ type: 'info', text1: w });
      // Toplar değişti → rulo listeleri de bayat.
      void qc.invalidateQueries({ queryKey: ['rolls'] });
      invalidateAfterLink();
    },
    onError: (err: Error) => {
      Toast.show({ type: 'error', text1: 'Zincir tamamlanamadı', text2: err.message });
    },
  });

  /** Uyumsuz satır için süpervizör onay soruları — "elindeki GERÇEKTEN bu mu?" */
  const buildQuestions = useCallback(
    (line: { colorName: string | null; width: number | null }, mm: Mismatch): string[] => {
      const q: string[] = [];
      if (mm.colorDiff) {
        q.push(
          `İş emri ${woTarget.colorName ?? 'RENKSİZ'} üretiyor, sipariş ${line.colorName ?? 'RENKSİZ'} istiyor. ` +
            `Elindeki kumaş GERÇEKTEN ${line.colorName ?? 'RENKSİZ'} mi?`,
        );
      }
      if (mm.widthDiff) {
        q.push(
          `İş emri ${woTarget.width ?? '—'} cm, sipariş ${line.width ?? '—'} cm istiyor. ` +
            `Elindeki en GERÇEKTEN ${line.width ?? '—'} cm mi?`,
        );
      }
      return q;
    },
    [woTarget.colorName, woTarget.width],
  );

  const onRowPress = useCallback(
    (line: {
      lineId: string;
      orderNumber: string;
      customerName: string;
      itemId: string;
      colorId: string | null;
      colorName: string | null;
      width: number | null;
    }) => {
      const mm = mismatchOf(line);
      const label = `${line.orderNumber} · ${line.customerName}`;
      if (mm.itemDiff) {
        Toast.show({
          type: 'info',
          text1: 'Kumaş farklı — bağlanamaz',
          text2: 'Topun cinsi düzeltilemez; bu sipariş için doğru kumaşlı iş emri gerekir.',
        });
        return;
      }
      if (mm.colorDiff || mm.widthDiff) {
        if (!canOverride) {
          Toast.show({
            type: 'info',
            text1: `Uyumsuz: ${[mm.colorDiff && 'renk', mm.widthDiff && 'en'].filter(Boolean).join(' + ')}`,
            text2: 'Düzelterek bağlamak süpervizör yetkisi ister (roll:manual-adjust).',
          });
          return;
        }
        setConfirmOverride({ lineId: line.lineId, label, questions: buildQuestions(line, mm) });
        return;
      }
      setConfirmLink({ lineId: line.lineId, label });
    },
    [mismatchOf, canOverride, buildQuestions],
  );

  // ── Satır çizimleri ────────────────────────────────────────────────────────
  const renderMismatchChips = (mm: Mismatch, warnings?: string[]) => {
    const chips: { text: string; hard: boolean }[] = [];
    if (mm.itemDiff) chips.push({ text: 'kumaş farklı', hard: true });
    if (mm.colorDiff) chips.push({ text: 'renk farklı', hard: true });
    if (mm.widthDiff) chips.push({ text: 'en farklı', hard: false });
    for (const w of warnings ?? []) chips.push({ text: w, hard: false });
    if (chips.length === 0) return null;
    return (
      <View style={styles.chipRow}>
        {chips.map((c, i) => (
          <View key={i} style={[styles.chip, c.hard ? styles.chipHard : styles.chipSoft]}>
            <Text style={[styles.chipText, c.hard ? styles.chipTextHard : styles.chipTextSoft]} numberOfLines={1}>
              {c.text}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  const renderLinkableRow = useCallback(
    ({ item }: { item: LinkableOrderLine }) => (
      <TouchableRipple
        onPress={() =>
          onRowPress({
            lineId: item.id,
            orderNumber: item.orderNumber,
            customerName: item.customerName,
            itemId: item.itemId,
            colorId: item.colorId,
            colorName: item.colorName,
            width: item.width,
          })
        }
        style={styles.row}
        borderless
      >
        <View style={styles.rowInner}>
          <Icon source="link-variant" size={22} color={colors.brand} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.orderNumber} · {item.customerName}
            </Text>
            <Text style={styles.rowSub} numberOfLines={1}>
              {item.itemName}
              {item.colorName ? ` · ${item.colorName}` : ''}
              {item.width != null ? ` · ${item.width}cm` : ''}
              {item.deadline ? ` · termin ${new Date(item.deadline).toLocaleDateString('tr-TR')}` : ''}
            </Text>
            {item.warnings.length > 0
              ? renderMismatchChips({ itemDiff: false, colorDiff: false, widthDiff: false }, item.warnings)
              : null}
          </View>
          <Text style={styles.openQty}>Açık: {Math.round(item.openQty)}m</Text>
        </View>
      </TouchableRipple>
    ),
    [onRowPress],
  );

  const renderAllRow = useCallback(
    ({ item }: { item: AvailableOrderLine }) => {
      const mm = mismatchOf(item);
      const hardDead = mm.itemDiff || ((mm.colorDiff || mm.widthDiff) && !canOverride);
      return (
        <TouchableRipple
          onPress={() =>
            onRowPress({
              lineId: item.lineId,
              orderNumber: item.orderNumber,
              customerName: item.customerName,
              itemId: item.itemId,
              colorId: item.colorId,
              colorName: item.colorName,
              width: item.width != null ? Number(item.width) : null,
            })
          }
          style={[styles.row, hardDead && styles.rowDead]}
          borderless
        >
          <View style={styles.rowInner}>
            <Icon
              source={mm.itemDiff ? 'cancel' : mm.colorDiff || mm.widthDiff ? 'alert-circle-outline' : 'link-variant'}
              size={22}
              color={mm.itemDiff ? colors.textMuted : mm.colorDiff || mm.widthDiff ? '#b45309' : colors.brand}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, hardDead && styles.rowTextDead]} numberOfLines={1}>
                {item.orderNumber} · {item.customerName}
              </Text>
              <Text style={[styles.rowSub, hardDead && styles.rowTextDead]} numberOfLines={1}>
                {item.itemName}
                {item.colorName ? ` · ${item.colorName}` : ''}
                {item.width != null ? ` · ${item.width}cm` : ''}
              </Text>
              {renderMismatchChips(mm)}
            </View>
            <Text style={[styles.openQty, hardDead && styles.rowTextDead]}>
              Açık: {Math.round(Number(item.openQty))}m
            </Text>
          </View>
        </TouchableRipple>
      );
    },
    [mismatchOf, canOverride, onRowPress],
  );

  const loading = tab === 'uygun' ? linkableQ.isLoading : allQ.isLoading;
  const linkableLines = linkableQ.data?.data ?? [];

  return (
    <>
      <ResizableSheetModal
        visible={visible}
        onDismiss={onDismiss}
        header={
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>Sipariş Bağla</Text>
              <Text style={styles.sheetSub} numberOfLines={1}>
                {wo
                  ? `${wo.workOrderNumber} — ${woTarget.itemName ?? 'ürün belirsiz'} · ${
                      woTarget.colorName ?? 'renksiz'
                    }${woTarget.width != null ? ` · ${woTarget.width}cm` : ''}`
                  : 'İş emri yükleniyor…'}
              </Text>
            </View>
            <RefreshButton
              onPress={refresh.onRefresh}
              refreshing={refresh.refreshing}
              isError={!!refresh.errorMessage}
              errorMessage={refresh.errorMessage}
              size={20}
            />
            <TouchableRipple onPress={onDismiss} borderless style={styles.doneBtn}>
              <Text style={styles.doneText}>Kapat</Text>
            </TouchableRipple>
          </View>
        }
      >
        <View style={styles.body}>
          {/* Sekmeler */}
          <View style={styles.tabRow}>
            {(
              [
                ['uygun', 'Uygun Siparişler'],
                ['tumu', 'Tüm Siparişler'],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <TouchableRipple
                key={key}
                onPress={() => setTab(key)}
                style={[styles.tabBtn, tab === key && styles.tabBtnActive]}
                borderless
              >
                <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
              </TouchableRipple>
            ))}
          </View>

          {tab === 'tumu' ? (
            <View style={styles.searchRow}>
              <TextInput
                mode="outlined"
                dense
                placeholder="Sipariş no / müşteri / ürün ara"
                value={searchInput}
                onChangeText={setSearchInput}
                left={<TextInput.Icon icon="magnify" />}
                right={
                  searchInput ? <TextInput.Icon icon="close" onPress={() => setSearchInput('')} /> : undefined
                }
                style={styles.search}
              />
              <TextInput
                mode="outlined"
                dense
                placeholder="En"
                keyboardType="numeric"
                value={widthInput}
                onChangeText={setWidthInput}
                style={styles.widthInput}
              />
              <TouchableRipple
                onPress={() => setFilterOpen(true)}
                style={[styles.filterBtn, filterCount > 0 && styles.filterBtnActive]}
                borderless
                accessibilityLabel="Detaylı filtre"
              >
                <View style={styles.filterBtnInner}>
                  <Icon source="filter-variant" size={22} color={filterCount > 0 ? '#fff' : colors.brand} />
                  {filterCount > 0 ? <Text style={styles.filterCount}>{filterCount}</Text> : null}
                </View>
              </TouchableRipple>
            </View>
          ) : null}

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator />
            </View>
          ) : tab === 'uygun' ? (
            <FlashList
              data={linkableLines}
              keyExtractor={(l) => l.id}
              renderItem={renderLinkableRow}
              ListEmptyComponent={
                <Text style={styles.empty}>
                  Bu iş emrinin hedefiyle uyumlu açık sipariş yok.{'\n'}
                  "Tüm Siparişler" sekmesinden arayabilirsin.
                </Text>
              }
            />
          ) : (
            <FlashList
              data={allLines}
              keyExtractor={(l) => l.lineId}
              renderItem={renderAllRow}
              onEndReached={() => {
                if (allQ.hasNextPage && !allQ.isFetchingNextPage) void allQ.fetchNextPage();
              }}
              onEndReachedThreshold={0.4}
              ListFooterComponent={
                allQ.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: spacing.md }} /> : null
              }
              ListEmptyComponent={<Text style={styles.empty}>Açık sipariş bulunamadı.</Text>}
            />
          )}
        </View>
      </ResizableSheetModal>

      {/* Uyumlu bağ — yanlış dokunuşa karşı tek adımlı onay. */}
      <ConfirmDialog
        kind="simple"
        visible={!!confirmLink}
        onDismiss={() => setConfirmLink(null)}
        title="Siparişi bağla"
        description={`${confirmLink?.label ?? ''} bu iş emrine bağlanacak. Hedef/rota/metraj DEĞİŞMEZ.`}
        confirmLabel="Bağla"
        confirming={linkMut.isPending}
        onConfirm={() => {
          const c = confirmLink;
          setConfirmLink(null);
          if (c) linkMut.mutate(c.lineId);
        }}
      />

      {/* Süpervizör override — sorular + zorunlu sebep. Backend zinciri: plan
          düzelt + iş emrinin düzeltilebilir TÜM topları eşitle + bağla. */}
      <ConfirmDialog
        kind="destructive"
        visible={!!confirmOverride}
        onDismiss={() => setConfirmOverride(null)}
        title="Uyumsuz siparişi düzelterek bağla"
        description={
          <View>
            {(confirmOverride?.questions ?? []).map((q, i) => (
              <Text key={i} style={styles.questionText}>
                • {q}
              </Text>
            ))}
            <Text style={styles.questionNote}>
              Onaylarsan iş emrinin hedefi VE bu iş emrindeki düzeltilebilir TÜM
              toplar siparişin değerine çekilir, sonra bağ kurulur. Karar sebeple
              kayda geçer.
            </Text>
          </View>
        }
        reason={{
          label: 'Sebep',
          placeholder: 'örn: planlamacı yanlış renk girmiş, mal siparişin rengi',
        }}
        confirmLabel="Düzelt ve Bağla"
        confirming={overrideMut.isPending}
        onConfirm={({ reason }) => {
          const c = confirmOverride;
          setConfirmOverride(null);
          if (c && reason) overrideMut.mutate({ lineId: c.lineId, reason });
        }}
      />

      <OrderLineFilterSheet
        visible={filterOpen}
        onDismiss={() => setFilterOpen(false)}
        value={filters}
        onApply={setFilters}
      />
    </>
  );
}

const styles = StyleSheet.create({
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  sheetSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  doneBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md },
  doneText: { color: colors.brand, fontWeight: '700' },
  body: { flex: 1, paddingHorizontal: spacing.md },
  tabRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  tabBtnActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.text },
  tabTextActive: { color: '#fff' },
  searchRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginBottom: spacing.sm },
  search: { flex: 1, backgroundColor: colors.surface },
  widthInput: { width: 72, backgroundColor: colors.surface },
  filterBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtnActive: { backgroundColor: colors.brand },
  filterBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  filterCount: { color: '#fff', fontWeight: '700', fontSize: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl },
  row: { borderRadius: radius.md, marginBottom: 2 },
  rowDead: { opacity: 0.45 },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  rowTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  rowTextDead: { color: colors.textMuted },
  openQty: { fontSize: 13, fontWeight: '700', color: colors.brand },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3 },
  chip: { borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1, borderWidth: 1 },
  chipHard: { backgroundColor: '#fef2f2', borderColor: '#fca5a5' },
  chipSoft: { backgroundColor: '#fffbeb', borderColor: '#fcd34d' },
  chipText: { fontSize: 11, fontWeight: '600' },
  chipTextHard: { color: '#b91c1c' },
  chipTextSoft: { color: '#b45309' },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    paddingVertical: spacing.xl,
    fontSize: 13,
    lineHeight: 20,
  },
  questionText: { fontSize: 14, color: colors.text, marginBottom: 6, lineHeight: 20 },
  questionNote: { fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 18 },
});
