// S16b tek form saf parçaları: giriş kipi, seçici karoları, belgeden doldurma, engeller, form ucu ek gövdesi.
import { factoryDayStartIso } from '../../../../lib/factory-time';
import {
  applyDocRead,
  applyOrderLine,
  buildExtraBody,
  clearDocRead,
  createBlockReason,
  derivedTargetQuantity,
  editExtras,
  extrasIssues,
  hubTiles,
  initialFormState,
  parseFormNumber,
  plannedDayOptions,
  resolveWoEntry,
  type WoFormExtras,
} from './woForm';

const extras = (x: Partial<WoFormExtras> = {}): WoFormExtras => ({ ...initialFormState().extras, ...x });

describe('resolveWoEntry', () => {
  it('tanınan değer kazanır; yok / çöp → IKISI (bugünkü ekran)', () => {
    expect(resolveWoEntry('BELGE')).toBe('BELGE');
    expect(resolveWoEntry('TOP')).toBe('TOP');
    expect(resolveWoEntry(undefined)).toBe('IKISI');
    expect(resolveWoEntry('belge')).toBe('IKISI');
    expect(resolveWoEntry(null, 'TOP')).toBe('TOP');
  });
});

describe('hubTiles', () => {
  const a = { canManual: true, shortcuts: 2, loading: false };
  it('⭐ IKISI bugünkü karolar: Hızlı İE + masa (kısayol varken) / Belge Tara (kısayolsuz)', () => {
    expect(hubTiles('IKISI', a)).toEqual({ quick: true, form: false, desk: true, legacy: false });
    expect(hubTiles('IKISI', { ...a, shortcuts: 0 })).toEqual({ quick: true, form: false, desk: false, legacy: true });
    expect(hubTiles('IKISI', { ...a, shortcuts: 0, loading: true }).legacy).toBe(false);
    expect(hubTiles('IKISI', { ...a, canManual: false }).quick).toBe(false);
  });
  it('⭐ BELGE: yalnız tek form; top, masa ve Belge Tara gizli', () => {
    expect(hubTiles('BELGE', a)).toEqual({ quick: false, form: true, desk: false, legacy: false });
    expect(hubTiles('BELGE', { ...a, shortcuts: 0 })).toEqual({ quick: false, form: true, desk: false, legacy: false });
  });
  it('TOP: yalnız Hızlı İE', () => {
    expect(hubTiles('TOP', a)).toEqual({ quick: true, form: false, desk: false, legacy: false });
  });
});

describe('parseFormNumber', () => {
  it('sayı, TR biçimi ve nokta ondalık; ≤0 / çözülemeyen → null', () => {
    expect(parseFormNumber(150)).toBe(150);
    expect(parseFormNumber('1.234,5')).toBe(1234.5);
    expect(parseFormNumber('12,75')).toBe(12.75);
    expect(parseFormNumber('150.5')).toBe(150.5);
    expect(parseFormNumber(' 2 400 ')).toBe(2400);
    expect(parseFormNumber('0')).toBeNull();
    expect(parseFormNumber(-3)).toBeNull();
    expect(parseFormNumber('abc')).toBeNull();
    expect(parseFormNumber('')).toBeNull();
    expect(parseFormNumber(null)).toBeNull();
  });
});

