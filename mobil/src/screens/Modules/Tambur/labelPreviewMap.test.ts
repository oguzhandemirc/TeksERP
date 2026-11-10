// Canlı etiket önizlemesi saf eşlemesi: alan → düzenleyici, dokunulamazlar, taslak ve Kes ikinci satırı.
import { editorCardSize, floatingEditorPos } from './TamburInlineEditor';
import { buildPreviewDraft, editorForKey, emptyFieldText, isSystemAssignedField, kesSubLabel, nextCutMode, widthHintText } from './labelPreviewMap';

const own = { owner: false, batchEnabled: true, manualLength: true };

describe('editorForKey', () => {
  it('ad/renk/parti ve sayılar kendi yerinde düzenleyicisine', () => {
    expect(editorForKey('itemName', own)).toBe('itemName');
    expect(editorForKey('deliveryNoteColorText', own)).toBe('colorName');
    expect(editorForKey('labelBatchNo', own)).toBe('batch');
    expect(editorForKey('lengthMeters', own)).toBe('length');
    expect(editorForKey('weightKg', own)).toBe('kg');
    expect(editorForKey('widthCm', own)).toBe('width');
    expect(editorForKey('qualityGrade', own)).toBe('quality');
    expect(editorForKey('customerName', own)).toBe('customer');
  });

  it('barkod, tarih, sabit metin (anahtarsız) ve bilinmeyen alanlar dokunulamaz', () => {
    expect(editorForKey(null, own)).toBeNull();
    expect(editorForKey(undefined, own)).toBeNull();
    expect(editorForKey('printedAt', own)).toBeNull();
    expect(editorForKey('barcode', own)).toBeNull();
    expect(editorForKey('rollNo', own)).toBeNull();
  });

  it('emanet topta müşteri kilitli, alıcı açık; kendi topta alıcı kapalı', () => {
    const fason = { ...own, owner: true };
    expect(editorForKey('customerName', fason)).toBeNull();
    expect(editorForKey('consigneeName', fason)).toBe('consignee');
    expect(editorForKey('consigneeName', own)).toBeNull();
  });

  it('otomatik ölçümde metre dokunulamaz; parti ayarı kapalıysa parti dokunulamaz', () => {
    expect(editorForKey('lengthMeters', { ...own, manualLength: false })).toBeNull();
    expect(editorForKey('customerBatchNo', { ...own, batchEnabled: false })).toBeNull();
  });
});

describe('buildPreviewDraft', () => {
  const base = { lengthText: '', kgText: '', widthText: '', qualityCode: null, itemName: '', colorName: '', batch: { enabled: false, value: 'P1' } };
  it('boş alanlar null (sunucu kaynağı basar; boş metre = kalanı kes)', () => {
    expect(buildPreviewDraft(base)).toEqual({
      lengthMeters: null, weightKg: null, widthCm: null, qualityGrade: null, labelItemName: null, labelColorName: null, labelBatchNo: null,
    });
  });
  it('virgüllü sayılar ve kırpılmış metinler; parti yalnız ayar açıkken', () => {
    const d = buildPreviewDraft({ ...base, lengthText: '7,5', kgText: '1,42', widthText: '300', qualityCode: 'A1', itemName: ' HHHH ', batch: { enabled: true, value: ' P9 ' } });
    expect(d).toMatchObject({ lengthMeters: 7.5, weightKg: 1.42, widthCm: 300, qualityGrade: 'A1', labelItemName: 'HHHH', labelBatchNo: 'P9' });
  });
  it('sıfır/bozuk sayı taslağa girmez', () => {
    expect(buildPreviewDraft({ ...base, lengthText: '0', kgText: 'x' })).toMatchObject({ lengthMeters: null, weightKg: null });
  });
});

