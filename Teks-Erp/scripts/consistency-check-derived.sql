-- =============================================================================
-- TeksERP — Veri Tutarlılık Kontrolü / TÜRETİLMİŞ ALANLAR  (consistency-check-derived.sql)
-- =============================================================================
-- Bu dosya `scripts/consistency-check.sql`'in KARDEŞİDİR, devamı değil. Orası
-- defter/denormalize toplamlara bakar (shippedQty, snapshot totalQty, çuval↔sevk
-- üyeliği). Burası ise **bir başka alandan TÜRETİLMESİ gereken** alanların
-- kaynağından kopup kopmadığına bakar:
--
--   §21  WorkOrder.type                ← sipariş bağının VARLIĞI
--   §22  WorkOrder.status              ← adım durumlarının TAMAMLANMIŞLIĞI
--   §23  KursunBypassAssignment açıklığı ← sahibi iş emrinin CANLILIĞI
--   §24  Fason kalemin "açık/kapalı"lığı ← OPEN_OUTSTANDING dörtlüsü (a/b/c)
--   §25  Roll.labelDirty               ← etiketi etkileyen son değişikliğin ANI
--   §26  Roll.colorId                  ← iş emrinin hedef rengi (+ sapma defteri)
--
-- Ortak nokta: hiçbirinde DB seddi YOKTUR. Tek koruma yazan kod yolunun disiplinidir;
-- yeni bir yol (yeni ekran, yeni script, yeni toplu işlem) o disiplini atlarsa hata
-- da log da oluşmaz — yalnız liste yanlış basar, kart yanlış yazar, kuyruk yanlış
-- dolar. §21 tam olarak böyle bulundu (2026-08-21, commit 74d92085): "Sipariş Bağla"
-- pivot satırını yazıyor ama `type`'a dokunmuyordu; 13 iş emri listede/künyede/kartta
-- "Stok" basarken detay panelinde siparişi gösteriyordu.
--
-- ⚠️ MEKANİK İKİZİ VAR: `scripts/test_consistency_derived.ts` aşağıdaki sorguları
--    AYNEN koşar ve her bölümü bir check()'e bağlar → `npm test` ile otomatik,
--    drift = KIRMIZI. Gerekçe (kardeş dosyanınkiyle aynı): `psql` HER durumda
--    `exit 0` verir; bu dosyayı elle koşmak satırları BASAR ama hiçbir otomasyon
--    farkı göremez. Bu dosya operatörün satırları GÖZLE görmesi için duruyor.
--    Bir bölümün mantığı değişecekse ÖNCE BURADA değişir, sonra test'e kopyalanır.
--
-- Ne zaman: kardeş dosyayla birlikte (3 ayda bir) + şüphe anında. Salt-okunur.
--           §21/§22 için EK OLARAK: iş emri tipi/durumu yazan bir akış değiştiyse.
--           §24 için: fason kabul/iptal/doğrudan-sevk yollarına dokunan her sürümden
--           sonra (OPEN_OUTSTANDING dörtlüsünün elle yazılmış kopyaları tarihsel
--           olarak eksik çıkmıştır — bkz. fason-open-dispatch.helper.ts başlığı).
-- Kullanım: psql <db> -f scripts/consistency-check-derived.sql
-- Yorum:    §21-§25 SORUNLU satırları döndürür; hepsi boşsa sistem sağlıklı.
--           §26 BİLGİ bölümüdür (aşağıdaki gerekçeye bak) — satır dönmesi tek
--           başına hata değildir; asıl kapı §26b'dir.
-- =============================================================================

-- Plan-sapma kapısının YÜRÜRLÜĞE GİRDİĞİ an — §26b bunun ÖNCESİNİ saymaz.
-- Değiştirmek için: psql -v plan_gate_since='2026-09-01 00:00:00+03' -f ...
\if :{?plan_gate_since}
\else
\set plan_gate_since '2026-08-20 00:00:00+03'
\endif

