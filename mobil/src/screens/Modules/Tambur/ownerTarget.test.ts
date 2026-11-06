import { renderHook } from '@testing-library/react-native';
import { ownerDefaultDecision, useOwnerDefaultTarget, type OwnerRef } from './ownerTarget';

const OWNER: OwnerRef = { id: 'c1', name: 'TEST-Fason Müşteri' };

describe('ownerDefaultDecision — fason topta Kime? varsayılanı', () => {
  it('sahipli top, hedef boş → sahibe çek', () => {
    expect(ownerDefaultDecision({ rollId: 'r1', owner: OWNER, hasTarget: false, decidedFor: null })).toBe('apply');
  });
  it('sahipsiz (kendi) top → bugünkü davranış: dokunma (Stok)', () => {
    expect(ownerDefaultDecision({ rollId: 'r1', owner: null, hasTarget: false, decidedFor: null })).toBe('none');
    expect(ownerDefaultDecision({ rollId: 'r1', owner: undefined, hasTarget: false, decidedFor: null })).toBe('none');
  });
  it('operatör zaten hedef seçmiş → ezme, yalnız işaretle', () => {
    expect(ownerDefaultDecision({ rollId: 'r1', owner: OWNER, hasTarget: true, decidedFor: null })).toBe('mark');
  });
  it('bu top için karar verildi (operatör Stok seçti) → yeniden önerme', () => {
    expect(ownerDefaultDecision({ rollId: 'r1', owner: OWNER, hasTarget: false, decidedFor: 'r1' })).toBe('none');
  });
  it('top yok → karar yok', () => {
    expect(ownerDefaultDecision({ rollId: null, owner: OWNER, hasTarget: false, decidedFor: null })).toBe('none');
  });
});

describe('useOwnerDefaultTarget', () => {
  type P = { rollId: string | null; owner: OwnerRef | null | undefined; hasTarget: boolean };
  const setup = (initial: P) => {
    const apply = jest.fn();
    const h = renderHook((p: P) => useOwnerDefaultTarget(p.rollId, p.owner, p.hasTarget, apply), { initialProps: initial });
    return { apply, h };
  };

  it('ayar yüklenince bir kez uygular; operatörün Stok seçimini ezmez; yeni topta yeniden uygular', () => {
    const { apply, h } = setup({ rollId: 'r1', owner: undefined, hasTarget: false });
    expect(apply).not.toHaveBeenCalled();
    h.rerender({ rollId: 'r1', owner: OWNER, hasTarget: false });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(OWNER);
    h.rerender({ rollId: 'r1', owner: OWNER, hasTarget: true });
    h.rerender({ rollId: 'r1', owner: OWNER, hasTarget: false }); // Stok seçildi
    expect(apply).toHaveBeenCalledTimes(1);
    h.rerender({ rollId: 'r2', owner: OWNER, hasTarget: false });
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('ekran aynı top için durumu sıfırlarsa (redecide) hedef yeniden sahibe çekilir', () => {
    const { apply, h } = setup({ rollId: 'r1', owner: OWNER, hasTarget: false });
    expect(apply).toHaveBeenCalledTimes(1);
    h.rerender({ rollId: 'r1', owner: OWNER, hasTarget: true });
    h.result.current();
    h.rerender({ rollId: 'r1', owner: OWNER, hasTarget: false });
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('top temizlenip aynı top yeniden okutulunca (recut kapat-aç) yeniden uygular', () => {
    const { apply, h } = setup({ rollId: 'r1', owner: OWNER, hasTarget: false });
    h.rerender({ rollId: null, owner: undefined, hasTarget: false });
    h.rerender({ rollId: 'r1', owner: OWNER, hasTarget: false });
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
