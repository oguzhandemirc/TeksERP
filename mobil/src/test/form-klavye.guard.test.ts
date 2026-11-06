/**
 * BEKÇİ — belgeden İE formlarında kaydırma kabı klavyeye duyarlıdır (prova 2026-11-06: klavye düzenlenen alanı örtüyordu,
 * form kaymıyordu). Düz `ScrollView` geri gelirse kırmızı. Özel numpad (NumpadHost) bu kabın dışındadır.
 */
import fs from 'fs';
import path from 'path';

const DIR = path.join(__dirname, '..', 'screens', 'Modules', 'GelenBelge', 'woCreate');
const FORMLAR = ['DocBatchView.tsx', 'UnifiedWoForm.tsx', 'WoCreateScreen.tsx'];

describe('belgeden İE formu — klavye örtmez', () => {
  it.each(FORMLAR)('%s KeyboardAwareScrollView kullanır, düz ScrollView yok', (f) => {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    expect(src).toMatch(/<KeyboardAwareScrollView\b/);
    expect(src).not.toMatch(/<ScrollView\b/);
  });
});
