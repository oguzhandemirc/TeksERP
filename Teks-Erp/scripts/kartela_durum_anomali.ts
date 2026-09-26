// =============================================================================
// KARTELA DURUM ANOMALİLERİ — `swatches_status_shape` NOT VALID kaldıysa (K2)
// =============================================================================
// KURU KOŞUM VARSAYILAN. Yazmak için iki teyit:
//   npx tsx scripts/kartela_durum_anomali.ts                                  # yalnız döküm
//   npx tsx scripts/kartela_durum_anomali.ts --apply --onay=<N> --hedef=<db>  # düzeltir
//
// NEDEN: migration 20260926110000 kartela durum seddini (status ↔ sackId/shipmentId/
// cancelledAt) ekler; ihlalli eski satır varsa kısıt NOT VALID kalır, deploy durmaz ve
// `/api/admin/health` → `unvalidatedConstraints` onu gösterir. Bu araç satırları kayıt
// kayıt döker. ⚠️ NOT VALID kısıt, ihlalli satıra yapılan HER UPDATE'i reddeder.
//
// DÖRT SINIF:
//   A  seddi ihlal eden kolon hâli (tanım DB'deki kısıttan okunur, kopyası yok)
//   B  iptal edilmiş sevkiyata bağlı kartela — MEKANİK: çuvalı varsa `--apply`
//      SHIPMENT_REMOVED olayıyla çıkarır (tek yazar; olay satırı defterde kalır)
//   C  kabulü iptal edilmiş ama kendisi iptal edilmemiş kartela — yalnız listelenir
//   D  canlı (stornosuz) düşüm kalemindeki iptal edilmemiş kartela — yalnız listelenir
// C ve D veri kararıdır (iptal mi, geri alma mı); araç onları uydurmaz.
// `--apply` sonunda A sınıfı boşsa kısıtı VALIDATE eder.
// Sıra (2.11.0 yayın günü): kuru → kullanıcı onayı → `--apply`.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { SwatchEventType, SwatchStatus } from "@prisma/client";
import { hedefDbAdi } from "./lib/hedef-db-kapisi";
import { izDustuUyarisi, onarimIziYaz } from "./lib/onarim-izi";
import { transitionSwatchesTx } from "../src/services/helpers/swatch-event.helper";
import { readUnvalidatedConstraints } from "../src/lib/constraint-health";

const SCRIPT = "scripts/kartela_durum_anomali.ts";
const KISIT = "swatches_status_shape";
/** Tırnaklı kısıt adı — VALIDATE literali düz sabitle kurulur (`test_script_guards` "yalnız VALIDATE" muafiyeti). */
const KISIT_Q = '"swatches_status_shape"';
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const ONAY = Number((argv.find((a) => a.startsWith("--onay=")) ?? "").split("=")[1] ?? NaN);
const HEDEF = (argv.find((a) => a.startsWith("--hedef=")) ?? "").split("=")[1] ?? "";

interface Satir {
  id: string;
  cardNumber: string;
  status: SwatchStatus;
  sackId: string | null;
  sackNo: string | null;
  shipmentId: string | null;
  shipmentNo: string | null;
  cancelledAt: Date | null;
}

const SECIM = `
  SELECT sw.id, sw."cardNumber", sw.status, sw."sackId", sk."sackNo", sw."shipmentId", sh."shipmentNo", sw."cancelledAt"
    FROM swatches sw
    LEFT JOIN sacks sk ON sk.id = sw."sackId"
    LEFT JOIN shipments sh ON sh.id = sw."shipmentId"`;

/** Seddin tanımı DB'den: kuru döküm migration'ın kopyasını taşımaz. */
async function seddIfadesi(): Promise<string | null> {
  const r = await prisma.$queryRaw<Array<{ def: string }>>`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${KISIT}`;
  if (r.length === 0) return null;
  return r[0].def.replace(/^CHECK\s*/, "").replace(/\s+NOT VALID$/, "");
}

async function siniflar(): Promise<Record<"A" | "B" | "C" | "D", Satir[]>> {
  const ifade = await seddIfadesi();
  if (!ifade) throw new Error(`${KISIT} kısıtı DB'de yok — migration 20260926110000 uygulanmamış`);
  // İfade niteliksiz kolon adları taşır; birleştirmesiz alt sorguda değerlendirilir.
  const A = await prisma.$queryRawUnsafe<Satir[]>(
    `${SECIM} WHERE sw.id IN (SELECT id FROM swatches WHERE NOT ${ifade}) ORDER BY sw."cardNumber"`,
  );
  const B = await prisma.$queryRawUnsafe<Satir[]>(`${SECIM} WHERE sh.status = 'CANCELLED' ORDER BY sh."shipmentNo", sw."cardNumber"`);
  const C = await prisma.$queryRawUnsafe<Satir[]>(`${SECIM}
    JOIN kartela_receipts kr ON kr.id = sw."parentReceiptId"
   WHERE sw."cancelledAt" IS NULL AND kr."cancelledAt" IS NOT NULL ORDER BY sw."cardNumber"`);
  const D = await prisma.$queryRawUnsafe<Satir[]>(`${SECIM}
   WHERE sw."cancelledAt" IS NULL AND EXISTS (
     SELECT 1 FROM swatch_stock_reduction_items i JOIN swatch_stock_reductions r ON r.id = i."reductionId"
      WHERE i."swatchId" = sw.id AND r."reversedAt" IS NULL) ORDER BY sw."cardNumber"`);
  return { A, B, C, D };
}

