// =============================================================================
// BEKÇİ — "Rengi Değiştir" mal–plan bekçisi KİLİT ALTINDA (BULGU-T3-016)
// Çalıştır: npx tsx scripts/test_wo_color_change_lock.ts
// =============================================================================
// 2026-08-21 kararı: iş emrinin hedef rengi ile ELDEKİ boyanmış malın rengi
// uyuşmalı. Uyuşmuyorsa ya onay sorulur (409 `COLOR_PARTIAL_CONFIRM`) ya da
// reddedilir (409 `COLOR_DYED_BLOCKED`) ve operatöre üç çıkış yolu sunulur:
// Tebdil · yeni iş emri · topları düzelt.
//
// KUSUR: `changeTargetColor` transaction AÇMIYOR ve iş emri satırını
// KİLİTLEMİYORDU; bekçi havuz istemcisiyle, kilidin DIŞINDA koşuyordu. Fason
// kabulünün commit penceresinde (tx `touchWorkOrderTx` ile satırı kilitler, ~600
// ms sürer) bekçi doğan topları HENÜZ GÖREMEZ, "boyanmış top yok" der ve
// serbest bırakır; sonraki atomik claim de `targetColorId` koşulunu sağladığı
// için geçer. Sonuç: plan yeni renk, eldeki mal eski renk, hiçbir soru sorulmaz.
//
// ⚠️ DENETİMİN REPRO'SU (`audit_repro_S-4-01`) BU KUSURU ÖLÇMÜYOR — ölçüldü
// (2026-08-31): kabul çağrısı `appliedColorId` GEÇMİYOR, doğan toplar RENKSİZ
// doğuyor (`born renkleri=[null]`, 12/12 tur). Repro'nun `violated()` yüklemi
// `null`'ı da "B'den farklı renk" saydığı için kırmızı basıyor; oysa renksiz top
// "yanlış renkte mal" DEĞİL, "henüz boyanmamış mal"dır ve bekçinin onu `pending`
// sayması DOĞRUDUR. Yani repro'nun 4 kırmızısı kusurun kanıtı değil, kurgunun
// eksiğidir. Bu dosya farkı kapatır: kabul RENKLİ yapılır.
//
// §0 KÖRLÜK ZEMİNİ — doğan toplar GERÇEKTEN renkli mi (repro'nun düştüğü tuzak)
// §1 SIRALI       — kabul commit → renk değiştir → 409 COLOR_DYED_BLOCKED
// §2 EŞZAMANLI    — kabul tx'i açıkken renk değiştir → mal–plan ASLA ayrışmaz
// =============================================================================
import { Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { WorkOrderLinkService } from "../src/services/workorder-link.service";
import { TravelerCardService } from "../src/services/traveler-card.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const STAMP = `TST-T3016-${Date.now().toString().slice(-8)}`;
const sub = new SubcontractorService();
const links = new WorkOrderLinkService();
const cards = new TravelerCardService();
const woIds: string[] = [];
const rollIds: string[] = [];
let ITEM = "";
let ADMIN = "";
let ST_BOYA = "";
let ST_SONRA = "";
let SUB_BOYER = "";
let COLOR_A = "";
let COLOR_B = "";
let bc = 0;
const barcode = (): string => `${STAMP}-${(bc++).toString().padStart(3, "0")}`;

async function fixtures(): Promise<void> {
  const need = <T>(v: T | null, l: string): T => {
    if (!v) throw new Error(`fixture eksik: ${l}`);
    return v;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS").id;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin").id;
  ST_BOYA = need(
    await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }),
    "BOYA_FASON",
  ).id;
  ST_SONRA = need(
    await prisma.station.findFirst({ where: { code: { not: "BOYA_FASON" }, isActive: true }, select: { id: true } }),
    "ikinci istasyon",
  ).id;
  SUB_BOYER = (await ensureTestDyeHouse()).id;
  const renkler = await prisma.color.findMany({
    where: { isActive: true, mergedIntoId: null },
    select: { id: true },
    take: 2,
    orderBy: { name: "asc" },
  });
  if (renkler.length < 2) throw new Error("fixture eksik: en az iki aktif renk");
  COLOR_A = renkler[0]!.id;
  COLOR_B = renkler[1]!.id;
}

