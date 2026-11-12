// Belgeden açılan işin kompakt parti seçicisi: aktif kart belgeden açılan değilse / tek partide çizilmez; segment
// seçili partiyi dolu gösterir, diğerine basmak onu açar; >3 partide PickerModal; eski şerit metni ve kapat düğmesi yok.
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
  const r = renderWithPaper(<DocSiblingsStrip siblings={siblings} activeCardBarcode={active} onSwitch={onSwitch} />);
  return { ...r, onSwitch };
}

it('⭐ segment: "Parti" + her parti; seçili dolu, diğerine basmak onu açar', () => {
  const { getByTestId, getByText, queryByText, queryByLabelText, onSwitch } = setup('K-IE1');
  expect(getByTestId('belge-parti-secici')).toBeTruthy();
  expect(getByText('Parti')).toBeTruthy();
  expect(getByTestId('belge-kardes-IE1').props.accessibilityState).toMatchObject({ selected: true });
  expect(getByTestId('belge-kardes-IE2').props.accessibilityState).toMatchObject({ selected: false });
  expect(queryByText(/Bu belgede/)).toBeNull();
  expect(queryByLabelText('Şeridi kapat')).toBeNull();
  fireEvent.press(getByTestId('belge-kardes-IE1'));
  expect(onSwitch).not.toHaveBeenCalled();
  fireEvent.press(getByTestId('belge-kardes-IE3'));
  expect(onSwitch).toHaveBeenCalledWith(expect.objectContaining({ workOrderNumber: 'IE3' }));
});

it('⭐ aktif kart eşleşmezse / tek parti / kart yok → çizilmez', () => {
  expect(setup('K-BASKA').queryByTestId('belge-parti-secici')).toBeNull();
  expect(setup(null).queryByTestId('belge-parti-secici')).toBeNull();
  expect(setup('K-IE1', [sibs[0]!]).queryByTestId('belge-parti-secici')).toBeNull();
});

it('⭐ 3ten fazla parti → "Parti P-IE2 ▾" düğmesi, segment yok', () => {
  const four = [...sibs, wo('IE4')];
  const { getByTestId, queryByTestId, getAllByText } = setup('K-IE2', four);
  expect(getByTestId('belge-parti-ac')).toBeTruthy();
  expect(queryByTestId('belge-kardes-IE1')).toBeNull();
  expect(getAllByText('P-IE2').length).toBeGreaterThan(0);
});
