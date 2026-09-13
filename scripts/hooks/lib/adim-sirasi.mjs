// =============================================================================
// ADIM SIRASI — ucuz KAYIT adımları önce, ağır tip/lint/test sonra
// =============================================================================
// NEDEN (defter ölçümü 2026-09-14, d9 sınıflandırdı · d5 süreyi ölçtü): ilk 336 defter
// satırındaki 5 ❌'in 5'i KAYIT sınıfı (harita satırı · ölü çapa · lint · tavan), hiçbiri
// ürün davranışı — ve en sık ısıran adım (hızlı mandallar, 6–7 sn) tip+lint'ten SONRA
// koşuyordu: iki `identity_ledger` ısırığında 144 ve 165 sn boşa gitti, semafor slotu da
// o süre tutuldu. Ucuz adımlar başa alınınca kayıt ısırığı ilk ~15 sn'de düşer, tsc hiç
// başlamaz, slot hiç alınmaz.
//
// KURAL: `agir` işaretli adımlar (tsc · eslint · tavan · test) sona; işaretsizler başa.
// Sıralama KARARLIDIR — grup içi sıra korunur: lint tavanı lint'in raporunu okur, lint'in
// hemen ardında kalmalıdır; hiçbir adım bir öncekinin çıktısına başka yoldan bağlı değildir.
// =============================================================================

/** Kararlı bölme: ucuzlar (orijinal sırayla) + ağırlar (orijinal sırayla). */
export function sirala(adimlar) {
  return [...adimlar.filter((a) => !a.agir), ...adimlar.filter((a) => a.agir)];
}
