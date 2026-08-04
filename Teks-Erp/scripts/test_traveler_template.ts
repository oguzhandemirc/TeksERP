// =============================================================================
// TEST: Refakat kartı ŞABLONU — üç kademe + dondurma + sanitizasyon (Faz 2)
// Çalıştır: npx tsx scripts/test_traveler_template.ts
// =============================================================================
// Faz 2, kartın basımına KULLANICI YAZIMI içerik sokar. Sessizce bozulabilecek
// altı sözleşme burada kilitleniyor:
//
//   A) ŞABLONSUZ KURULUM DEĞİŞMEDİ. Tablo boşken kart Faz 2 öncesiyle aynı
//      basılmalı — özellik "kurulur kurulmaz" hiçbir şeyi değiştirmemeli.
//   B) BÖLÜM SIRASI gerçekten render'a yansıyor + tanınmayan/eksik bölüm
//      güvenle çözülüyor (yeni bölüm eski kayıtlı sırada YUTULMUYOR).
//   C) UZMAN MODU: {{alan}} ikamesi, {{#liste}} döngüleri, HTML kaçırma,
//      ham SVG'nin kaçırılmaması.
//   D) SANİTİZASYON gerçekten kesiyor — hem kayıtta hem render'da.
//   E) ŞABLON KARTA DONUYOR: basılmış kart, şablon sonradan değişse de aynı
//      çıkıyor; reprint yeni şablonu alıyor.
//   F) FAIL-CLOSED: çözülemeyen şablon 404 — sessizce yerleşiğe SAPMIYOR.
//
// NEGATİF SONDA — "kırmızı verebiliyor mu" KANITLANDI (2026-08-03; her sondadan
// sonra dosyalar md5 ile birebir geri yüklendi):
//   ① sanitizeTemplateHtml gövdesi `return html` yapıldı        → 2 kontrol düştü (D1, D4)
//   ② renderTravelerCard RAW_HTML dalı devre dışı               → 5 kontrol düştü (C1–C6)
//   ③ resolveSectionOrder eksik bölümü sona EKLEMEZ yapıldı     → B düştü (1 kontrol)
//   ④ resolveForPrint çözülemeyen şablonda yerleşiğe düşürüldü  → F düştü (2 kontrol)
//   ⑤ getCardHtml snapshot.template yerine canlı şablon okudu   → E düştü (1 kontrol)
// Bu dosyayı değiştirirsen aynı beşini TEKRARLA.
// =============================================================================

import prisma from "../src/lib/prisma";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { TravelerTemplateService } from "../src/services/traveler-template.service";
import { renderTravelerCard } from "../src/services/document-render/traveler-card.html";
import { resolveSectionOrder, TRAVELER_SECTION_KEYS } from "../src/services/document-render/traveler-card.sections";
import { sanitizeTemplateHtml, describeSanitization } from "../src/services/document-render/traveler-card-raw";
import { DEFAULT_TRAVELER_CARD_CONFIG, normalizeTravelerCardConfig } from "../src/services/system-setting.service";
import { WorkOrderStatus } from "@prisma/client";

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
const templates = new TravelerTemplateService();
const STAMP = Date.now().toString().slice(-6);
let ITEM = "",
  ADMIN = "",
  STATION = "";
const woIds: string[] = [];
const tplIds: string[] = [];

const META = { cardNumber: "IE0308260001", barcode: "IE0308260001", version: 1, printedAt: "2026-08-03T09:00:00.000Z" };
const SNAP_BASE = {
  workOrderNumber: "IE0308260001",
  type: "STOCK_PRODUCTION",
  width: 150,
  targetQuantity: 100,
  targetWeight: null,
  foldType: null,
  plannedStartDate: null,
  plannedEndDate: null,
  routeTemplate: null,
  targetItem: { code: "KMS-1", name: 'Astar <b>"x"</b>' },
  targetColor: { name: "Bej", hex: null },
  targetProperties: [],
  steps: [
    { id: "s1", stepSequence: 1, isUrgent: false, notes: null, station: { name: "KK1", type: "INTERNAL" }, plannedSubcontractor: null },
    { id: "s2", stepSequence: 2, isUrgent: false, notes: null, station: { name: "Boyahane", type: "EXTERNAL" }, plannedSubcontractor: { id: "x", name: "Yıldız" } },
  ],
  orderLinks: [],
};

async function resolveFixtures(): Promise<void> {
  ITEM = need(await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } }), "aktif kumaş").id;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin").id;
  STATION = need(await prisma.station.findFirst({ where: { isActive: true }, select: { id: true } }), "aktif istasyon").id;
}

