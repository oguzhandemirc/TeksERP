import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import Modal from 'react-native-modal';
import {
  Text,
  Surface,
  Button,
  IconButton,
  TouchableRipple,
  Chip,
  Divider,
  Icon,
  ActivityIndicator,
} from 'react-native-paper';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import { sackService, type SackDetail, type SackListItem } from '../../../../services/sack.service';
import { packagingService } from '../../../../services/packaging.service';
import {
  type ShippingQueueJob,
} from '../../../../services/shippingQueue.service';
import { useShippingSessionStore, type PoolRoll } from '../../../../store/shippingSession.store';
import PickerModal from '../../../../components/PickerModal';
import {
  NumpadHost,
  useNumpadContext,
} from '../../../../components/NumpadProvider';

interface Props {
  job: ShippingQueueJob;
  onOpenScanner: () => void;
}

type TabKey = 'pool' | string; // 'pool' or sackId

export default function SacksPanel({ job, onOpenScanner }: Props) {
  const qc = useQueryClient();
  const customerId = job.order.customer.id;
  const pool = useShippingSessionStore((s) => s.pool);
  const removeFromPool = useShippingSessionStore((s) => s.removeFromPool);
  const [activeTab, setActiveTab] = useState<TabKey>('pool');
  const [sackPickerForRoll, setSackPickerForRoll] = useState<PoolRoll | null>(
    null,
  );
  const [linePickerFor, setLinePickerFor] = useState<{
    roll: PoolRoll;
    sackId: string;
  } | null>(null);
  const [transferTarget, setTransferTarget] = useState<{
    rollId: string;
    fromSackId: string;
    orderLineId: string;
    barcode: string;
  } | null>(null);
  const [weighSackId, setWeighSackId] = useState<string | null>(null);
  const [weightInput, setWeightInput] = useState('');

  // Tartı modalı açıkken numpad'i bu modale bağla (input bileşeni gerek yok).
  const { openTarget, closeTarget } = useNumpadContext();
  const weightInputRef = React.useRef(weightInput);
  weightInputRef.current = weightInput;
  const setWeightRef = React.useRef(setWeightInput);
  setWeightRef.current = setWeightInput;

  React.useEffect(() => {
    if (!weighSackId) return;
    const id = `weigh-sack-${weighSackId}`;
    openTarget({
      id,
      label: 'Brüt kilo',
      allowDecimal: true,
      getValue: () => weightInputRef.current,
      onChange: (next) => setWeightRef.current(next),
    });
    return () => closeTarget(id);
  }, [weighSackId, openTarget, closeTarget]);

  const sacksQ = useQuery({
    queryKey: ['sacks', 'by-customer', customerId],
    queryFn: () => sackService.listByCustomer(customerId),
    refetchOnMount: 'always',
  });
  const sacks: SackListItem[] = (sacksQ.data?.data ?? []).filter(
    (s) => !s.shipmentId,
  );

  const activeSackId = activeTab !== 'pool' ? activeTab : null;
  const sackDetailQ = useQuery({
    queryKey: ['sacks', 'detail', activeSackId],
    queryFn: () => sackService.getById(activeSackId!),
    enabled: !!activeSackId,
  });
  const sackDetail: SackDetail | null = sackDetailQ.data?.data ?? null;

  useEffect(() => {
    if (activeTab !== 'pool' && !sacks.some((s) => s.id === activeTab)) {
      setActiveTab('pool');
    }
  }, [sacks, activeTab]);

  const createSackMut = useMutation({
    mutationFn: () => sackService.create({ customerId }),
    onSuccess: (res) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Yeni çuval açıldı',
        text2: res.data.sackNumber,
      });
      void qc.invalidateQueries({
        queryKey: ['sacks', 'by-customer', customerId],
      });
      setActiveTab(res.data.id);
    },
    onError: () => {
      Toast.show({ type: 'error', text1: 'Çuval açılamadı' });
    },
  });

  const assignRollMut = useMutation({
    mutationFn: (input: {
      rollId: string;
      sackId: string;
      orderLineId: string;
    }) =>
      sackService.assignRoll({
        rollId: input.rollId,
        sackId: input.sackId,
        orderLineId: input.orderLineId,
      }),
    onSuccess: (_res, vars) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Top çuvala eklendi' });
      removeFromPool(vars.rollId);
      setLinePickerFor(null);
      setSackPickerForRoll(null);
      void qc.invalidateQueries({ queryKey: ['sacks'] });
      void qc.invalidateQueries({
        queryKey: ['shipping-queue', 'requirements', job.id],
      });
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      Toast.show({
        type: 'error',
        text1: 'Çuvala eklenemedi',
        text2: err?.response?.data?.message ?? 'Tekrar dene.',
      });
    },
  });

  const removeRollMut = useMutation({
    mutationFn: (rollId: string) => sackService.removeRoll(rollId),
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Top çuvaldan çıkarıldı' });
      void qc.invalidateQueries({ queryKey: ['sacks'] });
      void qc.invalidateQueries({
        queryKey: ['shipping-queue', 'requirements', job.id],
      });
    },
  });

  const transferRollMut = useMutation({
    mutationFn: (input: {
      rollId: string;
      targetSackId: string;
      orderLineId: string;
    }) =>
      sackService.assignRoll({
        rollId: input.rollId,
        sackId: input.targetSackId,
        orderLineId: input.orderLineId,
      }),
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Top çuvallar arası taşındı' });
      setTransferTarget(null);
      void qc.invalidateQueries({ queryKey: ['sacks'] });
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      Toast.show({
        type: 'error',
        text1: 'Aktarım başarısız',
        text2: err?.response?.data?.message ?? 'Tekrar dene.',
      });
    },
  });

  const weighSackMut = useMutation({
    mutationFn: (input: { sackId: string; weightKg: number }) =>
      sackService.weigh(input),
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Tartı kaydedildi' });
      setWeighSackId(null);
      setWeightInput('');
      void qc.invalidateQueries({ queryKey: ['sacks'] });
    },
  });

  const simulateWeighMut = useMutation({
    mutationFn: () => {
      // Çuvaldaki ilk topun ağırlığı yaklaşık çoğaltılır — basit simülasyon
      const r = sackDetail?.rolls[0];
      if (!r) throw new Error('boş');
      return packagingService.simulateWeigh(r.id);
    },
    onSuccess: (res) => {
      const perRoll = res.data?.weightKg ?? 0;
      const totalRolls = sackDetail?.rolls.length ?? 0;
      if (perRoll && totalRolls) {
        setWeightInput((perRoll * totalRolls).toFixed(2));
      }
    },
  });

  const deleteSackMut = useMutation({
    mutationFn: (sackId: string) => sackService.remove(sackId),
    onSuccess: () => {
      Toast.show({ type: 'success', text1: 'Boş çuval silindi' });
      setActiveTab('pool');
      void qc.invalidateQueries({ queryKey: ['sacks'] });
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      Toast.show({
        type: 'error',
        text1: 'Silinemedi',
        text2:
          err?.response?.data?.message ?? 'Boş olmayan çuval silinemez.',
      });
    },
  });

  const matchingLinesForRoll = (roll: PoolRoll | null) =>
    roll
      ? job.order.lines.filter(
          (l) => l.itemId === roll.itemId && l.remainingQty > 0,
        )
      : [];

  // Tek hedef satır + tek hedef çuval kombinasyonunu modal açmadan halleder.
  // Modal zinciri Android'de overlay deadlock'a düşüyordu — sıralı setTimeout
  // ile bir modal kapanmadan diğeri açılmıyor.
  const tryAssign = (input: {
    roll: PoolRoll;
    sackId?: string;
  }) => {
    const { roll, sackId } = input;
    const lines = matchingLinesForRoll(roll);
    if (lines.length === 0) {
      Toast.show({
        type: 'error',
        text1: 'Bu ürün için açık sipariş satırı yok',
      });
      return;
    }

    // 1) Çuval belirsizse
    if (!sackId) {
      if (sacks.length === 0) {
        Toast.show({ type: 'info', text1: 'Önce yeni çuval aç' });
        return;
      }
      if (sacks.length === 1) {
        return tryAssign({ roll, sackId: sacks[0].id });
      }
      setSackPickerForRoll(roll);
      return;
    }

    // 2) Satır belirsizse
    if (lines.length === 1) {
      assignRollMut.mutate({
        rollId: roll.rollId,
        sackId,
        orderLineId: lines[0].lineId,
      });
      return;
    }
    setLinePickerFor({ roll, sackId });
  };

  const handleAssignRequest = (roll: PoolRoll) => tryAssign({ roll });

  return (
    <View style={S.root}>
      {/* Tab bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={S.tabBar}
        contentContainerStyle={S.tabBarContent}
      >
        <TouchableRipple
          onPress={() => setActiveTab('pool')}
          style={[S.tab, activeTab === 'pool' && S.tabActive]}
        >
          <View style={S.tabInner}>
            <Text style={[S.tabText, activeTab === 'pool' && S.tabTextActive]}>
              Havuz
            </Text>
            {pool.length > 0 && (
              <View style={S.tabBadge}>
                <Text style={S.tabBadgeText}>{pool.length}</Text>
              </View>
            )}
          </View>
        </TouchableRipple>

        {sacks.map((sack) => (
          <TouchableRipple
            key={sack.id}
            onPress={() => setActiveTab(sack.id)}
            style={[S.tab, activeTab === sack.id && S.tabActive]}
          >
            <View style={S.tabInner}>
              <Text
                style={[S.tabText, activeTab === sack.id && S.tabTextActive]}
                numberOfLines={1}
              >
                {sack.sackNumber}
              </Text>
              <View style={S.tabBadge}>
                <Text style={S.tabBadgeText}>{sack.rollCount}</Text>
              </View>
            </View>
          </TouchableRipple>
        ))}

        <TouchableRipple
          onPress={() => createSackMut.mutate()}
          disabled={createSackMut.isPending}
          style={[S.tab, S.tabNew]}
        >
          <View style={S.tabInner}>
            <Text style={S.tabNewText}>+ Yeni Çuval</Text>
          </View>
        </TouchableRipple>
      </ScrollView>

      {/* Active tab content */}
      <View style={S.body}>
        {activeTab === 'pool' ? (
          <PoolContent
            pool={pool}
            onScan={onOpenScanner}
            hasSack={sacks.length > 0}
            onAssign={handleAssignRequest}
            onRemove={removeFromPool}
            busy={assignRollMut.isPending}
          />
        ) : (
          <SackContent
            sack={sackDetail}
            loading={sackDetailQ.isLoading}
            otherSacksCount={sacks.length - 1}
            onScan={onOpenScanner}
            onWeigh={() => {
              setWeighSackId(activeSackId);
              setWeightInput(
                sackDetail?.weightKg ? String(sackDetail.weightKg) : '',
              );
            }}
            onRemoveRoll={(rollId) => removeRollMut.mutate(rollId)}
            onTransferRoll={(input) => setTransferTarget(input)}
            onDeleteSack={() => deleteSackMut.mutate(activeSackId!)}
            poolCount={pool.length}
          />
        )}
      </View>

      {/* Sack picker (pool roll → which sack) */}
      <PickerModal
        visible={!!sackPickerForRoll}
        title="Hangi çuvala?"
        options={sacks.map((s) => ({
          value: s.id,
          label: s.sackNumber,
          sublabel: `${s.rollCount} top · ${s.totalQty.toFixed(1)} m`,
        }))}
        onSelect={(sackId) => {
          const roll = sackPickerForRoll;
          if (!roll) return;
          // Bu modal kapanıp animasyon bitmeden tryAssign'i çağırma —
          // iki react-native-modal aynı anda açıkken Android'de deadlock olur.
          setSackPickerForRoll(null);
          setTimeout(() => tryAssign({ roll, sackId }), 350);
        }}
        onDismiss={() => setSackPickerForRoll(null)}
      />

      {/* Transfer picker — başka çuvala aktar */}
      <PickerModal
        visible={!!transferTarget}
        title={`${transferTarget?.barcode ?? ''} → hangi çuvala?`}
        options={sacks
          .filter((s) => s.id !== transferTarget?.fromSackId)
          .map((s) => ({
            value: s.id,
            label: s.sackNumber,
            sublabel: `${s.rollCount} top · ${s.totalQty.toFixed(1)} m`,
          }))}
        onSelect={(targetSackId) => {
          if (!transferTarget) return;
          transferRollMut.mutate({
            rollId: transferTarget.rollId,
            targetSackId,
            orderLineId: transferTarget.orderLineId,
          });
        }}
        onDismiss={() => setTransferTarget(null)}
        emptyText="Aktarılacak başka çuval yok — önce yeni çuval aç"
      />

      {/* Order line picker */}
      <PickerModal
        visible={!!linePickerFor}
        title="Hangi sipariş satırı?"
        options={matchingLinesForRoll(linePickerFor?.roll ?? null).map((l) => ({
          value: l.lineId,
          label: l.itemName,
          sublabel: l.itemCode,
          details: [
            [l.color?.name, l.variant?.name, l.width != null ? `${l.width} cm` : null]
              .filter(Boolean)
              .join(' · '),
            `Kalan: ${l.remainingQty.toLocaleString('tr-TR')} m`,
          ].filter(Boolean),
        }))}
        onSelect={(lineId) => {
          if (linePickerFor) {
            assignRollMut.mutate({
              rollId: linePickerFor.roll.rollId,
              sackId: linePickerFor.sackId,
              orderLineId: lineId,
            });
          }
        }}
        onDismiss={() => setLinePickerFor(null)}
        emptyText="Bu ürün için açık sipariş satırı kalmadı"
      />

      <WeighModal
        visible={!!weighSackId}
        sack={sackDetail}
        value={weightInput}
        onChangeValue={setWeightInput}
        onClose={() => {
          setWeighSackId(null);
          setWeightInput('');
        }}
        onSimulate={() => simulateWeighMut.mutate()}
        simulating={simulateWeighMut.isPending}
        canSimulate={!!sackDetail?.rolls.length}
        onSave={() => {
          const kg = Number(weightInput.replace(',', '.'));
          if (!Number.isFinite(kg) || kg <= 0) return;
          weighSackMut.mutate({ sackId: weighSackId!, weightKg: kg });
        }}
        saving={weighSackMut.isPending}
      />
    </View>
  );
}