/** B satırı ancak çuvalı varsa ve durum IN_SHIPMENT ise SHIPMENT_REMOVED ile çuvala iner. */
const duzeltilebilir = (s: Satir): boolean => s.status === SwatchStatus.IN_SHIPMENT && s.sackId !== null && s.shipmentId !== null;

function yaz(baslik: string, satirlar: Satir[], olay?: (s: Satir) => string): void {
  console.log(`\n── ${baslik}: ${satirlar.length}`);
  for (const s of satirlar) {
    console.log(
      `  ${s.cardNumber.padEnd(18)} ${String(s.status).padEnd(11)} çuval ${(s.sackNo ?? "—").padEnd(16)} ` +
        `sevkiyat ${(s.shipmentNo ?? "—").padEnd(16)} iptal ${s.cancelledAt?.toISOString().slice(0, 10) ?? "—"}` +
        (olay ? `  → ${olay(s)}` : ""),
    );
  }
}

async function main(): Promise<void> {
  const db = hedefDbAdi();
  console.log(`\n=== Kartela durum anomalileri — ${APPLY ? `UYGULAMA (onay=${ONAY}, hedef=${HEDEF})` : "KURU KOŞUM"} ===`);
  console.log(`HEDEF VERİTABANI: ${db}`);
  const nv = await readUnvalidatedConstraints();
  console.log(`${KISIT}: ${nv.includes(KISIT) ? "NOT VALID (eski satır taranmadı)" : "doğrulanmış"}`);

  const k = await siniflar();
  const aday = k.B.filter(duzeltilebilir);
  yaz("A · seddi ihlal eden kolon hâli (yalnız liste)", k.A);
  yaz("B · iptal sevkiyata bağlı", k.B, (s) =>
    duzeltilebilir(s) ? `yazılacak olay: SHIPMENT_REMOVED (IN_SHIPMENT → IN_SACK, çuval ${s.sackNo ?? s.sackId})` : "yalnız liste (çuvalsız ya da durum IN_SHIPMENT değil)");
  yaz("C · ölü kabulde canlı kartela (yalnız liste)", k.C);
  yaz("D · canlı düşümde iptal edilmemiş kartela (yalnız liste)", k.D);
  console.log(`\nDüzeltilecek (B, mekanik): ${aday.length}`);

  if (!APPLY) {
    console.log(`\nKURU KOŞUM — hiçbir şey yazılmadı.${aday.length || nv.includes(KISIT) ? ` Uygulamak için (kullanıcı onayıyla):\n  npx tsx ${SCRIPT} --apply --onay=${aday.length} --hedef=${db}` : ""}\n`);
    return;
  }
  if (!HEDEF || HEDEF !== db) { console.error(`❌ --hedef=${HEDEF || "(yok)"} ≠ çözülen veritabanı "${db}". Yazma YOK.`); process.exitCode = 1; return; }
  if (!Number.isFinite(ONAY) || ONAY !== aday.length) { console.error(`❌ ONAY UYUŞMUYOR: kuru koşum ${aday.length} kartela, --onay=${ONAY}. Yazma YOK.`); process.exitCode = 1; return; }

  const sevkiyatlar = [...new Set(aday.map((s) => s.shipmentId!))];
  let duzeltilen = 0;
  await prisma.$transaction(async (tx) => {
    for (const shipmentId of sevkiyatlar) {
      const ids = aday.filter((s) => s.shipmentId === shipmentId).map((s) => s.id);
      const gecen = await transitionSwatchesTx(tx, SwatchEventType.SHIPMENT_REMOVED, {
        scope: { ids },
        shipment: { id: shipmentId },
        ctx: { trigger: "ANOMALI_DUZELTME", reason: "anomali düzeltme · kartela_durum_anomali" },
      });
      duzeltilen += gecen.length;
    }
  });
  console.log(`✅ ${duzeltilen} kartela çuvalına indi (aday ${aday.length}); her biri için SHIPMENT_REMOVED satırı yazıldı.`);

  const kalanA = (await siniflar()).A.length;
  let dogrulandi = false;
  if (kalanA === 0 && (await readUnvalidatedConstraints()).includes(KISIT)) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "swatches" VALIDATE CONSTRAINT ${KISIT_Q}`);
    dogrulandi = true;
    console.log(`✅ ${KISIT} VALIDATE edildi.`);
  } else if (kalanA > 0) {
    console.log(`⚠️ A sınıfında ${kalanA} satır kaldı — ${KISIT} NOT VALID kalır; satırlar kullanıcı kararıyla düzeltilir.`);
  }

  const yazildi = await onarimIziYaz({
    script: SCRIPT,
    action: "SWATCH_STATUS_ANOMALY_FIX",
    tableName: "SWATCH",
    olcum: { aday: aday.length, duzeltilen, kalanA, siniflar: { A: k.A.length, B: k.B.length, C: k.C.length, D: k.D.length }, dogrulandi },
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
