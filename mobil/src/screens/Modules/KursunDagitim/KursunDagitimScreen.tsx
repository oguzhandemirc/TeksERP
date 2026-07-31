import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, SegmentedButtons } from 'react-native-paper';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import ScreenChrome from '../../../components/ScreenChrome';
import RefreshButton from '../../../components/RefreshButton';
import PickerModal from '../../../components/PickerModal';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { useManualRefresh } from '../../../hooks/useManualRefresh';
import { useDeviceType } from '../../../hooks/useDeviceType';
import {
  kursunBypassService,
  type KursunDistributionWaitingRow,
  type KursunDistributionAssignedRow,
} from '../../../services/kursunBypass.service';
import EligibleList from './EligibleList';
import AssignedList from './AssignedList';
import CompleteConfirmModal from './CompleteConfirmModal';
import { fmtMeters } from './dagitimUi';
import { colors, spacing, radius } from '../../../theme';

// =============================================================================
// KURŞUN DAĞITIM — kurşun istasyonlarına TABLET KOYULMAYAN düzenin ofis ekranı.
//
// Fabrika kurşun işlemini fiziksel olarak yapar ama dijital izlemez (hatalar
// kâğıtta). Yetkili personel burada, kurşun adımında bekleyen iş emrini bir
// fiziksel kurşun istasyonuna ATAR. Adım sonradan iki yoldan kapanır:
//   • Tambur tabletinde refakat kartı okutulur (Tambur ekranının işi), ya da
//   • Kurşun rotanın SON adımıysa buradaki "İşi Bitir" → toplar depoya.
//
// ⚠️ Bu SKIPPED DEĞİLDİR — adım normal şekilde COMPLETED olur, yalnız QC2/Kurşun
// operasyon kaydı yazılmaz ve hata açılmaz.
//
// TASARIM KARARLARI
// • TEK useQuery: bayrak + istasyonlar + bekleyen + dağıtılmış aynı payload'ta
//   gelir (backend `listDistribution`). İki liste ayrı sorgulansa aralarında
//   tutarsız an oluşurdu ("bekleyen"de de "dağıtılmış"ta da görünen iş emri).
// • Yön kilidi YOK — bu gezici bir ekran (ofis/süpervizör), istasyon tableti değil.
// • Mutasyonlar ONLINE-ONLY: offline kuyruğuna (offline/mutations.ts) KAYIT
//   EKLENMEZ. Dağıtım bir planlama kararıdır; saatler sonra kuyruktan boşalıp
//   sahanın çoktan başka yere taşıdığı işi yeniden atamak zarar verirdi.
// =============================================================================

type Tab = 'waiting' | 'assigned';

