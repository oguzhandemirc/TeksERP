// Bilgi kartı müşteri bölümü: yalnız müşteri adı (emanette sahip, kilitli); "Sahibi" rozeti / etiket alıcısı yok.
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import TamburInfoCard, { showOwnTag } from './TamburInfoCard';
import { TamburMeterTrailView } from './TamburMeterTrail';

const base = { barcode: 'T101126H0005', itemLine: 'Tül · Ekru', trail: null, remaining: 170, orders: null };

describe('TamburInfoCard', () => {
  it('emanet top: tek satır sahip adı, dokunulamaz, rozet yok', () => {
    const r = renderWithPaper(<TamburInfoCard {...base} customerName="HH" owner={{ name: 'HH' }} onPickCustomer={null} />);
    expect(r.getByTestId('tambur-musteri-adi')).toHaveTextContent('HH');
    expect(r.queryByText(/Sahibi/)).toBeNull();
    expect(r.queryByTestId('tambur-kime')).toBeNull();
    expect(r.getByText('MÜŞTERİ KUMAŞI')).toBeTruthy();
  });

  it('"MÜŞTERİ KUMAŞI" bir kez: kumaş satırı zaten içeriyorsa ayrı etiket yok', () => {
    const r = renderWithPaper(<TamburInfoCard {...base} itemLine="Müşteri Kumaşı · Ekru" customerName="HH" owner={{ name: 'HH' }} onPickCustomer={null} />);
    expect(r.queryByText('MÜŞTERİ KUMAŞI')).toBeNull();
    expect(showOwnTag({ name: 'HH' }, 'MÜŞTERİ KUMAŞI')).toBe(false);
    expect(showOwnTag(null, 'Tül')).toBe(false);
  });

  it('iki satır: satır 1 ad · top · kumaş + kompakt kalan karosu; satır 2 metre şeridi (Kalan ≈ yok)', () => {
    const trail = { rollId: 'r', declaredM: 241, prior: { kind: 'KURSUN_OUT' as const, stationName: 'Kurşun', meters: 300, at: '' }, referenceM: 300, cutSoFarM: 130, remainingM: 170, overReference: false };
    const r = renderWithPaper(<TamburInfoCard {...base} trail={<TamburMeterTrailView trail={trail} pendingM={0} tone="light" omitRemaining />} customerName="HH" owner={null} onPickCustomer={null} />);
    expect(r.getByTestId('tambur-kalan')).toHaveTextContent('170.0mt kalan');
    expect(r.getByText('Beyan 241 m')).toBeTruthy();
    expect(r.queryByText(/Kalan ≈/)).toBeNull();
  });

  it('kendi top: müşteri adına dokununca Kime? seçici', () => {
    const onPick = jest.fn();
    const r = renderWithPaper(<TamburInfoCard {...base} customerName="Stok (müşterisiz)" owner={null} onPickCustomer={onPick} />);
    fireEvent.press(r.getByTestId('tambur-kime'));
    expect(onPick).toHaveBeenCalled();
  });
});
