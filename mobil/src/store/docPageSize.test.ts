import { describe, it, expect } from '@jest/globals';
import { parseDocPageSizes, type DocPageSize } from './deviceSettingsStore';

// =============================================================================
// BEKÇİ: belge kâğıt boyu — CİHAZ hafızası + üç durumlu döngü (2026-08-09)
// =============================================================================
// Saha isteği: *"cihazda son seçilen A5 ise bir sonraki yazdırmada A5 seçili
// gelsin."*
//
// Bu bekçinin kilitlediği üç şey:
//   §1 Hafıza BELGE TİPİ BAŞINA — kart A5 iken çeki A4 kalabilmeli. Tek ortak
//      hafıza olsaydı operatör her baskıda anahtarı çevirirdi (tam da
//      `kk1ManualEntry`i cihaza taşıma gerekçesi).
//   §2 Bozuk disk kaydı baskı yolunu DÜŞÜRMEZ — yalnız o giriş atılır.
//   §3 Döngü ÜÇ durumlu ve "kalıcı ayarı kullan" hâline GERİ DÖNÜLEBİLİR.
//      İki durumlu yapılsaydı operatör seçimini iptal edip sunucudaki ayara
//      dönemezdi ve mobil, ayarın ne olduğunu bilmediği için rozet yalan söylerdi.
// =============================================================================

/** Ekrandaki `cyclePageSize` ile AYNI kural — ayrışırsa bekçi süs olur. */
function cycle(cur: DocPageSize | undefined): DocPageSize | null {
  return cur == null ? 'A4' : cur === 'A4' ? 'A5' : null;
}

describe('belge kâğıt boyu — cihaz hafızası', () => {
  it('§1 hafıza BELGE TİPİ BAŞINA tutulur (kart ile çeki birbirini ezmez)', () => {
    const raw = JSON.stringify({ TRAVELER_CARD: 'A5', SUBCONTRACTOR_DISPATCH: 'A4' });
    const m = parseDocPageSizes(raw);
    expect(m.TRAVELER_CARD).toBe('A5');
    expect(m.SUBCONTRACTOR_DISPATCH).toBe('A4');
  });

  it('§1b kaydı olmayan tip `undefined` → istemci parametre GÖNDERMEZ (kalıcı ayar geçerli)', () => {
    const m = parseDocPageSizes(JSON.stringify({ TRAVELER_CARD: 'A5' }));
    // Bu satır load-bearing: `undefined` olmazsa `printDocument`a değer gider ve
    // sunucudaki kalıcı ayar sessizce ezilirdi.
    expect(m.SUBCONTRACTOR_DISPATCH).toBeUndefined();
  });

  it('§2 bozuk/yabancı değerler ATILIR, harita çöpe gitmez', () => {
    const m = parseDocPageSizes(
      JSON.stringify({ A: 'A5', B: 'A3', C: null, D: 42, E: 'a5', F: 'A4' }),
    );
    expect(m).toEqual({ A: 'A5', F: 'A4' });
  });

  it('§2b bozuk JSON / dizi / boş → boş harita (baskı yolu DÜŞMEZ)', () => {
    expect(parseDocPageSizes('{bozuk')).toEqual({});
    expect(parseDocPageSizes('[1,2]')).toEqual({});
    expect(parseDocPageSizes('null')).toEqual({});
    expect(parseDocPageSizes(null)).toEqual({});
    expect(parseDocPageSizes('')).toEqual({});
  });

  it('§3 ⭐ döngü ÜÇ durumlu ve başa DÖNER (Ayar → A4 → A5 → Ayar)', () => {
    expect(cycle(undefined)).toBe('A4');
    expect(cycle('A4')).toBe('A5');
    // null = "tercihi kaldır" → yine sunucudaki kalıcı ayar kullanılır.
    expect(cycle('A5')).toBeNull();
  });

  it('§3b üç dokunuş sonunda BAŞLANGIÇ durumuna dönülür', () => {
    let s: DocPageSize | null | undefined = undefined;
    for (let i = 0; i < 3; i++) s = cycle(s ?? undefined);
    expect(s).toBeNull(); // "Ayar" — başlangıçla aynı anlam
  });
});
