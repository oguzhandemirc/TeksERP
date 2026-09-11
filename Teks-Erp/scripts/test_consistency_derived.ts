// =============================================================================
// TÜRETİLMİŞ-ALAN TUTARLILIK KAPISI — `scripts/consistency-check-derived.sql`'in
// mekanik ikizi
//
// NEDEN AYRI DOSYA (ve neden `test_consistency.ts`'e eklenmedi): kardeş dosya
// DEFTER/DENORMALİZE TOPLAMLARA bakar (shippedQty, snapshot totalQty, çuval↔sevk
// üyeliği). Buradaki altı bölüm ise **başka bir alandan TÜRETİLMESİ gereken**
// alanların kaynağından kopup kopmadığını sorar:
//
//   §21  WorkOrder.type                  ← sipariş bağının VARLIĞI
//   §22  WorkOrder.status                ← adım durumlarının TAMAMLANMIŞLIĞI
//   §23  KursunBypassAssignment açıklığı ← sahibi iş emrinin CANLILIĞI
//   §24  Fason kalemin açık/kapalılığı   ← OPEN_OUTSTANDING dörtlüsü (a/b/c)
//   §25  Roll.labelDirty                 ← etiketi etkileyen son değişimin ANI
//   §26  Roll.colorId                    ← iş emrinin hedef rengi (+ sapma defteri)
//
// Ortak nokta: hiçbirinde DB seddi YOKTUR; tek koruma yazan kod yolunun
// disiplinidir. §21 tam olarak böyle bulundu (2026-08-21, commit 74d92085):
// "Sipariş Bağla" pivot satırını yazıyordu ama `WorkOrder.type`'a dokunmuyordu →
// 13 iş emri listede/künyede/kartta "Stok" basarken detay panelinde siparişi
// gösteriyordu. Hata yok, log yok, yalnız yanlış kâğıt.
//
// ⚠️ SORGULAR `consistency-check-derived.sql`'DEN AYNEN ALINDI. Bir bölümün
// mantığı değişecekse ÖNCE o dosyada değişmeli, sonra buraya kopyalanmalı — psql
// ile elle koşan operatör ile `npm test` aynı sonucu görmeli. (`psql` HER durumda
// `exit 0` verir; SQL dosyası tek başına bir kapı DEĞİLDİR.)
//
// Salt-okunur: normal koşumda hiçbir yazma/fixture yok → üretim DB'sine karşı da
// koşulabilir (asıl değeri orada).
//
// Koşum:
//   npx tsx scripts/test_consistency_derived.ts
//   DATABASE_URL="postgresql://oad@localhost:5432/tekserp_saha?schema=public" \
//     npx tsx scripts/test_consistency_derived.ts
//   npx tsx scripts/test_consistency_derived.ts --probe    # negatif sondalar (aşağı)
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";

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
function info(label: string, extra = ""): void {
  console.log(`ℹ  ${label}${extra ? " — " + extra : ""}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ORTAM GÜRÜLTÜSÜ FİLTRESİ — bu dosyada BİLİNÇLİ OLARAK HİÇ KULLANILMIYOR
//
// Kardeş dosyanın kuralı: "yeni bir bölüm eklerken filtreyi ÖNCE ekleme — önce
// filtresiz ölç. Filtre yalnız 'bu satırları test paketi üretti' KANITLANDIĞINDA
// eklenir ve gerekçesi `why` alanına yazılır."
//
// ÖLÇÜLDÜ (2026-08-21, filtresiz):
//   • dev DB (`adnansahin_db`, 684 iş emrinin 501'i TEST-/TST-/DEMO- fixture'ı,
//     298 top) → altı bölümün ALTISI da 0 satır.
//   • saha yedeği (`tekserp_saha`, 2110 top) → §21-§25 0 satır; §26 4 satır
//     (aşağıdaki gerekçeye bak, o bölüm zaten kapı değil).
// Yani filtreyi haklı çıkaracak tek bir satır bile yok → EKLENMEDİ. `notFixture()`
// yardımcısı burada duruyor çünkü ileride bir bölüm gürültü ürettiğinde aynı
// sözleşmeyle (ölç → kanıtla → `why` yaz) kullanılacak; sonda modu onu ayrıca
// "filtre eklenirse ne KAYBEDİLİR" göstergesi olarak koşturur (bkz. §21 sondası).
// ─────────────────────────────────────────────────────────────────────────────
const FIXTURE_PREFIXES = ["TEST-", "TST-", "DEMO-"];

/** `<kolon>` test/demo fixture ön eki taşımıyor mu? (NULL = üretim sayılır, elenmez) */
function notFixture(column: string): string {
  const conds = FIXTURE_PREFIXES.map((p) => `${column} NOT LIKE '${p}%'`).join(" AND ");
  return `(${column} IS NULL OR (${conds}))`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-SAPMA KAPISININ YÜRÜRLÜK ANI (§26b eşiği)
//
// Kapı 2026-08-19'un ORTASINDA geldi: `tambur-plan-gate.helper` 16:12 (d69d144c),
// `roll_plan_deviations` migration'ı 19:00. O günü kapsama almak, kapı henüz
// yokken finalize edilmiş topları ihlal sayardı → eşik BİR SONRAKİ fabrika
// gününün başıdır ("kapı kesin oradaydı" diyebildiğimiz ilk an).
//
// ⚠️ EŞİK REPO TARİHİDİR, SAHAYA ÇIKIŞ TARİHİ DEĞİL. 2026-08-21 yedeğinde
// `roll_plan_deviations` BOŞ — kapı o gün canlıda henüz koşmamıştı. Sahaya daha
// geç çıktıysa eşiği ileri alın:
//     PLAN_GATE_SINCE="2026-09-01T00:00:00+03:00" npx tsx scripts/...
// SQL ikizinde aynı ayar `-v plan_gate_since='...'` ile verilir.
// ─────────────────────────────────────────────────────────────────────────────
const PLAN_GATE_SINCE_RAW = process.env.PLAN_GATE_SINCE ?? "2026-08-20T00:00:00+03:00";
const PLAN_GATE_SINCE = new Date(PLAN_GATE_SINCE_RAW);

interface Section {
  /** consistency-check-derived.sql'deki bölüm numarası (izlenebilirlik için birebir) */
  id: string;
  title: string;
  /** consistency-check-derived.sql'den AYNEN kopyalanan sorgu (psql \echo satırları hariç) */
  sql: string;
  /**
   * Dış filtre — verbatim sorgu bir ALT SORGU olarak sarılır, filtre DIŞARIDAN
   * uygulanır. Böylece orijinal sorgunun metni hiç değişmez (kopya kaymaz) ama
   * ortam gürültüsü elenir. (Bugün hiçbir bölümde YOK — yukarıdaki ölçüme bak.)
   */
  noise?: { where: string; why: string };
  /**
   * "info" → drift satırı KIRMIZI VERMEZ, yalnız ℹ olarak raporlanır.
   * Yalnız §26 için: plan-sapma kapısı GERİYE DÖNÜK DEĞİLDİR, yani kapıdan önce
   * finalize edilmiş meşru toplar bu sorguda görünür (saha yedeğinde 4 tane).
   * Onları drift saymak bekçiyi ilk günden kalıcı kırmızıya düşürürdü ve kırmızı
   * bekçi = görmezden gelinen bekçi. Kapı görevini tarih eşikli §26b yapar.
   */
  mode?: "check" | "info";
}

const SECTIONS: Section[] = [
  {
    // İKİ YÖNLÜ ve öyle kalmalı. `linkOrderLines` ilk bağda STOK→SİPARİŞE ÖZEL,
    // `unlinkOrderLine` son bağda tersini yapar — ama pivot'un TEK yazıcısı onlar
    // değil: `work_order_to_order_lines.orderLineId` FK'sı `onDelete: Cascade`
    // taşır, yani sipariş satırı silinince bağ SESSİZCE düşer ve o yolda tipe
    // dokunan kimse yoktur. Tek yönü ölçmek bu açığı görmezdi.
    id: "21",
    title: "WorkOrder.type ↔ sipariş bağının varlığı (tip bağın AYNASIDIR)",
    sql: `
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
      EXISTS (SELECT 1 FROM work_order_to_order_lines l WHERE l."workOrderId" = wo.id)`,
  },
  {
    id: "22",
    title: "IN_PROGRESS iş emri ama TÜM adımları COMPLETED/SKIPPED",
    sql: `
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
HAVING COUNT(*) FILTER (WHERE s.status NOT IN ('COMPLETED', 'SKIPPED')) = 0`,
  },
  {
    id: "23",
    title: "AÇIK kurşun bypass ataması ama sahibi iş emri TERMİNAL",
    sql: `
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
  AND wo.status IN ('COMPLETED', 'SUPERSEDED', 'CANCELLED')`,
  },
  {
    id: "24a",
    title: "Fason kalemin TEK tam makbuzu İPTAL edilmiş (kalem yeniden AÇIK)",
    sql: `
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
          AND sr."cancelledAt" IS NULL)`,
  },
  {
    // ⚠️ `r.status = 'AT_SUBCONTRACTOR'` SÜZGECİ LOAD-BEARING, "fazladan" DEĞİL.
    // `directShippedAt` dolu bir sevkin kalemleri TANIM GEREĞİ makbuzsuz ve
    // remainderClosedAt'sizdir (mal fasondan doğrudan müşteriye çıktı, dönmeyecek)
    // — süzgeç olmasaydı bu bölüm her MEŞRU doğrudan-sevki drift sayardı ve fabrika
    // özelliği ilk kullandığı gün bekçi kalıcı kırmızıya düşerdi. Gerçek invariant:
    // `directShipRolls` sevk edilen TOPLARI aynı tx'te `SUBCONTRACTOR_CONSUMED`
    // yapar → "sevk tamamen doğrudan-sevk edildi" ile "topu hâlâ fasonda" AYNI ANDA
    // doğru olamaz. Olduysa aynı metraj hem sevk raporunda hem fason bakiyesinde.
    id: "24b",
    title: "DOĞRUDAN SEVK edilmiş sevkin/topun topu HÂLÂ fasonda (AT_SUBCONTRACTOR)",
    sql: `
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
WHERE (sd."directShippedAt" IS NOT NULL OR r."directShipmentId" IS NOT NULL)
  AND sd."cancelledAt" IS NULL
  AND sdi."remainderClosedAt" IS NULL
  AND r.status = 'AT_SUBCONTRACTOR'
  AND NOT EXISTS (
        SELECT 1 FROM subcontractor_receipt_items sri
        JOIN subcontractor_receipts sr ON sr.id = sri."receiptId"
        WHERE sri."sourceDispatchItemId" = sdi.id
          AND sri."isPartial" = false
          AND sr."cancelledAt" IS NULL)`,
  },
  {
    // 24b'nin TERS yönü ve AYRI bir kod yolu: orada "mal çıktı ama fasonda
    // görünüyor", burada "mal fasonda ama İÇERİDE görünüyor". 2026-08-29'a dek
    // iş emri iptali `cancelBulk`ın PARÇALI başarısını okumuyordu ve artık-kalan
    // yazımı topu tx DIŞINDA içeri alıyordu → açık sevk ortada kalırken mal Ham
    // Stok'ta görünüyordu (BULGU-T1-009). ⚠️ `directShippedAt IS NULL` ve
    // `r."directShipmentId" IS NULL` load-bearing: doğrudan sevkte (alt küme dahil)
    // top MEŞRUEN SUBCONTRACTOR_CONSUMED olur.
    id: "24c",
    title: "AÇIK+OUTSTANDING fason kalemi ama top FASONDA DEĞİL (mal iki yerde)",
    sql: `
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
  AND r."directShipmentId" IS NULL
  AND r.status <> 'AT_SUBCONTRACTOR'
  AND NOT EXISTS (
        SELECT 1 FROM subcontractor_receipt_items sri
        JOIN subcontractor_receipts sr ON sr.id = sri."receiptId"
        WHERE sri."sourceDispatchItemId" = sdi.id
          AND sri."isPartial" = false
          AND sr."cancelledAt" IS NULL)`,
  },
  {
    // ⚠️ Kanıt AUDIT'ten okunur ve bu bölümün BİLİNEN sınırıdır: `archive-scheduler`
    // `system_logs`'u 6 ayda bir arşive TAŞIR → altı aydan eski bir değişiklik
    // burada GÖRÜNMEZ ve bölüm sessizce yeşile döner. Bu yüzden sorgu EXISTS ile
    // kurulur: log YOKSA satır ÜRETİLMEZ ("log yok" asla "drift" diye okunmaz).
    // Bölüm bir TARAMA aracıdır, kanıt değil; kalıcı çözüm `labelPrintedAt` /
    // `entryReason` dersinin aynısı olurdu (kararın izi kaydın KENDİ satırında).
    id: "25",
    title: "Kartelalık işareti etiket BASILDIKTAN SONRA değişmiş ama etiket bayat değil",
    sql: `
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
          AND sl."createdAt" > r."labelPrintedAt")`,
  },
  {
    // KAPSAM: yalnız `producedInStep.station.kind = 'TAMBUR'` — plan kapısı üç
    // yolda da (finalize / cut / finalize-open-fabric) Tambur üzerinden koşar;
    // Tambur'suz rotada son adım finalize eder ve kapı HİÇ çalışmaz, o topları
    // buraya almak hiç konmamış bir kuralın ihlalini raporlamak olurdu.
    // Defter sorgusu rollId VE childRollId'ye bakar: kesim yolunda kapıya PARENT
    // girer, depoya ÇOCUK iner — tek kolona bakmak çocuğu "izsiz" sanardı.
    id: "26",
    title: "BİLGİ — depodaki top rengi ≠ WO hedef rengi, sapma defterinde iz yok",
    mode: "info",
    sql: `
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
        WHERE d."rollId" = r.id OR d."childRollId" = r.id)`,
  },
  {
    id: "26b",
    title: `KAPI — aynısı ama yalnız ${PLAN_GATE_SINCE_RAW} SONRASI finalize edilenler`,
    sql: `
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
  AND r."finalizedAt" >= '${PLAN_GATE_SINCE.toISOString()}'::timestamptz
  AND NOT EXISTS (
        SELECT 1 FROM roll_plan_deviations d
        WHERE d."rollId" = r.id OR d."childRollId" = r.id)`,
  },
];

type Db = Prisma.TransactionClient;

async function driftCount(s: Section, db: Db = prisma): Promise<number> {
  const sql = `SELECT COUNT(*)::int AS n FROM (${s.sql}\n) drift\n${s.noise?.where ?? ""}`;
  const rows = await db.$queryRaw<Array<{ n: number }>>(Prisma.raw(sql));
  return Number(rows[0]?.n ?? 0);
}

/** Drift varsa teşhis için ilk birkaç satır — "N satır" tek başına iş görmez. */
async function driftSamples(s: Section, db: Db = prisma): Promise<string[]> {
  const sql = `SELECT * FROM (${s.sql}\n) drift\n${s.noise?.where ?? ""}\nLIMIT 3`;
  const rows = await db.$queryRaw<Array<Record<string, unknown>>>(Prisma.raw(sql));
  return rows.map((r) =>
    Object.entries(r)
      .map(([k, v]) => `${k}=${v === null ? "∅" : String(v)}`)
      .join(", ")
  );
}

// =============================================================================
// NORMAL KOŞUM (salt-okunur)
// =============================================================================
async function runGate(): Promise<void> {
  console.log("\n=== Türetilmiş-alan tutarlılık kapısı (consistency-check-derived.sql ikizi) ===");
  console.log(`${SECTIONS.length} bölüm · §26 dışında drift satırı sayısı 0 olmalı\n`);

  for (const s of SECTIONS) {
    let n: number;
    try {
      n = await driftCount(s);
    } catch (e) {
      // Sorgu patlarsa bunu "drift yok" diye okumak en tehlikeli sessizlik olurdu
      // (şema değişmiş olabilir) → BİLGİ bölümü de olsa açıkça başarısızlık.
      check(`§${s.id} ${s.title}`, false, `SORGU HATASI: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const suffix = s.noise ? ` [gürültü filtresi: ${s.noise.why}]` : "";
    if (s.mode === "info") {
      info(
        `§${s.id} ${s.title}`,
        n === 0 ? `satır yok${suffix}` : `${n} satır (kapı DEĞİL — §26b'ye bak)${suffix}`
      );
    } else {
      check(`§${s.id} ${s.title}`, n === 0, n === 0 ? `drift yok${suffix}` : `${n} DRIFT SATIRI${suffix}`);
    }
    if (n > 0) {
      const samples = await driftSamples(s).catch(() => []);
      for (const line of samples) console.log(`      ↳ ${line}`);
      if (n > samples.length) console.log(`      ↳ … +${n - samples.length} satır daha`);
    }
  }

  // ── §26b'nin VAKUMEN yeşil olup olmadığını söyle ───────────────────────────
  // Defter hiç yazılmamışsa kapı bu DB'de henüz koşmamıştır; §26b'nin yeşilliği
  // "her şey yolunda" değil "ölçülecek bir şey yok" demektir. Bunu basmamak,
  // kardeş bekçilerin "körlük zemini" dersini görmezden gelmek olurdu.
  try {
    const [{ n }] = await prisma.$queryRaw<Array<{ n: number }>>(
      Prisma.raw(`SELECT COUNT(*)::int AS n FROM roll_plan_deviations`)
    );
    if (Number(n) === 0) {
      info(
        "§26b körlük zemini",
        "roll_plan_deviations BOŞ → plan-sapma kapısı bu DB'de hiç koşmamış; " +
          "§26b yeşilliği kanıt değil. Kapı sahaya çıkınca PLAN_GATE_SINCE'i çıkış tarihine al."
      );
    } else {
      info("§26b körlük zemini", `roll_plan_deviations ${n} satır → kapı bu DB'de koşmuş`);
    }
  } catch {
    /* tablo yoksa §26/§26b sorguları zaten SORGU HATASI ile düşer */
  }
}

