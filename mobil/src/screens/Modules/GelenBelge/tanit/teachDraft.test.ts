// Tablet tanıtma çekirdeği (panel `tanitma.test.tsx` saf bölümünün aynası) + sayfa eşleme / fotoğraf boyutu.
import type { ScanWord, ScanWords } from '../../../../types/inboundDocTeach';
import {
  adoptTemplate, assignColumn, assignField, initialTeach, keptOldFields, meterOnCountRow, oldParts, setRepeats, toggleKeepOld, suggestBody, suggestIdentifiers, teachErrText, teachMarks, teachProblems, toggleWord, wordAt, MAX_TEMPLATE_IDENTIFIERS, addIdentifier, isKept, locateKept, templateFieldKeys,
  templateMultiParty, meterKgClashes,
} from './teachDraft';
import { sameCellRatio } from './olcuCakisma';
import { chipStatus, fieldReadout, toggleFieldWord } from './guided';
import { dropKept, stageMarks, undoDrop } from './stages';
import { isUnrecognized, photoSize, teachPages } from './teachPages';

// Fotoğraf dönük saklanmış gibi: photoRect ≠ rect (öneri OCR çerçevesini almalı).
const w = (text: string, [x, y]: [number, number], lineNo: number, width = 60): ScanWord => ({
  text, rect: { x, y, width, height: 20 }, photoRect: { x: x + 1000, y: y + 2000, width, height: 20 }, lineNo, confidence: 0.99,
});
const SCAN: ScanWords = {
  imageWidth: 1000, imageHeight: 1500, rotation: 0,
  words: [
    w('GÜLEÇSOY', [50, 20], 1, 120), w('BOYA', [180, 20], 1), w('ÇEKİ', [50, 60], 2), w('LİSTESİ', [120, 60], 2),
    w('Ham', [50, 300], 3), w('PartiNo:', [100, 300], 3), w('P2618733', [200, 300], 3, 90),
    w('Metre', [50, 600], 4), w('Kilo', [200, 600], 4), w('1234', [50, 1000], 9),
  ],
};
const W = SCAN.words;

describe('tanıtma çekirdeği (tablet)', () => {
  it('dokunulan nokta fotoğraf çerçevesindeki kelimeyi bulur; boşluk null', () => {
    expect(wordAt(W, { x: 1210, y: 2310 })).toBe(6);
    expect(wordAt(W, { x: 10, y: 10 })).toBeNull();
  });

  it('kimlik önerisi üst bölgedeki yazı satırları, hazır seçili; rakam satırı ve alt bölge dışarıda', () => {
    expect(suggestIdentifiers(SCAN)).toEqual(['GÜLEÇSOY BOYA', 'ÇEKİ LİSTESİ', 'Ham PartiNo: P2618733']);
    expect(initialTeach(SCAN, 'Güleçsoy').identifiers.every((d) => d.on)).toBe(true);
  });

  it('kutu atama → öneri gövdesi: OCR çerçevesinde kutu; değeri içeren kimlik kapanır; sütun başlığı kimlik olur', () => {
    let s = initialTeach(SCAN, 'Güleçsoy');
    s = assignField(toggleWord(s, 6), W, 'partiNo');
    s = assignColumn(toggleWord(s, 7), W, 'm');
    const b = suggestBody(s, W, 's1');
    expect(b.assignments).toEqual([{ field: 'partiNo', rect: { x: 200, y: 300, width: 90, height: 20 } }]);
    expect(b.identifiers).toEqual(['GÜLEÇSOY BOYA', 'ÇEKİ LİSTESİ', 'Metre']);
    expect(b.table).toEqual({ columns: [{ key: 'm', header: 'Metre' }], totalsLabel: null });
    expect(b.sectionStartLabel).toBeUndefined();
  });

  it('tekrar eden bölüm: başlangıç etiketi + parti künyesi alanı bölüm başına', () => {
    let s = assignField(toggleWord(initialTeach(SCAN, 'G'), 6), W, 'partiNo');
    s = setRepeats(s, true);
    expect(teachProblems({ ...s, name: 'Güleçsoy' })).toEqual(['Tekrar eden bölümün başlangıç yazısını seçin.', 'Tekrar eden bölümde top tablosu gerekli: tablonun Metre sütun başlığını işaretleyin.']);
    s = { ...s, name: 'Güleçsoy', sectionStart: 'Ham PartiNo' };
    const b = suggestBody(s, W, 's1');
    expect(b.assignments[0]).toMatchObject({ field: 'partiNo', section: true });
    expect(b.sectionStartLabel).toBe('Ham PartiNo');
  });

  it("güncelle kipi: gövde base taşır; eski tablo/bölüm varsayılan korunur, kutu kaldırılınca keep'ten düşer (s1b inceleme)", () => {
    const old = { fields: [{ key: 'partiNo', label: 'Parti No' }, { key: 'tarih', label: 'Tarih' }], tables: [{ key: 'toplar' }], sections: { startLabels: ['Ham PartiNo'], fields: ['partiNo'] } };
    expect(oldParts(old)).toEqual(['tables', 'sections']);
    expect(oldParts({ fields: [] })).toEqual([]);
    let s = { ...assignField(toggleWord(initialTeach(SCAN, 'G', [], { keepOld: oldParts(old) }), 6), W, 'partiNo'), name: 'Güleçsoy' };
    expect(suggestBody(s, W, 's1', 'u-x').base).toEqual({ code: 'u-x', keep: ['tables', 'sections'] });
    s = toggleKeepOld(s, 'sections');
    expect(suggestBody(s, W, 's1', 'u-x').base).toEqual({ code: 'u-x', keep: ['tables'] });
    expect(suggestBody(s, W, 's1').base).toBeUndefined();
    expect(keptOldFields(old, s)).toEqual(['Tarih']);
  });

  it('kutu işaretleri fotoğraf çerçevesinde; seçili / alan tonu', () => {
    const s = assignField(toggleWord(initialTeach(SCAN, 'G'), 6), W, 'partiNo');
    const marks = teachMarks(toggleWord(s, 0), W);
    expect(marks[6]).toMatchObject({ tone: 'field', label: 'Parti No', box: { x: 1200, y: 2300 } });
    expect(marks[0]!.tone).toBe('selected');
    expect(marks[9]!.tone).toBe('word');
  });
});

