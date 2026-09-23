// BEKÇİ — tablet sevk yönü satırı (S4, 2026-09-23): kilitliyse rozet + kaynak + ihracat kodu,
// seçici YOK; zincir boşsa tek seferlik seçici + "karta yazılır" notu.
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import { DestinationLockRow } from './DestinationLockRow';

describe('DestinationLockRow', () => {
  it('kilitli → rozet, kaynak, ihracat kodu; seçici yok', () => {
    renderWithPaper(
      <DestinationLockRow lock={{ destination: 'EXPORT', source: 'CUSTOMER', exportCode: 'EXP-C', quickShipBlockedReason: 'x' }} picked={null} onPick={() => {}} hasBranch={false} />,
    );
    expect(screen.getByTestId('destination-lock-badge')).toBeTruthy();
    expect(screen.getByText('Cariden')).toBeTruthy();
    expect(screen.getByText('İhracat Kodu: EXP-C')).toBeTruthy();
    expect(screen.queryByTestId('destination-first-pick')).toBeNull();
  });
  it('zincir boş → seçici + "şubenin kartına"; dokunuş seçimi bildirir', () => {
    const onPick = jest.fn();
    renderWithPaper(
      <DestinationLockRow lock={{ destination: null, source: null, exportCode: null, quickShipBlockedReason: null }} picked={null} onPick={onPick} hasBranch />,
    );
    expect(screen.getByText(/şubenin kartına yazılır/)).toBeTruthy();
    fireEvent.press(screen.getByText('Yurtdışı'));
    expect(onPick).toHaveBeenCalledWith('EXPORT');
  });
});