// =============================================================================
// NEGATİF SONDALAR (`--probe`, VARSAYILAN KAPALI)
//
// NEDEN AYRI DOSYA DEĞİL: `run-all-tests.ts` `scripts/test_*.ts`'in HEPSİNİ
// toplar. Ayrı bir `test_consistency_derived_probe.ts` her `npm test` koşumunda
// PAYLAŞILAN dev DB'sine bilerek BOZUK satır yazardı — bu kapının en değerli
// özelliği (salt-okunur olması, canlıya karşı koşulabilmesi) bir dosya adı
// yüzünden kaybolurdu. Bayrak aynı dosyada durunca sondalar SEVK EDİLEN sorguyu
// ölçer; ayrı dosya kaçınılmaz olarak bir KOPYA ölçmeye başlardı.
//
// NEDEN GERİ ALINAN TRANSACTION: cleanup'ın yarım kalması bu bekçide özellikle
// pahalı olurdu — dev DB'sinde kalan tek bir sonda satırı kapıyı KALICI kırmızıya
// düşürür ve kırmızı bekçi görmezden gelinir. `$transaction` içinde ölçüp
// ROLLBACK'le çıkmak "temizlik unutuldu" hata sınıfını tamamen ortadan kaldırır
// (aynı bağlantıda ölçüldüğü için okunabilir, dışarıya hiç commit edilmez).
//
// Her sonda ÜÇ şeyi birden kanıtlar:
//   1. hedef bölüm(ler) o fixture'la KIRMIZI/DOLU hâle geliyor  → vakumen yeşil değil,
//   2. hedef DIŞINDAKİ bölümler etkilenmiyor                     → sonda hedefi kadar dar,
//   3. ölçüm BASELINE farkı üzerinden yapılıyor                  → DB'de zaten var olan
//      satırlar (ör. saha yedeğindeki 4 adet §26 satırı) sonucu bozmuyor.
// =============================================================================
const PROBE = process.argv.includes("--probe");
const ROLLBACK = Symbol("probe-rollback");
const SUF = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.toUpperCase();
let seq = 0;
/** Sonda fixture'ı: `TEST-` öneki (CLAUDE.md test verisi sözleşmesi) + benzersiz kuyruk. */
const tag = (what: string): string => `TEST-CD-${what}-${SUF}-${++seq}`;

