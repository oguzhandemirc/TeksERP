import {
  DUPLICATE_CHOICE_SAME,
  DUPLICATE_CHOICE_NEW,
  type DuplicateEntryChoice,
} from './duplicateEntryChoice';

// =============================================================================
// MÜKERRER SEÇENEKLERİ — "birbirine benzeyen iki kelime" hatasının bekçisi.
//
// Sahaya çıkan hata: [AYNI · Etiket Bas] / [AYRI · Kaydet]. Tek harf fark.
// Kullanıcının bildirimi birebir: "türkçesi zayıf birisi okuyor bunu, bu iki
// kelime zor ayırt ediliyor". Aşağıdaki kontroller o dersi MEKANİK tutar —
// yeni bir metin denemesi benzeşirse burada kırmızı verir, sahada değil.
//
// ⚠️ Ölçütler sezgisel değil, sebebi olan sayılardır:
//   • mesafe ≥ 4  → "AYNI"/"AYRI" mesafesi 1'dir. 2 yetmez (ek değişimi tek harf
//     oynatır: "TOPU"/"TOPA"), 3 de yetmez ("1 TOP VAR"/"2 TOP VAR" gibi yalnız
//     rakamı değişen çift bu eşiği geçerdi — ilk taslakta tam bu yazıldı ve bu
//     test onu yakaladı.)
//   • ilk harf farkı → eldivenli operatör metnin tamamını okumaz, baştan tarar.
//   • ayrı rakam alanı → okuyamayan kişinin tek dilden-bağımsız tutamağı; metnin
//     İÇİNDE değil, kartın solunda büyük punto (rakam metne gömülürse "yalnız
//     rakamı değişen iki etiket" tuzağına geri düşülür).
//   • ORTAK BELİRGİN KELİME YOK → "YENİ" hem A'nın alt metninde hem B'nin
//     başlığında geçiyordu; kelimeyi arayan göz onu yanlış kartta buluyordu.
//   • ≤ 18 karakter → 460dp modalda yan yana buton ≈ 203dp; ikonla birlikte
//     metin orada kesilir (ölçüldü: "Etiketi Söktüm, İpta…").
// =============================================================================

/** Düzenleme (Levenshtein) mesafesi — iki etiketin karışabilirlik ölçüsü. */
function editDistance(a: string, b: string): number {
  const s = a.toLocaleUpperCase('tr');
  const t = b.toLocaleUpperCase('tr');
  const d: number[][] = Array.from({ length: s.length + 1 }, (_, i) =>
    Array.from({ length: t.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1),
      );
    }
  }
  return d[s.length][t.length];
}

/** Bir seçeneğin TÜM görünen metnindeki belirgin kelimeler (≥4 harf). */
function significantWords(c: DuplicateEntryChoice): Set<string> {
  return new Set(
    `${c.label} ${c.sublabel}`
      .toLocaleUpperCase('tr')
      .split(/[^A-ZÇĞİÖŞÜ0-9]+/)
      .filter((w) => w.length >= 4),
  );
}