\echo ''
\echo '== 21) WorkOrder.type  ↔  sipariş bağının varlığı  (tip bağın AYNASIDIR) =='
\echo '   (satır varsa: liste/künye/refakat kartı ile detay paneli FARKLI şey söylüyor)'
-- `type = ORDER_PRODUCTION` ile "en az bir bağ var" ÖNERMELERİ birbirinin aynası
-- olmalıdır. Eşitliği tek ifadeyle yazmak bilinçlidir: iki ayrı OR dalı yazılsaydı
-- biri güncellenip diğeri unutulabilirdi.
--   • STOK ama bağlı  → "önce stok için aç, sonra Sipariş Bağla" sırası (74d92085
--     öncesi `linkOrderLines` tipe dokunmuyordu). Onarım: scripts/fix_workorder_type_from_links.ts
--   • SİPARİŞE ÖZEL ama bağsız → bağ SÖKÜLMÜŞ ama tip geri alınmamış. `unlinkOrderLine`
--     son bağ kalkınca STOK'a döner (simetrik), ama bu yol tek kapı DEĞİLDİR: sipariş
--     satırı silinince pivot `onDelete: Cascade` ile SESSİZCE düşer ve o yolda tipe
--     dokunan kimse yoktur. Yani ters yön gerçek bir açıktır ve burada yakalanır.
-- CANCELLED/SUPERSEDED dışarıda: onlar tarihsel kayıttır, plan düzenlemesine kapalıdır
-- (`assertPlanEditable`) ve geriye dönük "düzeltmek" donmuş belgeyi değiştirmek olurdu.
SELECT wo.id AS work_order_id,
       wo."workOrderNumber",
       wo.type::text   AS tip,
       wo.status::text AS durum,
       (SELECT COUNT(*) FROM work_order_to_order_lines l WHERE l."workOrderId" = wo.id) AS bag_sayisi,
       CASE WHEN wo.type = 'STOCK_PRODUCTION'
            THEN 'STOK ama sipariş bağı VAR'
            ELSE 'SİPARİŞE ÖZEL ama bağ YOK' END AS sapma,
       wo."createdAt"
FROM work_orders wo
WHERE wo.status NOT IN ('CANCELLED', 'SUPERSEDED')
  AND (wo.type = 'ORDER_PRODUCTION')
      IS DISTINCT FROM
      EXISTS (SELECT 1 FROM work_order_to_order_lines l WHERE l."workOrderId" = wo.id)
ORDER BY wo."createdAt";

\echo ''
\echo '== 22) IN_PROGRESS iş emri ama TÜM adımları COMPLETED/SKIPPED =='
\echo '   (satır varsa: completeWorkOrderIfStepsDone kaçırılmış — WO sonsuza dek açık kalır)'
-- `completeWorkOrderIfStepsDone` (roll-step.helper.ts) tam olarak bu koşulda WO'yu
-- COMPLETED'e çeker: COMPLETED/SKIPPED dışında adım kalmadıysa. Çağrılmadığında hata
-- oluşmaz — iş emri "devam ediyor" görünür, kapasite/kuyruk raporlarında yer kaplar,
-- kart ACTIVE kalır. Adım durumunun KENDİSİNİN mutabakatı kardeş dosyanın §20'sindedir;
-- burada adım durumları DOĞRU kabul edilip WO'ya YANSIYIP yansımadığına bakılır.
-- JOIN (LEFT değil) load-bearing: adımsız WO bu bölümün konusu değildir (helper'ın
-- `remaining = 0` dalı orada da tetiklenirdi ama adımsız WO'nun kendisi ayrı bir
-- anomalidir ve kardeş dosyanın §16 gürültü notunda ele alınır).
SELECT wo.id AS work_order_id,
       wo."workOrderNumber",
       wo.status::text AS durum,
       COUNT(*)        AS adim_sayisi,
       COUNT(*) FILTER (WHERE s.status = 'SKIPPED') AS atlanan,
       MAX(s."completedAt") AS son_adim_tamamlanma
FROM work_orders wo
JOIN work_order_steps s ON s."workOrderId" = wo.id
WHERE wo.status = 'IN_PROGRESS'
GROUP BY wo.id, wo."workOrderNumber", wo.status
HAVING COUNT(*) FILTER (WHERE s.status NOT IN ('COMPLETED', 'SKIPPED')) = 0
ORDER BY MAX(s."completedAt");

\echo ''
\echo '== 23) AÇIK kurşun bypass ataması ama sahibi iş emri TERMİNAL =='
\echo '   (satır varsa: devir/tebdil/iptalde repoint ya da void unutulmuş)'
-- `KursunBypassAssignment` append-only bir atamadır ve iki kapanış yolu vardır:
-- `completedAt` (Tambur okutması / dağıtım kapanışı) ya da `cancelledAt`. İkisi de
-- boşsa atama AÇIKTIR ve kurşun dağıtım ekranında iş olarak durur. Sahibi WO
-- COMPLETED/SUPERSEDED/CANCELLED ise o iş artık YOKTUR: operatör kuyrukta hayalet
-- bir satır görür, tıklar, "bu iş emri kapalı" der ve satır orada kalmaya devam eder.
SELECT kb.id AS bypass_id,
       wo."workOrderNumber",
       wo.status::text AS wo_durumu,
       m.code          AS makine_kodu,
       kb."assignedAt",
       kb.notes
