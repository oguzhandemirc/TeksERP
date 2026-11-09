// Üç aşamalı tanıtma saf çekirdeği (stages.ts): aşama sorunları, ilerleme/şerit kapısı, ② gruplama + "Diğer alanlar",
// dokunuş yönlendirme, özet/kural sayısı, bilgi satırları; alan-hedef ve alan kataloğu backend aynası.
import * as fs from 'fs';
import * as path from 'path';
import type { ScanWord, ScanWords, SuggestResult } from '../../../../types/inboundDocTeach';
import { FIELD_GROUP_ORDER, FIELD_TARGETS } from './fieldTargets';
import {
  canAdvance, canReach, dropKept, firstTodo, mapGroups, meterSourceText, multiPartyChoices, recognitionText, ruleCount, saveSummary, sectionPreviewText, stageDone, stageIssues, stageMarks, stageTap,
} from './stages';
import { FIELD_OPTIONS, initialTeach, type TeachState } from './teachDraft';
import { toggleFieldWord } from './guided';

const w = (text: string, [x, y]: [number, number], lineNo: number, width = 60): ScanWord => ({
  text, rect: { x, y, width, height: 20 }, photoRect: { x, y, width, height: 20 }, lineNo, confidence: 0.99,
});
const SCAN: ScanWords = {
  imageWidth: 1000, imageHeight: 1500, rotation: 0,
  words: [
    w('GÜLEÇSOY', [50, 20], 1, 120), w('BOYA', [180, 20], 1), w('Ham', [50, 300], 3), w('PartiNo:', [100, 300], 3), w('P2618733', [200, 300], 3, 90),
    w('Metre', [50, 600], 4), w('Kilo', [200, 600], 4), w('T.Adet', [50, 900], 8), w('241', [200, 900], 8),
  ],
};
const W = SCAN.words;
const start = (name = 'Güleçsoy'): TeachState => initialTeach(SCAN, name);

describe('aşama kapıları', () => {
  it('① kimlik/ad sorunu ①e, alan eksiği ②ye, bölüm eksiği ③e bağlıdır', () => {
    const s = { ...start(''), identifiers: [] };
    expect(stageIssues(s, W, 'TANIMA').map((i) => i.text)).toEqual(['En az bir kimlik yazısı işaretleyin (başlık, firma adı).', 'Belge tipine bir ad verin (en az 2 karakter).']);
    expect(stageIssues(s, W, 'ESLEME').map((i) => i.text)).toEqual(['En az bir alan atayın (ör. Parti No).']);
    expect(stageIssues({ ...s, repeats: true }, W, 'KURALLAR').length).toBe(3);
    expect(canAdvance(s, W, 'TANIMA')).toBe(false);
  });

  it('şerit: geri her zaman, ileri önceki aşamalar temizse; tamam işareti yalnız geride kalan temiz aşamada', () => {
    const empty = start();
    expect(canReach(empty, W, 'TANIMA', 'ESLEME')).toBe(true);
    expect(canReach(empty, W, 'TANIMA', 'KURALLAR')).toBe(false); // ② alan eksik
    expect(canReach({ ...empty, identifiers: [] }, W, 'TANIMA', 'ESLEME')).toBe(false);
    expect(canReach({ ...empty, identifiers: [] }, W, 'KURALLAR', 'TANIMA')).toBe(true);
    const marked = toggleFieldWord(empty, W, 'partiNo', 4);
    expect(canReach(marked, W, 'TANIMA', 'KURALLAR')).toBe(true);
    expect(stageDone(marked, W, 'KURALLAR', 'TANIMA')).toBe(true);
    expect(stageDone(marked, W, 'TANIMA', 'TANIMA')).toBe(false);
  });

  it('düzenlemede kayıtlı alan "alan" sayılır; hepsi kaldırılırsa ② yeniden eksik verir', () => {
    const s = { ...start(), kept: ['partiNo' as const] };
    expect(canAdvance(s, W, 'ESLEME')).toBe(true);
    expect(canAdvance(dropKept(s, 'partiNo'), W, 'ESLEME')).toBe(false);
  });
});

