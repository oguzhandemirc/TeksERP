// İE oluşturulunca formdan çıkış: form kapanır, İş Emirleri listesi (tazelenmiş) açılır; başarı kısa Toast.
// Taslak ("Taslak kaydet", SEPARATE) İE değildir → yerinde kalır (bugünkü "Yeni iş emri" akışı).
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { TERIM } from '../../../../lib/terim';
import { WORK_ORDER_LIST_KEY } from '../../IsEmirleri/useWorkOrderList';

export interface CreatedExitProps {
  /** Verilirse İE oluşunca çağrılır (üst ekran listeye gider); verilmezse bugünkü başarı çubuğu kalır. */
  onCreated?: () => void;
}

export function useCreatedExit(done: boolean, ownMode: boolean, draftMode: boolean, onCreated: (() => void) | undefined): void {
  const qc = useQueryClient();
  const cb = useRef(onCreated);
  cb.current = onCreated;
  const fired = useRef(false);
  useEffect(() => {
    if (!done || draftMode || fired.current || !cb.current) return;
    fired.current = true;
    // Kendi üretim yolu kendi Toast'unu atar; belge yolunda çok partide tek bildirim.
    if (!ownMode) Toast.show({ type: 'success', text1: `${TERIM.terbiyeIsEmri.tekil} oluşturuldu` });
    void qc.invalidateQueries({ queryKey: WORK_ORDER_LIST_KEY });
    cb.current();
  }, [done, ownMode, draftMode, qc]);
}
