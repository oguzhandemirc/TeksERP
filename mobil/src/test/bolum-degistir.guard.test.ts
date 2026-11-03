/**
 * BEKÇİ — "Bölüm değiştir" (ModuleSelect'e gidiş) yalnız gidilecek ızgara varken.
 *
 * MainNavigator tek görünür ekranda ModuleSelect route'unu KAYDETMEZ; oraya giden
 * her yüzey `hasMultipleVisibleScreens` yüklemine bakmalıdır. QA 2026-11-03: gate
 * kipindeki PlaceConfirmView maddeyi koşulsuz gösteriyordu → tek modüllü
 * kullanıcıda ölü madde + navigator hatası.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('ModuleSelect gidişi tek yükleme bağlı', () => {
  it("rootNavigateToModuleSelect / popTo('ModuleSelect') çağıran dosya hasMultipleVisibleScreens'e bakar", () => {
    const cagiranlar = walk(SRC).filter((f) => {
      const s = fs.readFileSync(f, 'utf8');
      return /rootNavigateToModuleSelect\(\)|popTo\('ModuleSelect'\)/.test(s) && !f.endsWith('navigationRef.ts');
    });
    // Sonda: tarayıcı en az bilinen iki çağıranı görmeli (boş eşleşme yeşil vermesin).
    expect(cagiranlar.map((f) => path.relative(SRC, f)).sort()).toEqual(
      expect.arrayContaining(['components/ScreenChrome.tsx', 'components/session/PlaceConfirmView.tsx']),
    );
    const ihlal = cagiranlar
      .filter((f) => !fs.readFileSync(f, 'utf8').includes('hasMultipleVisibleScreens'))
      .map((f) => path.relative(SRC, f));
    expect(ihlal).toEqual([]);
  });
});