interface Probe {
  id: string;
  what: string;
  /** Drift'i yaratan fixture — tx İÇİNDE, sıralı (tx.* ile Promise.all YASAK). */
  build: (tx: Db) => Promise<void>;
  /** Bu fixture'ın DOLDURMASI beklenen bölüm id'leri. */
  expect: string[];
}

/** Ortak master-data — her sonda kendi tx'inde yaratır, ROLLBACK ile yok olur. */
async function seedItem(tx: Db): Promise<string> {
  const item = await tx.item.create({
    data: { code: tag("ITEM"), name: "Sonda Kumaş", itemType: "FABRIC" },
  });
  return item.id;
}
async function seedStation(tx: Db, kind: "TAMBUR" | "PROCESS_QC" | "SUBCONTRACTOR"): Promise<string> {
  const st = await tx.station.create({
    data: { code: tag("ST"), name: `Sonda ${kind}`, type: "INTERNAL", kind },
  });
  return st.id;
}
/**
 * Alt küme doğrudan sevk şekli: iki toplu sevkin YALNIZ bir topu müşteriye gitti,
 * sevk `directShippedAt` almadı, top DSK'ya bağlandı. Diğer top fasonda kalır
 * (sevk gerçekten açık — sonda yalnız sevk edilen kalemi sınar).
 */
