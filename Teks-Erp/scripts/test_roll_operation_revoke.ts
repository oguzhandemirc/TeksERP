// =============================================================================
// BEKÇİ — TOP OPERASYON İZİ GERİ ALINIR, SİLİNMEZ (B-4a, 2026-09-11)
// Çalıştır: npx tsx scripts/run-all-tests.ts roll_operation_revoke
// =============================================================================
// NEDEN: `RollOperation` şema başlığında append-only'ydi ama kod YEDİ yerde
// `deleteMany` ile siliyordu. "Bu topa kurşun uygulandı mı / QC2'den geçti mi /
// fasona gitti mi" sorusunun cevabı geriye dönük DEĞİŞİYORDU — izlenebilirlik
// iddiası çürüktü.
//
// ÖLÇÜLENLER
//   §1 Geri alma satırı SİLMEZ; damga + sebep + aktör yazılır
//   §2 ⭐ PARTIAL UNIQUE: geri alınmış satır DURURKEN aynı (top, adım, tip)
//      üçlüsü YENİDEN yazılabilir — tam unique olsaydı top o adımı bir daha
//      işleyemezdi. Bu maddenin en kritik kontrolü budur.
//   §3 Aktif okuma geri alınmışı GÖRMEZ (ACTIVE_OPERATION tek kaynağı)
//   §4 ⭐ İKİ AKTİF SATIR YAZILAMAZ — partial unique hâlâ sed görevinde
//   §5 AST: `src/`de `rollOperation.deleteMany` KALMADI
//   §6 AST: okuma yüzeyleri `ACTIVE_OPERATION` kullanıyor; üç bilinçli istisna
//      gerekçesiyle işaretli
//   §8 ⭐ UPSERT: geri alınmış iz dururken üçlü anahtarlı upsert yalnız aktif
//      yüklemle yeni satır yazar (süzgeçsiz hâli geri alınmış satırı döndürür)
//   §7 ⭐ AST + tip denetleyicisi (`revoke-ast-tarama.ts`): delegate çağrıları
//      (upsert DAHİL — üçlü anahtarla upsert geri alınmış satırı bulur ve yeni
//      aktif satır YAZMAZ), ilişki okumaları (`operations`, `_count`) ve
//      `roll_operations` ham SQL'i aktif yüklemi taşır; istisna kümesi iki yönlü
// =============================================================================
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RollOperationType, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin } from "./fixture-test-user";
import { aktifYuklemTara } from "./revoke-ast-tarama";
import {
  ACTIVE_OPERATION,
  revokeRollOperations,
} from "../src/services/helpers/roll-operation.helper";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const ts = Date.now();
const TAG = `TST-ROR-${ts}`;
let rollId = "";
let stepId = "";
let woId = "";
let itemId = "";