describe('② gruplama', () => {
  it('varsayılan görünürler gruplu (Kimlik · Gelen · Hedef; kumaş/renk beyanı Gelen grubunda); hedef metraj/kg, top adedi ve diğerleri "Diğer alanlar"da', () => {
    const { groups, more } = mapGroups(start());
    expect(groups.map((g) => [g.group, g.keys])).toEqual([
      ['KIMLIK', ['musteri', 'partiNo', 'evrakNo']],
      ['GELEN', ['toplamMetre', 'toplamKg', 'desen', 'renk']],
      ['HEDEF', ['en']],
    ]);
    expect(more).toEqual(['topAdet', 'hedefMetraj', 'hedefKg', 'siparisNo', 'tarih', 'not', 'islem', 'gonderenIsEmriNo']);
  });

  it('işaretli/kayıtlı/seçili gizli alan kendi grubunda görünür', () => {
    const s = { ...toggleFieldWord(start(), W, 'hedefKg', 8), kept: ['siparisNo' as const] };
    const { groups, more } = mapGroups(s, 'tarih');
    expect(groups.find((g) => g.group === 'HEDEF')?.keys).toEqual(['hedefKg', 'en']);
    expect(groups.find((g) => g.group === 'DIGER')?.keys).toEqual(['siparisNo', 'tarih']);
    expect(more).not.toContain('hedefKg');
  });

  it('②ye girişte görünür ilk atanmamış alan seçilir', () => {
    expect(firstTodo(start())).toBe('musteri');
    expect(firstTodo(toggleFieldWord(start(), W, 'musteri', 0))).toBe('partiNo');
  });
});

describe('dokunuş yönlendirme', () => {
  it('① kimlik satırı · ② alan / sütun · ③ bölüm başlangıcı (yalnız Evet iken) / toplam satırı', () => {
    let s = start();
    s = stageTap(s, W, { stage: 'TANIMA', target: null }, 1);
    expect(s.identifiers.find((d) => d.text === 'GÜLEÇSOY BOYA')?.on).toBe(false);
    s = stageTap(s, W, { stage: 'ESLEME', target: { kind: 'field', key: 'partiNo' } }, 4);
    expect(s.fields.partiNo).toEqual([4]);
    s = stageTap(s, W, { stage: 'ESLEME', target: { kind: 'column', key: 'm' } }, 5);
    expect(s.columns.m).toEqual([5]);
    expect(stageTap(s, W, { stage: 'KURALLAR', target: { kind: 'section' } }, 2)).toBe(s);
    s = stageTap({ ...s, repeats: true }, W, { stage: 'KURALLAR', target: { kind: 'section' } }, 2);
    s = stageTap(s, W, { stage: 'KURALLAR', target: { kind: 'section' } }, 3);
    expect(s.sectionStart).toBe('Ham PartiNo');
    // Değer de seçilse kaydedilen etiket kısmıdır (değer her partide değişir); değer kelimesi bölüm başı boyanmaz.
    const withValue = stageTap(s, W, { stage: 'KURALLAR', target: { kind: 'section' } }, 4);
    expect(withValue.sectionStart).toBe('Ham PartiNo');
    expect(stageMarks(withValue, W, { stage: 'KURALLAR', target: null })[4]?.label).not.toBe('Bölüm başlangıcı');
    expect(stageMarks(withValue, W, { stage: 'KURALLAR', target: null })[2]?.label).toBe('Bölüm başlangıcı');
    s = stageTap(s, W, { stage: 'KURALLAR', target: { kind: 'totals' } }, 7);
    expect(s.totalsLabel).toEqual([7]);
    expect(stageTap(s, W, { stage: 'ESLEME', target: null }, 0)).toBe(s);
  });
});

