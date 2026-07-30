import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import {
  Text,
  TextInput,
  Button,
  Divider,
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
import { packingService, SHIPMENT_STATUS_TR, type LocatedRoll } from '../../../services/packing.service';
import { rollService } from '../../../services/roll.service';
import { colorService } from '../../../services/color.service';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import SackNoteSheet from './SackNoteSheet';
import SackManualWeightSheet from './SackManualWeightSheet';
import { useSackWeigh } from '../../../hooks/useSackWeigh';
import { LabelPrinter } from '../../../components/LabelPrinter';
import type { Roll } from '../../../types/models';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import { useDeviceType } from '../../../hooks/useDeviceType';

// =============================================================================
// Çuval Düzeltme (saha #3) — top okutarak yerini bul, HAVUZ çuvalında düzelt:
//   • Çuvaldan Çıkar (depoya döner)   • Başka Çuvala Taşı (hedef çuvaldan top okut)
//   • Çuvalı Tart                     • Etiket Değiştir (renk/en/kalite + yeniden bas)
// Yalnız havuzdaki (sevkiyata girmemiş) çuvallar düzenlenebilir — sevkiyattaki
// çuval → backend reddeder, net mesaj döner. Online-only (düzeltme akışı).
// =============================================================================

const sackLabel = (sack: { sackNo: string }) => sack.sackNo;

export default function CuvalDuzeltScreen() {
  const { height: winH } = useWindowDimensions();
  usePortraitLock(useDeviceType() === 'phone');
  const qc = useQueryClient();

  const [barcode, setBarcode] = useState('');
  const [roll, setRoll] = useState<LocatedRoll | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  // Taşıma: hedef çuvaldan bir top okutma modu.
  const [moveScanOpen, setMoveScanOpen] = useState(false);
  const [manualWeighTarget, setManualWeighTarget] = useState<{
    id: string;
    label: string;
    weightKg: number | null;
  } | null>(null);
  const [noteTarget, setNoteTarget] = useState<{ id: string; label: string; notes: string | null } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; desc: string; run: () => void } | null>(null);
  // Saha #4: etiket değiştirme
  const [relabelOpen, setRelabelOpen] = useState(false);
  const [colorPickOpen, setColorPickOpen] = useState(false);
  const [rlColorId, setRlColorId] = useState<string | null>(null);
  const [rlColorName, setRlColorName] = useState<string>('');
  const [rlWidth, setRlWidth] = useState('');
  const [rlQuality, setRlQuality] = useState('');
  const [reprintRoll, setReprintRoll] = useState<Roll | null>(null);

  const locate = useMutation({
    mutationFn: (code: string) => packingService.locateRoll(code),
    onSuccess: (res) => setRoll(res.data ?? null),
    onError: () => setRoll(null),
  });

  const relocate = () => {
    if (roll) locate.mutate(roll.barcode);
  };
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['pool-sacks'] });
    void qc.invalidateQueries({ queryKey: ['pool'] });
    void qc.invalidateQueries({ queryKey: ['sack-store'] });
    void qc.invalidateQueries({ queryKey: ['rolls'] });
  };

  // Havuz çuvalı düzenlenebilir mi: bir çuvalda + sevkiyata bağlı DEĞİL.
  const editable = !!roll?.sack && !roll.shipment;

  const removeMut = useMutation({
    mutationFn: () => packingService.removeRollFromSack(roll!.id),
    onSuccess: (res) => {
      Toast.show({ type: 'success', text1: res.message ?? 'Top çuvaldan çıkarıldı' });
      invalidate();
      relocate();
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Çıkarılamadı', text2: e.message }),
  });

  const moveMut = useMutation({
    mutationFn: (sackId: string) => packingService.moveRollToSack(roll!.id, sackId),
    onSuccess: (res) => {
      Toast.show({ type: 'success', text1: res.message ?? 'Top taşındı' });
      invalidate();
      relocate();
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Taşınamadı', text2: e.message }),
  });

  // İçerik düzeltmesi tartıyı sıfırlar — yeniden tartı aynı ekrandan.
  // Tartı: TEK DOKUNUŞ (kantardan oku → doğrudan kaydet). Elle giriş ayrı sheet'te.
  // Paketleme ekranıyla AYNI hook → iki ekran arasında davranış ayrışmaz.
  const sackWeigh = useSackWeigh(() => {
    invalidate();
    relocate();
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
      if (roll) setReprintRoll({ id: roll.id, barcode: roll.barcode } as Roll);
      relocate();
    },
    onError: (e: Error) => Toast.show({ type: 'error', text1: 'Güncellenemedi', text2: e.message }),
  });

  // Taşıma: hedef çuvaldaki bir topu okut → o topun çuvalına taşı.
  const handleMoveScan = (code: string) => {
    setMoveScanOpen(false);
    const trimmed = code.trim();
    if (!trimmed || !roll) return;
    if (trimmed === roll.barcode) {
      Toast.show({ type: 'error', text1: 'Aynı topu okuttun', text2: 'Hedef çuvaldaki BAŞKA bir topu okut.' });
      return;
    }
    packingService
      .locateRoll(trimmed)
      .then((res) => {
        const other = res.data;
        if (!other?.sack) {
          Toast.show({ type: 'error', text1: 'Taşınamaz', text2: 'Okutulan top bir çuvalda değil.' });
          return;
        }
        if (other.sack.id === roll.sack?.id) {
          Toast.show({ type: 'info', text1: 'Top zaten bu çuvalda' });
          return;
        }
        setConfirm({
          title: 'Top taşınsın mı?',
          desc: `${roll.barcode} → ${sackLabel(other.sack)} çuvalı.`,
          run: () => moveMut.mutate(other.sack!.id),
        });
      })
      .catch(() => {
        /* toast apiClient interceptor'dan gelir */
      });
  };

  return (
    <ScreenChrome title="Çuval Düzeltme" subtitle="Top okut → çıkar / taşı">
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
              <Chip compact>{roll.status}</Chip>
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
                  {sackLabel(roll.sack)}
                  {roll.sack.weightKg != null ? ` · ${roll.sack.weightKg} kg` : ''}
                </Text>
                <Text variant="bodyMedium" style={styles.dim}>
                  {roll.shipment.shipmentNo} ({SHIPMENT_STATUS_TR[roll.shipment.status]}) ·{' '}
                  {roll.shipment.customer.name}
                  {roll.shipment.branch ? ` / ${roll.shipment.branch.name}` : ''}
                </Text>
                <Text style={styles.warn}>Sevkiyattaki çuval — düzeltme Sevk Çıkışı’ndan yapılır.</Text>
              </>
            ) : roll.sack ? (
              <>
                <Text variant="bodyLarge" style={styles.loc}>
                  {sackLabel(roll.sack)} (havuz çuvalı)
                  {roll.sack.weightKg != null ? ` · ${roll.sack.weightKg} kg` : ''}
                </Text>
                {roll.sack.weightKg == null && (
                  <Text style={styles.warn}>Çuval tartısız — sevk edilmeden önce tartılmalı.</Text>
                )}
              </>
            ) : (
              <Text variant="bodyLarge" style={styles.loc}>
                Bir çuvalda değil ({roll.status})
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
                      desc: `${roll.barcode} çuvaldan çıkar, serbest depoya döner.`,
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
                  onPress={() => setMoveScanOpen(true)}
                  style={styles.actionBtn}
                >
                  Başka Çuvala Taşı
                </Button>
                {/* TEK DOKUNUŞ tartı — Paketleme ekranıyla parite: kantardan oku →
                    doğrudan kaydet. Elle giriş ayrı (yanındaki) buton. */}
                <Button
                  mode={roll.sack?.weightKg == null ? 'contained' : 'contained-tonal'}
                  icon={sackWeigh.busy ? 'progress-clock' : 'scale'}
                  disabled={sackWeigh.busy}
                  onPress={() =>
                    roll.sack && void sackWeigh.weigh({ id: roll.sack.id, label: sackLabel(roll.sack) })
                  }
                  style={styles.actionBtn}
                >
                  {sackWeigh.busy ? 'Tartılıyor…' : 'Çuvalı Tart'}
                </Button>
                <Button
                  mode="contained-tonal"
                  icon="keyboard-outline"
                  onPress={() =>
                    roll.sack &&
                    setManualWeighTarget({
                      id: roll.sack.id,
                      label: sackLabel(roll.sack),
                      weightKg: roll.sack.weightKg,
                    })
                  }
                  style={styles.actionBtn}
                >
                  Elle kg
                </Button>
                {/* Yorum — Paketleme ekranıyla parite (asimetri olmasın). Sevkiyattaki
                    çuvalda da çalışır: backend yorumda touchWarehouseSackTx guard'ı uygulamaz. */}
                <Button
                  mode="contained-tonal"
                  icon="comment-text-outline"
                  onPress={() =>
                    roll.sack &&
                    setNoteTarget({ id: roll.sack.id, label: sackLabel(roll.sack), notes: roll.sack.notes })
                  }
                  style={styles.actionBtn}
                >
                  {roll.sack?.notes ? 'Notu Düzenle' : 'Not Ekle'}
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
      {/* Taşıma için hedef çuvaldan top */}
      <BarcodeScannerModal
        visible={moveScanOpen}
        onDismiss={() => setMoveScanOpen(false)}
        onScan={handleMoveScan}
        title="Hedef Çuvaldaki Bir Topu Okut"
      />

      {/* Elle kg — kantar okunamadığında; Paketleme ekranıyla AYNI sheet. */}
      <SackManualWeightSheet
        target={manualWeighTarget}
        onDismiss={() => setManualWeighTarget(null)}
        onSave={(kg) =>
          manualWeighTarget
            ? sackWeigh.saveManual({ id: manualWeighTarget.id, label: manualWeighTarget.label }, kg)
            : Promise.resolve(false)
        }
      />

      {/* Saha #4: etiket değiştir (renk / en / kalite)
          position="bottom": AppModal alttan sheet'i TAM klavye yüksekliği kadar
          yukarı kaldırır → "Kalite" (tam QWERTY) input'u + Kaydet butonu yatay
          tablette de klavye üstünde kalır. Alanlar maxHeight'li ScrollView'da,
          Kaydet ScrollView DIŞINDA sabit footer (aşırı kısa ekranda erişilir). */}
      <AppModal visible={relabelOpen} onDismiss={() => setRelabelOpen(false)} position="bottom">
        <View style={styles.sheet}>
          <Text variant="titleMedium" style={styles.sheetTitle}>
            Etiket Değiştir — {roll?.barcode}
          </Text>
          <ScrollView
            style={{ maxHeight: winH * 0.5, flexGrow: 0 }}
            keyboardShouldPersistTaps="handled"
          >
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
          </ScrollView>
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

      {/* Yeniden etiket baskısı (relabel sonrası). onDone guard'ı: baskı
          uçuştayken başka top seçildiyse yeni slot ezilmesin (işi kuyrukta). */}
      <LabelPrinter
        roll={reprintRoll}
        kind="ROLL_FINISHED"
        labelContext={{ stock: true }}
        onDone={(printed) =>
          setReprintRoll((cur) => (cur?.id === printed.id ? null : cur))
        }
      />

      <SackNoteSheet
        target={noteTarget}
        onDismiss={() => setNoteTarget(null)}
        // Kayıt sonrası topu yeniden konumlandır → roll.sack.notes tazelenir.
        onSaved={() => {
          if (roll) locate.mutate(roll.barcode);
        }}
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