async function makeWo(n: number): Promise<string> {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-TPL-${STAMP}-${n}`,
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

async function run(): Promise<void> {
  console.log("\n=== A) Şablonsuz kurulum: yerleşik kart (Faz 2 öncesiyle aynı) ===");
  const builtin = renderTravelerCard({ ...SNAP_BASE, config: DEFAULT_TRAVELER_CARD_CONFIG } as never, META);
  check("A1 yerleşik CSS yüklendi", builtin.includes("REFAKAT KARTI") && builtin.includes(".topbar"));
  check("A2 bölümler varsayılan sırada", builtin.indexOf("REFAKAT KARTI") < builtin.indexOf("OPERASYON KAYDI"));
  const noTpl = renderTravelerCard({ ...SNAP_BASE, config: DEFAULT_TRAVELER_CARD_CONFIG, template: undefined } as never, META);
  check("A3 template alanı yokken de yerleşik", noTpl === builtin);
  const builtinMode = renderTravelerCard(
    { ...SNAP_BASE, config: DEFAULT_TRAVELER_CARD_CONFIG, template: { id: null, name: "Y", mode: "BUILTIN", html: null } } as never,
    META,
  );
  check("A4 BUILTIN modu yerleşikle BİREBİR aynı", builtinMode === builtin);

  console.log("\n=== B) Bölüm sırası ===");
  const reordered = normalizeTravelerCardConfig({
    ...DEFAULT_TRAVELER_CARD_CONFIG,
    sections: [{ key: "operations" }, { key: "header" }],
  });
  const rOut = renderTravelerCard({ ...SNAP_BASE, config: reordered } as never, META);
  check("B1 operasyon artık antetten ÖNCE", rOut.indexOf("OPERASYON KAYDI") < rOut.indexOf("REFAKAT KARTI"));
  const off = normalizeTravelerCardConfig({
    ...DEFAULT_TRAVELER_CARD_CONFIG,
    sections: [{ key: "operations", enabled: false }],
  });
  check("B2 kapatılan bölüm basılmıyor", !renderTravelerCard({ ...SNAP_BASE, config: off } as never, META).includes("OPERASYON KAYDI"));
  const partial = resolveSectionOrder([{ key: "footer" }, { key: "uydurma" }]);
  check("B3 tanınmayan anahtar atıldı", !partial.some((s) => String(s.key) === "uydurma"));
  check("B4 eksik bölümler SONA eklendi (yeni bölüm yutulmuyor)", partial.length === TRAVELER_SECTION_KEYS.length && partial[0]?.key === "footer");
  check("B5 sections yokken varsayılan sıra", resolveSectionOrder(undefined).map((s) => s.key).join() === TRAVELER_SECTION_KEYS.join());

  console.log("\n=== C) Uzman modu (RAW_HTML) ===");
  const rawTpl = `<h1>{{itemName}}</h1><i>{{workOrderNumber}}</i><div>{{qrSvg}}</div>
<table>{{#steps}}<tr><td>{{seq}}</td><td>{{stationName}}</td><td>{{subcontractorName}}</td></tr>{{/steps}}</table>
<p>[{{yokBoyleAlan}}]</p>`;
  const raw = renderTravelerCard(
    { ...SNAP_BASE, config: DEFAULT_TRAVELER_CARD_CONFIG, template: { id: null, name: "U", mode: "RAW_HTML", html: rawTpl } } as never,
    { ...META, qrSvg: "<svg id='q'></svg>" },
  );
  check("C1 yerleşik CSS YÜKLENMEDİ", !raw.includes("REFAKAT KARTI") && !raw.includes(".topbar {"));
  check("C2 @page yine de var (sarmalayıcı)", raw.includes("@page { size:"));
  check("C3 {{alan}} ikame edildi", raw.includes("IE0308260001"));
  check("C4 HTML değeri KAÇIRILDI", raw.includes("&lt;b&gt;") && !raw.includes('<b>"x"</b>'));
  check("C5 ham SVG kaçırılMADI", raw.includes("<svg id='q'></svg>"));
  check("C6 döngü satırları açıldı", raw.includes("KK1") && raw.includes("Boyahane") && raw.includes("Yıldız"));
  check("C7 bilinmeyen anahtar boş bastı (baskı durmadı)", raw.includes("[]"));
  const emptyRaw = renderTravelerCard(
    { ...SNAP_BASE, config: DEFAULT_TRAVELER_CARD_CONFIG, template: { id: null, name: "U", mode: "RAW_HTML", html: "  " } } as never,
    META,
  );
  check("C8 gövdesi boş uzman şablonu → yerleşiğe düşer (boş kâğıt basmaz)", emptyRaw.includes("REFAKAT KARTI"));

  console.log("\n=== D) Sanitizasyon ===");
  const evil = `<div onclick="alert(1)">x</div><script>alert(2)</script><iframe src="http://k"></iframe><a href="javascript:alert(3)">y</a>`;
  const cleaned = sanitizeTemplateHtml(evil);
  check("D1 script/on*/iframe/javascript: kesildi", !/<script|onclick|<iframe|javascript:/i.test(cleaned), cleaned.slice(0, 40));
  check("D2 describeSanitization ne kesileceğini söylüyor", describeSanitization(evil).length >= 3);
  check("D3 temiz şablonda hiçbir şey kesilmiyor", describeSanitization("<div><b>{{itemName}}</b></div>").length === 0);
  // Render yolu da temizler (kayıt kapısını atlayan satırlara karşı ikinci hat).
  const rawEvil = renderTravelerCard(
    { ...SNAP_BASE, config: DEFAULT_TRAVELER_CARD_CONFIG, template: { id: null, name: "U", mode: "RAW_HTML", html: `<b>ok</b><script>alert(1)</script>` } } as never,
    META,
  );
  check("D4 RENDER yolu da temizliyor (DB'ye elle yazılsa bile)", !rawEvil.includes("<script"));

  console.log("\n=== E) Şablon karta DONUYOR ===");
  const tplRes = await templates.create(
    { name: `TST-TPL-${STAMP}`, mode: "RAW_HTML", html: `<h1>SÜRÜM-BİR {{workOrderNumber}}</h1>`, config: DEFAULT_TRAVELER_CARD_CONFIG },
    ADMIN,
  );
  const tpl = tplRes.data as { id: string };
  tplIds.push(tpl.id);
  await templates.setDefault(tpl.id, ADMIN);

  const w1 = await makeWo(1);
  const card = need((await cards.print(w1, ADMIN)).data, "kart");
  const html1 = await cards.getCardHtml(card.id);
  check("E1 kart varsayılan şablonla basıldı", html1.includes("SÜRÜM-BİR"));

  // Şablonu DEĞİŞTİR — basılmış kart etkilenmemeli.
  await templates.update(tpl.id, { html: `<h1>SÜRÜM-İKİ {{workOrderNumber}}</h1>` }, ADMIN);
  const html2 = await cards.getCardHtml(card.id);
  check("E2 basılmış kart ESKİ şablonla basılmaya devam ediyor (donmuş)", html2.includes("SÜRÜM-BİR") && !html2.includes("SÜRÜM-İKİ"));

  await cards.reprint(w1, "şablon güncellendi", ADMIN);
  const html3 = await cards.getCardHtml(card.id);
  check("E3 reprint YENİ şablonu alıyor", html3.includes("SÜRÜM-İKİ"));

  console.log("\n=== F) Fail-closed çözüm ===");
  const gone = await templates
    .resolveForPrint("00000000-0000-0000-0000-000000000000")
    .then(() => null)
    .catch((e: unknown) => e as { statusCode?: number });
  check("F1 olmayan şablon → hata (yerleşiğe SAPMIYOR)", gone !== null);
  check("F2 hata 404", gone?.statusCode === 404, `status=${gone?.statusCode}`);
  // Varsayılan kaldırılınca yerleşiğe dönmeli (bu SAPMA değil, açık karar).
  await templates.clearDefault(ADMIN);
  const resolved = await templates.resolveForPrint();
  check("F3 varsayılan yokken yerleşik (BUILTIN) çözülüyor", resolved.template.mode === "BUILTIN" && resolved.template.id === null);

  console.log("\n=== G) Varsayılan tekliği (partial unique) ===");
  const t2 = (await templates.create({ name: `TST-TPL2-${STAMP}`, config: DEFAULT_TRAVELER_CARD_CONFIG }, ADMIN)).data as { id: string };
  tplIds.push(t2.id);
  await templates.setDefault(tpl.id, ADMIN);
  await templates.setDefault(t2.id, ADMIN);
  const defCount = await prisma.travelerCardTemplate.count({ where: { isDefault: true, deletedAt: null } });
  check("G1 aynı anda TEK varsayılan", defCount === 1, `count=${defCount}`);
  const defRow = await prisma.travelerCardTemplate.findFirst({ where: { isDefault: true }, select: { id: true } });
  check("G2 varsayılan SON işaretlenen", defRow?.id === t2.id);
}

async function cleanup(): Promise<void> {
  const cardRows = await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const cardIds = cardRows.map((c) => c.id);
  await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardIds } } });
  await prisma.travelerCard.deleteMany({ where: { id: { in: cardIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  // Şablon: test kendi yarattığını FİZİKSEL siler (soft delete bir sonraki
  // koşumda ad çakışması yapmaz ama artık biriktirir — bkz. fixture disiplini).
  await prisma.travelerCardTemplate.updateMany({ where: { id: { in: tplIds } }, data: { isDefault: false } });
  await prisma.travelerCardTemplate.deleteMany({ where: { id: { in: tplIds } } });
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    await run();
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
