// "Toplar ayrı geldi" anahtarı (Gülkesim fason): kapalıyken gövde bugünkü tek parça; açılınca docRolls'tan dolar, top
// eklenir/silinir, gelen metre toplamı izler, gövde SEPARATE + rolls + toplam. Çok partide anahtar çizilmez.
// Negatif sonda: RollRows `set` içindeki `meters: total` kaldırılınca "gelen metre toplamı izler" vakası kırmızı.
import React, { useState } from 'react';
import { act, fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import type { InboundNoteDetail } from '../../../../services/inboundDoc.service';
import RollRows from './RollRows';
import { buildCreateBody, type RowForm } from './woFromDoc';
import type { DocRow, WoRowsState } from './useWoRows';

jest.mock('../../../../components/NumpadInput', () => {
  const RN = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { value: string; onChangeText: (t: string) => void; testID?: string }) => <RN.TextInput value={p.value} onChangeText={p.onChangeText} testID={p.testID} /> };
});

const baseForm: RowForm = { ownerCustomerId: 'c1', ownerSuggested: null, ownerAsk: null, ourBatchNo: 'P-1', ourBatchNoKey: null, meters: 300, metersReview: true, gramajValueId: null };
const opts = { clientToken: 't1', routeTemplateId: 'r1', gramajPropertyId: null };

let current: DocRow;
function Harness({ detail, form = baseForm }: { detail: Partial<InboundNoteDetail>; form?: RowForm }) {
  const [row, setRow] = useState<DocRow>({ noteId: 'n1', noteNo: 'GB-1', runKey: 1, detail: { id: 'n1', noteNo: 'GB-1', ...detail } as InboundNoteDetail, form, gramajTouched: false, result: null });
  current = row;
  const wo = { updateForm: (_id: string, patch: Partial<RowForm>) => setRow((r) => ({ ...r, form: { ...r.form!, ...patch } })) } as unknown as WoRowsState;
  return <RollRows row={row} wo={wo} locked={false} />;
}

describe('RollRows — toplar ayrı geldi', () => {
  it('⭐ anahtar varsayılan KAPALI: satır yok, gövde bugünkü (rollMode/rolls yok)', () => {
    const ui = renderWithPaper(<Harness detail={{}} />);
    expect(ui.getByTestId('belge-ayri-top-GB-1')).toBeTruthy();
    expect(ui.getByTestId('belge-ayri-top-GB-1').props.accessibilityRole).toBe('switch');
    expect(ui.getByTestId('belge-ayri-top-GB-1').props.accessibilityState).toMatchObject({ checked: false });
    expect(ui.queryByTestId('belge-toplar-GB-1')).toBeNull();
    const b = buildCreateBody(current.form!, opts);
    expect(b.kursunMeters).toBe('300');
    expect('rollMode' in b || 'rolls' in b).toBe(false);
  });

  it('⭐ açılınca docRolls dolar; gelen metre toplamı izler; gövde SEPARATE + rolls + toplam; kapatınca eski gövde', () => {
    const ui = renderWithPaper(<Harness detail={{ docRolls: [{ lineNo: 1, meters: 100, weightKg: 25, senderRollNo: 'T1' }, { lineNo: 2, meters: 50, weightKg: null, senderRollNo: null }] }} />);
    act(() => fireEvent.press(ui.getByTestId('belge-ayri-top-GB-1')));
    expect(ui.getByTestId('belge-ayri-top-GB-1').props.accessibilityState).toMatchObject({ checked: true });
    expect(ui.getByTestId('belge-top-GB-1-2')).toBeTruthy();
    expect(current.form!.meters).toBe(150);
    expect(current.form!.metersReview).toBe(false);
    // Top ekle → 3. top metresi gir.
    act(() => fireEvent.press(ui.getByTestId('belge-top-ekle-GB-1')));
    act(() => fireEvent.changeText(ui.getByTestId('belge-top-metre-GB-1-3'), '30,5'));
    act(() => fireEvent.changeText(ui.getByTestId('belge-top-no-GB-1-3'), 'T3'));
    expect(ui.getByTestId('belge-top-toplam-GB-1')).toHaveTextContent(/3 top/);
    expect(current.form!.meters).toBe(180.5);
    expect(buildCreateBody(current.form!, opts)).toMatchObject({
      kursunMeters: '180.5',
      rollMode: 'SEPARATE',
      rolls: [{ meters: 100, weightKg: 25, senderRollNo: 'T1' }, { meters: 50, weightKg: null, senderRollNo: null }, { meters: 30.5, weightKg: null, senderRollNo: 'T3' }],
    });
    // 2. topu sil.
    act(() => fireEvent.press(ui.getByTestId('belge-top-sil-GB-1-2')));
    expect(current.form!.rolls).toHaveLength(2);
    expect(current.form!.meters).toBe(130.5);
    // Kapat → rollMode/rolls gitmez.
    act(() => fireEvent.press(ui.getByTestId('belge-ayri-top-GB-1')));
    expect(ui.queryByTestId('belge-toplar-GB-1')).toBeNull();
    const off = buildCreateBody(current.form!, opts);
    expect('rollMode' in off || 'rolls' in off).toBe(false);
  });

  it('docRolls yok (eski sunucu) → 1 boş satır; tek satır silinemez', () => {
    const ui = renderWithPaper(<Harness detail={{}} />);
    act(() => fireEvent.press(ui.getByTestId('belge-ayri-top-GB-1')));
    expect(current.form!.rolls).toHaveLength(1);
    expect(current.form!.meters).toBeNull();
    expect(ui.getByTestId('belge-top-sil-GB-1-1')).toBeDisabled();
  });

  it('çok partili belgede anahtar çizilmez', () => {
    const ui = renderWithPaper(<Harness detail={{}} form={{ ...baseForm, multi: { mode: 'SINGLE', rows: [{ blockNo: 1, batchNo: '', meters: 1 }, { blockNo: 2, batchNo: '', meters: 2 }] } }} />);
    expect(ui.queryByTestId('belge-ayri-top-GB-1')).toBeNull();
  });
});
