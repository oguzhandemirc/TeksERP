// Belgeden İE formu — okunan müşteri adı kayıtlı değilse hızlı kayıt teklifi (Gülkesim 2026-11-04; modal 2026-11-05).
// Akış: benzer aday varsa "Bunu mu demek istediniz?" (aday seç / hiçbiri → yeni kayıt); yoksa doğrudan "Yeni müşteri
// kaydedilsin mi?". Not başına bir kez kendiliğinden açılır, aynı anda tek teklif (`customerOfferStore`).
// Token mantıksal deneme başına (`useAttemptToken`); ad değişirse yeni deneme, belirsiz hatada aynı token yapışır.
import { useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { customerService } from '../../../../services/customer.service';
import type { ApiResponse } from '../../../../types/api';
import type { InboundDocTabletContext, OwnerUnmatched } from '../../../../services/inboundDoc.service';
import { usePermissions } from '../../../../hooks/usePermission';
import { useAttemptToken } from '../../../../offline/attemptToken';
import { INBOUND_DOC_CONTEXT_KEY } from '../DocHeader';
import { claimAutoOpen, markOpen, releaseOffer, useActiveOffer } from './customerOfferStore';

export type CustomerFromDocStep = 'closed' | 'ask' | 'create';

export const NO_PERMISSION_TEXT = 'Kayıt için yetkiniz yok';

/** Kaydı açabilen izinler — sunucu kapısı `requireAnyPermission("customer:write","gelen-belge:write")` ile aynı. */
export const QUICK_CREATE_PERMISSIONS = ['customer:write', 'gelen-belge:write'] as const;

/** Saf: hata → kullanıcı metni (403 sabit metin; diğerleri sunucunun Türkçe mesajı). */
export function describeQuickCreateError(e: unknown): string {
  if ((e as { status?: number } | null)?.status === 403) return NO_PERMISSION_TEXT;
  return (e as { message?: string } | null)?.message || 'Müşteri kaydedilemedi';
}

/** Seçici listesi yeni kartı hemen göstersin; arkadan tazelenir (belge teklifi + seçicinin "Yeni ekle" formu ortak). */
export function rememberBornCustomer(qc: QueryClient, born: { id: string; name: string }): void {
  qc.setQueryData<ApiResponse<InboundDocTabletContext>>(INBOUND_DOC_CONTEXT_KEY, (old) =>
    old && !old.data.customers.some((c) => c.id === born.id)
      ? { ...old, data: { ...old.data, customers: [...old.data.customers, born] } }
      : old,
  );
  void qc.invalidateQueries({ queryKey: INBOUND_DOC_CONTEXT_KEY });
}

export function useCustomerFromDoc({ noteId, unmatched, disabled, onPicked }: {
  noteId: string;
  unmatched: OwnerUnmatched;
  disabled: boolean;
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
  const activeOffer = useActiveOffer();

  const show = () => {
    setError(null);
    setName(unmatched.text);
    setStep(unmatched.candidates.length > 0 ? 'ask' : 'create');
  };
  const open = () => {
    markOpen(noteId);
    show();
  };
  const finish = () => {
    setStep('closed');
    releaseOffer(noteId);
  };

  // Not başına bir kez kendiliğinden; başka teklif açıksa o kapanınca sıra gelir.
  useEffect(() => {
    if (!disabled && activeOffer === null && claimAutoOpen(noteId)) show();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `show` her çizimde yeni; tetik yalnız durum değişimi
  }, [disabled, activeOffer, noteId]);
  // Satır söküldü (müşteri başka yoldan seçildi, satır çıkarıldı): sıra kilitli kalmasın.
  useEffect(() => () => releaseOffer(noteId), [noteId]);

  const close = () => {
    if (!busy) finish();
  };
  const pick = (customerId: string, picked: string) => {
    finish();
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
      rememberBornCustomer(qc, born);
      finish();
      onPicked(born.id, born.name);
    } catch (e) {
      attempt.onFailure(e);
      setError(describeQuickCreateError(e));
    } finally {
      setBusy(false);
    }
  };

  return { step, name, setName, busy, error, canCreate, open, close, pick, decline, save, finish };
}
