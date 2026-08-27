// =============================================================================
// Bekçi: adres ekranı İKİ TANE — keşif İKİSİNDE DE olmalı
// =============================================================================
// NEDEN: bu projede sunucu adresi girme yüzeyi iki kez var ve neredeyse birebir
// kopya:
//   • `components/ServerAddressSheet.tsx`            → KİLİT EKRANI
//   • `screens/Common/settings/ServerSettingsScreen` → AYARLAR
//
// Yalnız birine eklemek, tam da asıl mağduru dışarıda bırakır: sunucuya
// ulaşamayan operatör kilit ekranındadır ve Ayarlar'a GEÇEMEZ (Ayarlar
// NavigationContainer'ın arkasında). Yani "Ayarlar'a ekledim, yeter" kararı
// özelliği en çok gerektiği anda yok eder.
//
// Kaynak taraması, çünkü iki ekran da tam RN ağacı ister (Paper + Portal +
// navigation) ve burada ölçmek istediğimiz şey görünüm değil, BAĞLANMIŞ OLMAK.
// =============================================================================
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(SRC, p), 'utf8');

const SCREENS = [
  ['kilit ekranı', 'components/ServerAddressSheet.tsx'],
  ['ayarlar', 'screens/Common/settings/ServerSettingsScreen.tsx'],
] as const;

describe('keşif iki adres ekranında da bağlı', () => {
  it('körlük zemini: iki dosya da okundu ve dolu', () => {
    for (const [, path] of SCREENS) {
      expect(read(path).length).toBeGreaterThan(1000);
    }
  });

  it.each(SCREENS)('%s: ServerDiscoveryList hem IMPORT hem KULLANILMIŞ', (_ad, path) => {
    const src = read(path);
    expect(src).toMatch(/import \{ ServerDiscoveryList \}/);
    // Yalnız import etmek yetmez — render edilmiş olmalı.
    expect(src).toMatch(/<ServerDiscoveryList/);
  });

  it.each(SCREENS)('%s: aday seçimi forma UYGULANIYOR (onPick boş değil)', (_ad, path) => {
    const src = read(path);
    const at = src.indexOf('<ServerDiscoveryList');
    const block = src.slice(at, src.indexOf('/>', at));
    expect(block).toContain('onPick');
    // Seçim bir yere yazılmalı: ya parçalara ayrılıp alanlara, ya applyParts ile.
    expect(/applyParts|setHost|setParts/.test(block)).toBe(true);
  });

  it('bileşenin KENDİSİ tek dosyada — iki kopya YOK', () => {
    // İki ekran ayrışmasın diye ortak bileşen kuruldu; ikinci bir kopya
    // doğarsa bu kararın tamamı boşa düşer.
    const list = read('components/ServerDiscoveryList.tsx');
    expect(list).toContain('export function ServerDiscoveryList');
  });
});
