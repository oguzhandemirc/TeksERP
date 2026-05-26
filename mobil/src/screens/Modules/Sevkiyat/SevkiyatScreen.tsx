import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import RNModal from 'react-native-modal';
import {
  Text,
  TextInput,
  Button,
  IconButton,
  Surface,
  ActivityIndicator,
  TouchableRipple,
  Icon,
} from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import dayjs from 'dayjs';

import ScreenChrome from '../../../components/ScreenChrome';
import RefreshButton from '../../../components/RefreshButton';
import { NumpadHost } from '../../../components/NumpadProvider';
import { useDeviceType } from '../../../hooks/useDeviceType';
import {
  shippingService,
  type ShipmentDetail,
  type ShipmentSummary,
} from '../../../services/shipping.service';
import {
  sackService,
  type SackListItem,
  type OpenSackOverview,
} from '../../../services/sack.service';
import { customerService } from '../../../services/customer.service';
import { customerBranchService } from '../../../services/customerBranch.service';

// =============================================================================
// Multi-tab — her tab bir PREPARING sevkiyat hazırlığı
// =============================================================================
interface ShipTab {
  tabId: string;
  shipmentId: string;
  shipmentNumber: string;
  customerId: string;
  customerName: string;
}

type RightTab = 'sacks' | 'preparing' | 'history';