export default function KursunDagitimScreen() {
  const qc = useQueryClient();
  const isTablet = useDeviceType() === 'tablet';

  const [tab, setTab] = useState<Tab>('waiting');
  const [assignTarget, setAssignTarget] = useState<KursunDistributionWaitingRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<KursunDistributionAssignedRow | null>(null);
  const [completeTarget, setCompleteTarget] = useState<KursunDistributionAssignedRow | null>(null);

  const distQ = useQuery({
    queryKey: ['kursun-bypass', 'distribution'],
    queryFn: () => kursunBypassService.getDistribution(),
    staleTime: 15_000,
  });
  const payload = distQ.data?.data;
  const waiting = useMemo(() => payload?.waiting ?? [], [payload]);
  const assigned = useMemo(() => payload?.assigned ?? [], [payload]);
  const stations = useMemo(() => payload?.stations ?? [], [payload]);
  const flagEnabled = payload?.flagEnabled ?? false;

  const refresh = () => qc.invalidateQueries({ queryKey: ['kursun-bypass'] });
  // Header butonu + iki listenin pull-to-refresh'i AYNI hook örneğini paylaşır:
  // hangisinden çekilirse çekilsin tek bir "yenileniyor" durumu görünür.
  const manualRefresh = useManualRefresh([() => distQ.refetch()], 'Dağıtım listesi güncellendi');

  // ── Mutasyonlar (online-only; hata toast'ı bileşende) ──────────────────────
  const assignMut = useMutation({
    mutationFn: (v: { workOrderId: string; stationId: string }) =>
      kursunBypassService.assign({ workOrderId: v.workOrderId, stationId: v.stationId }),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: res.data.reassigned ? 'İstasyon değiştirildi' : 'İş kurşuna dağıtıldı',
        text2: `${res.data.workOrderNumber} → ${res.data.stationName}`,
      });
      void refresh();
    },
    onError: (e: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Dağıtılamadı', text2: e.message });
      void refresh();
    },
  });

  const cancelMut = useMutation({
    mutationFn: (v: { assignmentId: string; reason?: string }) =>
      kursunBypassService.cancel(v.assignmentId, { reason: v.reason ?? null }),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Dağıtım kaldırıldı',
        text2: res.data.stationRestored
          ? 'Adım eski istasyonuna döndü — normal tabletli akış.'
          : 'Adımın istasyonu bu arada başka yolla değişmiş, geri yükleme yapılmadı.',
      });
      setCancelTarget(null);
      void refresh();
    },
    onError: (e: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Atama kaldırılamadı', text2: e.message });
      void refresh();
    },
  });

  const urgentMut = useMutation({
    mutationFn: (v: { stepId: string; isUrgent: boolean }) =>
      kursunBypassService.setUrgent(v.stepId, v.isUrgent),
    onSuccess: (res) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Toast.show({
        type: 'success',
        text1: res.data.isUrgent ? 'ACİL işaretlendi' : 'Acil işareti kaldırıldı',
      });
      void refresh();
    },
    onError: (e: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Acil işareti değiştirilemedi', text2: e.message });
      void refresh();
    },
  });

  const urgentBusyStepId = urgentMut.isPending ? urgentMut.variables?.stepId ?? null : null;
  const busyAssignmentId = cancelMut.isPending ? cancelMut.variables?.assignmentId ?? null : null;

  const toggleUrgent = (row: { workOrderStepId: string; isUrgent: boolean }) =>
    urgentMut.mutate({ stepId: row.workOrderStepId, isUrgent: !row.isUrgent });

  const stationOptions = useMemo(
    () => stations.map((s) => ({ value: s.id, label: s.name, sublabel: s.code })),
    [stations]
  );

  const loading = distQ.isLoading;

  const eligibleList = (
    <EligibleList
      rows={waiting}
      flagEnabled={flagEnabled}
      stationsEmpty={stations.length === 0}
      loading={loading}
      refreshing={manualRefresh.refreshing}
      onRefresh={manualRefresh.onRefresh}
      onPickStation={setAssignTarget}
      onToggleUrgent={toggleUrgent}
      urgentBusyStepId={urgentBusyStepId}
    />
  );

  const assignedList = (
    <AssignedList
      rows={assigned}
      loading={loading}
      refreshing={manualRefresh.refreshing}
      onRefresh={manualRefresh.onRefresh}
      onToggleUrgent={toggleUrgent}
      urgentBusyStepId={urgentBusyStepId}
      onUnassign={setCancelTarget}
      onComplete={setCompleteTarget}
      busyAssignmentId={busyAssignmentId}
    />
  );

  return (
    <ScreenChrome
      title="Kurşun Dağıtım"
      hidePlaceChip
      headerExtras={
        <RefreshButton
          headerStyle
          onPress={manualRefresh.onRefresh}
          refreshing={manualRefresh.refreshing}
          isError={manualRefresh.isError}
          errorMessage={manualRefresh.errorMessage}
          successMessage={manualRefresh.successMessage}
        />
      }
    >
      {isTablet ? (
        // TABLET — iki kolon yan yana: planlamacı "ne bekliyor / nerede ne var"
        // sorusunu tek ekranda görür, sekme değiştirmez.
        <View style={styles.split}>
          <View style={styles.col}>
            <ColumnHeader
              icon="⏳"
              title="Bekleyen"
              count={waiting.length}
              meters={waiting.reduce((s, r) => s + r.totalMeters, 0)}
            />
            {eligibleList}
          </View>
          <View style={styles.colDivider} />
          <View style={styles.col}>
            <ColumnHeader
              icon="🏭"
              title="Dağıtılmış"
              count={assigned.length}
              meters={assigned.reduce((s, r) => s + r.totalMeters, 0)}
            />
            {assignedList}
          </View>
        </View>
      ) : (
        // TELEFON — dar ekranda iki kolon okunmaz; segmentli tek liste.
        <View style={styles.phoneRoot}>
          <View style={styles.segmentWrap}>
            <SegmentedButtons
              value={tab}
              onValueChange={(v) => setTab(v as Tab)}
              density="medium"
              buttons={[
                { value: 'waiting', label: `Bekleyen (${waiting.length})`, icon: 'timer-sand' },
                { value: 'assigned', label: `Dağıtılmış (${assigned.length})`, icon: 'factory' },
              ]}
            />
          </View>
          <View style={styles.phoneBody}>{tab === 'waiting' ? eligibleList : assignedList}</View>
        </View>
      )}

      {/* İSTASYON SEÇ → doğrudan atama (araya form/onay koymuyoruz). */}
      <PickerModal
        visible={assignTarget !== null}
        title={
          assignTarget
            ? `${assignTarget.workOrderNumber} → Kurşun İstasyonu`
            : 'Kurşun İstasyonu'
        }
        options={stationOptions}
        emptyText="Kurşun (PROCESS_QC) istasyonu tanımlı değil — yönetim panelinden ekleyin."
        onSelect={(stationId) => {
          const target = assignTarget;
          setAssignTarget(null);
          if (target) assignMut.mutate({ workOrderId: target.workOrderId, stationId });
        }}
        onDismiss={() => setAssignTarget(null)}
      />

      {/* ATAMAYI KALDIR — yıkıcı işlem: etkilenen kayıt SOMUT yazılır. */}
      <ConfirmDialog
        kind="destructive"
        visible={cancelTarget !== null}
        onDismiss={() => setCancelTarget(null)}
        title="Atamayı Kaldır"
        confirmLabel="Atamayı Kaldır"
        confirming={cancelMut.isPending}
        reason={{
          label: 'Sebep (opsiyonel)',
          placeholder: 'Örn. iş yanlış istasyona verildi',
          required: false,
        }}
        description={
          cancelTarget ? (
            <View style={styles.confirmBody}>
              <Text style={styles.confirmLine}>
                <Text style={styles.confirmStrong}>{cancelTarget.workOrderNumber}</Text> iş emrinin
                kurşun dağıtımı kaldırılacak.
              </Text>
              <Text style={styles.confirmLine}>
                İstasyon: <Text style={styles.confirmStrong}>{cancelTarget.stationName}</Text>
              </Text>
              <Text style={styles.confirmLine}>
                Etkilenen iş:{' '}
                <Text style={styles.confirmStrong}>
                  {cancelTarget.openRollCount} top · {fmtMeters(cancelTarget.totalMeters)} m
                </Text>
                {cancelTarget.batchNumbers.length > 0
                  ? ` (Parti: ${cancelTarget.batchNumbers.join(' · ')})`
                  : ''}
              </Text>
              <Text style={styles.confirmNote}>
                Adım atama öncesi istasyonuna döner ve NORMAL tabletli Kurşun + KK2 akışına
                geri girer. Toplara dokunulmaz, hiçbir kayıt silinmez.
              </Text>
            </View>
          ) : (
            ''
          )
        }
        onConfirm={({ reason }) => {
          if (cancelTarget) {
            cancelMut.mutate({ assignmentId: cancelTarget.assignmentId, reason });
          }
        }}
      />

      {/* İŞİ BİTİR — kurşun SON adımsa; canlı önizleme + somut top listesi. */}
      <CompleteConfirmModal
        row={completeTarget}
        onDismiss={() => setCompleteTarget(null)}
        onDone={() => setCompleteTarget(null)}
      />
    </ScreenChrome>
  );
}