FROM kursun_bypass_assignments kb
JOIN work_orders wo ON wo.id = kb."workOrderId"
LEFT JOIN machines m ON m.id = kb."machineId"
WHERE kb."completedAt" IS NULL
  AND kb."cancelledAt" IS NULL
  AND wo.status IN ('COMPLETED', 'SUPERSEDED', 'CANCELLED')
ORDER BY kb."assignedAt";

\echo ''
\echo '== 24a) Fason kalemin TEK tam makbuzu İPTAL edilmiş (kalem yeniden AÇIK) =='
\echo '   (satır varsa: receipt.cancelledAt süzgeci olmayan HER kopya bu kalemi KAPALI sanır)'
-- OPEN_OUTSTANDING dörtlüsü (fason-open-dispatch.helper.ts):
--   sevk iptal değil ∧ doğrudan-sevk değil ∧ kalem remainderClosedAt null
--   ∧ kalemin İPTAL EDİLMEMİŞ tam (isPartial=false) makbuzu YOK
-- Bu bölüm dördüncü koşulun tam da tuzağa düştüğü şekli arar: kalemin tam makbuzu
-- VAR ama hepsi iptal edilmiş. Doğru kod bunu "hâlâ dışarıda" sayar (top da öyle
-- duruyor: AT_SUBCONTRACTOR), `receipt.cancelledAt` süzgecini taşımayan eski kopya
-- ise "dönmüş" sayar → WO listede gizlenir, kart açık-sevk uyarısı vermez,
-- hızlı-fason önizlemesi grubu hiç göstermez.
-- Satır DÖNMESİ kendi başına "bozuk veri" demek DEĞİLDİR (kabul iptali meşru bir
-- işlemdir); satırın anlamı "bu kaydın üzerinde eksik bir predikat SESSİZCE yanlış
-- davranır" — yani canlıda böyle bir şekil varken predikat kopyası aramak ZORUNLUDUR.
SELECT sdi.id       AS dispatch_item_id,
       sd."dispatchNo",
       r.barcode,
       r.status::text AS top_durumu,
       sdi."dispatchedQty",
       (SELECT COUNT(*) FROM subcontractor_receipt_items x
         WHERE x."sourceDispatchItemId" = sdi.id AND x."isPartial" = false) AS tam_makbuz_satiri,
       sd."dispatchedAt"
FROM subcontractor_dispatch_items sdi
JOIN subcontractor_dispatches sd ON sd.id = sdi."dispatchId"
JOIN rolls r ON r.id = sdi."rollId"
WHERE sd."cancelledAt" IS NULL
  AND sdi."remainderClosedAt" IS NULL
  AND r.status = 'AT_SUBCONTRACTOR'
  AND EXISTS (
        SELECT 1 FROM subcontractor_receipt_items sri
        WHERE sri."sourceDispatchItemId" = sdi.id AND sri."isPartial" = false)
  AND NOT EXISTS (
        SELECT 1 FROM subcontractor_receipt_items sri
        JOIN subcontractor_receipts sr ON sr.id = sri."receiptId"
        WHERE sri."sourceDispatchItemId" = sdi.id
          AND sri."isPartial" = false
          AND sr."cancelledAt" IS NULL)
ORDER BY sd."dispatchedAt";

