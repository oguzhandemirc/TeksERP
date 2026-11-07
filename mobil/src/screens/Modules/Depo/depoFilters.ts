// =============================================================================
// Depo listesi + şeridinin süzgeç seti — TEK kaynak (liste ve `/rolls/stats` aynı seti yollar)
// =============================================================================
// Backend bekçisi `test_mulkiyet_kapsami` §9 bu setlerin aynasını (`TABLET_DEPO_TABS`) her mülkiyet
// kapsamıyla koşar: cursor listesi = şerit, bizim + emanet = tümü. Set değişirse ayna da değişir.
// =============================================================================
import { ownershipFilter, type OwnershipScope } from '../../../utils/ownership';

// "Ham" ve "Yarı Mamul" AYNI statüyü (STOCK) paylaşır — ayıran giriş kaynağıdır; ayrım SUNUCUDA
// (`rollScope=RAW_STOCK_PURE` / `SEMI_FINISHED`). Düz `status` süzgeci ikisini ayıramaz.
export type ModeFilter =
  | 'ALL' | 'WAREHOUSE' | 'IN_SACK' | 'STOCK' | 'SEMI_FINISHED' | 'SWATCH' | 'KARTELALIK';

/**
 * ALL sekmesi depo karakterli tüm statüleri kapsar (WAREHOUSE · A1_STOCK · STOCK); includeFire=true
 * olmadan backend FIRE kaliteleri sessizce gizler. Mülkiyet ALL iken parça eklenmez (eski istek).
 */
export function depoRollsFilters(mode: ModeFilter, scope: OwnershipScope): Record<string, string | string[]> {
  const own = ownershipFilter(scope);
  // Çuvalda sekmesi: çuvala konmuş + sevk edilmemiş (rollScope=IN_SACK). shipmentScope:'free' BİLİNÇLİ
  // verilmez — çuvallanmış topları elerdi. status:'ALL' → varsayılan STOCK süzgeci devre dışı.
  if (mode === 'IN_SACK') {
    return { includeFire: 'true', rollScope: 'IN_SACK', status: 'ALL', ...own };
  }
  const f: Record<string, string | string[]> = { includeFire: 'true' };
  if (mode === 'ALL') {
    // Tümü = TÜM envanter (serbest + çuvaldaki); satırdaki çuval rozetiyle ayrışırlar.
    f.statusIn = ['WAREHOUSE', 'A1_STOCK', 'STOCK'];
  } else {
    // Depo/Ham/Kartelalık = yalnız SERBEST stok; çuvaldakiler "Çuvalda" sekmesinde/"Tümü"de.
    f.shipmentScope = 'free';
    if (mode === 'WAREHOUSE') f.status = 'WAREHOUSE';
    // ⚠️ `status:'STOCK'` DEĞİL: o, yarı mamulü de kapsar; `status:'ALL'` varsayılan STOCK süzgecini kaldırır.
    else if (mode === 'STOCK') { f.rollScope = 'RAW_STOCK_PURE'; f.status = 'ALL'; }
    else if (mode === 'SEMI_FINISHED') { f.rollScope = 'SEMI_FINISHED'; f.status = 'ALL'; }
    else if (mode === 'KARTELALIK') {
      f.statusIn = ['WAREHOUSE', 'A1_STOCK', 'STOCK'];
      f.markedForKartela = 'true';
    }
  }
  return { ...f, ...own };
}
