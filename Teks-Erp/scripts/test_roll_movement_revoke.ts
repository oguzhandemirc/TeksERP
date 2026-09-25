// =============================================================================
// BEKÇİ — TOP HAREKETİ GERİ ALINIR, SİLİNMEZ (B-4b)
// Çalıştır: npx tsx scripts/run-all-tests.ts roll_movement_revoke
// =============================================================================
// NEDEN: `RollMovement` dört yerde `deleteMany` ile siliniyordu ve adım DURUMU
// bu tablodan SAYILARAK türetiliyor. Damgaya geçince okuyan tek bir yol süzgeci
// unutursa geri alınmış hareket "açık" ya da "kapalı" sayılır, adım yanlış
// duruma geçer — hata da log da vermeden.
//
// ÖLÇÜLENLER
//   §1 Geri alma satırı SİLMEZ; damga + sebep + aktör yazılır, ileri kayıt
//      (`exitedAt`) değişmez
//   §2 ⭐ PARTIAL UNIQUE: geri alınmış AÇIK satır dururken aynı (top, adım) için
//      yeni açık hareket yazılabilir — yoksa top o adıma bir daha giremezdi
//   §3 ⭐ İKİ AKTİF açık hareket yazılamaz — sed hâlâ görevde
//   §4 Aktif okuma geri alınmışı GÖRMEZ (`ACTIVE_MOVEMENT` tek kaynağı)
//   §5 ⭐ ADIM DURUMU: kurşun yeniden açma (açık satır geri alınır) ve geri
//      yöne manuel taşıma (kapalı satır geri alınır) sonrası `recomputeStepStatus`
//      silme davranışıyla AYNI durumu üretir
//   §6 AST: `src/`de `rollMovement.delete*` yok; her okuma/güncelleme çağrısı,
//      her RollMovement ilişki süzgeci/iç içe okuması ve her `roll_movements` ham
//      SQL başvurusu aktif yüklemi taşır ya da gerekçeli istisnadır (iki yönlü küme)
// =============================================================================
import { join } from "node:path";
import { RollStatus, StepStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin } from "./fixture-test-user";
import {
  ACTIVE_MOVEMENT,
  revokeRollMovements,
} from "../src/services/helpers/roll-movement.helper";
import { recomputeStepStatus } from "../src/services/helpers/roll-step.helper";
import { aktifYuklemTara } from "./revoke-ast-tarama";

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

const ts0 = Date.now();
const TAG = `TEST-RMR-${ts0}`;
const woIds: string[] = [];
const rollIds: string[] = [];
let itemId = "";

