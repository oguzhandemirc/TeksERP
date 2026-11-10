// Etiket şablonu seçimi (çoklu etiket seti, 2026-11-11): İE boyunca yapışkan, İE değişince sıfır + `last` tohumu;
// hedef/aşama değişip seçim teklifte yoksa varsayılana dönüş; gövdeye yalnız varsayılandan FARKLI seçim gider.
import {
  cutTemplateId, dropChoice, initialTemplateChoice, offerFromPreview, previewTemplateId, reconcileChoice,
  reprintTemplateWrite, shownTemplateId, templateButtonMode, templatePickerOptions, withChoice, withChoiceScope,
  withChoiceSeed, type TemplateOffer,
} from './labelTemplateChoice';

const opt = (id: string, source: 'DEFAULT' | 'CUSTOMER' | 'GLOBAL' = 'GLOBAL') => ({ id, name: id.toUpperCase(), source, isDefault: source === 'DEFAULT' });
const offerA: TemplateOffer = { kind: 'ROLL_FINISHED', defaultTemplateId: 'tr', options: [opt('tr', 'DEFAULT'), opt('en', 'CUSTOMER'), opt('it')] };
/** Başka müşteri: İngilizce yok. */
const offerB: TemplateOffer = { kind: 'ROLL_FINISHED', defaultTemplateId: 'tr', options: [opt('tr', 'DEFAULT'), opt('it')] };

describe('yapışkanlık (İE kapsamı)', () => {
  it('seçim aynı İE içinde kalır; İE değişince sıfırlanır', () => {
    const s = withChoice(initialTemplateChoice('wo-1'), 'en', offerA);
    expect(withChoiceScope(s, 'wo-1')).toBe(s);
    expect(cutTemplateId(withChoiceScope(s, 'wo-1'), offerA)).toBe('en');
    const next = withChoiceScope(s, 'wo-2');
    expect(next.selectedId).toBeNull();
    expect(cutTemplateId(next, offerA)).toBeUndefined();
  });

  it('İE değişince `last.templateId`ten bir kez tohumlanır; operatör seçimi tohumla ezilmez', () => {
    const seeded = withChoiceSeed(initialTemplateChoice('wo-2'), 'it');
    expect(seeded.selectedId).toBe('it');
    expect(seeded.auto).toBe(true);
    // İkinci tohum (sorgu tazelendi) değişiklik yapmaz.
    expect(withChoiceSeed(seeded, 'en')).toBe(seeded);
    const picked = withChoice(initialTemplateChoice('wo-3'), 'en', offerA);
    expect(withChoiceSeed(picked, 'it').selectedId).toBe('en');
    // `last` boş → varsayılan.
    expect(withChoiceSeed(initialTemplateChoice('wo-4'), null).selectedId).toBeNull();
  });
});

describe('teklif değişimi → varsayılana dönüş', () => {
  it('müşteri değişti, seçim yeni teklifte yok → varsayılan + uyarı', () => {
    const s = withChoice(initialTemplateChoice('wo-1'), 'en', offerA);
    const r = reconcileChoice(s, offerB);
    expect(r.state.selectedId).toBeNull();
    expect(r.warn).toBe(true);
    expect(cutTemplateId(r.state, offerB)).toBeUndefined();
  });

  it('seçim yeni teklifte de var → korunur (aynı nesne)', () => {
    const s = withChoice(initialTemplateChoice('wo-1'), 'it', offerA);
    expect(reconcileChoice(s, offerB).state).toBe(s);
  });

  it('K3: aşama (kind) değişince seçim teklifte olsa da varsayılana döner', () => {
    const s = withChoice(initialTemplateChoice('wo-1'), 'it', offerA);
    const raw: TemplateOffer = { ...offerA, kind: 'ROLL_RAW' };
    expect(reconcileChoice(s, raw).state.selectedId).toBeNull();
    expect(cutTemplateId(s, raw)).toBeUndefined();
  });

  it('tohum teklifte yoksa SESSİZCE düşer; teklifte ise aşamayı benimser', () => {
    const seeded = withChoiceSeed(initialTemplateChoice('wo-1'), 'en');
    const gone = reconcileChoice(seeded, offerB);
    expect(gone.state.selectedId).toBeNull();
    expect(gone.warn).toBe(false);
    const kept = reconcileChoice(seeded, offerA);
    expect(kept.state.selectedId).toBe('en');
    expect(kept.state.kind).toBe('ROLL_FINISHED');
  });

  it('eski backend (teklif yok) seçime dokunmaz', () => {
    const s = withChoice(initialTemplateChoice('wo-1'), 'en', offerA);
    expect(reconcileChoice(s, null).state).toBe(s);
  });

  it('sunucu reddi (LABEL_TEMPLATE_NOT_OFFERED) → varsayılan', () => {
    const s = withChoice(initialTemplateChoice('wo-1'), 'en', offerA);
    const r = dropChoice(s);
    expect(r.state.selectedId).toBeNull();
    expect(r.warn).toBe(true);
    expect(dropChoice(r.state).state).toBe(r.state);
  });
});