describe('tablet sayfa eşleme', () => {
  const scans = [
    { id: 's2', pageNo: 2, sha256: 'b', status: 'READ', mimeType: 'image/jpeg' },
    { id: 's1', pageNo: 1, sha256: 'a', status: 'READ', mimeType: 'image/jpeg' },
    { id: 's3', pageNo: 3, sha256: 'c', status: 'PENDING', mimeType: 'image/jpeg' },
    { id: 's4', pageNo: 4, sha256: 'd', status: 'READ', mimeType: 'application/pdf' },
  ];
  const local = [{ sha256: 'a', uri: 'file:///a.jpg' }, { sha256: 'c', uri: 'file:///c.jpg' }, { sha256: 'd', uri: 'file:///d.pdf' }];

  it('yalnız okunmuş fotoğraf + bu tablette yerel kopyası olan sayfa; sayfa sırasıyla', () => {
    expect(teachPages({ scans }, local)).toEqual([{ scanId: 's1', pageNo: 1, uri: 'file:///a.jpg' }]);
    expect(teachPages({ scans }, [...local, { sha256: 'b', uri: 'file:///b.jpg' }]).map((p) => p.scanId)).toEqual(['s1', 's2']);
    // Eski sunucu taramaları göndermez → tanıtma yok.
    expect(teachPages({}, local)).toEqual([]);
  });

  it('tanınmadı = templateId null + tanıtılabilir sayfa; eski sunucu (undefined) tanınmadı sayılmaz', () => {
    const pages = teachPages({ scans }, local);
    expect(isUnrecognized({ templateId: null }, pages)).toBe(true);
    expect(isUnrecognized({ templateId: 't1' }, pages)).toBe(false);
    expect(isUnrecognized({}, pages)).toBe(false);
    expect(isUnrecognized({ templateId: null }, [])).toBe(false);
  });

  it('fotoğraf boyutu: 90/270 dönükse en-boy yer değiştirir', () => {
    expect(photoSize({ imageWidth: 1000, imageHeight: 1500, rotation: 0 })).toEqual({ width: 1000, height: 1500 });
    expect(photoSize({ imageWidth: 1000, imageHeight: 1500, rotation: 90 })).toEqual({ width: 1500, height: 1000 });
    expect(photoSize({ imageWidth: 1000, imageHeight: 1500, rotation: 270 })).toEqual({ width: 1500, height: 1000 });
  });

  describe('kimlik yazısı tavanı + doğrulama hatası metni (canlı demo: 13 kimlik → yalnız "Validasyon hatası")', () => {
    const ready = () => assignField(toggleWord(initialTeach(SCAN, 'Güleçsoy'), 6), W, 'partiNo');
    const withIds = (n: number) => Array.from({ length: n }, (_, i) => `KIMLIK ${i + 1}`).reduce((s, t) => addIdentifier(s, t), { ...ready(), identifiers: [] } as ReturnType<typeof ready>);

    it('30 kimlik yazısı sorunsuz; 31 Türkçe uyarı verir (backend aynası 30)', () => {
      expect(MAX_TEMPLATE_IDENTIFIERS).toBe(30);
      expect(teachProblems(withIds(13))).toEqual([]);
      expect(teachProblems(withIds(30))).toEqual([]);
      expect(teachProblems(withIds(31))).toEqual(['En çok 30 kimlik yazısı seçilebilir (şu an 31); fazlasının işaretini kaldırın.']);
    });

    it('400 doğrulamada ilk alan mesajı gösterilir; yoksa Error.message; Error değilse undefined', () => {
      const zod = Object.assign(new Error('Validasyon hatası'), { status: 400, validationErrors: [{ field: 'identifiers', message: 'En çok 30 kimlik yazısı seçilebilir' }] });
      expect(teachErrText(zod)).toBe('En çok 30 kimlik yazısı seçilebilir');
      expect(teachErrText(Object.assign(new Error('Validasyon hatası'), { validationErrors: [] }))).toBe('Validasyon hatası');
      expect(teachErrText(new Error('Sunucu hatası'))).toBe('Sunucu hatası');
      expect(teachErrText('x')).toBeUndefined();
    });
  });
});