export default function SevkiyatScreen() {
  const qc = useQueryClient();
  const device = useDeviceType();
  const isPhone = device === 'phone';

  const [openTabs, setOpenTabs] = useState<ShipTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [newShipmentOpen, setNewShipmentOpen] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>('sacks');

  const activeTab = useMemo(
    () => openTabs.find((t) => t.tabId === activeTabId) ?? null,
    [openTabs, activeTabId]
  );

  // ── Queries ──
  const shipmentDetailQuery = useQuery({
    queryKey: ['shipment', activeTab?.shipmentId],
    queryFn: () =>
      activeTab
        ? shippingService.getById(activeTab.shipmentId)
        : Promise.resolve(null),
    enabled: !!activeTab,
    staleTime: 10 * 1000,
  });

  const customerSacksQuery = useQuery({
    queryKey: ['sacks', 'by-customer', activeTab?.customerId],
    queryFn: () =>
      activeTab
        ? sackService.listByCustomer(activeTab.customerId)
        : Promise.resolve(null),
    enabled: !!activeTab,
    staleTime: 15 * 1000,
  });

  const preparingShipmentsQuery = useQuery({
    queryKey: ['shipments', 'preparing'],
    queryFn: () => shippingService.list({ status: 'PREPARING' }),
    staleTime: 30 * 1000,
  });

  const historyShipmentsQuery = useQuery({
    queryKey: ['shipments', 'shipped'],
    queryFn: () => shippingService.list({ status: 'SHIPPED' }),
    enabled: rightTab === 'history',
    staleTime: 30 * 1000,
  });

  // Bekleyen çuvallar — empty state'te müşteri-bazlı özet için
  const pendingSacksQuery = useQuery({
    queryKey: ['sacks', 'open', 'all'],
    queryFn: () => sackService.listAllOpen(),
    enabled: !activeTab,
    staleTime: 15 * 1000,
  });

  // ── Mutations ──
  const createShipmentMutation = useMutation({
    mutationFn: shippingService.createShipment,
    onSuccess: (res) => {
      const s = res.data;
      if (s) {
        const tab: ShipTab = {
          tabId: `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          shipmentId: s.id,
          shipmentNumber: s.shipmentNumber,
          customerId: s.customerId,
          customerName:
            s.customer?.name ?? s.customerNameSnapshot ?? '—',
        };
        setOpenTabs((prev) => [...prev, tab]);
        setActiveTabId(tab.tabId);
      }
      qc.invalidateQueries({ queryKey: ['shipments', 'preparing'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Sevkiyat oluşturuldu', text2: s?.shipmentNumber });
      setNewShipmentOpen(false);
    },
    onError: (err: Error) =>
      Toast.show({ type: 'error', text1: 'Sevkiyat oluşturulamadı', text2: err.message }),
  });

  const addSackMutation = useMutation({
    mutationFn: ({ shipmentId, sackId }: { shipmentId: string; sackId: string }) =>
      shippingService.addSack(shipmentId, sackId),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Çuval sevkiyata eklendi' });
      qc.invalidateQueries({ queryKey: ['shipment', activeTab?.shipmentId] });
      qc.invalidateQueries({ queryKey: ['sacks', 'by-customer', activeTab?.customerId] });
    },
    onError: (err: Error) =>
      Toast.show({ type: 'error', text1: 'Eklenemedi', text2: err.message }),
  });

  const removeSackMutation = useMutation({
    mutationFn: ({ shipmentId, sackId }: { shipmentId: string; sackId: string }) =>
      shippingService.removeSack(shipmentId, sackId),
    onSuccess: () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Toast.show({ type: 'success', text1: 'Çuval çıkarıldı' });
      qc.invalidateQueries({ queryKey: ['shipment', activeTab?.shipmentId] });
      qc.invalidateQueries({ queryKey: ['sacks', 'by-customer', activeTab?.customerId] });
    },
    onError: (err: Error) =>
      Toast.show({ type: 'error', text1: 'Çıkarılamadı', text2: err.message }),
  });

  const finalizeMutation = useMutation({
    mutationFn: shippingService.finalize,
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Sevkiyat tamamlandı',
        text2: 'Toplar SHIPPED, çuvallar sevk edildi',
      });
      // Aktif tab'ı kapat
      if (activeTab) {
        setOpenTabs((prev) => prev.filter((t) => t.tabId !== activeTab.tabId));
        const remaining = openTabs.filter((t) => t.tabId !== activeTab.tabId);
        setActiveTabId(remaining[0]?.tabId ?? null);
      }
      qc.invalidateQueries({ queryKey: ['shipments'] });
      qc.invalidateQueries({ queryKey: ['ready-orders'] });
    },
    onError: (err: Error) =>
      Toast.show({ type: 'error', text1: 'Finalize başarısız', text2: err.message }),
  });

  // ── Handlers ──
  const openTabForExisting = (s: ShipmentSummary) => {
    const existing = openTabs.find((t) => t.shipmentId === s.id);
    if (existing) {
      setActiveTabId(existing.tabId);
      return;
    }
    const tab: ShipTab = {
      tabId: `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      shipmentId: s.id,
      shipmentNumber: s.shipmentNumber,
      customerId: s.customerId,
      customerName: s.customer?.name ?? s.customerNameSnapshot ?? '—',
    };
    setOpenTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.tabId);
  };

  const closeTab = (tabId: string) => {
    setOpenTabs((prev) => prev.filter((t) => t.tabId !== tabId));
    if (activeTabId === tabId) {
      const remaining = openTabs.filter((t) => t.tabId !== tabId);
      setActiveTabId(remaining[0]?.tabId ?? null);
    }
  };

  // ── Render ──
  const shipmentDetail = shipmentDetailQuery.data?.data ?? null;
  const customerSacks = customerSacksQuery.data?.data ?? [];
  // Hazır çuvallar = bu müşterinin shipmentId NULL olan veya bu sevkiyata atanmış olan
  const availableSacks = customerSacks.filter(
    (s) => !s.shipmentId || s.shipmentId === activeTab?.shipmentId
  );

  return (
    <ScreenChrome
      title="Sevkiyat"
      subtitle="Çuvalları sevkiyata bağla, irsaliye kes, yola çıkar"
    >
      <View style={[styles.body, isPhone && styles.bodyPhone]}>
        {/* ════════ SOL: aktif sevkiyat ════════ */}
        <View style={styles.formCol}>
          {!activeTab ? (
            <PendingSacksOverview
              sacks={pendingSacksQuery.data?.data ?? []}
              loading={pendingSacksQuery.isLoading}
              onOpenForCustomer={async (customerId) => {
                // 1) Sevkiyatı oluştur, 2) müşterinin tüm bağlanmamış çuvallarını
                // otomatik bu sevkiyata bağla. Operatör tek tek "Ekle"
                // basmasın — zaten hepsi aynı müşteriye gidecek.
                try {
                  const created = await createShipmentMutation.mutateAsync({
                    customerId,
                  });
                  const shipmentId = created.data?.id;
                  if (!shipmentId) return;

                  const customerSacks = (
                    pendingSacksQuery.data?.data ?? []
                  ).filter(
                    (s) => s.customer.id === customerId && !s.shipment,
                  );

                  let added = 0;
                  for (const sk of customerSacks) {
                    try {
                      await shippingService.addSack(shipmentId, sk.id);
                      added++;
                    } catch {
                      // Bir çuval başarısız olursa devam — operatör eksiği
                      // sağ panelden manuel ekleyebilir.
                    }
                  }

                  qc.invalidateQueries({
                    queryKey: ['shipment', shipmentId],
                  });
                  qc.invalidateQueries({ queryKey: ['sacks'] });

                  if (added > 0) {
                    Toast.show({
                      type: 'success',
                      text1: `${added} çuval sevkiyata eklendi`,
                      text2: 'Plaka/sürücü gir ve "Yola Çıkar" bas',
                    });
                  }
                } catch {
                  // mutation onError zaten toast atıyor
                }
              }}
              creating={createShipmentMutation.isPending}
              onOpenManual={() => setNewShipmentOpen(true)}
            />
          ) : (
            <ActiveShipmentPanel
              tab={activeTab}
              shipment={shipmentDetail}
              loading={shipmentDetailQuery.isLoading}
              onRemoveSack={(sackId) =>
                removeSackMutation.mutate({
                  shipmentId: activeTab.shipmentId,
                  sackId,
                })
              }
              onFinalize={() => finalizeMutation.mutate(activeTab.shipmentId)}
              finalizing={finalizeMutation.isPending}
              removing={removeSackMutation.isPending}
            />
          )}
        </View>

        {/* ════════ SAĞ: tab + paneller + numpad ════════ */}
        <View style={[styles.rightCol, isPhone && styles.rightColPhone]}>
          {/* Açık sevkiyat tab bar'ı */}
          <View style={styles.shipTabBar}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.shipTabScroll}
            >
              {openTabs.map((t) => (
                <ShipTabPill
                  key={t.tabId}
                  tab={t}
                  active={t.tabId === activeTabId}
                  onPress={() => setActiveTabId(t.tabId)}
                  onClose={() => closeTab(t.tabId)}
                />
              ))}
              <Button
                mode="outlined"
                icon="plus"
                compact
                onPress={() => setNewShipmentOpen(true)}
                style={styles.newShipBtn}
                textColor="#1e40af"
              >
                Yeni Sevkiyat
              </Button>
            </ScrollView>
          </View>

          {/* Info tab bar */}
          <View style={styles.infoTabBar}>
            <InfoTab
              label="Hazır Çuvallar"
              count={
                activeTab
                  ? availableSacks.filter((s) => !s.shipmentId).length
                  : undefined
              }
              active={rightTab === 'sacks'}
              onPress={() => setRightTab('sacks')}
              activeColor="#059669"
            />
            <InfoTab
              label="Açık Sevkiyatlar"
              count={preparingShipmentsQuery.data?.data?.length ?? 0}
              active={rightTab === 'preparing'}
              onPress={() => setRightTab('preparing')}
              activeColor="#1e40af"
            />
            <InfoTab
              label="Geçmiş"
              active={rightTab === 'history'}
              onPress={() => setRightTab('history')}
              activeColor="#475569"
            />
            <View style={styles.refreshWrap}>
              <RefreshButton
                onPress={() => {
                  if (rightTab === 'sacks') customerSacksQuery.refetch();
                  else if (rightTab === 'preparing') preparingShipmentsQuery.refetch();
                  else historyShipmentsQuery.refetch();
                }}
                refreshing={
                  (rightTab === 'sacks' && customerSacksQuery.isFetching) ||
                  (rightTab === 'preparing' && preparingShipmentsQuery.isFetching) ||
                  (rightTab === 'history' && historyShipmentsQuery.isFetching)
                }
              />
            </View>
          </View>

          {/* Tab içerikleri */}
          {rightTab === 'sacks' && (
            <SacksPane
              loading={customerSacksQuery.isLoading}
              activeTab={activeTab}
              sacks={availableSacks}
              currentShipmentId={activeTab?.shipmentId ?? null}
              onAddSack={(sackId) =>
                activeTab &&
                addSackMutation.mutate({
                  shipmentId: activeTab.shipmentId,
                  sackId,
                })
              }
              adding={addSackMutation.isPending}
            />
          )}
          {rightTab === 'preparing' && (
            <ShipmentListPane
              loading={preparingShipmentsQuery.isLoading}
              shipments={preparingShipmentsQuery.data?.data ?? []}
              onPick={openTabForExisting}
              activeShipmentId={activeTab?.shipmentId ?? null}
              variant="preparing"
            />
          )}
          {rightTab === 'history' && (
            <ShipmentListPane
              loading={historyShipmentsQuery.isLoading}
              shipments={historyShipmentsQuery.data?.data ?? []}
              onPick={openTabForExisting}
              activeShipmentId={null}
              variant="history"
            />
          )}

          <NumpadHost style={styles.numpadHost} />
        </View>
      </View>

      <NewShipmentModal
        visible={newShipmentOpen}
        onDismiss={() => setNewShipmentOpen(false)}
        onCreate={(data) => createShipmentMutation.mutate(data)}
        creating={createShipmentMutation.isPending}
      />
    </ScreenChrome>
  );
}

// =============================================================================
// PendingSacksOverview — empty state'te bekleyen çuvalları müşteriye göre
// gruplayıp gösterir; tap → o müşteri için yeni sevkiyat açar.
// =============================================================================

interface CustomerGroup {
  customerId: string;
  customerName: string;
  customerCode: string;
  sackCount: number;
  totalQty: number;
  totalRollWeight: number;
  totalRolls: number;
}

function PendingSacksOverview({
  sacks,
  loading,
  onOpenForCustomer,
  creating,
  onOpenManual,
}: {
  sacks: OpenSackOverview[];
  loading: boolean;
  onOpenForCustomer: (customerId: string) => void;
  creating: boolean;
  onOpenManual: () => void;
}) {
  const groups = useMemo<CustomerGroup[]>(() => {
    // Yalnız shipment'a bağlanmamış çuvalları say
    const unbound = sacks.filter((s) => !s.shipment);
    const m = new Map<string, CustomerGroup>();
    for (const s of unbound) {
      const cur = m.get(s.customer.id);
      if (cur) {
        cur.sackCount += 1;
        cur.totalQty += s.totalQty;
        cur.totalRollWeight += s.totalRollWeight;
        cur.totalRolls += s.rollCount;
      } else {
        m.set(s.customer.id, {
          customerId: s.customer.id,
          customerName: s.customer.name,
          customerCode: s.customer.code,
          sackCount: 1,
          totalQty: s.totalQty,
          totalRollWeight: s.totalRollWeight,
          totalRolls: s.rollCount,
        });
      }
    }
    return Array.from(m.values()).sort((a, b) =>
      a.customerName.localeCompare(b.customerName, 'tr'),
    );
  }, [sacks]);

  return (
    <View style={pendingStyles.root}>
      <View style={pendingStyles.header}>
        <View style={{ flex: 1 }}>
          <Text style={pendingStyles.title}>Bekleyen Çuvallar</Text>
          <Text style={pendingStyles.subtitle}>
            Tartı/Paket'te hazırlandı, sevkiyat bekliyor
          </Text>
        </View>
        <Button
          mode="outlined"
          icon="plus"
          onPress={onOpenManual}
          disabled={creating}
        >
          Manuel Aç
        </Button>
      </View>

      {loading ? (
        <View style={pendingStyles.center}>
          <ActivityIndicator />
        </View>
      ) : groups.length === 0 ? (
        <View style={pendingStyles.center}>
          <Icon source="package-variant" size={48} color="#cbd5e1" />
          <Text style={pendingStyles.emptyTitle}>Bekleyen çuval yok</Text>
          <Text style={pendingStyles.emptyHint}>
            Tartı/Paket operatörü sevkiyata gönderdiğinde burada görünür.
          </Text>
        </View>
      ) : (
        <FlashList
          data={groups}
          keyExtractor={(g) => g.customerId}
          contentContainerStyle={pendingStyles.list}
          renderItem={({ item }) => (
            <TouchableRipple
              onPress={() => onOpenForCustomer(item.customerId)}
              disabled={creating}
              style={pendingStyles.card}
              borderless
            >
              <View style={pendingStyles.cardInner}>
                <View style={{ flex: 1 }}>
                  <Text style={pendingStyles.customerName} numberOfLines={1}>
                    {item.customerName}
                  </Text>
                  <Text style={pendingStyles.customerCode}>
                    {item.customerCode}
                  </Text>
                  <View style={pendingStyles.metricsRow}>
                    <Metric
                      label="Çuval"
                      value={item.sackCount.toString()}
                    />
                    <Metric
                      label="Top"
                      value={item.totalRolls.toString()}
                    />
                    <Metric
                      label="Metre"
                      value={item.totalQty.toLocaleString('tr-TR', {
                        maximumFractionDigits: 0,
                      })}
                    />
                    {item.totalRollWeight > 0 && (
                      <Metric
                        label="kg"
                        value={item.totalRollWeight.toFixed(0)}
                      />
                    )}
                  </View>
                </View>
                <View style={pendingStyles.cta}>
                  <Icon source="truck-plus" size={28} color="#10b981" />
                  <Text style={pendingStyles.ctaText}>Sevkiyat Aç</Text>
                </View>
              </View>
            </TouchableRipple>
          )}
        />
      )}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={pendingStyles.metric}>
      <Text style={pendingStyles.metricValue}>{value}</Text>
      <Text style={pendingStyles.metricLabel}>{label}</Text>
    </View>
  );
}

const pendingStyles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 2 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#475569' },
  emptyHint: { color: '#94a3b8', textAlign: 'center', maxWidth: 360 },
  list: { paddingVertical: 8, gap: 8 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 8,
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 16,
  },
  customerName: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  customerCode: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 10,
  },
  metric: { alignItems: 'flex-start' },
  metricValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    fontSize: 10,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontWeight: '600',
  },
  cta: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
  },
  ctaText: { fontSize: 11, color: '#10b981', fontWeight: '700' },
});

