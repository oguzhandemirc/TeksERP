import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Surface, Text } from 'react-native-paper';
import { useMutation, useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import AppModal from '../../../components/AppModal';
import TruncatedText from '../../../components/TruncatedText';
import { packingService, type SackStoreShipmentLite, type ShipmentCancelPreview } from '../../../services/packing.service';
import { showScreenError } from '../../../lib/screenToast';
import { loadUnitIcon, loadUnitTitle } from '../../../lib/loadUnit';
import { queryProblem } from '../../../utils/queryState';
import { palette } from '../../../theme/tokens';

// =============================================================================
// Bekleyen (PLANNED) sevkiyatı İPTAL — yıkıcı işlem: önce sunucu önizlemesi, etkilenen
// HER birim ve top listelenir (çuval havuza döner; dökme/araba çözülür, toplar rafa).
// Storno (sevk edilmişi geri alma) tablete GELMEZ — SoD, yalnız panel.
// =============================================================================

const PREVIEW_PROBLEM_TEXT = {
  offline: 'Çevrimdışısınız — iptal önizlemesi alınamıyor. Bağlantı gelince yeniden deneyin.',
  error: 'Önizleme alınamadı — bağlantıyı kontrol edip yeniden deneyin.',
} as const;

type Unit = NonNullable<ShipmentCancelPreview['units']>[number];

function UnitBlock({ u }: { u: Unit }) {
  const dest = u.returnsTo === 'SHELF' ? 'Toplar rafa döner' : 'Çuval depoya (havuza) döner';
  return (
    <View style={styles.unit}>
      <View style={styles.unitHead}>
        <Icon source={loadUnitIcon(u)} size={18} color={palette.indigo[700]} />
        <Text style={styles.unitTitle}>{loadUnitTitle(u)}</Text>
        <Text style={styles.unitMeta}>
          {u.rolls.length} top · {dest}
        </Text>
      </View>
      <Text style={styles.barcodes}>{u.rolls.map((r) => r.barcode ?? '—').join(' · ') || 'Top yok'}</Text>
    </View>
  );
}

function PreviewBody({ p }: { p: ShipmentCancelPreview }) {
  return (
    <>
      <Text style={styles.summary}>
        {p.rollCount} top{p.swatchCount > 0 ? ` · ${p.swatchCount} kartela` : ''} · {p.sackCount} birim
      </Text>
      {!p.canCancel && p.reason ? <Text style={styles.block}>{p.reason}</Text> : null}
      {p.affectedOrders.length > 0 ? (
        <Text style={styles.orders}>
          Sipariş karşılığı düşecek: {p.affectedOrders.map((o) => `${o.orderNumber} (${o.qty} m)`).join(' · ')}
        </Text>
      ) : null}
      <ScrollView style={styles.list}>
        {(p.units ?? []).map((u) => (
          <UnitBlock key={u.id} u={u} />
        ))}
      </ScrollView>
    </>
  );
}

export default function ShipmentCancelModal({
  shipment,
  onDismiss,
  onDone,
}: {
  shipment: SackStoreShipmentLite | null;
  onDismiss: () => void;
  onDone: () => void;
}) {
  const id = shipment?.id ?? null;
  const previewQ = useQuery({
    queryKey: ['shipment-cancel-preview', id],
    queryFn: () => packingService.cancelPreview(id!),
    enabled: !!id,
    staleTime: 0,
  });
  const cancelMut = useMutation({
    mutationFn: () => packingService.cancel(id!),
    onSuccess: () => {
      Toast.show({ type: 'success', text1: 'Sevkiyat iptal edildi', text2: shipment?.shipmentNo });
      onDone();
    },
    onError: (e: Error) => {
      showScreenError(e, 'İptal edilemedi');
      void previewQ.refetch();
    },
  });
  const p = previewQ.data?.data ?? null;
  // Çevrimdışıyken sorgu hata vermez, DURAKLAR (isPaused) — yalnız isError'a bakılırsa modal boş ve sessiz kalır.
  const problem = p ? null : queryProblem(previewQ);

  return (
    <AppModal visible={!!shipment} onDismiss={onDismiss}>
      <Surface style={styles.sheet} elevation={4}>
        <Text variant="titleMedium" style={styles.title}>
          {shipment?.shipmentNo} — Sevkiyatı İptal Et
        </Text>
        <TruncatedText style={styles.customer} revealOnTap>
          {shipment?.customer.name}
          {shipment?.branch ? ` · ${shipment.branch.name}` : ''}
        </TruncatedText>
        {previewQ.isLoading ? <ActivityIndicator style={styles.loading} /> : null}
        {problem ? (
          <View style={styles.problem} testID="sevk-iptal-onizleme-sorun">
            <Text style={styles.block}>{PREVIEW_PROBLEM_TEXT[problem]}</Text>
            <Button mode="outlined" icon="refresh" onPress={() => void previewQ.refetch()} contentStyle={styles.btnContent}>
              Yeniden dene
            </Button>
          </View>
        ) : null}
        {p ? <PreviewBody p={p} /> : null}
        <View style={styles.actions}>
          <Button onPress={onDismiss} style={styles.btn} contentStyle={styles.btnContent} testID="sevk-iptal-vazgec">
            Vazgeç
          </Button>
          <Button
            mode="contained"
            icon="cancel"
            buttonColor={palette.red[600]}
            style={styles.btn}
            contentStyle={styles.btnContent}
            loading={cancelMut.isPending}
            disabled={!p?.canCancel || cancelMut.isPending}
            onPress={() => cancelMut.mutate()}
            testID="sevk-iptal-onay"
          >
            İptal Et
          </Button>
        </View>
      </Surface>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 20, borderRadius: 12, maxHeight: '90%' },
  title: { fontWeight: '700' },
  customer: { fontSize: 15, color: palette.slate[700], marginTop: 4 },
  loading: { marginVertical: 16 },
  problem: { gap: 8, alignItems: 'flex-start' },
  summary: { fontSize: 20, fontWeight: '700', marginTop: 12 },
  block: { fontSize: 15, color: palette.red[700], marginTop: 8 },
  orders: { fontSize: 14, color: palette.amber[900], marginTop: 8 },
  list: { marginTop: 8, maxHeight: 320 },
  unit: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.slate[300] },
  unitHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  unitTitle: { fontSize: 16, fontWeight: '700' },
  unitMeta: { fontSize: 14, color: palette.slate[600] },
  barcodes: { fontSize: 14, color: palette.slate[700], marginTop: 4 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 16 },
  btn: { minWidth: 140 },
  btnContent: { minHeight: 56 },
});
