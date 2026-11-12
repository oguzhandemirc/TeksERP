// =============================================================================
// GK bekçisi — "İşi Bitir" özetli onay (2026-11-10)
// =============================================================================
// Özet: İE no · top · Σ metre · Σ hata; kontrolü tamamlanmamış top sarı uyarı. Onaysız kapanış yok
// (Vazgeç'te onConfirm çağrılmaz). Negatif sonda: unchecked süzgeci `qc2Completed` yerine hep 0 dönünce §1b/§2b kırmızı.
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import FinishStepConfirm from './FinishStepConfirm';
import { finishQuestion, finishSummaryOf, uncheckedWarning } from './finishSummary';

const roll = (currentQty: number, errorCount: number, qc2Completed: boolean) => ({ currentQty, errorCount, qc2Completed });

describe('§1 finishSummaryOf', () => {
  it('§1a hepsi tamam: soru metni, uyarı yok', () => {
    const s = finishSummaryOf({ batchNumber: 'IE-2026-0042', rolls: [roll(100.1, 2, true), roll(50.2, 0, true)] });
    expect(s).toEqual({ cardNumber: 'IE-2026-0042', rollCount: 2, totalMeters: 150.3, defectCount: 2, unchecked: 0 });
    expect(finishQuestion(s)).toBe('IE-2026-0042 · 2 top · 150.3 m · 2 hata — İşi bitir?');
    expect(uncheckedWarning(s)).toBeNull();
  });
  it('§1b kontrol edilmemiş top sayılır', () => {
    const s = finishSummaryOf({ batchNumber: 'IE-1', rolls: [roll(10, 0, true), roll(20, 1, false), roll(30, 0, false)] });
    expect(s.unchecked).toBe(2);
    expect(uncheckedWarning(s)).toBe('2 top kontrol edilmedi');
    expect(finishQuestion(s)).toBe('IE-1 · 3 top · 60 m · 1 hata — İşi bitir?');
  });
});

describe('§2 FinishStepConfirm', () => {
  const s = finishSummaryOf({ batchNumber: 'IE-9', rolls: [roll(10, 0, true), roll(5, 0, false)] });
  it('§2a özet görünür; İşi Bitir onConfirm, Vazgeç onCancel', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const r = renderWithPaper(<FinishStepConfirm summary={s} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(r.getByTestId('kursun-finish-question').props.children).toBe('IE-9 · 2 top · 15 m · 0 hata — İşi bitir?');
    fireEvent.press(r.getByTestId('kursun-finish-cancel'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
    fireEvent.press(r.getByTestId('kursun-finish-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
  it('§2b eksik kontrolde sarı satır; hepsi tamamsa yok', () => {
    const r = renderWithPaper(<FinishStepConfirm summary={s} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(r.getByTestId('kursun-finish-unchecked')).toBeTruthy();
    r.unmount();
    const ok = finishSummaryOf({ batchNumber: 'IE-9', rolls: [roll(10, 0, true)] });
    const r2 = renderWithPaper(<FinishStepConfirm summary={ok} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(r2.queryByTestId('kursun-finish-unchecked')).toBeNull();
  });
});