async function main(): Promise<void> {
  console.log("\n=== Top operasyon izi: geri alınır, silinmez ===\n");

  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  // Ürün fixture'ı bekçinin kendisinindir — seed fixture'ı olmayan kurulumda da koşar.
  itemId = (
    await prisma.item.create({
      data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC" },
      select: { id: true },
    })
  ).id;
  // ⚠️ Seed kullanıcı adına HAM yaslanılmaz (ortam bağımlılığı tavanı) —
  // bekçi kendi yöneticisini fixture'dan çözer.
  const adminId = (await ensureTestAdmin()).id;
  const stationId = need(
    await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }),
    "KURSUN_KK2",
  );

  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${TAG}-WO`, status: "IN_PROGRESS" },
    select: { id: true },
  });
  woId = wo.id;
  const step = await prisma.workOrderStep.create({
    data: { workOrderId: woId, stationId, stepSequence: 1, status: "PENDING" },
    select: { id: true },
  });
  stepId = step.id;
  const roll = await prisma.roll.create({
    data: {
      barcode: `${TAG}-R`,
      itemId,
      initialQty: 100,
      currentQty: 100,
      status: RollStatus.IN_PRODUCTION,
      currentStepId: stepId,
    },
    select: { id: true },
  });
  rollId = roll.id;

  const yaz = () =>
    prisma.rollOperation.create({
      data: {
        rollId,
        workOrderStepId: stepId,
        operationType: RollOperationType.QC2_COMPLETED,
        operatorId: adminId,
      },
      select: { id: true },
    });

  // ── §1 GERİ ALMA SİLMEZ ───────────────────────────────────────────────────
  const ilk = await yaz();
  const n = await prisma.$transaction((tx) =>
    revokeRollOperations(tx, {
      rollIds: [rollId],
      workOrderStepIds: [stepId],
      operationTypes: [RollOperationType.QC2_COMPLETED],
      reason: "BEKCI_TEST",
      userId: adminId,
    }),
  );
  check("§1a Geri alma 1 satır damgaladı (eski deleteMany.count ile aynı anlam)", n === 1, String(n));
  const sonra = await prisma.rollOperation.findUnique({
    where: { id: ilk.id },
    select: { revokedAt: true, revokedById: true, revokeReason: true },
  });
  check("§1b ⭐ Satır DURUYOR (silinmedi)", sonra != null);
  check(
    "§1c Damga sebep ve aktör taşıyor",
    sonra?.revokedAt != null && sonra.revokeReason === "BEKCI_TEST" && sonra.revokedById === adminId,
    String(sonra?.revokeReason),
  );

  // ── §2 PARTIAL UNIQUE — aynı üçlü YENİDEN yazılabilir ─────────────────────
  let ikinciId = "";
  let ikinciHata = "";
  try {
    ikinciId = (await yaz()).id;
  } catch (e) {
    ikinciHata = e instanceof Error ? e.message : String(e);
  }
  check(
    "§2 ⭐ Geri alınmış satır DURURKEN aynı (top, adım, tip) YENİDEN yazıldı",
    ikinciId !== "" && ikinciHata === "",
    ikinciHata.slice(0, 80),
  );

  // ── §3 AKTİF OKUMA geri alınmışı görmez ───────────────────────────────────
  const aktif = await prisma.rollOperation.findMany({
    where: { rollId, ...ACTIVE_OPERATION },
    select: { id: true },
  });
  const hepsi = await prisma.rollOperation.count({ where: { rollId } });
  check(
    "§3 Aktif okuma 1 satır görür, tabloda 2 satır var",
    aktif.length === 1 && aktif[0]?.id === ikinciId && hepsi === 2,
    `aktif=${aktif.length} toplam=${hepsi}`,
  );

  // ── §4 İKİ AKTİF SATIR YAZILAMAZ — sed hâlâ görevde ───────────────────────
  let ucuncuHata = "";
  try {
    await yaz();
  } catch (e) {
    ucuncuHata = e instanceof Error ? e.message : String(e);
  }
  check(
    "§4 ⭐ İkinci AKTİF satır REDDEDİLDİ (partial unique sed görevinde)",
    ucuncuHata !== "",
    ucuncuHata ? "P2002/unique" : "YAZILDI — sed düşmüş!",
  );

  // ── §8 UPSERT — geri alınmış iz dururken yalnız AKTİF satıra bakmalı ───────
  // Servislerdeki upsert'ler (KK2 tamamlama, Tambur finalize) üçlü anahtarla
  // çağrılır; §7a hepsinin ACTIVE_OPERATION taşıdığını ölçer, burası NEDENİNİ.
  await prisma.$transaction((tx) =>
    revokeRollOperations(tx, {
      rollIds: [rollId],
      workOrderStepIds: [stepId],
      operationTypes: [RollOperationType.QC2_COMPLETED],
      reason: "BEKCI_TEST",
      userId: adminId,
    }),
  );
  const uclu = { rollId, workOrderStepId: stepId, operationType: RollOperationType.QC2_COMPLETED };
  // Süzgeçsiz hâl: tek geri alınmış satırı döndürür; birden çoksa Prisma hata atar.
  let ciplakSonuc = "";
  try {
    const r = await prisma.rollOperation.upsert({
      where: { rollId_workOrderStepId_operationType: uclu },
      create: { ...uclu, operatorId: adminId },
      update: {},
      select: { revokedAt: true },
    });
    ciplakSonuc = r.revokedAt === null ? "AKTİF YAZDI" : "geri alınmışı döndürdü";
  } catch (e) {
    ciplakSonuc = `hata: ${(e instanceof Error ? e.message : String(e)).split("\n").pop()?.slice(0, 60)}`;
  }
  check(
    "§8a Tuzak belgeli: aktif süzgeçsiz upsert yeni AKTİF satır YAZMAZ",
    ciplakSonuc !== "AKTİF YAZDI",
    ciplakSonuc,
  );
  const aktifUpsert = await prisma.rollOperation.upsert({
    where: { rollId_workOrderStepId_operationType: uclu, ...ACTIVE_OPERATION },
    create: { ...uclu, operatorId: adminId },
    update: {},
    select: { id: true, revokedAt: true },
  });
  const tekrar = await prisma.rollOperation.upsert({
    where: { rollId_workOrderStepId_operationType: uclu, ...ACTIVE_OPERATION },
    create: { ...uclu, operatorId: adminId },
    update: {},
    select: { id: true },
  });
  check(
    "§8b ⭐ ACTIVE_OPERATION'lı upsert yeni AKTİF satır yazar, tekrarı idempotenttir",
    aktifUpsert.revokedAt === null && tekrar.id === aktifUpsert.id,
    `aktif=${aktifUpsert.revokedAt === null} idempotent=${tekrar.id === aktifUpsert.id}`,
  );

  // ── §5-§6 AST ─────────────────────────────────────────────────────────────
  {
    const SRC = join(__dirname, "..", "src");
    const say = (dizin: string, desen: RegExp): number => {
      let n = 0;
      const yur = (d: string): void => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name);
          if (e.isDirectory()) yur(p);
          else if (e.name.endsWith(".ts") && desen.test(readFileSync(p, "utf8"))) n++;
        }
      };
      yur(dizin);
      return n;
    };
    check(
      "§5 ⭐ `src/`de `rollOperation.deleteMany` KALMADI",
      say(SRC, /rollOperation\.deleteMany\(/) === 0,
    );
    const guard = readFileSync(join(SRC, "services", "helpers", "guarded-hard-remove.ts"), "utf8");
    const backup = readFileSync(join(SRC, "services", "backup-impact.service.ts"), "utf8");
    check(
      "§6 Üç bilinçli istisna gerekçesiyle işaretli (sessiz muaf yok)",
      /revokedAt` SÜZÜLMEZ/.test(guard) && /revokedAt` SÜZÜLMEZ/.test(backup),
    );
  }

  // ── §7 AST + tip denetleyicisi ────────────────────────────────────────────
  {
    const r = aktifYuklemTara(join(__dirname, ".."), [
      {
        delegate: "rollOperation",
        model: "RollOperation",
        sabit: "ACTIVE_OPERATION",
        tablo: "roll_operations",
        helper: join("src", "services", "helpers", "roll-operation.helper.ts"),
      },
    ]).get("rollOperation")!;
    check(
      "§7a ⭐ Her okuma/güncelleme/upsert çağrısı ACTIVE_OPERATION taşır ya da gerekçeli istisnadır",
      r.cagriSayisi >= 25 && r.cagriIhlal.length === 0,
      `çağrı=${r.cagriSayisi}${r.cagriIhlal.length ? " İHLAL: " + r.cagriIhlal.join(", ") : ""}`,
    );
    check(
      "§7b ⭐ Her RollOperation ilişki okuması aktif yüklemi taşır (every YOK)",
      r.iliskiSayisi >= 5 && r.iliskiIhlal.length === 0,
      `ilişki=${r.iliskiSayisi}${r.iliskiIhlal.length ? " İHLAL: " + r.iliskiIhlal.join(", ") : ""}`,
    );
    check(
      "§7c ⭐ Her `roll_operations` ham SQL başvurusu kendi alias'ıyla `\"revokedAt\" IS NULL` taşır",
      r.sqlSayisi >= 2 && r.sqlIhlal.length === 0,
      `sql=${r.sqlSayisi}${r.sqlIhlal.length ? " İHLAL: " + r.sqlIhlal.join(", ") : ""}`,
    );
    console.log(`   istisnalar (${r.istisnalar.length}): ${r.istisnalar.join(", ") || "—"}`);
    const dosyalar = new Set(r.istisnalar.map((y) => y.split(":")[0]));
    const beklenmeyen = [...dosyalar].filter((d) => !OPERASYON_ISTISNA_DOSYALARI.has(d));
    const olu = [...OPERASYON_ISTISNA_DOSYALARI].filter((d) => !dosyalar.has(d));
    check(
      "§7d İstisna kümesi iki yönlü: sessiz yeni muaf yok, ölü muaf yok",
      beklenmeyen.length === 0 && olu.length === 0,
      `beklenmeyen=[${beklenmeyen.join(", ")}] ölü=[${olu.join(", ")}]`,
    );
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

/** "Bu satır HİÇ YAZILDI MI" sorusunu soran ya da izi taşıyan yüzeyler. */
const OPERASYON_ISTISNA_DOSYALARI = new Set<string>([
  "src/services/helpers/guarded-hard-remove.ts", // kalıcı silme guard'ı — üretim kanıtı
  "src/services/backup-impact.service.ts", // yedekten beri YAZILAN satır hacmi
  "src/services/workorder.service.ts", // rota düzenleme: adımın defter geçmişi + RESTRICT FK
  "src/services/helpers/workorder-clone.helper.ts", // bölmede iz topla birlikte taşınır
]);

async function cleanup(): Promise<void> {
  try {
    if (rollId) {
      await prisma.rollOperation.deleteMany({ where: { rollId } });
      await prisma.rollMovement.deleteMany({ where: { rollId } });
      await prisma.roll.deleteMany({ where: { id: rollId } });
    }
    if (stepId) await prisma.workOrderStep.deleteMany({ where: { id: stepId } });
    if (woId) await prisma.workOrder.deleteMany({ where: { id: woId } });
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata:", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => {
    console.error("💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
