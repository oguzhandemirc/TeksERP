import React, { useState } from 'react';
import { View } from 'react-native';
import { Checkbox, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { useMutation, useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';

import ModuleSheet, { sheet } from '../../../components/ModuleSheet';
import ColorSelectField from '../../../components/ColorSelectField';
import ReasonPresetPicker, { type ReasonPresetValue } from '../../../components/reasonPresets/ReasonPresetPicker';
import { useReasonPresets } from '../../../hooks/useReasonPresets';
import { workOrderService, type TargetColorPreview } from '../../../services/workOrder.service';
import { printTravelerCardForWorkOrder } from '../../../services/travelerCardPrint';
import { colorSaveGate, parseWidth, reasonPayload, reasonReady } from './workOrderFix';
import { errorText, Footer, useAfterSave, type FixWo } from './fixSheetParts';
import WorkOrderDetachSheet from './WorkOrderDetachSheet';

export type FixKind = 'color' | 'width' | 'reprint' | 'detach';


interface Props {
  kind: FixKind | null;
  wo: FixWo | null;
  onDismiss: () => void;
  onDone: () => void;
}

const EMPTY_REASON: ReasonPresetValue = { code: null, text: '' };

/** Rengi Değiştir — önizleme aynı kartta: engel, kısmi boya onayı, sipariş uyarıları, kart bayatlığı. */
function ColorFix({ wo, onDismiss, onDone }: { wo: FixWo; onDismiss: () => void; onDone: () => void }) {
  const [colorId, setColorId] = useState<string | null>(wo.targetColorId ?? null);
  const [reason, setReason] = useState<ReasonPresetValue>(EMPTY_REASON);
  const [confirmed, setConfirmed] = useState(false);
  const { presets } = useReasonPresets('WORK_ORDER_PLAN_CHANGE');
  const changed = colorId !== (wo.targetColorId ?? null);
  const previewQ = useQuery({
    queryKey: ['wo-color-preview', wo.id, colorId],
    queryFn: () => workOrderService.previewTargetColor(wo.id, colorId),
    enabled: changed,
  });
  const preview = changed ? previewQ.data?.data : undefined;
  const gate = colorSaveGate(preview, confirmed);
  const after = useAfterSave(wo.id, onDone);
  const save = useMutation({
    mutationFn: () => {
      const r = reasonPayload(reason, presets);
      return workOrderService.changeTargetColor(wo.id, { colorId, reason: r.reason, reasonCode: r.reasonCode, confirmPartial: gate.needsConfirm && confirmed });
    },
    onSuccess: (res) => after('Renk değiştirildi', res.data?.warnings ?? []),
    onError: (err) => Toast.show({ type: 'error', text1: 'Renk değiştirilemedi', text2: errorText(err) }),
  });
  return (
    <ModuleSheet
      visible
      onDismiss={onDismiss}
      title="Rengi Değiştir"
      subtitle={`${wo.workOrderNumber} · şu an: ${wo.targetColor?.name ?? 'Renksiz'}`}
      footer={<Footer onCancel={onDismiss} onSave={() => save.mutate()} busy={save.isPending} disabled={!changed || !gate.canSave || !reasonReady(reason, presets)} />}
    >
      <Text style={sheet.label}>Yeni renk</Text>
      <ColorSelectField value={colorId} onChange={(id) => { setColorId(id); setConfirmed(false); }} showClear />
      {changed ? <ColorPreviewBox loading={previewQ.isLoading} preview={preview} confirmed={confirmed} onConfirm={setConfirmed} /> : null}
      <Text style={sheet.label}>Sebep</Text>
      <ReasonPresetPicker kind="WORK_ORDER_PLAN_CHANGE" value={reason} onChange={setReason} />
    </ModuleSheet>
  );
}

function ColorPreviewBox({ loading, preview, confirmed, onConfirm }: {
  loading: boolean;
  preview: TargetColorPreview | undefined;
  confirmed: boolean;
  onConfirm: (v: boolean) => void;
}) {
  if (loading || !preview) return <Text style={sheet.hint}>Etkisi hesaplanıyor…</Text>;
  if (preview.blocked) return <View style={sheet.box}><Text style={sheet.error}>{preview.blocked.message}</Text></View>;
  return (
    <View style={sheet.box}>
      {preview.partial ? (
        <TouchableRipple onPress={() => onConfirm(!confirmed)} accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Checkbox.Android status={confirmed ? 'checked' : 'unchecked'} />
            <Text style={[sheet.line, { flex: 1 }]}>
              {`${preview.partial.dyedCount} top zaten boyanmış, eski renkte kalır; kalan ${preview.partial.pendingCount} top yeni renge boyanır — onaylıyorum`}
            </Text>
          </View>
        </TouchableRipple>
      ) : null}
      {preview.warnings.map((w) => <Text key={w} style={sheet.warn}>{w}</Text>)}
      {preview.cardWillBeStale ? <Text style={sheet.hint}>Refakat kartı bayatlar — kaydettikten sonra "Kartı Yeniden Bas".</Text> : null}
      {!preview.partial && preview.warnings.length === 0 && !preview.cardWillBeStale ? <Text style={sheet.hint}>Engel yok.</Text> : null}
    </View>
  );
}

/** Eni Değiştir — tek sayı + sebep. */
function WidthFix({ wo, onDismiss, onDone }: { wo: FixWo; onDismiss: () => void; onDone: () => void }) {
  const [raw, setRaw] = useState(wo.width != null ? String(wo.width) : '');
  const [reason, setReason] = useState<ReasonPresetValue>(EMPTY_REASON);
  const { presets } = useReasonPresets('WORK_ORDER_PLAN_CHANGE');
  const width = parseWidth(raw);
  const changed = width !== undefined && width !== (wo.width ?? null);
  const after = useAfterSave(wo.id, onDone);
  const save = useMutation({
    mutationFn: () => {
      const r = reasonPayload(reason, presets);
      return workOrderService.changeWidth(wo.id, { width: width ?? null, reason: r.reason, reasonCode: r.reasonCode });
    },
    onSuccess: () => after('En değiştirildi'),
    onError: (err) => Toast.show({ type: 'error', text1: 'En değiştirilemedi', text2: errorText(err) }),
  });
  return (
    <ModuleSheet
      visible
      onDismiss={onDismiss}
      title="Eni Değiştir"
      subtitle={`${wo.workOrderNumber} · şu an: ${wo.width != null ? `${wo.width} cm` : '—'}`}
      footer={<Footer onCancel={onDismiss} onSave={() => save.mutate()} busy={save.isPending} disabled={!changed || !reasonReady(reason, presets)} />}
    >
      <Text style={sheet.label}>Yeni en (cm)</Text>
      <TextInput mode="outlined" value={raw} onChangeText={setRaw} keyboardType="decimal-pad" style={sheet.input} placeholder="örn. 180" />
      {width === undefined ? <Text style={sheet.error}>En 0 ile 1000 cm arasında olmalı.</Text> : null}
      <Text style={sheet.hint}>Refakat kartındaki en değişir — kaydettikten sonra "Kartı Yeniden Bas".</Text>
      <Text style={sheet.label}>Sebep</Text>
      <ReasonPresetPicker kind="WORK_ORDER_PLAN_CHANGE" value={reason} onChange={setReason} />
    </ModuleSheet>
  );
}

/** Kartı Yeniden Bas — yeni sürüm doğar, eski kart geçersizleşir, yazıcıya gider. */
function ReprintFix({ wo, onDismiss, onDone }: { wo: FixWo; onDismiss: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('Plan değişti — kart yenilendi');
  const after = useAfterSave(wo.id, onDone);
  const save = useMutation({
    mutationFn: async () => {
      await workOrderService.reprintTravelerCard(wo.id, reason.trim());
      await printTravelerCardForWorkOrder(wo.id).catch((err) => {
        Toast.show({ type: 'error', text1: 'Kart yenilendi ama basılamadı', text2: errorText(err) });
      });
    },
    onSuccess: () => after('Refakat kartı yenilendi'),
    onError: (err) => Toast.show({ type: 'error', text1: 'Kart yenilenemedi', text2: errorText(err) }),
  });
  return (
    <ModuleSheet
      visible
      onDismiss={onDismiss}
      size="sm"
      title="Kartı Yeniden Bas"
      subtitle={wo.workOrderNumber}
      footer={<Footer onCancel={onDismiss} onSave={() => save.mutate()} busy={save.isPending} disabled={reason.trim().length < 3} label="Yenile ve Bas" />}
    >
      <Text style={sheet.hint}>Yeni kart sürümü basılır; sahadaki eski kart geçersiz olur.</Text>
      <Text style={sheet.label}>Sebep</Text>
      <TextInput mode="outlined" value={reason} onChangeText={setReason} style={sheet.input} maxLength={500} />
    </ModuleSheet>
  );
}

/** Tablet düzeltme menüsünün tek amaçlı kartları (hareket defteri D5, tasarım §6.2). */
export default function WorkOrderFixSheet({ kind, wo, onDismiss, onDone }: Props) {
  if (!kind || !wo) return null;
  if (kind === 'color') return <ColorFix wo={wo} onDismiss={onDismiss} onDone={onDone} />;
  if (kind === 'width') return <WidthFix wo={wo} onDismiss={onDismiss} onDone={onDone} />;
  if (kind === 'detach') return <WorkOrderDetachSheet wo={wo} onDismiss={onDismiss} onDone={onDone} />;
  return <ReprintFix wo={wo} onDismiss={onDismiss} onDone={onDone} />;
}