/** Tablet kolonlarının üst şeridi — hangi liste + kaç iş / kaç metre. */
function ColumnHeader({
  icon,
  title,
  count,
  meters,
}: {
  icon: string;
  title: string;
  count: number;
  meters: number;
}) {
  return (
    <View style={styles.colHeader}>
      <Text style={styles.colHeaderTitle} numberOfLines={1}>
        {icon} {title}
      </Text>
      <Text style={styles.colHeaderMeta}>
        {count} iş · {fmtMeters(meters)} m
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  split: { flex: 1, flexDirection: 'row', backgroundColor: colors.appBg },
  // min-w-0 muadili: flexBasis 0 + minWidth 0 → uzun iş emri/istasyon adı
  // komşu kolona taşmaz, kolon içinde kısalır.
  col: { flex: 1, flexBasis: 0, minWidth: 0 },
  colDivider: { width: 1, backgroundColor: colors.border },
  colHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  colHeaderTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: colors.text },
  colHeaderMeta: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  phoneRoot: { flex: 1, backgroundColor: colors.appBg },
  segmentWrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  phoneBody: { flex: 1 },
  confirmBody: { gap: 6 },
  confirmLine: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  confirmStrong: { fontWeight: '800', color: colors.text },
  confirmNote: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
    marginTop: 4,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
});
