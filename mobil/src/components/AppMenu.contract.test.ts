// =============================================================================
// Bekçi: AppMenu — "ölçüm döngüsü kurulamaz" sözleşmesi (KAYNAK taraması)
// =============================================================================
// NEDEN KAYNAK TARAMASI: Bu sözleşmenin doğal testi bir RENDER testidir — menüyü
// aç, `measureInWindow`'un kaç kez çağrıldığını say. Ama ölçüldü ve YAPILAMIYOR:
//   • jest-expo / react-test-renderer'da native gölge ağaç yoktur, gerçek
//     `measureInWindow` callback'i HİÇ çağrılmaz (kart hiç çizilmez),
//   • RNTL v13'ün `createNodeMock` seçeneği tiplerde DURUYOR ama `build/render.js`
//     onu renderer'a HİÇ geçirmiyor (grep: render.js'te tek referans yok) — yani
//     ref'e sahte ölçüm düğümü takmanın da yolu yok.
// Geriye kalan tek mekanik güvence, döngüyü İMKÂNSIZ kılan yapısal özelliklerin
// kaynakta durduğunu doğrulamaktır. Sahadaki çökme (SM-X230, her basışta
// "Maximum update depth exceeded" → Menu > Portal > PortalConsumer) tam olarak
// bu üç özelliğin YOKLUĞUNDAN doğuyordu.
//
// NEGATİF SONDA (ölçüldü): effect'in bağımlılık dizisine `anchorRect` eklenince
// §2 KIRMIZI; dosyaya bir `onLayout` eklenince §3 KIRMIZI.
// =============================================================================

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(__dirname, 'AppMenu.tsx'), 'utf8');

/**
 * Yorumsuz kaynak. Kontroller KODA bakmalı: AppMenu.tsx'in başlığı, kaçınılan
 * deseni (`onLayout` → state → layout turu) anlatmak için ADIYLA anıyor — ham
 * metinde arayan bir bekçi kendi açıklamasına takılıp sahte kırmızı verir.
 * (Bu dosyadaki string literal'ların hiçbiri `//` ya da `/*` içermiyor.)
 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('AppMenu kaynak sözleşmesi', () => {
  // ---------------------------------------------------------------------------
  // KÖRLÜK ZEMİNİ — dosya taşınır/yeniden yazılırsa "ihlal yok" ile "hiçbir şeye
  // bakılmadı" aynı yeşile çıkar. Aşağıdaki kontroller ancak bu çıpalar
  // duruyorsa anlamlıdır.
  // ---------------------------------------------------------------------------
  it('§0 körlük zemini — dosya okundu ve beklenen çıpaları taşıyor', () => {
    expect(SRC.length).toBeGreaterThan(2000);
    expect(CODE.length).toBeGreaterThan(1000);
    expect(CODE).toContain('measureInWindow');
    expect(CODE).toContain('useEffect');
    expect(CODE).toContain('computeAppMenuLayout');
  });

  it('§1 ölçüm TEK yerde yapılır', () => {
    const hits = CODE.match(/measureInWindow/g) ?? [];
    expect(hits).toHaveLength(1);
  });

  it('§2 ölçüm effect\'inin bağımlılığı YALNIZ [visible]', () => {
    // Ölçümü saran useEffect'in kapanış dizisini yakala.
    const effect = CODE.match(/useEffect\(\(\) => \{[\s\S]*?measureInWindow[\s\S]*?\}, \[([^\]]*)\]\);/);
    expect(effect).not.toBeNull();

    const deps = (effect![1] ?? '')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);

    // `anchorRect` (ölçümün YAZDIĞI state) buraya girerse effect kendi sonucuyla
    // yeniden tetiklenir → ölç → setState → ölç … = paper Menu'nün çöktüğü tur.
    expect(deps).toEqual(['visible']);
  });

  it('§3 AppMenu HİÇBİR onLayout kullanmaz (ölç→state→layout kenarı yok)', () => {
    expect(CODE).not.toMatch(/onLayout/);
  });

  it('§4 menü kartı ölçülmez — boyut state\'i yok, kart maxWidth/maxHeight ile sınırlanır', () => {
    expect(CODE).toContain('maxWidth: pos.maxWidth');
    expect(CODE).toContain('maxHeight: pos.maxHeight');
  });

  it('§5 ölçüm gelmeden kart çizilmez (0,0 flaşı yok)', () => {
    // `pos` yalnız anchorRect doluyken hesaplanır ve JSX onu null-kontrolüyle çizer.
    expect(CODE).toMatch(/const pos = anchorRect\s*\?/);
    expect(CODE).toContain('{pos ? (');
  });

  it('§6 paper `Menu` geri sızmamış', () => {
    const paperImport = CODE.match(/import\s*\{([^}]*)\}\s*from\s*'react-native-paper'/s);
    expect(paperImport).not.toBeNull();
    expect(paperImport![1]).not.toMatch(/(^|[\s,])Menu(\s*,|\s*$)/);
  });

  it('§7 Modal sözleşmesi — transparent + statusBarTranslucent + geri tuşu', () => {
    // statusBarTranslucent LOAD-BEARING: measureInWindow PENCERE koordinatı verir;
    // modal status bar'ın altından başlarsa menü sabit bir offset kadar kayar.
    expect(CODE).toContain('statusBarTranslucent');
    expect(CODE).toContain('transparent');
    expect(CODE).toContain('onRequestClose={onDismiss}');
  });
});
