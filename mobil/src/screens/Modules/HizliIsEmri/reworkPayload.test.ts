/**
 * BEKÇİ — yeniden üretim sebebinin İKİ hedefe de doğru gitmesi (2026-08-25).
 * Ayrışırsa: çekiye talimat basılmaz (boyahane neden yeniden boyadığını bilmez)
 * ya da rapor anahtarı kaybolur ("neden N top tekrar boyandı" cevapsız kalır).
 */
import { buildReworkPlan } from './reworkPayload';

const PRESETS = [
  { code: 'TON_TUTMADI', label: 'Ton tutmadı' },
  { code: 'DIGER', label: 'Diğer' },
];
const ROLLS = [{ barcode: 'T1', status: 'WAREHOUSE' }];

describe('buildReworkPlan', () => {
  it('bitmiş top YOKSA hiçbir şey gönderilmez (ham iş emri etkilenmez)', () => {
    expect(buildReworkPlan({ reworkRolls: [], reason: { code: 'TON_TUTMADI', text: '' }, presets: PRESETS }))
      .toEqual({ stepNote: null, parameters: null });
  });

  it('chip seçimi: etiket çekiye, kod rapora', () => {
    const p = buildReworkPlan({ reworkRolls: ROLLS, reason: { code: 'TON_TUTMADI', text: '' }, presets: PRESETS });
    expect(p.stepNote).toBe('Yeniden üretim: Ton tutmadı');
    expect(p.parameters?.rework).toEqual({
      reasonCode: 'TON_TUTMADI',
      reasonText: null,
      rolls: [{ barcode: 'T1', status: 'WAREHOUSE' }],
    });
  });

  it('serbest metin: metin çekiye, kod "Diğer"', () => {
    const p = buildReworkPlan({ reworkRolls: ROLLS, reason: { code: 'DIGER', text: '  ton fazla açık  ' }, presets: PRESETS });
    expect(p.stepNote).toBe('Yeniden üretim: ton fazla açık');
    expect(p.parameters?.rework.reasonText).toBe('ton fazla açık');
    expect(p.parameters?.rework.reasonCode).toBe('DIGER');
  });

  it('sebep SEÇİLMEDİ: not YOK ama parameters yine gider (hangi toplar yeniden üretimde)', () => {
    // Sebep isteğe bağlı (kullanıcı kararı) — ama "bu iş emri yeniden üretimdir"
    // bilgisi sebepten BAĞIMSIZ ve rapor için gerekli.
    const p = buildReworkPlan({ reworkRolls: ROLLS, reason: { code: null, text: '' }, presets: PRESETS });
    expect(p.stepNote).toBeNull();
    expect(p.parameters?.rework).toEqual({ reasonCode: null, reasonText: null, rolls: [{ barcode: 'T1', status: 'WAREHOUSE' }] });
  });

  it('operatörün istasyon notu EZİLMEZ — birleşir', () => {
    const p = buildReworkPlan({
      reworkRolls: ROLLS,
      reason: { code: 'TON_TUTMADI', text: '' },
      presets: PRESETS,
      existingNote: 'ACİL',
    });
    expect(p.stepNote).toBe('ACİL | Yeniden üretim: Ton tutmadı');
  });

  it('sebep yokken mevcut not korunur', () => {
    const p = buildReworkPlan({ reworkRolls: ROLLS, reason: { code: null, text: '' }, presets: PRESETS, existingNote: 'ACİL' });
    expect(p.stepNote).toBe('ACİL');
  });

  it('not 500 karakterde kırpılır (backend Zod sınırı)', () => {
    const p = buildReworkPlan({
      reworkRolls: ROLLS,
      reason: { code: null, text: 'x'.repeat(600) },
      presets: PRESETS,
      existingNote: 'y'.repeat(100),
    });
    expect(p.stepNote!.length).toBe(500);
  });

  it('katalogda olmayan kod: etiket çözülemez → not YOK, kod yine rapora gider', () => {
    // Bayat listeli tablet gizlenmiş bir kodu gönderebilir; not basmamak
    // doğrudur (kâğıda kod yazmayız) ama kodu düşürmek raporu bozardı.
    const p = buildReworkPlan({ reworkRolls: ROLLS, reason: { code: 'ESKI_KOD', text: '' }, presets: PRESETS });
    expect(p.stepNote).toBeNull();
    expect(p.parameters?.rework.reasonCode).toBe('ESKI_KOD');
  });
});
