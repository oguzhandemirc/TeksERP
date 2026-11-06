// Bekçi: Sevk Kapısı kartı yük birimini bilir (gece UX turu 2026-11-06) ve boş liste "listeyi alamadım"dan ayrılır.
//   • dökme/araba sevkiyatı "N çuval" yazmaz, "Çuval Çıkar" önermez (birim çıkarılamaz, yolu iptal),
//   • eski sunucu (cartCount/bulkCount yok) → hepsi çuval, düğme görünür (bugünkü davranış),
//   • çevrimdışı (isPaused) ya da hata → "Bekleyen sevkiyat yok" DEMEZ.
import React from 'react';
import { screen } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import { BoardEmpty, ShipmentBoardCard } from './ShipmentBoardCard';
import { QUERY_PROBLEM_TEXT } from '../../../utils/queryState';

const base = {
  id: 's1', shipmentNo: 'SVK-1', status: 'PLANNED', destination: 'DOMESTIC', procedureCode: null,
  createdAt: new Date().toISOString(), customer: { id: 'c', name: 'Gülkesim' }, branch: null,
  sackCount: 3, rollCount: 5, totalKg: 12, totalQty: 240,
};
const noop = jest.fn();
const card = (over: Record<string, unknown>) =>
  renderWithPaper(
    <ShipmentBoardCard sh={{ ...base, ...over } as never} busy={false} onContents={noop} onCancel={noop} onDispatch={noop} />,
  );

describe('ShipmentBoardCard — yük birimi', () => {
  it('dökme: "Dökme" yazar, Çuval Çıkar yok, içerik satırı çıkarma önermez', () => {
    card({ sackCount: 1, cartCount: 0, bulkCount: 1 });
    expect(screen.getByTestId('sevk-yuk-s1')).toHaveTextContent(/^Dökme · 240 m · 12 kg$/);
    expect(screen.queryByTestId('sevk-cuval-cikar-s1')).toBeNull();
    expect(screen.getByText('5 top · içeriği gör')).toBeTruthy();
  });
  it('araba: "2 araba", Çuval Çıkar yok; tartılmamışsa "0 kg" yazılmaz', () => {
    card({ sackCount: 2, cartCount: 2, bulkCount: 0, totalKg: 0 });
    expect(screen.getByTestId('sevk-yuk-s1')).toHaveTextContent(/^2 araba · 240 m$/);
    expect(screen.getByTestId('sevk-yuk-s1')).toHaveTextContent(/^2 araba ·/);
    expect(screen.queryByTestId('sevk-cuval-cikar-s1')).toBeNull();
  });
  it('eski sunucu: hepsi çuval, Çuval Çıkar görünür', () => {
    card({});
    expect(screen.getByTestId('sevk-yuk-s1')).toHaveTextContent(/^3 çuval ·/);
    expect(screen.getByTestId('sevk-cuval-cikar-s1')).toBeTruthy();
    expect(screen.getByText('5 top · içeriği gör / çuval çıkar')).toBeTruthy();
  });
});

describe('BoardEmpty — boş ≠ alınamadı', () => {
  const q = (over: Record<string, boolean>) => ({ isLoading: false, isError: false, isPaused: false, ...over });
  it('gerçekten boş', () => {
    renderWithPaper(<BoardEmpty q={q({})} search="" />);
    expect(screen.getByText('Bekleyen sevkiyat yok')).toBeTruthy();
  });
  it('çevrimdışı: sebep yazar, "sevkiyat yok" demez', () => {
    renderWithPaper(<BoardEmpty q={q({ isPaused: true })} search="" />);
    expect(screen.getByText(QUERY_PROBLEM_TEXT.offline)).toBeTruthy();
    expect(screen.queryByText('Bekleyen sevkiyat yok')).toBeNull();
  });
  it('hata: sebep yazar', () => {
    renderWithPaper(<BoardEmpty q={q({ isError: true })} search="SVK" />);
    expect(screen.getByText(QUERY_PROBLEM_TEXT.error)).toBeTruthy();
  });
  it('arama boş: aranan metni söyler', () => {
    renderWithPaper(<BoardEmpty q={q({})} search="SVK9" />);
    expect(screen.getByText('"SVK9" ile eşleşen sevkiyat yok')).toBeTruthy();
  });
});
