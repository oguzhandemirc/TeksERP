// Belgeden İE formu — okunan müşteri adı kayıtlı değilse hızlı kayıt teklifi (Gülkesim 2026-11-04).
// Akış: benzer aday varsa önce "Bunu mu demek istediniz?" (Evet = seç, Hayır = yeni kayıt); yoksa doğrudan yeni kayıt.
// Token mantıksal deneme başına (`useAttemptToken`); ad değişirse yeni deneme, belirsiz hatada aynı token yapışır.
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { customerService } from '../../../../services/customer.service';
import type { ApiResponse } from '../../../../types/api';
import type { InboundDocTabletContext, OwnerUnmatched } from '../../../../services/inboundDoc.service';
import { usePermissions } from '../../../../hooks/usePermission';
import { useAttemptToken } from '../../../../offline/attemptToken';
import { INBOUND_DOC_CONTEXT_KEY } from '../DocHeader';

export type CustomerFromDocStep = 'closed' | 'ask' | 'create';

export const NO_PERMISSION_TEXT = 'Kayıt için yetkiniz yok';

/** Kaydı açabilen izinler — sunucu kapısı `requireAnyPermission("customer:write","gelen-belge:write")` ile aynı. */
export const QUICK_CREATE_PERMISSIONS = ['customer:write', 'gelen-belge:write'] as const;

/** Saf: hata → kullanıcı metni (403 sabit metin; diğerleri sunucunun Türkçe mesajı). */
export function describeQuickCreateError(e: unknown): string {
  if ((e as { status?: number } | null)?.status === 403) return NO_PERMISSION_TEXT;
  return (e as { message?: string } | null)?.message || 'Müşteri kaydedilemedi';
}

export function useCustomerFromDoc({ unmatched, onPicked }: {
  unmatched: OwnerUnmatched;
  onPicked: (customerId: string, name: string) => void;
}) {
  const perms = usePermissions();
  const canCreate = QUICK_CREATE_PERMISSIONS.some((p) => perms.has(p));
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const tokenName = useRef<string | null>(null);
  const [step, setStep] = useState<CustomerFromDocStep>('closed');
  const [name, setName] = useState(unmatched.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setError(null);
    setName(unmatched.text);
    setStep(unmatched.candidates.length > 0 ? 'ask' : 'create');
  };
  const close = () => {
    if (!busy) setStep('closed');
  };
  const pick = (customerId: string, picked: string) => {
    setStep('closed');
    onPicked(customerId, picked);
  };
  const decline = () => {
    setError(null);
    setStep('create');
  };

  const save = async () => {
    const value = name.trim();
    if (!value || busy) return;
    if (!canCreate) {
      setError(NO_PERMISSION_TEXT);
      return;
    }
    // Ad değiştiyse yeni mantıksal deneme (aynı token farklı adla sunucuda 409 olur).
    if (tokenName.current !== value) {
      attempt.renew();
      tokenName.current = value;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await customerService.quickCreate({ name: value, clientToken: attempt.token() });
      attempt.onSuccess();
      tokenName.current = null;
      const born = { id: res.data.id, name: res.data.name };
      // Seçici listesi yeni kartı hemen göstersin; arkadan tazelenir.
      qc.setQueryData<ApiResponse<InboundDocTabletContext>>(INBOUND_DOC_CONTEXT_KEY, (old) =>
        old && !old.data.customers.some((c) => c.id === born.id)
          ? { ...old, data: { ...old.data, customers: [...old.data.customers, born] } }
          : old,
      );
      void qc.invalidateQueries({ queryKey: INBOUND_DOC_CONTEXT_KEY });
      setStep('closed');
      onPicked(born.id, born.name);
    } catch (e) {
      attempt.onFailure(e);
      setError(describeQuickCreateError(e));
    } finally {
      setBusy(false);
    }
  };

  return { step, name, setName, busy, error, canCreate, open, close, pick, decline, save };
}
