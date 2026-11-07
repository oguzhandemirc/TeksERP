import React from 'react';
import { fireEvent } from '@testing-library/react-native';

import { renderWithPaper } from '../../../../test/render';
import HardwareRollsTable from './HardwareRollsTable';
import type { ScannedRoll } from '../useQuickWorkOrder';

const roll = (barcode: string, qty: number, status: ScannedRoll['status'] = 'STOCK') =>
  ({ id: barcode, barcode, itemId: 'i', itemName: 'Kumaş', qty, width: 320, status, colorName: null }) as ScannedRoll;

const base = {
  totalQty: 0,
  onRemove: jest.fn(),
  rejects: [],
  onDismissReject: jest.fn(),
  duplicateBarcode: null,
  flash: null,
  showWidth: false,
};

it('boşken yalnız tuş bandı; tablo yok', () => {
  const r = renderWithPaper(<HardwareRollsTable {...base} rolls={[]} />);
  expect(r.getByTestId('hw-rolls-empty')).toBeTruthy();
  expect(r.getByText('Okuyucu tuşuna basıp topu okutun')).toBeTruthy();
  expect(r.queryByText('Barkod')).toBeNull();
});

it('toplar en yeni üstte, sıra numarası eklenme sırası; toplam satırı; çıkar düğmesi barkodu verir', () => {
  const onRemove = jest.fn();
  const r = renderWithPaper(
    <HardwareRollsTable {...base} onRemove={onRemove} totalQty={150.4} rolls={[roll('A1', 100), roll('B2', 50.4, 'WAREHOUSE')]} />,
  );
  const codes = r.getAllByText(/^(A1|B2)$/).map((n) => n.props.children);
  expect(codes).toEqual(['B2', 'A1']);
  expect(r.getByText('Toplam 2 top')).toBeTruthy();
  expect(r.getByText('150')).toBeTruthy();
  expect(r.getByText('yeniden üretim')).toBeTruthy();
  fireEvent.press(r.getByLabelText('A1 topunu çıkar'));
  expect(onRemove).toHaveBeenCalledWith('A1');
});

it('ret satırı sebebiyle görünür, dokununca kapanır; mükerrer flaş kartı çıkar', () => {
  const onDismissReject = jest.fn();
  const r = renderWithPaper(
    <HardwareRollsTable
      {...base}
      rolls={[roll('A1', 100)]}
      rejects={[{ id: 7, barcode: 'X9', reason: 'Farklı ürün' }]}
      onDismissReject={onDismissReject}
      flash={{ kind: 'duplicate', title: 'ZATEN OKUTULDU', detail: 'A1' }}
    />,
  );
  expect(r.getByText('ZATEN OKUTULDU')).toBeTruthy();
  fireEvent.press(r.getByLabelText('Ret notunu kapat'));
  expect(onDismissReject).toHaveBeenCalledWith(7);
});
