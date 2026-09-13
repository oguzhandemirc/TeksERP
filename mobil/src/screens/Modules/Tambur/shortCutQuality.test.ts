import { shortCutOverride, shortCutRevert } from './shortCutQuality';

// Kısa kesim → otomatik A1 kuralının bekçisi. Kural TEK dosyada yaşar ve üç
// yol (elle uzunluk / makine ölçümü / "kalanı kes") aynı fonksiyonu çağırır —
// buradaki sınırlar gevşerse üç yol birden gevşer.

// ⚠️ Katalog KODLARI burada FİXTÜR TANIMIDIR, gömülü varsayım değil: kural
// artık koda değil ROLE bakıyor (karar ①), ve fikstür bilerek bu fabrikanın
// kodlarını taşır ki "rol doğru satırı buluyor mu" ölçülebilsin.
// `SECOND` rolü `A1`de; kural onu ADIYLA değil ROLÜYLE bulmalı.
const GRADES = [
  { code: '1.KALITE', name: '1. Kalite', role: 'FIRST' as const, isActive: true },
  { code: 'A1', name: 'A1 (2. Kalite)', role: 'SECOND' as const, isActive: true },
  { code: 'FIRE', name: 'Fire', role: 'SCRAP' as const, isActive: true },
];

const base = {
  enabled: true,
  thresholdM: 15,
  lengthM: 12,
  currentCode: '1.KALITE',
  defaultCode: '1.KALITE',
  grades: GRADES,
};

describe('shortCutOverride — kısa kesim otomatik A1', () => {
  it('mutlu yol: bayrak açık + eşik altı + varsayılan kalite → A1 döner', () => {
    expect(shortCutOverride(base)?.code).toBe('A1');
  });

  it('BAYRAK KAPALIYKEN asla ateşlemez (kullanıcı isteği: sadece aktifken)', () => {
    expect(shortCutOverride({ ...base, enabled: false })).toBeNull();
  });

  it('eşik girilmemiş/geçersizken ateşlemez (bayrak açık olsa bile)', () => {
    expect(shortCutOverride({ ...base, thresholdM: null })).toBeNull();
    expect(shortCutOverride({ ...base, thresholdM: 0 })).toBeNull();
    expect(shortCutOverride({ ...base, thresholdM: -5 })).toBeNull();
    expect(shortCutOverride({ ...base, thresholdM: Number.NaN })).toBeNull();
  });

  it('eşiğe EŞİT uzunluk kısa sayılmaz ("15 m altı" dili — sınır dahil değil)', () => {
    expect(shortCutOverride({ ...base, lengthM: 15 })).toBeNull();
    expect(shortCutOverride({ ...base, lengthM: 14.9 })?.code).toBe('A1');
  });

  it('operatör ZATEN başka kalite seçtiyse dokunmaz (A1/FIRE ezilmez)', () => {
    expect(shortCutOverride({ ...base, currentCode: 'A1' })).toBeNull();
    expect(shortCutOverride({ ...base, currentCode: 'FIRE' })).toBeNull();
    expect(shortCutOverride({ ...base, currentCode: '' })).toBeNull();
    expect(shortCutOverride({ ...base, currentCode: null })).toBeNull();
  });

  it('A1 katalogda yoksa FAIL-CLOSED — kural hiç ateşlemez, kod uydurulmaz', () => {
    const noA1 = GRADES.filter((g) => g.role !== 'SECOND');
    expect(shortCutOverride({ ...base, grades: noA1 })).toBeNull();
  });

  it('geçersiz uzunlukta ateşlemez (0 / negatif / NaN)', () => {
    expect(shortCutOverride({ ...base, lengthM: 0 })).toBeNull();
    expect(shortCutOverride({ ...base, lengthM: -3 })).toBeNull();
    expect(shortCutOverride({ ...base, lengthM: Number.NaN })).toBeNull();
  });
});

describe('shortCutRevert — elle yazımda eşik üstüne çıkınca geri dönüş', () => {
  const rev = { enabled: true, thresholdM: 15, lengthM: 120, currentCode: 'A1', autoApplied: true, grades: GRADES };

  it('kuralın yazdığı A1, uzunluk eşiği aşınca varsayılana döner', () => {
    // Senaryo: "12" yazdı (A1 oldu) → "120"ye tamamladı. Geri dönüş olmasaydı
    // 120 m'lik top sessizce A1 kalırdı — otomasyon kendi hatasını üretirdi.
    expect(shortCutRevert(rev)).toBe(true);
  });

  it('operatörün KENDİ seçtiği A1 asla geri alınmaz (autoApplied=false)', () => {
    expect(shortCutRevert({ ...rev, autoApplied: false })).toBe(false);
  });

  it('uzunluk hâlâ eşik altındaysa A1 durur', () => {
    expect(shortCutRevert({ ...rev, lengthM: 10 })).toBe(false);
  });

  it('seçim bu arada A1 değilse dokunmaz', () => {
    expect(shortCutRevert({ ...rev, currentCode: 'FIRE' })).toBe(false);
  });

  it('bayrak/eşik kapandıysa otomatik A1 geri döner (dayanak kalktı)', () => {
    expect(shortCutRevert({ ...rev, lengthM: 10, enabled: false })).toBe(true);
    expect(shortCutRevert({ ...rev, lengthM: 10, thresholdM: null })).toBe(true);
  });
});
