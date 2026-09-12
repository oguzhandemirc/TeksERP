// =============================================================================
// DÜZELTME — Depoda duran ESKİ fire toplarını SCRAP'e çek (2026-08-20)
// =============================================================================
// Çalıştır (ÖNİZLEME — hiçbir şey yazmaz):
//   npx tsx scripts/fix_fire_rolls_to_scrap.ts
// Uygula:
//   npx tsx scripts/fix_fire_rolls_to_scrap.ts --apply
//
// DRY-RUN VARSAYILAN (kök CLAUDE.md: toplu veri düzeltmesi yapan script dry-run
// başlar ve `--apply` öncesi etkilenecek HER kaydı somut listeler).
//
// -----------------------------------------------------------------------------
// NEDEN
// -----------------------------------------------------------------------------
// Fabrika kuralı: "fire çöpe gider, A1 satılabilir." Sistem bunun tersini
// yapıyordu — üç kalitenin de `targetStatus`'ı WAREHOUSE'du, yani fire kalitesi
// verilen top SATILABİLİR stoka iniyordu.
//
// Koruma VARDI ama fire ona hiç ULAŞMIYORDU: `SACK_ABSENT_STATUSES` `SCRAP`'ı
// çuvala okutulamaz sayar; çuval guard'ı kaliteye BİLEREK bakmaz ("Kalite/
// bitmişlik GATE'i YOK — yalnız FİZİKSEL İMKÂNSIZ durumlar bloklu"). Fire top
// WAREHOUSE doğduğu için barkodu okutulunca çuvala giriyor ve müşteriye SEVK
// EDİLEBİLİYORDU.
//
// `20260820030000_fire_grade_targets_scrap` bunu KAYNAĞINDA düzeltti (FIRE →
// SCRAP) ama yalnız YENİ kesimler için. Bu script geçmişte doğmuş, hâlâ
// satılabilir statüde duran fire toplarını onarır.
//
// -----------------------------------------------------------------------------
// KAPSAM / GÜVENLİK
// -----------------------------------------------------------------------------
//  • Yalnız kalitesi `skipLabel = true` (sahada FİRE) VE statüsü satılabilir
//    olan toplar: WAREHOUSE / A1_STOCK / STOCK.
//    ⚠️ Kalite KODU aranmaz, katalog işareti okunur — kod fabrikaya açık bir
//    alan; `code = "FIRE"` yazan bir script kod değişince sessizce hiçbir şey
//    yapmaz hale gelirdi.
//  • ÇUVALA KONMUŞ / SEVKİYATA BAĞLI toplar DIŞARIDA (`sackId`/`shipmentId`
//    dolu). Onlar fiziksel olarak akışın içinde; statülerini tek taraflı
//    değiştirmek çuval sayımını ve donmuş belgeleri bozar — o durum ayrı bir
//    karardır (önce çuvaldan çıkar, sonra bu script).
//  • İşlemde/dışarıda olanlar zaten kapsam dışı (IN_PRODUCTION, AT_SUBCONTRACTOR
//    vb. listelenmez) — mal bir istasyonda ya da fasonda olabilir.
//  • İdempotent: ikinci koşumda etkilenen satır 0'dır.
//  • Her yazım audit'e düşer (`event: FIRE_GRADE_TO_SCRAP`, kaynak bu dosya) —
//    sessiz UPDATE YAPILMAZ; "bu top depodan neden düştü" sorusu sonradan
//    cevaplanabilmeli.
//    ⚠️ `RollMovement` YAZILMAZ ve bu bilinçli: o tablonun `workOrderStepId`
//    alanı ZORUNLUDUR (hareket bir istasyon adımına aittir), bu toplar ise
//    finalize edilmiş — adımları yok. WO kapanış dispozisyonunun movement
//    yazabilmesinin sebebi topların HÂLÂ bir adımda olmasıdır; buradaki durum
//    farklı. Uydurma bir adım referansı iliştirmek istasyon raporlarını
//    kirletirdi. İz audit'te.
//  • Metraja DOKUNULMAZ: `currentQty` olduğu gibi kalır. Fire kararı malın
//    nerede durduğunu değiştirir, ne kadar olduğunu değil (fire karnesi
//    metrajdan okur).
// =============================================================================

import prisma, { pool } from "../src/lib/prisma";
import { RollStatus } from "@prisma/client";
import { AuditService } from "../src/services/audit.service";
import { FACTORY_TIMEZONE } from "../src/constants/time";
import { hedefDbAdi } from "./lib/hedef-db-kapisi";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
/** KAPI (2026-09-12): `--apply` sayıyı `--onay=<N>` ve hedef DB adını `--hedef=<db>` ile teyit ettirir
 *  (dört veri operasyonunun ortak sözleşmesi — kas hafızası tek tip); başlık DB adı + host basar. */
const HEDEF = (argv.find((a) => a.startsWith("--hedef=")) ?? "").split("=")[1] ?? "";
const ONAY = Number((argv.find((a) => a.startsWith("--onay=")) ?? "").split("=")[1] ?? NaN);
function dbHost(): string {
  try { const u = new URL(process.env.DATABASE_URL ?? ""); return `${u.hostname}:${u.port || "5432"}`; } catch { return "(okunamadı)"; }
}

/** Satılabilir sayılan statüler — bu script yalnız BUNLARI çeker. */
const SELLABLE: RollStatus[] = [RollStatus.WAREHOUSE, RollStatus.A1_STOCK, RollStatus.STOCK];

const fmt = (d: Date | null | undefined): string =>
  d
    ? d.toLocaleString("tr-TR", { timeZone: FACTORY_TIMEZONE, dateStyle: "short", timeStyle: "short" })
    : "—";

