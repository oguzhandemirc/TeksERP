// Müşteri seçicisinin "Yeni ekle" formu (saha 2026-11-10): ad + açılır "Diğer" alanları → `customerService.quickCreate`.
// İzin, hata metni ve önbellek tazeleme belge teklifiyle (`useCustomerFromDoc`) ortak; token mantıksal deneme başına
// (ad ya da dolu alan değişirse yeni deneme, belirsiz hatada aynı token yapışır).
import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { customerService, type QuickCustomerExtra } from '../../../../services/customer.service';
import type { PickerOption } from '../../../../components/PickerModal';
import { usePermissions } from '../../../../hooks/usePermission';
import { useAttemptToken } from '../../../../offline/attemptToken';
import { NO_PERMISSION_TEXT, QUICK_CREATE_PERMISSIONS, describeQuickCreateError, rememberBornCustomer } from './useCustomerFromDoc';
import { quickAttemptKey, quickExtraBody, sameNameHits, type QuickExtraKey } from './quickCustomer';

/** Seçicinin "Yeni ekle" kartını görmek için yeter izin — kayıt ucu kapısıyla aynı küme. */
export function useCanQuickCreateCustomer(): boolean {
  const perms = usePermissions();
  return QUICK_CREATE_PERMISSIONS.some((p) => perms.has(p));
}

export function useQuickCustomerAdd({ options, onCreated }: {
  options: readonly PickerOption[];
  onCreated: (customerId: string, name: string) => void;
}) {
  const canCreate = useCanQuickCreateCustomer();
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const attemptKey = useRef<string | null>(null);
  const [name, setName] = useState('');
  const [extra, setExtra] = useState<QuickCustomerExtra>({});
  const [otherOpen, setOtherOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hits = useMemo(() => sameNameHits(name, options), [name, options]);

  /** Form yeniden açıldı: boş form, kapalı "Diğer", yeni deneme. */
  const reset = () => {
    setName('');
    setExtra({});
    setOtherOpen(false);
    setError(null);
    attempt.renew();
    attemptKey.current = null;
  };
  const setField = (key: QuickExtraKey, value: string) => setExtra((old) => ({ ...old, [key]: value }));

  const save = async () => {
    const value = name.trim();
    if (!value || busy || hits.exact) return;
    if (!canCreate) {
      setError(NO_PERMISSION_TEXT);
      return;
    }
    const key = quickAttemptKey(value, extra);
    if (attemptKey.current !== key) {
      attempt.renew();
      attemptKey.current = key;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await customerService.quickCreate({ name: value, clientToken: attempt.token(), ...quickExtraBody(extra) });
      attempt.onSuccess();
      attemptKey.current = null;
      const born = { id: res.data.id, name: res.data.name };
      rememberBornCustomer(qc, born);
      onCreated(born.id, born.name);
    } catch (e) {
      attempt.onFailure(e);
      setError(describeQuickCreateError(e));
    } finally {
      setBusy(false);
    }
  };

  return { canCreate, name, setName, extra, setField, otherOpen, setOtherOpen, busy, error, hits, reset, save };
}
