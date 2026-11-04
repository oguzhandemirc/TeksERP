// Tablet tanıtma çekirdeği (panel `tanitma.test.tsx` saf bölümünün aynası) + sayfa eşleme / fotoğraf boyutu.
import type { ScanWord, ScanWords } from '../../../../types/inboundDocTeach';
import {
  assignColumn, assignField, initialTeach, keptOldFields, oldParts, setRepeats, toggleKeepOld, suggestBody, suggestIdentifiers, teachErrText, teachMarks, teachProblems, toggleWord, wordAt, MAX_TEMPLATE_IDENTIFIERS, addIdentifier, isKept, locateKept, templateFieldKeys,
} from './teachDraft';
import { chipStatus, fieldReadout, guidedMarks, toggleFieldWord } from './guided';
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
    expect(teachProblems({ ...s, name: 'Güleçsoy' })).toEqual(['Tekrar eden bölümün başlangıç yazısını seçin.']);
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

// Gülkesim 2026-11-04: "Şablonu güncelle"de yalnız Başlık ✓ görünüyordu — eski şablonun alanları taslağa hiç girmiyordu.
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
    const m = guidedMarks(s, W, 0, located)[6]!;
    expect(m.tone).toBe('field');
    expect(m.label).toMatch(/kayıtlı/);
  });

  it('yeni tipte (kayıtlı alan yok) eksik kontrolü aynen', () => {
    expect(teachProblems(initialTeach(SCAN, 'Yeni'))).toContain('En az bir alan atayın (ör. Parti No).');
  });
});
