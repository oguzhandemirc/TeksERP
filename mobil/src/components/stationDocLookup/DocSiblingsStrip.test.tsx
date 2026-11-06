// Belgeden açılan işin kardeş şeridi: aktif kart belgeden açılan değilse çizilmez; "diğerine geç" seçilen İE'yi açar.
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../test/render';
import DocSiblingsStrip from './DocSiblingsStrip';
import type { StationLookupWorkOrder } from '../../services/stationDocLookup.service';

const wo = (n: string, extra: Partial<StationLookupWorkOrder> = {}): StationLookupWorkOrder => ({
  id: `id-${n}`, workOrderNumber: n, status: 'IN_PROGRESS', cardBarcode: `K-${n}`, batchNumbers: [`P-${n}`], documents: [], ...extra,
});
const sibs = [wo('IE1', { processText: 'YIKAMA', atStation: 'HERE' }), wo('IE2', { atStation: 'NOT_YET' }), wo('IE3', { atStation: 'STARTABLE_HERE' })];

function setup(active: string | null, siblings = sibs) {
  const onSwitch = jest.fn();
  const onDismiss = jest.fn();
  const r = renderWithPaper(<DocSiblingsStrip siblings={siblings} activeCardBarcode={active} onSwitch={onSwitch} onDismiss={onDismiss} />);
  return { ...r, onSwitch, onDismiss };
}

it('⭐ aktif kart belgeden açılan → metin + diğerine geç', () => {
  const { getByTestId, getByText, onSwitch } = setup('K-IE1');
  expect(getByTestId('belge-kardes-serit')).toBeTruthy();
  expect(getByText('Bu belgede 3 parti var · açılan: P-IE1 (YIKAMA)')).toBeTruthy();
  expect(() => getByTestId('belge-kardes-IE1')).toThrow();
  fireEvent.press(getByTestId('belge-kardes-IE3'));
  expect(onSwitch).toHaveBeenCalledWith(expect.objectContaining({ workOrderNumber: 'IE3' }));
});

it('⭐ aktif kart eşleşmezse / tek İE / kart yok → şerit yok', () => {
  expect(setup('K-BASKA').queryByTestId('belge-kardes-serit')).toBeNull();
  expect(setup(null).queryByTestId('belge-kardes-serit')).toBeNull();
  expect(setup('K-IE1', [sibs[0]!]).queryByTestId('belge-kardes-serit')).toBeNull();
});

it('kapat → onDismiss', () => {
  const { getByLabelText, onDismiss } = setup('K-IE2');
  fireEvent.press(getByLabelText('Şeridi kapat'));
  expect(onDismiss).toHaveBeenCalled();
});
