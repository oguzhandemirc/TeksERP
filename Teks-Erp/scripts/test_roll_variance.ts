// =============================================================================
// Test: SAPMA DEFTERİ (`RollVariance`) — fire / kayıt düzeltmesi / aşım
// Çalıştır: npx tsx scripts/test_roll_variance.ts
// =============================================================================
// 2026-08-09'da eklendi. Sahada ölçülen üç boşluğu kapatıyor:
//   • `scrap`   → gerçek FIRE topu doğuruyordu (görünür), ama SEBEBİ yoktu
//   • `discard` → HİÇBİR kayıt doğmuyordu; iz yalnız TAMBUR_PROCESSED'ın
//                 `metadata` JSON'unda kalıyordu → indekslenemez, raporlanamaz
//   • aşım      → HİÇBİR yere yazılmıyordu → sapmanın ARTI yönü kayıptı
//
// Bu bekçi ALTI cepheyi kilitler:
//   §1 Sebep doğrulaması FAIL-CLOSED (bilinmeyen kod sessizce kabul edilmez)
//   §2 ESKİ İSTEMCİ dalı — sebepsiz çağrı REDDEDİLMEZ, görünür kovaya yazılır.
//      Bu dal olmasaydı backend deploy edildiği an sahadaki her tablette
//      "Bitir" 400'e düşerdi (operatör vardiya ortasında işini kapatamaz).
//   §3 `overageOf` matematiği + `qty <= 0` satır YAZILMAZ
//   §4 DB seddi (`roll_variances_qty_positive`) gerçekten uyguluyor
//   §5 MOBİL AYNA birebir mi (ayrışma derleme hatası VERMEZ → mekanik kontrol)
//   §6 Uçtan uca: depo kesimi kapanışı `discard` → RECORD_CORRECTION satırı +
//      `preTamburCloseQty`/`preTamburCloseStatus` yazıldı mı
//
// Fixture kendi verisini üretir (ortam verisine bağımlı DEĞİL), finally'de siler.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, RollVarianceKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import {
  validateVarianceReason,
  SCRAP_REASONS,
  RECORD_CORRECTION_REASONS,
  LEGACY_REASON_CODE,
  VARIANCE_SOURCES,
  varianceKindForRemainingAction,
} from "../src/constants/variance-reasons";
import { overageOf, recordVarianceTx } from "../src/services/helpers/roll-variance.helper";
import { TamburService } from "../src/services/tambur.service";
import {
  finalizeOpenFabricSchema,
  finalizeWarehouseCutSchema,
} from "../src/controllers/tambur.controller";

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

const tambur = new TamburService();