async function main(): Promise<void> {
  console.log("\n=== Top hareketi: geri alınır, silinmez ===\n");

  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed istasyonu eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  const station = async (code: string): Promise<string> =>
    need(await prisma.station.findUnique({ where: { code }, select: { id: true } }), code);
  const kk1 = await station("KK1_1");
  const kk2 = await station("KURSUN_KK2");
  const tambur = await station("TAMBUR_1");
  const adminId = (await ensureTestAdmin()).id;

  itemId = (
    await prisma.item.create({
      data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC" },
      select: { id: true },
    })
  ).id;

  const kurulum = async (suffix: string, stationIds: string[]) => {
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `${TAG}-${suffix}`, status: "IN_PROGRESS" },
      select: { id: true },
    });
    woIds.push(wo.id);
    const steps: string[] = [];
    for (let i = 0; i < stationIds.length; i++) {
      const s = await prisma.workOrderStep.create({
        data: { workOrderId: wo.id, stationId: stationIds[i], stepSequence: i + 1, status: "PENDING" },
        select: { id: true },
      });
      steps.push(s.id);
    }
    const roll = await prisma.roll.create({
      data: {
        barcode: `${TAG}-${suffix}`,
        itemId,
        initialQty: 100,
        currentQty: 100,
        status: RollStatus.IN_PRODUCTION,
        currentStepId: steps[steps.length - 1],
      },
      select: { id: true },
    });
    rollIds.push(roll.id);
    return { steps, rollId: roll.id };
  };
  const kapali = (rollId: string, stepId: string) =>
    prisma.rollMovement.create({
      data: { rollId, workOrderStepId: stepId, qtyIn: 100, qtyOut: 100, exitedAt: new Date() },
      select: { id: true },
    });
  const acik = (rollId: string, stepId: string) =>
    prisma.rollMovement.create({
      data: { rollId, workOrderStepId: stepId, qtyIn: 100 },
      select: { id: true },
    });
  const durum = async (stepId: string): Promise<StepStatus | undefined> =>
    (await prisma.workOrderStep.findUnique({ where: { id: stepId }, select: { status: true } }))?.status;

  // ── §5A KURŞUN YENİDEN AÇMA — sonraki adımın AÇIK hareketi geri alınır ─────
  const A = await kurulum("A", [kk2, tambur]);
  const [a1, a2] = A.steps;
  const aKapali = await kapali(A.rollId, a1);
  const aAcik = await acik(A.rollId, a2);
  await prisma.$transaction(async (tx) => {
    await recomputeStepStatus(tx, a1);
    await recomputeStepStatus(tx, a2);
  });
  check(
    "§5a Kurulum: KK2 COMPLETED, Tambur ACTIVE",
    (await durum(a1)) === StepStatus.COMPLETED && (await durum(a2)) === StepStatus.ACTIVE,
    `${await durum(a1)}/${await durum(a2)}`,
  );
  let aDamga = 0;
  await prisma.$transaction(async (tx) => {
    aDamga = await revokeRollMovements(tx, {
      rollIds: [A.rollId],
      workOrderStepIds: [a2],
      onlyOpen: true,
      reason: "BEKCI_TEST",
      userId: adminId,
    });
    await tx.rollMovement.updateMany({
      where: { id: aKapali.id, ...ACTIVE_MOVEMENT },
      data: { exitedAt: null, qtyOut: null },
    });
    await tx.roll.update({ where: { id: A.rollId }, data: { currentStepId: a1 } });
    await recomputeStepStatus(tx, a1);
    await recomputeStepStatus(tx, a2);
  });
  check("§1a Geri alma 1 satır damgaladı (eski deleteMany.count ile aynı anlam)", aDamga === 1, String(aDamga));
  const aSonra = await prisma.rollMovement.findUnique({
    where: { id: aAcik.id },
    select: { revokedAt: true, revokedById: true, revokeReason: true, exitedAt: true },
  });
  check("§1b ⭐ Satır DURUYOR (silinmedi)", aSonra != null);
  check(
    "§1c Damga sebep ve aktör taşıyor; ileri kayıt (exitedAt) değişmedi",
    aSonra?.revokedAt != null &&
      aSonra.revokeReason === "BEKCI_TEST" &&
      aSonra.revokedById === adminId &&
      aSonra.exitedAt === null,
    String(aSonra?.revokeReason),
  );
  check(
    "§5b ⭐ Yeniden açma sonrası Tambur PENDING (geri alınmış AÇIK hareket sayılmadı)",
    (await durum(a2)) === StepStatus.PENDING,
    String(await durum(a2)),
  );
  check("§5c Yeniden açılan KK2 ACTIVE", (await durum(a1)) === StepStatus.ACTIVE, String(await durum(a1)));

  // ── §2 PARTIAL UNIQUE — geri alınmış açık satır dururken aynı (top, adım) ──
  let yeniAcikHata = "";
  try {
    await acik(A.rollId, a2);
  } catch (e) {
    yeniAcikHata = e instanceof Error ? e.message : String(e);
  }
  check(
    "§2 ⭐ Geri alınmış AÇIK satır dururken aynı (top, adım) için yeni açık hareket yazıldı",
    yeniAcikHata === "",
    yeniAcikHata.slice(0, 80),
  );

  // ── §3 İKİ AKTİF AÇIK HAREKET YAZILAMAZ ───────────────────────────────────
  let ikinciAktifHata = "";
  try {
    await acik(A.rollId, a2);
  } catch (e) {
    ikinciAktifHata = e instanceof Error ? e.message : String(e);
  }
  check(
    "§3 ⭐ İkinci AKTİF açık hareket REDDEDİLDİ (partial unique sed görevinde)",
    ikinciAktifHata !== "",
    ikinciAktifHata ? "P2002/unique" : "YAZILDI — sed düşmüş!",
  );

  // ── §5D GERİ YÖNE MANUEL TAŞIMA — sonraki adımların KAPALI+AÇIK hareketi ───
  const B = await kurulum("B", [kk1, kk2, tambur]);
  const [b1, b2, b3] = B.steps;
  await kapali(B.rollId, b1);
  const bKapali2 = await kapali(B.rollId, b2);
  const bAcik3 = await acik(B.rollId, b3);
  let bDamga = 0;
  let bKapatilan = -1;
  await prisma.$transaction(async (tx) => {
    bDamga = await revokeRollMovements(tx, {
      rollIds: [B.rollId],
      workOrderStepIds: [b2, b3],
      reason: "BEKCI_TEST",
      userId: adminId,
    });
    bKapatilan = (
      await tx.rollMovement.updateMany({
        where: { rollId: B.rollId, exitedAt: null, ...ACTIVE_MOVEMENT },
        data: { exitedAt: new Date(), notes: "BEKCI_OUT" },
      })
    ).count;
    await tx.rollMovement.create({ data: { rollId: B.rollId, workOrderStepId: b1, qtyIn: 100 } });
    await tx.roll.update({ where: { id: B.rollId }, data: { currentStepId: b1 } });
    await recomputeStepStatus(tx, b1);
    await recomputeStepStatus(tx, b2);
    await recomputeStepStatus(tx, b3);
  });
  check("§5d Geri taşıma kapalı+açık iki satırı damgaladı", bDamga === 2, String(bDamga));
  const b3Sonra = await prisma.rollMovement.findUnique({
    where: { id: bAcik3.id },
    select: { exitedAt: true, notes: true },
  });
  check(
    "§5e Geri alınmış AÇIK satır sonradan KAPATILMADI (ileri kayıt ezilmedi)",
    bKapatilan === 0 && b3Sonra?.exitedAt === null && b3Sonra.notes !== "BEKCI_OUT",
    `kapatılan=${bKapatilan}`,
  );
  check(
    "§5f ⭐ Geri taşıma sonrası ara adım PENDING (geri alınmış KAPALI hareket sayılmadı)",
    (await durum(b2)) === StepStatus.PENDING,
    String(await durum(b2)),
  );
  check(
    "§5g Hedef adım ACTIVE, son adım PENDING",
    (await durum(b1)) === StepStatus.ACTIVE && (await durum(b3)) === StepStatus.PENDING,
    `${await durum(b1)}/${await durum(b3)}`,
  );
  const b2Kayit = await prisma.rollMovement.findUnique({ where: { id: bKapali2.id }, select: { revokedAt: true } });
  check("§5h Kapalı satır da SİLİNMEDİ, damgalı", b2Kayit?.revokedAt != null);

  // ── §4 AKTİF OKUMA geri alınmışı görmez ───────────────────────────────────
  const aktif = await prisma.rollMovement.count({ where: { rollId: B.rollId, ...ACTIVE_MOVEMENT } });
  const hepsi = await prisma.rollMovement.count({ where: { rollId: B.rollId } });
  check("§4 Aktif okuma 2 satır görür, tabloda 4 satır var", aktif === 2 && hepsi === 4, `aktif=${aktif} toplam=${hepsi}`);

  // ── §6 AST ────────────────────────────────────────────────────────────────
  astKontrolleri();

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

