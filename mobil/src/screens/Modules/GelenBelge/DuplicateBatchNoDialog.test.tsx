// Aynı müşteri parti no kartı: 409 künyesi ayrıştırma + WARN (Vazgeç / Yine de aç) · BLOCK (yalnız Tamam).
// Negatif sonda (2026-11-10): `confirmable` dalı hep true yapılınca BLOCK satırı ❌; künyede `workOrderNumber ?? noteNo`
// yerine noteNo basılınca "ISM1439770 → IE0911260003" ❌; geri alındı.
import React, { type ReactNode } from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import { DuplicateBatchNoDialog, duplicateBatchNoConflict, type DuplicateBatchNoConflict } from './DuplicateBatchNoDialog';

jest.mock('../../../components/ModuleSheet', () => ({
  __esModule: true,
  default: (p: { visible: boolean; title: string; children: ReactNode; footer: ReactNode }) => {
    const RN = jest.requireActual('react-native-paper');
    return p.visible ? <><RN.Text testID="kart-baslik">{p.title}</RN.Text>{p.children}{p.footer}</> : null;
  },
}));

const peers = [
  { id: 'p1', noteNo: 'GB0911260041', status: 'APPROVED', customerBatchNo: 'ISM1439770', workOrderNumber: 'IE0911260003', workOrderNumbers: ['IE0911260003'] },
  { id: 'p2', noteNo: 'GB0911260073', status: 'APPROVED', customerBatchNo: 'ISM1439770', workOrderNumber: null, workOrderNumbers: [] },
];
const apiError = (code: string) => Object.assign(new Error('x'), { status: 409, details: { code, peers } });

describe('duplicateBatchNoConflict', () => {
  it('⭐ WARN kodu onaylanabilir, BLOCK kodu değil; başka hata null', () => {
    expect(duplicateBatchNoConflict(apiError('DELIVERY_NOTE_DUPLICATE_BATCH_NO_ACTIVE'))).toMatchObject({ confirmable: true, peers: [{ noteNo: 'GB0911260041' }, { noteNo: 'GB0911260073' }] });
    expect(duplicateBatchNoConflict(apiError('DELIVERY_NOTE_DUPLICATE_BATCH_NO'))?.confirmable).toBe(false);
    expect(duplicateBatchNoConflict(apiError('DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE'))).toBeNull();
    expect(duplicateBatchNoConflict(null)).toBeNull();
  });
});

describe('DuplicateBatchNoDialog', () => {
  const render = (conflict: DuplicateBatchNoConflict | null) => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    const ui = renderWithPaper(<DuplicateBatchNoDialog conflict={conflict} busy={false} onCancel={onCancel} onConfirm={onConfirm} />);
    return { ui, onCancel, onConfirm };
  };
  it('⭐ WARN: başlık, "parti → İE" satırları (İE yoksa GB no), Vazgeç / Yine de aç', () => {
    const { ui, onCancel, onConfirm } = render({ confirmable: true, peers });
    expect(ui.getByTestId('kart-baslik')).toHaveTextContent('BU PARTİ ZATEN VAR');
    expect(ui.getAllByTestId('parti-tekrar-satir').map((n) => n.props.children)).toEqual(['ISM1439770 → IE0911260003', 'ISM1439770 → GB0911260073']);
    expect(ui.queryByTestId('parti-tekrar-tamam')).toBeNull();
    fireEvent.press(ui.getByTestId('parti-tekrar-yine-de'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.press(ui.getByTestId('parti-tekrar-vazgec'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
  it('⭐ BLOCK: yalnız Tamam (Yine de aç yok)', () => {
    const { ui, onCancel, onConfirm } = render({ confirmable: false, peers });
    expect(ui.queryByTestId('parti-tekrar-yine-de')).toBeNull();
    expect(ui.queryByTestId('parti-tekrar-vazgec')).toBeNull();
    fireEvent.press(ui.getByTestId('parti-tekrar-tamam'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it('künye yoksa çizilmez', () => {
    const { ui } = render(null);
    expect(ui.queryByTestId('kart-baslik')).toBeNull();
    expect(ui.queryByTestId('parti-tekrar-kart')).toBeNull();
  });
});