// Gülkesim 2026-11-04: "Tanımı düzenle"de yalnız Başlık ✓ görünüyordu — eski şablonun alanları taslağa hiç girmiyordu.
describe('güncelle kipi — kayıtlı alanlar (kept)', () => {
  const OLD = { fields: [{ key: 'musteri' }, { key: 'partiNo', strategies: [{ kind: 'anchor', maxWords: 1, valueShape: '^\\p{L}+\\d+$' }] }, { key: 'toplamMetre' }, { key: 'bilinmez' }] };
  const open = () => initialTeach(SCAN, 'kömürhan', [], { kept: templateFieldKeys(OLD) });

  it('⭐ eski şablonun alanları kayıtlı gelir: sekmeler ✓, eksik "alan atayın" yok, gövdeye ATAMA olarak gitmez (sunucu aynen korur)', () => {
    const s = open();
    expect(s.kept).toEqual(['musteri', 'partiNo', 'toplamMetre']);
    expect(chipStatus(s, 'partiNo', [])).toBe('done');
    expect(chipStatus(s, 'toplamMetre', [])).toBe('done');
    expect(chipStatus(s, 'en', [])).toBe('todo');
    expect(teachProblems(s)).toEqual([]);
    expect(suggestBody(s, W, 's1', 'u-komurhan').assignments).toEqual([]);
    expect(suggestBody(s, W, 's1', 'u-komurhan').base).toEqual({ code: 'u-komurhan', keep: [] });
  });

  it('⭐ yalnız yeniden atanan gider; kalan kayıtlı; atama geri alınınca yine kayıtlı', () => {
    let s = toggleFieldWord(open(), W, 'partiNo', 6);
    expect(isKept(s, 'partiNo')).toBe(false);
    expect(isKept(s, 'musteri')).toBe(true);
    expect(suggestBody(s, W, 's1', 'u-komurhan').assignments).toEqual([{ field: 'partiNo', rect: { x: 200, y: 300, width: 90, height: 20 } }]);
    s = toggleFieldWord(s, W, 'partiNo', 6);
    expect(isKept(s, 'partiNo')).toBe(true);
    expect(suggestBody(s, W, 's1', 'u-komurhan').assignments).toEqual([]);
  });

  it('kayıtlı alanın değeri önizlemeden, yeri fieldRects kutusundan (belge üstünde "kayıtlı" işaret)', () => {
    const s = open();
    const result = { template: {}, explain: [], errors: [], preview: { matched: true, score: 1, fields: { partiNo: 'P2618733' }, fieldRects: { partiNo: { x: 195, y: 295, width: 100, height: 30 } }, lineCount: 0, warnings: [] } };
    expect(fieldReadout(s, 'partiNo', { result, fresh: false, error: null })).toEqual({ kind: 'ok', value: 'P2618733', label: null, kept: true });
    const located = locateKept(s, W, result.preview.fieldRects);
    expect(located).toEqual({ partiNo: [6] });
    const m = stageMarks(s, W, { stage: 'ESLEME', target: null }, located)[6]!;
    expect(m.tone).toBe('field');
    expect(m.label).toMatch(/kayıtlı/);
  });

  it('yeni tipte (kayıtlı alan yok) eksik kontrolü aynen', () => {
    expect(teachProblems(initialTeach(SCAN, 'Yeni'))).toContain('En az bir alan atayın (ör. Parti No).');
  });
});