// -----------------------------------------------------------------------------
// §6 — AST + tip denetleyicisi (`revoke-ast-tarama.ts`)
// -----------------------------------------------------------------------------
function astKontrolleri(): void {
  const kok = join(__dirname, "..");
  const r = aktifYuklemTara(kok, [
    {
      delegate: "rollMovement",
      model: "RollMovement",
      sabit: "ACTIVE_MOVEMENT",
      tablo: "roll_movements",
      helper: join("src", "services", "helpers", "roll-movement.helper.ts"),
    },
  ]).get("rollMovement")!;

  check("§6a ⭐ `src/`de `rollMovement.delete*` KALMADI", r.silme.length === 0, r.silme.join(", "));
  check(
    "§6b ⭐ Her okuma/güncelleme çağrısı ACTIVE_MOVEMENT taşır ya da gerekçeli istisnadır",
    r.cagriSayisi >= 40 && r.cagriIhlal.length === 0,
    `çağrı=${r.cagriSayisi}${r.cagriIhlal.length ? " İHLAL: " + r.cagriIhlal.join(", ") : ""}`,
  );
  check(
    "§6c ⭐ Her RollMovement ilişki süzgeci / iç içe okuması aktif yüklemi taşır (every YOK)",
    r.iliskiSayisi >= 15 && r.iliskiIhlal.length === 0,
    `ilişki=${r.iliskiSayisi}${r.iliskiIhlal.length ? " İHLAL: " + r.iliskiIhlal.join(", ") : ""}`,
  );
  check(
    "§6d ⭐ Her `roll_movements` ham SQL başvurusu kendi alias'ıyla `\"revokedAt\" IS NULL` taşır",
    r.sqlSayisi >= 15 && r.sqlIhlal.length === 0,
    `sql=${r.sqlSayisi}${r.sqlIhlal.length ? " İHLAL: " + r.sqlIhlal.join(", ") : ""}`,
  );
  console.log(`   istisnalar (${r.istisnalar.length}): ${r.istisnalar.join(", ") || "—"}`);
  const istisnaDosyalari = new Set(r.istisnalar.map((y) => y.split(":")[0]));
  const beklenmeyen = [...istisnaDosyalari].filter((d) => !BEKLENEN_ISTISNA_DOSYALARI.has(d));
  const olu = [...BEKLENEN_ISTISNA_DOSYALARI].filter((d) => !istisnaDosyalari.has(d));
  check(
    "§6e İstisna kümesi iki yönlü: sessiz yeni muaf yok, ölü muaf yok",
    beklenmeyen.length === 0 && olu.length === 0,
    `beklenmeyen=[${beklenmeyen.join(", ")}] ölü=[${olu.join(", ")}]`,
  );
}

/** "Bu satır HİÇ YAZILDI MI" sorusunu soran yüzeyler — geri alınmış satır da kanıttır. */
const BEKLENEN_ISTISNA_DOSYALARI = new Set<string>([
  "src/services/helpers/guarded-hard-remove.ts", // kalıcı silme guard'ı — üretim kanıtı
  "src/services/backup-impact.service.ts", // yedekten beri YAZILAN satır hacmi
  "src/services/workorder.service.ts", // rota düzenleme: adımın defter geçmişi + RESTRICT FK
  "src/services/workorder-timeline.service.ts", // topun uğradığı iş emirleri (Hareketler araması): geçmiş gösterilir, karar/sayı üretmez,
  "src/services/helpers/workorder-clone.helper.ts", // bölmede iz topla birlikte taşınır
]);

async function cleanup(): Promise<void> {
  try {
    if (rollIds.length) {
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (woIds.length) {
      await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    }
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
