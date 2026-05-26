import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, useWindowDimensions } from 'react-native';
import RNModal from 'react-native-modal';
import {
  Text,
  TextInput,
  IconButton,
  Surface,
  ActivityIndicator,
  TouchableRipple,
  Icon,
} from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import ScreenChrome from '../../../components/ScreenChrome';
import RefreshButton from '../../../components/RefreshButton';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { rollService } from '../../../services/roll.service';
import { ROLL_STATUS_LABEL, trLabel } from '../../../utils/labels';

// =============================================================================
// Depo — depodaki ve ardından paketlenmiş tüm envanterin görünümü.
// Read-only liste + barkod scan + filtre + detay.
// =============================================================================

// Sevkiyat domain'i sıfırlandı — READY_FOR_SHIP enum'u kaldırıldı. Depo'da
// şu an sadece WAREHOUSE statüsü anlamlı (Tambur sonrası + manuel renkli giriş).
// Sevkiyat modülü yeniden yazılınca buraya yeni durumlar eklenecek.
type StatusFilter = 'ALL' | 'WAREHOUSE';

const STATUS_TABS: { key: StatusFilter; label: string; color: string }[] = [
  { key: 'ALL', label: 'Tümü', color: '#475569' },
  { key: 'WAREHOUSE', label: 'Depoda', color: '#d97706' },
];

interface RollListItem {
  id: string;
  barcode: string;
  itemId: string;
  variantId: string | null;
  initialQty: number;
  currentQty: number;
  weightKg: number | null;
  width: number | null;
  qualityGrade: string;
  status: string;
  createdAt?: string;
  item?: { id: string; code: string; name: string };
  variant?: { id: string; code: string; name: string } | null;
}

