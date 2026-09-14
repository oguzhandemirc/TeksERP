import { EMPTY_RECEIPT_ROW, buildReceiptRequest, receiptFingerprint, rowToPayload, rowsAfterReceipt, validateReceiptRow, validateReturn } from './receiptPayload';

describe('receiptPayload — fason dokuma kabulü (G2t)', () => {
  it('⭐ satır: metre zorunlu pozitif; en/kg boş serbest, negatif red; kalite ≤ 16', () => {
    expect(validateReceiptRow({ ...EMPTY_RECEIPT_ROW, initialQty: '480' }).ok).toBe(true);
    expect(validateReceiptRow(EMPTY_RECEIPT_ROW).ok).toBe(false);
    expect(validateReceiptRow({ ...EMPTY_RECEIPT_ROW, initialQty: '0' }).ok).toBe(false);
    expect(validateReceiptRow({ ...EMPTY_RECEIPT_ROW, initialQty: '10', weightKg: '-1' }).ok).toBe(false);
    expect(validateReceiptRow({ ...EMPTY_RECEIPT_ROW, initialQty: '10', qualityGrade: 'x'.repeat(17) }).ok).toBe(false);
  });
  it('⭐ yük backend receiptSchema ile birebir: boş = null ("0" ≠ girilmedi), renk boş = işin rengi', () => {
    expect(rowToPayload({ initialQty: '480', width: '', weightKg: '0', qualityGrade: ' A ', colorId: null })).toEqual({ initialQty: 480, width: null, weightKg: 0, qualityGrade: 'A', colorId: null });
    const req = buildReceiptRequest([{ ...EMPTY_RECEIPT_ROW, initialQty: '1', colorId: 'c1' }], { weavingOrderId: 'w1', manifestNo: ' ', notes: 'n', clientToken: 'tok' });
    expect(req).toEqual({ weavingOrderId: 'w1', manifestNo: null, notes: 'n', clientToken: 'tok', rolls: [{ initialQty: 1, width: null, weightKg: null, qualityGrade: null, colorId: 'c1' }] });
  });
  it('⭐ failed[] satırları FORMDA KALIR (kısmi kabul: doğanlar kabul edildi), hepsi doğduysa form boşalır', () => {
    const rows = [{ ...EMPTY_RECEIPT_ROW, initialQty: '480' }, { ...EMPTY_RECEIPT_ROW, initialQty: '470' }, { ...EMPTY_RECEIPT_ROW, initialQty: '9' }];
    const r = rowsAfterReceipt(rows, { receipt: { id: 'r', receiptNo: 'FK-1' }, rolls: [], failed: [{ index: 2, message: 'Renk yok' }] });
    expect(r.rows).toEqual([rows[2]]);
    expect(r.messages).toEqual(['Satır 3: Renk yok']);
    expect(rowsAfterReceipt(rows, { receipt: { id: 'r', receiptNo: 'FK-1' }, rolls: [], failed: [] }).rows).toEqual([]);
  });
  it('parmak izi iş + satır sayısı + toplam metre; dönen metre gideni aşamaz', () => {
    const rows = [{ ...EMPTY_RECEIPT_ROW, initialQty: '480' }];
    expect(receiptFingerprint('w1', rows)).toBe('w1|1|480.00');
    expect(receiptFingerprint('w1', [...rows, rows[0]])).not.toBe(receiptFingerprint('w1', rows));
    expect(validateReturn('30', 800).ok).toBe(true);
    expect(validateReturn('801', 800).ok).toBe(false);
    expect(validateReturn('', 800).ok).toBe(false);
  });
});
