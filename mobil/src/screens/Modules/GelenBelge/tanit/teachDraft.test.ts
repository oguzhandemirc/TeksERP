// Tablet tanıtma çekirdeği (panel `tanitma.test.tsx` saf bölümünün aynası) + sayfa eşleme / fotoğraf boyutu.
import type { ScanWord, ScanWords } from '../../../../types/inboundDocTeach';
import {
  assignColumn, assignField, initialTeach, mergeForUpdate, setRepeats, suggestBody, suggestIdentifiers, teachMarks, teachProblems, toggleWord, wordAt,
} from './teachDraft';
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

  it('güncelle birleşimi: yeniden atanan alan ezilir, eski alan/tablo korunur, kimlik ekrandaki liste', () => {
    const old = { id: 'u-x', version: 2, fields: [{ key: 'partiNo', v: 'eski' }, { key: 'tarih' }], tables: [{ key: 'toplar' }], identifiers: { keywords: ['A', 'B'], minScore: 0.6 } };
    const next = { id: 'u-x', version: 1, fields: [{ key: 'partiNo', v: 'yeni' }], identifiers: { keywords: ['A', 'C'], minScore: 0.6 } };
    const m = mergeForUpdate(old, next);
    expect(m.fields).toEqual([{ key: 'partiNo', v: 'yeni' }, { key: 'tarih' }]);
    expect(m.tables).toEqual([{ key: 'toplar' }]);
    expect(m.identifiers).toEqual({ keywords: ['A', 'C'], minScore: 0.6 });
    expect(m.id).toBeUndefined();
    expect(m.version).toBeUndefined();
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
});
