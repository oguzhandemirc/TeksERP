// =============================================================================
// TEST: Refakat kartı — A5 varsayılan + yoğunluk profili + CANLI parti bloğu
// Çalıştır: npx tsx scripts/test_traveler_card_a5_batches.ts
// =============================================================================
// Üç ayrı sözleşmeyi birlikte kilitler; üçü de sessizce bozulabilecek türden:
//
//   A) A4 ÖLÇÜLERİ DEĞİŞMEDİ. Sayfa boyutuna bağlı ölçüler `traveler-card.density`
//      tablosuna taşındı. Taşıma sırasında bir sayı yanlış kopyalansa A4 kartı
//      "biraz farklı" basardı ve kimse fark etmezdi — çıktı yine geçerli HTML.
//      Bu yüzden A4 CSS'inde bilinen değerler BİREBİR aranır.
//   B) VARSAYILAN A5 ama DONMUŞ BELGE A4'e düşer. İki katmanın varsayılanı
//      bilerek farklı (bkz. density.ts) — biri ötekine uydurulursa ya yeni
//      kartlar A4 basar ya da geçmiş belgeler yeniden ölçeklenir.
//   C) PARTİ BLOĞU CANLI. Kart iş emri AÇILIŞINDA donar, parti `attachRolls`'ta
//      doğar. Parti snapshot'a yazılsaydı kartta HER ZAMAN boş çıkardı — bu
//      testin can alıcı kurulumu tam da o sıradır: önce kart, SONRA parti.
//
// NEGATİF SONDA — "kırmızı verebiliyor mu" KANITLANDI (2026-08-03, 7 sonda;
// her birinden sonra dosyalar md5 ile birebir geri yüklendi):
//   ① A4 `opRow` 24→25            → 1 düştü (A bölümü)
//   ② `resolveFrozenPageSize` A5  → 1 düştü (B: geçmiş belge korunması)
//   ③ resolveLiveBatches hep []   → 8 düştü (C bölümü toptan)
//   ④ `mergedIntoId` süzgeci yok  → 1 düştü (C7)
//   ⑤ K18 süzgeci yok             → 2 düştü (C4+C5)
//   ⑥ `?pageSize` yok sayılıyor   → 1 düştü (D1)
//   ⑦ parti CSS'i koşulsuz        → 2 düştü (E2+E3)
// Bu dosyayı değiştirirsen aynı yedisini TEKRARLA — kırmızı verdiği
// kanıtlanmamış bekçi, bekçi değil süstür.
// =============================================================================

import prisma from "../src/lib/prisma";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { renderTravelerCardHtml } from "../src/services/document-render/traveler-card.html";
import {
  DEFAULT_TRAVELER_CARD_CONFIG,
  normalizeTravelerCardConfig,
  type TravelerCardConfig,
} from "../src/services/system-setting.service";
import { DENSITY } from "../src/services/document-render/traveler-card.density";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { RollStatus, WorkOrderStatus } from "@prisma/client";

