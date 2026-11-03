// K29 okutmayla rota — kart çözümü catch'inde araya girer (Kurşun/KK + Tambur ortak). Sessiz karar hemen uygulanır;
// onay/engel diyaloğu `dialog` ile çizilir. Uygulamadan sonra kart `reopen` ile bugünkü yoldan yeniden çözülür.
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Button, Text } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import ModuleSheet from '../../../components/ModuleSheet';
import { TERIM } from '../../../lib/terim';
import { useAttemptToken } from '../../../offline/attemptToken';
import { scanRouteService } from '../../../services/scanRoute.service';
import { signalScan } from '../../../services/scanFeedback';
import { applyClosePermission, decideScanRoutePrompt, needsClosePermission, readScanRouteView, type ScanRoutePrompt } from './scanRoute';

type Pending = { barcode: string; prompt: Exclude<ScanRoutePrompt, { kind: 'SILENT' }>; reopen: () => void };

export function ScanRouteDialog({ pending, busy, onConfirm, onCancel }: {
  pending: { prompt: Exclude<ScanRoutePrompt, { kind: 'SILENT' }> } | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const p = pending?.prompt;
  return (
    <ModuleSheet
      visible={!!p}
      onDismiss={busy ? () => undefined : onCancel}
      size="sm"
      title={p?.title ?? ''}
      subtitle={p?.kind === 'BLOCK' ? 'Okutmaya göre rota — engel' : 'Okutmaya göre rota'}
      footer={p?.kind === 'CONFIRM' ? (
        <>
          <Button mode="outlined" onPress={onCancel} disabled={busy} testID="scan-route-cancel">Vazgeç</Button>
          <Button mode="contained" onPress={onConfirm} loading={busy} disabled={busy} testID="scan-route-confirm">{p.confirmLabel}</Button>
        </>
      ) : (
        <Button mode="contained" onPress={onCancel} testID="scan-route-ok">Tamam</Button>
      )}
    >
      <Text style={styles.body} testID="scan-route-dialog">{p?.body ?? ''}</Text>
    </ModuleSheet>
  );
}

/**
 * `intercept(err, barcode, reopen)`: okutmayla rota hatası değilse `null` (çağıranın bugünkü yolu);
 * sessiz uygulama/onay sorusu → `'handled'`; engel → `'blocked'` (çağıran ret sinyalini verir).
 */
export function useScanRoute() {
  const attempt = useAttemptToken();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (barcode: string, closeOpenStepId: string | null, reopen: () => void, fallbackToast: string | null) => {
    setBusy(true);
    try {
      const res = await scanRouteService.apply(barcode, { clientToken: attempt.token(), closeOpenStepId });
      attempt.onSuccess();
      const r = res.data;
      const added = r?.targetsAdded?.length ? ` Hedef: ${r.targetsAdded.join(', ')}.` : '';
      Toast.show({ type: 'info', text1: 'Okutmaya göre rota', text2: `${fallbackToast ?? (r?.kind === 'INSERT' ? `Adım ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} eklendi.` : 'İş bu istasyona geçti.')}${added}` });
      setPending(null);
      reopen();
    } catch (e) {
      attempt.onFailure(e);
      Toast.show({ type: 'error', text1: 'Okutmaya göre rota uygulanamadı', text2: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const intercept = (err: unknown, barcode: string, reopen: () => void): 'handled' | 'blocked' | null => {
    const view = readScanRouteView(err);
    if (!view) return null;
    const prompt = decideScanRoutePrompt(view);
    if (prompt.kind === 'SILENT') {
      attempt.renew();
      void run(barcode, null, reopen, prompt.toast);
      return 'handled';
    }
    attempt.renew();
    if (needsClosePermission(prompt)) {
      // S15b: düğmeyi göstermeden önce yetki önizlemeden (sunucu tek kaynak); okunamazsa bugünkü onay.
      void scanRouteService
        .preview(barcode)
        .then((r) => r.data?.canClose, () => undefined)
        .then((canClose) => {
          const next = applyClosePermission(prompt, view, canClose);
          if (next.kind === 'BLOCK') signalScan('reject');
          setPending({ barcode, prompt: next as Pending['prompt'], reopen });
        });
      return 'handled';
    }
    setPending({ barcode, prompt, reopen });
    return prompt.kind === 'BLOCK' ? 'blocked' : 'handled';
  };

  const dialog = (
    <ScanRouteDialog
      pending={pending}
      busy={busy}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        if (pending?.prompt.kind === 'CONFIRM') void run(pending.barcode, pending.prompt.closeOpenStepId, pending.reopen, null);
      }}
    />
  );
  return { intercept, dialog };
}

const styles = StyleSheet.create({
  body: { fontSize: 15, color: '#1f2937' },
});