// =============================================================================
// WeighModal — sıfırdan, baştan tasarım
// =============================================================================
// Sol panel: kantar tarzı siyah display + kantar sim butonu + içerik özeti.
// Sağ panel: numpad (flex 1, sağ kenara kadar dolu).
// Footer: İptal + Kaydet (custom — disabled state'te bile beyaz yazı görünür).
// =============================================================================

interface WeighModalProps {
  visible: boolean;
  sack: SackDetail | null;
  value: string;
  onChangeValue: (next: string) => void;
  onClose: () => void;
  onSimulate: () => void;
  simulating: boolean;
  canSimulate: boolean;
  onSave: () => void;
  saving: boolean;
}

function WeighModal({
  visible,
  sack,
  value,
  onClose,
  onSimulate,
  simulating,
  canSimulate,
  onSave,
  saving,
}: WeighModalProps) {
  const numericValue = Number(value.replace(',', '.'));
  const canSave = Number.isFinite(numericValue) && numericValue > 0 && !saving;
  const totalQty = sack?.rolls.reduce((s, r) => s + r.currentQty, 0) ?? 0;

  return (
    <Modal
      isVisible={visible}
      onBackdropPress={onClose}
      onBackButtonPress={onClose}
      backdropOpacity={0.6}
      useNativeDriver
      hideModalContentWhileAnimating
      style={W.modalRoot}
      avoidKeyboard={false}
    >
      <View style={W.sheet}>
        {/* Header */}
        <View style={W.header}>
          <View style={W.headerText}>
            <Text style={W.title}>Çuvalı Tart</Text>
            {sack && <Text style={W.subtitle}>{sack.sackNumber}</Text>}
          </View>
          <IconButton
            icon="close"
            size={22}
            onPress={onClose}
            accessibilityLabel="Kapat"
          />
        </View>

        {/* Body */}
        <View style={W.body}>
          {/* Sol kolon */}
          <View style={W.leftCol}>
            <View style={W.display}>
              <Text style={W.displayValue} numberOfLines={1} adjustsFontSizeToFit>
                {value || '0'}
              </Text>
              <Text style={W.displayUnit}>kg</Text>
            </View>

            <TouchableRipple
              onPress={onSimulate}
              disabled={!canSimulate || simulating}
              style={[W.simBtn, (!canSimulate || simulating) && W.simBtnDisabled]}
              borderless
            >
              <View style={W.simBtnInner}>
                {simulating ? (
                  <ActivityIndicator size={16} color="#0f172a" />
                ) : (
                  <Icon source="scale-balance" size={18} color="#0f172a" />
                )}
                <Text style={W.simBtnText}>Kantardan Oku</Text>
              </View>
            </TouchableRipple>

            <View style={W.meta}>
              <Text style={W.metaLabel}>İçerik</Text>
              <Text style={W.metaValue}>
                {sack?.rolls.length ?? 0} top
                {totalQty > 0 ? ` · ${totalQty.toFixed(1)} m` : ''}
              </Text>
            </View>
          </View>

          {/* Sağ kolon — numpad sağ kenara kadar */}
          <View style={W.rightCol}>
            <NumpadHost style={W.numpadHost} />
          </View>
        </View>

        {/* Footer */}
        <View style={W.footer}>
          <TouchableRipple onPress={onClose} style={W.cancelBtn} borderless>
            <Text style={W.cancelBtnText}>İptal</Text>
          </TouchableRipple>
          <TouchableRipple
            onPress={canSave ? onSave : undefined}
            disabled={!canSave}
            style={[W.saveBtn, !canSave && W.saveBtnDisabled]}
            rippleColor="rgba(255,255,255,0.2)"
            borderless
          >
            <View style={W.saveBtnInner}>
              {saving ? (
                <ActivityIndicator size={16} color="#fff" />
              ) : (
                <Icon source="content-save" size={18} color="#fff" />
              )}
              <Text style={W.saveBtnText}>Kaydet</Text>
            </View>
          </TouchableRipple>
        </View>
      </View>
    </Modal>
  );
}

