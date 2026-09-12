// =============================================================================
// BEKÇİ — DEPO HAREKET DEFTERİ OKUMA YÜZEYİ (G5)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_warehouse_movements.ts
//
// NEDEN: Defter 2026-08-14'ten beri YAZILIYOR ama okuyan tek yol transfer
// detayıydı (`transferId` ile süzülmüş TRANSFER satırları). "Bu depoya ne girdi
// / bundan ne çıktı" sorusunun hiçbir yerde cevabı yoktu — veri vardı, kapısı
// yoktu. Bu uç o kapıdır; bekçi kapının SESSİZCE yanlış cevap vermesini kilitler.
//
// ⚠️ SESSİZ ARIZA MODLARI (üçü de bu dosyada ölçülür — hata da log da çıkmaz):
//   • Depo süzgeci düşerse liste "filtresizmiş gibi" döner ve depocu BAŞKA
//     deponun malını kendi defterinde görür (2026-08-06 `currentStationId`
//     dersinin defter ikizi: boş liste değil, YANLIŞ liste).
//   • `warehouseId` koşulu (`OR from/to`) ile cursor koşulu (`OR`) aynı nesnenin
//     KÖKÜNDE toplanırsa ikincisi birincisini EZER → 1. sayfa doğru, 2. sayfa
//     yabancı satır getirir. Tam da kimsenin bakmadığı yer.
//   • Yön (`direction`) `eventType`ten türetilirse TRANSFER satırı iki depo için
//     de aynı yöne basılır — rakam doğru, cümle yalan.
//
// ÖLÇÜLENLER:
//   §1 Depo süzgeci: from VEYA to (dokunan hareketler) — iki depodan da
//   §2 ⭐ YÖN bakan depoya göredir; aynı TRANSFER satırı A'da ÇIKAN, B'de GİREN
//   §3 eventType · rollId · sackId · tarih aralığı süzgeçleri
//   §4 Cursor sayfalama: sıra desc · tekrar yok · boşluk yok · union tam
//   §5 ⭐ 2. SAYFADA DA depo süzgeci geçerli (OR-ezilmesi seddi)
//   §6 Route sözleşmesi: `/movements` `/:id`'DEN ÖNCE + rejim kapısı asimetrisi
//   §7 Körlük zemini
//
// FIXTURE KENDİ VERİSİNİ ÜRETİR (ortamdaki veriye bağımlı değil) ve `finally`
// içinde siler.
// =============================================================================
import { RollStatus, WarehouseEventType } from "@prisma/client";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";
import { readFileSync } from "node:fs";
import path from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { warehouseService, warehouseMovementDirection } from "../src/services/warehouse.service";
import {
  postStockMove,
  reverseStockMove,
  writeWarehouseMovements,
} from "../src/services/helpers/warehouse-ledger.helper";
import warehouseRouter from "../src/routes/warehouse.routes";

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

const SUF = Date.now().toString(36).toUpperCase().slice(-6);
const whIds: string[] = [];
const rollIds: string[] = [];
let sackId: string | null = null;

interface Row {
  id: string;
  eventType: WarehouseEventType;
  direction: "IN" | "OUT" | null;
  createdAt: Date;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  roll: { id: string } | null;
  sack: { id: string } | null;
}

async function list(params: Parameters<typeof warehouseService.listMovements>[0]) {
  const res = await warehouseService.listMovements(params);
  return { rows: res.data as unknown as Row[], nextCursor: res.nextCursor };
}

