// =============================================================================
// GERİ DOLDURMA — `Roll.stage` (top aşaması, 2026-11-10)
// =============================================================================
// Migration `20261110120000_roll_stage` kolonu tohumla doldurdu (renkli → FINISHED, renksiz → RAW).
// Bu betik migration ÖNCESİ doğmuş toplara statü + giriş kaynağı + soydan aşama yazar (kurallar
// `scripts/lib/roll-stage-backfill.ts` başlığında; bekçi `test_roll_asama_geri_doldurma`).
//
//   npx tsx scripts/backfill_roll_stage.ts                                   # KURU KOŞUM (yazmaz)
//   npx tsx scripts/backfill_roll_stage.ts --apply                           # fixture DB'de yazar
//   npx tsx scripts/backfill_roll_stage.ts --apply --canli-onay              # fixture dışı (demo/fabrika)
//   … --renkli-stok=RAW|SEMI_FINISHED                                        # belirsiz kovayı (renkli STOCK) yazar
//
// ⚠️ Renkli STOCK top "belirsiz"dir (boyalı ham mı, yarı mamul mü, stoğa dönmüş bitmiş mi bilinemez):
//    varsayılan KORU — tohum (FINISHED) kalır, liste basılır; karar `--renkli-stok` ile verilir.
// ⚠️ Kesimden (migration bitişi) sonra güncellenmiş top yazılmaz: aşamayı kod yazmış olabilir.
// ⚠️ İkinci koşum 0 yazar (idempotent).
// =============================================================================
import { RollStage } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { fixtureHedefEngeli, hedefDbAdi, YAZILMASI_YASAK_DB } from "./lib/hedef-db-kapisi";
import { izDustuUyarisi, onarimIziYaz } from "./lib/onarim-izi";
import { planla, uygula, type PlanSatiri } from "./lib/roll-stage-backfill";

const APPLY = process.argv.includes("--apply");
const CANLI_ONAY = process.argv.includes("--canli-onay");
const RENKLI_ARG = process.argv.find((a) => a.startsWith("--renkli-stok="))?.slice("--renkli-stok=".length) ?? null;
const LISTE_TAVANI = 500;
const ETIKET: Record<RollStage, string> = { RAW: "Ham", SEMI_FINISHED: "Yarı mamul", FINISHED: "Bitmiş" };

function bas(baslik: string, satirlar: PlanSatiri[]): void {
  console.log(`\n── ${baslik} (${satirlar.length}) ──`);
  for (const s of satirlar.slice(0, LISTE_TAVANI)) {
    console.log(`  ${s.barcode ?? s.id}  [${s.status}]  ${ETIKET[s.eski]} → ${ETIKET[s.yeni]}  (${s.kural})`);
  }
  if (satirlar.length > LISTE_TAVANI) console.log(`  … ve ${satirlar.length - LISTE_TAVANI} kayıt daha`);
}

async function main(): Promise<void> {
  console.log(`\n🎯 Hedef veritabanı: ${hedefDbAdi()}`);
  if (RENKLI_ARG && RENKLI_ARG !== RollStage.RAW && RENKLI_ARG !== RollStage.SEMI_FINISHED) {
    console.error("\n⛔ --renkli-stok yalnız RAW ya da SEMI_FINISHED olabilir.\n");
    process.exitCode = 1;
    return;
  }
  const renkliStok = (RENKLI_ARG as RollStage | null) ?? null;
  const fixtureDisi = fixtureHedefEngeli();
  if (APPLY && (fixtureDisi || YAZILMASI_YASAK_DB.has(hedefDbAdi())) && !CANLI_ONAY) {
    console.error(`\n⛔ --apply DURDURULDU — hedef fixture kalıbında değil.\n   ${fixtureDisi ?? ""}\n   Bilerek koşuyorsan: --apply --canli-onay\n`);
    process.exitCode = 1;
    return;
  }
  console.log(APPLY ? "▶ UYGULAMA MODU (yazacak)" : "▶ KURU KOŞUM (hiçbir şey yazılmaz)");

  const plan = await planla(prisma, { renkliStok });
  console.log(`Kesim (migration bitişi): ${plan.kesim.toISOString()}`);
  console.log(`Aday (kesimden önce doğmuş top): ${plan.aday}`);
  console.log("\nKural başına (değişmeyen dahil):");
  for (const [k, n] of Object.entries(plan.kuralSayisi).sort()) console.log(`  ${k.padEnd(26)} ${n}`);
  console.log(`\nYazılacak                       : ${plan.yazilacak.length}`);
  console.log(`Atlanan (kesimden sonra dokunulmuş): ${plan.atlananKesimSonrasi.length}`);
  console.log(`Belirsiz (renkli STOCK, KORU)   : ${plan.belirsiz.length}${renkliStok ? " — --renkli-stok verildi, yazılacaklara katıldı" : ""}`);

  bas("Yazılacak kayıtlar", plan.yazilacak);
  if (plan.atlananKesimSonrasi.length) bas("Atlanan — kesimden sonra güncellenmiş", plan.atlananKesimSonrasi);
  if (plan.belirsiz.length) bas("Belirsiz — renkli STOCK (tohum korunur; karar için --renkli-stok)", plan.belirsiz);

  if (!APPLY) {
    console.log("\n⚠️ KURU KOŞUM — hiçbir şey yazılmadı. Yazmak için: --apply (fixture dışında --apply --canli-onay)");
    return;
  }
  const yazilan = await uygula(prisma, plan);
  console.log(`\n✔ ${yazilan} top güncellendi (planlanan ${plan.yazilacak.length}; fark = koşum sırasında dokunulan).`);

  const SCRIPT = "scripts/backfill_roll_stage.ts";
  const iz = await onarimIziYaz({
    script: SCRIPT,
    action: "ROLL_STAGE_BACKFILL",
    tableName: "ROLL",
    olcum: {
      guncellenen: yazilan, planlanan: plan.yazilacak.length, aday: plan.aday,
      atlananKesimSonrasi: plan.atlananKesimSonrasi.length, belirsizKalan: renkliStok ? 0 : plan.belirsiz.length,
      renkliStok: renkliStok ?? "KORU", kesim: plan.kesim.toISOString(), kuralSayisi: plan.kuralSayisi,
    },
  });
  if (!iz) {
    console.error(izDustuUyarisi(SCRIPT, false));
    process.exitCode = 1;
  }
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
