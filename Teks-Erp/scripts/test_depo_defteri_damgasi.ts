// =============================================================================
// Bekçi: DEPO/STOK HAREKET DEFTERİNİN SAATİ — top başına kesin artan damga + tek sıra tanımı
// Çalıştır: npx tsx scripts/test_depo_defteri_damgasi.ts   (DB ister; tx GERİ ALINIR)
// =============================================================================
// Ölçüm (2026-09-26, sıcak tek tx, tek topta 300 ileri + bağlı ters): Prisma'nın ms'lik istemci
// saatiyle 599 komşudan 113–188'i AYNI ms'e düşüyordu ve `(createdAt, id)` sırasında ters satır
// ilerisinden ÖNCE görünüyordu (5–15 kez); okuyucular (depo hareket listesi, "en son terslenmemiş
// ileri satır" findFirst'leri) eşitlik bozucusuzdu. Kök kural: olay anını yazar verir.
//   §1 ⭐ saat: dört yazarın (`writeWarehouseMovement` · `writeWarehouseMovements` · `postStockMove` ·
//      `postStockMoves`) ve ters yolun (`reverseStockMove`) satırı, topun son (gelecekteki) satırından
//      SONRA damgalanır; aynı tx'te ardışık ileri + ters satırlar kesin artan · (c) satırsız topta damga DB saati
//      aralığında · (d) toplu çağrıda BÜTÜN topların son satırından sonra · (e) aynı top toplu çağrıda iki kez →
//      dizi sırasıyla kesin artan (06 denetimi: saat terimi sıfırlanınca ya da yalnız ilk top damgalanınca 9/0)
//   §2 ⭐ tek sıra tanımı (AST, DB'siz, `lib/tek-sira-tarama`): ölçülemeyen okuyucu (literal olmayan argüman ·
//      kısaltılmış `orderBy` · spread) KIRMIZI; tek satır okuyucu (`findFirst`) `MOVEMENT_DESC` — artan okuma yalnız
//      beyanla (iki yönlü); saf sondalar ✓K3 her koşumda. `src/` altında `warehouseMovement.find*` sıralaması yalnız
//      `MOVEMENT_ASC`/`MOVEMENT_DESC`ten gelir — ya sabitin kendisi ya da öneki olan dizinin KUYRUĞU
//      (`[{ rollId }, ...MOVEMENT_ASC]`, top başına gruplama); elle `{ createdAt }` yok; sabitler eşitlikte
//      `id` taşır. Körlük zemini: ≥ 15 sıralı okuyucu.
// Gerekli mi: doğduğu gün tabandaki 17 okuyucunun 16'sı eşitlik bozucusuzdu; düzeltme aynı commit'te.
// Sonda (✓B3, bu commit; md5 ile geri alındı): ① `postStockMove` damgayı vermez → §1 ❌2 ·
// ② "son satır + 1 ms" terimi kalkar → §1 ❌6 · ③ bir okuyucu elle `{ createdAt: "desc" }`e döner → §2 ❌1.
// Sonda (✓B3, 06 denetimi madde 10; md5 ile geri alındı): saat terimi `to_timestamp(0)` → (c) ❌1 · toplu damga yalnız
// ilk toptan → (d) ❌1 · aynı topun tekrar ofseti kalkar → (e) ❌1 (ilk ikisi düzeltmeden önce 9/0 idi).
// Sonda (✓B3, 06 denetimi madde 11; md5 ile geri alındı): kısaltılmış `orderBy,` + yerel sabit → §2 ÖLÇÜLEMEDİ ❌1 ·
// "en son" okuyucusu `MOVEMENT_DESC → ASC` → §2 ❌1 (ikisi düzeltmeden önce 12/0 idi) · saf sondalar ✓K3 her koşumda.
// =============================================================================
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import {
  MOVEMENT_ASC,
  MOVEMENT_DESC,
  postStockMove,
  postStockMoves,
  writeWarehouseMovement,
  writeWarehouseMovements,
} from "../src/services/helpers/warehouse-ledger.helper";
import { reverseStockMove } from "../src/services/helpers/warehouse-ledger-reverse.helper";
import { walkTs } from "./lib/ts-tarama";
import { bosSonuc, tekSiraKaynak, tekSiraTara, type TekSiraKurali } from "./lib/tek-sira-tarama";
import { fixtureHedefEngeli, hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const ROOT = join(__dirname, "..");
class GeriAl extends Error {}

async function saat(): Promise<void> {
  console.log("§1 ⭐ Saat — top başına kesin artan (tx geri alınır)");
  const TAG = `TST-DDD-${Date.now()}`;
  let olcum: { gelecek: number; yazar: Array<[string, number]>; ardisik: number[] } | null = null;
  let aralik: { t0: number; t1: number; an: number } | null = null;
  let kapsam: { gelecek: number; anlar: number[] } | null = null;
  let ikiKez: number[] = [];
  await prisma.$transaction(async (tx) => {
    const wh = await tx.warehouse.findFirstOrThrow({ where: { isDefault: true }, select: { id: true } });
    const item = await tx.item.create({ data: { code: TAG, name: TAG, itemType: "FABRIC" }, select: { id: true } });
    const roll = await tx.roll.create({
      data: { barcode: TAG, itemId: item.id, initialQty: 100, currentQty: 100, status: "WAREHOUSE", warehouseId: wh.id, entrySource: "SUPPLIER_RECEIPT" },
      select: { id: true },
    });
    const [g] = await tx.$queryRaw<Array<{ at: Date }>>`
      INSERT INTO "warehouse_movements" ("id","rollId","eventType","toWarehouseId","qty","reasonCode","createdAt")
      VALUES (${randomUUID()}::uuid, ${roll.id}::uuid, 'ENTRY', ${wh.id}::uuid, 100, 'TST_FUTURE',
        now() + interval '1 hour') -- tz-ok: timestamptz, sonda satırı bilerek gelecekte
      RETURNING "createdAt" AS at`;
    const son = async (): Promise<number> =>
      (await tx.warehouseMovement.findFirstOrThrow({ where: { rollId: roll.id }, orderBy: MOVEMENT_DESC, select: { createdAt: true } })).createdAt.getTime();
    const yazar: Array<[string, number]> = [];
    const giris = { rollId: roll.id, eventType: "ENTRY" as const, qty: 1, toWarehouseId: wh.id };
    await writeWarehouseMovement(tx, giris, { onUnwritable: "throw" });
    yazar.push(["writeWarehouseMovement", await son()]);
    await writeWarehouseMovements(tx, [giris], { onUnwritable: "throw" });
    yazar.push(["writeWarehouseMovements", await son()]);
    const stok = { rollId: roll.id, eventType: "PRODUCTION" as const, qty: 100, from: { warehouseId: wh.id, status: "WAREHOUSE" as const }, to: { warehouseId: null, status: "IN_PRODUCTION" as const }, reasonCode: "PRODUCTION_ISSUE" };
    const ileri = await postStockMove(tx, stok);
    yazar.push(["postStockMove", await son()]);
    await reverseStockMove(tx, ileri, { reasonCode: "TST_REVERSE" });
    yazar.push(["reverseStockMove", await son()]);
    await postStockMoves(tx, [stok]);
    yazar.push(["postStockMoves", await son()]);
    for (let i = 0; i < 10; i++) {
      const id = await postStockMove(tx, stok);
      await reverseStockMove(tx, id, { reasonCode: "TST_REVERSE" });
    }
    const hepsi = await tx.warehouseMovement.findMany({ where: { rollId: roll.id }, orderBy: MOVEMENT_ASC, select: { createdAt: true } });
    olcum = { gelecek: g!.at.getTime(), yazar, ardisik: hepsi.map((r) => r.createdAt.getTime()) };

    // (c) saat aralığı: satırı hiç olmayan top — damga yazım anındaki DB saatidir (sabit/sıfır saat geçmez).
    const yeniTop = async (ek: string) => (await tx.roll.create({
      data: { barcode: `${TAG}-${ek}`, itemId: item.id, initialQty: 100, currentQty: 100, status: "WAREHOUSE", warehouseId: wh.id, entrySource: "SUPPLIER_RECEIPT" },
      select: { id: true },
    })).id;
    const saatDb = async () => (await tx.$queryRaw<Array<{ t: Date }>>`SELECT clock_timestamp() AS t`)[0]!.t.getTime();
    const bosTop = await yeniTop("C");
    const t0 = await saatDb();
    await postStockMove(tx, { ...stok, rollId: bosTop });
    const t1 = await saatDb();
    const cAn = (await tx.warehouseMovement.findFirstOrThrow({ where: { rollId: bosTop }, select: { createdAt: true } })).createdAt.getTime();
    aralik = { t0, t1, an: cAn };
    // (d) toplu kapsam: ilk top boş, ikincinin son satırı gelecekte — iki satır da o satırdan SONRA.
    const [dTop, eTop] = [await yeniTop("D"), await yeniTop("E")];
    const [eG] = await tx.$queryRaw<Array<{ at: Date; id: string }>>`
      INSERT INTO "warehouse_movements" ("id","rollId","eventType","toWarehouseId","qty","reasonCode","createdAt")
      VALUES (${randomUUID()}::uuid, ${eTop}::uuid, 'ENTRY', ${wh.id}::uuid, 100, 'TST_FUTURE',
        now() + interval '2 hour') -- tz-ok: timestamptz, sonda satırı bilerek gelecekte
      RETURNING "createdAt" AS at, "id"::text AS id`;
    await postStockMoves(tx, [{ ...stok, rollId: dTop }, { ...stok, rollId: eTop }]);
    await writeWarehouseMovements(tx, [{ ...giris, rollId: dTop }, { ...giris, rollId: eTop }], { onUnwritable: "throw" });
    const toplu = await tx.warehouseMovement.findMany({ where: { rollId: { in: [dTop, eTop] }, id: { not: eG!.id } }, select: { createdAt: true } });
    kapsam = { gelecek: eG!.at.getTime(), anlar: toplu.map((r) => r.createdAt.getTime()) };
    // (e) aynı top bir toplu çağrıda iki kez: satırlar dizi sırasıyla KESİN artan.
    const fTop = await yeniTop("F");
    await postStockMoves(tx, [{ ...stok, rollId: fTop, notes: "1" }, { ...stok, rollId: fTop, notes: "2" }]);
    await writeWarehouseMovements(tx, [{ ...giris, rollId: fTop, notes: "3" }, { ...giris, rollId: fTop, notes: "4" }], { onUnwritable: "throw" });
    const fSatir = await tx.warehouseMovement.findMany({ where: { rollId: fTop }, select: { createdAt: true, notes: true } });
    ikiKez = ["1", "2", "3", "4"].map((n) => fSatir.find((r) => r.notes === n)!.createdAt.getTime());
    throw new GeriAl();
  }).catch((e: unknown) => { if (!(e instanceof GeriAl)) throw e; });
  const o = olcum as { gelecek: number; yazar: Array<[string, number]>; ardisik: number[] } | null;
  if (!o) { check("ölçüm alındı", false); return; }
  let onceki = o.gelecek;
  for (const [ad, t] of o.yazar) {
    check(`${ad}: satır topun son satırından SONRA`, t > onceki, `${new Date(onceki).toISOString()} → ${new Date(t).toISOString()}`);
    onceki = t;
  }
  const a = o.ardisik;
  check(`aynı tx'te ${a.length} satır kesin artan (eşit an yok)`, a.every((t, i) => i === 0 || t > a[i - 1]!), `${new Set(a).size} farklı an`);
  const r = aralik as { t0: number; t1: number; an: number } | null;
  check("(c) satırsız topta damga yazım anındaki DB saati (aralıkta)", !!r && r.an >= r.t0 && r.an <= r.t1 + 1,
    r ? `${new Date(r.t0).toISOString()} ≤ ${new Date(r.an).toISOString()} ≤ ${new Date(r.t1 + 1).toISOString()}` : "-");
  const k = kapsam as { gelecek: number; anlar: number[] } | null;
  check("(d) toplu çağrıda damga BÜTÜN topların son satırından sonra (ilk top boş, ikinci gelecekte)",
    !!k && k.anlar.length === 4 && k.anlar.every((t) => t > k.gelecek), k ? `${k.anlar.filter((t) => t > k.gelecek).length}/4` : "-");
  const f = ikiKez;
  check("(e) aynı top bir toplu çağrıda iki kez: satırlar dizi sırasıyla kesin artan",
    f.length === 4 && f.every((t, i) => i === 0 || t > f[i - 1]!), f.map((t) => new Date(t).toISOString().slice(17)).join(" < "));
}

/** Depo defterinin sıra kuralı — artan `findFirst` yalnız beyanla. */
const DEPO_SIRA: TekSiraKurali = {
  model: "warehouseMovement",
  sabitler: new Set(["MOVEMENT_ASC", "MOVEMENT_DESC"]),
  enSon: new Set(["MOVEMENT_DESC"]),
  artanBeyan: {
    "src/services/kartela.service.ts#cancelDispatch":
      "kartela sevk iptali: topun bu sevk için TEK açık EXTERNAL satırı olur; birden çoksa en ESKİsi (FIFO) terslenir",
    "src/services/shipping.service.ts#writeUndoDispatchLedgerTx":
      "sevk stornosu: topun bu sevkiyatta TEK açık SHIPMENT satırı olur; birden çoksa en ESKİsi (FIFO) terslenir",
  },
};

function tekSiraTanimi(): void {
  console.log("§2 ⭐ Tek sıra tanımı — okuyucular `MOVEMENT_ASC`/`MOVEMENT_DESC`, tek satır okuyucu \"en son\"");
  check("sabitler eşitlikte id taşır",
    JSON.stringify(MOVEMENT_ASC) === '[{"createdAt":"asc"},{"id":"asc"}]' && JSON.stringify(MOVEMENT_DESC) === '[{"createdAt":"desc"},{"id":"desc"}]');
  // Saf sondalar (✓K, her koşumda): tarayıcının kendisi — ölçülemeyen uyumlu sayılmaz, yön kuralı ısırır.
  const sonda = (kod: string) => {
    const r = bosSonuc();
    tekSiraKaynak("sonda.ts", kod, DEPO_SIRA, r, new Set());
    return r;
  };
  // Model adı dizgede ayrı kurulur: metin tarayıcıları (keyfi arama) sonda dizgesini gerçek çağrı sanmasın.
  const d = `tx.${DEPO_SIRA.model}`;
  const K = {
    kisa: sonda(`async function f(tx, id){ const orderBy = { createdAt: 'desc' }; return ${d}.findFirst({ where: { id }, orderBy }); }`),
    literalDegil: sonda(`async function f(tx, a){ return ${d}.findFirst(a); }`),
    spread: sonda(`async function f(tx, a, id){ return ${d}.findMany({ ...a, where: { id } }); }`),
    elle: sonda(`async function f(tx, id){ return ${d}.findMany({ where: { id }, orderBy: { createdAt: 'desc' } }); }`),
    artan: sonda(`async function f(tx, id){ return ${d}.findFirst({ where: { id }, orderBy: MOVEMENT_ASC }); }`),
    enSon: sonda(`async function f(tx, id){ return ${d}.findFirst({ where: { id }, orderBy: MOVEMENT_DESC }); }`),
    onekli: sonda(`async function f(tx, id){ return ${d}.findMany({ where: { id }, orderBy: [{ rollId: 'asc' }, ...MOVEMENT_ASC] }); }`),
  };
  check("saf sonda: kısaltılmış orderBy · literal olmayan argüman · spread → ÖLÇÜLEMEDİ",
    K.kisa.olculemedi.length === 1 && K.literalDegil.olculemedi.length === 1 && K.spread.olculemedi.length === 1);
  check("saf sonda: elle sıralama → ihlal · artan findFirst (beyansız) → ihlal",
    K.elle.ihlal.length === 1 && K.artan.ihlal.length === 1);
  check("saf sonda: \"en son\" findFirst ve önekli kuyruk → uyumlu",
    K.enSon.ihlal.length + K.enSon.olculemedi.length === 0 && K.onekli.ihlal.length + K.onekli.olculemedi.length === 0);

  const r = tekSiraTara(ROOT, walkTs(join(ROOT, "src")), DEPO_SIRA);
  check("körlük zemini: ≥ 15 sıralı okuyucu tarandı", r.sirali >= 15, `${r.sirali}`);
  check("elle sıralama ya da \"en son\" olmayan tek satır okuyucu yok", r.ihlal.length === 0, r.ihlal.join(" · "));
  check("ölçülemeyen okuyucu yok (literal olmayan · kısaltılmış · spread)", r.olculemedi.length === 0, r.olculemedi.join(" · "));
  check("artan findFirst beyanı iki yönlü (her beyan canlı)", r.oluBeyan.length === 0 && r.beyanli.length === Object.keys(DEPO_SIRA.artanBeyan).length,
    `beyanlı ${r.beyanli.length} · ölü ${r.oluBeyan.join(", ")}`);
}

async function main(): Promise<void> {
  tekSiraTanimi();
  const engel = hedefDbEngeli() ?? fixtureHedefEngeli();
  if (engel) { check("hedef DB fixture DB'si", false, engel); return; }
  await saat();
}

main()
  .catch((e: unknown) => {
    fail++;
    console.log(`  ❌ beklenmeyen hata — ${e instanceof Error ? e.message : String(e)}`);
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
