// AppModal — bağlanışta kapalı olup aynı karede açılan modal görünür kalır (2026-11-05, belgeden İE müşteri teklifi).
// İlk (kapalı) kapanış animasyonunun geri çağrısı açılıştan SONRA gelir; `finishHide` görünürken gizlemez.
// Negatif sonda (2026-11-05, ölçüldü; md5 ile geri): `visibleRef` koruması kaldırılınca "açık kalır" ✕.
import React, { useEffect, useState } from 'react';
import { act } from '@testing-library/react-native';
import { Text } from 'react-native-paper';
import { renderWithPaper } from '../test/render';
import AppModal from './AppModal';

function OpensOnMount() {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(true), []);
  return (
    <AppModal visible={open} onDismiss={() => setOpen(false)}>
      <Text testID="acilan-icerik">içerik</Text>
    </AppModal>
  );
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 400)); });

describe('AppModal — bağlanışta açılış', () => {
  it('⭐ kapalı bağlanıp effect içinde açılan modal açık kalır', async () => {
    const ui = renderWithPaper(<OpensOnMount />);
    await settle();
    await settle();
    expect(ui.getByTestId('acilan-icerik')).toBeTruthy();
  });
});