describe('kesSubLabel / nextCutMode', () => {
  it('metre boş → kalanı kes · X m; otomatik → makineden ölç; metre dolu → satır yok', () => {
    expect(kesSubLabel('manual', '', 170)).toBe('kalanı kes · 170.0 m');
    expect(kesSubLabel('auto', '', 170)).toBe('makineden ölç');
    expect(kesSubLabel('manual', '50', 170)).toBeNull();
    expect(kesSubLabel('manual', '', 0)).toBeNull();
  });
  it('kalite seçilmemiş (Kes kapalı) → ikinci satır "önce kalite seçin", kip/metreden önce', () => {
    expect(kesSubLabel('manual', '', 170, false)).toBe('önce kalite seçin');
    expect(kesSubLabel('auto', '50', 170, false)).toBe('önce kalite seçin');
    expect(kesSubLabel('manual', '', 170, true)).toBe('kalanı kes · 170.0 m');
  });
  it('tek kip düğmesi diğer kipe geçer', () => {
    expect(nextCutMode('manual')).toBe('auto');
    expect(nextCutMode('auto')).toBe('manual');
  });
});

describe('widthHintText', () => {
  it('top eni önce, yoksa önizlemenin miras eni, ikisi yoksa null', () => {
    expect(widthHintText(300, 280)).toBe('300');
    expect(widthHintText(null, 300)).toBe('300');
    expect(widthHintText(0, 152.5)).toBe('152,5');
    expect(widthHintText(null, undefined)).toBeNull();
  });
});

describe('yüzen yerinde düzenleme kartı', () => {
  const win = { w: 1280, h: 800 };
  it('kart boyu: metin tek satır, sayı tuş takımıyla; alçak pencerede kısa tuşlar', () => {
    expect(editorCardSize('text', win)).toEqual({ w: 460, h: 106, compactKeys: false });
    expect(editorCardSize('number', win)).toEqual({ w: 360, h: 410, compactKeys: false });
    expect(editorCardSize('number', { w: 1280, h: 500 })).toEqual({ w: 360, h: 330, compactKeys: true });
    expect(editorCardSize('text', { w: 400, h: 800 }).w).toBe(368);
  });
  it('giriş satırı dokunulan alanın satırına oturur, kart pencereden taşmaz', () => {
    const card = { w: 460, h: 106 };
    expect(floatingEditorPos({ x: 300, y: 400, h: 20, align: 'left' }, card, win)).toEqual({ left: 276, top: 344 });
    expect(floatingEditorPos({ x: 1200, y: 400, h: 20, align: 'left' }, card, win).left).toBe(804);
    expect(floatingEditorPos({ x: 900, y: 400, h: 20, align: 'right' }, card, win).left).toBe(592);
    expect(floatingEditorPos({ x: 640, y: 400, h: 20, align: 'center' }, card, win).left).toBe(410);
    expect(floatingEditorPos({ x: 300, y: 780, h: 20, align: 'left' }, card, win).top).toBe(678);
    expect(floatingEditorPos({ x: 300, y: 0, h: 20, align: 'left' }, card, win, 30).top).toBe(46);
  });
});

describe('emptyFieldText (yalnız önizleme)', () => {
  it('alan etiketi ya da alan adı + "— boş"', () => {
    expect(emptyFieldText('', 'weightKg')).toBe('Kg — boş');
    expect(emptyFieldText('Lot:', 'labelBatchNo')).toBe('Lot — boş');
    expect(emptyFieldText('', 'bilinmeyen')).toBe('Alan — boş');
  });
});

describe('isSystemAssignedField — kesimde sistemin atadığı alan "boş" değildir', () => {
  it('backend auto işareti ya da (eski backend) sistem bind\'ında boş alan', () => {
    expect(isSystemAssignedField({ bind: 'barcode', auto: true })).toBe(true);
    expect(isSystemAssignedField({ bind: 'barcode', empty: true })).toBe(true);
    expect(isSystemAssignedField({ bind: 'printedAt', empty: true })).toBe(true);
  });
  it('veri alanı (En, Kg) ve dolu sistem alanı sistem-atamalı sayılmaz', () => {
    expect(isSystemAssignedField({ bind: 'weightKg', empty: true })).toBe(false);
    expect(isSystemAssignedField({ bind: 'widthCm', empty: true })).toBe(false);
    expect(isSystemAssignedField({ bind: 'printedAt' })).toBe(false);
    expect(isSystemAssignedField({ bind: null, empty: true })).toBe(false);
  });
});