let pass = 0,
  fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fixture bulunamadı: ${what}`);
  return v;
}

const cards = new TravelerCardService();
const STAMP = Date.now().toString().slice(-6);
let ITEM = "",
  ADMIN = "",
  STATION = "",
  SUB = "";
const woIds: string[] = [];
const batchIds: string[] = [];
const rollIds: string[] = [];
const dispatchIds: string[] = [];

/** Minimal snapshot — renderer'ı DB'siz sınamak için (A/B bölümleri). */
function snap(config: Partial<TravelerCardConfig>): Parameters<typeof renderTravelerCardHtml>[0] {
  return {
    config: config as TravelerCardConfig,
    workOrderNumber: "IE0308260001",
    type: "STOCK_PRODUCTION",
    width: 150,
    targetQuantity: 100,
    targetWeight: null,
    foldType: null,
    plannedStartDate: null,
    plannedEndDate: null,
    routeTemplate: null,
    targetItem: null,
    targetColor: null,
    targetProperties: [],
    steps: [],
    orderLinks: [],
  };
}
const META = { cardNumber: "IE0308260001", barcode: "IE0308260001", version: 1, printedAt: "2026-08-03T09:00:00.000Z" };

// ── A) A4 ölçüleri (bilinen değerler — taşıma sırasında kaymamalı) ───────────
// Her satır: CSS'te BİREBİR bulunması gereken metin + ne olduğu.
const A4_EXPECT: [string, string][] = [
  ["font-size: 9.5px; font-weight: 400", "gövde taban yazı boyu"],
  ["font-size: 70px", "filigran"],
  ["font-size: 15px; font-weight: 800", "firma adı"],
  ["font-size: 24px; font-weight: 800", "iş emri no"],
  ["width: 124px", "QR kutusu"],
  ["width: 102px; height: 102px", "QR görseli"],
  ["padding: 4px 6px", "spec hücre payı"],
  ["font-size: 11px; font-weight: 600", "spec hücre değeri"],
  ["height: 24px", "operasyon satır yüksekliği"],
  ["width: 132px", "operasyon istasyon sütunu"],
  ["width: 150px; font-weight: 600", "sipariş müşteri sütunu"],
];

async function resolveFixtures(): Promise<void> {
  ITEM = need(await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } }), "aktif kumaş").id;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin").id;
  STATION = need(
    await prisma.station.findFirst({ where: { isActive: true }, select: { id: true } }),
    "aktif istasyon",
  ).id;
  SUB = (await ensureTestDyeHouse()).id;
}

async function makeWo(n: number): Promise<string> {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-A5-${STAMP}-${n}`,
      type: "STOCK_PRODUCTION",
      status: WorkOrderStatus.IN_PROGRESS,
      width: 150,
      targetQuantity: 100,
      targetItemId: ITEM,
      steps: { create: [{ stationId: STATION, stepSequence: 1, status: "PENDING" as const }] },
    },
  });
  woIds.push(wo.id);
  return wo.id;
}

async function makeBatch(woId: string, no: string, opts?: { mergedIntoId?: string }): Promise<string> {
  const b = await prisma.batch.create({
    data: { batchNumber: no, workOrderId: woId, mergedIntoId: opts?.mergedIntoId ?? null },
    select: { id: true },
  });
  batchIds.push(b.id);
  return b.id;
}

async function makeRoll(batchId: string, qty: number, status: RollStatus): Promise<void> {
  const r = await prisma.roll.create({
    data: {
      barcode: `TSTA5${STAMP}${rollIds.length}`,
      itemId: ITEM,
      initialQty: qty,
      currentQty: qty,
      status,
      batchId,
    },
    select: { id: true },
  });
  rollIds.push(r.id);
}

async function makeDispatch(
  woId: string,
  batchId: string,
  no: string,
  opts?: { cancelled?: boolean; at?: Date },
): Promise<void> {
  const step = need(
    await prisma.workOrderStep.findFirst({ where: { workOrderId: woId }, select: { id: true } }),
    "wo step",
  );
  const d = await prisma.subcontractorDispatch.create({
    data: {
      dispatchNo: no,
      workOrderId: woId,
      batchId,
      stepId: step.id,
      subcontractorId: SUB,
      dispatchedAt: opts?.at ?? new Date(),
      cancelledAt: opts?.cancelled ? new Date() : null,
    },
    select: { id: true },
  });
  dispatchIds.push(d.id);
}