describe('applyDocRead / editExtras / clearDocRead', () => {
  const fields = { hedefMetraj: '1.250,5', hedefKg: 310, en: '150', desenText: 'DSN-7', renkText: 'Ekru', not: 'Acele' };
  const sugg = { targetItem: { id: 'i1', name: 'Tül Beyaz', code: 'T-1' }, targetColor: { id: 'c1', name: 'Ekru' } };

  it('⭐ okunan değerler inputlara dolar + rozet; öneri alana YAZILMAZ', () => {
    const s = applyDocRead(initialFormState(), 'n1#1', fields, sugg);
    expect(s.extras).toMatchObject({ width: '150', targetQuantity: '1250.5', targetWeight: '310', note: 'Acele', targetItemId: null, targetColorId: null });
    expect(s.fromDoc.sort()).toEqual(['note', 'targetQuantity', 'targetWeight', 'width']);
    expect(s.suggestions.targetItem?.id).toBe('i1');
    expect(s.docText).toEqual({ desen: 'DSN-7', renk: 'Ekru' });
  });

  it('⭐ elle değiştirilen alan sonraki okumada EZİLMEZ; dokunulmayan yeni belgeyle değişir', () => {
    let s = applyDocRead(initialFormState(), 'n1#1', fields, null);
    s = editExtras(s, { width: '160' });
    expect(s.fromDoc).not.toContain('width');
    s = applyDocRead(s, 'n2#1', { en: '140', hedefMetraj: '900' }, null);
    expect(s.extras.width).toBe('160');
    expect(s.extras.targetQuantity).toBe('900');
    expect(s.extras.targetWeight).toBe('');
    expect(s.fromDoc).toEqual(['targetQuantity']);
  });

  it('aynı okuma iki kez uygulanmaz', () => {
    const s = applyDocRead(initialFormState(), 'n1#1', fields, null);
    const e = editExtras(s, { note: '' });
    expect(applyDocRead({ ...e, touched: [] }, 'n1#1', fields, null)).toEqual({ ...e, touched: [] });
  });

  it('belge çıkınca belgeden gelen dokunulmamış alanlar ve öneriler temizlenir, elle girilen kalır', () => {
    let s = applyDocRead(initialFormState(), 'n1#1', fields, sugg);
    s = editExtras(s, { note: 'Benim notum' });
    s = clearDocRead(s);
    expect(s.extras).toMatchObject({ width: '', targetQuantity: '', targetWeight: '', note: 'Benim notum' });
    expect(s.suggestions).toEqual({});
    expect(s.appliedNoteId).toBeNull();
  });

  it('sipariş kalemi boş kumaş/renk/eni doldurur, doluyu ezmez', () => {
    const line = { itemId: 'i9', itemName: 'Saten', colorId: 'c9', width: 180 };
    const s = applyOrderLine(initialFormState(), line);
    expect(s.extras).toMatchObject({ targetItemId: 'i9', targetItemLabel: 'Saten', targetColorId: 'c9', width: '180' });
    const t = applyOrderLine(editExtras(initialFormState(), { width: '150', targetColorId: 'c1' }), line);
    expect(t.extras).toMatchObject({ width: '150', targetColorId: 'c1', targetItemId: 'i9' });
  });
});

describe('docShown (belgeden dolan alanın yeri) / applyOrderLine özellik kuralı / engel yeri', () => {
  it('⭐ elle düzeltme rozeti düşürür ama okuma boyunca docShown sabit; yeni okuma ve belge çıkarma yeniler', () => {
    let s = applyDocRead(initialFormState(), 'n1#1', { en: '150', not: 'Acele' }, null);
    expect(s.docShown.sort()).toEqual(['note', 'width']);
    s = editExtras(s, { width: '160' });
    expect(s.fromDoc).toEqual(['note']);
    expect(s.docShown.sort()).toEqual(['note', 'width']);
    s = applyDocRead(s, 'n2#1', { not: 'Yeni' }, null);
    expect(s.docShown).toEqual(['note']);
    expect(clearDocRead(s).docShown).toEqual([]);
  });

  it('sipariş kalemi hedef kumaşı atarsa elle seçilen özellik kümesi boşalır; dokunulmamış küme null kalır', () => {
    const line = { itemId: 'i9', itemName: 'Kumaş', colorId: null, width: null };
    const touched = applyOrderLine({ ...initialFormState(), extras: extras({ propertyIds: ['p1'] }) }, line);
    expect(touched.extras).toMatchObject({ targetItemId: 'i9', propertyIds: [] });
    expect(applyOrderLine(initialFormState(), line).extras.propertyIds).toBeNull();
    // Hedef kumaş zaten doluysa kalem onu ezmez → küme de korunur.
    const kept = applyOrderLine({ ...initialFormState(), extras: extras({ targetItemId: 'i1', propertyIds: ['p1'] }) }, line);
    expect(kept.extras.propertyIds).toEqual(['p1']);
  });

  it('engel gizli alandaysa ipucu yerini söyler', () => {
    const e = extras({ woType: 'ORDER_PRODUCTION', steps: [] });
    const c = { routeChosen: true, hasTambur: false, inOther: (k: string) => k === 'isEmriTuru' };
    const out = extrasIssues(e, c);
    expect(out[0]).toMatch(/Siparişe üretim.*"Diğer alanlar" bölümünde/);
    expect(out[1]).toBe('Rotada en az bir adım kalmalı.');
  });
});

