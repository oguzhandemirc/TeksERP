// Tek-seferlik idempotency doğrulama testi (Kurşun completeQc2 @@unique).
// Çalıştırma:  npx ts-node scripts/test_qc2_idempotency.ts
// Bittikten sonra script silinebilir.

import { RollOperationType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
// ⚠️ ERKEN `return` SESSİZ YEŞİL ÜRETİYORDU: fikstür yoksa `=== Sonuç` satırı
// HİÇ basılmıyor, `exitCode` 0 kalıyordu ⇒ "çıkış 0 ∧ özet yok ∧ beyan yok".
// Ortam sınıfı: yerel _test DB'de veri VAR, CI'da YOK — kusur yalnız CI'da görünür.
import { atlamaDefteri } from "./lib/atlama";

// F266: scripts/test_*.ts sözleşmesi — check() sayaçları + '=== Sonuç ===' satırı.
let pass = 0;
let fail = 0;
const atlama = atlamaDefteri((mesaj) => {
  fail++;
  console.log(`❌ ${mesaj}`);
});
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

let ozetBasildi = false;
/** Özet satırı HER çıkış yolunda basılır — erken dönüş dâhil. */
function ozetBas(): void {
  if (ozetBasildi) return;
  ozetBasildi = true;
  // ⛔ SIFIR ÖLÇÜM YEŞİL OLAMAZ — ve bu yüklem erken dönüşten DAHA GENİŞTİR:
  // beklenmeyen bir hata da gövdeyi hiç kontrol koşturmadan bitirebilir ve
  // sessizce `0 geçti, 0 başarısız` bastırır. İlk düzeltmem yalnız erken
  // dönüşü kapatmıştı; sonda hata dalını ortaya çıkardı.
  if (pass + fail === 0 && !atlama.bilinmeyenVar && atlama.sayi === 0) {
    atlama.atla("TÜM BÖLÜMLER", "hiçbir kontrol koşmadı — fikstür yok ya da gövde erken düştü", "?");
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${atlama.ozetEki()} ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

async function main() {
  // PROCESS_QC adımında veya geçmişte bulunmuş bir roll bul.
  const op = await prisma.rollOperation.findFirst({
    where: { operationType: RollOperationType.QC2_COMPLETED },
    select: { rollId: true, workOrderStepId: true, id: true },
  });

  let rollId: string;
  let stepId: string;
  let preexisting: boolean;

  if (op) {
    rollId = op.rollId;
    stepId = op.workOrderStepId;
    preexisting = true;
    console.log(
      `Existing QC2_COMPLETED bulundu — rollId=${rollId}, stepId=${stepId}`,
    );
  } else {
    // Hiç QC2_COMPLETED yoksa, herhangi bir roll + step bul (rastgele).
    const step = await prisma.workOrderStep.findFirst({
      where: { station: { kind: "PROCESS_QC" } },
      select: { id: true },
    });
    const roll = await prisma.roll.findFirst({
      where: { status: { notIn: ["CANCELLED", "SCRAP"] } },
      select: { id: true },
    });
    if (!step || !roll) {
      // ⛔ SESSİZCE DÖNME: kaç kontrol düştüğü YAPISAL OLARAK bilinemez (erken
      // dönüş) ⇒ adet "?" ile beyan edilir, `TEKSERP_STRICT=1` altında KIRMIZI.
      atlama.atla(
        "QC2 idempotency — TÜM BÖLÜMLER",
        `fikstür yok: PROCESS_QC adımı ${step ? "var" : "YOK"}, uygun top ${roll ? "var" : "YOK"}`,
        "?",
      );
      return;
    }
    rollId = roll.id;
    stepId = step.id;
    preexisting = false;
    console.log(
      `Fresh test case — rollId=${rollId}, stepId=${stepId} (QC2 yok)`,
    );
  }

  const ops = 5;
  const startedAt = Date.now();
  for (let i = 0; i < ops; i++) {
    await prisma.rollOperation.upsert({
      where: {
        rollId_workOrderStepId_operationType: {
          rollId,
          workOrderStepId: stepId,
          operationType: RollOperationType.QC2_COMPLETED,
        },
      },
      create: {
        rollId,
        workOrderStepId: stepId,
        operationType: RollOperationType.QC2_COMPLETED,
        metadata: { idempotencyTest: true, attempt: i + 1 },
      },
      update: {},
    });
  }
  const tookMs = Date.now() - startedAt;

  const count = await prisma.rollOperation.count({
    where: {
      rollId,
      workOrderStepId: stepId,
      operationType: RollOperationType.QC2_COMPLETED,
    },
  });

  console.log(`Upsert sayısı: ${ops} (${tookMs}ms)`);
  console.log(`DB'deki satır sayısı: ${count} (beklenen: 1)`);
  console.log(`Önceden vardı: ${preexisting}`);

  check("İdempotency: 5 upsert → tek satır (@@unique + update:{})", count === 1, `satır=${count}`);

  // Şimdi P2002 direct-create testi:
  let p2002 = false;
  try {
    await prisma.rollOperation.create({
      data: {
        rollId,
        workOrderStepId: stepId,
        operationType: RollOperationType.QC2_COMPLETED,
        metadata: { p2002Test: true },
      },
    });
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code === "P2002") {
      p2002 = true;
    } else {
      console.error("Beklenmedik hata:", e);
    }
  }
  check("Direct create P2002 fırlattı (unique constraint aktif)", p2002);

  // Eğer fresh case açtıysak temizle.
  if (!preexisting) {
    await prisma.rollOperation.deleteMany({
      where: {
        rollId,
        workOrderStepId: stepId,
        operationType: RollOperationType.QC2_COMPLETED,
      },
    });
    console.log("Cleanup: fresh test case temizlendi.");
  } else {
    console.log("Cleanup: önceden var olan satıra dokunulmadı.");
  }

  ozetBas();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  // ⚠️ `pool.end()` ŞART — `prisma.$disconnect()` TEK BAŞINA YETMEZ: `lib/prisma.ts`
  // havuzu `idleTimeoutMillis: 600_000` ile kuruyor, yani idle client handle'ı event
  // loop'u 10 DAKİKA açık tutabiliyor ve süreç "bitti ama çıkmadı" durumunda kalıyor.
  // CI'da bu, "Test verisi yetersiz" ile ERKEN DÖNEN yolda tetiklendi: mesaj basıldı,
  // sonra 180sn koşucu zaman aşımı + SIGTERM (boş DB'de birebir üretildi). Yerelde
  // görünmüyordu çünkü dev DB dolu olduğu için erken-dönüş yoluna hiç girilmiyor.
  .finally(async () => {
    ozetBas(); // erken dönüşte de basılır
    await prisma.$disconnect();
    await pool.end().catch(() => {});
  });
