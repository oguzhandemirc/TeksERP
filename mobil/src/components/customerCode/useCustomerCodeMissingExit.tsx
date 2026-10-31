// Baskı BLOCK'ta (400 CUSTOMER_CODE_MISSING, D4-F3 / DALGA4 §7.5-4) operatöre tek dokunuşluk çıkış:
// okut-bağla sayfası açılır; bağlanınca etiket yeniden basılır (baskı kuyruğu kendiliğinden tekrar denemez).
import React, { useCallback, useState } from 'react';
import Toast from 'react-native-toast-message';
import type { Roll } from '../../types/models';
import { CustomerCodeBindSheet } from './CustomerCodeBindSheet';
import { isCustomerCodeMissing } from './customerCodeLogic';
import { useCustomerCodeBindable } from './useCustomerCodeBindable';

export function useCustomerCodeMissingExit(): { offer: (err: unknown, roll: Roll) => boolean; sheet: React.ReactElement } {
  const [roll, setRoll] = useState<Roll | null>(null);
  const bindable = useCustomerCodeBindable(roll?.ownerCustomerId);
  const offer = useCallback((err: unknown, r: Roll) => {
    if (!isCustomerCodeMissing(err)) return false;
    setRoll(r);
    return true;
  }, []);
  const sheet = (
    <CustomerCodeBindSheet
      roll={bindable && roll ? { id: roll.id, barcode: roll.barcode ?? null } : null}
      onDismiss={() => setRoll(null)}
      onBound={(code) => Toast.show({ type: 'success', text1: 'Müşteri barkodu bağlandı', text2: `${code} — etiketi yeniden basın.` })}
    />
  );
  return { offer, sheet };
}