async function seedSubsetDirectShip(tx: Db, shippedStatus: "AT_SUBCONTRACTOR" | "SUBCONTRACTOR_CONSUMED"): Promise<void> {
  const itemId = await seedItem(tx);
  const stationId = await seedStation(tx, "SUBCONTRACTOR");
  const woId = await seedWo(tx, itemId, { status: "IN_PROGRESS" });
  const step = await tx.workOrderStep.create({
    data: { workOrderId: woId, stationId, stepSequence: 1, status: "ACTIVE" },
  });
  const batch = await tx.batch.create({ data: { batchNumber: tag("P"), workOrderId: woId } });
  const sub = await tx.subcontractor.create({ data: { code: tag("FSN"), name: "Sonda Fason altküme" } });
  const customer = await tx.customer.create({ data: { code: tag("MUS").slice(0, 32), name: "Sonda Müşteri altküme" } });
  const shipped = await tx.roll.create({
    data: {
      barcode: tag("T"), itemId, initialQty: 60, currentQty: 60,
      status: shippedStatus,
      currentStepId: shippedStatus === "AT_SUBCONTRACTOR" ? step.id : null,
    },
  });
  const kept = await tx.roll.create({
    data: { barcode: tag("T"), itemId, initialQty: 40, currentQty: 40, status: "AT_SUBCONTRACTOR", currentStepId: step.id },
  });
  const dispatch = await tx.subcontractorDispatch.create({
    data: {
      dispatchNo: tag("SD"), workOrderId: woId, batchId: batch.id, stepId: step.id,
      subcontractorId: sub.id, totalQty: 100,
    },
  });
  await tx.subcontractorDispatchItem.create({ data: { dispatchId: dispatch.id, rollId: shipped.id, dispatchedQty: 60 } });
  await tx.subcontractorDispatchItem.create({ data: { dispatchId: dispatch.id, rollId: kept.id, dispatchedQty: 40 } });
  const ds = await tx.directShipment.create({
    data: {
      shipmentNo: tag("DSK"), dispatchId: dispatch.id, customerId: customer.id,
      reason: "sonda alt küme", totalQty: 60, rollCount: 1,
    },
  });
  await tx.roll.update({ where: { id: shipped.id }, data: { directShipmentId: ds.id } });
}

