// =============================================================================
// BEKÇİ — STOK DEFTERİ KAPISININ SÖZLEŞMESİ (toplu yazım + ters kayıt)
// Çalıştır: npx tsx scripts/run-all-tests.ts stock_ledger_helper
// =============================================================================
// NEDEN: stok defterinin iki yazma kapısı var (tekil `postStockMove`, toplu
// `postStockMoves`) ve ikisi AYNI satırı kurmak zorunda. Konum defterinde bu
// tam olarak bir kez kırıldı: `writeWarehouseMovements`in map'i bir allowlist'ti
// ve `sackId` eklendiğinde toplu yol alanı SESSİZCE düşürdü (2026-08-14).
// Stok defterinde aynı hata mutabakatı kaydırır, çünkü düşen alan bir yön ya da
// sebep olabilir. Bu yüzden satırı kuran map TEK yerde (`stockMoveRow`) yaşar ve
// burada AST ile ölçülür — yeni bir map yazılırsa bekçi kırmızı verir.
//
// ÖLÇÜLENLER
//   §1 Toplu kapı N satırı yazar ve yeni kolonları (statü/sebep/grup) taşır
//   §2 Kümede tek bozuk metraj varsa FIRLATIR ve HİÇBİR satır yazılmaz
//   §3 Uçsuz satır FIRLATIR (sessiz atlama YOK — tekil kapıyla aynı sert kural)
//   §4 ⭐ Satırı kuran map TEK yerde; `StockMoveInput`un her alanı map'te var
//   §5 Boş küme 0 döner (sorgu atılmaz)
//   §6 Ters kayıt `eventType`i verilmezse ileri satırdan KOPYALANIR
//   §7 ⭐ Verilirse override yazılır; yön/metraj/bağ DEĞİŞMEZ (tasarım §D2a)
//   §8 Ters kaydın tersi 409
//   §9 ⭐ Aynı ileri satır iki kez terslenemez — DB unique'i tutuyor (P2002)
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import { Prisma, RollForm, RollStatus, WarehouseEventType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import {
  postStockMove,
  postStockMoves,
  reverseAllRollStockMoves,
  reverseStockMove,
  writeWarehouseMovement,
  writeWarehouseMovements,
} from "../src/services/helpers/warehouse-ledger.helper";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const TAG = `TEST-SLH-${Date.now()}`;
const rollIds: string[] = [];
let itemId = "";

const HELPER_YOLU = join(__dirname, "..", "src", "services", "helpers", "warehouse-ledger.helper.ts");

/** `data:` argümanı inline nesne literali olan stok-defteri yazımları + map sayısı. */
function astTekKaynak(): {
  inlineYazim: string[];
  mapSayisi: number;
  mapAnahtarlari: Set<string>;
  girdiAnahtarlari: string[];
  tersSelect: Set<string>;
} {
  const metin = readFileSync(HELPER_YOLU, "utf8");
  const src = ts.createSourceFile(HELPER_YOLU, metin, ts.ScriptTarget.ES2022, true);
  const inlineYazim: string[] = [];
  let mapSayisi = 0;
  const mapAnahtarlari = new Set<string>();
  const girdiAnahtarlari: string[] = [];

  const anahtarlariOku = (o: ts.ObjectLiteralExpression): string[] =>
    o.properties
      .filter(ts.isPropertyAssignment)
      .map((p) => (ts.isIdentifier(p.name) ? p.name.text : ""))
      .filter(Boolean);

  // (a) Satır map'i: `toStatus` + `reasonCode` taşıyan HER nesne literali bir
  //     satır map'idir. Birden çoksa tek kaynak kırılmıştır.
  const gezMap = (n: ts.Node): void => {
    if (ts.isObjectLiteralExpression(n)) {
      const k = anahtarlariOku(n);
      if (k.includes("toStatus") && k.includes("reasonCode")) {
        mapSayisi++;
        k.forEach((x) => mapAnahtarlari.add(x));
      }
    }
    // (b) `StockMoveInput` arayüzünün alanları — map'in karşılaması gereken küme.
    if (ts.isInterfaceDeclaration(n) && n.name.text === "StockMoveInput") {
      for (const m of n.members) {
        if (ts.isPropertySignature(m) && ts.isIdentifier(m.name)) girdiAnahtarlari.push(m.name.text);
      }
    }
    ts.forEachChild(n, gezMap);
  };
  gezMap(src);

  // (c) Stok defteri fonksiyonlarının İÇİNDE inline `data:` literali olmamalı.
  const gezYazim = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const ad = n.expression.name.text;
      const hedef = n.expression.expression.getText(src);
      if ((ad === "create" || ad === "createMany") && hedef.endsWith("warehouseMovement")) {
        const arg = n.arguments[0];
        if (arg && ts.isObjectLiteralExpression(arg)) {
          const dataProp = arg.properties.find(
            (p): p is ts.PropertyAssignment =>
              ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "data",
          );
          if (dataProp && ts.isObjectLiteralExpression(dataProp.initializer)) {
            const satir = src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1;
            inlineYazim.push(`${ad} @ ${satir}`);
          }
        }
      }
    }
    ts.forEachChild(n, gezYazim);
  };
  for (const st of src.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && ["postStockMove", "postStockMoves"].includes(st.name.text)) {
      gezYazim(st);
    }
  }

  // (d) `reverseStockMove`un OKUMA tarafı: ileri satırdan taşınacak her bağ alanı
  //     `select`te olmalı. Burası map'in İKİNCİ kopyasıdır — üç alan (transformGroupId,
  //     rollVarianceId, workOrderStepId) burada eksikti ve ters satır NULL doğuyordu.
  const tersSelect = new Set<string>();
  for (const st of src.statements) {
    if (!(ts.isFunctionDeclaration(st) && st.name?.text === "reverseStockMove")) continue;
    const gezSelect = (n: ts.Node): void => {
      if (
        ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "select" &&
        ts.isObjectLiteralExpression(n.initializer)
      ) {
        anahtarlariOku(n.initializer).forEach((k) => tersSelect.add(k));
      }
      ts.forEachChild(n, gezSelect);
    };
    gezSelect(st);
  }
  return { inlineYazim, mapSayisi, mapAnahtarlari, girdiAnahtarlari, tersSelect };
}