async function run(): Promise<void> {
  console.log("\n=== A) A4 ölçüleri taşıma sonrası DEĞİŞMEDİ ===");
  const a4 = renderTravelerCardHtml(snap({ ...DEFAULT_TRAVELER_CARD_CONFIG, pageSize: "A4" }), META);
  for (const [needle, what] of A4_EXPECT) {
    check(`A4 ${what}`, a4.includes(needle), needle);
  }
  // Körlük zemini: yukarıdaki aramalar boş bir çıktıda da "bulunamadı" derdi —
  // gerçekten bir kart mı ölçüyoruz?
  check("A4 çıktısı gerçekten kart (körlük zemini)", a4.includes("REFAKAT KARTI") && a4.length > 4000, `len=${a4.length}`);

  console.log("\n=== B) Varsayılan A5, DONMUŞ belge A4'e düşer ===");
  check("kod varsayılanı A5", DEFAULT_TRAVELER_CARD_CONFIG.pageSize === "A5");
  check("normalize({}) → A5", normalizeTravelerCardConfig({}).pageSize === "A5");
  check("normalize({pageSize:'A4'}) → A4 (açık seçim korunur)", normalizeTravelerCardConfig({ pageSize: "A4" }).pageSize === "A4");
  const legacy = renderTravelerCardHtml(snap({}), META); // pageSize taşımayan ESKİ snapshot
  check(
    "pageSize'sız donmuş snapshot → A4 (geçmiş belge yeniden ölçeklenmez)",
    legacy.includes("@page { size: A4"),
  );
  const a5 = renderTravelerCardHtml(snap({ ...DEFAULT_TRAVELER_CARD_CONFIG }), META);
  check("varsayılan config → A5 sayfa", a5.includes("@page { size: A5"));
  check("A5 profili A4'ten SIKI (taban yazı)", DENSITY.A5.base < DENSITY.A4.base, `${DENSITY.A5.base} < ${DENSITY.A4.base}`);
  check("A5 profili A4'ten SIKI (operasyon satırı)", DENSITY.A5.opRow < DENSITY.A4.opRow, `${DENSITY.A5.opRow} < ${DENSITY.A4.opRow}`);
  check("A5 gövde tabanı profilden geliyor", a5.includes(`font-size: ${DENSITY.A5.base}px`));

  console.log("\n=== C) Parti bloğu CANLI çözülür ===");
  // C1) KURULUM SIRASI KRİTİK: önce kart (WO açılışı), SONRA parti.
  const w1 = await makeWo(1);
  const card = need((await cards.print(w1, ADMIN)).data, "kart");
  // ⚠️ Snapshot'ta "batchNumber" metnini ARAMA: donmuş `config` artık
  // `batchFields.batchNumber` GÖRÜNÜM ayarını taşıyor → arama kendi ayarımıza
  // takılır ve test hep kırmızı verir. Sorulan şey VERİ: `snapshot.batches`.
  const frozenBatches = (s: unknown) => (s as { batches?: unknown } | null)?.batches;
  const before = need(
    await prisma.travelerCard.findUnique({ where: { id: card.id }, select: { snapshot: true } }),
    "snapshot",
  ).snapshot;
  check("kart donduğunda snapshot'ta parti VERİSİ yok", frozenBatches(before) === undefined);

  const b1 = await makeBatch(w1, `TSTP${STAMP}01`);
  await makeRoll(b1, 400, RollStatus.IN_PRODUCTION);
  await makeRoll(b1, 300, RollStatus.IN_PRODUCTION);
  await makeRoll(b1, 999, RollStatus.CANCELLED); // K18 ölü → sayıma girmemeli
  await makeDispatch(w1, b1, `TSTFS${STAMP}01`);

  const html = await cards.getCardHtml(card.id);
  check("C1 kart donduktan SONRA doğan parti kartta görünüyor", html.includes(`TSTP${STAMP}01`));
  check("C2 PARTİLER başlığı basıldı", html.includes("PARTİLER (1)"));
  check("C3 sevk (firma · irsaliye) basıldı", html.includes(`TSTFS${STAMP}01`));
  check("C4 top adedi K18 ölüyü DIŞLIYOR (2, 3 değil)", />2</.test(html) && !html.includes(">3</td>"), "iptal top sayılmamalı");
  check("C5 metraj K18 ölüyü DIŞLIYOR (700 m)", html.includes("700 m") && !html.includes("1.699 m"));
  const after = need(
    await prisma.travelerCard.findUnique({ where: { id: card.id }, select: { snapshot: true } }),
    "snapshot2",
  ).snapshot;
  check("C6 donmuş snapshot HÂLÂ partisiz (canlı çözüm karta yazmadı)", frozenBatches(after) === undefined);
  check("C6b snapshot hiç değişmedi (baskı yan etkisiz)", JSON.stringify(after) === JSON.stringify(before));

  // C6b) birleşmiş parti tarihçedir → basılmaz
  const b2 = await makeBatch(w1, `TSTP${STAMP}02`, { mergedIntoId: b1 });
  await makeRoll(b2, 50, RollStatus.IN_PRODUCTION);
  const html2 = await cards.getCardHtml(card.id);
  check("C7 birleşmiş parti (mergedIntoId) BASILMAZ", !html2.includes(`TSTP${STAMP}02`) && html2.includes("PARTİLER (1)"));

  // C8) iptal edilmiş sevk görünmez; birden çok açık sevkte en yenisi + (+N)
  const w2 = await makeWo(2);
  const card2 = need((await cards.print(w2, ADMIN)).data, "kart2");
  const b3 = await makeBatch(w2, `TSTP${STAMP}03`);
  await makeRoll(b3, 120, RollStatus.IN_PRODUCTION);
  await makeDispatch(w2, b3, `TSTFS${STAMP}90`, { cancelled: true });
  await makeDispatch(w2, b3, `TSTFS${STAMP}91`, { at: new Date(Date.now() - 60_000) });
  await makeDispatch(w2, b3, `TSTFS${STAMP}92`, { at: new Date() });
  const html3 = await cards.getCardHtml(card2.id);
  check("C8 iptal edilmiş sevk basılmaz", !html3.includes(`TSTFS${STAMP}90`));
  check("C9 en YENİ açık sevk basılır", html3.includes(`TSTFS${STAMP}92`));
  check("C10 önceki açık sevk (+N) ile sayılır", html3.includes("(+1)") && !html3.includes(`TSTFS${STAMP}91`));

  console.log("\n=== D) Tek seferlik ?pageSize ezmesi ===");
  // ⚠️ Kartın kendi boyutu ORTAMIN kayıtlı ayarına bağlıdır (bu geliştirme
  // DB'sinde A4, temiz kurulumda A5) → beklenen değeri SABİTLEME. Sözleşme
  // "ezme kartın boyutunu ne olursa olsun DEĞİŞTİRİR ve GERİ YAZMAZ"dır;
  // test kartın kendi boyutunu okuyup TERSİNİ ezer → her ortamda aynı şeyi ölçer.
  const pageOf = (h: string) => /@page \{ size: (A4|A5)/.exec(h)?.[1] ?? "?";
  const defaultHtml = await cards.getCardHtml(card2.id);
  const own = pageOf(defaultHtml);
  const other = own === "A4" ? "A5" : "A4";
  check("D0 kartın kendi boyutu çözülebildi", own === "A4" || own === "A5", own);
  const overridden = await cards.getCardHtml(card2.id, { pageSize: other });
  check(`D1 ezme uygulandı (${own} → ${other})`, pageOf(overridden) === other);
  check("D2 ezme SONRASI ezmesiz baskı yine kartın kendi boyutu", pageOf(await cards.getCardHtml(card2.id)) === own);
  const afterOverride = need(
    await prisma.travelerCard.findUnique({ where: { id: card2.id }, select: { snapshot: true, version: true } }),
    "kart2 sonrası",
  );
  const snapPage = (afterOverride.snapshot as { config?: { pageSize?: string } } | null)?.config?.pageSize;
  check("D3 ezme snapshot'a YAZILMADI", snapPage === own, `snapshot=${snapPage}, kart=${own}`);
  check("D4 ezme yeni versiyon doğurmadı", afterOverride.version === 1, `v${afterOverride.version}`);

  console.log("\n=== E) Blok kapalıyken tek bayt basılmaz ===");
  const off = renderTravelerCardHtml(
    { ...snap({ ...DEFAULT_TRAVELER_CARD_CONFIG, showBatches: false }) },
    { ...META, batches: [{ batchNumber: "P1", rollCount: 1, quantity: 10, dispatch: null }] },
  );
  check("E1 showBatches=false → tablo yok", !off.includes("PARTİLER"));
  check("E2 showBatches=false → CSS de yok (koşullu emit)", !off.includes(".bat {"));
  const noBatches = renderTravelerCardHtml(snap({ ...DEFAULT_TRAVELER_CARD_CONFIG }), META);
  check("E3 partisi olmayan iş emrinde blok hiç doğmaz", !noBatches.includes("PARTİLER") && !noBatches.includes(".bat {"));
}

async function cleanup(): Promise<void> {
  const cardRows = await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const cardIds = cardRows.map((c) => c.id);
  await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardIds } } });
  await prisma.travelerCard.deleteMany({ where: { id: { in: cardIds } } });
  await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  // Merge bağı olan partiler önce çözülmeli (self-FK).
  await prisma.batch.updateMany({ where: { id: { in: batchIds } }, data: { mergedIntoId: null } });
  await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
}

