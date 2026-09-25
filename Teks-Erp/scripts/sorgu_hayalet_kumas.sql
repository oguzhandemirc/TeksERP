-- =============================================================================
-- HAYALET KUMAŞ TESPİTİ — eşzamanlı kesimin aşıma dönmesi (K-KES2, 2026-09-25)
-- =============================================================================
-- SALT OKUMA: yalnız SELECT. Fabrikada koşulup koşulmayacağına KULLANICI karar verir.
--   psql "<url>" -f scripts/sorgu_hayalet_kumas.sql
--
-- NE ARAR: 2.10.0'da aynı açık kumaşa (ya da depo topuna) aynı anda yapılan iki kesimden
-- ikincisi, birincinin commit'inden sonra azalmış kalanı "taze" okuyup AŞIM dalına
-- giriyordu (açık kumaşta iş emri kilidi yüzünden DETERMİNİSTİK). Sonuç: aşım defterine
-- (`roll_variances` OVERAGE · TAMBUR_OVERCUT) gerçek olmayan metraj yazıldı ve fazladan
-- çocuk metrajı envantere girdi.
--
-- İZ: aşım satırı onu doğuran kesimin çocuğuyla AYNI tx'te yazılır; `sourceRollId` eski
-- satırlarda boş olduğu için çocuk ZAMANLA bağlanır — aşımdan en fazla 2 sn önceki en yakın
-- çocuk (ölçüldü: 23 Eylül kopyasında 128 aşımın 128'i 0,004–0,280 sn). ŞÜPHE: o çocuktan
-- ÖNCEKİ 60 sn içinde aynı ebeveynden BAŞKA bir kesim var ("aynı dakika içinde birden çok
-- kesim"). `esz_2sn` = aradaki fark ≤ 2 sn (iki tabletin aynı anda gönderimi) — en güçlü iz.
-- ⚠️ ŞÜPHE KANIT DEĞİLDİR: gerçek aşım (mal fiziksel olarak fazla) da ardışık kesimle
-- aynı dakikaya düşebilir; satırlar insan gözüyle değerlendirilir.
--
-- İNDEKS: roll_variances(rollId) · rolls(parentRollId); aşım satırı sayısı küçük (yüzler).
-- =============================================================================

-- 1) Olay dökümü
WITH asim AS (
  SELECT v.id, v."rollId" AS ebeveyn_id, v.qty AS asim_m, v."createdAt" AS an
    FROM roll_variances v
   WHERE v.kind = 'OVERAGE' AND v.source = 'TAMBUR_OVERCUT' AND v."reversedAt" IS NULL
),
asim_kesim AS (
  SELECT a.*, c.id AS cocuk_id, c.barcode AS cocuk_barkod, c."initialQty" AS kesim_m, c."createdAt" AS cocuk_an
    FROM asim a
    CROSS JOIN LATERAL (
      SELECT k.id, k.barcode, k."initialQty", k."createdAt" FROM rolls k
       WHERE k."parentRollId" = a.ebeveyn_id AND k."createdAt" <= a.an AND k."createdAt" >= a.an - interval '2 seconds'
       ORDER BY k."createdAt" DESC LIMIT 1
    ) c
),
onceki AS (
  SELECT ak.*, o.id AS onceki_id, o.barcode AS onceki_barkod, o."initialQty" AS onceki_m,
         extract(epoch FROM ak.cocuk_an - o."createdAt") AS fark_sn
    FROM asim_kesim ak
    CROSS JOIN LATERAL (
      SELECT k.id, k.barcode, k."initialQty", k."createdAt" FROM rolls k
       WHERE k."parentRollId" = ak.ebeveyn_id AND k.id <> ak.cocuk_id
         AND k."createdAt" <= ak.cocuk_an AND k."createdAt" >= ak.cocuk_an - interval '60 seconds'
       ORDER BY k."createdAt" DESC LIMIT 1
    ) o
)
SELECT CASE WHEN p.barcode IS NULL THEN 'ACIK_KUMAS' ELSE 'DEPO' END AS yol,
       coalesce(p.barcode, '(açık kumaş)') AS ebeveyn, p.id AS ebeveyn_id,
       p."initialQty" AS giris_m,
       o.onceki_barkod, o.onceki_m, o.cocuk_barkod, o.kesim_m, o.asim_m,
       round(o.fark_sn::numeric, 3) AS fark_sn, (o.fark_sn <= 2) AS esz_2sn,
       o.cocuk_an AS an
  FROM onceki o
  JOIN rolls p ON p.id = o.ebeveyn_id
 ORDER BY o.cocuk_an;

-- 2) Özet: kaç olay, kaç metre fazla (aşım defterindeki pay) — 60 sn ve 2 sn eşiğiyle
WITH asim AS (
  SELECT v.id, v."rollId" AS ebeveyn_id, v.qty AS asim_m, v."createdAt" AS an
    FROM roll_variances v
   WHERE v.kind = 'OVERAGE' AND v.source = 'TAMBUR_OVERCUT' AND v."reversedAt" IS NULL
),
iz AS (
  SELECT a.asim_m,
         (SELECT extract(epoch FROM c."createdAt" - o."createdAt")
            FROM rolls c, LATERAL (
              SELECT k."createdAt" FROM rolls k
               WHERE k."parentRollId" = a.ebeveyn_id AND k.id <> c.id AND k."createdAt" <= c."createdAt"
               ORDER BY k."createdAt" DESC LIMIT 1) o
           WHERE c."parentRollId" = a.ebeveyn_id AND c."createdAt" <= a.an AND c."createdAt" >= a.an - interval '2 seconds'
           ORDER BY c."createdAt" DESC LIMIT 1) AS fark_sn
    FROM asim a
)
SELECT count(*)                                             AS asim_satiri,
       count(*) FILTER (WHERE fark_sn <= 60)                AS supheli_60sn,
       coalesce(sum(asim_m) FILTER (WHERE fark_sn <= 60), 0) AS supheli_60sn_metre,
       count(*) FILTER (WHERE fark_sn <= 2)                 AS supheli_2sn,
       coalesce(sum(asim_m) FILTER (WHERE fark_sn <= 2), 0)  AS supheli_2sn_metre,
       coalesce(sum(asim_m), 0)                             AS toplam_asim_metre
  FROM iz;
