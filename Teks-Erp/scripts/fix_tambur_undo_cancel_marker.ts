// =============================================================================
// ONARIM — Tambur geri almasıyla iptal edilmiş ESKİ parçaları damgala (T1-011)
// =============================================================================
// KURU KOŞUM VARSAYILAN. Yazmak için iki teyit:
//   npx tsx scripts/fix_tambur_undo_cancel_marker.ts                                  # yalnız rapor
//   npx tsx scripts/fix_tambur_undo_cancel_marker.ts --apply --onay=<N> --hedef=<db>  # yazar
//
// ⚠️ DURUM: KULLANICI KARARI 2026-09-26 (K-A2 = a) — YAYIN GÜNÜ BİR KEZ KOŞULUR.
// Geri alma kapısının audit'e bakan dalı kaldırıldı (audit yalnız ayak izidir);
// eski damgasız parçaların TEK koruması artık bu araçla yazılan iz. Sıra: bu araç
// (kuru → onay → --apply) yeni backend'den ÖNCE ya da aynı pencerede koşulur —
// aksi hâlde aradaki sürede o parçalar diriltilebilir. Bir kez aktaran göç
// istisnası: `scripts/lib/audit-okuma-beyan.ts` AUDIT_GOC_ISTISNALARI.
//
// NEDEN GEREKLİ
// 2026-08-29'dan itibaren Tambur geri alması iptal ettiği parçaya iki şey
// yazıyor: `cancelReasonCode = TAMBUR_GERI_ALMA` (iz) ve `currentQty = 0`
// (metraj kaynak topa iade edildi). Geri alma kapısı bu ize bakıp diriltmeyi
// reddediyor.
//
// ⚠️ O TARİHTEN ÖNCEKİ kayıtlarda iz YOK ve satırdan ayırt edilemiyorlar
// (ölçüldü: saha kopyasında 88 iptal kesim parçasının HİÇBİRİNDE sebep kodu ya
// da metni yok). Onları tanıyan tek kaynak AUDIT — ve audit 6 ayda arşivleniyor,
// yani bu pencere KAPANIYOR. Bu araç, audit hâlâ dururken izi satıra taşır.
//
// ⚠️ NEDEN OTOMATİK DEĞİL: bu bir VERİ YAZIMIDIR ve prod canlıdır. Kuru koşum
// etkilenecek HER kaydı somut listeler; `--apply` öncesi o listeyi okuyun.
// Geri alma: damgalanan id listesiyle `cancelReasonCode = NULL` + metrajı eski
// değerine geri yaz (rapor bunu da basar).
//
// ⚠️ NE YAPMAZ: metrajı SIFIRLAMAZ. Sıfırlamak "bu parça artık 40 m değil"
// demektir ve eski kayıtlarda kaynak topun metrajının gerçekten iade edilip
// edilmediğini buradan DOĞRULAYAMAYIZ (kaynak top sonradan kesilmiş/sevk
// edilmiş olabilir). İz yeterlidir: kapı diriltmeyi zaten reddeder. Metraj
// düzeltmesi istenirse AYRI bir karar ve ayrı bir turdur.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { RollStatus } from "@prisma/client";
import { hedefDbAdi } from "./lib/hedef-db-kapisi";
import { TAMBUR_UNDO_CANCEL_CODE, TAMBUR_UNDO_CANCEL_TEXT } from "../src/constants/reason-presets";
import { izDustuUyarisi, onarimIziYaz } from "./lib/onarim-izi";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const ONAY = Number((argv.find((a) => a.startsWith("--onay=")) ?? "").split("=")[1] ?? NaN);
const HEDEF = (argv.find((a) => a.startsWith("--hedef=")) ?? "").split("=")[1] ?? "";

type Aday = {
  id: string;
  barcode: string | null;
  currentQty: unknown;
  initialQty: unknown;
  cancelledAt: Date | null;
  parentBarcode: string | null;
};

