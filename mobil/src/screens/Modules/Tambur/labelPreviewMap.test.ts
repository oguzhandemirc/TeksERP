// Canlı etiket önizlemesi saf eşlemesi: alan → düzenleyici, dokunulamazlar, taslak ve Kes ikinci satırı.
import { editorRect } from './TamburInlineEditor';
import { buildPreviewDraft, editorForKey, kesSubLabel, nextCutMode, widthHintText } from './labelPreviewMap';

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

describe('editorRect (yerinde düzenleme kutusu)', () => {
  it('dokunulan elemanın hizasında açılır, kâğıttan taşmaz', () => {
    const paper = { w: 600, h: 350 };
    expect(editorRect({ x: 20, y: 100, h: 20, align: 'left' }, paper)).toEqual({ left: 20, top: 84, width: 300, height: 52 });
    expect(editorRect({ x: 590, y: 100, h: 20, align: 'left' }, paper).left).toBe(300);
    expect(editorRect({ x: 580, y: 340, h: 20, align: 'right' }, paper)).toEqual({ left: 280, top: 298, width: 300, height: 52 });
  });
});