// =============================================================================
function ActiveShipmentPanel({
  tab,
  shipment,
  loading,
  onRemoveSack,
  onFinalize,
  finalizing,
  removing,
}: {
  tab: ShipTab;
  shipment: ShipmentDetail | null;
  loading: boolean;
  onRemoveSack: (sackId: string) => void;
  onFinalize: () => void;
  finalizing: boolean;
  removing: boolean;
}) {
  const sacks = shipment?.sacks ?? [];
  const items = shipment?.items ?? [];

  // Toplam istatistik
  const totalRolls = items.length;
  const totalQty = items.reduce((s, i) => s + (i.shippedQty ?? 0), 0);
  const totalWeight = sacks.reduce((s, sa) => s + (sa.weightKg ?? 0), 0);

  return (
    <>
      <Surface style={styles.headerBand} elevation={2}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerNumber}>{tab.shipmentNumber}</Text>
          <Text style={styles.headerCustomer}>{tab.customerName}</Text>
        </View>
        {shipment?.status === 'PREPARING' && (
          <View style={styles.statusPillPreparing}>
            <Text style={styles.statusPillPreparingText}>HAZIRLANIYOR</Text>
          </View>
        )}
      </Surface>

      {loading ? (
        <View style={styles.paneEmpty}>
          <ActivityIndicator size="large" color="#1e40af" />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Plaka/sürücü/taşıyıcı bilgileri */}
          <Surface style={styles.section} elevation={1}>
            <Text style={styles.sectionTitle}>Araç Bilgisi</Text>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Plaka:</Text>
              <Text style={styles.infoValue}>
                {shipment?.plateNumber ?? '—'}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Sürücü:</Text>
              <Text style={styles.infoValue}>{shipment?.driverName ?? '—'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Taşıyıcı:</Text>
              <Text style={styles.infoValue}>{shipment?.carrier ?? '—'}</Text>
            </View>
          </Surface>

          {/* Toplam istatistik */}
          <Surface style={styles.statsCard} elevation={1}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{sacks.length}</Text>
              <Text style={styles.statLabel}>Çuval</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{totalRolls}</Text>
              <Text style={styles.statLabel}>Top</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{totalQty.toFixed(1)}</Text>
              <Text style={styles.statLabel}>Metre</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{totalWeight.toFixed(2)}</Text>
              <Text style={styles.statLabel}>kg (brüt)</Text>
            </View>
          </Surface>

          {/* Sevkiyatta olan çuvallar */}
          <Surface style={styles.section} elevation={1}>
            <Text style={styles.sectionTitle}>Sevkiyatta ({sacks.length})</Text>
            {sacks.length === 0 ? (
              <Text style={styles.muted}>
                Sağdan "Hazır Çuvallar" tabından bu sevkiyata çuval ekleyin
              </Text>
            ) : (
              sacks.map((s) => (
                <View key={s.id} style={styles.sackRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sackNumber}>{s.sackNumber}</Text>
                    <Text style={styles.sackMeta}>
                      {s._count?.rolls ?? 0} top · {s._count?.swatches ?? 0} kartela
                      {s.weightKg != null
                        ? ` · ${s.weightKg.toFixed(2)} kg`
                        : ''}
                    </Text>
                  </View>
                  <IconButton
                    icon="close"
                    size={20}
                    iconColor="#dc2626"
                    onPress={() => onRemoveSack(s.id)}
                    disabled={removing}
                    style={{ margin: 0 }}
                  />
                </View>
              ))
            )}
          </Surface>
        </ScrollView>
      )}

      {/* Sticky footer — finalize */}
      <Surface style={styles.footer} elevation={4}>
        <Button
          mode="contained"
          icon="truck-check"
          onPress={onFinalize}
          loading={finalizing}
          disabled={finalizing || sacks.length === 0}
          buttonColor="#059669"
          contentStyle={styles.footerBtnContent}
          labelStyle={styles.footerBtnLabel}
        >
          {sacks.length === 0
            ? 'Çuval ekle'
            : `Sevkiyatı Tamamla (${sacks.length} çuval, ${totalRolls} top)`}
        </Button>
      </Surface>
    </>
  );
}