\echo ''
\echo '== 24b) DOĞRUDAN SEVK edilmiş sevkin topu HÂLÂ fasonda (AT_SUBCONTRACTOR) =='
\echo '   (satır varsa: mal hem "müşteriye çıktı" hem "fasonda bekliyor" — çift sayım)'
-- ⚠️ `r.status = 'AT_SUBCONTRACTOR'` SÜZGECİ LOAD-BEARING, "fazladan" değil.
-- `directShippedAt` dolu bir sevkin kalemleri TANIM GEREĞİ makbuzsuz ve
-- remainderClosedAt'sizdir (mal fasondan doğrudan müşteriye çıktı, dönmeyecek) —
-- yani süzgeç olmasaydı bu bölüm her MEŞRU doğrudan-sevki drift sayardı ve fabrika
-- özelliği ilk kullandığı gün kalıcı kırmızıya düşerdi (sonu: bekçinin kapatılması).
-- Gerçek invariant şudur: `directShipRolls` sevk edilen TOPLARI aynı tx'te
-- `SUBCONTRACTOR_CONSUMED` yapar (subcontractor.service.ts, adım 3). Dolayısıyla
-- "sevk tam olarak doğrudan-sevk edildi (directShippedAt damgalandı)" ile "topu
-- hâlâ fasonda" AYNI ANDA doğru olamaz. Olduysa tx yarım kalmış ya da statüyü
-- sonradan geri yazan bir yol var demektir; sonuç, aynı metrajın hem sevk
-- raporunda hem fason bakiyesinde görünmesidir.
SELECT sdi.id      AS dispatch_item_id,
       sd."dispatchNo",
       sd."directShippedAt",
       r.barcode,
       r.status::text AS top_durumu,
       r."currentQty",
       sdi."dispatchedQty"
FROM subcontractor_dispatch_items sdi
JOIN subcontractor_dispatches sd ON sd.id = sdi."dispatchId"
JOIN rolls r ON r.id = sdi."rollId"
WHERE sd."directShippedAt" IS NOT NULL
  AND sd."cancelledAt" IS NULL
  AND sdi."remainderClosedAt" IS NULL
  AND r.status = 'AT_SUBCONTRACTOR'
  AND NOT EXISTS (
        SELECT 1 FROM subcontractor_receipt_items sri
        JOIN subcontractor_receipts sr ON sr.id = sri."receiptId"
        WHERE sri."sourceDispatchItemId" = sdi.id
          AND sri."isPartial" = false
          AND sr."cancelledAt" IS NULL)
ORDER BY sd."directShippedAt";

