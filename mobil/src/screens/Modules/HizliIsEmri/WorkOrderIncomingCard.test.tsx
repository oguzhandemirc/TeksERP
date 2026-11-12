// Gelen kartı: kritik metre, tablo satırları, kaynak belge dokunuşu, belgesiz İE.
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Provider as PaperProvider } from 'react-native-paper';
import WorkOrderIncomingCard from './WorkOrderIncomingCard';
import { incomingView } from './workOrderDetailView';

const tekParca = incomingView({
  meters: 241, kg: 96.4, widthCm: 350, customerBatchNo: 'ISM1439770', itemText: '2008-58 KOYU BEJ FULAR', colorText: '58 KOYU BEJ FULAR',
  notes: [{ id: 'n', noteNo: 'GB0911260073', senderDocNo: 'A-12', senderDocDate: '2026-11-09T00:00:00.000Z' }],
  rootCount: 1, rootRollIds: ['r'], arrivalForm: 'SINGLE_PIECE',
});

const renderIt = (view = tekParca, onOpen = jest.fn()) =>
  render(
    <PaperProvider>
      <WorkOrderIncomingCard view={view} onOpenDocuments={onOpen} />
    </PaperProvider>,
  );

describe('WorkOrderIncomingCard', () => {
  it('⭐ gelen metre büyük (≥20) ve giriş alanları etiket | değer satırı', () => {
    renderIt();
    const m = screen.getByTestId('ie-detay-gelen-metre');
    expect(m.props.children).toBe('241 m');
    const flat = Object.assign({}, ...[m.props.style].flat(5).filter(Boolean));
    expect(flat.fontSize).toBeGreaterThanOrEqual(20);
    for (const t of ['96,4 kg', '350 cm', '2008-58 KOYU BEJ FULAR', '58 KOYU BEJ FULAR', 'ISM1439770', 'Tek parça', 'Kumaş Nasıl Geldi']) expect(screen.getByText(t)).toBeTruthy();
  });

  it('⭐ kaynak belge satırı GB no · evrak · tarih yazar, dokununca belge görüntüleyici açılır (≥56dp)', () => {
    const onOpen = jest.fn();
    renderIt(tekParca, onOpen);
    expect(screen.getByText('GB0911260073 · Evrak A-12 · 09.11.2026')).toBeTruthy();
    const row = screen.getByTestId('ie-detay-gelen-belge');
    const flat = Object.assign({}, ...[row.props.style].flat(5).filter(Boolean));
    expect(flat.minHeight).toBeGreaterThanOrEqual(56);
    fireEvent.press(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('⭐ belgesiz İE: yalnız giren metre; hiç yoksa "Gelen bilgisi yok"', () => {
    renderIt(incomingView(null, 120));
    expect(screen.getByText('Giren Metre')).toBeTruthy();
    expect(screen.getByTestId('ie-detay-gelen-metre').props.children).toBe('120 m');
    expect(screen.queryByTestId('ie-detay-gelen-belge')).toBeNull();
    renderIt(incomingView(null, null));
    expect(screen.getByTestId('ie-detay-gelen-yok')).toBeTruthy();
  });
});
