// =============================================================================
// VERİ TUTARLILIK KAPISI — `scripts/consistency-check.sql`'in mekanik ikizi
//
// NEDEN VAR (2026-07-31 denetim bulgusu): o SQL dosyası **elle** ve "3 ayda bir"
// koşuluyordu (`psql <db> -f scripts/consistency-check.sql`), üstelik `psql` HER
// durumda `exit 0` veriyordu. Yani:
//   • Kimse koşmazsa drift kimsenin haberi olmadan aylarca birikiyordu.
//   • Koşulsa bile çıktı "sorunlu satırları" basıyor ama süreç BAŞARILI dönüyordu —
//     çıkışa bakan hiçbir otomasyon (CI, deploy adımı) farkı göremiyordu.
// Denormalize alanlar (`Order.shippedQty`, `OrderLine.shippedQty`) DB seddi
// olmayan tek defter kalemidir: drift olursa karşılanma/MRP **sessizce** yanlışlanır.
//
// Bu dosya aynı sorguları `$queryRaw` ile koşar ve her bölümü `check()`e bağlar →
// drift = KIRMIZI = `npm test` düşer.
//
// ⚠️ SORGULAR `consistency-check.sql`'DEN AYNEN ALINDI. Davranış kaymasın diye
// yeniden yazılmadılar; bir bölümün mantığı değişecekse ÖNCE o dosyada değişmeli,
// sonra buraya kopyalanmalı (iki yüzey tek gerçeği söylesin — psql ile elle koşan
// operatör ile CI aynı sonucu görmeli).
//
// EK BÖLÜM §20 (`WorkOrderStep.status` mutabakatı) SQL dosyasında YOKTU: adım
// durumu `recomputeStepStatus` ile movement'lardan TÜRETİLEN bir alandır ve hiçbir
// mutabakat sorgusu yoktu. Kuralları `src/services/helpers/roll-step.helper.ts`
// içindeki fonksiyondan birebir SQL'e çevrildi (aşağıda satır satır eşleşme notu).
//
// Salt-okunur: hiçbir yazma/fixture yok. Üretim DB'sine karşı da koşulabilir —
// nitekim asıl değeri orada (`DATABASE_URL=<canlı> npx tsx scripts/test_consistency.ts`).
// Koşum: npx tsx scripts/test_consistency.ts
// =============================================================================
import { Prisma } from "@prisma/client";
import { notFixtureSql, notFixtureItemOfRollSql } from "./lib/fikstur-imzasi";
import prisma from "../src/lib/prisma";
import { DISPOSITION_NOTE_PREFIXES } from "../src/services/helpers/roll-disposition.helper";
import { chequeCashEventTypesSql, chequeCashInflowSql } from "../src/services/helpers/cheque-cash-events.helper";

