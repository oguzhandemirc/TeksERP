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

it('bant görünürken ret satırı YOK — aynı hata iki kez görünmez', () => {
  const r = renderWithPaper(
    <HardwareRollsTable
      {...base}
      rolls={[roll('A1', 100)]}
      rejects={[{ id: 7, barcode: 'X9', reason: 'Top bulunamadı' }]}
      flash={{ kind: 'reject', title: 'EKLENMEDİ', detail: 'X9 · Top bulunamadı' }}
    />,
  );
  expect(r.getAllByTestId('scan-flash')).toHaveLength(1);
  expect(r.queryByLabelText('Ret notunu kapat')).toBeNull();
  expect(r.getAllByText(/X9/)).toHaveLength(1);
});

it('bant sönünce yalnız EN SON ret kalır (birikmez); dokununca kapanır', () => {
  const onDismissReject = jest.fn();
  const r = renderWithPaper(
    <HardwareRollsTable
      {...base}
      rolls={[roll('A1', 100)]}
      rejects={[
        { id: 9, barcode: 'X9', reason: 'Top bulunamadı' },
        { id: 8, barcode: 'X9', reason: 'Top bulunamadı' },
        { id: 7, barcode: 'Y1', reason: 'Farklı ürün' },
      ]}
      onDismissReject={onDismissReject}
    />,
  );
  expect(r.getAllByLabelText('Ret notunu kapat')).toHaveLength(1);
  expect(r.queryByText('Y1')).toBeNull();
  fireEvent.press(r.getByLabelText('Ret notunu kapat'));
  expect(onDismissReject).toHaveBeenCalledWith(9);
});

it('retten SONRA top eklenince eski ret notu düşer', () => {
  const rejects = [{ id: 7, barcode: 'X9', reason: 'Top bulunamadı' }];
  const r = renderWithPaper(<HardwareRollsTable {...base} rolls={[roll('A1', 100)]} rejects={rejects} />);
  expect(r.getByLabelText('Ret notunu kapat')).toBeTruthy();
  r.rerender(<HardwareRollsTable {...base} rolls={[roll('A1', 100), roll('B2', 50)]} rejects={rejects} />);
  expect(r.queryByLabelText('Ret notunu kapat')).toBeNull();
});

it('mükerrer flaş kartı çıkar', () => {
  const r = renderWithPaper(
    <HardwareRollsTable {...base} rolls={[roll('A1', 100)]} flash={{ kind: 'duplicate', title: 'ZATEN OKUTULDU', detail: 'A1' }} />,
  );
  expect(r.getByText('ZATEN OKUTULDU')).toBeTruthy();
});
