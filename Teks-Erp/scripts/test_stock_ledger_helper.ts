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
  writeWarehouseMovement,
  writeWarehouseMovements,
} from "../src/services/helpers/warehouse-ledger.helper";
import {
  reverseAllRollStockMoves,
  reverseLegacyStockMove,
  reverseStockMove,
} from "../src/services/helpers/warehouse-ledger-reverse.helper";
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
const TERS_YOLU = join(__dirname, "..", "src", "services", "helpers", "warehouse-ledger-reverse.helper.ts");
/** İKİ dosya taranır: yazma kapısı + ters kayıt kapısı. Tek dosya tarayan bir
 *  sürüm, ters kayıt kapısı ayrıldığı gün §4d'yi SESSİZCE boşa düşürürdü. */
const TARANAN_HELPERLAR = [HELPER_YOLU, TERS_YOLU];

/** `data:` argümanı inline nesne literali olan stok-defteri yazımları + map sayısı. */
function astTekKaynak(): {
  inlineYazim: string[];
  mapSayisi: number;
  mapAnahtarlari: Set<string>;
  girdiAnahtarlari: string[];
  tersSelect: Set<string>;
} {
  const kaynaklar = TARANAN_HELPERLAR.map((y) =>
    ts.createSourceFile(y, readFileSync(y, "utf8"), ts.ScriptTarget.ES2022, true),
  );
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
  for (const src of kaynaklar) gezMap(src);

  // (c) Stok defteri fonksiyonlarının İÇİNDE inline `data:` literali olmamalı.
  const gezYazim = (src: ts.SourceFile) => (n: ts.Node): void => {
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
    ts.forEachChild(n, gezYazim(src));
  };
  for (const src of kaynaklar) {
    for (const st of src.statements) {
      if (ts.isFunctionDeclaration(st) && st.name && ["postStockMove", "postStockMoves"].includes(st.name.text)) {
        gezYazim(src)(st);
      }
    }
  }

  // (d) `reverseStockMove`un OKUMA tarafı: ileri satırdan taşınacak her bağ alanı
  //     `select`te olmalı. Burası map'in İKİNCİ kopyasıdır — üç alan (transformGroupId,
  //     rollVarianceId, workOrderStepId) burada eksikti ve ters satır NULL doğuyordu.
  const tersSelect = new Set<string>();
  for (const st of kaynaklar.flatMap((s) => [...s.statements])) {
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
  const kaynaklar = TARANAN_HELPERLAR.map((y) =>
    ts.createSourceFile(y, readFileSync(y, "utf8"), ts.ScriptTarget.ES2022, true),
  );
  const sahipler = new Set<string>();
  const yigin: string[] = [];
  const gez = (src: ts.SourceFile) => (n: ts.Node): void => {
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
    ts.forEachChild(n, gez(src));
    if (itildi) yigin.pop();
  };
  for (const src of kaynaklar) gez(src)(src);
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
  console.log(
    `   ℹ️ §4e kapsamı: ${TARANAN_HELPERLAR.length} dosya taranmıştır — ` +
      TARANAN_HELPERLAR.map((y) => y.split("/").slice(-1)[0]).join(", "),
  );
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
    yazildi = await writeWarehouseMovement(prisma, sifirSatir, { onUnwritable: "skip" });
    topluYazilan = await writeWarehouseMovements(prisma, [sifirSatir], { onUnwritable: "skip" });
  } catch { skipPatladi = true; }
  check(
    '§10a ⭐ "skip" politikası: atlar, DB seddine çarpmaz ve atladığını DÖNER',
    !skipPatladi && yazildi === false && topluYazilan === 0 && (await satirlar(rC)).length === 0,
    `patladı=${skipPatladi} yazıldı=${String(yazildi)} toplu=${String(topluYazilan)}`,
  );
  // ── "throw" → TUTARSIZLIK SİNYALİ: sessizce geçmez ────────────────────────
  let tekilFirlatti = false;
  let topluFirlatti = false;
  try { await writeWarehouseMovement(prisma, sifirSatir, { onUnwritable: "throw" }); } catch { tekilFirlatti = true; }
  try { await writeWarehouseMovements(prisma, [sifirSatir], { onUnwritable: "throw" }); } catch { topluFirlatti = true; }
  check(
    '§10b ⭐ "throw" politikası: 0 metrajda İKİ kapı da FIRLATIR (sessiz atlama yok)',
    tekilFirlatti && topluFirlatti && (await satirlar(rC)).length === 0,
    `tekil=${tekilFirlatti} toplu=${topluFirlatti}`,
  );
  // ── §10c — UÇSUZ satır POLİTİKAYA TABİDİR (2026-09-13 hükmü) ─────────────
  // ⚠️ BU KONTROL TERS ÇEVRİLDİ. Eski hâli "uçsuz satır FIRLATMAZ" diyordu ve
  // gerekçesi defter öncesi doğan deposuz topların sevkini kilitlememekti. İki
  // ayak da boşaldı: popülasyon 0'a indi (backfill) ve yeni deposuz top DOĞAMAZ
  // (`resolveTargetWarehouseId` artık `null` dönmüyor). Sessiz atlamanın ölçülen
  // bedeli: iki top sevk edildi, tek `SHIPMENT` satırı yazıldı.
  let ucsuzFirlatti = false;
  let ucsuzToplu = false;
  try {
    await writeWarehouseMovement(
      prisma,
      { rollId: rC, eventType: WarehouseEventType.CANCEL, qty: 50 },
      { onUnwritable: "throw" },
    );
  } catch { ucsuzFirlatti = true; }
  try {
    await writeWarehouseMovements(
      prisma,
      [{ rollId: rC, eventType: WarehouseEventType.CANCEL, qty: 50 }],
      { onUnwritable: "throw" },
    );
  } catch { ucsuzToplu = true; }
  check(
    '§10c ⭐ "throw" politikasında UÇSUZ satır da FIRLATIR (iki kapı, tek sertlik)',
    ucsuzFirlatti && ucsuzToplu && (await satirlar(rC)).length === 0,
    `tekil=${ucsuzFirlatti} toplu=${ucsuzToplu}`,
  );
  // Ve `"skip"` diyen çağıran için meşru atlama DURUYOR — hüküm sessizliği değil
  // POLİTİKASIZLIĞI kaldırdı. İkisi aynı şey olsaydı 0 metrajlı topun iptali de
  // kilitlenirdi.
  let ucsuzSkipPatladi = false;
  let ucsuzSkipYazildi: boolean | null = null;
  try {
    ucsuzSkipYazildi = await writeWarehouseMovement(
      prisma,
      { rollId: rC, eventType: WarehouseEventType.CANCEL, qty: 50 },
      { onUnwritable: "skip" },
    );
  } catch { ucsuzSkipPatladi = true; }
  check(
    '§10d ⭐ "skip" diyen çağıranda uçsuz satır MEŞRU atlama (atladığını döner)',
    !ucsuzSkipPatladi && ucsuzSkipYazildi === false && (await satirlar(rC)).length === 0,
    `patladı=${ucsuzSkipPatladi} yazıldı=${String(ucsuzSkipYazildi)}`,
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
    { onUnwritable: "throw" },
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

  // ── §12 — K1: UÇ BİÇİMİ (stok dışı uç depo taşımaz, stok ucu depo ister) ───
  // Eski tip `warehouseId: string` zorunluydu, yani "WAREHOUSE'tan SHIPPED'e
  // gitti" cümlesi YAZILAMIYORDU: sevk satırı `to`suz doğuyor ve "nereye gitti"
  // kalıcı olarak kayboluyordu. Kural tek bir iff'tir ve İKİ YÖNÜ de sessiz
  // olmamalı — bu yüzden §12b/§12c/§12d birer NEGATİF SONDA.
  const rE = await mkRoll("E");
  const sevkId = await prisma.$transaction(async (tx) =>
    postStockMove(tx, {
      rollId: rE, eventType: WarehouseEventType.SHIPMENT, qty: 100,
      from: { warehouseId: wh.id, status: RollStatus.WAREHOUSE },
      to: { warehouseId: null, status: RollStatus.SHIPPED },
      reasonCode: STOCK_MOVE_REASON.STOCK_COUNT,
    }),
  );
  const sE = await satirlar(rE);
  check(
    "§12a ⭐ Stok dışı uç YAZILDI: depo NULL ama statü dolu (`→ SHIPPED` artık yazılabiliyor)",
    sE.length === 1 && sE[0]?.fromWarehouseId === wh.id && sE[0]?.fromStatus === RollStatus.WAREHOUSE &&
      sE[0]?.toWarehouseId === null && sE[0]?.toStatus === RollStatus.SHIPPED,
    `from=${String(sE[0]?.fromStatus)}/${sE[0]?.fromWarehouseId === wh.id} to=${String(sE[0]?.toStatus)}/${String(sE[0]?.toWarehouseId)}`,
  );

  // ⚠️ MESAJI DA DÖNER, yalnız "fırlattı mı"yı değil: `warehouse_movements`ta
  // `warehouse_movements_direction_present` CHECK'i ZATEN var (en az bir depo ucu)
  // ve aynı fikstürü o da reddediyor. "Fırlattı" ile yetinen bir kontrol hangi
  // seddin tuttuğunu söylemez — kod kapısı silinse bile DB'ye çarpıp yeşil kalır
  // (ölçüldü: §64 bloğu silindi, kontrol yeşil kaldı; tutan sed DB'ydi).
  const hata = async (input: Parameters<typeof postStockMove>[1]): Promise<string | null> => {
    try {
      await prisma.$transaction(async (tx) => postStockMove(tx, input));
      return null;
    } catch (e) { return e instanceof Error ? e.message : String(e); }
  };
  const firlatirMi = async (input: Parameters<typeof postStockMove>[1]): Promise<boolean> =>
    (await hata(input)) !== null;
  const rF = await mkRoll("F");
  // ⚠️ FİKSTÜR K1'İN A YÖNÜNÜ İZOLE ETMEK ZORUNDA: karşı uç GEÇERLİ bir stok ucu
  // olmalı. Tek uçlu (`to` yalnız) bir fikstür §64 seddine de takılır ve iki sed
  // aynı satırı yakaladığı için A yönü silinse bile kontrol yeşil kalır — negatif
  // sonda bunu ilk koşuda yakaladı (ölçüldü: `assertEndShape` silindi, §12b yeşil).
  check(
    "§12b ⭐ NEGATİF: stok statüsü + DEPOSUZ uç FIRLATIR (deposuz top stok kümesine giremez)",
    await firlatirMi({
      rollId: rF, eventType: WarehouseEventType.TRANSFER, qty: 10,
      from: { warehouseId: wh.id, status: RollStatus.WAREHOUSE },
      to: { warehouseId: null, status: RollStatus.WAREHOUSE },
      reasonCode: STOCK_MOVE_REASON.ENTRY_RECEIPT,
    }),
  );
  check(
    "§12c ⭐ NEGATİF: stok DIŞI statü + depolu uç FIRLATIR (stok dışı uç depo taşımaz)",
    await firlatirMi({
      rollId: rF, eventType: WarehouseEventType.SHIPMENT, qty: 10,
      from: { warehouseId: wh.id, status: RollStatus.WAREHOUSE },
      to: { warehouseId: wh.id, status: RollStatus.SHIPPED },
      reasonCode: STOCK_MOVE_REASON.STOCK_COUNT,
    }),
  );
  // §12d KOD KAPISINI izole eder: mesaj bizim Türkçe cümlemiz olmalı. DB'nin ham
  // 23514'ü de satırı durdurur ama çağırana teşhis edilebilir bir şey söylemez.
  const ikiUcDisi = await hata({
    rollId: rF, eventType: WarehouseEventType.EXTERNAL, qty: 10,
    from: { warehouseId: null, status: RollStatus.SHIPPED },
    to: { warehouseId: null, status: RollStatus.AT_KARTELA },
    reasonCode: STOCK_MOVE_REASON.KARTELA_DISPATCH,
  });
  check(
    "§12d ⭐ NEGATİF: iki uç da stok dışı KOD KAPISINDA durdu (DB'nin 23514'üne düşmeden)",
    ikiUcDisi !== null && ikiUcDisi.includes("en az bir ucu STOK KÜMESİNDE"),
    `mesaj=${ikiUcDisi?.slice(0, 120) ?? "fırlatmadı"}`,
  );
  // Ve DB ikizi DE yerinde: kod kapısı bir gün kaldırılırsa satır yine yazılamaz.
  // (`warehouse_movements_direction_present`, K1'in iff'i altında §64'ün DB hâli.)
  const dbSeddi = await prisma.$queryRaw<{ conname: string }[]>`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'warehouse_movements'::regclass AND contype = 'c'
      AND conname = 'warehouse_movements_direction_present'`;
  check(
    "§12g ⭐ §64'ün DB ikizi yerinde (`warehouse_movements_direction_present`)",
    dbSeddi.length === 1,
    `bulunan=${dbSeddi.length}`,
  );
  check("§12e ⭐ Üç negatif sonda HİÇBİR satır yazmadı", (await satirlar(rF)).length === 0);

  // Ters kayıt stok dışı ucu AYNALIYOR mu: eski koşul `toWarehouseId && toStatus`
  // olduğu için sevk satırının tersi `from`suz doğuyordu, yani "mal SHIPPED'ten
  // geri geldi" ucu kayboluyordu.
  const sevkTersId = await prisma.$transaction(async (tx) =>
    reverseStockMove(tx, sevkId, {
      reasonCode: STOCK_MOVE_REASON.STOCK_COUNT,
      eventType: WarehouseEventType.SHIPMENT_REVERSAL,
    }),
  );
  const sevkTers = (await satirlar(rE)).find((r) => r.id === sevkTersId);
  check(
    "§12f ⭐ Ters kayıt STOK DIŞI ucu aynaladı (`from = {∅, SHIPPED}` korundu)",
    sevkTers?.fromStatus === RollStatus.SHIPPED && sevkTers?.fromWarehouseId === null &&
      sevkTers?.toStatus === RollStatus.WAREHOUSE && sevkTers?.toWarehouseId === wh.id,
    `from=${String(sevkTers?.fromStatus)}/${String(sevkTers?.fromWarehouseId)} to=${String(sevkTers?.toStatus)}/${String(sevkTers?.toWarehouseId)}`,
  );

  // ── §13 — K4: LEGACY (statüsüz) ileri satırın BAĞLI tersi ─────────────────
  // Statüsüz satır `reverseStockMove` ile terslenemez (aynalanacak uç yok) ve
  // atlanırsa Σ eksik kalır: storno malı rafa döndürür, defter girişi görmez.
  // `reverseLegacyStockMove` bağı ileri satıra kurar, ucu CANLI veriden alır.
  const rG = await mkRoll("G");
  await writeWarehouseMovement(
    prisma,
    { rollId: rG, eventType: WarehouseEventType.SHIPMENT, qty: 100, fromWarehouseId: wh.id },
    { onUnwritable: "throw" },
  );
  const legacyFwd = (await satirlar(rG))[0]!;
  const legacyTersId = await prisma.$transaction(async (tx) =>
    reverseLegacyStockMove(tx, legacyFwd.id, {
      reasonCode: STOCK_MOVE_REASON.STOCK_COUNT,
      eventType: WarehouseEventType.SHIPMENT_REVERSAL,
      from: { warehouseId: null, status: RollStatus.SHIPPED },
      to: { warehouseId: wh.id, status: RollStatus.WAREHOUSE },
    }),
  );
  const legacyTers = (await satirlar(rG)).find((r) => r.id === legacyTersId);
  check(
    "§13a ⭐ Legacy ters BAĞLI doğdu · uç canlıdan · metraj İLERİ SATIRDAN",
    legacyTers?.reversesMovementId === legacyFwd.id && Number(legacyTers?.qty) === 100 &&
      legacyTers?.toWarehouseId === wh.id && legacyTers?.toStatus === RollStatus.WAREHOUSE,
    `bağ=${String(legacyTers?.reversesMovementId === legacyFwd.id)} metraj=${String(legacyTers?.qty)}`,
  );
  let legacyP2002 = false;
  try {
    await prisma.$transaction(async (tx) =>
      reverseLegacyStockMove(tx, legacyFwd.id, {
        reasonCode: STOCK_MOVE_REASON.STOCK_COUNT,
        to: { warehouseId: wh.id, status: RollStatus.WAREHOUSE },
      }),
    );
  } catch (e) { legacyP2002 = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"; }
  check("§13b ⭐ NEGATİF: legacy dal çift stornoyu DB unique'ine çarptırdı", legacyP2002);

  const legacyFirlatirMi = async (movementId: string): Promise<boolean> => {
    try {
      await prisma.$transaction(async (tx) =>
        reverseLegacyStockMove(tx, movementId, {
          reasonCode: STOCK_MOVE_REASON.STOCK_COUNT,
          to: { warehouseId: wh.id, status: RollStatus.WAREHOUSE },
        }),
      );
      return false;
    } catch { return true; }
  };
  // STATÜLÜ satır legacy dala girmez — iki fonksiyonun kapsamı örtüşmemeli,
  // yoksa legacy dal statülü satırların ucunu da "canlıdan" yazmaya başlar.
  const rH = await mkRoll("H");
  const statuluId = await prisma.$transaction(async (tx) =>
    postStockMove(tx, {
      rollId: rH, eventType: WarehouseEventType.CANCEL, qty: 20,
      from: { warehouseId: wh.id, status: RollStatus.WAREHOUSE },
      reasonCode: STOCK_MOVE_REASON.ROLL_CANCEL,
    }),
  );
  check("§13c ⭐ NEGATİF: STATÜLÜ satır legacy dala girmez, FIRLATIR", await legacyFirlatirMi(statuluId));

  // ⚠️ §13d KAÇIŞ KAPISININ KAPANDIĞINI ölçer (yönetici şartı): legacy dalın
  // `preEpoch=false`a izin vermesi YALNIZ epoch henüz çizilmemişken geçerli bir
  // gevşetmedir. Epoch çizildikten sonra statüsüz satır bir HATA SİNYALİDİR ve
  // dal onu susturmamalı. Ulaşılamazlığı ölçülmemiş bir dal, ulaşılabilir sayılır.
  const rI = await mkRoll("I");
  await writeWarehouseMovement(
    prisma,
    { rollId: rI, eventType: WarehouseEventType.SHIPMENT, qty: 30, fromWarehouseId: wh.id },
    { onUnwritable: "throw" },
  );
  const epochSonrasiId = (await satirlar(rI))[0]!.id;
  const epochSatiri = await prisma.warehouseMovement.create({
    data: {
      rollId: rI, eventType: WarehouseEventType.OPENING_BALANCE, qty: 1,
      toWarehouseId: wh.id, toStatus: RollStatus.WAREHOUSE,
      reasonCode: STOCK_MOVE_REASON.OPENING, notes: `${TAG} epoch sondası`,
    },
    select: { id: true },
  });
  try {
    check(
      "§13d ⭐ NEGATİF: epoch ÇİZİLDİKTEN sonra preEpoch=false statüsüz satır legacy dala GİRMEZ (kaçış kapısı kapalı)",
      await legacyFirlatirMi(epochSonrasiId),
    );
    // Ve aynı epoch altında `preEpoch=true` satır HÂLÂ terslenebilir: gevşetme
    // kalkmıyor, yalnız tarihsel satıra daralıyor.
    await prisma.warehouseMovement.update({ where: { id: epochSonrasiId }, data: { preEpoch: true } });
    check(
      "§13e ⭐ Epoch varken preEpoch=TRUE satır legacy dala girer (damga ayrımı çalışıyor)",
      !(await legacyFirlatirMi(epochSonrasiId)),
    );
  } finally {
    await prisma.warehouseMovement.deleteMany({ where: { reversesMovementId: epochSonrasiId } });
    await prisma.warehouseMovement.deleteMany({ where: { id: epochSatiri.id } });
  }

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