\echo ''
\echo '== 24c) AÇIK+OUTSTANDING fason kalemi ama top FASONDA DEĞİL =='
\echo '   (satır varsa: boyahanedeki mal sistemde içeride görünüyor — aynı metraj İKİ yerde)'
-- 24b'nin TERSİ yönü. Orada "mal çıktı ama fasonda görünüyor", burada "mal fasonda
-- ama içeride görünüyor". İkisi ayrı bölümdür çünkü ayrı kod yolları üretir ve
-- birini kapatan düzeltme diğerine dokunmaz.
--
-- Neden gerçek bir açık: 2026-08-29'a dek iş emri iptali `cancelBulk`ın PARÇALI
-- başarısını okumuyordu (`failed[]` atılıyordu) ve hemen ardından gelen
-- "artık kalan fason topları" yazımı topu tx DIŞINDA IN_PRODUCTION'a çekiyordu.
-- Sevk kapanmamışken top içeri alınıyor, tx içindeki fason guard'ı onu artık
-- göremiyor (count=0) ve blanket geri-çekme topu STOCK'a indiriyordu: açık sevk
-- ortada, mal Ham Stok'ta. En sık tetikleyici KISMİ KABUL — kısmi makbuz kalemi
-- KAPATMAZ (`isPartial=false` aranır) ama `cancel()` "kabul yapılmış" der.
--
-- ⚠️ `directShippedAt IS NULL` LOAD-BEARING: doğrudan sevkte top MEŞRUEN
-- `SUBCONTRACTOR_CONSUMED` olur (o yön 24b'nin işi). Süzgeç olmasaydı her meşru
-- doğrudan-sevk burada drift sayılırdı.
-- Ölçüm (2026-08-29): dev 0 satır · saha kopyası 188 kalemin TAMAMI
-- AT_SUBCONTRACTOR → invariant canlıda tutuyor, bölüm vakumen yeşil değil.
SELECT sdi.id      AS dispatch_item_id,
       sd."dispatchNo",
       sd."dispatchedAt",
       r.barcode,
       r.status::text AS top_durumu,
       r."currentQty",
       sdi."dispatchedQty",
       w."workOrderNumber",
       w.status::text AS is_emri_durumu
FROM subcontractor_dispatch_items sdi
JOIN subcontractor_dispatches sd ON sd.id = sdi."dispatchId"
JOIN rolls r ON r.id = sdi."rollId"
JOIN work_orders w ON w.id = sd."workOrderId"
WHERE sd."cancelledAt" IS NULL
  AND sd."directShippedAt" IS NULL
  AND sdi."remainderClosedAt" IS NULL
  AND r.status <> 'AT_SUBCONTRACTOR'
  AND NOT EXISTS (
        SELECT 1 FROM subcontractor_receipt_items sri
        JOIN subcontractor_receipts sr ON sr.id = sri."receiptId"
        WHERE sri."sourceDispatchItemId" = sdi.id
          AND sri."isPartial" = false
          AND sr."cancelledAt" IS NULL)
ORDER BY sd."dispatchedAt";

\echo ''
\echo '== 25) Kartelalık işareti etiket BASILDIKTAN SONRA değişmiş ama etiket BAYAT değil =='
\echo '   (satır varsa: topun üstündeki kâğıt kartela damgası konusunda YALAN söylüyor)'
-- `labelDirty` "basılı etiket veriyle uyuşuyor mu" sorusunun tek cevabıdır ve
-- `recordPrintEvent` ile false'a döner. Kartelalık damgası etikete BASILAN bir alandır
-- (config/label-fields.ts). `setRollMarkedForKartela` bayrağı değiştirir ama
-- `labelDirty`'ye dokunmaz → etiket basılmış bir topun kartela damgası sessizce
-- değişebilir ve hiçbir yüzey "yeniden bas" demez.
--
-- ⚠️ KANIT AUDIT'TEN OKUNUR ve bu bölümün BİLİNEN sınırıdır: `archive-scheduler`
-- `system_logs`'u 6 ayda bir arşive TAŞIR. Yani altı aydan eski bir değişiklik
-- burada GÖRÜNMEZ ve bölüm sessizce yeşile döner. Bu yüzden sorgu EXISTS ile kurulur
-- (log yoksa satır ÜRETİLMEZ, "log yok = drift" gibi okunmaz) ve bölüm bir TARAMA
-- aracıdır, kanıt değil. Kalıcı çözüm `labelPrintedAt`/`entryReason` dersinin aynısı
-- olurdu: kararın izi kaydın KENDİ satırında yaşamalı (ör. toggle'ın labelDirty'yi
-- set etmesi) — o yapıldığında bu bölüm kendiliğinden anlamsızlaşır.
SELECT r.id AS roll_id,
       r.barcode,
       r.status::text AS durum,
       r."labelPrintedAt",
       (SELECT MAX(sl."createdAt") FROM system_logs sl
         WHERE sl."tableName" = 'ROLL' AND sl."recordId" = r.id::text
           AND (sl."newData" ->> 'markedForKartela') IS NOT NULL) AS son_kartela_degisimi
FROM rolls r
WHERE r."markedForKartela" = true
  AND r."labelDirty" = false
  AND r."labelPrintedAt" IS NOT NULL
  AND EXISTS (
        SELECT 1 FROM system_logs sl
        WHERE sl."tableName" = 'ROLL'
          AND sl."recordId" = r.id::text
          AND (sl."newData" ->> 'markedForKartela') IS NOT NULL
          AND sl."createdAt" > r."labelPrintedAt")
ORDER BY r."labelPrintedAt";

\echo ''
\echo '== 26) BİLGİ — Depodaki top rengi ≠ iş emrinin hedef rengi, sapma defterinde İZ YOK =='
\echo '   (satır DÖNMESİ tek başına hata DEĞİLDİR — aşağıdaki gerekçeyi oku; kapı §26b)'
-- Plan-sapma kapısı (2026-08-19, `tambur-plan-gate.helper`) renk/en hedeften sapan
-- topu depoya ONAY ile indirir ve onayı `roll_plan_deviations` defterine imzalar.
-- Yani kapı YÜRÜRLÜKTEYKEN "depoda plan dışı renk + defterde iz yok" bir çelişkidir.
--
-- ⚠️ AMA KAPI GERİYE DÖNÜK DEĞİLDİR. 2026-08-21 saha yedeğinde bu sorgu 4 satır
-- döndürüyor (IE1008260014'ün EKRU topları, 17 Ağustos — kapı 19 Ağustos'ta geldi).
-- Bunlar gerçek tarihsel kayıtlardır; "drift" diye kırmızı yakmak bekçiyi ilk günden
-- kalıcı kırmızıya düşürür ve kırmızı bekçi görmezden gelinen bekçidir. Bu yüzden
-- bu bölüm GÖZLEM, kapı ise tarih eşikli §26b'dir.
--
-- KAPSAM: yalnız `producedInStep.station.kind = 'TAMBUR'`. Kapı üç yolda da (finalize
-- / cut / finalize-open-fabric) Tambur üzerinden koşar; Tambur'suz rotada son adım
-- finalize eder ve plan kapısı HİÇ çalışmaz — o topları buraya almak, hiç konmamış
-- bir kuralın ihlalini raporlamak olurdu.
-- `targetColorId IS NOT NULL`: renk hedefi olmayan WO kapı dışıdır (CLAUDE.md).
-- Defter sorgusu rollId VE childRollId'ye bakar: kesim yolunda kapıya PARENT girer,
-- depoya ÇOCUK iner (granülerlik geçiş×alan) — tek kolona bakmak çocuğu izsiz sanardı.
SELECT r.id AS roll_id,
       r.barcode,
       r.status::text AS durum,
       wo."workOrderNumber",
       rc.name AS top_rengi,
       wc.name AS plan_rengi,
       r."finalizedAt"
FROM rolls r
JOIN work_order_steps s ON s.id = r."producedInStepId"
JOIN stations st ON st.id = s."stationId" AND st.kind = 'TAMBUR'
JOIN work_orders wo ON wo.id = s."workOrderId"
LEFT JOIN colors rc ON rc.id = r."colorId"
LEFT JOIN colors wc ON wc.id = wo."targetColorId"
WHERE r.status IN ('WAREHOUSE', 'A1_STOCK')
  AND wo."targetColorId" IS NOT NULL
  AND r."colorId" IS DISTINCT FROM wo."targetColorId"
  AND NOT EXISTS (
        SELECT 1 FROM roll_plan_deviations d
        WHERE d."rollId" = r.id OR d."childRollId" = r.id)
ORDER BY r."finalizedAt";

\echo ''
\echo '== 26b) KAPI — aynısı ama YALNIZ plan-sapma kapısı yürürlüğe girdikten SONRA finalize edilenler =='
\echo '   (satır varsa: kapı atlanmış ya da defter yazılmamış) — eşik:' :plan_gate_since
-- Eşik neden GÜN BAŞI ve neden 20 Ağustos: kapı 19 Ağustos'un ORTASINDA geldi
-- (helper 16:12, `roll_plan_deviations` migration'ı 19:00). O günü kapsama almak,
-- kapı henüz yokken finalize edilmiş topları ihlal sayardı. Bir sonraki fabrika
-- gününün başı, "kapı kesin oradaydı" diyebildiğimiz ilk andır.
--
-- ⚠️ EŞİK REPO TARİHİDİR, SAHAYA ÇIKIŞ TARİHİ DEĞİL. 2026-08-21 yedeğinde
-- `roll_plan_deviations` BOŞTUR — yani kapı o gün canlıda henüz koşmamıştı. Kapı
-- sahaya daha geç çıktıysa eşiği ileri alın (`-v plan_gate_since=...`), yoksa
-- kapıdan önce finalize edilmiş meşru toplar ihlal görünür. Defter boşken bu bölüm
-- VAKUMEN yeşildir; mekanik ikizi bunu ayrıca uyarı satırı olarak basar.
SELECT r.id AS roll_id,
       r.barcode,
       wo."workOrderNumber",
       rc.name AS top_rengi,
       wc.name AS plan_rengi,
       r."finalizedAt"
FROM rolls r
JOIN work_order_steps s ON s.id = r."producedInStepId"
JOIN stations st ON st.id = s."stationId" AND st.kind = 'TAMBUR'
JOIN work_orders wo ON wo.id = s."workOrderId"
LEFT JOIN colors rc ON rc.id = r."colorId"
LEFT JOIN colors wc ON wc.id = wo."targetColorId"
WHERE r.status IN ('WAREHOUSE', 'A1_STOCK')
  AND wo."targetColorId" IS NOT NULL
  AND r."colorId" IS DISTINCT FROM wo."targetColorId"
  AND r."finalizedAt" IS NOT NULL
  AND r."finalizedAt" >= :'plan_gate_since'::timestamptz
  AND NOT EXISTS (
        SELECT 1 FROM roll_plan_deviations d
        WHERE d."rollId" = r.id OR d."childRollId" = r.id)
ORDER BY r."finalizedAt";

\echo ''
\echo '== Türetilmiş-alan kontrolü bitti. §21-§25 ve §26b boşsa sistem sağlıklı. =='
\echo '   (§26 satırları kapı öncesi tarihsel kayıt olabilir — finalizedAt sütununa bak.)'