/**
 * §PX — SAYISAL PUNTO da sayfa boyutuna göre ölçeklenir (2026-08-09).
 *
 * Profil KADEME sistemini (sm/md/lg) sayfa boyutuna bağlamıştı ve dosyanın
 * başındaki not bunu açıkça uyarıyordu. 2026-08-05'te panel tek birime (sayısal
 * `px`) geçince o koruma DELİNDİ: `f.px` haritayı atlayıp doğrudan inline stile
 * yazılıyordu.
 *
 * ÖLÇÜLDÜ (gerçek kayıtlı ayar, `traveler.cardConfig`): parti no `px: 27` +
 * `fontScale: 1.15` → A4'te 31,05px (bilinçli, 194mm yazı alanında okunur) ama
 * A5'te de AYNI 31,05px — 132mm alanda uzun parti no üç satıra sarıyor ve
 * sayfanın dörtte birini yiyordu. Hata yok, log yok; yalnız kâğıt bozuk.
 */
function runPxScale(): void {
  console.log("\n=== PX) Sayısal punto sayfa boyutuna göre ölçeklenir ===");

  const withPx = (pageSize: "A4" | "A5"): string =>
    renderTravelerCardHtml(
      snap({
        ...DEFAULT_TRAVELER_CARD_CONFIG,
        pageSize,
        // Sahadaki gerçek ayarın birebir aynısı.
        batchFields: {
          batchNumber: { show: true, size: "md", weight: "black", px: 27 },
        },
      } as unknown as Partial<TravelerCardConfig>),
      { ...META, batches: [{ batchNumber: "P2207260001", rollCount: 2, quantity: 480, dispatch: null }] },
    );

  const a4 = withPx("A4");
  const a5 = withPx("A5");

  // A4 = 1 ölçek → panelde girilen değer AYNEN basılır (canlı çıktı korunur).
  check("A4'te sayısal punto AYNEN basılır (27px)", a4.includes("font-size:27px"), "27px");
  // A5 = 8/9.5 ≈ 0,842 → 27 * 0,842 = 22,74
  check(
    "⭐ A5'te sayısal punto ÖLÇEKLENİR (27 → 22.74px)",
    a5.includes("font-size:22.74px"),
    "profil atlanırsa burada da 27px çıkar — sahadaki hata tam olarak buydu",
  );
  check("A5'te ham 27px KALMADI", !a5.includes("font-size:27px"));
  // Kalınlık ölçekten ETKİLENMEZ — o bir punto değil, ağırlık kademesi.
  check("kalınlık iki boyutta da aynı (900)", a4.includes("font-weight:900") && a5.includes("font-weight:900"));
  // Körlük zemini: override hiç basılmıyorsa yukarıdaki "kalmadı" kontrolü
  // VAKUMEN yeşil kalırdı.
  check(
    "körlük zemini: override gerçekten basılıyor",
    /class="b-no" style="font-size:[\d.]+px/.test(a5),
    "b-no hücresinde inline stil var",
  );
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    await run();
    runPxScale();
  } finally {
    await cleanup();
    console.log("(test verisi temizlendi)");
  }
  console.log("──────────────────────────────────────────");
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