describe('özet ve bilgi satırları', () => {
  it('özet "N kimlik yazısı · N alan · N kural"; toplam satırı yalnız tablo varken kural sayılır', () => {
    let s = toggleFieldWord(start(), W, 'partiNo', 4); // "Ham PartiNo" etiketi kimlikte kalır (değer kelimesi zaten girmedi)
    expect(saveSummary(s)).toBe('2 kimlik yazısı · 1 alan · 0 kural');
    s = { ...s, multiParty: 'PER_PARTY', totalsLabel: [7] };
    expect(ruleCount(s)).toBe(1);
    expect(ruleCount({ ...s, columns: { m: [5] } })).toBe(2);
  });

  it('çok parti seçenekleri fabrika değerini söyler; bölüm önizlemesi bölüm sayısını', () => {
    expect(multiPartyChoices('PER_PARTY')[0]).toMatchObject({ value: null, label: 'Fabrika ayarı', hint: 'Şu an: Her parti ayrı İE' });
    expect(multiPartyChoices(undefined).map((c) => c.value)).toEqual([null, 'PER_PARTY', 'SINGLE']);
    const r = { preview: { blocks: [{ blockNo: 1 }, { blockNo: 2 }, { blockNo: 3 }] } } as unknown as SuggestResult;
    expect(sectionPreviewText({ ...start(), repeats: true, sectionStart: 'PARTİ NO' }, r)).toBe('‘PARTİ NO’ ile başlıyor · 3 bölüm bulundu');
    expect(sectionPreviewText(start(), r)).toBeNull();
  });

  it('gelen metre kaynağı sunucunun meterSources önerisinden; tanıma oranı önizlemeden', () => {
    const res = (template: object, fields: object = {}) => ({ template, preview: { matched: true, score: 0.923, fields } }) as unknown as SuggestResult;
    expect(meterSourceText(res({ meterSources: { output: ['$tableTotal'], total: ['toplamMetre'] }, tables: [{}] }))).toBe('Toplam satırından');
    expect(meterSourceText(res({ meterSources: { total: ['toplamMetre'] } }, { toplamMetre: '241' }))).toBe('"Gelen metre" alanından (241 m)');
    expect(meterSourceText(res({ tables: [{}] }))).toBe('Tablo satırlarının toplamından');
    expect(meterSourceText(res({}))).toBe('Belgeden okunmuyor — iş emrinde elle girilir');
    expect(meterSourceText(null)).toBeNull();
    expect(recognitionText(res({}))).toEqual({ ok: true, text: 'Bu yazılarla tanınıyor: %92' });
    expect(recognitionText({ preview: { matched: false, score: 0.3 } } as unknown as SuggestResult)?.ok).toBe(false);
  });
});

describe('backend aynası', () => {
  const BACKEND = path.join(__dirname, '../../../../../../Teks-Erp/src/lib/gelen-belge');

  it('FIELD_TARGETS = alan-hedef.ts (anahtar, sıra, ad, grup, varsayılan görünürlük) ve grup sırası', () => {
    const src = fs.readFileSync(path.join(BACKEND, 'alan-hedef.ts'), 'utf8');
    const rows = [...src.matchAll(/^\s{2}(\w+): \{ woTarget: "[^"]*", woLabel: "([^"]*)", group: "(\w+)", defaultVisible: (true|false)/gm)].map((m) => [m[1], m[2], m[3], m[4] === 'true']);
    expect(rows.length).toBeGreaterThan(10);
    expect(Object.entries(FIELD_TARGETS).map(([k, v]) => [k, v.woLabel, v.group, v.defaultVisible])).toEqual(rows);
    const order = src.match(/FIELD_GROUP_ORDER[^=]*= \[([^\]]*)\]/)![1]!.match(/\w+/g);
    expect(FIELD_GROUP_ORDER).toEqual(order);
  });

  it('FIELD_OPTIONS anahtarları = suggest.ts ASSIGNABLE_FIELDS (toplamKg dahil)', () => {
    const src = fs.readFileSync(path.join(BACKEND, 'motor/suggest.ts'), 'utf8');
    const block = src.slice(src.indexOf('export const ASSIGNABLE_FIELDS = {'), src.indexOf('} as const satisfies'));
    const keys = [...block.matchAll(/^\s{2}(\w+): \{ label:/gm)].map((m) => m[1]).sort();
    expect(FIELD_OPTIONS.map((f) => f.key).sort()).toEqual(keys);
    expect(keys).toContain('toplamKg');
  });
});