export default function DepoScreen() {
  const device = useDeviceType();
  const isPhone = device === 'phone';
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const [scanInput, setScanInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [detailRoll, setDetailRoll] = useState<RollListItem | null>(null);
  const handleDetailDismiss = useCallback(() => setDetailRoll(null), []);

  const filterStatus =
    statusFilter === 'ALL' ? 'WAREHOUSE' : statusFilter;

  const rollsQuery = useQuery({
    queryKey: ['rolls', 'depo', statusFilter, search],
    queryFn: () =>
      rollService.getAll({
        page: 1,
        pageSize: 100,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        filters: { status: filterStatus },
        search: search.trim() || undefined,
      }),
    staleTime: 30 * 1000,
  });

  const rolls = (rollsQuery.data?.data ?? []) as RollListItem[];

  // İstatistik özet
  const stats = useMemo(() => {
    const sums = {
      count: rolls.length,
      totalQty: 0,
      totalWeight: 0,
      warehouse: 0,
      a1Quality: 0,
      fireQuality: 0,
    };
    for (const r of rolls) {
      // Backend Decimal alanları string döner — Number() ile coerce şart, aksi
      // halde `+=` string concat yapıp .toFixed çağrılarını bozar.
      sums.totalQty += Number(r.currentQty ?? 0);
      if (r.weightKg != null) sums.totalWeight += Number(r.weightKg);
      if (r.status === 'WAREHOUSE') sums.warehouse++;
      if (r.qualityGrade === 'A1') sums.a1Quality++;
      else if (r.qualityGrade === 'FIRE') sums.fireQuality++;
    }
    return sums;
  }, [rolls]);

  const handleScan = async () => {
    const barcode = scanInput.trim();
    if (!barcode) return;
    setScanning(true);
    try {
      const res = await rollService.getByBarcode(barcode);
      const r = res.data;
      if (!r) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Toast.show({ type: 'error', text1: 'Top bulunamadı', text2: barcode });
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setDetailRoll(r as RollListItem);
      setScanInput('');
    } catch (err) {
      Toast.show({
        type: 'error',
        text1: 'Sorgulanamadı',
        text2: (err as Error).message,
      });
    } finally {
      setScanning(false);
    }
  };

  return (
    <ScreenChrome
      title="Depo"
      subtitle="Tartılmış/paketlenmiş ve depodaki ham toplar"
    >
      <View style={styles.container}>
        {/* Üst — istatistik özet */}
        {isPhone ? (
          <Surface style={styles.statsCardPhone} elevation={1}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.statsScrollContent}
            >
              <StatBox label="Toplam Top" value={stats.count} color="#0f172a" />
              <View style={styles.statDivider} />
              <StatBox
                label="Metre"
                value={`${stats.totalQty.toFixed(0)} m`}
                color="#0f172a"
              />
              <View style={styles.statDivider} />
              <StatBox
                label="Brüt"
                value={`${stats.totalWeight.toFixed(0)} kg`}
                color="#0f172a"
              />
              <View style={styles.statDivider} />
              <StatBox label="Depoda" value={stats.warehouse} color="#d97706" />
              <View style={styles.statDivider} />
              <StatBox label="A1" value={stats.a1Quality} color="#7c3aed" />
              <View style={styles.statDivider} />
              <StatBox label="Fire" value={stats.fireQuality} color="#ef4444" />
            </ScrollView>
          </Surface>
        ) : (
          <Surface style={styles.statsCard} elevation={1}>
            <StatBox label="Toplam Top" value={stats.count} color="#0f172a" />
            <View style={styles.statDivider} />
            <StatBox
              label="Toplam Metre"
              value={`${stats.totalQty.toFixed(0)} m`}
              color="#0f172a"
            />
            <View style={styles.statDivider} />
            <StatBox
              label="Toplam Brüt"
              value={`${stats.totalWeight.toFixed(0)} kg`}
              color="#0f172a"
            />
            <View style={styles.statDivider} />
            <StatBox label="Depoda" value={stats.warehouse} color="#d97706" />
            <View style={styles.statDivider} />
            <StatBox label="A1" value={stats.a1Quality} color="#7c3aed" />
            <View style={styles.statDivider} />
            <StatBox label="Fire" value={stats.fireQuality} color="#ef4444" />
          </Surface>
        )}

        {/* Üst — barkod scan + arama */}
        <Surface style={styles.toolbar} elevation={1}>
          <View style={styles.toolbarRow}>
            <TextInput
              mode="outlined"
              value={scanInput}
              onChangeText={setScanInput}
              placeholder={isPhone ? 'Barkod' : 'Barkod okut → detay aç'}
              autoCapitalize="characters"
              autoCorrect={false}
              onSubmitEditing={handleScan}
              returnKeyType="search"
              style={[styles.input, styles.inputRow]}
              dense
              left={<TextInput.Icon icon="qrcode-scan" />}
            />
            <TextInput
              mode="outlined"
              value={search}
              onChangeText={setSearch}
              placeholder={isPhone ? 'Kumaş ara' : 'Kumaş adı/kodu ara...'}
              style={[styles.input, styles.inputRow]}
              dense
              left={<TextInput.Icon icon="magnify" />}
            />
            <RefreshButton
              onPress={() => rollsQuery.refetch()}
              refreshing={rollsQuery.isFetching}
              isError={rollsQuery.isError}
              errorMessage={(rollsQuery.error as Error | undefined)?.message}
            />
          </View>

          {/* Status filtre tab'ları */}
          <View style={styles.statusTabs}>
            {STATUS_TABS.map((t) => {
              const active = statusFilter === t.key;
              return (
                <TouchableRipple
                  key={t.key}
                  borderless
                  onPress={() => setStatusFilter(t.key)}
                  style={[
                    styles.statusChip,
                    active && {
                      backgroundColor: t.color,
                      borderColor: t.color,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusChipText,
                      active && { color: '#fff' },
                    ]}
                  >
                    {t.label}
                  </Text>
                </TouchableRipple>
              );
            })}
          </View>
        </Surface>

        {/* Liste */}
        <View style={{ flex: 1 }}>
          {rollsQuery.isLoading ? (
            <View style={styles.empty}>
              <ActivityIndicator size="large" color="#475569" />
            </View>
          ) : rolls.length === 0 ? (
            <View style={styles.empty}>
              <Icon source="package-variant-closed" size={56} color="#cbd5e1" />
              <Text style={styles.emptyText}>Depoda kayıt yok</Text>
              <Text style={styles.emptyHint}>
                {search ? `'${search}' için sonuç yok` : 'Filtreyi değiştirin'}
              </Text>
            </View>
          ) : (
            <FlashList
              data={rolls}
              keyExtractor={(r) => r.id}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <RollListRow roll={item} onPress={() => setDetailRoll(item)} />
              )}
            />
          )}
        </View>
      </View>

      {/* Detay modal — yalnızca seçili top varken mount: hook'lar/query'ler boşa çalışmasın */}
      {detailRoll && (
        <RollDetailModal roll={detailRoll} onDismiss={handleDetailDismiss} />
      )}
    </ScreenChrome>
  );
}

