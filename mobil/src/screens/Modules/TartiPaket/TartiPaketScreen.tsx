import React, { useRef, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import {
  Surface,
  Text,
  Button,
  TextInput,
  ActivityIndicator,
  TouchableRipple,
  Divider,
  IconButton,
} from 'react-native-paper';
import RNModal from 'react-native-modal';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import ScreenChrome from '../../../components/ScreenChrome';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import { packingService, type SackListItem } from '../../../services/packing.service';
import { customerService } from '../../../services/customer.service';
import { rollService } from '../../../services/roll.service';
import { usePermissions } from '../../../hooks/usePermission';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import type { MainStackParamList } from '../../../navigation/types';
import ReadyToShipList from './components/ReadyToShipList';
import RelabelSheet, { type RelabelRoll } from '../../../components/RelabelSheet';

// =============================================================================
// Tartı/Paket — telefon dikey. Omurga: AÇIK çuvallar.
//   Yeni Çuval (müşteri seç) → Top Ekle (okut) → Tart & Kapat (= sevk edildi).
// Etiket basma YOK (etiket sadece tamburda). Çuval kapanınca sevkiyata düşer.
// =============================================================================

export default function TartiPaketScreen() {
  usePortraitLock(); // telefon dikey
  const qc = useQueryClient();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  // Köprü görünürlüğü, navigasyonun Sevkiyat ekranını kaydetme koşuluyla AYNI
  // kaynaktan gelmeli: has('mobile:sevkiyat') (mobile:* wildcard'ını da kapsar).
  // Böylece köprü yalnızca ekran gerçekten navigasyona kayıtlıyken görünür —
  // aksi halde (örn. yalnız global '*' izni) navigate('Sevkiyat') çökerdi.
  const { has } = usePermissions();
  const canShip = has('mobile:sevkiyat');

  const [newSackOpen, setNewSackOpen] = useState(false);
  const [custSearch, setCustSearch] = useState('');
  const [scannerSackId, setScannerSackId] = useState<string | null>(null);
  const [autoScanOpen, setAutoScanOpen] = useState(false);
  const [relabelScanOpen, setRelabelScanOpen] = useState(false);
  // Tarayıcı tam kapanmadan RelabelSheet açılırsa (RNModal üst üste) görünmez
  // overlay dokunmayı yutar — barkodu pending'e al, resolve'u onModalHide'da yap.
  const [pendingRelabelScan, setPendingRelabelScan] = useState<string | null>(null);
  const [relabelRoll, setRelabelRoll] = useState<RelabelRoll | null>(null);
  const [weighSack, setWeighSack] = useState<SackListItem | null>(null);
  const [weightInput, setWeightInput] = useState('');
  const [cancelTarget, setCancelTarget] = useState<SackListItem | null>(null);
  const scanBusy = useRef(false);

  const sacksQuery = useQuery({
    queryKey: ['sacks', 'OPEN'],
    queryFn: () => packingService.listSacks({ status: 'OPEN' }),
    staleTime: 10_000,
  });
  const openSacks = sacksQuery.data?.data ?? [];

  const closedQuery = useQuery({
    queryKey: ['sacks', 'CLOSED', 'unassigned'],
    queryFn: () => packingService.listSacks({ status: 'CLOSED', unassignedOnly: true }),
    enabled: canShip,
    staleTime: 10_000,
  });
  const closedCount = closedQuery.data?.data?.length ?? 0;

  const customersQuery = useQuery({
    queryKey: ['customers', 'picker'],
    queryFn: () => customerService.getAll({ page: 1, pageSize: 200 }),
    enabled: newSackOpen,
    staleTime: 60_000,
  });

  const refreshSacks = () => {
    void qc.invalidateQueries({ queryKey: ['sacks'] });
    // Paketlenen toplar Sevke Hazır listesinden düşsün
    void qc.invalidateQueries({ queryKey: ['shipping', 'ready'] });
  };

  const createSackMut = useMutation({
    mutationFn: (customerId: string) => packingService.createSack({ customerId }),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Çuval açıldı', text2: res.data?.sackNo });
      setNewSackOpen(false);
      setCustSearch('');
      refreshSacks();
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Çuval açılamadı', text2: e.message }),
  });

  // Sevke Hazır → "Çuvala Başla": müşterinin açık çuvalı varsa odaklan, yoksa aç —
  // ardından o çuvalın okuyucusunu aç (operatör hazır topları tarasın).
  const startSackMut = useMutation({
    mutationFn: (vars: { customerId: string; branchId: string | null }) =>
      packingService.createSack({ customerId: vars.customerId, branchId: vars.branchId }),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Çuval açıldı', text2: res.data?.sackNo });
      refreshSacks();
      if (res.data?.id) setScannerSackId(res.data.id);
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Çuval açılamadı', text2: e.message }),
  });

  // Sevke Hazır → Çuvala Başla: aynı müşteri+şubenin açık çuvalı varsa ona odaklan
  // (çuval tek müşteri+tek şube). Şubesiz (null) çuval da eşleşir; yoksa şubeli aç.
  const beginPackingForCustomer = (customerId: string, branchId: string | null) => {
    const existing = openSacks.find(
      (s) => s.customer.id === customerId && (s.branch?.id ?? null) === branchId,
    );
    if (existing) {
      setScannerSackId(existing.id);
      return;
    }
    startSackMut.mutate({ customerId, branchId });
  };

  const weighMut = useMutation({
    mutationFn: ({ sackId, kg }: { sackId: string; kg: number }) =>
      packingService.weighClose(sackId, kg),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Çuval kapatıldı', text2: 'Sevk edildi' });
      setWeighSack(null);
      setWeightInput('');
      refreshSacks();
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Tartı kaydedilemedi', text2: e.message }),
  });

  // Çuval iptali — yıkıcı işlem: önce önizleme (serbest bırakılacak toplar), sonra onayla.
  const cancelPreviewQuery = useQuery({
    queryKey: ['sacks', 'cancel-preview', cancelTarget?.id],
    queryFn: () => packingService.cancelPreview(cancelTarget!.id),
    enabled: cancelTarget !== null,
    staleTime: 0,
  });
  const cancelPreview = cancelPreviewQuery.data?.data ?? null;

  const cancelMut = useMutation({
    mutationFn: (sackId: string) => packingService.cancelSack(sackId),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Çuval iptal edildi', text2: res.message });
      setCancelTarget(null);
      refreshSacks();
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'İptal edilemedi', text2: e.message }),
  });

  // Barkod okundu → topu çöz → açık çuvala ekle (müşteri uyumunu backend doğrular).
  const handleScan = async (barcode: string) => {
    const code = barcode.trim();
    if (!code || !scannerSackId || scanBusy.current) return;
    scanBusy.current = true;
    try {
      const res = await rollService.getByBarcode(code);
      const roll = res.data;
      if (!roll) {
        Toast.show({ type: 'error', text1: 'Top bulunamadı', text2: code });
        return;
      }
      await packingService.assignRoll({ rollId: roll.id, sackId: scannerSackId });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Top çuvala eklendi', text2: roll.barcode ?? code });
      refreshSacks();
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Eklenemedi', text2: (e as Error).message });
    } finally {
      // kısa kilit — aynı barkodun arka arkaya iki kez işlenmesini önle
      setTimeout(() => {
        scanBusy.current = false;
      }, 600);
    }
  };

  // Hızlı Okut (Mod C): müşteri seçmeden okut → backend topun müşterisini bulup
  // açık çuvalına ekler (yoksa açar). Uymazsa hata döner (stok etiketli → yönlendir).
  const handleAutoScan = async (barcode: string) => {
    const code = barcode.trim();
    if (!code || scanBusy.current) return;
    scanBusy.current = true;
    try {
      const res = await packingService.autoAssign(code);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: res.data?.createdSack ? 'Çuval açıldı, top eklendi' : 'Top çuvala eklendi',
        text2: res.message ?? res.data?.customerName,
      });
      refreshSacks();
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Eklenemedi', text2: (e as Error).message });
    } finally {
      setTimeout(() => {
        scanBusy.current = false;
      }, 600);
    }
  };

  // Yönlendir: top okut → çöz → RelabelSheet aç (stok-etiketli / başka müşteri topu).
  const handleRelabelScan = async (barcode: string) => {
    const code = barcode.trim();
    if (!code || scanBusy.current) return;
    scanBusy.current = true;
    try {
      const res = await rollService.getByBarcode(code);
      const roll = res.data;
      if (!roll) {
        Toast.show({ type: 'error', text1: 'Top bulunamadı', text2: code });
        return;
      }
      setRelabelRoll({
        id: roll.id,
        barcode: roll.barcode,
        itemId: roll.itemId,
        colorId: roll.colorId,
        width: roll.width,
        itemName: roll.item?.name,
        colorName: roll.color?.name ?? null,
      });
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Okunamadı', text2: (e as Error).message });
    } finally {
      setTimeout(() => {
        scanBusy.current = false;
      }, 600);
    }
  };

  const customers = customersQuery.data?.data ?? [];
  const filteredCustomers = customers.filter((c) => {
    const q = custSearch.trim().toLocaleLowerCase('tr-TR');
    if (!q) return true;
    return (
      c.name.toLocaleLowerCase('tr-TR').includes(q) ||
      (c.code ?? '').toLocaleLowerCase('tr-TR').includes(q)
    );
  });

  return (
    <ScreenChrome title="Tartı / Paket" subtitle="Çuval doldur & tart">
      <ScrollView style={styles.root} contentContainerStyle={styles.scrollContent}>
        {/* Yetkiye duyarlı köprü — kullanıcının sevkiyat izni varsa görünür */}
        {canShip && closedCount > 0 && (
          <TouchableRipple onPress={() => nav.navigate('Sevkiyat')} style={styles.bridge}>
            <View style={styles.bridgeInner}>
              <Text style={styles.bridgeText}>{closedCount} kapalı çuval sevk bekliyor</Text>
              <Text style={styles.bridgeCta}>Sevkiyat →</Text>
            </View>
          </TouchableRipple>
        )}

        {/* Mod C Hızlı Okut + Yönlendir (değişebilir etiket) */}
        <View style={styles.actionRow}>
          <Button
            mode="contained"
            icon="barcode-scan"
            onPress={() => setAutoScanOpen(true)}
            style={styles.flexBtn}
            contentStyle={styles.quickScanContent}
          >
            Hızlı Okut
          </Button>
          <Button
            mode="outlined"
            icon="swap-horizontal"
            onPress={() => setRelabelScanOpen(true)}
            style={styles.flexBtn}
            contentStyle={styles.quickScanContent}
          >
            Yönlendir
          </Button>
        </View>

        {/* Sevke Hazır (Mod A) — siparişten çuvala başla */}
        <ReadyToShipList
          onStart={beginPackingForCustomer}
          busyCustomerId={startSackMut.isPending ? startSackMut.variables?.customerId ?? null : null}
        />

        <View style={styles.topBar}>
          <Text variant="titleMedium" style={styles.heading}>
            Açık Çuvallar ({openSacks.length})
          </Text>
          <Button mode="contained" icon="plus" onPress={() => setNewSackOpen(true)} compact>
            Yeni Çuval
          </Button>
        </View>

        {sacksQuery.isLoading ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : openSacks.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Açık çuval yok.</Text>
            <Text style={styles.emptySub}>"Yeni Çuval" ile bir müşteriye çuval aç.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {openSacks.map((s) => (
              <Surface key={s.id} style={styles.card} elevation={1}>
                <View style={styles.cardHead}>
                  <Text style={styles.sackNo}>{s.sackNo}</Text>
                  <View style={styles.cardHeadRight}>
                    <Text style={styles.sackMeta}>
                      {s._count.rolls} top
                      {s._count.swatches > 0 ? ` · ${s._count.swatches} kartela` : ''}
                    </Text>
                    <IconButton
                      icon="close-circle-outline"
                      size={20}
                      iconColor="#dc2626"
                      onPress={() => setCancelTarget(s)}
                      style={styles.cancelIcon}
                      accessibilityLabel="Çuvalı iptal et"
                    />
                  </View>
                </View>
                <Text style={styles.customer}>
                  {s.customer.name}
                  {s.branch ? ` · ${s.branch.name}` : ''}
                </Text>
                <Divider style={{ marginVertical: 8 }} />
                <View style={styles.actions}>
                  <Button
                    mode="contained-tonal"
                    icon="barcode-scan"
                    onPress={() => setScannerSackId(s.id)}
                    style={styles.actionBtn}
                  >
                    Top Ekle
                  </Button>
                  <Button
                    mode="contained"
                    icon="scale-balance"
                    onPress={() => {
                      setWeighSack(s);
                      setWeightInput('');
                    }}
                    disabled={s._count.rolls === 0}
                    buttonColor="#059669"
                    style={styles.actionBtn}
                  >
                    Tart & Kapat
                  </Button>
                </View>
              </Surface>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Yeni çuval — müşteri seçici */}
      <RNModal isVisible={newSackOpen} onBackdropPress={() => setNewSackOpen(false)} style={styles.modal}>
        <Surface style={styles.sheet} elevation={4}>
          <Text variant="titleMedium" style={styles.sheetTitle}>
            Çuval için müşteri seç
          </Text>
          <TextInput
            mode="outlined"
            dense
            placeholder="Müşteri ara..."
            value={custSearch}
            onChangeText={setCustSearch}
            left={<TextInput.Icon icon="magnify" />}
            style={{ marginBottom: 8 }}
          />
          {customersQuery.isLoading ? (
            <ActivityIndicator style={{ marginVertical: 16 }} />
          ) : (
            <ScrollView style={{ maxHeight: 320 }}>
              {filteredCustomers.map((c) => (
                <TouchableRipple
                  key={c.id}
                  onPress={() => createSackMut.mutate(c.id)}
                  disabled={createSackMut.isPending}
                  style={styles.custRow}
                >
                  <View>
                    <Text style={styles.custName}>{c.name}</Text>
                    {c.code ? <Text style={styles.custCode}>{c.code}</Text> : null}
                  </View>
                </TouchableRipple>
              ))}
              {filteredCustomers.length === 0 && (
                <Text style={styles.emptySub}>Müşteri bulunamadı.</Text>
              )}
            </ScrollView>
          )}
          <Button onPress={() => setNewSackOpen(false)} style={{ marginTop: 8 }}>
            İptal
          </Button>
        </Surface>
      </RNModal>

      {/* Top ekleme — kamera (belirli çuval). Sürekli: arka arkaya çok top okut. */}
      <BarcodeScannerModal
        visible={scannerSackId !== null}
        onDismiss={() => setScannerSackId(null)}
        onScan={handleScan}
        title="Top barkodu okut"
        continuous
      />

      {/* Hızlı Okut — otomatik çuval (müşteri seçmeden). Sürekli okuma. */}
      <BarcodeScannerModal
        visible={autoScanOpen}
        onDismiss={() => setAutoScanOpen(false)}
        onScan={handleAutoScan}
        title="Hızlı okut — otomatik çuvala"
        continuous
      />

      {/* Yönlendir — top okut. onScan modal'ı kapatır; asıl çözümleme + RelabelSheet
          açılışı onModalHide'da (modal tam kapandığında) — overlay dokunmayı yutmasın. */}
      <BarcodeScannerModal
        visible={relabelScanOpen}
        onDismiss={() => setRelabelScanOpen(false)}
        onScan={(barcode) => {
          setPendingRelabelScan(barcode);
          setRelabelScanOpen(false);
        }}
        onModalHide={() => {
          if (pendingRelabelScan) {
            const b = pendingRelabelScan;
            setPendingRelabelScan(null);
            void handleRelabelScan(b);
          }
        }}
        title="Yönlendirilecek topu okut"
      />
      <RelabelSheet
        roll={relabelRoll}
        onDismiss={() => setRelabelRoll(null)}
        onDone={refreshSacks}
      />

      {/* Tart & kapat */}
      <RNModal isVisible={weighSack !== null} onBackdropPress={() => setWeighSack(null)} style={styles.modal}>
        <Surface style={styles.sheet} elevation={4}>
          <Text variant="titleMedium" style={styles.sheetTitle}>
            {weighSack?.sackNo} — Tart & Kapat
          </Text>
          <Text style={styles.customer}>
            {weighSack?.customer.name} · {weighSack?._count.rolls} top
          </Text>
          <TextInput
            mode="outlined"
            label="Ağırlık (kg)"
            keyboardType="decimal-pad"
            value={weightInput}
            onChangeText={setWeightInput}
            style={{ marginVertical: 12 }}
            right={
              <TextInput.Icon
                icon="scale"
                onPress={() =>
                  setWeightInput((Math.round((10 + Math.random() * 90) * 10) / 10).toString())
                }
              />
            }
          />
          <View style={styles.actions}>
            <Button onPress={() => setWeighSack(null)} style={styles.actionBtn}>
              İptal
            </Button>
            <Button
              mode="contained"
              icon="check"
              buttonColor="#059669"
              style={styles.actionBtn}
              loading={weighMut.isPending}
              disabled={weighMut.isPending || !(parseFloat(weightInput) > 0)}
              onPress={() => {
                if (!weighSack) return;
                weighMut.mutate({ sackId: weighSack.id, kg: parseFloat(weightInput) });
              }}
            >
              Kapat (Sevk Et)
            </Button>
          </View>
        </Surface>
      </RNModal>

      {/* Çuval iptal — yıkıcı işlem onayı: serbest bırakılacak topları somut listele */}
      <RNModal
        isVisible={cancelTarget !== null}
        onBackdropPress={() => setCancelTarget(null)}
        style={styles.modal}
      >
        <Surface style={styles.sheet} elevation={4}>
          <Text variant="titleMedium" style={styles.sheetTitle}>
            Çuvalı İptal Et — {cancelTarget?.sackNo}
          </Text>
          {cancelPreviewQuery.isLoading || !cancelPreview ? (
            <ActivityIndicator style={{ marginVertical: 16 }} />
          ) : !cancelPreview.canCancel ? (
            <Text style={styles.cancelWarn}>{cancelPreview.reason}</Text>
          ) : (
            <>
              <Text style={styles.customer}>
                {cancelPreview.customerName}
                {cancelPreview.branchName ? ` · ${cancelPreview.branchName}` : ''}
              </Text>
              {cancelPreview.rolls.length + cancelPreview.swatches.length === 0 ? (
                <Text style={styles.emptySub}>Çuval boş — doğrudan iptal edilecek.</Text>
              ) : (
                <>
                  <Text style={styles.cancelInfo}>
                    Şu {cancelPreview.rolls.length} top
                    {cancelPreview.swatches.length > 0
                      ? ` ve ${cancelPreview.swatches.length} kartela`
                      : ''}{' '}
                    serbest bırakılacak (sevke hazır havuza döner):
                  </Text>
                  <ScrollView style={{ maxHeight: 240 }}>
                    {cancelPreview.rolls.map((r) => (
                      <View key={r.id} style={styles.cancelRow}>
                        <Text style={styles.cancelBarcode}>{r.barcode ?? '—'}</Text>
                        <Text style={styles.cancelMeta}>
                          {Math.round(r.currentQty)}m
                          {r.orderNumber ? ` · ${r.orderNumber}` : ''}
                        </Text>
                      </View>
                    ))}
                    {cancelPreview.swatches.map((s) => (
                      <View key={s.id} style={styles.cancelRow}>
                        <Text style={styles.cancelBarcode}>{s.barcode ?? '—'}</Text>
                        <Text style={styles.cancelMeta}>kartela</Text>
                      </View>
                    ))}
                  </ScrollView>
                </>
              )}
            </>
          )}
          <View style={styles.actions}>
            <Button onPress={() => setCancelTarget(null)} style={styles.actionBtn}>
              Vazgeç
            </Button>
            <Button
              mode="contained"
              icon="close-circle"
              buttonColor="#dc2626"
              style={styles.actionBtn}
              loading={cancelMut.isPending}
              disabled={cancelMut.isPending || !cancelPreview?.canCancel}
              onPress={() => {
                if (cancelTarget) cancelMut.mutate(cancelTarget.id);
              }}
            >
              İptal Et
            </Button>
          </View>
        </Surface>
      </RNModal>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollContent: { padding: 12, paddingBottom: 32 },
  bridge: { borderRadius: 10, backgroundColor: '#1e40af', marginBottom: 10 },
  bridgeInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  bridgeText: { color: '#fff', fontWeight: '600' },
  bridgeCta: { color: '#bfdbfe', fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  flexBtn: { flex: 1, borderRadius: 10 },
  quickScanContent: { height: 52 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  heading: { fontWeight: '700', color: '#0f172a' },
  list: { gap: 10 },
  card: { borderRadius: 12, padding: 12, backgroundColor: '#fff' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  cancelIcon: { margin: 0 },
  sackNo: { fontSize: 15, fontWeight: '700', color: '#0f172a', fontFamily: 'monospace' },
  sackMeta: { fontSize: 12, color: '#64748b' },
  cancelInfo: { fontSize: 13, color: '#475569', marginTop: 8, marginBottom: 4 },
  cancelWarn: { fontSize: 13, color: '#b45309', marginVertical: 12 },
  cancelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  cancelBarcode: { fontSize: 13, color: '#0f172a', fontFamily: 'monospace' },
  cancelMeta: { fontSize: 12, color: '#64748b' },
  customer: { fontSize: 13, color: '#334155', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8 },
  actionBtn: { flex: 1 },
  empty: { alignItems: 'center', marginTop: 48, gap: 4 },
  emptyText: { fontSize: 15, fontWeight: '600', color: '#475569' },
  emptySub: { fontSize: 13, color: '#94a3b8' },
  modal: { justifyContent: 'center', margin: 16 },
  sheet: { borderRadius: 16, padding: 16, backgroundColor: '#fff' },
  sheetTitle: { fontWeight: '700', marginBottom: 8, color: '#0f172a' },
  custRow: { paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8 },
  custName: { fontSize: 15, color: '#0f172a' },
  custCode: { fontSize: 12, color: '#94a3b8' },
});
