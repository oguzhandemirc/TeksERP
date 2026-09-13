// =============================================================================
// Bekçi: üretim hattı yüklemi + DB alt sınırı (dokuma P4b, 2026-09-13)
// Çalıştır: npx tsx scripts/run-all-tests.ts production_line
// =============================================================================
// NE ÖLÇÜYOR — ve bu KASITLI olarak DAVRANIŞTIR, VARLIK DEĞİL:
//   §1 YÜKLEM   `assertProductionLineValid` doğru cevabı veriyor mu (kabul + üç
//               ayrı red dalı + sınır değerleri). ⛔ "fonksiyon export ediliyor mu"
//               diye BİR kontrol bile yok: varlık ölçmek, yanlış yazılmış bir
//               yüklemi yeşil geçirir.
//   §2 DB       `machines_productionLineCount_pos` ALT sınırı gerçekten tutuyor
//               mu (yüklemin ikizi; ikisi ayrı hatlardır ve ayrı ölçülür).
//   §3 VARSAYILAN  Var olan her makine `productionLineCount = 1` ile yaşıyor mu
//               — "sıfır fark" iddiasının ölçümü.
//
//   §4 ÇAĞRI    yüklem koşum açan YOLDAN çağrılıyor mu — `openMachineRun` ile
//               3. hat 2 hatlı makinede 400 alıyor mu. (P4b borcu 2026-09-13'te
//               P2b yazma yüzeyiyle kapandı: "yüklem var, çağrı yok" → var.)
//
// ⚠️ DB'ye YAZAR (§2/§3 fikstürü) → `hedefDbEngeli()` ilk adımdır.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { assertProductionLineValid } from "../src/services/helpers/production-line.helper";
import { openMachineRun } from "../src/services/machine-run.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

/** Yüklemi çağırır ve SONUCU döndürür — fırlatma bir sonuçtur, çökme değil. */
function dene(no: number, count: number): { kabul: boolean; kod: string | null } {
  try {
    assertProductionLineValid(no, count);
    return { kabul: true, kod: null };
  } catch (e) {
    const kod =
      e instanceof AppError
        ? String((e.details as { code?: string } | undefined)?.code ?? "KODSUZ")
        : "APPERROR-DEGIL";
    return { kabul: false, kod };
  }
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(1);
  }

  // ── §1 YÜKLEMİN DAVRANIŞI ────────────────────────────────────────────────
  // Kabul dalı ÖNCE: hepsi reddeden bozuk bir yüklem de tüm red kontrollerini
  // geçerdi. Kabul olmadan red ölçümü tek yönlüdür.
  check("§1a tek hatlı makinede 1. hat KABUL", dene(1, 1).kabul);
  check("§1b çift enli makinede 2. hat KABUL", dene(2, 2).kabul);
  check("§1c dört hatlının 3. hattı KABUL (orta değer)", dene(3, 4).kabul);

  const asim = dene(3, 2);
  check(
    "§1d hat sayısını AŞAN numara reddedilir",
    !asim.kabul && asim.kod === "PRODUCTION_LINE_OUT_OF_RANGE",
    `kod=${asim.kod}`,
  );
  const sinir = dene(2, 1);
  check(
    "§1e sınırın BİR üstü reddedilir (off-by-one)",
    !sinir.kabul && sinir.kod === "PRODUCTION_LINE_OUT_OF_RANGE",
    `kod=${sinir.kod}`,
  );
  const sifir = dene(0, 5);
  check(
    "§1f 0. hat reddedilir (DB CHECK'inin ikizi)",
    !sifir.kabul && sifir.kod === "PRODUCTION_LINE_OUT_OF_RANGE",
    `kod=${sifir.kod}`,
  );
  const negatif = dene(-1, 5);
  check("§1g negatif hat reddedilir", !negatif.kabul, `kod=${negatif.kod}`);
  const kesirli = dene(2.5, 4);
  check(
    "§1h KESİRLİ hat reddedilir — `2.5 <= 4` doğrudur ve sessizce geçerdi",
    !kesirli.kabul,
    `kod=${kesirli.kod}`,
  );

  // ── §2 DB ALT SINIRI (yüklemin ikizi, AYRI hat) ──────────────────────────
  const ek = Date.now().toString(36);
  const station = await prisma.station.create({
    data: {
      name: `TEST-PL-IST-${ek}`,
      code: `TEST-PL-S-${ek}`.toUpperCase().slice(0, 32),
      type: "INTERNAL",
      kind: "PROCESS_QC",
      isActive: true,
    },
  });
  try {
    const makine = await prisma.machine.create({
      data: {
        stationId: station.id,
        name: `TEST-PL-MAK-${ek}`,
        code: `TEST-PL-M-${ek}`.toUpperCase().slice(0, 32),
        isActive: true,
      },
    });
    check(
      "§3 yeni makine varsayılanı productionLineCount = 1 (sıfır fark)",
      makine.productionLineCount === 1,
      `değer=${makine.productionLineCount}`,
    );

    let checkHata: unknown = null;
    try {
      await prisma.machine.update({
        where: { id: makine.id },
        data: { productionLineCount: 0 },
      });
    } catch (e) {
      checkHata = e;
    }
    const ihlal =
      checkHata instanceof Prisma.PrismaClientKnownRequestError &&
      JSON.stringify(checkHata.meta ?? {}).includes("23514");
    check("§2 DB CHECK: productionLineCount = 0 reddedilir", ihlal, ihlal ? "" : String(checkHata));

    // Çift enli değer meşru olmalı — CHECK'in fazla dar olmadığının kanıtı.
    const cift = await prisma.machine.update({
      where: { id: makine.id },
      data: { productionLineCount: 2 },
    });
    check("§2b çift enli değer (2) kabul edilir", cift.productionLineCount === 2);

    // ── §4 ÇAĞRILDIĞI YOL — borcun kapanışı (P2b, 2026-09-13) ────────────────
    // Yüklemin doğru olması ÇAĞRILDIĞI anlamına gelmez. Buradan koşum açan
    // servis çağrılır ve 3. hat (makine 2 hatlı) 400 `PRODUCTION_LINE_OUT_OF_RANGE`
    // ile düşmeli; düşmüyorsa yüklem yolda değildir. Tamamlayıcı davranış
    // ölçümü `test_machine_run §7`de (kabul dalı + tek hatlı varsayılan).
    const asan = await openMachineRun({ machineId: makine.id, productionLineNo: 3 }).then(
      () => ({ status: 200, code: null as string | null }),
      (e: unknown) => ({
        status: e instanceof AppError ? e.statusCode : 0,
        code: e instanceof AppError ? String((e.details as { code?: unknown } | undefined)?.code ?? "") : null,
      }),
    );
    check(
      "§4 koşum açan yol yüklemi ÇAĞIRIYOR — 3. hat 2 hatlı makinede 400 PRODUCTION_LINE_OUT_OF_RANGE",
      asan.status === 400 && asan.code === "PRODUCTION_LINE_OUT_OF_RANGE",
      `status=${asan.status} code=${asan.code}`,
    );
  } finally {
    await prisma.machineRun.deleteMany({ where: { machine: { stationId: station.id } } });
    await prisma.machine.deleteMany({ where: { stationId: station.id } });
    await prisma.station.deleteMany({ where: { id: station.id } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