async function main(): Promise<void> {
  const db = hedefDbAdi();
  console.log(
    APPLY
      ? `⚠️  --apply: değişiklikler YAZILACAK (hedef=${HEDEF})`
      : "ÖNİZLEME (dry-run) — hiçbir şey yazılmaz; uygulamak için --apply --hedef=<db-adı>",
  );
  console.log(`HEDEF VERİTABANI: ${db} @ ${dbHost()}`);

  const skipGrades = await prisma.qualityGrade.findMany({
    where: { skipLabel: true },
    select: { id: true, code: true, name: true },
  });
  if (skipGrades.length === 0) {
    console.log(
      "\n⚠️  Kataloğda `skipLabel = true` kalite YOK — migration uygulanmamış olabilir.\n" +
        "   Bu script kaliteyi KOD ile aramaz (bilinçli); önce işareti ver, sonra koş.",
    );
    return;
  }
  console.log(
    `\nFire sayılan kalite(ler): ${skipGrades.map((g) => `${g.code} (${g.name})`).join(", ")}`,
  );

  const candidates = await prisma.roll.findMany({
    where: {
      qualityGradeId: { in: skipGrades.map((g) => g.id) },
      status: { in: SELLABLE },
      // Çuvalda / sevkiyatta olan topa DOKUNMA (bkz. dosya başlığı).
      sackId: null,
      shipmentId: null,
    },
    select: {
      id: true,
      barcode: true,
      status: true,
      currentQty: true,
      createdAt: true,
      updatedAt: true,
      item: { select: { name: true } },
      color: { select: { name: true } },
      qualityGradeRef: { select: { code: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Kapsam dışında bırakılanları da SAY ve söyle — "hepsi düzeldi" yanılgısı
  // üretmemek için (sessiz kapsam daralması, bu repoda tekrarlayan bir hata sınıfı).
  const excluded = await prisma.roll.count({
    where: {
      qualityGradeId: { in: skipGrades.map((g) => g.id) },
      status: { in: SELLABLE },
      OR: [{ sackId: { not: null } }, { shipmentId: { not: null } }],
    },
  });

  if (candidates.length === 0) {
    console.log("\n✅ Satılabilir statüde serbest fire top yok — düzeltilecek kayıt bulunamadı.");
  } else {
    console.log(`\n${candidates.length} fire top satılabilir statüde duruyor:\n`);
    console.log(["Barkod", "Kalite", "Durum", "Metraj", "Ürün", "Renk", "Oluşma", "Son işlem"].join("\t"));
    for (const r of candidates) {
      console.log(
        [
          r.barcode ?? "(barkodsuz)",
          r.qualityGradeRef?.code ?? "—",
          r.status,
          `${Number(r.currentQty).toFixed(1)} m`,
          r.item?.name ?? "—",
          r.color?.name ?? "—",
          fmt(r.createdAt),
          fmt(r.updatedAt),
        ].join("\t"),
      );
    }
    const total = candidates.reduce((a, r) => a + Number(r.currentQty), 0);
    console.log(`\nToplam: ${candidates.length} top · ${total.toFixed(1)} m`);
  }

  if (excluded > 0) {
    console.log(
      `\n⚠️  KAPSAM DIŞI: ${excluded} fire top çuvalda/sevkiyatta olduğu için DOKUNULMADI.\n` +
        "   Bunlar fiziksel olarak akışın içinde — önce çuvaldan çıkarılmalı, sonra bu script.",
    );
  }

  if (candidates.length === 0) return;

  if (!APPLY) {
    console.log(`\nÖNİZLEME bitti — ${candidates.length} top SCRAP'e çekilecek. Yazmak için (sayı ve HEDEF adı birebir):\n  npx tsx scripts/fix_fire_rolls_to_scrap.ts --apply --onay=${candidates.length} --hedef=${db}`);
    return;
  }
  if (!HEDEF || HEDEF !== db) {
    console.error(`❌ --hedef=${HEDEF || "(yok)"} ≠ çözülen veritabanı "${db}". Yazma YOK.`);
    process.exitCode = 1;
    return;
  }
  if (!Number.isFinite(ONAY) || ONAY !== candidates.length) {
    console.error(`❌ ONAY UYUŞMUYOR: önizleme ${candidates.length} top, --onay=${ONAY}. Yazma YOK.`);
    process.exitCode = 1;
    return;
  }

  let updated = 0;
  for (const r of candidates) {
    // Atomik claim: bu arada top başka bir akışa girdiyse (çuval/sevkiyat/statü)
    // dokunmayız ve iz de bırakmayız.
    const claimed = await prisma.roll.updateMany({
      where: { id: r.id, status: r.status, sackId: null, shipmentId: null },
      data: { status: RollStatus.SCRAP },
    });
    if (claimed.count === 0) {
      console.log(`   ⏭  ${r.barcode ?? r.id} — araya başka bir işlem girdi, atlandı`);
      continue;
    }
    updated++;

    await AuditService.log({
      userId: undefined, // script koşumu — kaynak newData.source'ta
      action: "UPDATE",
      tableName: "ROLL",
      recordId: r.id,
      oldData: { status: r.status },
      newData: {
        status: RollStatus.SCRAP,
        event: "FIRE_GRADE_TO_SCRAP",
        qualityGrade: r.qualityGradeRef?.code ?? null,
        source: "scripts/fix_fire_rolls_to_scrap.ts",
      },
    });
    console.log(`   ✔ ${r.barcode ?? r.id} — ${r.status} → SCRAP`);
  }

  console.log(`\n✅ ${updated} top SCRAP'e çekildi (${candidates.length} adaydan).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