const W = StyleSheet.create({
  modalRoot: { justifyContent: 'center', alignItems: 'center', margin: 0 },
  sheet: {
    width: 680,
    maxWidth: '94%',
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 8,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 20,
    paddingRight: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerText: { flex: 1 },
  title: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  subtitle: {
    fontSize: 13,
    color: '#64748b',
    fontFamily: 'monospace',
    marginTop: 2,
  },

  // Body
  body: {
    flexDirection: 'row',
    padding: 16,
    gap: 16,
    alignItems: 'stretch',
  },
  leftCol: { width: 260, gap: 12 },
  rightCol: { flex: 1 },

  // Display
  display: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingVertical: 22,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'flex-end',
    gap: 8,
    minHeight: 84,
  },
  displayValue: {
    color: '#fff',
    fontSize: 42,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
    flexShrink: 1,
  },
  displayUnit: { color: '#94a3b8', fontSize: 18, fontWeight: '600' },

  // Sim button
  simBtn: {
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 12,
  },
  simBtnDisabled: { opacity: 0.5 },
  simBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  simBtnText: { color: '#0f172a', fontWeight: '600', fontSize: 14 },

  // Meta
  meta: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  metaLabel: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metaValue: { color: '#0f172a', fontWeight: '600', marginTop: 2 },

  numpadHost: { padding: 0, backgroundColor: 'transparent' },

  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  cancelBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
  },
  cancelBtnText: { color: '#475569', fontWeight: '600', fontSize: 14 },
  saveBtn: {
    backgroundColor: '#10b981',
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 140,
  },
  saveBtnDisabled: { backgroundColor: '#10b981', opacity: 0.4 },
  saveBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});