// Çok blok (2026-11-06): Gülkesim demo şablonu "Gelen metre"yi T.Adet'in sağındaki 16'ya bağlamış, bölüm tablosuzdu.
describe('çok blok tanıtma kapıları', () => {
  const CB: ScanWords = {
    imageWidth: 1000, imageHeight: 1500, rotation: 0,
    words: [
      w('Sipariş', [50, 100], 1), w('No', [120, 100], 1), w('56967', [200, 100], 1),
      w('İşlem', [50, 140], 2), w('KDK', [120, 140], 2), w('APRE', [180, 140], 2),
      w('T.Adet', [600, 60], 3), w('16', [700, 60], 3, 30), w('3.935,00', [800, 60], 3, 90),
      w('Metre', [300, 200], 4),
    ],
  };
  const X = CB.words;

  it('⭐ işlem + müşteri İE no seçilebilir; tekrar eden bölümde varsayılan olarak bölüm başına gider', () => {
    let s = setRepeats(initialTeach(CB, 'Çeki'), true);
    s = assignField(toggleWord(toggleWord(s, 4), 5), X, 'islem');
    expect(s.sectionFields).toContain('islem');
    expect(suggestBody({ ...s, sectionStart: 'Sipariş No' }, X, 's1').assignments).toEqual([expect.objectContaining({ field: 'islem', section: true })]);
  });

  it('⭐ tekrar eden bölüm Metre sütunu ister ("Tanımı düzenle" eski tabloyu taşıyorsa istemez)', () => {
    const s = { ...setRepeats(initialTeach(CB, 'Çeki'), true), sectionStart: 'Sipariş No' };
    const msg = 'Tekrar eden bölümde top tablosu gerekli: tablonun Metre sütun başlığını işaretleyin.';
    const withId = assignField(toggleWord(s, 2), X, 'siparisNo');
    expect(teachProblems(withId)).toContain(msg);
    expect(teachProblems(assignColumn(toggleWord(withId, 9), X, 'm'))).not.toContain(msg);
    expect(teachProblems({ ...withId, keepOld: ['tables'] })).not.toContain(msg);
  });

  it('⭐ "Gelen metre" T.Adet satırındaki tam sayıya (adet) atanırsa uyarı; metre değeri serbest', () => {
    const s = initialTeach(CB, 'Çeki');
    const adet = assignField(toggleWord(s, 7), X, 'toplamMetre');
    expect(meterOnCountRow(adet, X)).toBe(true);
    expect(teachProblems(adet, X).some((p) => p.includes('T.Adet'))).toBe(true);
    expect(meterOnCountRow(assignField(toggleWord(s, 8), X, 'toplamMetre'), X)).toBe(false);
  });
});

// B1 2026-11-09: sunucu kataloğa yeni alan ekleyince (ör. `toplamKg` "Gelen kg") bu sürümün tableti şablonu düzenlerken
// bilinmeyen anahtarı yok sayar; gövdeye atama olarak girmez → sunucu birleşimi (`mergeTemplateForUpdate`) alanı korur.
describe('adoptTemplate — sunucunun yeni alanı (eski tablet sözleşmesi)', () => {
  it('⭐ bilinmeyen alan anahtarı kept\'e ve gövdeye girmez; bilinenler kayıtlı gelir', () => {
    const s = adoptTemplate(initialTeach(SCAN, 'x', []), { name: 'Kömürhan', template: { identifiers: { keywords: ['KÖMÜRHAN'] }, fields: [{ key: 'toplamMetre' }, { key: 'gelecekKgAlani', label: 'Gelen kg' }] } });
    expect(s.kept).toEqual(['toplamMetre']);
    expect(suggestBody(s, W, 's1', 'u-komurhan').assignments).toEqual([]);
  });
});