const CHEQUE_CASH_TYPES = chequeCashEventTypesSql();
const CHEQUE_CASH_INFLOW = chequeCashInflowSql("e");

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ORTAM GÜRÜLTÜSÜ FİLTRESİ — neden var ve nerede MEŞRU
//
// Bu test paylaşılan bir dev DB'sinde ve CI'da koşar; ikisinde de backend test
// paketinin kendi ürettiği veri birikir. `CLAUDE.md → Test Scriptleri` sözleşmesi
// gereği test verisi **`TEST-`/`TST-` ön ekli benzersiz iş anahtarlarıyla** doğar
// (demo seed'leri `DEMO-` kullanır). Temizlik `finally`de yapılır ama bazen YARIM
// kalır: örn. bir test `travelerCard`'ı siler, ardından `workOrder.delete` bir FK'ya
// takılır → kartsız iş emri kalıntısı. Ölçüldü (2026-08-01, dev DB): §15'in 219
// satırının 219'u, §16'nın 579 satırının 545'i, §20'nin 305 satırının 305'i test
// fixture'ıydı; ÜRETİM formatlı (IE…) tek bir satır bile drift göstermiyordu.
//
// Filtre bilinçli olarak DAR: üretim iş anahtarları asla bu ön ekleri taşımaz
// (iş emri `İE+GGAAYY+NNNN`, top barkodu `T+…`), yani canlı DB'de filtre hiçbir
// satırı elemez — kapı orada TAM güçtedir. Filtresiz bırakılsaydı test dev/CI'da
// sürekli kırmızı olur ve ilk haftasında devre dışı bırakılırdı; asıl kaybedilen
// şey kapının kendisi olurdu.
//
// KURAL: yeni bir bölüm eklerken filtreyi ÖNCE ekleme — önce filtresiz ölç. Filtre
// yalnız "bu satırları test paketi üretti" KANITLANDIĞINDA eklenir ve gerekçesi
// `why` alanına yazılır.
// ─────────────────────────────────────────────────────────────────────────────
interface Section {
  /** consistency-check.sql'deki bölüm numarası (izlenebilirlik için birebir) */
  id: string;
  title: string;
  /** consistency-check.sql'den AYNEN kopyalanan sorgu (psql \echo satırları hariç) */
  sql: string;
  /**
   * Dış filtre — verbatim sorgu bir ALT SORGU olarak sarılır, filtre DIŞARIDAN
   * uygulanır. Böylece orijinal sorgunun metni hiç değişmez (kopya kaymaz) ama
   * ortam gürültüsü elenir.
   */
  noise?: { where: string; why: string };
  /**
   * MİRAS BÖLÜMÜ — mutlak sayı KALICI ve BEKLENEN, yalnız ARTIŞ kırmızıdır.
   *
   * ⚠️ NEDEN BU ŞEKİL VAR (kullanıcı kararı 2026-09-13): *"geçmiş verileri
   * onarmak veya backfill yapmak mümkün değil; bundan sonraki kayıtlar sağlam
   * olsun yeter."* ⇒ Bu bölümün saydığı satırlar bir BORÇ değil bir MİRAStır ve
   * sıfıra inmeyecek. Yüklemi `n === 0` kurmak kalıcı kırmızı üretirdi — ve
   * kalıcı kırmızı bir kapının ölüm biçimidir (görünmez olur, sonra susturulur).
   *
   * ⇒ Yüklem: **"bu sayı tabandan büyük mü"**. Taban ELLE yazılır, tarihi ve
   * ölçüldüğü DB ile birlikte; büyürse yeni bir kapısız yol açılmış demektir.
   */
  miras?: { taban: number | null; tarih: string; nerede: string; not: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFTER UFKU — "bundan sonraki kayıtlar sağlam olsun"un mekanik karşılığı
//
// Kullanıcı kararı 2026-09-13: *"mevcut topların geçmiş verilerini onarmak veya
// backfill yapmak mümkün değil, bununla uğraşma; bundan sonraki kayıtlar sağlam
// olsun yeter."* ⇒ Geçmiş bir BORÇ değil bir MİRAStır ve sıfıra inmeyecek.
//
// ⚠️ NEDEN SAYI TABANI DEĞİL TARİH UFKU (ölçüldü 2026-09-13): miras kümesi
// fabrikanın canlı kopyasında **4.160 top** (SHIPPED 1.855 · SUBCONTRACTOR_CONSUMED
// 1.519 · CANCELLED 366 · TAMBUR_CONSUMED 227 · AT_SUBCONTRACTOR 187 · SCRAP 6).
// Bu sayı VERİYE bağlıdır: aynı bölüm fixture DB'sinde bambaşka bir sayı verir ⇒
// sabit bir sayı tabanı her DB'de yanlış olur (lint tavanı KODU ölçtüğü için
// taşınabilir, bu ölçü veriyi ölçüyor). Tarih ufku DB'den BAĞIMSIZDIR: "ufuktan
// sonra doğan top" her kurulumda aynı anlama gelir ve beklenen değer **0**'dır.
//
// ⚠️ UFUK AÇILDI — 2026-09-13: SEVK AİLESİ deftere bağlandı (sevk ×2 · fason kabul ·
// fason sevki · transfer ×2 · kartela ×2) ve bölüm artık SERT. ⚠️ "K = 0" iddiası aynı
// gece ÇÜRÜDÜ (1c): üretim tarafında beş kapısız yol daha var (elle taşıma · elle top ·
// redye · rescue · cutOpenFabric çocuğu) — K = 5, `test_stok_defteri_bag_olcumu §4e`
// bilerek kırmızı; ve STOK_DISI_STATULER'de IN_PRODUCTION olmadığı için buradaki
// asimetri ölçüsü o yolları GÖRMEZ (1c'nin kalemi, hüküm dosyası §11).
// ufuktan SONRA doğan bir topun stok kümesine girişi yazılmış ama çıkışı
// yazılmamışsa bu bir KUSURDUR, beklenen değer 0. Ufuktan ÖNCESİ mirastır ve
// kullanıcı kararıyla onarılmayacak ⇒ yüklem `createdAt >= UFUK` ile sınırlanır.
// Ölçü: `scripts/lib/stok-defteri-bag-olcumu.ts` (K, kapısı
// `test_stok_defteri_bag_olcumu §4e`).
// ─────────────────────────────────────────────────────────────────────────────
const DEFTER_UFKU: string | null = "2026-09-13";

/** Stok kümesi DIŞI statüler — buraya düşen topun defterde ÇIKIŞ ucu olmalıydı. */
/** Stok kümesi İÇİ statüler — giriş/çıkış uçlarının anlamlı olduğu küme. */
const STOK_ICI_STATULER = `'STOCK','WAREHOUSE','A1_STOCK','RETURNED_FROM_SUBCONTRACTOR'`;

const STOK_DISI_STATULER = `'SHIPPED','AT_SUBCONTRACTOR','AT_KARTELA','SCRAP','CANCELLED',
                   'SUBCONTRACTOR_CONSUMED','TAMBUR_CONSUMED','KARTELA_CONSUMED'`;

const SECTIONS: Section[] = [
  {
    id: "1",
    title: "OrderLine.shippedQty vs Σ(SackAllocation[DISPATCHED] + DirectShipAllocation)",
    sql: `
SELECT ol.id AS order_line_id,
       ol."shippedQty" AS kayitli,
       COALESCE(sa.toplam, 0) + COALESCE(dsa.toplam, 0) AS hesaplanan,
       ol."shippedQty" - (COALESCE(sa.toplam, 0) + COALESCE(dsa.toplam, 0)) AS fark
FROM order_lines ol
LEFT JOIN (
  SELECT sal."orderLineId", SUM(sal.qty) AS toplam
  FROM sack_allocations sal
  JOIN sacks sk ON sk.id = sal."sackId"
  JOIN shipments sh ON sh.id = sk."shipmentId"
  WHERE sh.status = 'DISPATCHED'
  GROUP BY sal."orderLineId"
) sa ON sa."orderLineId" = ol.id
LEFT JOIN (SELECT "orderLineId", SUM(qty) AS toplam FROM subcontractor_direct_ship_allocations GROUP BY "orderLineId") dsa
       ON dsa."orderLineId" = ol.id
-- MT-dışı (kg/adet) satır metre defterinin DIŞINDADIR: shippedQty yazılmaz, mutabakata girmez.
WHERE ol."unit" = 'MT'
  AND ol."shippedQty" <> COALESCE(sa.toplam, 0) + COALESCE(dsa.toplam, 0)`,
  },
  {
    id: "1c",
    title: "Defterin KENDİSİ eksik: sipariş beyan eden sevkiyatın tahsis satırı yok",
    // BULGU-T2-004 — §1/§2'nin KÖR NOKTASI. O ikisi denormalize alanı DEFTERE
    // karşı ölçer; defter hiç yazılmamışsa iki taraf da 0 olur, fark 0 çıkar ve
    // kapı YEŞİL yanar. Ölçüldü (saha kopyası, 2026-08-31): §1/§2 sıfır satır
    // döndürürken 5 sevkiyatın 3.040,2 metresi sipariş defterine HİÇ girmemişti.
    //
    // ⚠️ KOŞUL `shipment_orders` ÜZERİNDEDİR ("tahsisi yok" DEĞİL). Siparişsiz
    // sevk meşruen tahsissizdir; denetimin naif sorgusu (V2-Q08) onları da
    // sayıyordu — aynı kopyada naif 6, gerçek 5. Naif hâli kalıcı yanlış kırmızı
    // üretir ve kapı ilk haftasında devre dışı bırakılırdı.
    //
    // ONARIM ham UPDATE ile YAPILMAZ: `shippingService.setShipmentOrders` defteri
    // yeniden kurar, sipariş toplamlarını yeniden hesaplar ve irsaliyeyi yeniden
    // üretir.
    //
    // ⚠️ DEV'DEKİ YEŞİL "SORUN YOK" DEMEK DEĞİL — bölüm burada veri hacmi
    // yüzünden neredeyse boşlukta koşuyor (ölçüldü 2026-08-31: dev 1
    // `shipment_orders` / 2 DISPATCHED · saha kopyası 55 / 39). Bu dosyanın asıl
    // değeri CANLI DB'ye karşı koşulmasıdır (CLAUDE.md); §1c özellikle öyledir.
    //
    // Negatif sonda (2026-08-31, rollback'li tx ile — veri bozulmadan): defteri
    // yazılmış bir sevkiyatın tahsis satırları silinince 0 → 1 satır, ROLLBACK
    // sonrası tekrar 0.
    sql: `
SELECT sh."shipmentNo",
       sh."dispatchedAt"::date AS sevk_tarihi,
       (SELECT count(*) FROM shipment_orders so WHERE so."shipmentId" = sh.id) AS beyan_edilen_siparis,
       (SELECT COALESCE(SUM(r."currentQty"), 0) FROM sacks sk JOIN rolls r ON r."sackId" = sk.id
         WHERE sk."shipmentId" = sh.id) AS deftere_girmeyen_metraj
FROM shipments sh
WHERE sh.status = 'DISPATCHED'
  AND EXISTS (SELECT 1 FROM shipment_orders so WHERE so."shipmentId" = sh.id)
  AND NOT EXISTS (
    SELECT 1 FROM sacks sk JOIN sack_allocations sa ON sa."sackId" = sk.id
     WHERE sk."shipmentId" = sh.id
  )`,
  },
  {
    id: "1d",
    title: "Deftere girmeyen metraj: çıkan mal > siparişe yazılan",
    // BULGU-T2-001 — §1c'nin bir adım ötesi. §1c "hiç tahsis yok" hâlini
    // yakalar; bu bölüm KISMİ yazılanı da yakalar. Kök sebep tipik olarak
    // `specMatch`: kaleme 55-BEYAZ istenmiş, çuvala aynı kumaşın EKRU'su
    // okutulmuş → tahsis yazılmıyor, sipariş "Açık" kalıyor ve planlamacı aynı
    // metrajı YENİDEN üretime veriyor.
    //
    // ÖLÇÜM (saha kopyası, 2026-08-31): 23 sevkiyat / 7.200,6 m; dev'de 0.
    //
    // ⚠️ Bu satırlar "veri bozuk" DEMEK DEĞİL: mal çıktı, irsaliye basıldı,
    // muhasebe brüt raporu onu görüyor. Görünmeyen tek şey SİPARİŞ DEFTERİ.
    // Onarım İŞ KARARIDIR (hangi kaleme yazılacağı) — kapı görünür tutar.
    // ⚠️ Siparişsiz sevk kapsam DIŞI (§1c ile aynı gerekçe).
    sql: `SELECT sh."shipmentNo",
       sh."dispatchedAt"::date AS sevk_tarihi,
       round(x.icerik::numeric, 1)                     AS cikan_metraj,
       round(x.tahsis::numeric, 1)                     AS siparise_yazilan,
       round((x.icerik - x.tahsis)::numeric, 1)        AS deftere_girmeyen
FROM shipments sh
JOIN LATERAL (
  SELECT
    COALESCE((SELECT sum(r."currentQty") FROM rolls r JOIN sacks s2 ON s2.id = r."sackId"
               WHERE s2."shipmentId" = sh.id), 0) AS icerik,
    COALESCE((SELECT sum(sa.qty) FROM sack_allocations sa JOIN sacks s3 ON s3.id = sa."sackId"
               WHERE s3."shipmentId" = sh.id), 0) AS tahsis
) x ON TRUE
WHERE sh.status = 'DISPATCHED'
  AND EXISTS (SELECT 1 FROM shipment_orders so WHERE so."shipmentId" = sh.id)
  AND x.icerik - x.tahsis > 0.001
ORDER BY (x.icerik - x.tahsis) DESC`,
  },
  {
    id: "2",
    title: "Order.shippedQty vs Σ(OrderLine.shippedQty)",
    sql: `
SELECT o.id AS order_id,
       o."shippedQty" AS shipped_kayitli, COALESCE(SUM(ol."shippedQty"), 0) AS shipped_hesap
FROM orders o
LEFT JOIN order_lines ol ON ol."orderId" = o.id AND ol."unit" = 'MT'  -- header Σ yalnız metre satırı
GROUP BY o.id, o."shippedQty"
HAVING o."shippedQty" <> COALESCE(SUM(ol."shippedQty"), 0)`,
  },
  {
    id: "3",
    title: "Negatif miktar/metraj/kg (CHECK backstop)",
    sql: `
SELECT 'rolls' AS tablo, id::text AS kayit FROM rolls
  WHERE "currentQty" < 0 OR "initialQty" < 0 OR ("weightKg" IS NOT NULL AND "weightKg" < 0)
UNION ALL
SELECT 'order_lines', id::text FROM order_lines WHERE "quantity" <= 0 OR "shippedQty" < 0
UNION ALL
SELECT 'sack_allocations', id::text FROM sack_allocations WHERE qty <= 0`,
  },
  {
    id: "4",
    title: "Roll ↔ Sack ↔ Shipment tutarlılık (O-22 FK backstop)",
    sql: `
SELECT r.id AS roll_id, r."sackId", r."shipmentId" AS roll_shipment, s."shipmentId" AS sack_shipment
FROM rolls r
JOIN sacks s ON r."sackId" = s.id
WHERE r."shipmentId" IS DISTINCT FROM s."shipmentId"`,
  },
  {
    id: "5",
    title: "shipment_orders.isActive vs shipment.status (denorm drift)",
    sql: `
SELECT so."shipmentId", so."orderId", so."isActive" AS bayrak, s.status AS gercek_durum
FROM shipment_orders so
JOIN shipments s ON s.id = so."shipmentId"
WHERE so."isActive" <> (s.status = 'PLANNED')`,
  },
  {
    id: "6",
    title: "Çuval seq ↔ shipmentId tutarlılığı (depoda seq YOK, sevkiyatta seq VAR)",
    sql: `
SELECT sk.id AS sack_id, sk."shipmentId", sk.seq
FROM sacks sk
WHERE (sk."shipmentId" IS NULL AND sk.seq IS NOT NULL)
   OR (sk."shipmentId" IS NOT NULL AND sk.seq IS NULL)`,
  },
  {
    id: "7",
    title: "Çuvalda KAYITLI ama binada OLMAYAN top (hayalet içerik)",
    sql: `
SELECT r.id AS roll_id, r.barcode, r.status, r."currentQty",
       s."sackNo", s."weightKg" AS cuval_kg,
       sh."shipmentNo", sh.status AS sevkiyat_durumu,
       r."updatedAt"
FROM rolls r
JOIN sacks s ON s.id = r."sackId"
LEFT JOIN shipments sh ON sh.id = s."shipmentId"
WHERE r.status IN ('CANCELLED','SCRAP','IN_PRODUCTION','AT_SUBCONTRACTOR',
                   'SUBCONTRACTOR_CONSUMED','AT_KARTELA','KARTELA_CONSUMED','TAMBUR_CONSUMED')
ORDER BY s."sackNo", r.barcode`,
  },
  {
    id: "7b",
    title: "SEVK EDİLMİŞ ama kartelaya/fasona DA gönderilmiş top (geçmiş çift-sayım)",
    sql: `
SELECT r.id AS roll_id, r.barcode, r."currentQty",
       s."sackNo", sh."shipmentNo", sh."dispatchedAt",
       kd."dispatchNo" AS kartela_sevk, NULL AS fason_sevk
FROM rolls r
JOIN sacks s ON s.id = r."sackId"
JOIN shipments sh ON sh.id = s."shipmentId" AND sh.status = 'DISPATCHED'
JOIN kartela_dispatch_items kdi ON kdi."rollId" = r.id
JOIN kartela_dispatches kd ON kd.id = kdi."dispatchId" AND kd."cancelledAt" IS NULL
WHERE r.status = 'SHIPPED'
UNION ALL
SELECT r.id, r.barcode, r."currentQty",
       s."sackNo", sh."shipmentNo", sh."dispatchedAt",
       NULL, sd."dispatchNo"
FROM rolls r
JOIN sacks s ON s.id = r."sackId"
JOIN shipments sh ON sh.id = s."shipmentId" AND sh.status = 'DISPATCHED'
JOIN subcontractor_dispatch_items sdi ON sdi."rollId" = r.id
JOIN subcontractor_dispatches sd ON sd.id = sdi."dispatchId" AND sd."cancelledAt" IS NULL
WHERE r.status = 'SHIPPED'`,
  },
  {
    id: "7c",
    title: "İPTAL EDİLMİŞ kartela hâlâ çuvalda (simetri kontrolü)",
    sql: `
SELECT w.id AS swatch_id, w.barcode, s."sackNo", w."cancelledAt"
FROM swatches w
JOIN sacks s ON s.id = w."sackId"
WHERE w."cancelledAt" IS NOT NULL`,
  },
  {
    id: "8",
    title: "Barkodsuz satılabilir top (WAREHOUSE/A1_STOCK ama barcode NULL)",
    sql: `
SELECT id, status, "currentQty", "updatedAt"
FROM rolls
WHERE status IN ('WAREHOUSE','A1_STOCK') AND barcode IS NULL`,
  },
  {
    id: "9",
    title: "SHIPPED top ama çuvalı yok / çuvalın sevkiyatı DISPATCHED değil",
    sql: `
SELECT r.id, r.barcode, r.status, r."sackId", s."shipmentId", sh.status AS sevk_durumu
FROM rolls r
LEFT JOIN sacks s ON s.id = r."sackId"
LEFT JOIN shipments sh ON sh.id = s."shipmentId"
WHERE r.status = 'SHIPPED'
  AND (r."sackId" IS NULL OR sh.status IS DISTINCT FROM 'DISPATCHED')`,
  },
  {
    id: "10",
    title: "IN_PRODUCTION top ama currentStepId NULL veya WO CANCELLED/SUPERSEDED",
    sql: `
SELECT r.id, r.barcode, r.status, r."currentStepId", wos."workOrderId", wo.status AS wo_durumu
FROM rolls r
LEFT JOIN work_order_steps wos ON wos.id = r."currentStepId"
LEFT JOIN work_orders wo ON wo.id = wos."workOrderId"
WHERE r.status = 'IN_PRODUCTION'
  AND (r."currentStepId" IS NULL OR wo.id IS NULL OR wo.status IN ('CANCELLED','SUPERSEDED'))`,
    // ⚠️ BARKODU NULL OLAN SATIR bu süzgeçten GEÇİYORDU ve geçmesi TASARIM GEREĞİ:
    // `notFixtureSql` NULL'ı "üretim" sayar (elenmez) — doğru varsayılan, çünkü
    // barkodsuz ÜRETİM topu gerçek bir kusur şeklidir. Ama fason dönüşünde doğan
    // fikstür topu da barkodsuzdur, yani ön ek ARAMAK İÇİN BİR YER BULAMAZ.
    // Ölçüldü 2026-09-13: 21 satırın 21'inin barkodu NULL, `entrySource`u
    // `SUBCONTRACTOR_RETURN` ve kalemi bir FİKSTÜR kalemi (`TEST-SSTR-…-KM`);
    // aynı sorgu fabrikanın canlı kopyasında **0** satır döndürüyor ⇒ üretim
    // maruziyeti yok. Bu yüzden kalem kodu terimi eklendi: barkodu olmayan satırın
    // imzası yalnız kaleminde kalır.
    noise: {
      where: `WHERE ${notFixtureSql(`drift.barcode`)} AND ${notFixtureItemOfRollSql("drift.id")}`,
      why: "manuel-taşıma testleri (TEST-MM-…) adımsız top bırakır; fason dönüşü fikstürü BARKODSUZ doğar ve yalnız kalem kodundan elenir (üretim barkodu 'T…' formatındadır)",
    },
  },
  {
    id: "11",
    title: "Açık movement + top artık orada değil / ölü statüde (hayalet movement)",
    // Geri alınmış hareket "hiç olmamış" sayılır (`ACTIVE_MOVEMENT`ın SQL aynası);
    // §11/§12/§20'deki her `roll_movements` referansı `"revokedAt" IS NULL` taşır.
    sql: `
SELECT rm.id AS movement_id, rm."rollId", r.barcode, r.status AS top_durumu,
       rm."workOrderStepId", r."currentStepId", rm."enteredAt"
FROM roll_movements rm
JOIN rolls r ON r.id = rm."rollId"
WHERE rm."exitedAt" IS NULL
  AND rm."revokedAt" IS NULL
  AND (r.status IN ('SUBCONTRACTOR_CONSUMED','TAMBUR_CONSUMED','KARTELA_CONSUMED','CANCELLED')
       OR r."currentStepId" IS DISTINCT FROM rm."workOrderStepId")`,
  },
  {
    id: "12",
    title: "Kapanmış movement'ta qtyOut <> qtyIn",
    sql: `
SELECT rm.id, rm."rollId", rm."workOrderStepId", rm."qtyIn", rm."qtyOut", rm."exitedAt"
FROM roll_movements rm
WHERE rm."exitedAt" IS NOT NULL
  AND rm."revokedAt" IS NULL
  AND rm."qtyOut" IS DISTINCT FROM rm."qtyIn"`,
    noise: {
      // Bu kapanışlar İSTASYON BİTİRMESİ DEĞİLDİR, dolayısıyla "qtyOut = qtyIn"
      // kuralının (commit 64263fc) konusu da değildir:
      //   <ORIGIN>_*      → dispozisyon motoru (WO_CLOSE / WO_CANCEL / BATCH_DROP).
      //                     CANCELLED aksiyonunda qtyOut BİLİNÇLİ 0'dır (storno).
      //                     ⚠️ Desenler `DISPOSITION_NOTE_PREFIXES`'ten TÜRETİLİR —
      //                     elle yazılsaydı dördüncü bir origin eklendiğinde muaf
      //                     sessizce eksik kalır ve bu bekçi, özellikle hiç ilgisi
      //                     yokmuş gibi görünen bir hatayla canlı veride kırmızıya
      //                     dönerdi (roll-disposition.helper.ts başlığına bak).
      //   WO_CANCELLED    → iş emri iptalinin toplu hareket süpürmesi; kalan metraj
      //                     yazılır, giren değil (workorder.service.ts süpürme SQL'i)
      //   DETACHED_FROM_WO→ topu iş emrinden ayırma; aynı gerekçe (detachRolls)
      //   MANUAL_MOVE_OUT → manuel taşımada hayalet movement kapatılır, ölçüm yok
      //                     (workorder-manual-move.service.ts:628)
      //   REDYE_REWIND    → redye/parti geri sarmada movement iptal edilir
      //                     (workorder-split.service.ts:356,473)
      //   CANCELLED[ (…)] → TEKİL top iptali (`inventory.softDelete`) — storno,
      //                     qtyOut BİLİNÇLİ 0. Parantez içi eski nottur
      //                     (2026-08-04: not artık EZİLMİYOR, korunuyor).
      //   ARCHIVED[ (…)]  → tekil top arşivleme (`inventory.hardDelete`); aynı
      //                     storno semantiği, aynı not koruması (2026-08-15).
      //                     ⚠️ Bu iki desen 2026-08-15'e kadar muaf listesinde
      //                     YOKTU ve canlıda karşılığı olmadığı için §12 sessizce
      //                     yeşildi; ilk gerçek kullanımda bekçi, konusuyla hiç
      //                     ilgisi yokmuş gibi görünen bir satırla kırmızıya
      //                     dönecekti.
      //   CANCEL:<sevkNo> → fason SEVK İPTALİ; top hiç çıkmadan STOCK'a geri döner
      //                     (subcontractor.service.ts:1953). qtyOut yazmak, hiç
      //                     yapılmamış bir işin çıktısını UYDURMAK olurdu — kasıtlı
      //                     olarak boş bırakılır. (2026-08-03 eklendi; marker'ın tek
      //                     yazarı orasıdır ve mevcut nota " | " ile EKLENİR, bu
      //                     yüzden eşitlik değil iki LIKE deseni gerekir.)
      // Hepsinde qtyOut bilinçli olarak yazılmaz/farklıdır. Kapı bunlar dışındaki
      // her kapanışa uygulanır — asıl korunan şey normal istasyon FINISH'idir.
      where: `WHERE NOT EXISTS (
                SELECT 1 FROM roll_movements rm_n
                WHERE rm_n.id = drift.id
                  AND rm_n."revokedAt" IS NULL
                  AND (${DISPOSITION_NOTE_PREFIXES.map(
                    (p) => `rm_n.notes LIKE '${p}\\_%'`,
                  ).join("\n                       OR ")}
                       OR rm_n.notes IN ('MANUAL_MOVE_OUT','REDYE_REWIND','WO_CANCELLED','DETACHED_FROM_WO')
                       OR rm_n.notes LIKE '%| WO_CANCELLED'
                       OR rm_n.notes LIKE 'CANCEL:%'
                       OR rm_n.notes LIKE '%| CANCEL:%'
                       OR rm_n.notes = 'CANCELLED'
                       OR rm_n.notes LIKE 'CANCELLED (%'
                       OR rm_n.notes = 'ARCHIVED'
                       OR rm_n.notes LIKE 'ARCHIVED (%'))`,
      why: "dispozisyon motoru / iş emri iptali / manuel taşıma / redye geri sarma / fason sevk iptali / tekil top iptali+arşivleme istasyon bitirmesi değildir",
    },
  },
  {
    id: "13",
    // KÖK NEDEN BULUNDU (2026-08-22) ve KOD TARAFI KAPANDI — bkz.
    // `tambur-undo.service.applySingle` canlı dalı + `test_tambur_undo §11`.
    // Aşımlı kesimden sonra parçalar TEK TEK geri alınırken canlı dalda aşım
    // koruması yoktu (arşiv ikizinde ve FULL'de vardı): 100 m'lik topa 40+40+40
    // kesilir, üçüncü geri almada `currentQty(120) > initialQty(100)` oluşur ve
    // deftere satır DÜŞMEZDİ. Artık `initialQty` yukarı çekilir + OVERAGE yazılır.
    //
    // ⚠️ CANLIDAKİ 2 SATIR BİLEREK DÜZELTİLMEDİ (2026-08-08 / 08-11 tarihli, sapma
    // defteri gelmeden önce doğdular). Toplu UPDATE ile "düzeltmek" bu bölümün
    // kendi uyarısının ihlali olurdu; kapı onları görünür tutar. İş kararı verilip
    // düzeltilirse bölüm kendiliğinden yeşile döner — bölümü DARALTMA.
    title: "currentQty > initialQty (top yalnız kesimle azalır, artamaz)",
    sql: `
SELECT id, barcode, "initialQty", "currentQty", status
FROM rolls
WHERE "currentQty" > "initialQty"`,
  },
  {
    id: "14",
    title: "Yarım fason kabul (top tüketildi ama receipt'ten çocuk doğmamış)",
    sql: `
SELECT r.id AS tuketilen_top_id, r.barcode, r."updatedAt",
       sr.id AS receipt_id, sr."receiptNo"
FROM rolls r
JOIN subcontractor_receipt_items sri ON sri."newRollId" = r.id
JOIN subcontractor_receipts sr ON sr.id = sri."receiptId" AND sr."cancelledAt" IS NULL
WHERE r.status = 'SUBCONTRACTOR_CONSUMED'
  AND NOT EXISTS (SELECT 1 FROM rolls child WHERE child."parentReceiptId" = sr.id)`,
  },
  {
    id: "15",
    title: "AT_SUBCONTRACTOR top ama açık fason sevk kaydı yok",
    sql: `
SELECT r.id, r.barcode, r."updatedAt"
FROM rolls r
WHERE r.status = 'AT_SUBCONTRACTOR'
  AND NOT EXISTS (
    SELECT 1 FROM subcontractor_dispatch_items sdi
    JOIN subcontractor_dispatches sd ON sd.id = sdi."dispatchId"
    WHERE sdi."rollId" = r.id AND sd."cancelledAt" IS NULL
  )`,
    noise: {
      where: `WHERE ${notFixtureSql(`drift.barcode`)}`,
      why: "SQL dosyasının kendi notu: seed'li/test'li ortamda statü dispatch'siz yazılır — üretimde her satır gerçek anomalidir",
    },
  },
  {
    id: "16",
    title: "Kartsız iş emri (kart WO açılışında doğar — 2026-07-14 sonrası)",
    sql: `
SELECT wo.id, wo."workOrderNumber", wo.status, wo."createdAt"
FROM work_orders wo
LEFT JOIN traveler_cards tc ON tc."workOrderId" = wo.id
WHERE tc.id IS NULL
  AND wo."createdAt" >= '2026-07-14'`,
    noise: {
      // İki ayrı kalıntı sınıfı elenir:
      //  (a) TST-/TEST-/DEMO- numaralı fixture iş emirleri.
      //  (b) ADIMSIZ iş emirleri: `workorder.service.create` rota adımlarını kartla
      //      AYNI tx'te yazar → adımsız bir WO hiç doğmaz. Adımsız + kartsız kayıt,
      //      temizliği yarım kalmış bir testin izidir (adımlar + kart silinmiş, WO
      //      bir FK'ya takıldığı için kalmış). Gerçek bir "kart atlama" regresyonu
      //      adımları OLAN bir WO üretir, yani kapı zayıflamaz.
      where: `WHERE ${notFixtureSql(`drift."workOrderNumber"`)}
                AND EXISTS (SELECT 1 FROM work_order_steps s WHERE s."workOrderId" = drift.id)`,
      why: "fixture WO'ları + adımı silinmiş (yarım temizlenmiş) test kalıntıları",
    },
  },
  {
    id: "17",
    title: "Açık (isProcessed=false) RollError ama top ölü/emekli statüde",
    sql: `
SELECT re.id AS hata_id, re."rollId", r.barcode, r.status, re."detectedAt"
FROM roll_errors re
JOIN rolls r ON r.id = re."rollId"
WHERE re."isProcessed" = false
  AND r.status IN ('SUBCONTRACTOR_CONSUMED','TAMBUR_CONSUMED','KARTELA_CONSUMED','CANCELLED','SCRAP')`,
  },
  {
    id: "18",
    // 2026-08-21: customers/items/subcontractors'ta DB partial UNIQUE VAR
    // (`<tablo>_nameFold_key`, WHERE "mergedIntoId" IS NULL) — orada bu bölüm
    // kısıttan GEVŞEK bir aynadır (lower(trim) ≠ tr_fold, tombstone'u süzmez);
    // colors/routes için hâlâ tek gözlem. Mantık SQL dosyasıyla aynı tutulur.
    title: "Master-data ad mükerrer (aktif, case/boşluk-duyarsız)",
    sql: `
SELECT 'items' AS tablo, lower(trim(name)) AS ad, COUNT(*) AS adet, array_agg(id) AS kayitlar
FROM items WHERE "isActive" = true GROUP BY 2 HAVING COUNT(*) > 1
UNION ALL
SELECT 'colors', lower(trim(name)), COUNT(*), array_agg(id)
FROM colors WHERE "isActive" = true GROUP BY 2 HAVING COUNT(*) > 1
UNION ALL
SELECT 'customers', lower(trim(name)), COUNT(*), array_agg(id)
FROM customers WHERE "mergedIntoId" IS NULL GROUP BY 2 HAVING COUNT(*) > 1
UNION ALL
SELECT 'subcontractors', lower(trim(name)), COUNT(*), array_agg(id)
FROM subcontractors WHERE "isActive" = true GROUP BY 2 HAVING COUNT(*) > 1
UNION ALL
SELECT 'routes', lower(trim(name)), COUNT(*), array_agg(id)
FROM routes GROUP BY 2 HAVING COUNT(*) > 1`,
  },
  {
    id: "19",
    title: "Fason sevk / doğrudan-sevk snapshot toplamı vs kalem toplamı",
    sql: `
SELECT 'subcontractor_dispatches' AS tablo, sd.id::text AS kayit, sd."totalQty" AS kayitli,
       COALESCE(SUM(sdi."dispatchedQty"), 0) AS hesaplanan
FROM subcontractor_dispatches sd
LEFT JOIN subcontractor_dispatch_items sdi ON sdi."dispatchId" = sd.id
GROUP BY sd.id, sd."totalQty"
HAVING sd."totalQty" <> COALESCE(SUM(sdi."dispatchedQty"), 0)
UNION ALL
SELECT 'direct_shipments', ds.id::text, ds."totalQty", COALESCE(SUM(dsa.qty), 0)
FROM direct_shipments ds
LEFT JOIN subcontractor_direct_ship_allocations dsa ON dsa."directShipmentId" = ds.id
GROUP BY ds.id, ds."totalQty"
HAVING ds."totalQty" <> COALESCE(SUM(dsa.qty), 0)`,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // §20 — YENİ. `consistency-check.sql`'de KARŞILIĞI YOK.
  //
  // `WorkOrderStep.status` TÜRETİLMİŞ bir alandır: tek yazıcısı
  // `roll-step.helper.ts → recomputeStepStatus`, girdisi o adımın movement'ları.
  // Denormalize + sedsiz + mutabakatsız üçlüsü tam olarak `shippedQty`'nin
  // durumuydu (D-9) — orada bir sorgu vardı, burada hiç yoktu. Adım durumu
  // bozulursa istasyon kuyruğu, "açık kart" listesi ve WO tamamlama koşulu
  // sessizce yanlışlanır: operatör kartı okutur ama iş görünmez.
  //
  // recomputeStepStatus → SQL eşlemesi (helper'daki sırayla):
  //   satır 45  : `status = SKIPPED` ise DOKUNULMAZ            → WHERE status <> 'SKIPPED'
  //   satır 54  : openCount   = açık movement, top CANCELLED değil
  //   satır 61  : closedCount = kapalı movement, top CANCELLED değil
  //   satır 73  : pendingRolls= bu WO'nun herhangi bir adımında movement'ı OLAN,
  //               bu adımda movement'ı OLMAYAN ve hâlâ üretimde
  //               (IN_PRODUCTION | AT_SUBCONTRACTOR | RETURNED_FROM_SUBCONTRACTOR) toplar
  //   satır 92-103: karar ağacı
  //        open > 0                        → ACTIVE
  //        closed = 0                      → PENDING   (pending>0 olsa da: satır 102'nin
  //                                          `closedCount > 0 ? ACTIVE : PENDING` dalı)
  //        closed > 0 ve pending = 0       → COMPLETED
  //        closed > 0 ve pending > 0       → ACTIVE
  //   NOT: `roll: { status: { not: CANCELLED } }` zorunlu relation üzerinde
  //        INNER JOIN + `<>` üretir; SQL karşılığı birebir odur.
  //   NOT: helper'daki her sorgu `ACTIVE_MOVEMENT` süzer (açık/kapalı sayım, bekleyen
  //        adayı, giriş noktası) → buradaki her `roll_movements` referansı da
  //        `"revokedAt" IS NULL` taşır; biri eksik kalırsa geri alma sahte drift üretir.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "20",
    title: "WorkOrderStep.status vs movement'lardan türetilen değer (recomputeStepStatus)",
    sql: `
WITH adim AS (
  SELECT s.id, s.status::text AS kayitli, s."workOrderId", wo."workOrderNumber",
    (SELECT COUNT(*) FROM roll_movements rm JOIN rolls r ON r.id = rm."rollId"
      WHERE rm."workOrderStepId" = s.id AND rm."exitedAt" IS NULL AND rm."revokedAt" IS NULL AND r.status <> 'CANCELLED') AS acik,
    (SELECT COUNT(*) FROM roll_movements rm JOIN rolls r ON r.id = rm."rollId"
      WHERE rm."workOrderStepId" = s.id AND rm."exitedAt" IS NOT NULL AND rm."revokedAt" IS NULL AND r.status <> 'CANCELLED') AS kapali,
    (SELECT COUNT(*) FROM rolls r
      WHERE r.status IN ('IN_PRODUCTION','AT_SUBCONTRACTOR','RETURNED_FROM_SUBCONTRACTOR')
        AND EXISTS (SELECT 1 FROM roll_movements rm2
                    JOIN work_order_steps s2 ON s2.id = rm2."workOrderStepId"
                    WHERE rm2."rollId" = r.id AND rm2."revokedAt" IS NULL AND s2."workOrderId" = s."workOrderId")
        AND NOT EXISTS (SELECT 1 FROM roll_movements rm3
                        WHERE rm3."rollId" = r.id AND rm3."revokedAt" IS NULL AND rm3."workOrderStepId" = s.id)
        -- FASON DÖNÜŞÜ ÇOCUĞU: bu adımın makbuzundan doğan top o adımın ÇIKTISIDIR,
        -- adıma hiç girmez, dolayısıyla "bekleyen" DEĞİLDİR. Ürün kodundaki aynı
        -- istisnanın aynası: roll-step.helper.ts icindeki pendingRolls sorgusu
        -- NOT parentReceipt.stepId ile ayni dislamayi yapar. İkisi AYRI kalırsa
        -- bekçi ya yanlış alarm verir ya gerçek drift'i kaçırır.
        -- GİRİŞ NOKTASI KURALI: topun bu iş emrindeki EN ERKEN hareketi hangi
        -- adımdaysa, ondan ÖNCEKİ adımlar için o top hiç beklemedi (fason dönüşü
        -- çocuğu, elle eklenen top, aşağıdan katılan her şey). Ürün kodundaki
        -- ayni kuralin aynasi: roll-step.helper.ts icindeki pendingRolls filtresi.
        AND COALESCE((
              SELECT s2."stepSequence" FROM roll_movements rm4
              JOIN work_order_steps s2 ON s2.id = rm4."workOrderStepId"
              WHERE rm4."rollId" = r.id AND rm4."revokedAt" IS NULL AND s2."workOrderId" = s."workOrderId"
              ORDER BY rm4."enteredAt" ASC LIMIT 1
            ), -1) <= s."stepSequence") AS bekleyen
  FROM work_order_steps s
  JOIN work_orders wo ON wo.id = s."workOrderId"
  WHERE s.status <> 'SKIPPED'
)
SELECT a.id, a."workOrderNumber", a.kayitli, a.acik, a.kapali, a.bekleyen,
       CASE WHEN a.acik > 0 THEN 'ACTIVE'
            WHEN a.kapali = 0 THEN 'PENDING'
            WHEN a.bekleyen = 0 THEN 'COMPLETED'
            ELSE 'ACTIVE' END AS beklenen
FROM adim a
WHERE a.kayitli <> (CASE WHEN a.acik > 0 THEN 'ACTIVE'
                         WHEN a.kapali = 0 THEN 'PENDING'
                         WHEN a.bekleyen = 0 THEN 'COMPLETED'
                         ELSE 'ACTIVE' END)`,
    noise: {
      where: `WHERE ${notFixtureSql(`drift."workOrderNumber"`)}`,
      why: "fixture WO'ları: testler adım durumunu doğrudan yazar / yarım temizler (ölçüm: 305 driftin 305'i fixture)",
    },
  },
  // ───────────────────────────────────────────────────────────────────────────
  // §21-§24 — ÖN MUHASEBE. `consistency-check.sql`'de karşılıkları YOK.
  //
  // `CariBalance.balance`, `CashBox.balance` ve `BankAccount.balance` üçü de
  // DENORMALİZE ve DB SEDDİ YOK. Tek koruma "defter satırı ile bakiye AYNI
  // transaction'da atomik increment ile yazılır" disiplinidir; disiplin sessizce
  // kırılır (hata yok, log yok) ve fark ancak ay sonunda müşteriyle yüzleşince
  // anlaşılır. Bu, `Order.shippedQty`nin (D-9) muhasebe ikizidir.
  //
  // ⚠️ Bu bölümler MUHASEBE MODÜLÜ KAPALI kurulumda da koşar ve BOŞ TABLODA
  // TRIVIALLY yeşildir — bu doğrudur ve zararsızdır: fabrikada satır olmadığı
  // için sapma da olamaz. Modül açıldığı gün bekçi kendiliğinden anlamlanır.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "21",
    title: "CariBalance.balance vs Σ(CariTransaction.debit − credit)",
    sql: `
SELECT b."cariId"::text AS cari_id, b.currency::text AS para_birimi,
       b.balance AS kayitli,
       COALESCE(t.toplam, 0) AS hesaplanan,
       b.balance - COALESCE(t.toplam, 0) AS fark
FROM cari_balances b
LEFT JOIN (
  SELECT "cariId", currency, SUM(debit) - SUM(credit) AS toplam
  FROM cari_transactions GROUP BY "cariId", currency
) t ON t."cariId" = b."cariId" AND t.currency = b.currency
WHERE b.balance <> COALESCE(t.toplam, 0)`,
  },
  {
    id: "22",
    // Ters yön: defterde satırı olan her (cari, para birimi) için bakiye SATIRI
    // olmalı. Yalnız §21'e bakmak, bakiye satırı hiç DOĞMAMIŞ bir cariyi
    // kaçırırdı — o cari listede "bakiyesiz" görünür, alacak sessizce kaybolur.
    title: "Defterde hareketi olan her (cari, para birimi) için CariBalance satırı var",
    sql: `
SELECT t."cariId"::text AS cari_id, t.currency::text AS para_birimi,
       0 AS kayitli, t.toplam AS hesaplanan, -t.toplam AS fark
FROM (
  SELECT "cariId", currency, SUM(debit) - SUM(credit) AS toplam
  FROM cari_transactions GROUP BY "cariId", currency
) t
LEFT JOIN cari_balances b ON b."cariId" = t."cariId" AND b.currency = t.currency
WHERE b."cariId" IS NULL AND t.toplam <> 0`,
  },
  {
    id: "23",
    title: "CashBox.balance vs Σ(Payment + CashTransaction + ChequeEvent: IN − OUT)",
    sql: `
SELECT c.id::text AS kasa_id, c.name, c.balance AS kayitli,
       COALESCE(p.toplam, 0) AS hesaplanan,
       c.balance - COALESCE(p.toplam, 0) AS fark
FROM cash_boxes c
LEFT JOIN (
  -- ⚠️ ÜÇ YAZAR: carili tahsilat/ödeme (payments) · carisiz kasa hareketi
  -- (cash_transactions: masraf/gelir/virman/açılış) · çek/senet olayları
  -- (cheque_events: elden tahsil / kendi çekimizin elden ödenmesi). Yalnız
  -- birine bakan bir mutabakat, diğerlerinin hareketlerini "drift" sanardı.
  SELECT "cashBoxId", SUM(t) AS toplam FROM (
    SELECT "cashBoxId", SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END) AS t
      FROM payments WHERE status <> 'CANCELLED' AND "cashBoxId" IS NOT NULL GROUP BY "cashBoxId"
    UNION ALL
    SELECT "cashBoxId", SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END) AS t
      FROM cash_transactions WHERE status <> 'CANCELLED' AND "cashBoxId" IS NOT NULL GROUP BY "cashBoxId"
    UNION ALL
    -- ⚠️ Para oynatan olay kümesi ve işareti TEK KAYNAKTAN
    -- (cheque-cash-events.helper): kasa defteri ve dönem kapanışı da aynısını
    -- okur. DEPOSIT dışarıda — tahsile verilen çek henüz para değildir.
    SELECT e."cashBoxId", SUM(CASE WHEN ${CHEQUE_CASH_INFLOW} THEN ch.amount ELSE -ch.amount END) AS t
      FROM cheque_events e JOIN cheques ch ON ch.id = e."chequeId"
      WHERE e.type IN (${CHEQUE_CASH_TYPES}) AND e."cashBoxId" IS NOT NULL GROUP BY e."cashBoxId"
  ) u GROUP BY "cashBoxId"
) p ON p."cashBoxId" = c.id
WHERE c.balance <> COALESCE(p.toplam, 0)`,
  },
  {
    id: "24",
    title: "BankAccount.balance vs Σ(Payment + CashTransaction + ChequeEvent: IN − OUT)",
    sql: `
SELECT a.id::text AS hesap_id, a.name, a.balance AS kayitli,
       COALESCE(p.toplam, 0) AS hesaplanan,
       a.balance - COALESCE(p.toplam, 0) AS fark
FROM bank_accounts a
LEFT JOIN (
  -- Üç yazar — §23 ile aynı gerekçe. Banka tarafında çek payı BÜYÜKTÜR:
  -- vadeli tahsilatın olağan yolu çektir.
  SELECT "bankAccountId", SUM(t) AS toplam FROM (
    SELECT "bankAccountId", SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END) AS t
      FROM payments WHERE status <> 'CANCELLED' AND "bankAccountId" IS NOT NULL GROUP BY "bankAccountId"
    UNION ALL
    SELECT "bankAccountId", SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END) AS t
      FROM cash_transactions WHERE status <> 'CANCELLED' AND "bankAccountId" IS NOT NULL GROUP BY "bankAccountId"
    UNION ALL
    -- Çek olay kümesi §23 ile aynı tek kaynaktan.
    SELECT e."bankAccountId", SUM(CASE WHEN ${CHEQUE_CASH_INFLOW} THEN ch.amount ELSE -ch.amount END) AS t
      FROM cheque_events e JOIN cheques ch ON ch.id = e."chequeId"
      WHERE e.type IN (${CHEQUE_CASH_TYPES}) AND e."bankAccountId" IS NOT NULL GROUP BY e."bankAccountId"
  ) u GROUP BY "bankAccountId"
) p ON p."bankAccountId" = a.id
WHERE a.balance <> COALESCE(p.toplam, 0)`,
  },
  {
    id: "26",
    // VİRMAN İKİ BACAKLIDIR: bir grup ya iki satır taşır (biri OUT biri IN,
    // tutarları eşit) ya hiç. Tek bacaklı grup = "para çıktı ama girmedi" —
    // kasa defterinde açıklanamayan fark olarak görünür ve kaynağı bulunamaz.
    title: "Virman grupları iki bacaklı ve dengeli (çıkan = giren)",
    sql: `
SELECT "transferGroupId"::text AS grup, count(*)::text AS kayitli,
       SUM(CASE WHEN direction = 'OUT' THEN amount ELSE -amount END)::text AS hesaplanan,
       0 AS fark
FROM cash_transactions
WHERE "transferGroupId" IS NOT NULL AND status <> 'CANCELLED'
GROUP BY "transferGroupId"
HAVING count(*) <> 2
    OR SUM(CASE WHEN direction = 'OUT' THEN amount ELSE -amount END) <> 0
    OR count(DISTINCT currency) <> 1`,
  },
  {
    id: "25",
    // ONAYLI faturanın deftere işlemiş OLMASI gerekir; iptal edilmiş faturanın
    // ise TERS satırı olmalı. İkisi de "yarım kalmış transaction" belirtisidir:
    // fatura CONFIRMED görünür ama cari borcu hiç doğmamıştır (ya da tersi).
    title: "Onaylı fatura defterde var / iptal edilen faturanın storno satırı var",
    sql: `
SELECT i.id::text AS fatura_id, i."docNo",
       (SELECT COUNT(*) FROM cari_transactions t WHERE t."invoiceId" = i.id AND t."sourceType" = 'INVOICE') AS kayitli,
       (SELECT COUNT(*) FROM cari_transactions t WHERE t."invoiceId" = i.id AND t."sourceType" = 'INVOICE_CANCEL') AS hesaplanan,
       0 AS fark
FROM invoices i
WHERE (i.status = 'CONFIRMED'
       AND (SELECT COUNT(*) FROM cari_transactions t WHERE t."invoiceId" = i.id AND t."sourceType" = 'INVOICE') <> 1)
   OR (i.status = 'CANCELLED' AND i."confirmedAt" IS NOT NULL
       AND (SELECT COUNT(*) FROM cari_transactions t WHERE t."invoiceId" = i.id AND t."sourceType" = 'INVOICE_CANCEL') <> 1)`,
  },
  // ── Paket D — iplik kg-defteri (2026-08-14) ───────────────────────────────
  // ⚠️ id'ler "27"/"28": ilk öneri "25"/"26" idi ve İKİSİ DE ALINMIŞTI (yukarıda
  // fatura/storno ve virman dengesi). Bu dosyada id benzersizliğini doğrulayan
  // bir kontrol YOK → mükerrer id sessizce geçer ve iki bölüm tek satır gibi
  // raporlanırdı. Yeni bölüm eklerken en büyük id'yi GERÇEKTEN kontrol et.
  {
    id: "27",
    // `YarnStock.balanceKg`, DB seddi (CHECK/trigger) OLMAYAN denormalize bir
    // alandır — `CariBalance` ile birebir aynı sınıf. Tek yazar `yarn.service`
    // ve her yazım aynı tx'te bir hareket satırı doğurur; ikisi ayrışırsa
    // bakiye sessizce yalan söyler (hata yok, log yok).
    title: "YarnStock.balanceKg vs Σ(YarnMovement: IN/ADJUST_IN − OUT/ADJUST_OUT)",
    sql: `
SELECT s."itemId"::text AS kalem, s."warehouseId"::text AS depo,
       s."balanceKg"::text AS kayitli,
       COALESCE(m.toplam, 0)::text AS hesaplanan,
       (s."balanceKg" - COALESCE(m.toplam, 0))::text AS fark
FROM yarn_stocks s
LEFT JOIN (
  SELECT "itemId", "warehouseId",
         SUM(CASE WHEN kind IN ('IN','ADJUST_IN') THEN "qtyKg" ELSE -"qtyKg" END) AS toplam
  FROM yarn_movements GROUP BY "itemId", "warehouseId"
) m ON m."itemId" = s."itemId" AND m."warehouseId" = s."warehouseId"
WHERE s."balanceKg" <> COALESCE(m.toplam, 0)`,
  },
  {
    id: "28",
    // TERS YÖN: hareketi olan (kalem, depo) çifti için stok satırı hiç
    // doğmamışsa bakiye ekranda GÖRÜNMEZ — mal defterde vardır ama envanterde
    // yoktur. §22'nin (CariBalance satırı eksik) iplik karşılığı.
    //
    // ⚠️ Süzgeç `toplam <> 0` DEĞİL: net sıfıra inen bir çift de satır TAŞIMALI
    // (giriş+çıkış olmuş, kalem o depoda İŞLEM GÖRMÜŞ). Ayrıca negatif bakiye
    // burada ihlal SAYILMAZ — o bilinçli olarak meşrudur (sayım girilmeden
    // çıkış), aranan şey SAPMA'dır.
    title: "Hareketi olan (kalem, depo) için YarnStock satırı yok",
    sql: `
SELECT m."itemId"::text AS kalem, m."warehouseId"::text AS depo,
       0 AS kayitli, m.adet::text AS hesaplanan, m.adet::text AS fark
FROM (
  SELECT "itemId", "warehouseId", COUNT(*) AS adet
  FROM yarn_movements GROUP BY "itemId", "warehouseId"
) m
LEFT JOIN yarn_stocks s ON s."itemId" = m."itemId" AND s."warehouseId" = m."warehouseId"
WHERE s."itemId" IS NULL`,
  },
  {
    id: "29",
    // Stok defterinin "nerede" sorusunu depo cevaplar: stok statüsündeki bir topun
    // deposu NULL ise o top hiçbir Σ'ya giremez ve sevki/iadesi kapıda durur
    // (`assertRollsHaveWarehouse`, 2026-09-13).
    //
    // ⚠️ NEDEN MIGRATION YETMEZ ve bu bölüm VAR: `20260913120000_deposuz_stok_topu_
    // uyarisi` aynı sayıyı ölçer ama BİR KEZ koşar — bugün temiz olup yarın kirlenen
    // kurulumu görmez. Kirlenme yolu gerçek: deposuz bir topu stok kümesine çeken
    // statü terfisi yolları damgayı garanti etmiyor (ölçüldü 2026-09-13).
    //
    // ⚠️ FİKSTÜR SÜZGECİ BİLİNÇLİ: bekçi fikstürleri deposuz stok topu kuruyor ve
    // kalıntı bırakıyor (ölçüldü: `test_tambur_cut_concurrency` + `test_tambur_
    // over_quantity`, 24 top). O fikstürler ayrı bir borçtur; bu bölüm ÜRETİM
    // verisini ölçer, yoksa kapı kendi test artığıyla kalıcı kırmızı yanar.
    title: "Stok kümesinde DEPOSUZ top (sevki/iadesi 409 ile durur)",
    // ⚠️ AYIRT EDİCİ BARKOD ÖN EKİ YETMEZ (ölçüldü 2026-09-13): fikstürünü GERÇEK
    // servisten kuran bekçi (`inventory.createInitialEntry`) topa ÜRETİM FORMATINDA
    // barkod verir (`T130926F2770`), yani `TEST-`/`TST-` ön eki TAŞIMAZ ve bu bölüm
    // onu ÜRETİM verisi sanar. Dört satır tam böyle raporlandı; kimlikleri kalem
    // kodundan çözüldü (`TEST-SSTR-…-KM` = `test_stock_count_reversal` §6p/§6r,
    // 22 m + 12 m). Bu yüzden süzgeç İKİ kolona bakar: topun barkodu VEYA kaleminin
    // kodu fikstür ön eki taşıyorsa satır test artığıdır. Fabrikada `TEST-` kalem
    // yok, yani ölçüm kaybı bilinen ve sıfır.
    noise: {
      where: `WHERE ${notFixtureSql("drift.barcode")} AND ${notFixtureItemOfRollSql("drift.kayit")}`,
      why: "bekçi fikstürleri deposuz stok topu bırakıyor — barkod VEYA kalem kodu ön ekinden elenir (ayrı borç, §29 üretimi ölçer)",
    },
    sql: `
SELECT r.id::text AS kayit, r.barcode, r.status::text AS durum,
       r."currentQty"::text AS metraj
FROM rolls r
WHERE r."warehouseId" IS NULL
  AND r.status IN ('STOCK', 'WAREHOUSE', 'A1_STOCK', 'RETURNED_FROM_SUBCONTRACTOR')`,
  },
  {
    id: "30",
    // Mal stok kümesinden ÇIKTI ama defter çıkışı GÖRMEDİ. Yüklem "hangi servis
    // yazmadı" değil "mal çıktı mı defter gördü mü" diye sorar — KOD YOLUNDAN
    // BAĞIMSIZ, yani yeni bir kapısız yol açıldığında elle listeye eklenmeyi
    // BEKLEMEZ. (`BILINEN_KAPISIZ_YOLLAR` elle tutuluyor ve bir kez eksik çıktı:
    // fason sevki aylarca listede yoktu — 187/187 top çıkışsız.)
    //
    // ⚠️ MİRAS, BORÇ DEĞİL: kullanıcı kararı 2026-09-13 geçmiş onarımını kapsam
    // dışı bıraktı ⇒ bu sayı sıfıra İNMEYECEK. Bölüm bu yüzden ADVISORY ve
    // yalnız UFUKTAN SONRA doğan topu sert ölçer (yukarıdaki `DEFTER_UFKU`).
    // ⚠️ YÜKLEM **ASİMETRİ**DİR, çıplak "çıkışı yok" DEĞİL — ve bu ayrım ölçümle
    // öğrenildi (2026-09-13, kendi hatam): `AT_SUBCONTRACTOR` 187 topun 187'sinde
    // çıkış ucu yoktu ve bunu "187 top defterden kaçtı" diye okudum. Ayrıştırınca
    // stok kümesine GİRİŞ ucu olan **0**, asimetri **0**, hiç satırı olmayan 105
    // çıktı ⇒ o toplar deftere HİÇ girmemişti; eksik çıkış bir asimetri değil,
    // defter-öncesi mirastı. Çıplak yüklem epoch öncesini toplar ve ihlali BÜYÜTÜR.
    // Asimetri yüklemi ise yalnız gerçek kaçağı sayar: *mal deftere GİRDİ, çıkışı
    // yazılmadı* — ve bu, ufuk açıldığında sert ölçülebilecek tek şekildir.
    title: "Deftere GİRMİŞ ama stok kümesinden çıkışı YAZILMAMIŞ top (asimetri, defter ufku)",
    // Fikstür artığı elenir — imza barkodda DEĞİL kalem kodunda (§29'un dersi:
    // servisten doğan fikstür ÜRETİM formatlı barkod taşır).
    noise: {
      where: `WHERE ${notFixtureSql("drift.barcode")} AND ${notFixtureItemOfRollSql("drift.kayit")}`,
      why: "fikstür artığı (ham UPDATE ile stok dışına çekilmiş top) — barkod VEYA kalem kodundan elenir",
    },
    sql: `
SELECT r.id::text AS kayit, r.barcode, r.status::text AS durum,
       r."currentQty"::text AS metraj, r."createdAt"::text AS dogum
FROM rolls r
WHERE r.status IN (${STOK_DISI_STATULER})
  -- ASİMETRİ: stok kümesine GİRMİŞ olmalı…
  AND EXISTS (
    SELECT 1 FROM warehouse_movements gir
     WHERE gir."rollId" = r.id AND gir."toStatus" IN (${STOK_ICI_STATULER}))
  -- …ama çıkışı YAZILMAMIŞ olmalı.
  AND NOT EXISTS (
    SELECT 1 FROM warehouse_movements cik
     WHERE cik."rollId" = r.id AND cik."fromStatus" IN (${STOK_ICI_STATULER}))
  ${DEFTER_UFKU ? `AND r."createdAt" >= '${DEFTER_UFKU}'` : ""}`,
  },
  {
    id: "31",
    // YETİM TRANSFORM ÇIKIŞI — depo kesimi geri alınmış (çocuğun IN'i terslenmiş)
    // ama EBEVEYNİN OUT'u terslenmemiş. Kusur 2026-09-13'te ölçüldü (100 m ebeveyn
    // → kes 40 → geri al ⇒ durum 100 ↔ defter 60) ve `reverseTransformGroupsOf`
    // ile kapandı; bu bölüm o günden ÖNCE sahada açılmış yetimleri SAYAR.
    //
    // ⚠️ SONDA KALEMİ, ONARIM DEĞİL (1e, kullanıcının "geçmişi onarma" kuralı):
    // sayı görülür, kullanıcıya iletilir, backfill AYRI karardır. Yüklem ÜÇ parçalı:
    // çocuk IN terslenmiş ∧ ebeveyn OUT terslenmemiş ∧ ebeveynde DURUM ≠ DEFTER.
    // Üçüncü parça şart: "kaynak arşivde" geri alması (SINGLE, RECORD_CORRECTION)
    // ilk ikisini MEŞRU olarak sağlar — metraj ebeveyne dönmez, OUT gerçek kalır,
    // durum 0 = defter 0. O dal sayılırsa sonda kendi yanlış pozitifini üretir.
    title: "YETİM TRANSFORM çıkışı: depo kesimi geri alınmış, ebeveynin OUT'u terslenmemiş VE durum ≠ defter (yarım geri alma)",
    miras: {
      taban: null,
      tarih: "2026-09-13",
      nerede: "izole ağaç, sonda DB — canlı ölçüm YOK",
      not: "sayı > 0 ⇒ o ebeveynlerin defteri kesilen metraj kadar EKSİK sayıyor; onarım kullanıcı kararı",
    },
    noise: {
      where: `WHERE ${notFixtureSql("drift.barcode")} AND ${notFixtureItemOfRollSql("drift.kayit")}`,
      why: "§11 fikstürü gerçek servisten doğar (üretim barkodu) — barkod VEYA kalem kodu ön ekinden elenir",
    },
    sql: `
SELECT p.id::text AS kayit, p.barcode, cik.qty::text AS metraj, cik."createdAt"::text AS dogum
FROM warehouse_movements cik
JOIN rolls p ON p.id = cik."rollId"
WHERE cik."reasonCode" = 'CUT_SPLIT'
  AND cik."fromWarehouseId" IS NOT NULL
  AND cik."transformGroupId" IS NOT NULL
  AND cik."reversesMovementId" IS NULL
  -- ebeveynin çıkışı TERSLENMEMİŞ…
  AND NOT EXISTS (SELECT 1 FROM warehouse_movements rv WHERE rv."reversesMovementId" = cik.id)
  -- …ebeveynin DURUMU defterinden ayrışmış (arşiv dalı 0 = 0 ile buradan elenir)…
  AND p."currentQty" <> (
    SELECT COALESCE(SUM(CASE WHEN m."toWarehouseId" IS NOT NULL THEN m.qty ELSE 0 END
                     - CASE WHEN m."fromWarehouseId" IS NOT NULL THEN m.qty ELSE 0 END), 0)
      FROM warehouse_movements m WHERE m."rollId" = p.id)
  -- …ama aynı grubun ÇOCUK girişi TERSLENMİŞ (yarım geri alma imzası).
  AND EXISTS (
    SELECT 1 FROM warehouse_movements gir
     WHERE gir."transformGroupId" = cik."transformGroupId"
       AND gir."toWarehouseId" IS NOT NULL
       AND gir."reversesMovementId" IS NULL
       AND EXISTS (SELECT 1 FROM warehouse_movements rv2 WHERE rv2."reversesMovementId" = gir.id))`,
  },
  {
    id: "32",
    // DAMGALI SAPMA, BAĞLI ÇIKIŞI YETİM — kapanış sapması (`RECORD_CORRECTION` /
    // `SCRAP`, kaynak TAMBUR_*FINALIZE) FULL geri almada damgalanmış (`reversedAt`)
    // ama `rollVarianceId` ile ona bağlı stok çıkışı (`CUT_DISCARD` / `SCRAP`)
    // terslenmemiş: aynı kararın iki defteri ayrı yöne bakıyor (hüküm ① b1,
    // 2026-09-14; ölçüldü 100 ↔ 60 / 100 ↔ 0). Kod `reverseVarianceBoundStockMovesTx`
    // ile kapandı; bu bölüm o günden ÖNCE açılmış yetimleri SAYAR.
    //
    // ⚠️ SONDA KALEMİ, ONARIM DEĞİL (§31 ile aynı sınıf): sayı kullanıcıya iletilir.
    // Bağ karar verir, sebep kodu değil — yarın aynı bağla yazılan her satır girer.
    title: "DAMGALI kapanış sapması, bağlı stok çıkışı TERSLENMEMİŞ (aynı kararın iki defteri ayrışmış)",
    miras: {
      taban: null,
      tarih: "2026-09-14",
      nerede: "izole ağaç, sonda DB — canlı ölçüm YOK",
      not: "sayı > 0 ⇒ o ebeveynlerin defteri kapanışın kalanı kadar EKSİK sayıyor; onarım kullanıcı kararı",
    },
    noise: {
      where: `WHERE ${notFixtureSql("drift.barcode")} AND ${notFixtureItemOfRollSql("drift.kayit")}`,
      why: "§13/§14 fikstürü gerçek servisten doğar (üretim barkodu) — barkod VEYA kalem kodu ön ekinden elenir",
    },
    sql: `
SELECT p.id::text AS kayit, p.barcode, m.qty::text AS metraj, m."createdAt"::text AS dogum
FROM warehouse_movements m
JOIN roll_variances v ON v.id = m."rollVarianceId"
JOIN rolls p ON p.id = m."rollId"
WHERE v."reversedAt" IS NOT NULL
  AND m."reversesMovementId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM warehouse_movements rv WHERE rv."reversesMovementId" = m.id)`,
  },
  {
    id: "33",
    // initialQty = GİRİŞ + Σ CANLI TAMBUR AŞIMI — hüküm ②/④ (2026-09-14). `initialQty`
    // üretim anı snapshot'ıdır; onu yalnız aşım (kesim anı keşfi TAMBUR_OVERCUT ya da
    // geri almanın karşılanmayan bump'ı TAMBUR_UNDO_RESTORE/FULL) yukarı çeker ve her
    // artış sapma defterinde canlı bir OVERAGE satırıyla açıklanır. Eşitlik bozuksa
    // ya bump satırsız yazıldı (sessiz şişme, 100→140 sınıfı) ya aşım iki kez sayıldı
    // (Σ 40 / gerçek 20 sınıfı). CHECK `rolls_qty_le_initial` bu yönü GÖRMEZ (1c'ye
    // iletildi) — bu kalem o kör tarafın sondası.
    //
    // KAPSAM: yalnız canlı TAMBUR_* OVERAGE sapması olan ve stok defterinde terslenmemiş
    // bir GİRİŞ ucu (ENTRY ya da TRANSFORM IN) olan toplar — giriş metrajı defterden
    // okunur, ufuk öncesi toplar kapsam dışı (girişi yok).
    title: "initialQty ≠ giriş metrajı + Σ canlı TAMBUR aşımı (sessiz şişme ya da çift sayım)",
    miras: {
      taban: null,
      tarih: "2026-09-14",
      nerede: "izole ağaç, sonda DB — canlı ölçüm YOK",
      not: "sayı > 0 ⇒ o topların initialQty'si açıklanamayan bir farkla oynamış; onarım kullanıcı kararı",
    },
    noise: {
      where: `WHERE ${notFixtureSql("drift.barcode")} AND ${notFixtureItemOfRollSql("drift.kayit")}`,
      why: "§16/§17 fikstürü gerçek servisten doğar (üretim barkodu) — barkod VEYA kalem kodu ön ekinden elenir",
    },
    sql: `
SELECT r.id::text AS kayit, r.barcode, r."initialQty"::text AS metraj, r."createdAt"::text AS dogum
FROM rolls r
JOIN LATERAL (
  SELECT m.qty FROM warehouse_movements m
   WHERE m."rollId" = r.id AND m."toWarehouseId" IS NOT NULL AND m."fromWarehouseId" IS NULL
     AND m."reversesMovementId" IS NULL
     AND NOT EXISTS (SELECT 1 FROM warehouse_movements rv WHERE rv."reversesMovementId" = m.id)
   ORDER BY m."createdAt" ASC LIMIT 1) giris ON true
WHERE EXISTS (
    SELECT 1 FROM roll_variances v
     WHERE v."rollId" = r.id AND v.kind = 'OVERAGE' AND v."reversedAt" IS NULL
       AND v.source IN ('TAMBUR_OVERCUT','TAMBUR_UNDO_RESTORE','TAMBUR_UNDO_FULL'))
  AND r."initialQty" <> giris.qty + (
    SELECT COALESCE(SUM(v.qty), 0) FROM roll_variances v
     WHERE v."rollId" = r.id AND v.kind = 'OVERAGE' AND v."reversedAt" IS NULL
       AND v.source IN ('TAMBUR_OVERCUT','TAMBUR_UNDO_RESTORE','TAMBUR_UNDO_FULL'))`,
  },
];

async function driftCount(s: Section): Promise<number> {
  const sql = `SELECT COUNT(*)::int AS n FROM (${s.sql}\n) drift\n${s.noise?.where ?? ""}`;
  const rows = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.raw(sql));
  return Number(rows[0]?.n ?? 0);
}