describe('gövde: yalnız varsayılandan farklı seçim', () => {
  it('varsayılan seçilirse gövdede alan yok (topa yazılmaz)', () => {
    const s = withChoice(initialTemplateChoice('wo-1'), 'tr', offerA);
    expect(s.selectedId).toBeNull();
    expect(cutTemplateId(s, offerA)).toBeUndefined();
    expect(previewTemplateId(s, offerA)).toBeUndefined();
    expect(shownTemplateId(s, offerA)).toBe('tr');
  });

  it('seçim yokken iki gövdede de alan yok', () => {
    const s = initialTemplateChoice('wo-1');
    expect(cutTemplateId(s, offerA)).toBeUndefined();
    expect(previewTemplateId(s, null)).toBeUndefined();
  });

  it('farklı seçim: önizleme ve kesim gövdesine gider', () => {
    const s = withChoice(initialTemplateChoice('wo-1'), 'en', offerA);
    expect(previewTemplateId(s, offerA)).toBe('en');
    expect(cutTemplateId(s, offerA)).toBe('en');
    expect(shownTemplateId(s, offerA)).toBe('en');
  });

  it('kesim gövdesi teklif bilinmeden (eski backend) alan göndermez', () => {
    const s = withChoiceSeed(initialTemplateChoice('wo-1'), 'en');
    expect(cutTemplateId(s, null)).toBeUndefined();
    // Önizleme tohumu taşır — teklif dışıysa sunucu 400 verir, seçim düşer.
    expect(previewTemplateId(s, null)).toBe('en');
  });
});

describe('düğme ve seçici', () => {
  it('eski backend → legacy; tek seçenek → single (K4); ≥2 → picker', () => {
    expect(templateButtonMode(null)).toBe('legacy');
    expect(templateButtonMode({ ...offerA, options: [opt('tr', 'DEFAULT')] })).toBe('single');
    expect(templateButtonMode(offerA)).toBe('picker');
  });

  it('offerFromPreview: alan yoksa null (eski backend)', () => {
    expect(offerFromPreview({ kind: 'ROLL_FINISHED' })).toBeNull();
    expect(offerFromPreview(null)).toBeNull();
    expect(offerFromPreview({ kind: 'ROLL_RAW', templateOptions: [opt('tr', 'DEFAULT')], defaultTemplateId: 'tr' })).toEqual({
      kind: 'ROLL_RAW', defaultTemplateId: 'tr', options: [opt('tr', 'DEFAULT')],
    });
  });

  it('seçici sırası sunucununki; varsayılan ★ + kaynak alt yazısı', () => {
    expect(templatePickerOptions(offerA)).toEqual([
      { value: 'tr', label: '★ TR', sublabel: 'varsayılan' },
      { value: 'en', label: 'EN', sublabel: 'müşteri' },
      { value: 'it', label: 'IT', sublabel: 'herkes için' },
    ]);
  });
});

describe('yeniden basım (K8)', () => {
  it('aynı şablon → yazma yok; farklı → topa yazılır; varsayılana dönüş → null', () => {
    expect(reprintTemplateWrite('tr', { currentTemplateId: null, defaultTemplateId: 'tr' })).toBeUndefined();
    expect(reprintTemplateWrite('en', { currentTemplateId: 'en', defaultTemplateId: 'tr' })).toBeUndefined();
    expect(reprintTemplateWrite('en', { currentTemplateId: null, defaultTemplateId: 'tr' })).toBe('en');
    expect(reprintTemplateWrite('tr', { currentTemplateId: 'en', defaultTemplateId: 'tr' })).toBeNull();
  });
});
