// =============================================================================
// TOP LİSTELERİNİN GÖRÜNÜM SIRASI — TEK KAYNAK (2026-09-23)
// =============================================================================
// ⚠️ NEDEN SABİT: sekiz ayrı sorgu topları `barcode asc` ile sıralıyordu ve bu,
// barkodun DOLGULU olmasına bel bağlayan gizli bir varsayımdı — dolgu bir
// GÖRÜNÜM ayarı olduğu için (D2③: hane dolgudur, kapasite değildir) fabrika onu
// kaldırabilir ve o an metin sırası bozulur: `…H10` metinde `…H9`dan ÖNCE gelir.
// Sekiz yer ayrı ayrı düzeltilseydi biri unutulur ve yalnız o listede sıra
// karışırdı ("ayrışan yüzey" sınıfı).
//
// ⚠️ SIRA `createdAt` ÖNCE, `barcode` SONRA: barkod sırası zaten DOĞUŞ sırasının
// vekiliydi; dolgu kalkınca vekillik biter, asıl ölçüt kalır. İkinci anahtar
// determinizm içindir — toplu doğan toplar aynı milisaniyeyi paylaşabilir ve
// tek anahtarlı sıralama o kümede rastgele gelirdi (1e kararı 2026-09-23).
//
// ⚠️ BELGE ÇIKTILARI BU SABİTİ KULLANMAZ ve kullanmamalı: sevk belgesi ve çeki
// listesi zaten `createdAt asc` ile kendi sorgularını kuruyor, donmuş belgeler
// ise anlık görüntüden okunuyor — yani bu değişiklik basılmış hiçbir kâğıdı
// geçmişe dönük değiştirmez (ölçüldü 2026-09-23: sekiz çağrı yerinin hiçbiri
// belge ya da Excel beslemiyor; hepsi ekran listesi, önizleme ya da uyarı metni).
import type { Prisma } from "@prisma/client";

export const ROLL_DISPLAY_ORDER: Prisma.RollOrderByWithRelationInput[] = [
  { createdAt: "asc" },
  { barcode: "asc" },
];
