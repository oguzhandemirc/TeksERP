// =============================================================================
// Tespit: ÖLÜ ETİKET — kaydı ölmüş ama kâğıdı sahada duran toplar. SALT OKUNUR
// Çalıştır: npx tsx scripts/find_dead_labels.ts                 (son 90 gün)
//           npx tsx scripts/find_dead_labels.ts --days=365
//           npx tsx scripts/find_dead_labels.ts --all            (tarih sınırı yok)
//           npx tsx scripts/find_dead_labels.ts --csv            (makine okunur)
//           DATABASE_URL=<başka db> npx tsx scripts/find_dead_labels.ts
// =============================================================================
// ⚠️ BU SCRIPT HİÇBİR ŞEY YAZMAZ. `--apply` YOKTUR. Ne yapılacağına çıktıya
// bakılarak AYRICA karar verilir (canlı veri kuralı).
//
// SAHA VAKASI (2026-08-05): T050826H0033, 10:48:30'da KK1'de basıldı ve etiketi
// topa yapıştı; 10:56:02'de aynı operatör kaydı iptal etti. Kâğıt topun üstünde
// KALDI. Saatler sonra aynı fiziksel top ikinci bir kayıtla (T050826H0072)
// yeniden girildi ve boyahaneye gitti — bir top, iki etiket, biri ölü. Ölü
// etiket okutulduğunda sistem yalnız "stokta değil" diyordu.
//
// ARADIĞI DESEN: `labelPrintedAt IS NOT NULL` (kâğıt fiziksel olarak ÇIKTI)
// **VE** statü ölü kümesinde. İkisi birden = sahada dolaşan geçersiz kimlik.
//
// ⚠️ `labelPrintedAt` 2026-08-05 migration'ıyla geldi; ondan ÖNCE basılmış
// etiketler bu kolonu TAŞIMAZ ve script onları GÖREMEZ. Geçmişi taramak için
// audit'e (`LABEL_PRINT_EVENT`) düşülür — ama o kayıtlar `archive-scheduler`
// tarafından 6 ayda bir arşive taşınır, yani tarama penceresi de sınırlıdır.
// `--legacy` bayrağı audit yolunu da dener ve bulduğunu AYRI listeler (kolon
// verisi kadar güvenilir değildir, çünkü arşivlenmiş satırlar eksiktir).
// =============================================================================

import { RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { FACTORY_TIMEZONE } from "../src/constants/time";

function numArg(name: string, dflt: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  const v = Number(hit.split("=")[1]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}
const has = (f: string) => process.argv.includes(`--${f}`);

const DAYS = numArg("days", 90);
const ALL = has("all");
const CSV = has("csv");
const LEGACY = has("legacy");

/**
 * "Kaydı ölü" statüler — kâğıdın artık hiçbir yerde kabul edilmeyeceği durumlar.
 *
 * ⚠️ `SHIPPED` BURADA YOK ve bu bilinçli: sevk edilmiş topun etiketi geçerlidir,
 * müşteriye onunla gitti. `SCRAP` da YOK — fire gerçek bir karardır ve etiket o
 * kararın kâğıt izidir; topu çöpe atarken etiketi de gider.
 *
 * `*_CONSUMED` kümesi ise tam olarak bu sorunun ikinci yüzüdür: fason kabulünde
 * orijinal top emekliye ayrılır ve YERİNE yeni toplar doğar — orijinalin etiketi
 * fiziksel olarak balyanın üstünde kalmaya devam eder.
 */
const DEAD_STATUSES: RollStatus[] = [
  RollStatus.CANCELLED,
  RollStatus.SUBCONTRACTOR_CONSUMED,
  RollStatus.KARTELA_CONSUMED,
  RollStatus.TAMBUR_CONSUMED,
];

function fmt(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("tr-TR", {
    timeZone: FACTORY_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function main(): Promise<void> {
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

  const rows = await prisma.roll.findMany({
    where: {
      labelPrintedAt: ALL ? { not: null } : { not: null, gte: since },
      status: { in: DEAD_STATUSES },
    },
    orderBy: { labelPrintedAt: "desc" },
    select: {
      barcode: true,
      status: true,
      currentQty: true,
      labelPrintedAt: true,
      cancelledAt: true,
      cancelReason: true,
      item: { select: { name: true } },
      color: { select: { name: true } },
      cancelledBy: { select: { username: true, fullName: true } },
    },
  });

  if (CSV) {
    console.log("barkod,statu,kumas,renk,metraj,etiket_basildi,iptal_edildi,iptal_eden,sebep");
    for (const r of rows) {
      console.log(
        [
          r.barcode ?? "",
          r.status,
          r.item?.name ?? "",
          r.color?.name ?? "",
          String(r.currentQty),
          r.labelPrintedAt?.toISOString() ?? "",
          r.cancelledAt?.toISOString() ?? "",
          r.cancelledBy?.username ?? "",
          (r.cancelReason ?? "").replace(/[\n,]/g, " "),
        ].join(","),
      );
    }
  } else {
    console.log("=== ÖLÜ ETİKET TARAMASI (salt okunur) ===");
    console.log(
      ALL ? "Kapsam: tüm zamanlar" : `Kapsam: son ${DAYS} gün (etiket baskı tarihine göre)`,
    );
    console.log(
      "Aranan: etiketi BASILMIŞ + kaydı ölü (iptal / fasonda-kartelada-tamburda tüketilmiş)\n",
    );
    if (rows.length === 0) {
      console.log("✅ Kayıt bulunamadı — bu pencerede sahada ölü etiket izi yok.");
    } else {
      for (const r of rows) {
        const who = r.cancelledBy?.fullName ?? r.cancelledBy?.username ?? "—";
        console.log(
          `${(r.barcode ?? "(barkodsuz)").padEnd(14)} ${r.status.padEnd(24)} ` +
            `${(r.item?.name ?? "-").padEnd(20)} ${String(r.currentQty).padStart(8)} m  ` +
            `etiket ${fmt(r.labelPrintedAt)}  ölüm ${fmt(r.cancelledAt)}  ${who}`,
        );
        if (r.cancelReason) console.log(`${" ".repeat(15)}↳ sebep: ${r.cancelReason}`);
      }
      console.log(
        `\n⚠️ ${rows.length} kayıt — bu etiketler fiziksel olarak toplarda DURUYOR olabilir.\n` +
          "Yapılacak: sahada bul → etiketi SÖK. Kayıt hâlâ geri alınabilir durumdaysa\n" +
          "(hareketsiz/partisiz) topu yeniden girmek yerine iptali GERİ AL — yoksa aynı\n" +
          "fiziksel top için ikinci bir barkod doğar.",
      );
    }
  }

  if (LEGACY) {
    // Kolon öncesi dönem — audit'ten. Eksik olabilir (arşivleme), o yüzden AYRI başlık.
    const printed = await prisma.systemLog.findMany({
      where: { tableName: "LABEL_PRINT_EVENT" },
      select: { recordId: true },
    });
    const ids = [...new Set(printed.map((p) => p.recordId).filter((x): x is string => !!x))];
    const legacyRows = ids.length
      ? await prisma.roll.findMany({
          where: { id: { in: ids }, labelPrintedAt: null, status: { in: DEAD_STATUSES } },
          select: { barcode: true, status: true, item: { select: { name: true } }, currentQty: true },
        })
      : [];
    console.log(
      `\n=== KOLON ÖNCESİ (audit izinden, EKSİK OLABİLİR) — ${legacyRows.length} kayıt ===`,
    );
    for (const r of legacyRows) {
      console.log(
        `${(r.barcode ?? "(barkodsuz)").padEnd(14)} ${r.status.padEnd(24)} ` +
          `${(r.item?.name ?? "-").padEnd(20)} ${String(r.currentQty).padStart(8)} m`,
      );
    }
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});
