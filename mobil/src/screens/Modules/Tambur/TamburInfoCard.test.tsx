// Bilgi kartı müşteri bölümü: yalnız müşteri adı (emanette sahip, kilitli); "Sahibi" rozeti / etiket alıcısı yok.
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import TamburInfoCard from './TamburInfoCard';

const base = { barcode: 'T101126H0005', itemLine: 'Tül · Ekru', trail: null, remaining: 170, orders: null };

describe('TamburInfoCard', () => {
  it('emanet top: tek satır sahip adı, dokunulamaz, rozet yok', () => {
    const r = renderWithPaper(<TamburInfoCard {...base} customerName="HH" owner={{ name: 'HH' }} onPickCustomer={null} />);
    expect(r.getByTestId('tambur-musteri-adi')).toHaveTextContent('HH');
    expect(r.queryByText(/Sahibi/)).toBeNull();
    expect(r.queryByTestId('tambur-kime')).toBeNull();
    expect(r.getByText('MÜŞTERİ KUMAŞI')).toBeTruthy();
  });

  it('kendi top: müşteri adına dokununca Kime? seçici', () => {
    const onPick = jest.fn();
    const r = renderWithPaper(<TamburInfoCard {...base} customerName="Stok (müşterisiz)" owner={null} onPickCustomer={onPick} />);
    fireEvent.press(r.getByTestId('tambur-kime'));
    expect(onPick).toHaveBeenCalled();
  });
});
