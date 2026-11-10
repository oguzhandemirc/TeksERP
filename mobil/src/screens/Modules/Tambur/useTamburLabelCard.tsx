// "Etikette" kartının ekran bağlayıcısı (2026-11-10) — açık kumaş ve Top Kesme akışı aynı hook'u kullanır.
// Kart değerleri `labelCard.ts`ten, kg kaynağı `finalLabel.kgSource`tan, Tart `readScaleOnce`tan; alıcı seçici yalnız emanette.
import React, { useState } from 'react';
import Toast from 'react-native-toast-message';
import { useMachinePeripherals, primaryScaleFor } from '../../../hooks/useMachinePeripherals';
import { readScaleOnce } from '../../../services/hal/readScale';
import { consigneeChoiceText } from './consignee';
import { kgFieldVisible, labelCardRows, widthFieldVisible } from './labelCard';
import TamburConsigneePicker from './TamburConsigneePicker';
import type { TamburLabelCardProps } from './TamburFinalLabelStrip';
import type { TamburFinalLabelState } from './useTamburFinalLabel';

export interface LabelCardInput {
  final: TamburFinalLabelState;
  summaryText: string;
  onOpenInfo: () => void;
  defaults: { itemName: string | null; colorName: string | null };
  qualityName: string | null;
  meters: string | null;
  /** Atadan miras en (cm) — en kutusunun silik ipucu. */
  inheritedWidthCm: number | null;
  /** Kendi topta Kime? müşterisinin adı (etiketin müşteri satırı). */
  targetCustomerName: string | null;
}

const fmt = (n: number) => String(n).replace('.', ',');

export function useTamburLabelCard(i: LabelCardInput): { card: TamburLabelCardProps; overlay: React.ReactNode } {
  const { final } = i;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tartBusy, setTartBusy] = useState(false);
  const scales = useMachinePeripherals('SCALE');
  const scale = primaryScaleFor(scales);
  const fields = final.preview?.fields ?? null;
  const owner = final.owner;
  const kgVisible = kgFieldVisible(fields, final.settings.weighRequired);
  const tart = async () => {
    setTartBusy(true);
    try {
      const read = await readScaleOnce(scale, {
        onPairing: (m) => Toast.show({ type: 'info', text1: m.title, text2: m.detail, visibilityTime: 8000 }),
      });
      if (!read.ok) {
        Toast.show({ type: 'error', text1: read.error.title, text2: read.error.detail, visibilityTime: 6000 });
        return;
      }
      if (read.notice) Toast.show({ type: 'info', text1: read.notice.title, text2: read.notice.detail, visibilityTime: 6000 });
      final.stampKg({ kg: read.kg, source: read.source });
    } finally {
      setTartBusy(false);
    }
  };
  const rows = fields
    ? labelCardRows(fields, {
        itemName: final.texts.itemName.trim() || i.defaults.itemName,
        colorName: final.texts.colorName.trim() || i.defaults.colorName,
        batchNo: final.batch.enabled ? final.batch.value.trim() || (final.settings.deliveryNoteBatchNo ?? null) : null,
        consigneeName: final.texts.consigneeName,
        qualityName: i.qualityName,
        meters: i.meters,
        kg: final.kgText.trim() || null,
        widthCm: final.widthText.trim() || (i.inheritedWidthCm != null ? fmt(i.inheritedWidthCm) : null),
        customerName: owner?.name ?? i.targetCustomerName,
      })
    : null;
  const card: TamburLabelCardProps = {
    consignee: owner ? { text: consigneeChoiceText(owner.name, final.texts.consigneeName), onPress: () => setPickerOpen(true) } : null,
    templateName: final.preview?.templateName ?? null,
    rows,
    summaryText: i.summaryText,
    onPress: i.onOpenInfo,
    kg: {
      visible: kgVisible,
      required: final.settings.weighRequired,
      text: final.kgText,
      onChange: final.setKgText,
      onTart: scale ? () => void tart() : undefined,
      tartBusy,
    },
    width: {
      visible: widthFieldVisible(fields),
      text: final.widthText,
      onChange: final.setWidthText,
      placeholder: i.inheritedWidthCm != null ? `En ${fmt(i.inheritedWidthCm)}` : 'En (cm)',
    },
  };
  const overlay = owner ? (
    <TamburConsigneePicker
      visible={pickerOpen}
      owner={owner}
      selectedId={final.texts.consigneeId}
      onSelect={(c) => {
        final.texts.setConsignee(c);
        setPickerOpen(false);
      }}
      onDismiss={() => setPickerOpen(false)}
    />
  ) : null;
  return { card, overlay };
}
