import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import {
  Text,
  TextInput,
  Button,
  Divider,
  List,
  Chip,
  ActivityIndicator,
  TouchableRipple,
} from 'react-native-paper';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import ScreenChrome from '../../../components/ScreenChrome';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import AppModal from '../../../components/AppModal';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { packingService, type LocatedRoll } from '../../../services/packing.service';
import { rollService } from '../../../services/roll.service';
import { colorService } from '../../../services/color.service';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import { LabelPrinter } from '../../../components/LabelPrinter';
import type { Roll } from '../../../types/models';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import { useDeviceType } from '../../../hooks/useDeviceType';

// =============================================================================
// Çuval Düzeltme (saha #3) — sevk edilmemiş çuvallardan top okutarak:
//   • Çuvaldan Çıkar (depoya döner)  • Başka Çuvala Taşı  • İki Topu Takasla
// READY/AT_DOOR'da da çalışır: backend tartıyı sıfırlar + karşılanmayı yeniden
// yazar — operatöre uyarıda söylenir. Online-only (düzeltme akışı).
// =============================================================================

const STATUS_LABEL: Record<string, string> = {
  PREPARING: 'Hazırlanıyor',
  READY: 'Çuval Depo',
  AT_DOOR: 'Kapı Önü',
  DISPATCHED: 'Sevk Edildi',
};

const EDITABLE = new Set(['PREPARING', 'READY', 'AT_DOOR']);