/**
 * ELLE YAZILMIŞ metraj eşiği taşıyan fonksiyonların adları: 0 ile ilişkisel
 * karşılaştırma (`<`, `<=`, `>`, `>=`) yapan VE karşı tarafında `qty` geçen
 * ifadeler. Tek kaynak kuralı gereği bu liste BOŞ olmalı — eşik yalnız
 * `qtyYazilabilir`in içinde, kendi yerel değişkeniyle (`q > 0`) yaşar.
 *
 * ⚠️ KÖR NOKTASI BİLİNÇLİ ve yazılı: eşiği `qty` geçmeyen bir yerel değişkenle
 * yazan kopya yakalanmaz (`const n = Number(x); if (n > 0)`). Daha geniş yüklem
 * `bozuk >= 0` gibi indeks kontrollerini de yakalayıp tripwire'ı gürültüye
 * boğuyordu — ilk koşumda tam bu oldu. Gürültülü tripwire devre dışı bırakılır,
 * kör noktası yazılı olan tripwire yaşar.
 */
function astEsikSahipleri(): string[] {
  const metin = readFileSync(HELPER_YOLU, "utf8");
  const src = ts.createSourceFile(HELPER_YOLU, metin, ts.ScriptTarget.ES2022, true);
  const sahipler = new Set<string>();
  const yigin: string[] = [];
  const gez = (n: ts.Node): void => {
    let itildi = false;
    if (ts.isFunctionDeclaration(n) && n.name) { yigin.push(n.name.text); itildi = true; }
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      const iliskisel =
        op === ts.SyntaxKind.LessThanToken || op === ts.SyntaxKind.LessThanEqualsToken ||
        op === ts.SyntaxKind.GreaterThanToken || op === ts.SyntaxKind.GreaterThanEqualsToken;
      const sifirVar = [n.left, n.right].some((t) => ts.isNumericLiteral(t) && t.text === "0");
      // ⚠️ YALNIZ METRAJ eşiği aranır: karşı taraf `qty` geçmiyorsa bu bir indeks
      // ya da uzunluk kontrolüdür (`bozuk >= 0`), eşik değil. İlk koşumda tam bu
      // fark kırmızı verdi — kapsamı daraltmayan tripwire ilk haftasında devre
      // dışı bırakılır.
      const metrajTarafi = [n.left, n.right].some(
        (t) => !(ts.isNumericLiteral(t) && t.text === "0") && /qty/i.test(t.getText(src)),
      );
      if (iliskisel && sifirVar && metrajTarafi) sahipler.add(yigin[yigin.length - 1] ?? "(modül gövdesi)");
    }
    ts.forEachChild(n, gez);
    if (itildi) yigin.pop();
  };
  gez(src);
  return [...sahipler].sort();
}

