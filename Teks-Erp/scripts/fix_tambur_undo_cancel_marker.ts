// =============================================================================
// ONARIM — Tambur geri almasıyla iptal edilmiş ESKİ parçaları damgala (T1-011)
// =============================================================================
// KURU KOŞUM VARSAYILAN. Yazmak için: --apply
//   npx tsx scripts/fix_tambur_undo_cancel_marker.ts            # yalnız rapor
//   npx tsx scripts/fix_tambur_undo_cancel_marker.ts --apply    # yazar
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
import { TAMBUR_UNDO_CANCEL_CODE, TAMBUR_UNDO_CANCEL_TEXT } from "../src/constants/reason-presets";

const APPLY = process.argv.includes("--apply");

type Aday = {
  id: string;
  barcode: string | null;
  currentQty: unknown;
  initialQty: unknown;
  cancelledAt: Date | null;
  parentBarcode: string | null;
};

async function main(): Promise<void> {
  console.log(`\n=== Tambur geri alması izi — ${APPLY ? "UYGULAMA" : "KURU KOŞUM"} ===\n`);

  // Audit'te "bu parçayı geri alma iptal etti" diyen olaylar.
  const adaylar = await prisma.$queryRaw<Aday[]>`
    WITH undo AS (
      SELECT DISTINCT ("newData" ->> 'cancelledChildId')::uuid AS child
      FROM system_logs
      WHERE "newData" ->> 'event' LIKE 'TAMBUR_UNDO%'
        AND "newData" ? 'cancelledChildId'
      UNION
      SELECT DISTINCT jsonb_array_elements_text("newData" -> 'cancelledChildIds')::uuid
      FROM system_logs
      WHERE "newData" ->> 'event' LIKE 'TAMBUR_UNDO%'
        AND "newData" ? 'cancelledChildIds'
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
    console.log("KURU KOŞUM — hiçbir şey yazılmadı. Yazmak için: --apply\n");
    return;
  }

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
