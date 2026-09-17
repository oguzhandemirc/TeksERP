// =============================================================================
// CARİ HESABI GÖSTEREN MODEL+ALAN ÇİFTLERİ — TEK KAYNAK
// =============================================================================
// Hem göç betiği (`migrate_partner_roles.ts`) hem bekçisi bu tabloyu okur.
//
// ⚠️ NEDEN AYRI DOSYA (ölçüldü 2026-09-17): tablo önce betiğin İÇİNDEYDİ ve
// bekçi onu oradan import ediyordu — ama bir CLI betiğinden değer import etmek
// BETİĞİ KOŞTURMAKtır: betiğin üst düzey `main()`i çalıştı, `pool.end()` çağırdı
// ve BEKÇİNİN havuzunu kapattı ("Cannot use a pool after calling end on the pool").
// ⇒ *Bir CLI betiğinden değer import etmek, onun bütün yan etkilerini de import
//   etmektir; paylaşılan tablo paylaşılan bir modülde yaşar.*
// =============================================================================

/**
 * Hesabın ÇOCUKLARI — cari hesabı GÖSTEREN her model/alan çifti.
 *
 * ⚠️ MODEL DEĞİL, MODEL+ALAN: alan adı her yerde `cariId` DEĞİLDİR
 * (`ChequeEvent.counterCariId`) ve bir model İKİ bağ taşıyabilir
 * (`Cheque.cariId` + `Cheque.endorsedToCariId`). Model listesi tutan bir
 * uygulama ikisini de kaçırır. `CariBalance` bu listede YOK: PK'sı
 * `(cariId, currency)` ve TOPLANIR (dosya başlığı ①).
 * ⇒ *Bir ilişki listesi ELLE yazılmaz, ŞEMADAN ölçülür — bekçi
 *   (`test_migrate_partner_roles §0`) bu tabloyu şemayla iki yönlü birebirler.*
 *
 * ⚠️ SIRA DETERMİNİSTİK: aynı tx'te birden çok tabloya yazan her yol sabit sırada
 * yazar (kilit sırası kuralı). Alfabetik değil, DEFTER ÖNCE: bakiyeyi belirleyen
 * satırlar taşınmadan yardımcı kayıtlar taşınırsa, ortada kalan bir çökme
 * "hareketi taşınmış ama defteri taşınmamış" bir hesap bırakırdı.
 */
export const COCUKLAR: ReadonlyArray<{ model: string; alan: string }> = [
  // Defter ÖNCE (bakiyeyi belirleyen satırlar), sonra yardımcı kayıtlar.
  { model: "cariTransaction", alan: "cariId" },
  { model: "invoice", alan: "cariId" },
  { model: "payment", alan: "cariId" },
  { model: "cheque", alan: "cariId" },
  // ⚠️ ÇEKİN İKİNCİ BAĞI (ölçüldü 2026-09-17): ciro edilen çek, ciro EDİLDİĞİ
  // cariyi ayrı bir kolonda tutar. Yalnız `cariId` taşınsaydı ciro hedefi eski
  // (artık PASİF) hesabı göstermeye devam ederdi — sessiz, çünkü hiçbir sayaç
  // bozulmaz: bakiye doğru kalır, bağ yanlış olur.
  { model: "cheque", alan: "endorsedToCariId" },
  // ⚠️ ADI `cariId` DEĞİL: `ChequeEvent` karşı tarafı `counterCariId`de tutar.
  // Liste elle yazılmış olsaydı (ve yazılmıştı) bu satır sessizce düşerdi —
  // çocuk süreç `Unknown argument cariId` ile ÇÖKTÜ ve öyle bulundu.
  { model: "chequeEvent", alan: "counterCariId" },
  { model: "cariPeriodClose", alan: "cariId" },
  { model: "reconciliationLetter", alan: "cariId" },
  { model: "chequeDeliveryNote", alan: "cariId" },
] as const;