async function satirlar(rollId: string) {
  return prisma.warehouseMovement.findMany({
    where: { rollId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, eventType: true, qty: true,
      fromWarehouseId: true, toWarehouseId: true, fromStatus: true, toStatus: true,
      reasonCode: true, transformGroupId: true, reversesMovementId: true, notes: true,
    },
  });
}

async function main(): Promise<void> {
  console.log("\n=== Stok defteri kapısı: toplu yazım + ters kayıt ===\n");

  // ── §4 — AST (DB'ye dokunmadan; kırmızıysa fikstür kurmaya gerek yok) ──────
  const ast = astTekKaynak();
  check("§4a ⭐ Satırı kuran map TEK yerde", ast.mapSayisi === 1, `bulunan map=${ast.mapSayisi}`);
  check(
    "§4b ⭐ Stok defteri kapılarında inline `data:` literali yok",
    ast.inlineYazim.length === 0,
    ast.inlineYazim.join(", ") || "temiz",
  );
  // `from`/`to` uçları map'te dört kolona açılır; kalan her alan birebir taşınır.
  const beklenen = ast.girdiAnahtarlari.filter((k) => k !== "from" && k !== "to");
  const eksik = beklenen.filter((k) => !ast.mapAnahtarlari.has(k));
  const ucKolonlari = ["fromWarehouseId", "toWarehouseId", "fromStatus", "toStatus"].filter(
    (k) => !ast.mapAnahtarlari.has(k),
  );
  check(
    "§4c ⭐ `StockMoveInput`un her alanı map'te (allowlist sessizce düşürmüyor)",
    ast.girdiAnahtarlari.length >= 10 && eksik.length === 0 && ucKolonlari.length === 0,
    `alan=${ast.girdiAnahtarlari.length} eksik=[${eksik.join(",")}] uç=[${ucKolonlari.join(",")}]`,
  );

  // §4e — METRAJ EŞİĞİ TEK KAYNAK. Eşik üç kapıda elle tekrarlandığında ayrıştı
  // (eski toplu kapı qty=0'ı geçiriyordu, sed reddediyordu → 23514 ile tx düşüyordu).
  // Bu tripwire eşiğin tek yüklemde kalmasını zorlar: 0 ile sayısal karşılaştırma
  // YALNIZ `qtyYazilabilir` içinde olabilir.
  // ⚠️ KAPSAM BİLEREK DAR: yalnız defter kapısının kendi dosyası taranır. Repo
  // geneline yayılsa alakasız kodda kırmızı verir ve ilk haftasında devre dışı
  // bırakılır — tripwire'ın en yaygın ölüm biçimi. Kapsam çıktıda BASILIR ki
  // "neyin taranmadığı" görünür olsun.
  const esikSahipleri = astEsikSahipleri();
  // İkinci ayak: tek kaynağın KENDİSİ hâlâ orada mı? Yoksa "kopya yok" cümlesi
  // eşiğin tamamen silindiği durumda da yeşil kalırdı (vakumen geçme).
  const yuklemCanli = /function qtyYazilabilir\([\s\S]*?>\s*0/.test(readFileSync(HELPER_YOLU, "utf8"));
  console.log(`   ℹ️ §4e kapsamı: 1 dosya taranmıştır — ${HELPER_YOLU.split("/").slice(-1)[0]}`);
  check(
    "§4e ⭐ Metraj eşiği TEK yüklemde: `qtyYazilabilir` canlı ve elle kopyası yok",
    yuklemCanli && esikSahipleri.length === 0,
    `yüklem=${yuklemCanli} elle_kopya=[${esikSahipleri.join(",")}]`,
  );

  // Satırın "taşınan bağ" alanları: map'te olup yön/metraj/sebep'ten türemeyenler.
  // Ters kayıt bunların HEPSİNİ ileri satırdan kopyalamak zorunda.
  const TURETILEN = new Set([
    "rollId", "eventType", "qty", "fromWarehouseId", "toWarehouseId",
    "fromStatus", "toStatus", "reasonCode", "userId", "notes", "reversesMovementId",
  ]);
  const tasinanBaglar = [...ast.mapAnahtarlari].filter((k) => !TURETILEN.has(k));
  const tersEksik = tasinanBaglar.filter((k) => !ast.tersSelect.has(k));
  check(
    "§4d ⭐ Ters kayıt ileri satırın HER bağ alanını okuyor (ikinci kopya ayrışmıyor)",
    tasinanBaglar.length >= 8 && tersEksik.length === 0,
    `bağ=${tasinanBaglar.length} eksik=[${tersEksik.join(",")}]`,
  );

  // ── Fikstür ───────────────────────────────────────────────────────────────
  const wh = await prisma.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } });
  if (!wh) throw new Error("Varsayılan depo yok (ensureDefaultWarehouse koşmamış)");
  itemId = (await prisma.item.create({ data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;

  const mkRoll = async (suffix: string): Promise<string> => {
    const r = await prisma.roll.create({
      data: {
        barcode: `${TAG}-${suffix}`, itemId, initialQty: 100, currentQty: 100,
        status: RollStatus.WAREHOUSE, form: RollForm.TOP, warehouseId: wh.id,
      },
      select: { id: true },
    });
    rollIds.push(r.id);
    return r.id;
  };
  const rA = await mkRoll("A");
  const rB = await mkRoll("B");
  const rC = await mkRoll("C");
  const rD = await mkRoll("D");

  // ── §1 — toplu yazım ──────────────────────────────────────────────────────
  const grup = randomUUID();
  const yazilan = await prisma.$transaction(async (tx) =>
    postStockMoves(tx, [
      {
        rollId: rA, eventType: WarehouseEventType.CANCEL, qty: 40,
        from: { warehouseId: wh.id, status: RollStatus.WAREHOUSE },
        reasonCode: STOCK_MOVE_REASON.STOCK_COUNT, transformGroupId: grup, notes: `${TAG} toplu`,
      },
      {
        rollId: rB, eventType: WarehouseEventType.CANCEL, qty: 60,
        from: { warehouseId: wh.id, status: RollStatus.WAREHOUSE },
        reasonCode: STOCK_MOVE_REASON.STOCK_COUNT, transformGroupId: grup,
      },
    ]),
  );
  check("§1a Toplu kapı iki satır yazdı", yazilan === 2, `dönen=${yazilan}`);
  const sA = await satirlar(rA);
  check(
    "§1b ⭐ Yeni kolonlar toplu yolda da yazıldı (statü · sebep · grup · not)",
    sA.length === 1 && sA[0]?.fromStatus === RollStatus.WAREHOUSE && sA[0]?.toStatus === null &&
      sA[0]?.fromWarehouseId === wh.id && sA[0]?.toWarehouseId === null &&
      sA[0]?.reasonCode === STOCK_MOVE_REASON.STOCK_COUNT && sA[0]?.transformGroupId === grup &&
      sA[0]?.notes === `${TAG} toplu` && Number(sA[0]?.qty) === 40,
    `statü=${String(sA[0]?.fromStatus)} sebep=${String(sA[0]?.reasonCode)} grup=${sA[0]?.transformGroupId === grup}`,
  );

  // ── §2 + §3 — hepsi ya hiç ────────────────────────────────────────────────
  // ⚠️ Transaction YOK: geri sarma doğrulamayı GİZLERDİ. Doğrulama insert'ten
  // önce koşmuyorsa iyi satır kalıcı olarak yazılır ve burada görünür.
  const iyiSatir = {
    rollId: rC, eventType: WarehouseEventType.CANCEL, qty: 10,
    from: { warehouseId: wh.id, status: RollStatus.WAREHOUSE },
    reasonCode: STOCK_MOVE_REASON.STOCK_COUNT,
  };
  let firlatti = false;
  try {
    await postStockMoves(prisma, [
      iyiSatir,
      { rollId: rD, eventType: WarehouseEventType.CANCEL, qty: 0, from: { warehouseId: wh.id, status: RollStatus.WAREHOUSE }, reasonCode: STOCK_MOVE_REASON.STOCK_COUNT },
    ]);
  } catch { firlatti = true; }
  check("§2a Bozuk metraj FIRLATTI", firlatti);
  check("§2b ⭐ HİÇBİR satır yazılmadı (doğrulama insert'ten ÖNCE)", (await satirlar(rC)).length === 0);

  firlatti = false;
  try {
    await postStockMoves(prisma, [
      iyiSatir,
      { rollId: rD, eventType: WarehouseEventType.CANCEL, qty: 10, reasonCode: STOCK_MOVE_REASON.STOCK_COUNT },
    ]);
  } catch { firlatti = true; }
  check("§3 Uçsuz satır FIRLATTI ve küme yazılmadı", firlatti && (await satirlar(rC)).length === 0);

  // ── §5 — boş küme ─────────────────────────────────────────────────────────
  check("§5 Boş küme 0 döner", (await postStockMoves(prisma, [])) === 0);

  // ── §10 — ESKİ kapıların eşiği DB seddiyle hizalı ─────────────────────────
  // `CHECK (qty > 0)` tüm yazıcılar için canlı. Eski kapılar 0'ı GEÇİRİYORDU:
  // satır insert'e gidip 23514 alıyor, `createMany` tek sorgu olduğu için TÜM
  // küme düşüyor ve çağıranın (sevk · transfer · sayım) tx'i ham Postgres
  // hatasıyla geri sarılıyordu. Kurşun açık kumaşı (`currentQty: 0`) bu yolu
  // bayrak gerektirmeden tetikliyordu.
  const sifirSatir = { rollId: rC, eventType: WarehouseEventType.CANCEL, qty: 0, fromWarehouseId: wh.id };
  // ── "skip" → MEŞRU atlama: fırlatmaz, satır yazmaz, ATLADIĞINI DÖNER ──────
  let skipPatladi = false;
  let yazildi: boolean | null = null;
  let topluYazilan: number | null = null;
  try {
    yazildi = await writeWarehouseMovement(prisma, sifirSatir, { onZeroQty: "skip" });
    topluYazilan = await writeWarehouseMovements(prisma, [sifirSatir], { onZeroQty: "skip" });
  } catch { skipPatladi = true; }
  check(
    '§10a ⭐ "skip" politikası: atlar, DB seddine çarpmaz ve atladığını DÖNER',
    !skipPatladi && yazildi === false && topluYazilan === 0 && (await satirlar(rC)).length === 0,
    `patladı=${skipPatladi} yazıldı=${String(yazildi)} toplu=${String(topluYazilan)}`,
  );
  // ── "throw" → TUTARSIZLIK SİNYALİ: sessizce geçmez ────────────────────────
  let tekilFirlatti = false;
  let topluFirlatti = false;
  try { await writeWarehouseMovement(prisma, sifirSatir, { onZeroQty: "throw" }); } catch { tekilFirlatti = true; }
  try { await writeWarehouseMovements(prisma, [sifirSatir], { onZeroQty: "throw" }); } catch { topluFirlatti = true; }
  check(
    '§10b ⭐ "throw" politikası: 0 metrajda İKİ kapı da FIRLATIR (sessiz atlama yok)',
    tekilFirlatti && topluFirlatti && (await satirlar(rC)).length === 0,
    `tekil=${tekilFirlatti} toplu=${topluFirlatti}`,
  );
  // ── Uçsuz satır POLİTİKAYA TABİ DEĞİL: her yolda atlanır ─────────────────
  // Defter öncesi doğan 4.553 topun deposu NULL; "throw" deseydik o topların
  // sevki/iadesi kilitlenirdi.
  let ucsuzFirlatti = false;
  let ucsuzYazildi: boolean | null = null;
  try {
    ucsuzYazildi = await writeWarehouseMovement(
      prisma,
      { rollId: rC, eventType: WarehouseEventType.CANCEL, qty: 50 },
      { onZeroQty: "throw" },
    );
  } catch { ucsuzFirlatti = true; }
  check(
    "§10c ⭐ Uçsuz satır (deposuz top) FIRLATMAZ — politika yalnız metraj için",
    !ucsuzFirlatti && ucsuzYazildi === false && (await satirlar(rC)).length === 0,
    `fırlattı=${ucsuzFirlatti} yazıldı=${String(ucsuzYazildi)}`,
  );

  // ── §6..§9 — ters kayıt ───────────────────────────────────────────────────
  const fwd1 = await prisma.$transaction(async (tx) =>
    postStockMove(tx, {
      rollId: rC, eventType: WarehouseEventType.PRODUCTION, qty: 70,
      to: { warehouseId: wh.id, status: RollStatus.WAREHOUSE },
      reasonCode: STOCK_MOVE_REASON.PRODUCTION_RECEIPT,
    }),
  );
  const rev1 = await prisma.$transaction(async (tx) =>
    reverseStockMove(tx, fwd1, { reasonCode: STOCK_MOVE_REASON.PRODUCTION_RECEIPT }),
  );
  const r1 = (await satirlar(rC)).find((x) => x.id === rev1);
  check(
    "§6 Override yokken `eventType` ileri satırdan kopyalandı, yön aynalandı",
    r1?.eventType === WarehouseEventType.PRODUCTION && r1?.fromWarehouseId === wh.id &&
      r1?.toWarehouseId === null && r1?.fromStatus === RollStatus.WAREHOUSE &&
      Number(r1?.qty) === 70 && r1?.reversesMovementId === fwd1,
    `${String(r1?.eventType)} qty=${String(r1?.qty)}`,
  );

  const fwd2 = await prisma.$transaction(async (tx) =>
    postStockMove(tx, {
      rollId: rD, eventType: WarehouseEventType.CANCEL, qty: 25,
      from: { warehouseId: wh.id, status: RollStatus.WAREHOUSE },
      reasonCode: STOCK_MOVE_REASON.STOCK_COUNT,
    }),
  );
  const rev2 = await prisma.$transaction(async (tx) =>
    reverseStockMove(tx, fwd2, {
      reasonCode: STOCK_MOVE_REASON.STOCK_COUNT,
      eventType: WarehouseEventType.CANCEL_REVERSAL,
    }),
  );
  const r2 = (await satirlar(rD)).find((x) => x.id === rev2);
  check(
    "§7 ⭐ Override yazıldı ama yön/metraj/bağ ileri satırdan geldi",
    r2?.eventType === WarehouseEventType.CANCEL_REVERSAL && r2?.toWarehouseId === wh.id &&
      r2?.fromWarehouseId === null && r2?.toStatus === RollStatus.WAREHOUSE &&
      Number(r2?.qty) === 25 && r2?.reversesMovementId === fwd2,
    `${String(r2?.eventType)} → ${String(r2?.toStatus)}`,
  );

  let kod = 0;
  try {
    await prisma.$transaction(async (tx) => reverseStockMove(tx, rev2, { reasonCode: STOCK_MOVE_REASON.STOCK_COUNT }));
  } catch (e) { kod = (e as { statusCode?: number }).statusCode ?? -1; }
  check("§8 Ters kaydın tersi 409", kod === 409, `kod=${kod}`);

  let p2002 = false;
  try {
    await prisma.$transaction(async (tx) =>
      reverseStockMove(tx, fwd2, { reasonCode: STOCK_MOVE_REASON.STOCK_COUNT, eventType: WarehouseEventType.CANCEL_REVERSAL }),
    );
  } catch (e) { p2002 = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"; }
  check("§9 ⭐ Aynı ileri satır iki kez terslenemedi (DB unique)", p2002);

  // ── §11 — STATÜSÜZ satır terslenemez ama SAYILIR ──────────────────────────
  // Eski kapılar (transfer · sevk · sayım) hâlâ statüsüz satır yazıyor; ucu
  // kurulamayan satırın tersi de kurulamaz. Sessizce yutulursa geri alma
  // "temiz" görünür ve mal defterde asılı kalır — bu yüzden sayı DÖNER.
  await writeWarehouseMovement(
    prisma,
    { rollId: rD, eventType: WarehouseEventType.CANCEL, qty: 5, fromWarehouseId: wh.id },
    { onZeroQty: "throw" },
  );
  const tersSonuc = await prisma.$transaction(async (tx) =>
    reverseAllRollStockMoves(tx, [rD], { reasonCode: STOCK_MOVE_REASON.STOCK_COUNT }),
  );
  check(
    "§11 ⭐ Statüsüz satır terslenmedi ama SAYILDI (sessiz yutma yok)",
    tersSonuc.reversed === 0 && tersSonuc.statusuzAtlanan === 1,
    `terslenen=${tersSonuc.reversed} statüsüz=${tersSonuc.statusuzAtlanan}`,
  );
  // Sayı bir yüzeye BASILIR: bu DB'de stok defterine henüz taşınmamış satır kaç
  // tane. Küme küçülmeli; büyüyorsa yeni bir yol eski kapıdan yazıyor demektir.
  const canliStatusuz = await prisma.warehouseMovement.count({
    where: { fromStatus: null, toStatus: null },
  });
  console.log(`   ℹ️ Bu DB'de statüsüz (stok defterine taşınmamış) satır: ${canliStatusuz}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    if (rollIds.length) {
      // Ters satırlar ÖNCE: `reversesMovementId` FK'sı RESTRICT.
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds }, reversesMovementId: { not: null } } });
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    console.log("(test verisi temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main()
  .catch((e) => { console.error("💥 ÇÖKTÜ:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); await pool.end(); process.exit(fail > 0 ? 1 : 0); });