export default function CuvalDuzeltScreen() {
  usePortraitLock(useDeviceType() === 'phone');
  const qc = useQueryClient();

  const [barcode, setBarcode] = useState('');
  const [roll, setRoll] = useState<LocatedRoll | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  // Takas: 2. top okutma modunda mıyız?
  const [swapScanOpen, setSwapScanOpen] = useState(false);
  const [movePickOpen, setMovePickOpen] = useState(false);
  const [weighOpen, setWeighOpen] = useState(false);
  const [weighKg, setWeighKg] = useState('');
  const [confirm, setConfirm] = useState<{ title: string; desc: string; run: () => void } | null>(null);
  // Saha #4: etiket değiştirme
  const [relabelOpen, setRelabelOpen] = useState(false);
  const [colorPickOpen, setColorPickOpen] = useState(false);
  const [rlColorId, setRlColorId] = useState<string | null>(null);
  const [rlColorName, setRlColorName] = useState<string>('');
  const [rlWidth, setRlWidth] = useState('');
  const [rlQuality, setRlQuality] = useState('');
  const [reprintRoll, setReprintRoll] = useState<Roll | null>(null);

  const committed = roll?.shipment && roll.shipment.status !== 'PREPARING';
  const committedWarn = committed
    ? ' Sevkiyat çuval depoda/kapı önünde: etkilenen çuvalların tartısı sıfırlanır (yeniden tartı gerekir) ve karşılanma güncellenir.'
    : '';

  const locate = useMutation({
    mutationFn: (code: string) => packingService.locateRoll(code),
    onSuccess: (res) => setRoll(res.data ?? null),
    onError: () => setRoll(null),
  });

  const relocate = () => {
    if (roll) locate.mutate(roll.barcode);
  };
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['shipment'] });
    void qc.invalidateQueries({ queryKey: ['sack-store'] });
    void qc.invalidateQueries({ queryKey: ['rolls'] });
  };

  const removeMut = useMutation({
    mutationFn: () => packingService.removeRoll(roll!.shipment!.id, roll!.id),
    onSuccess: (res) => {
      Toast.show({ type: 'success', text1: res.message ?? 'Top çuvaldan çıkarıldı' });
      invalidate();
      relocate();
    },
  });

  const moveMut = useMutation({
    mutationFn: (sackId: string) => packingService.moveRollToSack(roll!.id, sackId),
    onSuccess: (res) => {
      Toast.show({ type: 'success', text1: res.message ?? 'Top taşındı' });
      setMovePickOpen(false);
      invalidate();
      relocate();
    },
  });

  const swapMut = useMutation({
    mutationFn: (otherRollId: string) => packingService.swapRollSacks(roll!.id, otherRollId),
    onSuccess: (res) => {
      Toast.show({ type: 'success', text1: res.message ?? 'Takas yapıldı' });
      invalidate();
      relocate();
    },
  });

  // İçerik düzeltmesi tartıyı sıfırlar — yeniden tartı aynı ekrandan girilir
  // (READY'de de çalışır; unready'siz akış kapanır).
  const weighMut = useMutation({
    mutationFn: (kg: number) => packingService.weighSack(roll!.sack!.id, kg),
    onSuccess: () => {
      Toast.show({ type: 'success', text1: 'Çuval tartısı kaydedildi' });
      setWeighOpen(false);
      setWeighKg('');
      invalidate();
      relocate();
    },
  });

  // Saha #4: etiket (renk/en/kalite) değiştir — başarınca yeniden etiket bas.
  const colorsQ = useQuery({
    queryKey: ['colors', 'relabel-picker'],
    queryFn: () => colorService.listPublicForPicker({ page: 1, pageSize: 300, sortBy: 'name', sortOrder: 'asc' }),
    enabled: colorPickOpen,
  });
  const colorOptions: PickerOption[] = (colorsQ.data?.data ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }));
  const openRelabel = () => {
    if (!roll) return;
    setRlColorId(roll.color?.id ?? null);
    setRlColorName(roll.color?.name ?? '');
    setRlWidth(roll.width != null ? String(roll.width) : '');
    setRlQuality(roll.qualityGrade ?? '');
    setRelabelOpen(true);
  };
  const relabelMut = useMutation({
    mutationFn: () =>
      rollService.relabel(roll!.id, {
        colorId: rlColorId,
        width: rlWidth.trim() ? parseFloat(rlWidth.replace(',', '.')) : null,
        qualityGrade: rlQuality.trim() || undefined,
      }),
    onSuccess: () => {
      Toast.show({ type: 'success', text1: 'Etiket güncellendi', text2: 'Yeni etiket basılıyor…' });
      setRelabelOpen(false);
      invalidate();
      // Yeniden bas — LabelPrinter roll objesi ister; minimal roll ile tetikle.
      if (roll) setReprintRoll({ id: roll.id, barcode: roll.barcode } as Roll);
      relocate();
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Güncellenemedi', text2: e.message }),
  });

  // Taşıma hedefi: aynı sevkiyatın diğer çuvalları (detaydan lazy).
  const shipmentQ = useQuery({
    queryKey: ['shipment', roll?.shipment?.id, 'cuval-duzelt'],
    queryFn: () => packingService.getShipment(roll!.shipment!.id),
    enabled: movePickOpen && !!roll?.shipment?.id,
    staleTime: 10_000,
  });
  const targetSacks = (shipmentQ.data?.data.sacks ?? []).filter((s) => s.id !== roll?.sack?.id);

  const handleSwapScan = (code: string) => {
    setSwapScanOpen(false);
    const trimmed = code.trim();
    if (!trimmed || !roll) return;
    if (trimmed === roll.barcode) {
      Toast.show({ type: 'error', text1: 'Aynı top kendisiyle takas edilemez' });
      return;
    }
    // 2. topu önce bul — aynı sevkiyatta + çuvalda mı kontrolünü backend de yapar,
    // ama kullanıcıya net mesaj için burada da locate edip doğruluyoruz.
    packingService
      .locateRoll(trimmed)
      .then((res) => {
        const other = res.data;
        if (!other?.sack || other.shipment?.id !== roll.shipment?.id) {
          Toast.show({
            type: 'error',
            text1: 'Takas yapılamaz',
            text2: 'İkinci top aynı sevkiyatın bir çuvalında değil',
          });
          return;
        }
        setConfirm({
          title: 'İki top takaslansın mı?',
          desc:
            `${roll.barcode} (Çuval ${roll.sack?.seq}) ↔ ${other.barcode} (Çuval ${other.sack.seq}).` +
            committedWarn,
          run: () => swapMut.mutate(other.id),
        });
      })
      .catch(() => {
        /* toast apiClient interceptor'dan gelir */
      });
  };

  const editable = roll?.shipment && EDITABLE.has(roll.shipment.status) && !!roll.sack;

  return (
    <ScreenChrome title="Çuval Düzeltme" subtitle="Top okut → çıkar / taşı / takasla">
      <ScrollView contentContainerStyle={styles.body}>
        {/* Barkod girişi */}
        <View style={styles.scanRow}>
          <TextInput
            mode="outlined"
            label="Top barkodu"
            value={barcode}
            onChangeText={setBarcode}
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.input}
            onSubmitEditing={() => barcode.trim() && locate.mutate(barcode.trim())}
            right={<TextInput.Icon icon="magnify" onPress={() => barcode.trim() && locate.mutate(barcode.trim())} />}
          />
          <Button mode="contained" icon="barcode-scan" onPress={() => setScanOpen(true)} style={styles.scanBtn}>
            Okut
          </Button>
        </View>

        {locate.isPending && <ActivityIndicator style={{ marginTop: 24 }} />}

        {roll && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text variant="titleMedium" style={styles.mono}>
                {roll.barcode}
              </Text>
              <Chip compact>{STATUS_LABEL[roll.status] ?? roll.status}</Chip>
            </View>
            <Text variant="bodyMedium" style={styles.dim}>
              {roll.item.name} · {roll.color?.name ?? 'Ham'}
              {roll.width ? ` · ${roll.width} cm` : ''} · {roll.currentQty} m · {roll.qualityGrade}
            </Text>
            <Divider style={styles.div} />
            <Text variant="titleSmall">Yeri</Text>
            {roll.sack && roll.shipment ? (
              <>
                <Text variant="bodyLarge" style={styles.loc}>
                  Çuval {roll.sack.seq}
                  {roll.sack.manualCode ? ` · ${roll.sack.manualCode}` : ''}
                  {roll.sack.weightKg != null ? ` · ${roll.sack.weightKg} kg` : ''}
                </Text>
                {roll.sack.weightKg == null && (
                  <Text style={styles.warn}>Çuval tartısız — sevkten önce yeniden tartılmalı.</Text>
                )}
                <Text variant="bodyMedium" style={styles.dim}>
                  {roll.shipment.shipmentNo} ({STATUS_LABEL[roll.shipment.status]}) ·{' '}
                  {roll.shipment.customer.name}
                  {roll.shipment.branch ? ` / ${roll.shipment.branch.name}` : ''}
                </Text>
              </>
            ) : roll.shipment ? (
              <Text variant="bodyLarge" style={styles.loc}>
                Sevkiyatta (çuvalsız) — {roll.shipment.shipmentNo}
              </Text>
            ) : (
              <Text variant="bodyLarge" style={styles.loc}>
                Bir çuvalda değil ({STATUS_LABEL[roll.status] ?? roll.status})
              </Text>
            )}

            {roll.shipment?.status === 'DISPATCHED' && (
              <Text style={styles.warn}>Sevk edilmiş — düzeltme yapılamaz.</Text>
            )}

            {editable && (
              <View style={styles.actions}>
                <Button
                  mode="contained-tonal"
                  icon="package-down"
                  disabled={removeMut.isPending}
                  onPress={() =>
                    setConfirm({
                      title: 'Top çuvaldan çıkarılsın mı?',
                      desc: `${roll.barcode} sevkiyattan çıkar, serbest depoya döner.${committedWarn}`,
                      run: () => removeMut.mutate(),
                    })
                  }
                  style={styles.actionBtn}
                >
                  Çuvaldan Çıkar
                </Button>
                <Button
                  mode="contained-tonal"
                  icon="swap-horizontal"
                  disabled={moveMut.isPending}
                  onPress={() => setMovePickOpen(true)}
                  style={styles.actionBtn}
                >
                  Başka Çuvala Taşı
                </Button>
                <Button
                  mode="contained-tonal"
                  icon="swap-vertical"
                  disabled={swapMut.isPending}
                  onPress={() => setSwapScanOpen(true)}
                  style={styles.actionBtn}
                >
                  İki Topu Takasla
                </Button>
                <Button
                  mode={roll.sack?.weightKg == null ? 'contained' : 'contained-tonal'}
                  icon="scale"
                  disabled={weighMut.isPending}
                  onPress={() => setWeighOpen(true)}
                  style={styles.actionBtn}
                >
                  Çuvalı Tart
                </Button>
                {/* Saha #4: etiket değiştir (renk/en/kalite) + yeniden bas */}
                <Button
                  mode="contained-tonal"
                  icon="tag-edit"
                  disabled={relabelMut.isPending}
                  onPress={openRelabel}
                  style={styles.actionBtn}
                >
                  Etiket Değiştir
                </Button>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* 1. top okutma */}
      <BarcodeScannerModal
        visible={scanOpen}
        onDismiss={() => setScanOpen(false)}
        onScan={(code) => {
          setScanOpen(false);
          setBarcode(code);
          locate.mutate(code.trim());
        }}
        title="Top Barkodu Okut"
      />
      {/* Takas için 2. top */}
      <BarcodeScannerModal
        visible={swapScanOpen}
        onDismiss={() => setSwapScanOpen(false)}
        onScan={handleSwapScan}
        title="Takas Edilecek 2. Topu Okut"
      />

      {/* Hedef çuval seçimi */}
      <AppModal visible={movePickOpen} onDismiss={() => setMovePickOpen(false)} position="bottom">
        <View style={styles.sheet}>
          <Text variant="titleMedium" style={styles.sheetTitle}>
            Hedef Çuval Seç
          </Text>
          {shipmentQ.isLoading ? (
            <ActivityIndicator style={{ marginVertical: 24 }} />
          ) : targetSacks.length === 0 ? (
            <Text style={styles.dim}>Bu sevkiyatta başka çuval yok — önce Paketleme'den çuval açın.</Text>
          ) : (
            targetSacks.map((s) => (
              <List.Item
                key={s.id}
                title={`Çuval ${s.seq}${s.manualCode ? ` · ${s.manualCode}` : ''}`}
                description={s.weightKg != null ? `${s.weightKg} kg` : 'Tartılmamış'}
                left={(p) => <List.Icon {...p} icon="sack" />}
                onPress={() =>
                  setConfirm({
                    title: `Çuval ${s.seq}'e taşınsın mı?`,
                    desc: `${roll?.barcode} → Çuval ${s.seq}.${committedWarn}`,
                    run: () => moveMut.mutate(s.id),
                  })
                }
              />
            ))
          )}
        </View>
      </AppModal>

      {/* Çuval tartısı — içerik düzeltmesi sonrası yeniden tartı */}
      <AppModal visible={weighOpen} onDismiss={() => setWeighOpen(false)} position="center">
        <View style={styles.sheet}>
          <Text variant="titleMedium" style={styles.sheetTitle}>
            Çuval {roll?.sack?.seq} — Brüt Tartı
          </Text>
          <TextInput
            mode="outlined"
            label="Kg"
            value={weighKg}
            onChangeText={setWeighKg}
            keyboardType="decimal-pad"
            autoFocus
          />
          <Button
            mode="contained"
            style={{ marginTop: 12 }}
            disabled={!(parseFloat(weighKg.replace(',', '.')) > 0) || weighMut.isPending}
            onPress={() => weighMut.mutate(parseFloat(weighKg.replace(',', '.')))}
          >
            Kaydet
          </Button>
        </View>
      </AppModal>

      {/* Saha #4: etiket değiştir (renk / en / kalite) */}
      <AppModal visible={relabelOpen} onDismiss={() => setRelabelOpen(false)} position="center">
        <View style={styles.sheet}>
          <Text variant="titleMedium" style={styles.sheetTitle}>
            Etiket Değiştir — {roll?.barcode}
          </Text>
          <TouchableRipple onPress={() => setColorPickOpen(true)} style={styles.relabelField} borderless>
            <View>
              <Text variant="labelSmall" style={styles.dim}>Renk</Text>
              <Text variant="bodyLarge">{rlColorName || 'Renksiz (ham)'}</Text>
            </View>
          </TouchableRipple>
          {rlColorId && (
            <Button compact onPress={() => { setRlColorId(null); setRlColorName(''); }}>Renksiz yap</Button>
          )}
          <TextInput
            mode="outlined"
            label="En (cm)"
            value={rlWidth}
            onChangeText={setRlWidth}
            keyboardType="decimal-pad"
            style={{ marginTop: 8 }}
          />
          <TextInput
            mode="outlined"
            label="Kalite"
            value={rlQuality}
            onChangeText={setRlQuality}
            style={{ marginTop: 8 }}
          />
          <Button
            mode="contained"
            style={{ marginTop: 12 }}
            disabled={relabelMut.isPending}
            onPress={() => relabelMut.mutate()}
          >
            Kaydet + Yeniden Bas
          </Button>
        </View>
      </AppModal>

      <PickerModal
        visible={colorPickOpen}
        title="Renk Seç"
        options={colorOptions}
        selectedValue={rlColorId}
        loading={colorsQ.isLoading}
        onSelect={(value) => {
          setRlColorId(value);
          setRlColorName(colorOptions.find((o) => o.value === value)?.label ?? '');
          setColorPickOpen(false);
        }}
        onDismiss={() => setColorPickOpen(false)}
      />

      {/* Yeniden etiket baskısı (relabel sonrası) */}
      <LabelPrinter
        roll={reprintRoll}
        kind="ROLL_FINISHED"
        labelContext={{ stock: true }}
        onDone={() => setReprintRoll(null)}
      />

      <ConfirmDialog
        kind="simple"
        visible={confirm !== null}
        title={confirm?.title ?? ''}
        description={confirm?.desc ?? ''}
        confirmLabel="Onayla"
        onConfirm={() => {
          confirm?.run();
          setConfirm(null);
        }}
        onDismiss={() => setConfirm(null)}
      />
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 48 },
  scanRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1 },
  scanBtn: { marginTop: 6 },
  card: {
    marginTop: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#999',
    padding: 16,
    gap: 4,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mono: { fontVariant: ['tabular-nums'] },
  dim: { opacity: 0.7 },
  div: { marginVertical: 10 },
  loc: { fontWeight: '600', marginTop: 2 },
  warn: { color: '#b3261e', marginTop: 10 },
  actions: { marginTop: 14, gap: 8 },
  actionBtn: { borderRadius: 8 },
  sheet: { padding: 16, paddingBottom: 32 },
  sheetTitle: { marginBottom: 8 },
  relabelField: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#999',
    borderRadius: 8,
    padding: 12,
    marginTop: 4,
  },
});
