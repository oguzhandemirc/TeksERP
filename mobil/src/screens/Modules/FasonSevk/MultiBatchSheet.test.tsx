// Negatif sonda (2026-09-26): varsayılan seçim MERGE yapılınca 1. test kırmızı.
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import MultiBatchSheet from './MultiBatchSheet';
import { renderWithPaper } from '../../../test/render';

const DETAILS = {
  code: 'MULTI_BATCH' as const,
  batches: [{ id: 'b1', batchNumber: 'P03', oldest: true }, { id: 'b2', batchNumber: 'P07', oldest: false }],
};

describe('MultiBatchSheet', () => {
  it('varsayılan AYRI sevk: dokunmadan Gönder SEPARATE ister', async () => {
    const onConfirm = jest.fn();
    renderWithPaper(<MultiBatchSheet details={DETAILS} onDismiss={() => {}} onConfirm={onConfirm} />);
    await act(async () => {});
    expect(screen.getByText('Ayrı sevk (2 irsaliye)')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Gönder' }));
    expect(onConfirm).toHaveBeenCalledWith('SEPARATE');
  });

  it('birleştir açık seçim: en eski partiyi adıyla gösterir ve MERGE ister', async () => {
    const onConfirm = jest.fn();
    renderWithPaper(<MultiBatchSheet details={DETAILS} onDismiss={() => {}} onConfirm={onConfirm} />);
    await act(async () => {});
    fireEvent.press(screen.getByText('Birleştir (P03)'));
    await act(async () => {});
    fireEvent.press(screen.getByRole('button', { name: 'Gönder' }));
    expect(onConfirm).toHaveBeenCalledWith('MERGE');
  });
});