async function main(): Promise<void> {
  console.log("=== Depo hareket defteri okuma yüzeyi bekçisi ===\n");

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item) throw new Error("Test verisi yetersiz — aktif Item yok.");

  // ── Fixture ─────────────────────────────────────────────────────────────
  const whA = await prisma.warehouse.create({
    data: { code: `TEST-WHM-A-${SUF}`, name: `TEST Depo A ${SUF}` },
    select: { id: true },
  });
  const whB = await prisma.warehouse.create({
    data: { code: `TEST-WHM-B-${SUF}`, name: `TEST Depo B ${SUF}` },
    select: { id: true },
  });
  whIds.push(whA.id, whB.id);

  const r1 = await prisma.roll.create({
    data: { itemId: item.id, initialQty: 100, currentQty: 100 },
    select: { id: true },
  });
  const r2 = await prisma.roll.create({
    data: { itemId: item.id, initialQty: 50, currentQty: 50 },
    select: { id: true },
  });
  rollIds.push(r1.id, r2.id);

  const sack = await prisma.sack.create({ data: { sackNo: `TEST-CV-${SUF}` }, select: { id: true } });
  sackId = sack.id;

  // Beş olay — defterin GERÇEK yazma kapısından (`writeWarehouseMovements`),
  // elle `create` ile değil: kapı bir ALLOWLIST'tir ve alanı sessizce düşürebilir.
  await prisma.$transaction(async (tx) => {
    await writeWarehouseMovements(tx, [
      // 1) ENTRY  → A'ya girdi
      { rollId: r1.id, eventType: WarehouseEventType.ENTRY, qty: 100, toWarehouseId: whA.id },
      // 2) TRANSFER → A'dan çıktı, B'ye girdi (çuval üyesi olarak)
      {
        rollId: r1.id,
        eventType: WarehouseEventType.TRANSFER,
        qty: 100,
        fromWarehouseId: whA.id,
        toWarehouseId: whB.id,
        sackId: sack.id,
      },
      // 3) SHIPMENT → B'den çıktı
      { rollId: r1.id, eventType: WarehouseEventType.SHIPMENT, qty: 100, fromWarehouseId: whB.id },
      // (politika aşağıda: bu kümenin her satırı geçerli, 0 metraj beklenmiyor)
      // 4) RETURN → B'ye girdi
      { rollId: r2.id, eventType: WarehouseEventType.RETURN, qty: 50, toWarehouseId: whB.id },
      // 5) CANCEL → A'dan düştü
      { rollId: r2.id, eventType: WarehouseEventType.CANCEL, qty: 50, fromWarehouseId: whA.id },
    ], { onZeroQty: "throw" });
  });

  // ⚠️ `createdAt` ELLE DAMGALANIR: beş satır tek tx'te doğdu ve milisaniyeleri
  // çakışabilir. Cursor tie-breaker'ı `id`'dir ama TARİH süzgeci ve "sıra desc"
  // kontrolü belirsiz kalırdı — bekçi bazen yeşil, bazen kırmızı olurdu.
  const base = Date.now();
  const stamps: Date[] = [];
  const written = await prisma.warehouseMovement.findMany({
    where: { rollId: { in: rollIds } },
    orderBy: { createdAt: "asc" },
    select: { id: true, eventType: true },
  });
  // Yazım sırası = olay sırası (append-only defterde kronoloji `createdAt`tir).
  const order = [
    WarehouseEventType.ENTRY,
    WarehouseEventType.TRANSFER,
    WarehouseEventType.SHIPMENT,
    WarehouseEventType.RETURN,
    WarehouseEventType.CANCEL,
  ];
  for (let i = 0; i < order.length; i++) {
    const row = written.find((w) => w.eventType === order[i]);
    if (!row) throw new Error(`Fixture eksik: ${order[i]} satırı yazılmadı.`);
    const at = new Date(base - (order.length - i) * 60_000);
    stamps.push(at);
    await prisma.warehouseMovement.update({ where: { id: row.id }, data: { createdAt: at } });
  }
  const [tEntry, tTransfer, tShip, tReturn, tCancel] = stamps as [Date, Date, Date, Date, Date];

  // ── §1 Depo süzgeci — "dokunan" hareketler (from VEYA to) ───────────────
  const aAll = await list({ warehouseId: whA.id, limit: 50 });
  const bAll = await list({ warehouseId: whB.id, limit: 50 });
  const aTypes = aAll.rows.map((r) => r.eventType).sort();
  const bTypes = bAll.rows.map((r) => r.eventType).sort();
  check(
    "§1a A deposu: ENTRY(giren) + TRANSFER(çıkan) + CANCEL(çıkan) = 3 satır",
    aAll.rows.length === 3 && aTypes.join(",") === "CANCEL,ENTRY,TRANSFER",
    `n=${aAll.rows.length} [${aTypes.join(",")}]`,
  );
  check(
    "§1b B deposu: TRANSFER(giren) + SHIPMENT(çıkan) + RETURN(giren) = 3 satır",
    bAll.rows.length === 3 && bTypes.join(",") === "RETURN,SHIPMENT,TRANSFER",
    `n=${bAll.rows.length} [${bTypes.join(",")}]`,
  );
  check(
    "§1c ⭐ Süzgeç GERÇEKTEN daraltıyor: filtresiz döküm bu 5 satırın hepsini görüyor",
    (await list({ rollId: r1.id, limit: 50 })).rows.length +
      (await list({ rollId: r2.id, limit: 50 })).rows.length ===
      5,
  );
  check(
    "§1d A süzgeci B'ye ÖZEL satırı (SHIPMENT) getirmedi",
    !aAll.rows.some((r) => r.eventType === WarehouseEventType.SHIPMENT),
  );

  // ── §2 ⭐ YÖN bakan depoya göredir ──────────────────────────────────────
  const aTransfer = aAll.rows.find((r) => r.eventType === WarehouseEventType.TRANSFER);
  const bTransfer = bAll.rows.find((r) => r.eventType === WarehouseEventType.TRANSFER);
  check(
    "§2a ⭐ AYNI transfer satırı A'da ÇIKAN, B'de GİREN",
    aTransfer?.direction === "OUT" && bTransfer?.direction === "IN" && aTransfer?.id === bTransfer?.id,
    `A=${aTransfer?.direction} B=${bTransfer?.direction}`,
  );
  check(
    "§2b ENTRY A'da giren · CANCEL A'da çıkan",
    aAll.rows.find((r) => r.eventType === WarehouseEventType.ENTRY)?.direction === "IN" &&
      aAll.rows.find((r) => r.eventType === WarehouseEventType.CANCEL)?.direction === "OUT",
  );
  check(
    "§2c RETURN B'de giren · SHIPMENT B'de çıkan",
    bAll.rows.find((r) => r.eventType === WarehouseEventType.RETURN)?.direction === "IN" &&
      bAll.rows.find((r) => r.eventType === WarehouseEventType.SHIPMENT)?.direction === "OUT",
  );
  const noWh = await list({ rollId: r1.id, limit: 50 });
  check(
    "§2d Depo SÖYLENMEDİYSE yön NULL — 'hangi depodan bakıldığı' belli değilken giren/çıkan uydurmadır",
    noWh.rows.length === 3 && noWh.rows.every((r) => r.direction === null),
    `n=${noWh.rows.length}`,
  );
  check(
    "§2e Saf yüklem: from===to satırı yönsüz (şema yasaklıyor ama sessizce 'giren' denmez)",
    warehouseMovementDirection({ fromWarehouseId: whA.id, toWarehouseId: whA.id }, whA.id) === null &&
      warehouseMovementDirection({ fromWarehouseId: null, toWarehouseId: null }, whA.id) === null,
  );

  // ── §3 Diğer süzgeçler ─────────────────────────────────────────────────
  const byType = await list({ warehouseId: whA.id, eventType: WarehouseEventType.CANCEL, limit: 50 });
  check(
    "§3a eventType süzgeci",
    byType.rows.length === 1 && byType.rows[0]?.eventType === WarehouseEventType.CANCEL,
    `n=${byType.rows.length}`,
  );
  const byRoll = await list({ rollId: r2.id, limit: 50 });
  check(
    "§3b rollId süzgeci (topun tüm depo yaşamı — depo fark etmeksizin)",
    byRoll.rows.length === 2 && byRoll.rows.every((r) => r.roll?.id === r2.id),
    `n=${byRoll.rows.length}`,
  );
  const bySack = await list({ sackId: sack.id, limit: 50 });
  check(
    "§3c sackId süzgeci (çuvalın ÜYESİ olarak geçen hareketler)",
    bySack.rows.length === 1 && bySack.rows[0]?.eventType === WarehouseEventType.TRANSFER,
    `n=${bySack.rows.length}`,
  );
  const fromShip = await list({ warehouseId: whB.id, dateFrom: tShip, limit: 50 });
  check(
    "§3d dateFrom (gte) — SHIPMENT ve sonrası, TRANSFER dışarıda",
    fromShip.rows.length === 2 &&
      !fromShip.rows.some((r) => r.eventType === WarehouseEventType.TRANSFER),
    `n=${fromShip.rows.length}`,
  );
  const untilTransfer = await list({ warehouseId: whB.id, dateTo: tTransfer, limit: 50 });
  check(
    "§3e dateTo (lte) — yalnız TRANSFER",
    untilTransfer.rows.length === 1 &&
      untilTransfer.rows[0]?.eventType === WarehouseEventType.TRANSFER,
    `n=${untilTransfer.rows.length}`,
  );
  const window = await list({ dateFrom: tEntry, dateTo: tReturn, rollId: r1.id, limit: 50 });
  check(
    "§3f Aralık İKİ UÇTAN da kapalı: r1'in 3 hareketi girer, aralık dışı CANCEL girmez",
    window.rows.length === 3 && !window.rows.some((r) => r.eventType === WarehouseEventType.CANCEL),
    `n=${window.rows.length}`,
  );
  void tCancel;

  // ── §4 Cursor sayfalama ────────────────────────────────────────────────
  const p1 = await list({ warehouseId: whA.id, limit: 2 });
  check("§4a 1. sayfa limit kadar satır + nextCursor var", p1.rows.length === 2 && Boolean(p1.nextCursor));
  check(
    "§4b Sıra EN YENİDEN eskiye (CANCEL → TRANSFER)",
    p1.rows[0]?.eventType === WarehouseEventType.CANCEL &&
      p1.rows[1]?.eventType === WarehouseEventType.TRANSFER,
    `[${p1.rows.map((r) => r.eventType).join(",")}]`,
  );
  const p2 = await list({ warehouseId: whA.id, limit: 2, cursor: p1.nextCursor ?? undefined });
  check(
    "§4c 2. sayfa kalanı getirdi ve BİTTİ (nextCursor null)",
    p2.rows.length === 1 && p2.nextCursor === null,
    `n=${p2.rows.length} cursor=${String(p2.nextCursor)}`,
  );
  const union = [...p1.rows, ...p2.rows].map((r) => r.id);
  check(
    "§4d Sayfa sınırında TEKRAR yok ve BOŞLUK yok (union = tek sayfalık sonuç)",
    new Set(union).size === 3 &&
      union.slice().sort().join(",") === aAll.rows.map((r) => r.id).sort().join(","),
  );

  // ── §5 ⭐ 2. sayfada da depo süzgeci geçerli (OR-ezilmesi seddi) ─────────
  check(
    "§5 ⭐ 2. sayfanın satırı hâlâ A deposuna ait (cursor OR'u depo OR'unu EZMEDİ)",
    p2.rows.every((r) => r.fromWarehouseId === whA.id || r.toWarehouseId === whA.id),
    p2.rows.map((r) => `${r.eventType}:${r.fromWarehouseId === whA.id ? "from" : r.toWarehouseId === whA.id ? "to" : "YABANCI"}`).join(","),
  );
  // Aynı sed, yön tarafında: 2. sayfa satırının yönü de doğru çözülmeli.
  check(
    "§5b 2. sayfa satırının yönü de bakan depoya göre",
    p2.rows[0]?.direction === "IN" && p2.rows[0]?.eventType === WarehouseEventType.ENTRY,
    `dir=${String(p2.rows[0]?.direction)}`,
  );

  // ── §6 Route sözleşmesi ────────────────────────────────────────────────
  const stack = (warehouseRouter as unknown as {
    stack: Array<{ route?: { path?: string; methods?: Record<string, boolean> } }>;
  }).stack;
  const paths = stack.filter((l) => l.route?.methods?.get).map((l) => l.route?.path ?? "");
  const iMove = paths.indexOf("/movements");
  const iId = paths.indexOf("/:id");
  check(
    "§6a ⭐ `/movements` `/:id`'DEN ÖNCE kayıtlı (sonra olsaydı Express 'movements'ı id sanardı)",
    iMove >= 0 && iId >= 0 && iMove < iId,
    `movements=${iMove} :id=${iId}`,
  );
  const srcDir = path.resolve(__dirname, "../src/routes");
  const whSrc = readFileSync(path.join(srcDir, "warehouse.routes.ts"), "utf8");
  const yarnSrc = readFileSync(path.join(srcDir, "yarn.routes.ts"), "utf8");
  check("§6b Körlük zemini: kaynak dosyalar okundu", whSrc.length > 1000 && yarnSrc.length > 1000);
  // ⚠️ Metin araması DEĞİL İMPORT araması: depo route'u kararın GEREKÇESİNİ
  // yorumda `requireFinanceEnabled` adıyla anlatıyor. Düz `includes` o yorumu
  // "kapı var" diye okur — bekçi kendi belgelendirmemize takılırdı.
  // ⚠️ 2026-09-02: modül kapıları AYRI bir dosyada (`module.middleware.ts`) —
  // `finance.middleware.ts`e eklenselerdi bu kontrolün sağ tarafı (depo route'u
  // o dosyadan import ETMEZ) yanlış sebeple kırılırdı. Aranan import artık
  // modül dosyasıdır ve iplik ucunun taşıdığı ad `requireIplikEnabled`.
  const modulImport = /from\s+"\.\.\/middlewares\/module\.middleware"/;
  check(
    "§6c ⭐ REJİM KAPISI ASİMETRİSİ ÖLÇÜLDÜ: iplik uçları `requireIplikEnabled` TAŞIR, depo defteri (tanım + " +
      "hareket) HİÇBİR modül kapısı TAŞIMAZ (defteri fabrika yolları da yazıyor — kapı koymak fabrikada " +
      "yazılanı fabrikada okunamaz yapardı; çoklu depo kapısı yalnız TRANSFER router'ındadır)",
    modulImport.test(yarnSrc) && !modulImport.test(whSrc),
  );
  check(
    "§6d Uç izinle kapılı ve okuma kümesi geniş (transfer yapan da defteri görür)",
    /requireAnyPermission\("warehouse:read", "warehouse:write", "warehouse:transfer"\)/.test(whSrc),
  );

  // ── §8 ⭐ OLAY SÖZLÜĞÜ PARİTESİ (backend enum ↔ panel aynası) ───────────
  // Panel `WarehouseEventType`i ELLE aynalıyor (Electron backend'i import edemez).
  // Yeni bir olay eklenip ayna güncellenmezse ekran ham enum basar ya da rozet
  // haritasında undefined'a düşer — bu kontrol o ayrışmayı MEKANİK yakalar.
  const schemaSrc = readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  const enumBlock = /enum WarehouseEventType \{([\s\S]*?)\n\}/.exec(schemaSrc)?.[1] ?? "";
  const schemaValues = enumBlock
    .split("\n")
    .map((l) => l.trim().split(/\s|\/\//)[0] ?? "")
    .filter((v) => /^[A-Z_]+$/.test(v));
  const panelSrc = readFileSync(
    path.join(__dirname, "..", "..", "Electron", "src", "pages", "Warehouses", "movements.ts"),
    "utf8",
  );
  const metaBlock = /WAREHOUSE_EVENT_META = \{([\s\S]*?)\n\} satisfies/.exec(panelSrc)?.[1] ?? "";
  const panelMeta = [...metaBlock.matchAll(/\n  ([A-Z_]+):/g)].map((m) => m[1] as string);
  // Panelin TEK kaynağı sözlüktür: union ve süzgeç listesi ondan TÜRETİLİR.
  // Elle yazılmış bir union, `Record<WarehouseEventType, …>` tipini kendi
  // kopyasıyla doğrular; backend'e yeni değer eklendiğinde panel derlemesi sessiz
  // kalır. Ölçüldü 2026-09-12: beş yeni olay tipi panele hiç gelmedi, tip hatası
  // vermedi — bu yüzden parite kontrolüne "tek kaynak" kontrolü eşlik eder.
  const unionTuretilmis = /export type WarehouseEventType = keyof typeof WAREHOUSE_EVENT_META;/.test(panelSrc);
  const listeTuretilmis = /WAREHOUSE_EVENT_TYPES = Object\.keys\(WAREHOUSE_EVENT_META\)/.test(panelSrc);
  check("§8a Körlük zemini: enum ve panel sözlüğü okundu", schemaValues.length >= 7 && panelMeta.length >= 7,
    `enum=${schemaValues.length} sözlük=${panelMeta.length}`);
  check("§8b ⭐ Panelde TEK kaynak: union ve süzgeç listesi sözlükten türetiliyor", unionTuretilmis && listeTuretilmis,
    `union=${unionTuretilmis} liste=${listeTuretilmis}`);
  const eksikMeta = schemaValues.filter((v) => !panelMeta.includes(v));
  const fazlaMeta = panelMeta.filter((v) => !schemaValues.includes(v));
  check("§8c ⭐ Panel olay SÖZLÜĞÜ backend enum'uyla birebir (iki yönlü)", eksikMeta.length === 0 && fazlaMeta.length === 0,
    `eksik=${eksikMeta.join(",")} fazla=${fazlaMeta.join(",")}`);

  // ── §7 Körlük zemini ───────────────────────────────────────────────────
  const total = await prisma.warehouseMovement.count({ where: { rollId: { in: rollIds } } });
  check("§7 Körlük zemini: fixture 5 defter satırı üretti (hepsi 0 olsaydı §1-§5 vakumen geçerdi)", total === 5, `n=${total}`);

  // ── §9 ⭐ `isReversal` BAĞDAN türer, OLAY TİPİNDEN değil ────────────────
  // İki kaynak olursa biri gün gelir yalan söyler (tasarım D2a): "bu satır storno
  // mudur" sorusunun tek cevabı `reversesMovementId`dir; `*_REVERSAL` tipi yalnız
  // varsayılan tondur. Satırlar defterin GERÇEK kapılarından yazılır.
  const s9 = await prisma.$transaction(async (tx) => {
    const fwd = await postStockMove(tx, {
      rollId: r2.id,
      eventType: WarehouseEventType.CANCEL,
      qty: 50,
      from: { warehouseId: whA.id, status: RollStatus.WAREHOUSE },
      reasonCode: STOCK_MOVE_REASON.STOCK_COUNT,
    });
    // Ters kayıt: tip KOPYALANIR (CANCEL), storno olduğunu yalnız BAĞ söyler.
    const rev = await reverseStockMove(tx, fwd, { reasonCode: STOCK_MOVE_REASON.STOCK_COUNT });
    // Tipi `*_REVERSAL` ama BAĞI YOK — "tipe bakan" bir uygulama buna storno derdi.
    const unlinked = await postStockMove(tx, {
      rollId: r2.id,
      eventType: WarehouseEventType.CANCEL_REVERSAL,
      qty: 50,
      to: { warehouseId: whA.id, status: RollStatus.WAREHOUSE },
      reasonCode: STOCK_MOVE_REASON.STOCK_COUNT,
    });
    return { rev, unlinked };
  });
  const page9 = (await warehouseService.listMovements({ rollId: r2.id, limit: 200 })).data as Array<{
    id: string;
    eventType: WarehouseEventType;
    isReversal: boolean;
  }>;
  const row9 = (id: string) => page9.find((r) => r.id === id);
  check(
    "§9a Körlük zemini: iki sonda satırı da listede döndü",
    Boolean(row9(s9.rev)) && Boolean(row9(s9.unlinked)),
    `n=${page9.length}`,
  );
  check(
    "§9b ⭐ Bağı DOLU satır isReversal:true (olay tipi CANCEL olmasına rağmen)",
    row9(s9.rev)?.isReversal === true && row9(s9.rev)?.eventType === WarehouseEventType.CANCEL,
    `tip=${String(row9(s9.rev)?.eventType)} isReversal=${String(row9(s9.rev)?.isReversal)}`,
  );
  check(
    "§9c ⭐ Bağı BOŞ satır isReversal:false (olay tipi CANCEL_REVERSAL olmasına rağmen)",
    row9(s9.unlinked)?.isReversal === false,
    `isReversal=${String(row9(s9.unlinked)?.isReversal)}`,
  );
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    try {
      if (rollIds.length) {
        await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      }
      if (sackId) await prisma.sack.deleteMany({ where: { id: sackId } });
      if (whIds.length) await prisma.warehouse.deleteMany({ where: { id: { in: whIds } } });
    } catch (e) {
      console.warn("Temizlik uyarısı:", (e as Error).message.slice(0, 200));
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