/** Drift varsa teşhis için ilk birkaç satır — "N satır" tek başına iş görmez. */
async function driftSamples(s: Section): Promise<string[]> {
  const sql = `SELECT * FROM (${s.sql}\n) drift\n${s.noise?.where ?? ""}\nLIMIT 3`;
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.raw(sql));
  return rows.map((r) =>
    Object.entries(r)
      .map(([k, v]) => `${k}=${v === null ? "∅" : String(v)}`)
      .join(", ")
  );
}

async function main(): Promise<void> {
  console.log("\n=== Veri tutarlılık kapısı (consistency-check.sql'in mekanik ikizi) ===");
  console.log(`${SECTIONS.length} bölüm · her bölümde drift satırı sayısı 0 olmalı\n`);

  for (const s of SECTIONS) {
    let n: number;
    try {
      n = await driftCount(s);
    } catch (e) {
      // Sorgu patlarsa bunu "drift yok" diye okumak en tehlikeli sessizlik olurdu
      // (şema değişmiş olabilir) → açıkça başarısızlık.
      check(`§${s.id} ${s.title}`, false, `SORGU HATASI: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const suffix = s.noise ? ` [gürültü filtresi: ${s.noise.why}]` : "";
    if (s.miras) {
      // MİRAS: mutlak sayı beklenen, ARTIŞ kırmızı. Sayı HER KOŞUMDA basılır —
      // "0 bulundu çünkü hiç bakılmadı" ile "0 bulundu çünkü temiz" ayrılsın.
      const artti = s.miras.taban !== null && n > s.miras.taban;
      const tabanMetni =
        s.miras.taban === null
          ? `ufuk AÇILMADI ⇒ artış ölçülmüyor (ölçüm ${s.miras.tarih}, ${s.miras.nerede})`
          : `taban ${s.miras.taban} (${s.miras.tarih} · ${s.miras.nerede})`;
      check(
        `§${s.id} ${s.title}`,
        !artti,
        `${n} satır · ${tabanMetni}` +
          (artti ? ` — ⬆️ ARTTI (+${n - (s.miras.taban as number)}): YENİ kapısız çıkış açılmış` : "") +
          ` · ${s.miras.not}${suffix}`,
      );
      if (artti) {
        const samples = await driftSamples(s).catch(() => []);
        for (const line of samples) console.log(`      ↳ ${line}`);
      }
      continue;
    }
    check(`§${s.id} ${s.title}`, n === 0, n === 0 ? `drift yok${suffix}` : `${n} DRIFT SATIRI${suffix}`);
    if (n > 0) {
      const samples = await driftSamples(s).catch(() => []);
      for (const line of samples) console.log(`      ↳ ${line}`);
      if (n > samples.length) console.log(`      ↳ … +${n - samples.length} satır daha`);
    }
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) {
    console.log(
      "\nDÜŞTÜYSE: bir denormalize alan defterden kopmuş ya da bir akış nesneyi\n" +
        "yarım bırakmış. ÖNCE hangi kod yolunun ürettiğini bul — geçmiş satırları\n" +
        "toplu UPDATE ile 'düzeltmek' kök nedeni gizler ve drift geri gelir.\n" +
        "Aynı sorguları elle koşmak için: psql <db> -f scripts/consistency-check.sql"
    );
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