function threw(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

async function main(): Promise<void> {
  const ts = Date.now();
  const cleanupRollIds: string[] = [];
  let itemId = "";

  try {
    // ── §1 Sebep doğrulaması FAIL-CLOSED ────────────────────────────────────
    console.log("\n── §1 Sebep doğrulaması ──");

    check(
      "geçerli fire kodu kabul edilir",
      validateVarianceReason(RollVarianceKind.SCRAP, { reasonCode: "LEKE" }).reasonCode ===
        "LEKE",
    );
    check(
      "BİLİNMEYEN kod REDDEDİLİR (sessizce kabul edilmez)",
      (threw(() =>
        validateVarianceReason(RollVarianceKind.SCRAP, { reasonCode: "UYDURMA_KOD" }),
      ) ?? "").includes("Geçersiz sebep kodu"),
      "sessiz kabul, raporda hiçbir yerde tanımlı olmayan bir kova doğururdu",
    );
    check(
      "fire kodu KAYIT DÜZELTMESİ türünde reddedilir (kovalar karışmaz)",
      threw(() =>
        validateVarianceReason(RollVarianceKind.RECORD_CORRECTION, { reasonCode: "LEKE" }),
      ) !== null,
    );
    check(
      '"Diğer" seçilince açıklama ZORUNLU',
      (threw(() =>
        validateVarianceReason(RollVarianceKind.SCRAP, { reasonCode: "DIGER" }),
      ) ?? "").includes("açıklama"),
    );
    check(
      '"Diğer" + kısa açıklama (2 karakter) reddedilir',
      threw(() =>
        validateVarianceReason(RollVarianceKind.SCRAP, {
          reasonCode: "DIGER",
          reasonText: "ab",
        }),
      ) !== null,
    );
    check(
      '"Diğer" + yeterli açıklama kabul edilir',
      validateVarianceReason(RollVarianceKind.SCRAP, {
        reasonCode: "DIGER",
        reasonText: "kenar hasarı",
      }).reasonText === "kenar hasarı",
    );
    check(
      "OVERAGE sebep İSTEMEZ (aşımı sistem tespit eder, operatör beyan etmez)",
      validateVarianceReason(RollVarianceKind.OVERAGE, {}).reasonCode === null,
    );
    check(
      "keep_1kalite sapma DEĞİLDİR",
      varianceKindForRemainingAction("keep_1kalite") === null,
    );
    check(
      "discard → RECORD_CORRECTION (fire DEĞİL — bu işin çekirdeği)",
      varianceKindForRemainingAction("discard") === RollVarianceKind.RECORD_CORRECTION,
    );
    check(
      "scrap → SCRAP",
      varianceKindForRemainingAction("scrap") === RollVarianceKind.SCRAP,
    );

    // ── §2 ESKİ İSTEMCİ dalı ────────────────────────────────────────────────
    console.log("\n── §2 Eski istemci (sebepsiz çağrı) ──");

    const legacy = validateVarianceReason(RollVarianceKind.RECORD_CORRECTION, {});
    check(
      "sebepsiz çağrı REDDEDİLMEZ — görünür kovaya yazılır",
      legacy.reasonCode === LEGACY_REASON_CODE,
      "reddetseydi deploy penceresinde sahadaki her tablette 'Bitir' 400'e düşerdi",
    );
    check(
      "BELIRTILMEDI hiçbir seçicide ÇIKMAZ (katalogda yok)",
      !SCRAP_REASONS.some((r) => r.code === LEGACY_REASON_CODE) &&
        !RECORD_CORRECTION_REASONS.some((r) => r.code === LEGACY_REASON_CODE),
    );

    // ── §3 overageOf + qty<=0 ───────────────────────────────────────────────
    console.log("\n── §3 Aşım matematiği ──");

    check("aşım yoksa 0", overageOf(40, 100).equals(0));
    check("tam eşitlikte 0", overageOf(100, 100).equals(0));
    check("aşımda fark", overageOf(140, 100).equals(40));
    check(
      "ondalık aşım doğru (float değil Decimal)",
      overageOf(new Prisma.Decimal("100.15"), new Prisma.Decimal("100.10")).equals(
        new Prisma.Decimal("0.05"),
      ),
    );

    // ── Fixture ─────────────────────────────────────────────────────────────
    const item = await prisma.item.create({
      data: { code: `TEST-VAR-${ts}`, name: `TEST Sapma ${ts}`, itemType: "FABRIC" },
      select: { id: true },
    });
    itemId = item.id;

    const zeroRoll = await prisma.roll.create({
      data: {
        barcode: `TEST-VAR-Z-${ts}`,
        itemId: item.id,
        status: "WAREHOUSE",
        initialQty: 10,
        currentQty: 10,
        entrySource: "MANUAL_ENTRY",
      },
      select: { id: true },
    });
    cleanupRollIds.push(zeroRoll.id);

    const skipped = await prisma.$transaction((tx) =>
      recordVarianceTx(tx, {
        rollId: zeroRoll.id,
        kind: RollVarianceKind.RECORD_CORRECTION,
        qty: 0,
        source: VARIANCE_SOURCES.TAMBUR_FINALIZE,
        reasonCode: "OLCUM_HATASI",
      }),
    );
    check(
      "qty = 0 → satır YAZILMAZ (sapma tanım gereği yok)",
      skipped === null,
      "sıfır metrajlık satır defteri gürültüyle doldurur ve CHECK'e de çarpardı",
    );

    // ── §4 DB seddi ─────────────────────────────────────────────────────────
    console.log("\n── §4 DB seddi (roll_variances_qty_positive) ──");

    let dbRejected = false;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO roll_variances (id, "rollId", kind, qty, source, "createdAt")
         VALUES (gen_random_uuid(), $1::uuid, 'SCRAP', -5, 'TEST', now())`,
        zeroRoll.id,
      );
    } catch {
      dbRejected = true;
    }
    check(
      "negatif qty DB seviyesinde REDDEDİLİR",
      dbRejected,
      "işaretli sayı saklamak SUM(qty) yazan her raporu sessizce yanlışlar",
    );

    // ── §5 MOBİL AYNA ───────────────────────────────────────────────────────
    console.log("\n── §5 Mobil ayna birebir mi ──");

    const mobilePath = join(__dirname, "../../mobil/src/constants/varianceReasons.ts");
    const mobileSrc = readFileSync(mobilePath, "utf8");
    const codesIn = (block: string): string[] =>
      [...block.matchAll(/code:\s*'([A-Z_]+)'/g)].map((m) => m[1] as string);
    const scrapBlock = mobileSrc.slice(
      mobileSrc.indexOf("SCRAP_REASONS"),
      mobileSrc.indexOf("RECORD_CORRECTION_REASONS"),
    );
    const corrBlock = mobileSrc.slice(mobileSrc.indexOf("RECORD_CORRECTION_REASONS"));
    const mobileScrap = codesIn(scrapBlock);
    const mobileCorr = codesIn(corrBlock);

    check(
      "mobil fire kodları backend ile BİREBİR",
      JSON.stringify(mobileScrap) === JSON.stringify(SCRAP_REASONS.map((r) => r.code)),
      `mobil=[${mobileScrap.join(",")}]`,
    );
    check(
      "mobil kayıt-düzeltme kodları backend ile BİREBİR",
      JSON.stringify(mobileCorr) ===
        JSON.stringify(RECORD_CORRECTION_REASONS.map((r) => r.code)),
      `mobil=[${mobileCorr.join(",")}]`,
    );
    // Körlük zemini: regex boşa düşerse iki liste de [] olur ve yukarıdaki iki
    // kontrol VAKUMEN yeşil kalırdı ("ihlal yok" ile "hiçbir şeye bakılmadı"
    // aynı yeşile çıkar).
    check("körlük zemini: mobil katalog gerçekten okundu", mobileScrap.length >= 5);

    // ── §6 Uçtan uca: depo kesimi kapanışı ──────────────────────────────────
    console.log("\n── §6 Uçtan uca (finalizeWarehouseCut → discard) ──");

    const parent = await prisma.roll.create({
      data: {
        barcode: `TEST-VAR-P-${ts}`,
        itemId: item.id,
        status: "WAREHOUSE",
        initialQty: 100,
        currentQty: 40,
        qualityGrade: "1.KALITE",
        entrySource: "MANUAL_ENTRY",
      },
      select: { id: true },
    });
    cleanupRollIds.push(parent.id);

    await tambur.finalizeWarehouseCut(
      parent.id,
      { remainingAction: "discard", varianceReasonCode: "OLCUM_HATASI" },
      undefined,
      null,
    );

    const after = await prisma.roll.findUnique({
      where: { id: parent.id },
      select: {
        status: true,
        currentQty: true,
        initialQty: true,
        preTamburCloseQty: true,
        preTamburCloseStatus: true,
      },
    });
    check("kapanışta parent TAMBUR_CONSUMED", after?.status === "TAMBUR_CONSUMED");
    check("kapanışta currentQty sıfırlandı", Number(after?.currentQty) === 0);
    check(
      "KAPANIŞ ÖNCESİ METRAJ kaydedildi (türetilmiyor)",
      Number(after?.preTamburCloseQty) === 40,
      `preTamburCloseQty=${after?.preTamburCloseQty}`,
    );
    check(
      "KAPANIŞ ÖNCESİ STATÜ kaydedildi (renkten türetilemez)",
      after?.preTamburCloseStatus === "WAREHOUSE",
    );
    check(
      "initialQty kapanışta DEĞİŞMEDİ",
      Number(after?.initialQty) === 100,
      "değişseydi geri alma iki kolonu da onarmak zorunda kalırdı",
    );

    const rows = await prisma.rollVariance.findMany({
      where: { rollId: parent.id },
      select: { kind: true, qty: true, reasonCode: true, source: true, workOrderStepId: true },
    });
    check("tek sapma satırı yazıldı", rows.length === 1, `${rows.length} satır`);
    check(
      "tür RECORD_CORRECTION (fire DEĞİL)",
      rows[0]?.kind === RollVarianceKind.RECORD_CORRECTION,
      "discard'ı fire saymak fire oranını sistematik olarak şişirirdi",
    );
    check("metraj doğru", Number(rows[0]?.qty) === 40);
    check("sebep kodu saklandı", rows[0]?.reasonCode === "OLCUM_HATASI");
    check(
      "kaynak TAMBUR_WAREHOUSE_FINALIZE",
      rows[0]?.source === VARIANCE_SOURCES.TAMBUR_WAREHOUSE_FINALIZE,
    );
    check(
      "depo kesiminde adım UYDURULMAZ (workOrderStepId null)",
      rows[0]?.workOrderStepId === null,
    );

    // ── §7 Zod KAPISI — sessiz silme tuzağı ─────────────────────────────────
    // `z.object` tanımadığı anahtarı HATA VERMEDEN atar. Sapma sebebi şemaya
    // eklenmezse mobil onu gönderir, backend sessizce siler, defter
    // "BELIRTILMEDI" ile dolar ve kimse sebebini bulamaz. Aynı boşluktan daha
    // önce `foldType` geçti (2026-08-05) — o yüzden burası mekanik kilitli.
    console.log("\n── §7 Zod kapısı (sessiz silme) ──");

    const probe = { remainingAction: "discard", varianceReasonCode: "OLCUM_HATASI", varianceReasonText: "sayım" };
    const openParsed = finalizeOpenFabricSchema.parse(probe) as Record<string, unknown>;
    const whParsed = finalizeWarehouseCutSchema.parse(probe) as Record<string, unknown>;
    check(
      "finalizeOpenFabric şeması sebep KODUNU taşıyor",
      openParsed.varianceReasonCode === "OLCUM_HATASI",
    );
    check(
      "finalizeOpenFabric şeması sebep METNİNİ taşıyor",
      openParsed.varianceReasonText === "sayım",
    );
    check(
      "finalizeWarehouseCut şeması sebep KODUNU taşıyor",
      whParsed.varianceReasonCode === "OLCUM_HATASI",
    );
    check(
      "finalizeWarehouseCut şeması sebep METNİNİ taşıyor",
      whParsed.varianceReasonText === "sayım",
    );
  } finally {
    if (cleanupRollIds.length) {
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: cleanupRollIds } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: cleanupRollIds } } });
      await prisma.roll.deleteMany({
        where: { OR: [{ id: { in: cleanupRollIds } }, { parentRollId: { in: cleanupRollIds } }] },
      });
    }
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
  }
}

main().then(
  () => process.exit(fail > 0 ? 1 : 0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
