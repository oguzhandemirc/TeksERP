# Oturum B1 — `SEV.eszamanlilik`

> Bu dosyanın TAMAMI yeni bir oturuma yapıştırılmak içindir.
> Kaynak: audit/PLAN.md §7. Değişiklik gerekirse PLAN.md'yi düzenle ve bu dosyaları yeniden üret.

## Kapsam ve girdiler

**Kapsam:** `src/services/shipping.service.ts` (3.476) · `return.service.ts` (1.134) ·
`helpers/shipment-locks.helper.ts` · `helpers/allocation.helper.ts` · `helpers/sack-invariants.ts`

**Kapsam DIŞI:** brüt/net doğruluk kuralı → B6 (SEV.dogruluk). Muhasebe Excel'i → P1 (SEV.VER).

**Okunacaklar:** `audit/surface/12-tx-global-gercekler.md` (A3 çıktısı) ·
`06-veri-katmani.md` §3.3 satır 27/33 · `jq 'select(.cell=="CORE.veri-performans")' audit/FINDINGS.jsonl`

---

## YAPIŞTIRILACAK PROMPT

Bu bir DENETİM oturumudur. Kod DEĞİŞTİRME — salt okuma çalış.
Kod tabanı: /Users/oad/Documents/projeler/AdnanSahin/Teks-Erp (Express 5 + Prisma 7 + PostgreSQL, PRODUCTION CANLI).

ÇIKTI: bulgularını audit/FINDINGS.jsonl dosyasına APPEND et (satır başına bir JSON).
Şema ve yazım kuralları: audit/SCHEMA.md — ÖNCE ONU OKU.
Zorunlu alanlar: id, cell, severity, category, file, line, title, evidence, failure_mode,
fix_sketch, verification, status, confidence, session, found_at.

KALİTE KURALLARI:
- `failure_mode` üretemiyorsan (somut girdi -> somut yanlış sonuç) bu bir bulgu DEĞİLDİR.
  severity: bilgi ver ya da hiç yazma. "Bu kod karışık" bulgu değildir.
- Emin değilsen confidence: supheli ver ve verification alanına "nasıl kesinleşir" yaz.
- Aynı kök nedenin N tezahürü TEK bulgudur.
- CANLI SİSTEM: fix_sketch migration veya toplu veri dokunuşu öneriyorsa prod_risk: yuksek
  zorunlu ve geri alma yolu yazılmalı. `migrate reset` / reseed / toplu DELETE bu repoda YASAK.

YAZIM: Türkçe, teknik terimler İngilizce orijinaliyle. Emoji ve LaTeX kullanma.

OTURUM BAŞINDA ZORUNLU:
  jq -r 'select(.cell=="SEV.eszamanlilik") | "\(.id) [\(.severity)] \(.title)"' audit/FINDINGS.jsonl
  (mükerrer üretmemek için; boşsa ilk oturumdur)

VERİMLİLİK: ham araç çıktılarını (audit/raw/*.out) ve route envanterlerini BÜTÜN OLARAK OKUMA.
Hedefli grep/jq yap. Yüzey belgelerinden yalnız aşağıda listelenenleri oku.

BU OTURUMUN HÜCRESİ:  cell = SEV.eszamanlilik

GÖREV: Sevkiyat/çuval/iade akışının eşzamanlılık doğruluğu. Blast radius = PARA.

Doğrulanmış taban: shipping.service.ts kod tabanının en yoğun eşzamanlılık dosyası -
24 $transaction (rekor) + 46 updateMany (rekor) + 9 atomik claim.

1. performDispatchTx (1685-1762) - sevk anı. İçinde freezeForSource (belge dondurma) koşuyor,
   yani resmi belgenin TÜM içeriğini toplayan çok-sorgulu okuma + 4 seri ayar okuması tx'in içinde.
   SOR: bu tx ne kadar sürüyor, 20 sn bütçesini zorluyor mu (çok çuvallı sevkiyatta)?
   İki eşzamanlı dispatch aynı çuvalı sevk edebilir mi - atomik claim var mı, count kontrol
   ediliyor mu? Kilit sırası nedir (shipment-locks.helper)?

2. undoDispatch (storno, 1991-2053). Roll.preShipStatus snapshot'ıyla geri sarıyor.
   freezeForSource version:1 sabitten max+1'e çevrilmiş (yeniden sevk için). SOR: storno ile
   eşzamanlı bir iade (RollReturn) çakışırsa ne olur? resolveUndoBlockReason önizleme ve
   mutasyonda AYNI yüklemi çağırıyor mu (ayrışırsa ekran "yapılabilir" der, uç 409 verir)?

3. RollReturn ile Shipment sorguları AYRI TX'LERDE. CLAUDE.md üç ayrı yerde bu tuzağı anlatıyor
   ("shipment.findUnique ile iade sorgusu ayrı sorgulardır (tx yok) - arada bir iade commit
   olursa aynı top iki kez sayılır -> canlı id kümesiyle dedup"). DOĞRULA: getShipmentById,
   listShipments.attachTotals, collectShipmentDocContent, getDispatchReport - DÖRDÜNDE DE
   dedup var mı? Biri eksikse bulgu.

4. 46 updateMany'nin kaçı durum geçişi (claim olmalı), kaçı toplu güncelleme? Sonuç sayısı
   denetlenmeyenleri listele ve her biri için "burada claim gerekir mi" kararı ver.
   order.service.ts:1722'deki kod yorumu geçmişte tam bu sınıf bir hatayı anlatıyor - emsal olarak oku.

5. Sack yaşam döngüsü: aç -> okut -> tart -> sevk. touchWarehouseSackTx guard'ı hangi yollarda
   uygulanıyor, hangilerinde bilinçli olarak uygulanmıyor (Sack.notes istisnası CLAUDE.md'de yazılı)?
   Guard'ın atlandığı bir yol yanlışlıkla mı atlıyor?

6. SackAllocation sevk anında yazılıyor (distributeSacksToLines), shippedQty dispatch'te terfi
   ediyor. İki eşzamanlı sevk aynı OrderLine'a tahsis yazarsa toplam quantity'yi aşabilir mi?

BİTİŞ KRİTERİ: 6 madde karara bağlanacak. Madde 3 dört yüzeyin dördü için de açıkça
"dedup var/yok" diyecek. Madde 4'ün listesi eksiksiz olacak.
