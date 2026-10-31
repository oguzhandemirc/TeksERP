// =============================================================================
// KART FİRESİ BEKÇİSİ (SY-C1) — çözgü firesi öncelik zinciri ELLE > YAPI > KART > PARAMETRE
// =============================================================================
// `WarpSpec.wastePct` (MİG-1) derleyicinin `firstOf` zincirine YAPI ile PARAMETRE arasında girer;
// kart boşken girdi bugünküyle bayt-aynıdır (Adnan Şahin / dokuma sıfır fark). DB'li (yalnız test DB).
//   §1 dört fikstür (tasarım §16.1 numarası): 1 ELLE · 2 YAPI · 3 KART · 4 PARAMETRE
//   §2 bayt-aynı: kart boş → hash değişmez; YAPI varken kart değeri girdiyi değiştirmez
//   §3 motor: kart firesi çözgü maliyetini artırır (fire böleni gerçekten kullanılır)
//   §4 yazım yolu: genel CRUD `wastePct` yazar; aralık dışı / sayı değil → 400; null temizler
// Koşum: npx tsx scripts/test_kart_firesi.ts
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { assembleCostInputTx } from "../src/services/helpers/cost-assembler.helper";
import { computeFabricCost } from "../src/services/helpers/fabric-cost.helper";
import { costInputHash } from "../src/services/helpers/cost-snapshot.helper";
import { warpSpecService } from "../src/routes/warp-spec.routes";
import { altinYapiYaz, fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";
import { assertGelistirmeVeritabani } from "./db-guard";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);
const asm = (itemId: string, o?: Parameters<typeof assembleCostInputTx>[2]) =>
  prisma.$transaction((tx) => assembleCostInputTx(tx, { itemId }, o));
const sv = (s: { value: Prisma.Decimal | null; source: string } | undefined) => `${s?.value?.toString() ?? "null"}/${s?.source}`;
const setCard = (f: MaliyetFikstur, v: Prisma.Decimal | null) => prisma.warpSpec.update({ where: { id: f.warpSpecId }, data: { wastePct: v } });

async function bolum1ve2ve3(f: MaliyetFikstur): Promise<void> {
  const p = await asm(f.fabricId);
  const h0 = costInputHash(p);
  check("§1a Fikstür 4 (PARAMETRE) — kart/yapı/ezme yok: PARAMETRE", sv(p.warp?.wastePct) === "2/PARAMETRE", sv(p.warp?.wastePct));

  await setCard(f, D("4.5"));
  const k = await asm(f.fabricId);
  check("§1b Fikstür 3 (KART) — kart firesi var, yapı yok: KART", sv(k.warp?.wastePct) === "4.5/KART", sv(k.warp?.wastePct));
  const usd = { USD: D(34) };
  const warpP = computeFabricCost(p, usd).result?.warpKgPerM;
  const warpK = computeFabricCost(k, usd).result?.warpKgPerM;
  check("§3 Kart firesi motorda çözgü kg/m'yi artırır (fire böleni)", !!warpP && !!warpK && warpK.gt(warpP), `${warpP?.toFixed(4)} → ${warpK?.toFixed(4)}`);

  await altinYapiYaz(f);
  const y = await asm(f.fabricId);
  check("§1c Fikstür 2 (YAPI) — yapı firesi kartı yener: YAPI", sv(y.warp?.wastePct) === "2.5/YAPI", sv(y.warp?.wastePct));

  const e = await asm(f.fabricId, { warpWastePct: D("1.7") });
  check("§1d Fikstür 1 (ELLE) — ELLE ezme hepsini yener", sv(e.warp?.wastePct) === "1.7/ELLE", sv(e.warp?.wastePct));

  // Yapıda çözgü firesi boşaltılınca kart yeniden kazanır (KART katmanı YAPI'nın ALTINDA, PARAMETRE'nin ÜSTÜNDE).
  await prisma.costStructure.update({ where: { itemId: f.fabricId }, data: { warpWastePct: null } });
  const k2 = await asm(f.fabricId);
  check("§1e Yapıda çözgü firesi boş → kart (KART), diğer yapı alanları YAPI kalır", sv(k2.warp?.wastePct) === "4.5/KART" && sv(k2.weft?.wastePct) === "3/YAPI", sv(k2.warp?.wastePct));

  await prisma.costStructure.update({ where: { itemId: f.fabricId }, data: { warpWastePct: D("2.5") } });
  const withCard = costInputHash(await asm(f.fabricId));
  await setCard(f, null);
  const noCard = costInputHash(await asm(f.fabricId));
  check("§2a YAPI varken kart firesi girdiyi değiştirmez (hash aynı)", withCard === noCard);
  await prisma.costStructure.delete({ where: { itemId: f.fabricId } });
  check("§2b Kart boş → girdi bugünküyle bayt-aynı (hash = ilk ölçüm)", costInputHash(await asm(f.fabricId)) === h0);
}

async function bolum4(f: MaliyetFikstur): Promise<void> {
  const code = async (fn: () => Promise<unknown>) =>
    fn().then(() => "ok", (e: { statusCode?: number }) => String(e.statusCode ?? "?"));
  for (const bad of [100, -1, "abc"]) {
    check(`§4a Aralık dışı fire (${bad}) → 400`, (await code(() => warpSpecService.update(f.warpSpecId, { wastePct: bad }))) === "400");
  }
  check("§4b Genel CRUD fireyi yazar (write-guard açık)", (await code(() => warpSpecService.update(f.warpSpecId, { wastePct: "3.25" }))) === "ok");
  const row = await prisma.warpSpec.findUniqueOrThrow({ where: { id: f.warpSpecId }, select: { wastePct: true } });
  check("§4c Yazılan değer DB'de ve zincirde KART", row.wastePct?.eq(D("3.25")) === true && sv((await asm(f.fabricId)).warp?.wastePct) === "3.25/KART");
  check("§4d null fireyi temizler", (await code(() => warpSpecService.update(f.warpSpecId, { wastePct: null }))) === "ok");
  check("§4e Temizlenince PARAMETRE'ye döner", sv((await asm(f.fabricId)).warp?.wastePct) === "2/PARAMETRE");
}

async function main(): Promise<void> {
  console.log("=== KART FİRESİ BEKÇİSİ (SY-C1) ===");
  assertGelistirmeVeritabani("test_kart_firesi");
  const f = await fiksturKur("MKF");
  try {
    await bolum1ve2ve3(f);
    await bolum4(f);
  } finally {
    await fiksturSil(f);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
