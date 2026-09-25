import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, IconButton, Text, TextInput } from 'react-native-paper';
import { useMutation } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';

import ModuleSheet, { sheet } from '../../../components/ModuleSheet';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import ScannerRollStrip from '../../../components/ScannerRollStrip';
import RollPickerModal from '../../../components/RollPickerModal';
import { workOrderBatchService } from '../../../services/workOrderBatch.service';
import { generateClientUuid } from '../../../offline/barcode';
import { addBatchPreview, serverRejects, slotAfterFailure, tokenFor, totalQty, type TokenSlot } from './addBatch';
import { useAddBatchRolls } from './useAddBatchRolls';
import { errorText, Footer, useAfterSave, type FixWo } from './fixSheetParts';

type Props = { wo: FixWo; onDismiss: () => void; onDone: () => void };

/**
 * Parti Ekle (hareket defteri D8, tasarım §6.5) — okutulan stok topları bu iş emrinde YENİ parti
 * olur ve rotanın ilk adımından başlar. Kabul kuralı Hızlı İş Emri'yle aynı; son söz sunucuda.
 */
export default function WorkOrderAddBatchSheet({ wo, onDismiss, onDone }: Props) {
  const lockedItemId = wo.targetItemId ?? null;
  const { rolls, take, onScan, remove, feedback } = useAddBatchRolls(lockedItemId);
  const [reason, setReason] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [rejected, setRejected] = useState<{ barcode: string; reason: string }[]>([]);
  const slot = useRef<TokenSlot | null>(null);
  const after = useAfterSave(wo.id, onDone);
  const firstStep = [...(wo.steps ?? [])].sort((a, b) => a.stepSequence - b.stepSequence)[0];
  const itemFilter: Record<string, string> = lockedItemId ? { itemId: lockedItemId } : {};

  const save = useMutation({
    mutationFn: () => {
      const barcodes = rolls.map((r) => r.barcode);
      slot.current = tokenFor(slot.current, barcodes, generateClientUuid);
      const text = reason.trim();
      return workOrderBatchService.addBatch(wo.id, { clientToken: slot.current.token, rollBarcodes: barcodes, ...(text ? { reason: text } : {}) });
    },
    onSuccess: (res) => {
      slot.current = null;
      after(res.message ?? 'Parti eklendi', res.data?.warnings ?? []);
    },
    onError: (err) => {
      slot.current = slotAfterFailure(slot.current, err);
      setRejected(serverRejects(err));
      Toast.show({ type: 'error', text1: 'Parti eklenemedi', text2: errorText(err), visibilityTime: 6000 });
    },
  });

  const overlays = (
    <>
      <BarcodeScannerModal
        visible={scannerOpen} onDismiss={() => setScannerOpen(false)} onScan={(b) => void onScan(b)}
        title="Stok Topu Okut" continuous trigger="tap" captureHaptic={false} barcodeTypes={['qr', 'code128']} flash={feedback.flash}
        footer={<ScannerRollStrip rolls={rolls} totalQty={totalQty(rolls)} onRemove={remove} rejects={feedback.rejects} onDismissReject={feedback.dismissReject} duplicateBarcode={feedback.duplicateBarcode} />}
      />
      <RollPickerModal
        visible={pickerOpen} onDismiss={() => setPickerOpen(false)} multiSelect confirmLabel="Ekle"
        onConfirm={(picked) => { take(picked); setPickerOpen(false); }}
        filters={{ rollScope: 'RAW_STOCK', rollKind: 'WOUND_ROLL', ...itemFilter }}
        scopeTabs={[
          { key: 'raw', label: 'Ham Stok', filters: { rollScope: 'RAW_STOCK', rollKind: 'WOUND_ROLL', ...itemFilter } },
          { key: 'finished', label: 'Bitmiş Depo', filters: { status: 'WAREHOUSE,A1_STOCK', shipmentScope: 'free', rollKind: 'WOUND_ROLL', ...itemFilter } },
        ]}
        excludeIds={rolls.map((r) => r.id)} title="Top Seç" subtitle={wo.targetItem?.name ?? 'Ham stok veya bitmiş depo'} emptyText="Bu kapsamda uygun top yok"
      />
    </>
  );
  return (
    <ModuleSheet
      visible onDismiss={onDismiss} title="Parti Ekle" subtitle={`${wo.workOrderNumber} · okutulan toplar YENİ parti olur, ilk adımdan başlar`}
      footer={<Footer onCancel={onDismiss} onSave={() => save.mutate()} busy={save.isPending} disabled={rolls.length === 0} label={`Parti Ekle (${rolls.length})`} />}
      overlays={overlays}
    >
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button mode="contained-tonal" icon="barcode-scan" onPress={() => setScannerOpen(true)}>Top Okut</Button>
        <Button mode="outlined" icon="format-list-checkbox" onPress={() => setPickerOpen(true)}>Listeden Seç</Button>
      </View>
      {rolls.length === 0 ? <Text style={sheet.hint}>Henüz top yok — okutun ya da listeden seçin.</Text> : null}
      {rolls.map((r) => (
        <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={[sheet.line, { flex: 1 }]}>{`${r.barcode} · ${Math.round(r.qty)} m`}</Text>
          <IconButton icon="close" size={18} onPress={() => remove(r.barcode)} accessibilityLabel={`${r.barcode} çıkar`} />
        </View>
      ))}
      {rolls.length > 0 ? <View style={sheet.box}><Text style={sheet.line}>{addBatchPreview(rolls, firstStep?.station?.name ?? null)}</Text></View> : null}
      {rejected.map((r) => <Text key={r.barcode} style={sheet.error}>{`${r.barcode} — ${r.reason}`}</Text>)}
      <Text style={sheet.label}>Sebep (isteğe bağlı)</Text>
      <TextInput mode="outlined" value={reason} onChangeText={setReason} style={sheet.input} maxLength={300} placeholder="ör. ek sipariş, eksik kalan metraj" />
    </ModuleSheet>
  );
}
