// Bağla modalının durum + gönderim mantığı (görünümden ayrı; CustomerCodeBindSheet).
import { useMemo, useState } from 'react';
import Toast from 'react-native-toast-message';
import { signalScan } from '../../services/scanFeedback';
import { rollCustomerCodeService } from '../../services/rollCustomerCode.service';
import { createBindAttempt } from './bindAttempt';
import { describeBindError, isEndpointMissing } from './customerCodeLogic';
import { markCustomerCodeEndpointMissing } from './useCustomerCodeBindable';

const MIN_REASON = 3;

export function useCustomerCodeBindForm({ roll, onDismiss, onBound }: {
  roll: { id: string; barcode: string | null } | null;
  onDismiss: () => void;
  onBound?: (code: string) => void;
}) {
  const attempt = useMemo(
    () => createBindAttempt({ bind: rollCustomerCodeService.bind, revoke: rollCustomerCodeService.revoke }),
    [],
  );
  const [code, setCode] = useState('');
  const [replace, setReplace] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const close = () => {
    setCode('');
    setReplace(false);
    setReason('');
    setError(null);
    onDismiss();
  };

  const submit = async (raw?: string) => {
    const value = (raw ?? code).trim();
    if (!roll || !value || busy) return;
    if (replace && reason.trim().length < MIN_REASON) {
      setError('Değiştirme sebebi en az 3 karakter olmalı');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await attempt.submit(roll.id, value, replace ? reason.trim() : undefined);
      signalScan('accept');
      Toast.show({ type: 'success', text1: 'Müşteri barkodu bağlandı', text2: `${roll.barcode ?? ''} ← ${value}` });
      onBound?.(value);
      close();
    } catch (e) {
      signalScan('reject');
      if (isEndpointMissing(e)) {
        markCustomerCodeEndpointMissing();
        Toast.show({ type: 'error', text1: 'Sunucu bu özelliği desteklemiyor', text2: 'Sunucu güncellenince açılır.' });
        close();
        return;
      }
      const d = describeBindError(e);
      if (d.kind === 'replace') setReplace(true);
      const revokedNote = (e as { previousCodeRevoked?: boolean } | null)?.previousCodeRevoked
        ? ' (Eski kod kaldırıldı; topta şu an müşteri barkodu yok.)'
        : '';
      setError(`${d.title} — ${d.body}${revokedNote}`);
    } finally {
      setBusy(false);
    }
  };

  return { code, setCode, replace, reason, setReason, error, busy, cameraOpen, setCameraOpen, submit, close };
}