// =============================================================================
function StatBox({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function RollListRow({
  roll,
  onPress,
}: {
  roll: RollListItem;
  onPress: () => void;
}) {
  return (
    <Surface style={styles.rollCard} elevation={1}>
      <TouchableRipple borderless onPress={onPress} style={{ borderRadius: 10 }}>
        <View style={styles.rollInner}>
          <View style={{ flex: 1 }}>
            <View style={styles.rollHeader}>
              <Text style={styles.rollBarcode} numberOfLines={1}>
                {roll.barcode}
              </Text>
              <View
                style={[
                  styles.statusPill,
                  roll.status === 'WAREHOUSE' && styles.statusPillWarehouse,
                ]}
              >
                <Text style={styles.statusPillText}>
                  {trLabel(ROLL_STATUS_LABEL, roll.status)}
                </Text>
              </View>
              {roll.qualityGrade === 'A1' && (
                <View style={[styles.statusPill, styles.statusPillA1]}>
                  <Text style={styles.statusPillText}>A1</Text>
                </View>
              )}
              {roll.qualityGrade === 'FIRE' && (
                <View style={[styles.statusPill, styles.statusPillFire]}>
                  <Text style={styles.statusPillText}>Fire</Text>
                </View>
              )}
            </View>
            <Text style={styles.rollItem} numberOfLines={1}>
              {roll.item?.name ?? '—'}
              {roll.variant?.name ? ` · ${roll.variant.name}` : ''}
            </Text>
            <View style={styles.rollMeta}>
              <Text style={styles.rollMetaText}>
                {Number(roll.currentQty ?? 0).toFixed(1)} m
              </Text>
              {roll.weightKg != null && (
                <>
                  <Text style={styles.rollMetaSep}>·</Text>
                  <Text style={styles.rollMetaText}>
                    {Number(roll.weightKg).toFixed(2)} kg
                  </Text>
                </>
              )}
              {roll.width != null && (
                <>
                  <Text style={styles.rollMetaSep}>·</Text>
                  <Text style={styles.rollMetaText}>{roll.width} cm</Text>
                </>
              )}
              <Text style={styles.rollMetaSep}>·</Text>
              <Text style={styles.rollMetaText}>{roll.qualityGrade}</Text>
            </View>
          </View>
          <Icon source="chevron-right" size={22} color="#94a3b8" />
        </View>
      </TouchableRipple>
    </Surface>
  );
}

function RollDetailModal({
  roll,
  onDismiss,
}: {
  roll: RollListItem | null;
  onDismiss: () => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();

  const historyQuery = useQuery({
    queryKey: ['roll-history', roll?.id],
    queryFn: () => (roll ? rollService.getHistory(roll.id) : Promise.resolve(null)),
    enabled: !!roll,
    staleTime: 30 * 1000,
  });

  if (!roll) return null;

  const events = (historyQuery.data?.data?.events ?? []) as Array<{
    kind: string;
    title: string;
    at: string;
    stationName: string | null;
    operatorName: string | null;
    details?: Record<string, unknown>;
  }>;

  return (
    <RNModal
      isVisible={!!roll}
      onBackdropPress={onDismiss}
      onBackButtonPress={onDismiss}
      backdropOpacity={0.55}
      style={modalStyles.modal}
      useNativeDriver
      hideModalContentWhileAnimating
      deviceWidth={winW}
      deviceHeight={winH}
      statusBarTranslucent
    >
      <View style={[modalStyles.sheet, { width: winW * 0.65, maxHeight: winH * 0.85 }]}>
        <View style={modalStyles.header}>
          <Icon source="package-variant" size={22} color="#0f172a" />
          <View style={{ flex: 1 }}>
            <Text variant="titleMedium" style={modalStyles.title}>
              {roll.barcode}
            </Text>
            <Text style={modalStyles.subtitle}>
              {roll.item?.name ?? '—'}
              {roll.variant?.name ? ` · ${roll.variant.name}` : ''}
            </Text>
          </View>
          <IconButton icon="close" size={22} onPress={onDismiss} style={{ margin: 0 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 14, gap: 10 }}>
          {/* Üst özet */}
          <Surface style={modalStyles.summary} elevation={0}>
            <View style={modalStyles.summaryRow}>
              <Icon source="ruler" size={14} color="#475569" />
              <Text style={modalStyles.summaryLabel}>Mevcut Metraj:</Text>
              <Text style={modalStyles.summaryValue}>
                {Number(roll.currentQty ?? 0).toFixed(1)} m
              </Text>
            </View>
            {roll.weightKg != null && (
              <View style={modalStyles.summaryRow}>
                <Icon source="scale-balance" size={14} color="#475569" />
                <Text style={modalStyles.summaryLabel}>Ağırlık:</Text>
                <Text style={modalStyles.summaryValue}>
                  {Number(roll.weightKg).toFixed(2)} kg
                </Text>
              </View>
            )}
            {roll.width != null && (
              <View style={modalStyles.summaryRow}>
                <Icon source="arrow-expand-horizontal" size={14} color="#475569" />
                <Text style={modalStyles.summaryLabel}>En:</Text>
                <Text style={modalStyles.summaryValue}>{roll.width} cm</Text>
              </View>
            )}
            <View style={modalStyles.summaryRow}>
              <Icon source="star-circle" size={14} color="#475569" />
              <Text style={modalStyles.summaryLabel}>Kalite:</Text>
              <Text style={modalStyles.summaryValue}>{roll.qualityGrade}</Text>
            </View>
            <View style={modalStyles.summaryRow}>
              <Icon source="circle" size={14} color="#475569" />
              <Text style={modalStyles.summaryLabel}>Durum:</Text>
              <Text style={modalStyles.summaryValue}>
                {trLabel(ROLL_STATUS_LABEL, roll.status)}
              </Text>
            </View>
          </Surface>

          {/* Geçmiş */}
          <Text style={modalStyles.sectionTitle}>
            Yaşam Döngüsü ({events.length})
          </Text>
          {historyQuery.isLoading ? (
            <ActivityIndicator size="small" color="#475569" />
          ) : events.length === 0 ? (
            <Text style={modalStyles.muted}>Kayıt yok</Text>
          ) : (
            events.map((e, idx) => (
              <Surface key={`${e.at}-${idx}`} style={modalStyles.eventCard} elevation={0}>
                <View style={modalStyles.eventHeader}>
                  <Text style={modalStyles.eventTitle} numberOfLines={1}>
                    {e.title}
                  </Text>
                  <Text style={modalStyles.eventTime}>
                    {dayjs(e.at).format('DD.MM HH:mm')}
                  </Text>
                </View>
                {(e.stationName || e.operatorName) && (
                  <Text style={modalStyles.eventMeta}>
                    {e.stationName ? `🏭 ${e.stationName}` : ''}
                    {e.stationName && e.operatorName ? ' · ' : ''}
                    {e.operatorName ? `👤 ${e.operatorName}` : ''}
                  </Text>
                )}
              </Surface>
            ))
          )}
        </ScrollView>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 12, gap: 10 },

  statsCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
  },
  statsCardPhone: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 8,
  },
  statsScrollContent: { alignItems: 'center', paddingHorizontal: 10, gap: 0 },
  statBox: { flex: 1, alignItems: 'center', minWidth: 80, paddingHorizontal: 6 },
  statValue: { fontSize: 18, fontWeight: '700' },
  statLabel: { fontSize: 10, color: '#64748b', marginTop: 2 },
  statDivider: { width: 1, height: 32, backgroundColor: '#e2e8f0' },

  toolbar: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  toolbarRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { backgroundColor: '#fff' },
  inputRow: { flex: 1 },

  statusTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  statusChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
  },
  statusChipText: { fontSize: 13, fontWeight: '700', color: '#475569' },

  listContent: { padding: 4 },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 8,
  },
  emptyText: { fontSize: 16, color: '#94a3b8', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#cbd5e1', textAlign: 'center' },

  rollCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    marginVertical: 3,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  rollInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 8,
  },
  rollHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rollBarcode: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
  },
  statusPillWarehouse: { backgroundColor: '#fed7aa' },
  statusPillReady: { backgroundColor: '#bbf7d0' },
  statusPillA1: { backgroundColor: '#ddd6fe' },
  statusPillFire: { backgroundColor: '#fecaca' },
  statusPillText: { fontSize: 10, fontWeight: '700', color: '#0f172a' },
  rollItem: { fontSize: 12, color: '#475569', marginTop: 4 },
  rollMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  rollMetaText: { fontSize: 11, color: '#0f172a', fontWeight: '600' },
  rollMetaSep: { fontSize: 11, color: '#cbd5e1' },
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
    backgroundColor: '#f8fafc',
  },
  title: { fontWeight: '700', color: '#0f172a', fontFamily: 'monospace' },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },

  summary: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryLabel: { fontSize: 11, color: '#64748b', fontWeight: '600', minWidth: 110 },
  summaryValue: { fontSize: 13, color: '#0f172a', fontWeight: '700', flex: 1 },

  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a', marginTop: 8 },
  muted: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic' },

  eventCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 4,
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eventTitle: { flex: 1, fontSize: 13, fontWeight: '700', color: '#0f172a' },
  eventTime: { fontSize: 11, color: '#94a3b8' },
  eventMeta: { fontSize: 11, color: '#64748b' },
});