// =============================================================================
function ShipTabPill({
  tab,
  active,
  onPress,
  onClose,
}: {
  tab: ShipTab;
  active: boolean;
  onPress: () => void;
  onClose: () => void;
}) {
  return (
    <Surface
      style={[helperStyles.tab, active && helperStyles.tabActive]}
      elevation={active ? 2 : 1}
    >
      <TouchableRipple onPress={onPress} borderless style={helperStyles.tabPress}>
        <View style={helperStyles.tabInner}>
          <View style={helperStyles.tabTextWrap}>
            <Text
              style={[helperStyles.tabLabel, active && { color: '#1e40af' }]}
              numberOfLines={1}
            >
              {tab.shipmentNumber}
            </Text>
            <Text style={helperStyles.tabSub} numberOfLines={1}>
              {tab.customerName}
            </Text>
          </View>
          <IconButton
            icon="close"
            size={14}
            onPress={onClose}
            iconColor="#94a3b8"
            style={{ margin: 0, width: 28, height: 28 }}
          />
        </View>
      </TouchableRipple>
    </Surface>
  );
}

function InfoTab({
  label,
  count,
  active,
  activeColor,
  onPress,
}: {
  label: string;
  count?: number;
  active: boolean;
  activeColor: string;
  onPress: () => void;
}) {
  return (
    <TouchableRipple
      borderless
      onPress={onPress}
      style={[
        helperStyles.infoTab,
        active && { borderBottomColor: activeColor, borderBottomWidth: 3 },
      ]}
    >
      <View style={helperStyles.infoTabInner}>
        <Text
          style={[helperStyles.infoTabLabel, active && { color: activeColor }]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {typeof count === 'number' && count > 0 && (
          <View
            style={[helperStyles.infoTabCount, active && { backgroundColor: activeColor }]}
          >
            <Text style={[helperStyles.infoTabCountText, active && { color: '#fff' }]}>
              {count}
            </Text>
          </View>
        )}
      </View>
    </TouchableRipple>
  );
}

// =============================================================================
function SacksPane({
  loading,
  activeTab,
  sacks,
  currentShipmentId,
  onAddSack,
  adding,
}: {
  loading: boolean;
  activeTab: ShipTab | null;
  sacks: SackListItem[];
  currentShipmentId: string | null;
  onAddSack: (sackId: string) => void;
  adding: boolean;
}) {
  if (!activeTab) {
    return (
      <View style={styles.paneEmpty}>
        <Icon source="package-variant-closed" size={48} color="#cbd5e1" />
        <Text style={styles.paneEmptyText}>Sevkiyat seçilmedi</Text>
      </View>
    );
  }
  if (loading) {
    return (
      <View style={styles.paneEmpty}>
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
  }
  const free = sacks.filter((s) => !s.shipmentId);
  if (free.length === 0) {
    return (
      <View style={styles.paneEmpty}>
        <Icon source="package-variant" size={48} color="#cbd5e1" />
        <Text style={styles.paneEmptyText}>Hazır çuval yok</Text>
        <Text style={styles.paneEmptyHint}>
          {activeTab.customerName} için tartı/paket'te çuval doldurulması gerekiyor
        </Text>
      </View>
    );
  }
  return (
    <FlashList
      data={free}
      keyExtractor={(s) => s.id}
      contentContainerStyle={{ padding: 8 }}
      renderItem={({ item }) => (
        <Surface style={styles.availSackCard} elevation={1}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sackNumber}>{item.sackNumber}</Text>
            <Text style={styles.sackMeta}>
              {item.rollCount} top · {item.swatchCount} kartela ·{' '}
              {item.totalQty.toFixed(1)} m
              {item.weightKg != null ? ` · ${item.weightKg.toFixed(2)} kg` : ''}
            </Text>
          </View>
          <Button
            mode="contained"
            icon="plus"
            compact
            onPress={() => onAddSack(item.id)}
            disabled={adding}
            buttonColor="#1e40af"
          >
            Ekle
          </Button>
        </Surface>
      )}
    />
  );
}

// =============================================================================
function ShipmentListPane({
  loading,
  shipments,
  onPick,
  activeShipmentId,
  variant,
}: {
  loading: boolean;
  shipments: ShipmentSummary[];
  onPick: (s: ShipmentSummary) => void;
  activeShipmentId: string | null;
  variant: 'preparing' | 'history';
}) {
  if (loading) {
    return (
      <View style={styles.paneEmpty}>
        <ActivityIndicator size="large" color="#1e40af" />
      </View>
    );
  }
  if (shipments.length === 0) {
    return (
      <View style={styles.paneEmpty}>
        <Icon source="truck-outline" size={48} color="#cbd5e1" />
        <Text style={styles.paneEmptyText}>
          {variant === 'preparing' ? 'Hazırlık aşamasında sevkiyat yok' : 'Geçmiş sevkiyat yok'}
        </Text>
      </View>
    );
  }
  return (
    <FlashList
      data={shipments}
      keyExtractor={(s) => s.id}
      contentContainerStyle={{ padding: 8 }}
      renderItem={({ item }) => {
        const active = activeShipmentId === item.id;
        return (
          <Surface
            style={[styles.shipCard, active && styles.shipCardActive]}
            elevation={active ? 2 : 1}
          >
            <TouchableRipple
              borderless
              onPress={() => onPick(item)}
              style={{ borderRadius: 10 }}
            >
              <View style={{ padding: 10 }}>
                <View style={styles.shipHeader}>
                  <Text style={styles.shipNumber}>{item.shipmentNumber}</Text>
                  <View
                    style={[
                      styles.shipStatusPill,
                      item.status === 'SHIPPED' && {
                        backgroundColor: '#dbeafe',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.shipStatusText,
                        item.status === 'SHIPPED' && { color: '#1e40af' },
                      ]}
                    >
                      {item.status === 'SHIPPED' ? 'GİTTİ' : 'HAZIR'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.shipCustomer}>
                  {item.customer?.name ?? item.customerNameSnapshot ?? '—'}
                  {item.branch
                    ? ` · ${item.branch.name}`
                    : item.branchNameSnapshot
                      ? ` · ${item.branchNameSnapshot}`
                      : ''}
                </Text>
                {item.plateNumber && (
                  <Text style={styles.shipMeta}>🚚 {item.plateNumber}</Text>
                )}
                {variant === 'preparing' && item.plannedDate && (
                  <Text style={styles.shipMeta}>
                    📅 Plan: {dayjs(item.plannedDate).format('DD.MM.YYYY')}
                  </Text>
                )}
                {variant === 'preparing' &&
                  item.plannedOrders &&
                  item.plannedOrders.length > 0 && (
                    <View style={styles.shipPlannedBox}>
                      <Text style={styles.shipPlannedLabel}>
                        Planlanan ({item.plannedOrders.length}):
                      </Text>
                      <View style={styles.shipPlannedList}>
                        {item.plannedOrders.slice(0, 3).map((p) => (
                          <Text
                            key={p.id}
                            style={styles.shipPlannedItem}
                            numberOfLines={1}
                          >
                            {p.order.orderNumber}
                          </Text>
                        ))}
                        {item.plannedOrders.length > 3 && (
                          <Text style={styles.shipPlannedItem}>
                            +{item.plannedOrders.length - 3} daha
                          </Text>
                        )}
                      </View>
                    </View>
                  )}
                {item.shippedAt && (
                  <Text style={styles.shipDate}>
                    {dayjs(item.shippedAt).format('DD.MM.YYYY HH:mm')}
                  </Text>
                )}
              </View>
            </TouchableRipple>
          </Surface>
        );
      }}
    />
  );
}

// =============================================================================
function NewShipmentModal({
  visible,
  onDismiss,
  onCreate,
  creating,
}: {
  visible: boolean;
  onDismiss: () => void;
  onCreate: (data: {
    customerId: string;
    branchId?: string;
    driverName?: string;
    plateNumber?: string;
    carrier?: string;
  }) => void;
  creating: boolean;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [driverName, setDriverName] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [carrier, setCarrier] = useState('');
  const [search, setSearch] = useState('');

  const branchesQuery = useQuery({
    queryKey: ['customer', customerId, 'branches'],
    queryFn: () =>
      customerId
        ? customerBranchService.list(customerId)
        : Promise.resolve(null),
    enabled: visible && !!customerId,
    staleTime: 30 * 1000,
  });
  const branches = branchesQuery.data?.data ?? [];

  const customersQuery = useQuery({
    queryKey: ['customers', 'all'],
    queryFn: () =>
      customerService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: 'name',
        sortOrder: 'asc',
        filters: { isActive: 'true' },
      }),
    enabled: visible && !customerId,
  });

  const customers = customersQuery.data?.data ?? [];
  const filteredCustomers = useMemo(
    () =>
      search.trim()
        ? customers.filter((c) =>
            c.name.toLocaleLowerCase('tr').includes(search.toLocaleLowerCase('tr'))
          )
        : customers,
    [customers, search]
  );

  useEffect(() => {
    if (!visible) {
      setCustomerId(null);
      setCustomerName('');
      setBranchId(null);
      setDriverName('');
      setPlateNumber('');
      setCarrier('');
      setSearch('');
    }
  }, [visible]);

  // Müşteri değişince şube seçimini sıfırla
  useEffect(() => {
    setBranchId(null);
  }, [customerId]);

  const handleCreate = () => {
    if (!customerId) {
      Toast.show({ type: 'error', text1: 'Müşteri seçin' });
      return;
    }
    onCreate({
      customerId,
      branchId: branchId ?? undefined,
      driverName: driverName.trim() || undefined,
      plateNumber: plateNumber.trim() || undefined,
      carrier: carrier.trim() || undefined,
    });
  };

  return (
    <RNModal
      isVisible={visible}
      onBackdropPress={onDismiss}
      onBackButtonPress={onDismiss}
      backdropOpacity={0.55}
      style={modalStyles.modal}
      useNativeDriver
      hideModalContentWhileAnimating
      deviceWidth={winW}
      deviceHeight={winH}
      statusBarTranslucent
      avoidKeyboard
    >
      <View style={[modalStyles.sheet, { width: winW * 0.65, maxHeight: winH * 0.85 }]}>
        <View style={modalStyles.header}>
          <Icon source="truck-plus" size={22} color="#1e40af" />
          <Text variant="titleMedium" style={modalStyles.title}>
            Yeni Sevkiyat
          </Text>
          <View style={{ flex: 1 }} />
          <IconButton icon="close" size={22} onPress={onDismiss} style={{ margin: 0 }} />
        </View>

        {!customerId ? (
          <View style={{ flex: 1 }}>
            <View style={{ padding: 10 }}>
              <TextInput
                mode="outlined"
                value={search}
                onChangeText={setSearch}
                placeholder="Müşteri ara..."
                left={<TextInput.Icon icon="magnify" />}
                dense
              />
            </View>
            {customersQuery.isLoading ? (
              <View style={styles.paneEmpty}>
                <ActivityIndicator size="large" color="#1e40af" />
              </View>
            ) : (
              <FlashList
                data={filteredCustomers}
                keyExtractor={(c) => c.id}
                contentContainerStyle={{ padding: 10 }}
                renderItem={({ item }) => (
                  <TouchableRipple
                    borderless
                    onPress={() => {
                      setCustomerId(item.id);
                      setCustomerName(item.name);
                    }}
                    style={modalStyles.customerRow}
                  >
                    <View style={modalStyles.customerInner}>
                      <Text style={modalStyles.customerName}>{item.name}</Text>
                      <Text style={modalStyles.customerCode}>{item.code}</Text>
                    </View>
                  </TouchableRipple>
                )}
              />
            )}
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 14, gap: 10 }}>
            <Surface style={modalStyles.selectedCustomerBox} elevation={0}>
              <View style={{ flex: 1 }}>
                <Text style={modalStyles.selectedCustomerLabel}>Müşteri</Text>
                <Text style={modalStyles.selectedCustomerName}>{customerName}</Text>
              </View>
              <Button mode="text" compact onPress={() => setCustomerId(null)}>
                Değiştir
              </Button>
            </Surface>

            <View>
              <Text style={modalStyles.fieldLabel}>
                Şube / Sevk Noktası{' '}
                <Text style={{ color: '#94a3b8' }}>(opsiyonel)</Text>
              </Text>
              {branchesQuery.isLoading ? (
                <ActivityIndicator
                  size="small"
                  color="#1e40af"
                  style={{ marginVertical: 8 }}
                />
              ) : branches.length === 0 ? (
                <Text style={modalStyles.fieldHint}>
                  Bu müşterinin tanımlı şubesi yok — şubesiz sevkiyat
                  oluşturulur.
                </Text>
              ) : (
                <View style={modalStyles.branchChips}>
                  <TouchableRipple
                    borderless
                    onPress={() => setBranchId(null)}
                    style={[
                      modalStyles.branchChip,
                      !branchId && modalStyles.branchChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        modalStyles.branchChipText,
                        !branchId && modalStyles.branchChipTextActive,
                      ]}
                    >
                      Belirtilmedi
                    </Text>
                  </TouchableRipple>
                  {branches.map((b) => (
                    <TouchableRipple
                      key={b.id}
                      borderless
                      onPress={() => setBranchId(b.id)}
                      style={[
                        modalStyles.branchChip,
                        branchId === b.id && modalStyles.branchChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          modalStyles.branchChipText,
                          branchId === b.id &&
                            modalStyles.branchChipTextActive,
                        ]}
                      >
                        {b.code ? `${b.code} — ${b.name}` : b.name}
                      </Text>
                    </TouchableRipple>
                  ))}
                </View>
              )}
            </View>

            <TextInput
              mode="outlined"
              label="Plaka (opsiyonel)"
              value={plateNumber}
              onChangeText={setPlateNumber}
              placeholder="34 ABC 1234"
              autoCapitalize="characters"
              style={styles.input}
              dense
            />
            <TextInput
              mode="outlined"
              label="Sürücü (opsiyonel)"
              value={driverName}
              onChangeText={setDriverName}
              style={styles.input}
              dense
            />
            <TextInput
              mode="outlined"
              label="Taşıyıcı (opsiyonel)"
              value={carrier}
              onChangeText={setCarrier}
              style={styles.input}
              dense
            />

            <Button
              mode="contained"
              icon="check"
              onPress={handleCreate}
              loading={creating}
              disabled={creating}
              buttonColor="#1e40af"
              style={{ marginTop: 8 }}
              contentStyle={{ height: 52 }}
              labelStyle={{ fontSize: 15, fontWeight: '700' }}
            >
              Sevkiyatı Oluştur
            </Button>
          </ScrollView>
        )}
      </View>
    </RNModal>
  );
}