/** Varsayılan STOK+targetItem: §21'in aynasına UYUMLU (sonda kendi hedefi dışında bölüm doldurmasın). */
async function seedWo(
  tx: Db,
  itemId: string,
  data: { status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "SUPERSEDED"; targetColorId?: string }
): Promise<string> {
  const wo = await tx.workOrder.create({
    data: {
      workOrderNumber: tag("WO"),
      // `work_orders_stockprod_targetItem` CHECK'i: STOCK_PRODUCTION → targetItemId ZORUNLU.
      type: "STOCK_PRODUCTION",
      targetItemId: itemId,
      status: data.status,
      ...(data.targetColorId ? { targetColorId: data.targetColorId } : {}),
    },
  });
  return wo.id;
}

const PROBES: Probe[] = [
  {
    id: "21",
    what: "STOK tipli iş emrine sipariş bağı eklenmiş (74d92085 öncesi 'Sipariş Bağla' davranışı)",
    expect: ["21"],
    build: async (tx) => {
      const itemId = await seedItem(tx);
      const woId = await seedWo(tx, itemId, { status: "IN_PROGRESS" });
      const customer = await tx.customer.create({ data: { code: tag("CUS"), name: "Sonda Müşteri" } });
      const order = await tx.order.create({
        data: { orderNumber: tag("ORD"), customerId: customer.id },
      });
      const line = await tx.orderLine.create({
        data: { orderId: order.id, itemId, quantity: 100 },
      });
      await tx.workOrderToOrderLine.create({
        data: { workOrderId: woId, orderLineId: line.id, allocatedQty: 100 },
      });
    },
  },
  {
    id: "21-ters",
    what: "SİPARİŞE ÖZEL tipli iş emrinin hiç bağı yok (bağ sökülmüş, tip geri alınmamış)",
    expect: ["21"],
    build: async (tx) => {
      await tx.workOrder.create({
        data: { workOrderNumber: tag("WO"), type: "ORDER_PRODUCTION", status: "IN_PROGRESS" },
      });
    },
  },
  {
    id: "22",
    what: "IN_PROGRESS iş emrinin tüm adımları COMPLETED (completeWorkOrderIfStepsDone kaçırılmış)",
    expect: ["22"],
    build: async (tx) => {
      const itemId = await seedItem(tx);
      const stationId = await seedStation(tx, "PROCESS_QC");
      const woId = await seedWo(tx, itemId, { status: "IN_PROGRESS" });
      await tx.workOrderStep.create({
        data: { workOrderId: woId, stationId, stepSequence: 1, status: "COMPLETED", completedAt: new Date() },
      });
      await tx.workOrderStep.create({
        data: { workOrderId: woId, stationId, stepSequence: 2, status: "SKIPPED" },
      });
    },
  },
  {
    id: "23",
    what: "Kapanmamış kurşun bypass ataması + iş emri COMPLETED (devirde void/repoint unutulmuş)",
    expect: ["23"],
    build: async (tx) => {
      const itemId = await seedItem(tx);
      const stationId = await seedStation(tx, "PROCESS_QC");
      const woId = await seedWo(tx, itemId, { status: "COMPLETED" });
      const step = await tx.workOrderStep.create({
        data: { workOrderId: woId, stationId, stepSequence: 1, status: "COMPLETED", completedAt: new Date() },
      });
      const machine = await tx.machine.create({
        data: { stationId, code: tag("MK"), name: "Sonda Kurşun" },
      });
      const user = await tx.user.create({
        data: { username: tag("USR"), passwordHash: "x", fullName: "Sonda Kullanıcı" },
      });
      await tx.kursunBypassAssignment.create({
        data: {
          workOrderId: woId,
          workOrderStepId: step.id,
          machineId: machine.id,
          assignedById: user.id,
        },
      });
    },
    // NOT: bu sonda §22'yi DOLDURMAZ — WO zaten COMPLETED, §22 yalnız IN_PROGRESS'e bakar.
  },
  {
    id: "24a",
    what: "Fason kalemin tek tam makbuzu iptal edilmiş, top hâlâ AT_SUBCONTRACTOR",
    expect: ["24a"],
    build: async (tx) => {
      const itemId = await seedItem(tx);
      const stationId = await seedStation(tx, "SUBCONTRACTOR");
      const woId = await seedWo(tx, itemId, { status: "IN_PROGRESS" });
      const step = await tx.workOrderStep.create({
        data: { workOrderId: woId, stationId, stepSequence: 1, status: "ACTIVE" },
      });
      const batch = await tx.batch.create({ data: { batchNumber: tag("P"), workOrderId: woId } });
      const sub = await tx.subcontractor.create({ data: { code: tag("FSN"), name: "Sonda Fason" } });
      const roll = await tx.roll.create({
        data: {
          barcode: tag("T"),
          itemId,
          initialQty: 100,
          currentQty: 100,
          status: "AT_SUBCONTRACTOR",
        },
      });
      const dispatch = await tx.subcontractorDispatch.create({
        data: {
          dispatchNo: tag("SD"),
          workOrderId: woId,
          batchId: batch.id,
          stepId: step.id,
          subcontractorId: sub.id,
          totalQty: 100,
        },
      });
      const dItem = await tx.subcontractorDispatchItem.create({
        data: { dispatchId: dispatch.id, rollId: roll.id, dispatchedQty: 100 },
      });
      const receipt = await tx.subcontractorReceipt.create({
        data: {
          receiptNo: tag("SR"),
          workOrderId: woId,
          stepId: step.id,
          subcontractorId: sub.id,
          // Kabul İPTAL edilmiş → kalem yeniden AÇIK; `receipt.cancelledAt` süzgeci
          // olmayan bir predikat kopyası bunu hâlâ "dönmüş" sanar.
          cancelledAt: new Date(),
        },
      });
      await tx.subcontractorReceiptItem.create({
        data: {
          receiptId: receipt.id,
          newRollId: roll.id,
          sourceDispatchItemId: dItem.id,
          isPartial: false,
        },
      });
    },
  },
  {
    id: "24b",
    what: "Doğrudan sevk edilmiş sevkin topu hâlâ AT_SUBCONTRACTOR (çift sayım)",
    expect: ["24b"],
    build: async (tx) => {
      const itemId = await seedItem(tx);
      const stationId = await seedStation(tx, "SUBCONTRACTOR");
      const woId = await seedWo(tx, itemId, { status: "IN_PROGRESS" });
      const step = await tx.workOrderStep.create({
        data: { workOrderId: woId, stationId, stepSequence: 1, status: "ACTIVE" },
      });
      const batch = await tx.batch.create({ data: { batchNumber: tag("P"), workOrderId: woId } });
      const sub = await tx.subcontractor.create({ data: { code: tag("FSN"), name: "Sonda Fason" } });
      const roll = await tx.roll.create({
        data: {
          barcode: tag("T"),
          itemId,
          initialQty: 80,
          currentQty: 80,
          // Doğru akışta burası SUBCONTRACTOR_CONSUMED olurdu — sondanın bozduğu şey bu.
          status: "AT_SUBCONTRACTOR",
        },
      });
      const dispatch = await tx.subcontractorDispatch.create({
        data: {
          dispatchNo: tag("SD"),
          workOrderId: woId,
          batchId: batch.id,
          stepId: step.id,
          subcontractorId: sub.id,
          totalQty: 80,
          directShippedAt: new Date(),
        },
      });
      await tx.subcontractorDispatchItem.create({
        data: { dispatchId: dispatch.id, rollId: roll.id, dispatchedQty: 80 },
      });
    },
  },
  {
    id: "24c",
    what: "Açık+outstanding fason kalemi ama top STOCK'a düşmüş (mal iki yerde)",
    expect: ["24c"],
    build: async (tx) => {
      const itemId = await seedItem(tx);
      const stationId = await seedStation(tx, "SUBCONTRACTOR");
      const woId = await seedWo(tx, itemId, { status: "CANCELLED" });
      const step = await tx.workOrderStep.create({
        data: { workOrderId: woId, stationId, stepSequence: 1, status: "ACTIVE" },
      });
      const batch = await tx.batch.create({ data: { batchNumber: tag("P"), workOrderId: woId } });
      const sub = await tx.subcontractor.create({ data: { code: tag("FSN"), name: "Sonda Fason 24c" } });
      const roll = await tx.roll.create({
        data: {
          barcode: tag("T"),
          itemId,
          initialQty: 100,
          // Kısmi kabul kalıntısı: 51 geldi, 49 fasonda kaldı.
          currentQty: 49,
          // Doğru akışta AT_SUBCONTRACTOR olurdu — sondanın bozduğu şey bu.
          status: "STOCK",
        },
      });
      const dispatch = await tx.subcontractorDispatch.create({
        data: {
          dispatchNo: tag("SD"),
          workOrderId: woId,
          batchId: batch.id,
          stepId: step.id,
          subcontractorId: sub.id,
          totalQty: 100,
          dispatchedAt: new Date(),
        },
      });
      await tx.subcontractorDispatchItem.create({
        data: { dispatchId: dispatch.id, rollId: roll.id, dispatchedQty: 100 },
      });
    },
  },
  {
    id: "24b-altküme",
    what: "Alt kümeyle doğrudan sevk edilmiş top (sevk damgasız) hâlâ AT_SUBCONTRACTOR",
    expect: ["24b"],
    build: async (tx) => {
      await seedSubsetDirectShip(tx, "AT_SUBCONTRACTOR");
    },
  },
  {
    id: "24c-temiz",
    what: "Meşru alt küme doğrudan sevk (top tüketildi, sevk damgasız) HİÇBİR bölümü yakmaz",
    expect: [],
    build: async (tx) => {
      await seedSubsetDirectShip(tx, "SUBCONTRACTOR_CONSUMED");
    },
  },
  {
    id: "25",
    what: "Etiket basıldıktan SONRA kartelalık işareti değişmiş ama labelDirty false kalmış",
    expect: ["25"],
    build: async (tx) => {
      const itemId = await seedItem(tx);
      const printedAt = new Date(Date.now() - 60 * 60 * 1000); // 1 saat önce basıldı
      const roll = await tx.roll.create({
        data: {
          barcode: tag("T"),
          itemId,
          initialQty: 50,
          currentQty: 50,
          status: "WAREHOUSE",
          markedForKartela: true,
          labelDirty: false,
          labelPrintedAt: printedAt,
        },
      });
      await tx.systemLog.create({
        data: {
          action: "UPDATE",
          tableName: "ROLL",
          recordId: roll.id,
          newData: { markedForKartela: true },
          createdAt: new Date(printedAt.getTime() + 60 * 1000), // baskıdan SONRA
        },
      });
    },
  },
  {
    id: "26-kapi-oncesi",
    what: "Plan dışı renk + defterde iz yok, ama kapıdan ÖNCE finalize (saha yedeğindeki 4 satırın şekli)",
    // §26 dolar (bilgi), §26b DOLMAZ — eşiğin gerçekten süzdüğünü kanıtlar.
    expect: ["26"],
    build: async (tx) => {
      await buildPlanDeviationRoll(tx, new Date(PLAN_GATE_SINCE.getTime() - 24 * 60 * 60 * 1000));
    },
  },
  {
    id: "26b",
    what: "Plan dışı renk + defterde iz yok, kapıdan SONRA finalize (kapı atlanmış)",
    expect: ["26", "26b"],
    build: async (tx) => {
      await buildPlanDeviationRoll(tx, new Date(PLAN_GATE_SINCE.getTime() + 24 * 60 * 60 * 1000));
    },
  },
];