describe('extrasIssues / createBlockReason', () => {
  it('rota, sayı, kat ve tarih engelleri', () => {
    expect(extrasIssues(extras(), { routeChosen: false, hasTambur: false })).toEqual(['Rotayı seçin.']);
    expect(extrasIssues(extras({ width: 'x', targetQuantity: '0' }), { routeChosen: true, hasTambur: false })).toEqual([
      'En sıfırdan büyük bir sayı olmalı.',
      'Hedef metraj sıfırdan büyük bir sayı olmalı.',
    ]);
    expect(extrasIssues(extras(), { routeChosen: true, hasTambur: true })).toEqual(['Kat tipini seçin.']);
    expect(extrasIssues(extras({ plannedStart: '2026-11-10', plannedEnd: '2026-11-09' }), { routeChosen: true, hasTambur: false })).toEqual(['Planlı bitiş başlangıçtan önce olamaz.']);
  });
  it('PER_PARTY: hedef metraj/kg denetlenmez (gönderilmez)', () => {
    expect(extrasIssues(extras({ targetQuantity: 'x', targetWeight: 'y' }), { routeChosen: true, hasTambur: false, perParty: true })).toEqual([]);
  });
  it('⭐ belge okutulmadan oluştur kapalı; okunurken kapalı; sonra ilk engel', () => {
    expect(createBlockReason({ hasDoc: false, reading: false, issues: [] })).toMatch(/Belge okut/);
    expect(createBlockReason({ hasDoc: true, reading: true, issues: [] })).toBe('Belge okunuyor…');
    expect(createBlockReason({ hasDoc: true, reading: false, issues: ['Müşteriyi seçin.'] })).toBe('Müşteriyi seçin.');
    expect(createBlockReason({ hasDoc: true, reading: false, issues: [] })).toBeNull();
  });
});

describe('buildExtraBody', () => {
  const full = extras({
    targetItemId: 'i1',
    targetColorId: 'c1',
    width: '150',
    targetQuantity: '1.200,5',
    targetWeight: '300',
    foldType: 'K4',
    plannedStart: '2026-11-05',
    plannedEnd: '2026-11-07',
    note: '  Acele  ',
    orderLineIds: ['l1'],
  });

  it('⭐ dolu alanlar sözleşme adlarıyla gider (tarih fabrika günü başı)', () => {
    expect(buildExtraBody(full, { hasTambur: true })).toEqual({
      targetItemId: 'i1',
      targetColorId: 'c1',
      width: 150,
      targetQuantity: 1200.5,
      targetWeight: 300,
      foldType: 'K4',
      plannedStartDate: factoryDayStartIso('2026-11-05'),
      plannedEndDate: factoryDayStartIso('2026-11-07'),
      notes: 'Acele',
      orderLineIds: ['l1'],
    });
  });
  it('⭐ PER_PARTY: hedef metraj/kg GÖNDERİLMEZ (S16a 400)', () => {
    const b = buildExtraBody(full, { hasTambur: true, perParty: true });
    expect(b).not.toHaveProperty('targetQuantity');
    expect(b).not.toHaveProperty('targetWeight');
    expect(b.width).toBe(150);
  });
  it('kat yalnız tamburlu rotada; boş form → boş gövde (bugünkü türetme)', () => {
    expect(buildExtraBody(full, { hasTambur: false })).not.toHaveProperty('foldType');
    expect(buildExtraBody(extras(), { hasTambur: true })).toEqual({});
  });
});

describe('plannedDayOptions', () => {
  it('bugünden başlar, istenen gün sayısı', () => {
    const o = plannedDayOptions(new Date('2026-11-04T09:00:00Z'), 3);
    expect(o.map((x) => x.value)).toEqual(['2026-11-04', '2026-11-05', '2026-11-06']);
    expect(o[0].label).toMatch(/^Bugün · /);
    expect(o[1].label).toMatch(/^Yarın · /);
  });
});

describe('derivedTargetQuantity (hedef metraj gelen metreyi izler)', () => {
  const on = { enabled: true };
  it('boş hedef + ayar açık → gelen metre, türetilmiş', () => {
    expect(derivedTargetQuantity(extras(), 740.5, on)).toEqual({ value: '740.5', derived: true });
  });
  it('okunan ya da elle girilen hedef kalır', () => {
    expect(derivedTargetQuantity(extras({ targetQuantity: '480' }), 740.5, on)).toEqual({ value: '480', derived: false });
  });
  it('ayar kapalı, PER_PARTY ya da gelen metre yok → türetme yok', () => {
    expect(derivedTargetQuantity(extras(), 740.5, { enabled: false }).derived).toBe(false);
    expect(derivedTargetQuantity(extras(), 740.5, { enabled: true, perParty: true }).derived).toBe(false);
    expect(derivedTargetQuantity(extras(), null, on)).toEqual({ value: '', derived: false });
  });
  it('türetilmiş değer gövdeye konmaz (sunucu türetir)', () => {
    expect(buildExtraBody(extras(), { hasTambur: false }).targetQuantity).toBeUndefined();
  });
});
