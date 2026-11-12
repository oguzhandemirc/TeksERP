import { docCopy, showDerivedQuantity, targetHints } from './targetPrefill';
import { applyDocReadCopy, applyOrderLine, buildExtraBody, derivedTargetQuantity, initialFormState, EMPTY_EXTRAS } from './woForm';
import { mergePrefBlob, parseFillTarget } from './woFieldCatalog';

const on = { fill: true, widthEnabled: true, quantityEnabled: true };
const off = { ...on, fill: false };
const fields = { en: 350, hedefMetraj: 241, hedefKg: 734.5 } as never;

describe('targetPrefill', () => {
  it('varsayılan (anahtar kapalı): kopyalama yok; açıkken ayarı açık alanlara kopyalanır', () => {
    expect(docCopy(off)).toEqual({ width: false, targetQuantity: false, targetWeight: false });
    expect(docCopy(on)).toEqual({ width: true, targetQuantity: true, targetWeight: true });
    expect(docCopy({ ...on, quantityEnabled: false })).toEqual({ width: true, targetQuantity: false, targetWeight: false });
    expect(docCopy({ ...on, widthEnabled: false }).width).toBe(false);
  });

  it('ipucu: yalnız kopyalanmayan alanda ve belgede değer varsa', () => {
    expect(targetHints(fields, off)).toEqual({ width: 'belgede 350 cm', targetQuantity: 'belgede 241 m', targetWeight: 'belgede 734,5 kg' });
    expect(targetHints(fields, on)).toEqual({ width: null, targetQuantity: null, targetWeight: null });
    expect(targetHints({ en: 350 } as never, off)).toEqual({ width: 'belgede 350 cm', targetQuantity: null, targetWeight: null });
    expect(targetHints(null, off).width).toBeNull();
  });

  it('applyDocRead: kopyalama kapalıyken hedef kutuları boş, not yine dolar; açıkken dolar', () => {
    const closed = applyDocReadCopy(initialFormState(), 'n1', { fields: { ...(fields as object), not: 'acele' } as never, suggestions: null }, docCopy(off));
    expect(closed.extras).toMatchObject({ width: '', targetQuantity: '', targetWeight: '', note: 'acele' });
    expect(closed.docShown).toEqual(['note']);
    const open = applyDocReadCopy(initialFormState(), 'n1', { fields, suggestions: null }, docCopy(on));
    expect(open.extras).toMatchObject({ width: '350', targetQuantity: '241', targetWeight: '734.5' });
  });

  it('anahtar sonradan açılınca/kapanınca dokunulmamış alan yeni karara uyar', () => {
    const a = applyDocReadCopy(initialFormState(), 'n#1', { fields, suggestions: null }, docCopy(on));
    const b = applyDocReadCopy(a, 'n#0', { fields, suggestions: null }, docCopy(off));
    expect(b.extras.targetQuantity).toBe('');
  });

  it('gelen metre türetmesi yalnız anahtar açık + ayar açıkken', () => {
    expect(showDerivedQuantity(off)).toBe(false);
    expect(showDerivedQuantity(on)).toBe(true);
    expect(derivedTargetQuantity(EMPTY_EXTRAS, 241, { enabled: showDerivedQuantity(off) }).derived).toBe(false);
  });

  it('kapalı ayarda gizli kutudan değer gövdeye gitmez; sipariş eni kapalıyken yazılmaz', () => {
    const e = { ...EMPTY_EXTRAS, width: '150', targetQuantity: '10', targetWeight: '5' };
    expect(buildExtraBody(e, { hasTambur: false, omitWidth: true, omitQuantity: true })).toEqual({});
    const s = applyOrderLine(initialFormState(), { itemId: 'i', itemName: 'x', colorId: null, width: 160 }, false);
    expect(s.extras.width).toBe('');
  });

  it('kişisel anahtar blob\'a yalnız açıkken yazılır; diğer anahtarlar korunur', () => {
    expect(parseFillTarget({ tabletIeForm: { hedefDoldur: true } })).toBe(true);
    expect(parseFillTarget({ tabletIeForm: { gizli: [] } })).toBe(false);
    expect(parseFillTarget(null)).toBe(false);
    expect(mergePrefBlob({ theme: 'dark' }, ['not'], true)).toEqual({ theme: 'dark', tabletIeForm: { gizli: ['not'], hedefDoldur: true } });
    expect(mergePrefBlob({ tabletIeForm: { hedefDoldur: true } }, [], false)).toEqual({ tabletIeForm: { gizli: [] } });
  });
});