// =============================================================================
const styles = StyleSheet.create({
  body: { flex: 1, flexDirection: 'row', backgroundColor: '#f8fafc' },
  bodyPhone: { flexDirection: 'column' },

  formCol: { flex: 1.4 },

  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 10,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#475569' },
  emptyHint: { fontSize: 13, color: '#94a3b8', textAlign: 'center', maxWidth: 360 },

  headerBand: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#0f172a',
    gap: 8,
  },
  headerNumber: {
    fontFamily: 'monospace',
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  headerCustomer: { fontSize: 13, color: '#cbd5e1', marginTop: 2 },
  statusPillPreparing: {
    backgroundColor: '#fcd34d',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusPillPreparingText: { fontSize: 10, fontWeight: '700', color: '#92400e' },

  scrollContent: { padding: 12, gap: 10 },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  muted: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic' },
  input: { backgroundColor: '#fff' },

  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoLabel: { fontSize: 12, color: '#64748b', fontWeight: '600', minWidth: 80 },
  infoValue: { fontSize: 13, color: '#0f172a', fontWeight: '600', flex: 1 },

  statsCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 8,
    alignItems: 'center',
  },
  statBox: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  statLabel: { fontSize: 10, color: '#64748b', marginTop: 2 },
  statDivider: { width: 1, height: 32, backgroundColor: '#e2e8f0' },

  sackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0fdf4',
    borderRadius: 8,
    padding: 8,
    marginVertical: 3,
    borderWidth: 1,
    borderColor: '#86efac',
  },
  sackNumber: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  sackMeta: { fontSize: 11, color: '#64748b', marginTop: 2 },

  footer: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    padding: 10,
  },
  footerBtnContent: { height: 60 },
  footerBtnLabel: { fontSize: 16, fontWeight: '700' },

  // Sağ
  rightCol: {
    flex: 1,
    backgroundColor: '#fff',
    borderLeftWidth: 1,
    borderLeftColor: '#e2e8f0',
  },
  rightColPhone: {
    borderLeftWidth: 0,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  shipTabBar: {
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 4,
  },
  shipTabScroll: { paddingHorizontal: 6, gap: 6, alignItems: 'center' },
  newShipBtn: { borderColor: '#1e40af' },
  infoTabBar: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  refreshWrap: {
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
    borderLeftWidth: 1,
    borderLeftColor: '#e2e8f0',
  },
  paneEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 6,
  },
  paneEmptyText: { fontSize: 14, color: '#94a3b8', fontWeight: '600' },
  paneEmptyHint: { fontSize: 12, color: '#cbd5e1', textAlign: 'center' },
  numpadHost: {
    margin: 8,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 8,
  },

  // Available sack card (sağ panel)
  availSackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    marginVertical: 3,
    padding: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },

  // Shipment card (preparing/history)
  shipCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    marginVertical: 3,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  shipCardActive: {
    backgroundColor: '#dbeafe',
    borderColor: '#1e40af',
    borderWidth: 2,
  },
  shipHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shipNumber: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
  },
  shipStatusPill: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  shipStatusText: { fontSize: 10, fontWeight: '700', color: '#92400e' },
  shipCustomer: { fontSize: 13, color: '#0f172a', fontWeight: '600', marginTop: 2 },
  shipMeta: { fontSize: 11, color: '#64748b', marginTop: 2, fontFamily: 'monospace' },
  shipDate: { fontSize: 10, color: '#94a3b8', marginTop: 2 },
  shipPlannedBox: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  shipPlannedLabel: {
    fontSize: 10,
    color: '#475569',
    fontWeight: '700',
  },
  shipPlannedList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 3,
  },
  shipPlannedItem: {
    fontSize: 10,
    color: '#1e40af',
    backgroundColor: '#dbeafe',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
});