/** Fasona gönderilmiş bir iş emri kurar (hedef renk A). */
async function senaryo(tag: string): Promise<{ woId: string; boyaStep: string; rollId: string }> {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${STAMP}-${tag}`.slice(0, 40),
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      targetItemId: ITEM,
      targetColorId: COLOR_A,
      steps: {
        create: [
          { stationId: ST_BOYA, stepSequence: 1, status: "PENDING" },
          { stationId: ST_SONRA, stepSequence: 2, status: "PENDING" },
        ],
      },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woIds.push(wo.id);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  const roll = await prisma.roll.create({
    data: {
      barcode: barcode(),
      itemId: ITEM,
      initialQty: 100,
      currentQty: 100,
      status: RollStatus.STOCK,
      width: 250,
      createdById: ADMIN,
    },
    select: { id: true },
  });
  rollIds.push(roll.id);
  await sub.dispatch(
    { workOrderId: wo.id, stepId: wo.steps[0]!.id, subcontractorId: SUB_BOYER, rollIds: [roll.id] },
    ADMIN,
  );
  return { woId: wo.id, boyaStep: wo.steps[0]!.id, rollId: roll.id };
}

/** RENKLİ kabul — doğan toplar gerçekten A rengini taşısın (repro'nun eksiği). */
function kabul(
  s: { woId: string; boyaStep: string; rollId: string },
  // Tabletin kabul ekranını açarken GÖRDÜĞÜ hedef renk. Verilirse sunucu kilit
  // altında taze hedefle karşılaştırır ve farklıysa 409 TARGET_COLOR_CHANGED
  // verir (2026-08-21). `undefined` = kontrol yok (eski APK sözleşmesi).
  beklenenHedef?: string,
): Promise<{ ok: boolean; code: string }> {
  return sub
    .receive(
      {
        workOrderId: s.woId,
        stepId: s.boyaStep,
        subcontractorId: SUB_BOYER,
        appliedColorId: COLOR_A,
        ...(beklenenHedef !== undefined ? { expectedTargetColorId: beklenenHedef } : {}),
        returns: [{ rollId: s.rollId }],
        newRolls: [{ qty: 92 }],
      },
      ADMIN,
    )
    .then(() => ({ ok: true, code: "" }))
    .catch((e: unknown) => ({
      ok: false,
      code: String((e as { details?: { code?: string } }).details?.code ?? ""),
    }));
}

function renkDegistir(woId: string): Promise<{ ok: boolean; code: string }> {
  return links
    .changeTargetColor(woId, COLOR_B, `${STAMP} renk degisikligi sebebi`, ADMIN)
    .then(() => ({ ok: true, code: "" }))
    .catch((e: unknown) => ({
      ok: false,
      code: String((e as { details?: { code?: string } }).details?.code ?? ""),
    }));
}

async function durum(woId: string): Promise<{ target: string | null; born: Array<string | null> }> {
  const wo = await prisma.workOrder.findUnique({ where: { id: woId }, select: { targetColorId: true } });
  const born = await prisma.roll.findMany({
    where: { parentReceipt: { workOrderId: woId } },
    select: { colorId: true, status: true },
  });
  return {
    target: wo?.targetColorId ?? null,
    born: born
      .filter((b) => b.status === RollStatus.IN_PRODUCTION || b.status === RollStatus.WAREHOUSE)
      .map((b) => b.colorId),
  };
}

/** Mal–plan AYRIŞTI mı? ⚠️ `null` renk AYRIŞMA DEĞİLDİR (repro'nun hatası). */
function ayristi(d: { target: string | null; born: Array<string | null> }): boolean {
  const boyanmis = d.born.filter((c): c is string => c !== null);
  return d.target === COLOR_B && boyanmis.length > 0 && boyanmis.every((c) => c !== COLOR_B);
}

async function main(): Promise<void> {
  await fixtures();

  // ═══ §0 + §1 — SIRALI ═══
  console.log("\n=== §1: kabul commit → renk değiştir (sıralı) ===");
  const s1 = await senaryo("SEQ");
  const k1 = await kabul(s1);
  check("§1: renkli fason kabulü başarılı", k1.ok);
  const d0 = await durum(s1.woId);
  // ⭐ KÖRLÜK ZEMİNİ: doğan toplar renksizse aşağıdaki kontrol HİÇBİR ŞEY ölçmez —
  // denetimin repro'su tam burada düştü (born renkleri=[null], 12/12 tur).
  check(
    "§0: doğan toplar GERÇEKTEN renkli (körlük zemini)",
    d0.born.length > 0 && d0.born.every((c) => c === COLOR_A),
    `${d0.born.length} top, renk=${d0.born[0] === COLOR_A ? "A" : String(d0.born[0])}`,
  );

  const r1 = await renkDegistir(s1.woId);
  check(
    "§1: boyanmış mal varken renk değişikliği REDDEDİLİR (409)",
    !r1.ok && (r1.code === "COLOR_DYED_BLOCKED" || r1.code === "COLOR_PARTIAL_CONFIRM"),
    `code=${r1.code || "(yok)"} ok=${r1.ok}`,
  );
  check("§1: mal ↔ plan ayrışmadı", !ayristi(await durum(s1.woId)));

  // ═══ §2 — EŞZAMANLI ═══
  // Kabul tx'i açıkken renk değişikliği tetiklenir. Kilit ÖNCESİ davranış:
  // bekçi doğan topları göremez → serbest → ayrışma. Kilit SONRASI: değişiklik
  // kabul bitene kadar bekler, sonra bekçi malı GÖRÜR → 409.
  console.log("\n=== §2: kabul tx'i açıkken renk değiştir (eşzamanlı × 6) ===");
  // İKİ KOL, çünkü yarışın İKİ YÖNÜ var ve her birini FARKLI mekanizma kapatır:
  //   ① kabul ÖNCE commit eder → renk değişikliği boyanmış malı görmeli
  //      → WO satır kilidi (bu turda eklendi).
  //   ② renk değişikliği ÖNCE commit eder → o an boyanmış mal YOKTUR, değişiklik
  //      MEŞRUDUR; kabulün "benim gördüğüm hedef değişmiş" demesi gerekir
  //      → `expectedTargetColorId` (2026-08-21'den beri var, İSTEMCİ gönderir).
  // ⚠️ Bu ayrım ölçümle bulundu: yalnız kilitle 6 turun 2'si ayrışmaya devam
  // ediyordu ve sebebi kilidin yetersizliği DEĞİL, ikinci yönün başka bir
  // sözleşmeye ait olmasıydı.
  const kolSonuc = async (beklenen?: string): Promise<{ ayrisan: number; red: number }> => {
    let ayrisan = 0;
    let red = 0;
    for (let i = 0; i < 6; i++) {
      const s = await senaryo(`P${beklenen ? "E" : "N"}${i}`);
      const [kb, rc] = await Promise.all([
        kabul(s, beklenen),
        new Promise((r) => setTimeout(r, 4 * i)).then(() => renkDegistir(s.woId)),
      ]);
      if (!rc.ok || !kb.ok) red++;
      if (ayristi(await durum(s.woId))) ayrisan++;
    }
    return { ayrisan, red };
  };

  const eskiApk = await kolSonuc(undefined);
  // ⚠️ Eski APK kolu BİLGİ amaçlıdır, kırmızı vermez: `expectedTargetColorId`
  // göndermeyen istemci için ayrışma BİLİNEN ve KABUL EDİLEN davranıştır
  // (sözleşme: "undefined = kontrol yok"). Sayıyı basıyoruz ki sessizleşmesin.
  console.log(
    `   [eski APK sözleşmesi] ayrışan=${eskiApk.ayrisan}/6 · reddedilen=${eskiApk.red}/6 (bilgi)`,
  );

  const yeniApk = await kolSonuc(COLOR_A);
  check(
    "§2: `expectedTargetColorId` gönderen istemcide mal ↔ plan HİÇ ayrışmaz",
    yeniApk.ayrisan === 0,
    `ayrışan=${yeniApk.ayrisan}/6 · reddedilen=${yeniApk.red}/6`,
  );
  const ayrisan = yeniApk.ayrisan;
  const reddedilen = yeniApk.red;
  // ⚠️ "Hepsi reddedildi" BEKLENMEZ: kabul henüz başlamadan renk değişirse
  // (boyanmış mal yok) değişiklik MEŞRUDUR ve geçmelidir. Ölçülen değişmez
  // "ayrışma yok"tur, "her zaman red" değil — aksi hâlde bekçi meşru bir
  // esnekliği kapatırdı.
  check("§2: en az bir tur reddedildi (kilit gerçekten devrede)", reddedilen > 0, `${reddedilen}/6`);
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    // Temizlik: sapma defteri → hareketler → toplar → adımlar → WO (FK sırası).
    await prisma.$transaction([
      prisma.rollVariance.deleteMany({ where: { roll: { OR: [{ id: { in: rollIds } }, { barcode: { startsWith: STAMP } }] } } }),
      prisma.rollMovement.deleteMany({ where: { roll: { barcode: { startsWith: STAMP } } } }),
    ]).catch(() => undefined);
    await prisma.$executeRaw`DELETE FROM rolls WHERE barcode LIKE ${`${STAMP}%`} OR "parentReceiptId" IN (SELECT id FROM subcontractor_receipts WHERE "workOrderId" = ANY(${woIds}::uuid[]))`.catch(
      () => undefined,
    );
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => undefined);
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