// -----------------------------------------------------------------------------

function PoolContent({
  pool,
  onScan,
  hasSack,
  onAssign,
  onRemove,
  busy,
}: {
  pool: PoolRoll[];
  onScan: () => void;
  hasSack: boolean;
  onAssign: (roll: PoolRoll) => void;
  onRemove: (rollId: string) => void;
  busy: boolean;
}) {
  return (
    <View style={S.contentRoot}>
      <View style={S.contentHeader}>
        <View style={{ flex: 1 }}>
          <Text variant="titleMedium" style={S.contentTitle}>
            Havuz
          </Text>
          <Text style={S.contentSubtitle}>
            Taranan toplar — çuvala koymak için "Çuvala" basın
          </Text>
        </View>
        <Button
          mode="contained"
          icon="barcode-scan"
          onPress={onScan}
          style={S.scanBtn}
        >
          Top Tara
        </Button>
      </View>

      {pool.length === 0 ? (
        <View style={S.emptyState}>
          <Text style={S.emptyText}>Havuz boş</Text>
          <Text style={S.emptyHint}>
            Depodan kumaşları tara — burada toplanır, sonra çuvallara dağıtırsın.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={S.itemsList}>
          {pool.map((roll) => (
            <Surface key={roll.rollId} style={S.rollCard} elevation={0}>
              <View style={{ flex: 1 }}>
                <View style={S.rollHeader}>
                  <Text style={S.rollBarcode}>{roll.barcode}</Text>
                  <Chip compact style={S.gradeChip} textStyle={S.gradeChipText}>
                    {roll.qualityGrade}
                  </Chip>
                </View>
                <Text style={S.rollItem} numberOfLines={1}>
                  <Text style={S.itemCodeInline}>{roll.itemCode}</Text>{' '}
                  {roll.itemName}
                </Text>
                <View style={S.rollAttrs}>
                  {roll.colorName && (
                    <Chip compact style={S.attrChip} textStyle={S.attrChipText}>
                      {roll.colorName}
                    </Chip>
                  )}
                  {roll.variantName && (
                    <Chip compact style={S.attrChip} textStyle={S.attrChipText}>
                      {roll.variantName}
                    </Chip>
                  )}
                  <Text style={S.rollMeta}>
                    {roll.currentQty.toFixed(1)} m
                    {roll.weightKg != null && ` · ${roll.weightKg.toFixed(1)} kg`}
                    {roll.width != null && ` · ${roll.width} cm`}
                  </Text>
                </View>
              </View>
              <View style={S.rollActions}>
                <Button
                  mode="contained"
                  compact
                  disabled={!hasSack || busy}
                  onPress={() => onAssign(roll)}
                  style={S.assignBtn}
                >
                  Çuvala
                </Button>
                <IconButton
                  icon="close"
                  size={20}
                  onPress={() => onRemove(roll.rollId)}
                  iconColor="#dc2626"
                  style={S.removeBtn}
                />
              </View>
            </Surface>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function SackContent({
  sack,
  loading,
  otherSacksCount,
  onScan,
  onWeigh,
  onRemoveRoll,
  onTransferRoll,
  onDeleteSack,
  poolCount,
}: {
  sack: SackDetail | null;
  loading: boolean;
  otherSacksCount: number;
  onScan: () => void;
  onWeigh: () => void;
  onRemoveRoll: (rollId: string) => void;
  onTransferRoll: (input: {
    rollId: string;
    fromSackId: string;
    orderLineId: string;
    barcode: string;
  }) => void;
  onDeleteSack: () => void;
  poolCount: number;
}) {
  if (loading) {
    return (
      <View style={S.center}>
        <Text style={S.muted}>Çuval yükleniyor...</Text>
      </View>
    );
  }
  if (!sack) return null;

  const totalQty = sack.rolls.reduce((s, r) => s + r.currentQty, 0);

  return (
    <View style={S.contentRoot}>
      <View style={S.contentHeader}>
        <View style={{ flex: 1 }}>
          <Text variant="titleMedium" style={S.contentTitle}>
            {sack.sackNumber}
          </Text>
          <Text style={S.contentSubtitle}>
            {sack.rolls.length} top · {totalQty.toFixed(1)} m
            {sack.weightKg != null && ` · brüt ${sack.weightKg.toFixed(1)} kg`}
          </Text>
        </View>
        <Button mode="outlined" icon="scale" onPress={onWeigh} style={S.weighBtn}>
          Tart
        </Button>
        <Button
          mode="contained"
          icon="barcode-scan"
          onPress={onScan}
          style={S.scanBtn}
        >
          Top Tara
        </Button>
      </View>

      {poolCount > 0 && (
        <Surface style={S.poolHint} elevation={0}>
          <Text style={S.poolHintText}>
            Havuzda {poolCount} top bekliyor — "Havuz" sekmesinden bu çuvala
            atabilirsin.
          </Text>
        </Surface>
      )}

      {sack.rolls.length === 0 ? (
        <View style={S.emptyState}>
          <Text style={S.emptyText}>Çuval boş</Text>
          <Text style={S.emptyHint}>
            Havuzdaki topları bu çuvala ekle veya yeni top tara.
          </Text>
          <Button
            mode="text"
            onPress={onDeleteSack}
            textColor="#dc2626"
            style={{ marginTop: 12 }}
          >
            Boş Çuvalı Sil
          </Button>
        </View>
      ) : (
        <ScrollView contentContainerStyle={S.itemsList}>
          {sack.rolls.map((roll) => (
            <Surface key={roll.id} style={S.rollCard} elevation={0}>
              <View style={{ flex: 1 }}>
                <View style={S.rollHeader}>
                  <Text style={S.rollBarcode}>{roll.barcode}</Text>
                  <Chip compact style={S.gradeChip} textStyle={S.gradeChipText}>
                    {roll.qualityGrade}
                  </Chip>
                </View>
                {roll.item && (
                  <Text style={S.rollItem} numberOfLines={1}>
                    <Text style={S.itemCodeInline}>{roll.item.code}</Text>{' '}
                    {roll.item.name}
                  </Text>
                )}
                <View style={S.rollAttrs}>
                  {roll.variant && (
                    <Chip compact style={S.attrChip} textStyle={S.attrChipText}>
                      {roll.variant.name}
                    </Chip>
                  )}
                  <Text style={S.rollMeta}>
                    {roll.currentQty.toFixed(1)} m
                    {roll.weightKg != null && ` · ${roll.weightKg.toFixed(1)} kg`}
                  </Text>
                </View>
                {roll.allocations.length > 0 && (
                  <Text style={S.allocationText}>
                    {roll.allocations[0].orderLine.order.orderNumber} ·{' '}
                    {roll.allocations[0].allocatedQty.toFixed(1)} m
                  </Text>
                )}
              </View>
              <View style={S.rollActions}>
                {otherSacksCount > 0 && roll.allocations.length > 0 && (
                  <IconButton
                    icon="swap-horizontal"
                    size={20}
                    onPress={() =>
                      onTransferRoll({
                        rollId: roll.id,
                        fromSackId: sack.id,
                        orderLineId: roll.allocations[0].orderLine.id,
                        barcode: roll.barcode,
                      })
                    }
                    iconColor="#3b82f6"
                    accessibilityLabel="Başka çuvala aktar"
                  />
                )}
                <IconButton
                  icon="close"
                  size={20}
                  onPress={() => onRemoveRoll(roll.id)}
                  iconColor="#dc2626"
                />
              </View>
            </Surface>
          ))}
        </ScrollView>
      )}

      {sack.rolls.length > 0 && (
        <View style={S.footerActions}>
          <Divider style={{ marginBottom: 8 }} />
          <Text style={S.footerHint}>
            İçinde top varken çuval silinemez — önce çuvaldaki topları çıkar.
          </Text>
        </View>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  tabBar: {
    flexGrow: 0,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tabBarContent: { paddingHorizontal: 8, alignItems: 'center' },
  tab: {
    height: 48,
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: '#0f172a' },
  tabInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabText: { fontWeight: '600', color: '#64748b' },
  tabTextActive: { color: '#0f172a' },
  tabBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#0f172a',
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  tabNew: {},
  tabNewText: { color: '#3b82f6', fontWeight: '700' },

  body: { flex: 1 },
  contentRoot: { flex: 1, padding: 16 },
  contentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  contentTitle: { fontWeight: '700', color: '#0f172a' },
  contentSubtitle: { color: '#64748b', fontSize: 13 },
  scanBtn: { backgroundColor: '#0f172a' },
  weighBtn: {},

  poolHint: {
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#fcd34d',
  },
  poolHintText: { color: '#92400e', fontSize: 13 },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#475569' },
  emptyHint: { color: '#94a3b8', marginTop: 6, textAlign: 'center' },

  itemsList: { paddingBottom: 16 },
  rollCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 12,
  },
  rollHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  rollBarcode: { fontFamily: 'monospace', fontWeight: '700', color: '#0f172a' },
  gradeChip: { backgroundColor: '#dbeafe', height: 20 },
  gradeChipText: { color: '#1e40af', fontSize: 10, marginVertical: 0 },
  rollItem: { color: '#475569', marginBottom: 4 },
  itemCodeInline: { fontFamily: 'monospace', fontSize: 12, color: '#64748b' },
  rollAttrs: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  attrChip: { backgroundColor: '#f1f5f9', height: 22 },
  attrChipText: { fontSize: 11, color: '#475569' },
  rollMeta: { color: '#64748b', fontSize: 12, fontVariant: ['tabular-nums'] },
  allocationText: { color: '#10b981', fontSize: 12, marginTop: 4 },
  rollActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  assignBtn: { backgroundColor: '#3b82f6' },
  removeBtn: {},

  footerActions: { paddingVertical: 8 },
  footerHint: { color: '#94a3b8', fontSize: 12, textAlign: 'center' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: '#64748b' },

});
