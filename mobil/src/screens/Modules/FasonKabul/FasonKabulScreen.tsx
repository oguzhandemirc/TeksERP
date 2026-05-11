import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import RNModal from 'react-native-modal';
import {
  Text,
  TextInput,
  Button,
  IconButton,
  Surface,
  ActivityIndicator,
  Checkbox,
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
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import { ReceiptRow, ReceiptDetailModal } from '../../../components/receipt';
import { subcontractorService } from '../../../services/subcontractor.service';
import { travelerCardService } from '../../../services/travelerCard.service';
import type {
  PendingReturnGroup,
  ReceiveRequest,
  TravelerCardLookup,
} from '../../../types/models';

const RECEIPTS_PAGE_SIZE = 12;
const SUBMIT_ARM_TIMEOUT_MS = 3000;

interface RollRow {
  rollId: string;
  barcode: string;
  itemName: string;
  variantName?: string | null;
  dispatchedQty: number;
  width: number | null;
  qualityGrade: string;
  checked: boolean;
  notes: string;
  noteOpen: boolean;
}

type RightTab = 'pending' | 'history';

export default function FasonKabulScreen() {
  const qc = useQueryClient();

  // ── Form state ──
  const [selectedGroup, setSelectedGroup] = useState<PendingReturnGroup | null>(null);
  const [rows, setRows] = useState<RollRow[]>([]);
  const [manifestNo, setManifestNo] = useState('');
  const [notes, setNotes] = useState('');

  // ── Right column ──
  const [rightTab, setRightTab] = useState<RightTab>('pending');
  const [cardBarcode, setCardBarcode] = useState('');
  const [resolvingCard, setResolvingCard] = useState(false);
  const [highlightedWorkOrderId, setHighlightedWorkOrderId] = useState<string | null>(null);
  const [receiptsPage, setReceiptsPage] = useState(1);
  const [detailReceiptId, setDetailReceiptId] = useState<string | null>(null);
  const [listModalOpen, setListModalOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  // ── Submit two-stage ──
  const [submitArmed, setSubmitArmed] = useState(false);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!submitArmed) return;
    armTimerRef.current = setTimeout(() => setSubmitArmed(false), SUBMIT_ARM_TIMEOUT_MS);
    return () => {
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
    };
  }, [submitArmed]);

  // ── Queries ──
  // staleTime 30sn: ekran focus / tab geçişi tetikli otomatik refetch'leri susturur,
  // operatörün refresh butonu tek doğru kanal. Sahada gerçek değişim sıklığı zaten
  // sevk-kabul ölçeğinde (dakikalar), 30sn'lik cache yeter.
  const pendingQuery = useQuery({
    queryKey: ['pending-returns', 'all'],
    queryFn: () => subcontractorService.pendingReturns(),
    staleTime: 30 * 1000,
  });

  const receiptsQuery = useQuery({
    queryKey: ['receipts', 'recent', receiptsPage],
    queryFn: () =>
      subcontractorService.listReceipts({
        page: receiptsPage,
        pageSize: RECEIPTS_PAGE_SIZE,
      }),
    placeholderData: (prev) => prev,
    enabled: rightTab === 'history',
    staleTime: 30 * 1000,
  });

  // ── Mutations ──
  const receiveMutation = useMutation({
    mutationFn: (data: ReceiveRequest) => subcontractorService.receive(data),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Mal kabul tamamlandı',
        text2: res.data?.receiptNo,
      });
      resetForm();
      qc.invalidateQueries({ queryKey: ['pending-returns'] });
      qc.invalidateQueries({ queryKey: ['receipts'] });
      qc.invalidateQueries({ queryKey: ['rolls'] });
      qc.invalidateQueries({ queryKey: ['work-orders'] });
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Kabul başarısız', text2: err.message });
      setSubmitArmed(false);
    },
  });

  // ── Handlers ──
  const resetForm = () => {
    setSelectedGroup(null);
    setRows([]);
    setManifestNo('');
    setNotes('');
    setSubmitArmed(false);
    setHighlightedWorkOrderId(null);
  };

  const selectGroup = (g: PendingReturnGroup) => {
    setSelectedGroup(g);
    setRows(
      g.rolls.map((r) => ({
        rollId: r.id,
        barcode: r.barcode,
        itemName: r.item?.name ?? '—',
        variantName: r.variant?.name ?? null,
        dispatchedQty: r.currentQty,
        width: r.width ?? null,
        qualityGrade: r.qualityGrade,
        checked: true,
        notes: '',
        noteOpen: false,
      }))
    );
    setSubmitArmed(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleResolveCard = async (overrideBarcode?: string) => {
    const barcode = (overrideBarcode ?? cardBarcode).trim();
    if (!barcode) return;
    setResolvingCard(true);
    try {
      const res = await travelerCardService.findByBarcode(barcode);
      const card = res.data as TravelerCardLookup | null;
      if (!card) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Toast.show({ type: 'error', text1: 'Refakat kartı bulunamadı', text2: barcode });
        return;
      }
      if (card.status !== 'ACTIVE') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Toast.show({
          type: 'error',
          text1: `Kart geçersiz: ${card.status}`,
          text2: card.cardNumber,
        });
        return;
      }

      const allGroups = pendingQuery.data?.data ?? [];
      const matching = allGroups.filter((g) => g.workOrder.id === card.workOrderId);

      if (matching.length === 0) {
        Toast.show({
          type: 'info',
          text1: 'Bekleyen sevk yok',
          text2: 'Bu iş emrinde fasonda dönecek top kalmamış.',
        });
        return;
      }

      setCardBarcode('');
      setHighlightedWorkOrderId(card.workOrderId);
      setRightTab('pending');

      if (matching.length === 1) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Toast.show({
          type: 'success',
          text1: 'Sevk bulundu',
          text2: `${matching[0].workOrder.batchNumber} · ${matching[0].step.station.name}`,
        });
        selectGroup(matching[0]);
      } else {
        Toast.show({
          type: 'info',
          text1: `${matching.length} fason adımı bulundu`,
          text2: 'Hangi adımı kabul edeceğinizi seçin',
        });
      }
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({
        type: 'error',
        text1: 'Kart sorgulanamadı',
        text2: (err as Error).message,
      });
    } finally {
      setResolvingCard(false);
    }
  };

  const updateRow = (rollId: string, patch: Partial<RollRow>) => {
    setRows((prev) => prev.map((r) => (r.rollId === rollId ? { ...r, ...patch } : r)));
    setSubmitArmed(false); // herhangi bir değişiklik silahlamayı sıfırlar
  };
  const toggleAllRows = () => {
    const someUnchecked = rows.some((r) => !r.checked);
    setRows((prev) => prev.map((r) => ({ ...r, checked: someUnchecked })));
    setSubmitArmed(false);
  };

  const checkedCount = rows.filter((r) => r.checked).length;
  const missingCount = rows.length - checkedCount;
  const canSubmit = !!selectedGroup && checkedCount > 0 && !receiveMutation.isPending;
  const hasMissing = missingCount > 0;

  const buildPayload = (): ReceiveRequest | null => {
    if (!selectedGroup) return null;
    const subId = selectedGroup.lastDispatch?.subcontractorId;
    if (!subId) {
      Toast.show({
        type: 'error',
        text1: 'Fason firma bulunamadı',
        text2: 'Bu adımın aktif sevki yok.',
      });
      return null;
    }
    return {
      workOrderId: selectedGroup.workOrder.id,
      stepId: selectedGroup.step.id,
      subcontractorId: subId,
      manifestNo: manifestNo.trim() || null,
      notes: notes.trim() || undefined,
      returns: rows
        .filter((r) => r.checked)
        .map((r) => ({ rollId: r.rollId, notes: r.notes.trim() || null })),
    };
  };

  const handleSubmitClick = () => {
    if (!canSubmit) {
      Toast.show({ type: 'error', text1: 'Eksik alan', text2: 'Hiçbir top işaretlenmedi' });
      return;
    }
    if (hasMissing && !submitArmed) {
      // Two-stage: ilk tıklama silahlar, ikinci tıklama gönderir
      setSubmitArmed(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return;
    }
    const payload = buildPayload();
    if (!payload) return;
    receiveMutation.mutate(payload);
  };

  const allGroups = pendingQuery.data?.data ?? [];

  // Sıralama: highlight'lı en üstte, sonra dispatch tarihine göre yeni-üstte
  const sortedGroups = useMemo(() => {
    const list = [...allGroups];
    list.sort((a, b) => {
      const aHi = highlightedWorkOrderId && a.workOrder.id === highlightedWorkOrderId ? 1 : 0;
      const bHi = highlightedWorkOrderId && b.workOrder.id === highlightedWorkOrderId ? 1 : 0;
      if (aHi !== bHi) return bHi - aHi;
      const aT = a.lastDispatch?.dispatchedAt ?? '';
      const bT = b.lastDispatch?.dispatchedAt ?? '';
      return bT.localeCompare(aT);
    });
    return list;
  }, [allGroups, highlightedWorkOrderId]);

  // ── Render ──
  return (
    <ScreenChrome
      title="Fason Mal Kabul"
      subtitle="Refakat kartı okut, dönen topları onayla"
    >
      <View style={styles.body}>
        {/* ════════ SOL: form ════════ */}
        <View style={styles.formCol}>
          {!selectedGroup ? (
            <View style={styles.emptyState}>
              <Icon source="package-down" size={64} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>Sevk seçilmedi</Text>
              <Text style={styles.emptyHint}>
                Sağdan bekleyen bir sevke tıklayın veya refakat kartını okutun
              </Text>
            </View>
          ) : (
            <>
              {/* Sticky header band */}
              <Surface style={styles.headerBand} elevation={2}>
                <View style={styles.headerCellMain}>
                  <Text style={styles.headerBatch} numberOfLines={1}>
                    {selectedGroup.workOrder.batchNumber}
                  </Text>
                  <Text style={styles.headerSub} numberOfLines={1}>
                    Adım {selectedGroup.step.stepSequence} ·{' '}
                    {selectedGroup.step.station.name}
                  </Text>
                </View>
                <View style={styles.headerDivider} />
                <View style={styles.headerCell}>
                  <Icon source="factory" size={14} color="#475569" />
                  <Text style={styles.headerCompany} numberOfLines={1}>
                    {selectedGroup.lastDispatch?.subcontractor?.name ?? '—'}
                  </Text>
                </View>
                <IconButton
                  icon="close"
                  size={20}
                  onPress={resetForm}
                  accessibilityLabel="Sıfırla"
                  style={{ margin: 0 }}
                />
              </Surface>

              {/* Mini bilgi şeridi */}
              <View style={styles.warning}>
                <Icon source="information-outline" size={14} color="#92400e" />
                <Text style={styles.warningText}>
                  Yeni barkod basılmaz, ölçüm sonraki istasyonda yapılır
                </Text>
              </View>

              {/* Toplar — ScrollView'in büyük kısmı */}
              <ScrollView
                style={styles.rollsScroll}
                contentContainerStyle={styles.rollsContent}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.rollsHeaderRow}>
                  <View style={styles.statusBadge}>
                    <Text style={styles.statusBadgeText}>
                      {checkedCount}/{rows.length} onaylı
                    </Text>
                    {missingCount > 0 && (
                      <View style={styles.missingPill}>
                        <Text style={styles.missingPillText}>
                          {missingCount} eksik
                        </Text>
                      </View>
                    )}
                  </View>
                  <Button
                    mode="text"
                    compact
                    onPress={toggleAllRows}
                    icon={
                      rows.every((r) => r.checked)
                        ? 'checkbox-blank-outline'
                        : 'checkbox-marked-outline'
                    }
                  >
                    {rows.every((r) => r.checked) ? 'Hepsini Kaldır' : 'Hepsini İşaretle'}
                  </Button>
                </View>

                {rows.map((row, idx) => (
                  <Surface
                    key={row.rollId}
                    style={[styles.rollItem, !row.checked && styles.rollItemMissing]}
                    elevation={0}
                  >
                    <TouchableRipple
                      borderless
                      onPress={() => updateRow(row.rollId, { checked: !row.checked })}
                      style={styles.rollTouch}
                    >
                      <View style={styles.rollRow}>
                        <Checkbox
                          status={row.checked ? 'checked' : 'unchecked'}
                          onPress={() =>
                            updateRow(row.rollId, { checked: !row.checked })
                          }
                        />
                        <View style={styles.rollIndex}>
                          <Text
                            style={[
                              styles.rollIndexText,
                              !row.checked && { color: '#dc2626' },
                            ]}
                          >
                            {idx + 1}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={styles.rollTopLine}>
                            <Text style={styles.rollBarcode} numberOfLines={1}>
                              {row.barcode}
                            </Text>
                            {!row.checked && (
                              <View style={styles.missingTag}>
                                <Text style={styles.missingTagText}>EKSİK</Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.rollItemName} numberOfLines={1}>
                            {row.itemName}
                            {row.variantName ? ` · ${row.variantName}` : ''}
                          </Text>
                          <View style={styles.rollBadges}>
                            <Badge icon="arrow-expand-vertical">
                              {`${row.dispatchedQty.toFixed(1)} mt`}
                            </Badge>
                            {row.width != null && (
                              <Badge icon="arrow-expand-horizontal">
                                {`${row.width} cm`}
                              </Badge>
                            )}
                            <Badge icon="star-circle">{row.qualityGrade}</Badge>
                            {row.notes && (
                              <Badge icon="note-text">{`Not: ${row.notes.slice(0, 24)}${row.notes.length > 24 ? '…' : ''}`}</Badge>
                            )}
                          </View>
                        </View>
                        <IconButton
                          icon={row.noteOpen ? 'chevron-up' : 'note-plus-outline'}
                          size={22}
                          iconColor={row.notes ? '#0369a1' : '#64748b'}
                          onPress={() =>
                            updateRow(row.rollId, { noteOpen: !row.noteOpen })
                          }
                          accessibilityLabel="Topa not ekle"
                          style={{ margin: 0 }}
                        />
                      </View>
                    </TouchableRipple>
                    {row.noteOpen && (
                      <View style={styles.noteWrap}>
                        <TextInput
                          mode="outlined"
                          value={row.notes}
                          onChangeText={(v) => updateRow(row.rollId, { notes: v })}
                          placeholder="Bu topa dair not (hasarlı, kirli vb.)..."
                          dense
                          style={styles.input}
                        />
                      </View>
                    )}
                  </Surface>
                ))}
              </ScrollView>

              {/* Sticky footer */}
              <Surface style={styles.footer} elevation={4}>
                <View style={styles.footerInputs}>
                  <TextInput
                    mode="outlined"
                    label="İrsaliye No"
                    value={manifestNo}
                    onChangeText={setManifestNo}
                    placeholder="Opsiyonel"
                    dense
                    autoCapitalize="characters"
                    style={[styles.footerInput, { flex: 1 }]}
                  />
                  <TextInput
                    mode="outlined"
                    label="Kabul Notu"
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Opsiyonel"
                    dense
                    style={[styles.footerInput, { flex: 1.2 }]}
                  />
                </View>
                <Button
                  mode="contained"
                  icon={
                    submitArmed
                      ? 'alert-decagram'
                      : hasMissing
                        ? 'alert-circle-outline'
                        : 'package-check'
                  }
                  onPress={handleSubmitClick}
                  disabled={!canSubmit}
                  loading={receiveMutation.isPending}
                  style={styles.submitBtn}
                  contentStyle={styles.submitBtnContent}
                  labelStyle={styles.submitBtnLabel}
                  buttonColor={
                    submitArmed ? '#dc2626' : hasMissing ? '#d97706' : '#059669'
                  }
                >
                  {submitArmed
                    ? `Eksik kabulü ONAYLA — tekrar bas (${checkedCount}/${rows.length})`
                    : hasMissing
                      ? `${checkedCount} top kabul · ${missingCount} EKSİK`
                      : `${checkedCount} Top Kabul Et`}
                </Button>
              </Surface>
            </>
          )}
        </View>

        {/* ════════ SAĞ: bekleyen + geçmiş ════════ */}
        <View style={styles.rightCol}>
          {/* Kart input + kamera — sticky top, her tab'da görünür */}
          <View style={styles.cardInputWrap}>
            <View style={styles.cardInputRow}>
              <TextInput
                mode="outlined"
                value={cardBarcode}
                onChangeText={setCardBarcode}
                placeholder="Refakat kartı barkodu okut/yaz..."
                dense
                autoCapitalize="characters"
                autoCorrect={false}
                left={<TextInput.Icon icon="card-search-outline" />}
                right={
                  resolvingCard ? (
                    <TextInput.Icon icon={() => <ActivityIndicator size={18} color="#059669" />} />
                  ) : cardBarcode.trim() ? (
                    <TextInput.Icon icon="check" onPress={() => handleResolveCard()} color="#059669" />
                  ) : undefined
                }
                onSubmitEditing={() => handleResolveCard()}
                returnKeyType="search"
                style={[styles.cardInput, { flex: 1 }]}
              />
              <IconButton
                icon="format-list-bulleted"
                mode="contained-tonal"
                containerColor="#e2e8f0"
                iconColor="#0f172a"
                size={26}
                onPress={() => setListModalOpen(true)}
                accessibilityLabel="Bekleyen sevkleri listele"
                style={styles.cameraBtn}
              />
              <IconButton
                icon="camera"
                mode="contained-tonal"
                containerColor="#dbeafe"
                iconColor="#1e40af"
                size={26}
                onPress={() => setScannerOpen(true)}
                accessibilityLabel="Kamera ile refakat kartı tara"
                style={styles.cameraBtn}
              />
            </View>
          </View>

          {/* Tab bar + aktif tab'ı yenileyen buton */}
          <View style={styles.tabBar}>
            <Tab
              label="Bekleyen"
              count={allGroups.length}
              active={rightTab === 'pending'}
              onPress={() => setRightTab('pending')}
              activeColor="#d97706"
            />
            <Tab
              label="Geçmiş Kabuller"
              active={rightTab === 'history'}
              onPress={() => setRightTab('history')}
              activeColor="#059669"
            />
            <View style={styles.tabRefreshWrap}>
              <RefreshButton
                onPress={() => {
                  if (rightTab === 'pending') pendingQuery.refetch();
                  else receiptsQuery.refetch();
                }}
                refreshing={
                  rightTab === 'pending'
                    ? pendingQuery.isFetching
                    : receiptsQuery.isFetching
                }
                isError={
                  rightTab === 'pending'
                    ? pendingQuery.isError
                    : receiptsQuery.isError
                }
                errorMessage={
                  rightTab === 'pending'
                    ? (pendingQuery.error as Error | undefined)?.message
                    : (receiptsQuery.error as Error | undefined)?.message
                }
              />
            </View>
          </View>

          {/* Tab içeriği */}
          {rightTab === 'pending' ? (
            <PendingPane
              loading={pendingQuery.isLoading}
              groups={sortedGroups}
              selectedStepId={selectedGroup?.step.id ?? null}
              highlightedWorkOrderId={highlightedWorkOrderId}
              onSelect={selectGroup}
            />
          ) : (
            <HistoryPane
              loading={receiptsQuery.isLoading}
              fetching={receiptsQuery.isFetching}
              error={receiptsQuery.isError ? (receiptsQuery.error as Error) : null}
              receipts={receiptsQuery.data?.data ?? []}
              page={receiptsQuery.data?.pagination?.page ?? 1}
              totalPages={receiptsQuery.data?.pagination?.totalPages ?? 1}
              total={receiptsQuery.data?.pagination?.total ?? 0}
              onShowDetail={setDetailReceiptId}
              onPageChange={setReceiptsPage}
              onRefresh={() => receiptsQuery.refetch()}
            />
          )}
        </View>
      </View>

      {/* Geçmiş kabul detayı */}
      <ReceiptDetailModal
        receiptId={detailReceiptId}
        onDismiss={() => setDetailReceiptId(null)}
      />

      {/* Bekleyen sevk listesi — hızlı seçim için */}
      <CameraScanModal
        visible={listModalOpen}
        loading={pendingQuery.isLoading}
        groups={allGroups}
        onDismiss={() => setListModalOpen(false)}
        onSelect={(g) => {
          setListModalOpen(false);
          selectGroup(g);
        }}
      />

      {/* Refakat kartı QR/barkod okuma — gerçek kamera */}
      <BarcodeScannerModal
        visible={scannerOpen}
        title="Refakat Kartı QR Okut"
        onDismiss={() => setScannerOpen(false)}
        onScan={(data) => {
          setScannerOpen(false);
          handleResolveCard(data);
        }}
      />
    </ScreenChrome>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Yardımcı bileşenler
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Bekleyen sevk listesi modal'ı.
// Operatör liste ikonuna basınca açılır; fasondan dönecek sevkleri listeler,
// tıklayanı seçer (kart barkodu okutmadan hızlı seçim için).
// ─────────────────────────────────────────────────────────────────────────────
function CameraScanModal({
  visible,
  loading,
  groups,
  onDismiss,
  onSelect,
}: {
  visible: boolean;
  loading: boolean;
  groups: PendingReturnGroup[];
  onDismiss: () => void;
  onSelect: (g: PendingReturnGroup) => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  return (
    <RNModal
      isVisible={visible}
      onBackdropPress={onDismiss}
      onBackButtonPress={onDismiss}
      backdropOpacity={0.55}
      style={cameraStyles.modal}
      useNativeDriver
      hideModalContentWhileAnimating
      deviceWidth={winW}
      deviceHeight={winH}
      statusBarTranslucent
    >
      <View style={[cameraStyles.sheet, { width: winW * 0.7, height: winH * 0.8 }]}>
        <View style={cameraStyles.header}>
          <Icon source="format-list-bulleted" size={22} color="#0f172a" />
          <Text variant="titleMedium" style={cameraStyles.title}>
            Bekleyen Sevkler
          </Text>
          <View style={{ flex: 1 }} />
          <IconButton icon="close" size={22} onPress={onDismiss} style={{ margin: 0 }} />
        </View>

        <View style={cameraStyles.hint}>
          <Icon source="information-outline" size={14} color="#475569" />
          <Text style={cameraStyles.hintText}>
            Refakat kartı yoksa aşağıdan dönecek sevki seçerek devam edin.
          </Text>
        </View>

        <View style={cameraStyles.listBox}>
          {loading ? (
            <View style={cameraStyles.empty}>
              <ActivityIndicator size="large" color="#1e40af" />
            </View>
          ) : groups.length === 0 ? (
            <View style={cameraStyles.empty}>
              <Icon source="package-variant" size={48} color="#cbd5e1" />
              <Text style={cameraStyles.emptyText}>Fasonda bekleyen sevk yok</Text>
            </View>
          ) : (
            <FlashList
              data={groups}
              keyExtractor={(g) => g.step.id}
              contentContainerStyle={{ padding: 10 }}
              renderItem={({ item }) => (
                <Surface style={cameraStyles.row} elevation={1}>
                  <TouchableRipple
                    borderless
                    onPress={() => onSelect(item)}
                    style={cameraStyles.rowTouch}
                  >
                    <View style={cameraStyles.rowInner}>
                      <View style={{ flex: 1 }}>
                        <Text style={cameraStyles.rowBatch}>
                          {item.workOrder.batchNumber}
                        </Text>
                        <View style={cameraStyles.rowMeta}>
                          <Icon source="map-marker-path" size={12} color="#475569" />
                          <Text style={cameraStyles.rowMetaText} numberOfLines={1}>
                            #{item.step.stepSequence} · {item.step.station.name}
                          </Text>
                        </View>
                        <View style={cameraStyles.rowMeta}>
                          <Icon source="factory" size={12} color="#475569" />
                          <Text style={cameraStyles.rowMetaText} numberOfLines={1}>
                            {item.lastDispatch?.subcontractor?.name ?? '—'}
                          </Text>
                        </View>
                        <View style={cameraStyles.rowFooter}>
                          <Text style={cameraStyles.rowQty}>
                            {item.rollCount} top · {item.totalQty.toFixed(1)} mt
                          </Text>
                          {item.lastDispatch && (
                            <Text style={cameraStyles.rowDate}>
                              {dayjs(item.lastDispatch.dispatchedAt).format('DD.MM HH:mm')}
                            </Text>
                          )}
                        </View>
                      </View>
                      <Icon source="chevron-right" size={22} color="#94a3b8" />
                    </View>
                  </TouchableRipple>
                </Surface>
              )}
            />
          )}
        </View>
      </View>
    </RNModal>
  );
}

function Tab({
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
        styles.tab,
        active && { borderBottomColor: activeColor, borderBottomWidth: 3 },
      ]}
    >
      <View style={styles.tabInner}>
        <Text style={[styles.tabLabel, active && { color: activeColor }]}>{label}</Text>
        {typeof count === 'number' && count > 0 && (
          <View style={[styles.tabCount, active && { backgroundColor: activeColor }]}>
            <Text style={[styles.tabCountText, active && { color: '#fff' }]}>
              {count}
            </Text>
          </View>
        )}
      </View>
    </TouchableRipple>
  );
}

function Badge({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <View style={styles.badge}>
      <Icon source={icon} size={12} color="#0f172a" />
      <Text style={styles.badgeText}>{children}</Text>
    </View>
  );
}

function PendingPane({
  loading,
  groups,
  selectedStepId,
  highlightedWorkOrderId,
  onSelect,
}: {
  loading: boolean;
  groups: PendingReturnGroup[];
  selectedStepId: string | null;
  highlightedWorkOrderId: string | null;
  onSelect: (g: PendingReturnGroup) => void;
}) {
  if (loading) {
    return (
      <View style={styles.paneEmpty}>
        <ActivityIndicator size="large" color="#d97706" />
      </View>
    );
  }
  if (groups.length === 0) {
    return (
      <View style={styles.paneEmpty}>
        <Icon source="package-variant" size={48} color="#cbd5e1" />
        <Text style={styles.paneEmptyText}>Fasonda bekleyen top yok</Text>
      </View>
    );
  }
  return (
    <FlashList
      data={groups}
      keyExtractor={(g) => g.step.id}
      contentContainerStyle={{ padding: 8 }}
      renderItem={({ item }) => (
        <PendingCard
          group={item}
          selected={item.step.id === selectedStepId}
          highlighted={
            !!highlightedWorkOrderId && item.workOrder.id === highlightedWorkOrderId
          }
          onPress={() => onSelect(item)}
        />
      )}
    />
  );
}

function PendingCard({
  group,
  selected,
  highlighted,
  onPress,
}: {
  group: PendingReturnGroup;
  selected: boolean;
  highlighted: boolean;
  onPress: () => void;
}) {
  return (
    <Surface
      style={[
        styles.pendingCard,
        highlighted && styles.pendingCardHighlight,
        selected && styles.pendingCardSelected,
      ]}
      elevation={selected ? 2 : 1}
    >
      <TouchableRipple borderless onPress={onPress} style={styles.pendingTouch}>
        <View style={styles.pendingInner}>
          <View style={styles.pendingTopRow}>
            <Text style={styles.pendingBatch} numberOfLines={1}>
              {group.workOrder.batchNumber}
            </Text>
            {highlighted && (
              <View style={styles.pendingFlag}>
                <Icon source="card-search" size={10} color="#fff" />
                <Text style={styles.pendingFlagText}>KART</Text>
              </View>
            )}
            {selected && (
              <View style={[styles.pendingFlag, { backgroundColor: '#059669' }]}>
                <Icon source="check" size={10} color="#fff" />
                <Text style={styles.pendingFlagText}>SEÇİLİ</Text>
              </View>
            )}
          </View>
          <View style={styles.pendingMidRow}>
            <Icon source="map-marker-path" size={12} color="#475569" />
            <Text style={styles.pendingStep} numberOfLines={1}>
              #{group.step.stepSequence} · {group.step.station.name}
            </Text>
          </View>
          <View style={styles.pendingMidRow}>
            <Icon source="factory" size={12} color="#475569" />
            <Text style={styles.pendingCompany} numberOfLines={1}>
              {group.lastDispatch?.subcontractor?.name ?? '—'}
            </Text>
          </View>
          <View style={styles.pendingFooter}>
            <Text style={styles.pendingQty}>
              {group.rollCount} top · {group.totalQty.toFixed(1)} mt
            </Text>
            {group.lastDispatch && (
              <Text style={styles.pendingDate}>
                {dayjs(group.lastDispatch.dispatchedAt).format('DD.MM HH:mm')}
              </Text>
            )}
          </View>
        </View>
      </TouchableRipple>
    </Surface>
  );
}

function HistoryPane({
  loading,
  fetching,
  error,
  receipts,
  page,
  totalPages,
  total,
  onShowDetail,
  onPageChange,
  onRefresh,
}: {
  loading: boolean;
  fetching: boolean;
  error: Error | null;
  receipts: import('../../../types/models').SubcontractorReceiptListItem[];
  page: number;
  totalPages: number;
  total: number;
  onShowDetail: (id: string) => void;
  onPageChange: (page: number) => void;
  onRefresh: () => void;
}) {
  if (loading) {
    return (
      <View style={styles.paneEmpty}>
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.paneEmpty}>
        <Text style={styles.paneEmptyText}>Liste yüklenemedi</Text>
        <Text style={styles.paneEmptyHint}>{error.message}</Text>
        <Button mode="outlined" onPress={onRefresh} style={{ marginTop: 8 }}>
          Tekrar dene
        </Button>
      </View>
    );
  }
  if (receipts.length === 0) {
    return (
      <View style={styles.paneEmpty}>
        <Icon source="package-check" size={48} color="#cbd5e1" />
        <Text style={styles.paneEmptyText}>Henüz mal kabul yok</Text>
      </View>
    );
  }
  return (
    <View style={styles.paneFlex}>
      <FlashList
        data={receipts}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 8 }}
        renderItem={({ item }) => (
          <ReceiptRow receipt={item} onShowDetail={onShowDetail} />
        )}
      />
      {totalPages > 1 && (
        <View style={styles.pager}>
          <IconButton
            icon="chevron-left"
            mode="outlined"
            size={18}
            disabled={page <= 1 || fetching}
            onPress={() => onPageChange(Math.max(1, page - 1))}
            style={styles.pagerBtn}
          />
          <Text style={styles.pagerText}>
            {page} / {totalPages} · {total} kayıt
          </Text>
          <IconButton
            icon="chevron-right"
            mode="outlined"
            size={18}
            disabled={page >= totalPages || fetching}
            onPress={() => onPageChange(Math.min(totalPages, page + 1))}
            style={styles.pagerBtn}
          />
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  body: { flex: 1, flexDirection: 'row', backgroundColor: '#f8fafc' },

  // Sol — form
  formCol: { flex: 1.4, backgroundColor: '#f8fafc' },

  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#475569' },
  emptyHint: { fontSize: 13, color: '#94a3b8', textAlign: 'center', maxWidth: 280 },

  // Sticky header
  headerBand: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#0f172a',
    gap: 8,
  },
  headerCellMain: { flex: 1.5, justifyContent: 'center' },
  headerBatch: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  headerSub: { fontSize: 11, color: '#cbd5e1', marginTop: 2 },
  headerDivider: { width: 1, height: 28, backgroundColor: '#334155' },
  headerCell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerCompany: { fontSize: 12, color: '#e2e8f0', fontWeight: '600' },

  // Mini bilgi şeridi
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#fef3c7',
    borderBottomWidth: 1,
    borderBottomColor: '#fbbf24',
  },
  warningText: { fontSize: 11, color: '#92400e', flex: 1 },

  // Toplar — scrollable
  rollsScroll: { flex: 1 },
  rollsContent: { padding: 12, gap: 4 },
  rollsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusBadgeText: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  missingPill: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  missingPillText: { fontSize: 11, fontWeight: '700', color: '#dc2626' },

  rollItem: {
    backgroundColor: '#fff',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  rollItemMissing: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  rollTouch: { borderRadius: 8 },
  rollRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingRight: 4,
    gap: 2,
  },
  rollIndex: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#dcfce7',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  rollIndexText: { fontSize: 11, fontWeight: '700', color: '#059669' },
  rollTopLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rollBarcode: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
  },
  missingTag: {
    backgroundColor: '#dc2626',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  missingTagText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  rollItemName: { fontSize: 12, color: '#475569', marginTop: 1 },
  rollBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: { fontSize: 10, color: '#0f172a', fontWeight: '600' },

  noteWrap: { paddingHorizontal: 10, paddingBottom: 8 },
  input: { backgroundColor: '#fff' },

  // Sticky footer
  footer: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    padding: 10,
    gap: 8,
  },
  footerInputs: { flexDirection: 'row', gap: 8 },
  footerInput: { backgroundColor: '#fff' },
  submitBtn: { borderRadius: 10 },
  submitBtnContent: { height: 56 },
  submitBtnLabel: { fontSize: 15, fontWeight: '700' },

  // Sağ
  rightCol: {
    flex: 1,
    backgroundColor: '#fff',
    borderLeftWidth: 1,
    borderLeftColor: '#e2e8f0',
  },
  cardInputWrap: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  cardInputRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardInput: { backgroundColor: '#fff' },
  cameraBtn: { margin: 0 },

  // Tabs
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tab: {
    flex: 1,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 6,
  },
  tabLabel: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  tabCount: {
    backgroundColor: '#cbd5e1',
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 999,
    minWidth: 22,
    alignItems: 'center',
  },
  tabCountText: { fontSize: 11, fontWeight: '700', color: '#0f172a' },
  tabRefreshWrap: {
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
    borderLeftWidth: 1,
    borderLeftColor: '#e2e8f0',
  },

  // Pane (tab içeriği)
  paneFlex: { flex: 1 },
  paneEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 6,
  },
  paneEmptyText: { fontSize: 14, color: '#94a3b8', fontWeight: '600' },
  paneEmptyHint: { fontSize: 12, color: '#cbd5e1', textAlign: 'center' },

  // Bekleyen kart
  pendingCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    marginVertical: 3,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  pendingCardHighlight: {
    borderColor: '#f59e0b',
    backgroundColor: '#fffbeb',
    borderWidth: 2,
  },
  pendingCardSelected: {
    borderColor: '#059669',
    backgroundColor: '#f0fdf4',
    borderWidth: 2,
  },
  pendingTouch: { borderRadius: 10 },
  pendingInner: { padding: 10, gap: 3 },
  pendingTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pendingBatch: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
  },
  pendingFlag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#f59e0b',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
  },
  pendingFlagText: { fontSize: 9, fontWeight: '700', color: '#fff' },
  pendingMidRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pendingStep: { fontSize: 11, color: '#475569', fontWeight: '600', flex: 1 },
  pendingCompany: { fontSize: 11, color: '#475569', flex: 1 },
  pendingFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  pendingQty: { fontSize: 12, fontWeight: '700', color: '#0f172a' },
  pendingDate: { fontSize: 10, color: '#94a3b8' },

  // Pager
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    gap: 8,
  },
  pagerBtn: { margin: 0, width: 32, height: 32 },
  pagerText: { fontSize: 11, color: '#64748b', fontWeight: '600' },
});

const cameraStyles = StyleSheet.create({
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
    backgroundColor: '#eff6ff',
  },
  title: { fontWeight: '700', color: '#0f172a' },

  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  hintText: { fontSize: 12, color: '#475569', flex: 1 },

  listBox: { flex: 1 },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 6,
  },
  emptyText: { fontSize: 14, color: '#94a3b8', fontWeight: '600' },

  row: {
    backgroundColor: '#fff',
    borderRadius: 10,
    marginVertical: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  rowTouch: { borderRadius: 10 },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 8,
  },
  rowBatch: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  rowMetaText: { fontSize: 12, color: '#475569', fontWeight: '500', flex: 1 },
  rowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  rowQty: { fontSize: 12, fontWeight: '700', color: '#0f172a' },
  rowDate: { fontSize: 11, color: '#94a3b8' },
});