async function main(): Promise<void> {
  const db = hedefDbAdi();
  console.log(`\n=== Tambur geri alması izi — ${APPLY ? `UYGULAMA (onay=${ONAY}, hedef=${HEDEF})` : "KURU KOŞUM"} ===`);
  console.log(`HEDEF VERİTABANI: ${db}\n`);

  // Audit'te (sıcak ∪ arşiv) "bu parçayı geri alma iptal etti" diyen olaylar.
  const adaylar = await prisma.$queryRaw<Aday[]>`
    WITH olay AS (
      SELECT "newData" FROM system_logs WHERE starts_with("newData" ->> 'event', 'TAMBUR_UNDO')
      UNION ALL
      SELECT "newData" FROM system_log_archives WHERE starts_with("newData" ->> 'event', 'TAMBUR_UNDO')
    ), undo AS (
      SELECT DISTINCT ("newData" ->> 'cancelledChildId')::uuid AS child FROM olay WHERE "newData" ? 'cancelledChildId'
      UNION
      SELECT DISTINCT jsonb_array_elements_text("newData" -> 'cancelledChildIds')::uuid FROM olay WHERE "newData" ? 'cancelledChildIds'
    )
    SELECT r.id, r.barcode, r."currentQty", r."initialQty", r."cancelledAt",
           p.barcode AS "parentBarcode"
    FROM rolls r
    LEFT JOIN rolls p ON p.id = r."parentRollId"
    WHERE r.id IN (SELECT child FROM undo)
      AND r.status = ${RollStatus.CANCELLED}::"RollStatus"
      AND r."cancelReasonCode" IS DISTINCT FROM ${TAMBUR_UNDO_CANCEL_CODE}
    ORDER BY r."cancelledAt"
  `;

  if (adaylar.length === 0) {
    console.log("Damgalanacak kayıt yok — ya hepsi damgalı ya da audit penceresi kapanmış.");
    console.log("⚠️ İkisi FARKLI: audit arşivlendiyse bu araç artık hiçbir şey bulamaz.\n");
    return;
  }

  let toplam = 0;
  console.log(`${adaylar.length} kayıt damgalanacak:\n`);
  console.log("  barkod            kaynak top        metraj   iptal tarihi");
  console.log("  ────────────────  ────────────────  ───────  ────────────");
  for (const a of adaylar) {
    const q = Number(a.currentQty);
    toplam += q;
    console.log(
      `  ${(a.barcode ?? "(barkodsuz)").padEnd(16)}  ${(a.parentBarcode ?? "—").padEnd(16)}  ` +
        `${q.toFixed(1).padStart(7)}  ${a.cancelledAt?.toISOString().slice(0, 10) ?? "—"}`,
    );
  }
  console.log(
    `\n  TOPLAM: ${adaylar.length} parça · ${toplam.toFixed(1)} m diriltilmeye açık metraj\n`,
  );

  if (!APPLY) {
    console.log(`KURU KOŞUM — hiçbir şey yazılmadı. Yazmak için (kullanıcı onayıyla):\n  npx tsx scripts/fix_tambur_undo_cancel_marker.ts --apply --onay=${adaylar.length} --hedef=${db}\n`);
    return;
  }
  if (!HEDEF || HEDEF !== db) { console.error(`❌ --hedef=${HEDEF || "(yok)"} ≠ çözülen veritabanı "${db}". Yazma YOK.`); process.exitCode = 1; return; }
  if (!Number.isFinite(ONAY) || ONAY !== adaylar.length) { console.error(`❌ ONAY UYUŞMUYOR: kuru koşum ${adaylar.length} parça, --onay=${ONAY}. Yazma YOK.`); process.exitCode = 1; return; }

  const res = await prisma.roll.updateMany({
    where: {
      id: { in: adaylar.map((a) => a.id) },
      status: RollStatus.CANCELLED,
      // Yarış koruması: arada biri diriltmiş/değiştirmişse dokunma.
      cancelReasonCode: null,
    },
    data: { cancelReasonCode: TAMBUR_UNDO_CANCEL_CODE, cancelReason: TAMBUR_UNDO_CANCEL_TEXT },
  });
  console.log(`✅ ${res.count} kayıt damgalandı (aday ${adaylar.length}).`);
  if (res.count !== adaylar.length) {
    console.log(
      `⚠️ ${adaylar.length - res.count} kayıt atlandı — arada statüsü ya da sebebi değişmiş olabilir.`,
    );
  }
  console.log(
    `\nGeri alma: UPDATE rolls SET "cancelReasonCode"=NULL, "cancelReason"=NULL ` +
      `WHERE id IN (yukarıdaki id listesi);\n`,
  );

  const SCRIPT = "scripts/fix_tambur_undo_cancel_marker.ts";
  const yazildi = await onarimIziYaz({
    script: SCRIPT,
    action: "TAMBUR_UNDO_CANCEL_MARKER_BACKFILL",
    tableName: "ROLL",
    olcum: {
      damgalanan: res.count,
      aday: adaylar.length,
      atlanan: adaylar.length - res.count,
      sebepKodu: TAMBUR_UNDO_CANCEL_CODE,
      acilanMetraj: Number(toplam.toFixed(1)),
    },
  });
  if (!yazildi) {
    console.error(izDustuUyarisi(SCRIPT, false));
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