const helperStyles = StyleSheet.create({
  tab: {
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    overflow: 'hidden',
    width: 180,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabActive: { backgroundColor: '#dbeafe', borderColor: '#1e40af' },
  tabPress: { borderRadius: 8, width: '100%' },
  tabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    paddingRight: 2,
    paddingVertical: 4,
    width: '100%',
  },
  tabTextWrap: { flex: 1, minWidth: 0 },
  tabLabel: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  tabSub: { fontSize: 10, color: '#64748b', marginTop: 2 },

  infoTab: { flex: 1, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  infoTabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 6,
  },
  infoTabLabel: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  infoTabCount: {
    backgroundColor: '#cbd5e1',
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 999,
    minWidth: 22,
    alignItems: 'center',
  },
  infoTabCountText: { fontSize: 11, fontWeight: '700', color: '#0f172a' },
});

const modalStyles = StyleSheet.create({
  modal: { justifyContent: 'center', alignItems: 'center', margin: 0, padding: 0 },
  sheet: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    gap: 8,
    backgroundColor: '#dbeafe',
  },
  title: { fontWeight: '700', color: '#0f172a' },
  customerRow: {
    backgroundColor: '#fff',
    borderRadius: 8,
    marginVertical: 3,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  customerInner: { padding: 12, gap: 4 },
  customerName: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  customerCode: { fontSize: 11, color: '#64748b', fontFamily: 'monospace' },
  selectedCustomerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f9ff',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#bae6fd',
  },
  selectedCustomerLabel: { fontSize: 11, color: '#0369a1', fontWeight: '600' },
  selectedCustomerName: { fontSize: 14, fontWeight: '700', color: '#0c4a6e', marginTop: 2 },
  fieldLabel: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
    marginBottom: 6,
  },
  fieldHint: {
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
    paddingVertical: 4,
  },
  branchChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  branchChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  branchChipActive: {
    borderColor: '#1e40af',
    backgroundColor: '#dbeafe',
  },
  branchChipText: { fontSize: 12, color: '#475569', fontWeight: '600' },
  branchChipTextActive: { color: '#1e3a8a' },
});