/** WCAG göreli parlaklık (sRGB). */
function luminance(hex: string): number {
  const m = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG kontrast oranı. Gri tonda da AYNI formül geçerlidir (parlaklık ekseni). */
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const BOTH: [string, DuplicateEntryChoice][] = [
  ['1 top (aynı top)', DUPLICATE_CHOICE_SAME],
  ['2 top (ayrı top)', DUPLICATE_CHOICE_NEW],
];

describe('mükerrer giriş seçenekleri — karışabilirlik bekçisi', () => {
  it('iki etiket birbirine BENZEMEZ (düzenleme mesafesi ≥ 4)', () => {
    const dist = editDistance(DUPLICATE_CHOICE_SAME.label, DUPLICATE_CHOICE_NEW.label);
    expect(dist).toBeGreaterThanOrEqual(4);
  });

  it('etiketler FARKLI harfle başlar — baştan tarayan göz ayırsın', () => {
    const a = DUPLICATE_CHOICE_SAME.label.trim()[0];
    const b = DUPLICATE_CHOICE_NEW.label.trim()[0];
    expect(a).not.toBe(b);
  });

  it('rozet AYRI alanda ve farklı türde — sayı metne gömülmez', () => {
    // Her seçenekte ikon YA DA metin, ikisi birden değil (rozet tek bir şey söyler).
    BOTH.forEach(([name, c]) => {
      expect(`${name}: ${!!c.badgeIcon} ${!!c.badgeText}`).toBe(
        `${name}: ${c.badgeIcon ? 'true' : 'false'} ${c.badgeText ? 'true' : 'false'}`,
      );
      expect(Boolean(c.badgeIcon) !== Boolean(c.badgeText)).toBe(true);
      // Rakam etiketin İÇİNDE olmamalı: "1 TOP VAR"/"2 TOP VAR" tuzağı — yalnız
      // rakamı değişen iki etiket, AYNI/AYRI'nın sayısal ikizidir.
      expect(c.label).not.toMatch(/[0-9]/);
    });
    // İki rozet aynı şeyi göstermez.
    expect(DUPLICATE_CHOICE_SAME.badgeIcon ?? DUPLICATE_CHOICE_SAME.badgeText).not.toBe(
      DUPLICATE_CHOICE_NEW.badgeIcon ?? DUPLICATE_CHOICE_NEW.badgeText,
    );
  });

  it('rozet rakamı SAYIM değil DEĞİŞİM — "kaç top var" çerçevesi geri gelmez', () => {
    // "1"/"2" gibi çıplak sayım rakamı YASAK: elinde 2. topu tutan operatör
    // dürüstçe "1" der ve ikinci top stoğa hiç girmez; 3. özdeş topta iki cevap
    // da yanlış olur. Değişim rakamı ("+1") her durumda doğrudur.
    BOTH.forEach(([name, c]) => {
      if (!c.badgeText) return;
      expect(`${name}: ${c.badgeText}`).toMatch(/^[^:]+: [+±]/);
    });
  });

  it('metinler SAYMA sorusu sormaz (elinde/kaç top) — çerçeve yasağı', () => {
    BOTH.forEach(([, c]) => {
      const all = `${c.label} ${c.sublabel} ${c.a11y}`.toLocaleLowerCase('tr');
      expect(all).not.toMatch(/elinde|kaç top/);
    });
  });

  it('iki seçenek ORTAK BELİRGİN KELİME taşımaz (yanlış kartta bulunmasın)', () => {
    const a = significantWords(DUPLICATE_CHOICE_SAME);
    const b = significantWords(DUPLICATE_CHOICE_NEW);
    const shared = [...a].filter((w) => b.has(w));
    expect(shared).toEqual([]);
  });

  it('etiketler 460dp modalda kesilmeyecek kadar kısa (≤ 18 karakter)', () => {
    BOTH.forEach(([, c]) => expect(c.label.length).toBeLessThanOrEqual(18));
  });

  it('renk TEK ayırt edici değil — renksiz sınama', () => {
    expect(DUPLICATE_CHOICE_SAME.color).not.toBe(DUPLICATE_CHOICE_NEW.color);
    // Renk kapansa bile geriye rozet + rozet başlığı + fiil kalmalı: üçü de farklı.
    const colorlessCues = [
      (DUPLICATE_CHOICE_SAME.badgeIcon ?? DUPLICATE_CHOICE_SAME.badgeText) !==
        (DUPLICATE_CHOICE_NEW.badgeIcon ?? DUPLICATE_CHOICE_NEW.badgeText),
      DUPLICATE_CHOICE_SAME.badgeCaption !== DUPLICATE_CHOICE_NEW.badgeCaption,
      DUPLICATE_CHOICE_SAME.label !== DUPLICATE_CHOICE_NEW.label,
    ];
    expect(colorlessCues.every(Boolean)).toBe(true);
  });

  // ── ÖLÇÜLEN RENK KONTROLLERİ ───────────────────────────────────────────────
  // Renk kararı gözle değil SAYIYLA korunur: aşağıdaki üç eşik düşerse ekran
  // parlak atölye ışığında ya da renk körlüğünde okunamaz hâle gelir ve bunu
  // kimse fark etmez (hata vermez, log basmaz).

  it('İKİ KART GRİ TONDA AYRIŞIR (kontrast ≥ 3:1) — kutup terslemesi', () => {
    // Hue ayrımı yetmez: mavi-700 ↔ amber-700 çifti gri tonda 1.33:1 idi, yani
    // güneşte yıkanmış ekranda "aynı iki gri dikdörtgen". Biri KOYU biri AÇIK olmalı.
    const ratio = contrast(DUPLICATE_CHOICE_SAME.color, DUPLICATE_CHOICE_NEW.color);
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  it('kart metni dolgusu üstünde AA geçer (≥ 4.5:1)', () => {
    BOTH.forEach(([name, c]) => {
      const ratio = contrast(c.textColor, c.color);
      expect(`${name} metin/dolgu = ${ratio.toFixed(2)}`).toBe(
        `${name} metin/dolgu = ${ratio.toFixed(2)}`,
      );
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('rozet hem dolgudan hem içeriğinden ayrışır (≥3 / ≥4.5)', () => {
    BOTH.forEach(([, c]) => {
      // Rozet zemini kart dolgusundan ayrışsın (metin dışı öğe eşiği 3:1).
      expect(contrast(c.badgeBg, c.color)).toBeGreaterThanOrEqual(3);
      // Rozetin İÇİ (glif/rakam) okunsun.
      expect(contrast(c.badgeFg, c.badgeBg)).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('rozet kartın TERS kutbunda — açık kartta koyu rozet, koyu kartta açık', () => {
    BOTH.forEach(([, c]) => {
      const cardDark = luminance(c.color) < 0.25;
      const badgeDark = luminance(c.badgeBg) < 0.25;
      expect(cardDark).not.toBe(badgeDark);
    });
  });

  it('kenarlık beyaz sayfada görünür (≥ 3:1) — açık kartın kenarı kaybolmasın', () => {
    BOTH.forEach(([, c]) => {
      expect(contrast(c.borderColor, '#ffffff')).toBeGreaterThanOrEqual(3);
    });
  });

  it('perde kartın KUTBUNU izler — opaklık yerine scrim', () => {
    BOTH.forEach(([, c]) => {
      const cardDark = luminance(c.color) < 0.25;
      // Koyu kart siyah perde ister, açık kart beyaz: ikisi de metin kontrastını
      // korur/artırır. Ters kombinasyon metni yıkar (ölçüldü: 5.0 → 2.3).
      expect(c.scrim.startsWith(cardDark ? 'rgba(15,23,42' : 'rgba(255,255,255')).toBe(
        true,
      );
    });
  });

  it('OLUMSUZLAMA yok — "açılmaz/açılır" çifti AYNI/AYRI ile aynı hata sınıfı', () => {
    BOTH.forEach(([, c]) => {
      expect(c.sublabel.toLocaleLowerCase('tr')).not.toMatch(/(maz|mez)\b/);
    });
  });

  it('"stok" kökü ÇEKİMLENMEZ — "stoğa" yanlış yazım, "stoka" doğrusu', () => {
    BOTH.forEach(([, c]) => {
      expect(`${c.label} ${c.sublabel}`.toLocaleLowerCase('tr')).not.toContain('stoğ');
    });
  });

  it('renkler projenin sözleşmesinde: mavi = kâğıt, amber = yeni stok kaydı', () => {
    // ⚠️ Hue sözleşmesi (CLAUDE.md): mavi yalnız kâğıt basar, amber yeni stok
    // kaydı doğurur. Ton (500/700) değişebilir — kutup terslemesi bunu gerektirdi —
    // ama HUE değişemez; başka bir renk seçmek aynı ekrandaki diğer butonların
    // anlamını da bozar.
    expect(DUPLICATE_CHOICE_SAME.color).toBe('#1d4ed8'); // colors.infoDark (blue-700)
    expect(DUPLICATE_CHOICE_NEW.color).toBe('#f59e0b'); // colors.warning (amber-500)
  });

  it('her seçenek ekran okuyucuya TAM cümle söyler', () => {
    BOTH.forEach(([, c]) => {
      expect(c.a11y.length).toBeGreaterThan(20);
      expect(c.a11y).toMatch(/\.$/);
    });
  });

  it('eski karışan çift geri GELMEZ (AYNI/AYRI)', () => {
    BOTH.forEach(([, c]) => {
      expect(c.label.toLocaleUpperCase('tr')).not.toMatch(/^AYNI\b/);
      expect(c.label.toLocaleUpperCase('tr')).not.toMatch(/^AYRI\b/);
    });
  });
});