// Üç aşama (2026-11-09): gelen kg alanı, kurallar ve alan kaldırma gövdesi, şablon kuralının benimsenmesi, metre/kg aynı kutu.
describe('üç aşama gövdesi ve kapıları', () => {
  const marked = () => assignField(toggleWord(initialTeach(SCAN, 'Güleçsoy'), 6), W, 'partiNo');

  it('"Gelen kg" (toplamKg) atanabilir alandır ve gövdeye atama olarak girer', () => {
    const s = assignField(toggleWord(marked(), 9), W, 'toplamKg');
    expect(suggestBody(s, W, 's1').assignments.map((a) => a.field)).toEqual(['partiNo', 'toplamKg']);
  });

  it('⭐ fabrika ayarı → gövdede rules YOK; kural seçilince var; düzenlemede kayıtlı kuralı fabrikaya döndürmek null', () => {
    const s = marked();
    expect(suggestBody(s, W, 's1')).not.toHaveProperty('rules');
    expect(suggestBody({ ...s, multiParty: 'SINGLE' }, W, 's1').rules).toEqual({ multiParty: 'SINGLE' });
    expect(suggestBody({ ...s, oldMultiParty: 'PER_PARTY' }, W, 's1', 'u-x').rules).toEqual({ multiParty: null });
    expect(suggestBody({ ...s, oldMultiParty: 'PER_PARTY' }, W, 's1')).not.toHaveProperty('rules');
    expect(suggestBody(s, W, 's1', 'u-x')).not.toHaveProperty('rules');
  });

  it('⭐ kaldırılan kayıtlı alan base.drop; yeniden işaretlenen drop\'a girmez (sunucu yeni atamayı da silerdi)', () => {
    let s: ReturnType<typeof marked> = { ...marked(), kept: ['partiNo', 'tarih'] };
    expect(suggestBody(s, W, 's1', 'u-x').base).toEqual({ code: 'u-x', keep: [] });
    s = dropKept(dropKept(s, 'tarih'), 'partiNo');
    expect(isKept(s, 'tarih')).toBe(false);
    expect(suggestBody(s, W, 's1', 'u-x').base).toEqual({ code: 'u-x', keep: [], drop: ['tarih'] });
    expect(suggestBody(undoDrop(s, 'tarih'), W, 's1', 'u-x').base).toEqual({ code: 'u-x', keep: [] });
    expect(keptOldFields({ fields: [{ key: 'tarih', label: 'Tarih' }, { key: 'not' }] }, s)).toEqual(['not']);
  });

  it('adoptTemplate kuralı alır (kullanıcı seçimi önce gelir), bilinmeyen alan anahtarını yok sayar', () => {
    const t = { fields: [{ key: 'partiNo' }, { key: 'gelecekAlani' }], identifiers: { keywords: ['ESKİ'] }, rules: { multiParty: 'PER_PARTY' } };
    const a = adoptTemplate(initialTeach(SCAN, 'X'), { name: 'Eski', template: t });
    expect(a.kept).toEqual(['partiNo']);
    expect(a).toMatchObject({ multiParty: 'PER_PARTY', oldMultiParty: 'PER_PARTY', drop: [] });
    expect(adoptTemplate({ ...initialTeach(SCAN, 'X'), multiParty: 'SINGLE' }, { name: 'Eski', template: t }).multiParty).toBe('SINGLE');
    expect(adoptTemplate(initialTeach(SCAN, 'X'), { name: 'Eski', template: { rules: { multiParty: 'BILINMEYEN' } } }).multiParty).toBeNull();
    expect(templateMultiParty(undefined)).toBeNull();
  });

  it('⭐ aynı kutu hem metre hem kg alanına işaretlenemez (backend teachErrors aynası, ≥ %50 kesişim)', () => {
    const X: ScanWord[] = [...W, w('241', [52, 1002], 9, 58)];
    let s = assignField(toggleWord(initialTeach({ ...SCAN, words: X }, 'G'), 9), X, 'toplamMetre');
    s = assignField(toggleWord(s, 10), X, 'hedefKg');
    expect(meterKgClashes(s, X)).toEqual([{ meter: 'toplamMetre', kg: 'hedefKg' }]);
    expect(teachProblems(s, X)).toContain('Aynı kutu hem "Gelen metre" hem "Hedef kg" olamaz — kg için belgedeki kg değerine dokunun.');
    expect(sameCellRatio({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 10, height: 10 })).toBe(0);
    const apart = assignField(toggleWord(assignField(toggleWord(initialTeach(SCAN, 'G'), 9), W, 'toplamMetre'), 6), W, 'hedefKg');
    expect(meterKgClashes(apart, W)).toEqual([]);
  });
});
