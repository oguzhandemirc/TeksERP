// =============================================================================
// BEKÇİ — elle kodlu çuval SINIFLANDIRMA OLMADAN da bulunur
// =============================================================================
// Faz B'de (2026-09-22) gevşek ön ek çapası daraldı: ön ekten sonra rakam ya da
// ayraç isteniyor. Saha maruziyeti ölçüldü (0/8.089), ama `manualSackNo` CANLI
// bir özellik — yarın biri çuvala `A-17` yazabilir ve hiçbir sınıflandırıcı onu
// tanımaz. Bu dosya sapmanın BEDELİNİ ölçer: tanınmayan kod yanlış dala değil
// ARAMAYA düşmeli.
//
// ⭐ NEGATİF SONDA ✓B1 (2026-09-22, ölçüldü): `resolvePoolScan`ta sıra ters
//    çevrilip ÖNCE `isSackKind`a bakılınca ❌2 — elle kodlu çuval (`A-17`) ve
//    küçük harfli hâli `scan-into-sack`a düşüyor, yani "Top bulunamadı" derdi.
//    Geri alınca 7/7.
// =============================================================================
import { resolvePoolScan } from './resolvePoolScan';
import { FALLBACK_SCAN_SERIES, classifyWithTable } from '../../../services/scanSeries.service';

const isSackKind = (code: string) =>
  classifyWithTable(FALLBACK_SCAN_SERIES, code).kind === 'SACK';

const HAVUZ = [
  { id: 'sack-1', sackNo: 'CV2209260001' },
  { id: 'sack-2', sackNo: 'A-17' }, // ELLE verilmiş kod — seri biçiminin dışında
];

describe('resolvePoolScan — arama ÖNCE, sınıflandırma SONRA', () => {
  it('⭐ ELLE kodlu çuval (A-17) sınıflandırma tanımasa da bulunur', () => {
    expect(isSackKind('A-17')).toBe(false); // sınıflandırıcı tanımıyor — beklenen
    expect(resolvePoolScan('A-17', HAVUZ, isSackKind)).toEqual({
      action: 'select-sack',
      sack: HAVUZ[1],
    });
  });

  it('seri biçimli çuval kodu da bulunur (bugünkü davranış)', () => {
    expect(resolvePoolScan('CV2209260001', HAVUZ, isSackKind)).toEqual({
      action: 'select-sack',
      sack: HAVUZ[0],
    });
  });

  it('küçük harfle okutulan elle kod da bulunur', () => {
    expect(resolvePoolScan('  a-17 ', HAVUZ, isSackKind).action).toBe('select-sack');
  });

  it('çuval biçiminde ama havuzda yoksa "havuzda değil" der (top sanılmaz)', () => {
    expect(resolvePoolScan('CV2209269999', HAVUZ, isSackKind)).toEqual({
      action: 'sack-not-in-pool',
    });
  });

  it('top barkodu çuvala eklenecek koda düşer', () => {
    expect(resolvePoolScan('T220926H0001', HAVUZ, isSackKind)).toEqual({
      action: 'scan-into-sack',
    });
  });

  it('tanınmayan ve havuzda olmayan kod da top yoluna düşer (bugünkü davranış)', () => {
    expect(resolvePoolScan('ZZZ999', HAVUZ, isSackKind)).toEqual({ action: 'scan-into-sack' });
  });

  it('körlük zemini: havuz boşken hiçbir kod seçilmez', () => {
    expect(resolvePoolScan('A-17', [], isSackKind).action).toBe('scan-into-sack');
  });
});