/** §26/§26b ortak fixture'ı — Tambur adımında üretilmiş, hedeften farklı renkte depo topu. */
async function buildPlanDeviationRoll(tx: Db, finalizedAt: Date): Promise<void> {
  const itemId = await seedItem(tx);
  const stationId = await seedStation(tx, "TAMBUR");
  const planColor = await tx.color.create({ data: { code: tag("CP"), name: "Sonda Plan Rengi" } });
  const realColor = await tx.color.create({ data: { code: tag("CR"), name: "Sonda Gerçek Renk" } });
  const woId = await seedWo(tx, itemId, { status: "IN_PROGRESS", targetColorId: planColor.id });
  const step = await tx.workOrderStep.create({
    data: { workOrderId: woId, stationId, stepSequence: 1, status: "ACTIVE" },
  });
  await tx.roll.create({
    data: {
      barcode: tag("T"),
      itemId,
      colorId: realColor.id,
      initialQty: 120,
      currentQty: 120,
      status: "WAREHOUSE",
      producedInStepId: step.id,
      // Trigger (`roll_stamp_production_timestamps`) INSERT dalında yalnız NULL ise
      // damgalar → açıkça verdiğimiz an KORUNUR. §26b eşiğini bu yüzden sürebiliyoruz.
      finalizedAt,
    },
  });
}

/**
 * Sonda fixture'ı yazılamadığında SEBEBİ söyle — ve bunu asla "atla"ya çevirme.
 *
 * En sık sebep bir bekçi hatası değil ORTAM hatasıdır: hedef DB'nin şeması repo'nun
 * GERİSİNDEDİR (ör. saha yedeği kopyası bekleyen migration taşır → `rolls.entryReasonCode`
 * yok). O durumda sondayı sessizce atlamak, tam da bu dosyanın önlemek için var olduğu
 * şeyi yapardı: "hiçbir şeye bakılmadı" ile "sorun yok" aynı yeşile çıkardı. Bu yüzden
 * KIRMIZI kalır, yalnız mesaj yol gösterir.
 */
function describeProbeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const schemaBehind =
    /does not exist in the current database|column .* does not exist|relation .* does not exist/i.test(msg);
  return schemaBehind
    ? `${msg}\n      ↳ DB şeması repo'nun GERİSİNDE olabilir — 'npx prisma migrate status' ile bak. ` +
        `Sonda fixture'ı güncel şema ister; SALT-OKUNUR kapı (sondasız koşum) eski şemada da çalışır.`
    : msg;
}

async function runProbes(): Promise<void> {
  console.log("\n=== NEGATİF SONDALAR (--probe) — her fixture geri alınan bir tx içinde ===");
  console.log(`Fixture öneki: TEST-CD-…-${SUF} · hiçbir satır COMMIT EDİLMEZ\n`);

  for (const p of PROBES) {
    const before = new Map<string, number>();
    const after = new Map<string, number>();
    try {
      await prisma.$transaction(
        async (tx) => {
          for (const s of SECTIONS) before.set(s.id, await driftCount(s, tx));
          await p.build(tx);
          for (const s of SECTIONS) after.set(s.id, await driftCount(s, tx));
          throw ROLLBACK; // tek çıkış: hiçbir şey commit edilmesin
        },
        { timeout: 120_000, maxWait: 20_000 }
      );
    } catch (e) {
      if (e !== ROLLBACK) {
        check(`sonda §${p.id} — ${p.what}`, false, `FIXTURE HATASI: ${describeProbeError(e)}`);
        continue;
      }
    }

    const lit = SECTIONS.filter((s) => (after.get(s.id) ?? 0) > (before.get(s.id) ?? 0)).map((s) => s.id);
    const eksik = p.expect.filter((id) => !lit.includes(id));
    const fazla = lit.filter((id) => !p.expect.includes(id));
    check(
      `sonda §${p.id} — ${p.what}`,
      eksik.length === 0 && fazla.length === 0,
      eksik.length === 0 && fazla.length === 0
        ? `bölüm(ler) ${lit.join(", ")} kırmızıya döndü, diğerleri etkilenmedi`
        : `beklenen ${p.expect.join(", ")} · yanan ${lit.join(", ") || "(hiçbiri)"}` +
            (eksik.length ? ` · YANMAYAN ${eksik.join(", ")}` : "") +
            (fazla.length ? ` · FAZLADAN yanan ${fazla.join(", ")}` : "")
    );
  }

  // ── Gürültü filtresinin BEDELİ (notFixture'ın tek meşru kullanımı) ──────────
  // §21'e "TEST- önekli iş emirlerini ele" filtresi eklenseydi, yukarıdaki §21
  // sondası kendi drift'ini GÖREMEZDİ — yani bekçi kendi negatif sondasına
  // kör olurdu. Bu, "filtre yalnız ölçülmüş gürültü için eklenir" kuralının
  // somut bedelidir; ölçüm 0 olduğu sürece filtre EKLENMEZ.
  const s21 = SECTIONS.find((s) => s.id === "21");
  if (!s21) {
    check("gürültü filtresi bedeli — §21 bölümü bulundu", false);
  } else {
    let gorulen = 0;
    let filtreli = 0;
    try {
      await prisma.$transaction(
        async (tx) => {
          await PROBES[0].build(tx);
          gorulen = await driftCount(s21, tx);
          filtreli = await driftCount(
            { ...s21, noise: { where: `WHERE ${notFixture(`drift."workOrderNumber"`)}`, why: "sonda" } },
            tx
          );
          throw ROLLBACK;
        },
        { timeout: 120_000, maxWait: 20_000 }
      );
    } catch (e) {
      if (e !== ROLLBACK) {
        check("gürültü filtresi bedeli (§21)", false, e instanceof Error ? e.message : String(e));
        return;
      }
    }
    check(
      "gürültü filtresi bedeli (§21): fixture filtresi eklenseydi sonda KÖR kalırdı",
      gorulen > filtreli,
      `filtresiz ${gorulen} satır · TEST- filtreli ${filtreli} satır`
    );
  }
}

async function main(): Promise<void> {
  await runGate();
  if (PROBE) await runProbes();
  else
    console.log(
      "\n(Negatif sondalar KAPALI — bekçinin vakumen yeşil olmadığını kanıtlamak için:\n" +
        " npx tsx scripts/test_consistency_derived.ts --probe)"
    );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) {
    console.log(
      "\nDÜŞTÜYSE: türetilmiş bir alan kaynağından kopmuş. ÖNCE hangi kod yolunun\n" +
        "ürettiğini bul — geçmiş satırları toplu UPDATE ile 'düzeltmek' kök nedeni\n" +
        "gizler ve drift geri gelir (§21 için hazır onarım: dry-run varsayılanlı\n" +
        "scripts/fix_workorder_type_from_links.ts).\n" +
        "Aynı sorguları elle koşmak için: psql <db> -f scripts/consistency-check-derived.sql"
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
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
