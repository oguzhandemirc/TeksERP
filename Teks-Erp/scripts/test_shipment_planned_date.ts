// =============================================================================
// BEKÇİ — SEVKİYATTA PLANLANAN SEVK GÜNÜ (cari-be madde 4, 2026-11-13)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_shipment_planned_date.ts   (DB'li; TEST- fikstürü)
//
// Kural: `Shipment.plannedDate` takvim günüdür (DATE); yalnız PLANNED'de yazılır, sevkten sonra
// okunur kalır; alan gelmeyince NULL (eski istemci). Pano ajandası tarihli planlı sevkiyatı o güne
// ve ay takvimine koyar, tarihsizi ayrı listede tutar; gecikme sayacı/listesi ÜRETİLMEZ.
//   §0 statik — setter atomik claim `{id, status: PLANNED}` + 409 + audit; zod alanı opsiyonel,
//      uç gövdesinde zorunlu; ajanda yanıtında gecikme anahtarı yok.
//   §1 ayrıştırıcı — geçerli gün aynen döner; 30 Şubat / biçimsiz → 400 SHIPMENT_PLANNED_DATE_INVALID.
//   §2 doğuş — Hızlı Sevk alansız → NULL; `plannedDate` ile → kolon o gün (dilim kayması yok).
//   §3 düzenleme — PLANNED yaz/değiştir/temizle; DISPATCHED → 409 + değer değişmez; yok → 404.
//   §4 ajanda — tarihli planlı sevk ay hücresinde `sevk` + gün listesinde; tarihsiz listede değil;
//      geçmiş tarihli de yalnız kendi gününde; DISPATCHED tarihli ajandada yok; ay dışı gün ayrı sorgu.
//
// NEGATİF SONDALAR (2026-11-13, kırmızı görülüp md5 ile birebir geri alındı):
//   ① setter claim'inden `status: PLANNED` düşürülünce §0a/§3d ❌ (19/2)
//   ② ajanda tarihsiz listesinden `plannedDate: null` düşürülünce §4c ❌ (20/1)
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { RollEntrySource, RollStatus, ShipmentStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";
import { createShipmentSchema, plannedDateSchema, quickShipmentSchema } from "../src/controllers/shipping.controller";
import { parsePlannedDate, formatPlannedDate } from "../src/services/helpers/shipment-planned-date.helper";
import { agendaBox } from "../src/services/dashboard/pano-kutu-ajanda";
import type { PanoGates } from "../src/services/dashboard/pano-kaynak";
import { AppError } from "../src/utils/app-error";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";

const ship = new ShippingService();
const ROOT = path.join(__dirname, "..");
const P = `TEST-SPD-${Date.now().toString(36).toUpperCase()}`;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
async function hata(fn: () => Promise<unknown>): Promise<AppError | null> {
  try { await fn(); return null; } catch (e) { if (e instanceof AppError) return e; throw e; }
}
function hataSenk(fn: () => unknown): AppError | null {
  try { fn(); return null; } catch (e) { if (e instanceof AppError) return e; throw e; }
}
const kod = (e: AppError | null): string => (e ? `${e.statusCode}/${String(e.details?.code ?? "")}` : "hata yok");

const ids = { customers: [] as string[], item: "", rolls: [] as string[], sacks: [] as string[], shipments: [] as string[] };
let userId = "";

function statik(): void {
  console.log("── §0 Statik ──");
  const setter = readFileSync(path.join(ROOT, "src/services/shipping/planned-date.ts"), "utf8");
  check("§0a setter atomik claim `{id, status: PLANNED}` + count 0 → 409 SHIPMENT_NOT_PLANNED",
    /updateMany\(\{\s*where: \{ id: shipmentId, status: ShipmentStatus\.PLANNED \}/.test(setter) && /claimed\.count === 0/.test(setter) && /SHIPMENT_NOT_PLANNED/.test(setter));
  check("§0b setter audit yazar (tx dışında, kind PLANNED_DATE)", /AuditService\.log\(\{[^}]*kind: "PLANNED_DATE"/.test(setter) && !/\$transaction/.test(setter));
  const base = { customerId: "00000000-0000-4000-8000-000000000002" };
  const z1 = createShipmentSchema.safeParse({ ...base, sackIds: ["00000000-0000-4000-8000-000000000001"] });
  const z2 = quickShipmentSchema.safeParse({ ...base, rollIds: ["00000000-0000-4000-8000-000000000001"] });
  const z3 = createShipmentSchema.safeParse({ ...base, sackIds: ["00000000-0000-4000-8000-000000000001"], plannedDate: "20.11.2026" });
  check("§0c zod: kurulum şemaları alansız gövdeyi kabul eder (eski istemci), biçimsiz gün red",
    z1.success && z2.success && z1.data.plannedDate === undefined && !z3.success);
  check("§0d uç gövdesinde alan ZORUNLU (boş gövde tarihi sessizce silmez), null kabul",
    !plannedDateSchema.safeParse({}).success && plannedDateSchema.safeParse({ plannedDate: null }).success);
  const ajanda = readFileSync(path.join(ROOT, "src/services/dashboard/pano-kutu-ajanda.ts"), "utf8");
  check("§0e ajanda gecikme üretmez (gecikme/overdue/late anahtarı yok)", !/gecik|overdue|\blate\b/i.test(ajanda.replace(/^\/\/.*$/gm, "")));
}

function ayristirici(): void {
  console.log("\n── §1 Ayrıştırıcı ──");
  const d = parsePlannedDate("2099-05-20");
  check("§1a geçerli gün UTC gece yarısı, biçimleyici aynı dizgeyi verir", d?.toISOString() === "2099-05-20T00:00:00.000Z" && formatPlannedDate(d) === "2099-05-20");
  check("§1b boş/null → null", parsePlannedDate(null) === null && parsePlannedDate("") === null);
  check("§1c 30 Şubat → 400 SHIPMENT_PLANNED_DATE_INVALID", kod(hataSenk(() => parsePlannedDate("2099-02-30"))) === "400/SHIPMENT_PLANNED_DATE_INVALID");
}

async function top(n: string, whId: string): Promise<string> {
  const r = await prisma.roll.create({
    data: { warehouseId: whId, barcode: `${P}-${n}`, itemId: ids.item, width: 150, initialQty: 100, currentQty: 100, status: RollStatus.WAREHOUSE, entrySource: RollEntrySource.SUPPLIER_RECEIPT },
    select: { id: true },
  });
  ids.rolls.push(r.id);
  return r.id;
}
async function planli(customerId: string, n: string, plannedDate: string | null, status: ShipmentStatus = ShipmentStatus.PLANNED): Promise<string> {
  const s = await prisma.shipment.create({ data: { shipmentNo: `${P}-PL-${n}`, customerId, status, plannedDate: parsePlannedDate(plannedDate) }, select: { id: true } });
  ids.shipments.push(s.id);
  return s.id;
}
const kolon = async (id: string): Promise<string | null> =>
  formatPlannedDate((await prisma.shipment.findUnique({ where: { id }, select: { plannedDate: true } }))?.plannedDate);

const GATES = { sevkeHazir: true, alis: false, isEmri: false, dokumaIsi: false } as unknown as PanoGates;
type Ajanda = Awaited<ReturnType<typeof agendaBox>>;
const gunSay = (a: Ajanda, gun: string): number => a.ayGunleri.find((d) => d.gun === gun)?.sevk ?? -1;
const listede = (a: Ajanda, id: string): boolean => (a.isler.sevkiyat?.kalemler ?? []).some((k) => k.id === id);
const tarihsizde = (a: Ajanda, id: string): boolean => (a.planliSevkiyat?.kalemler ?? []).some((k) => k.id === id);

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exitCode = 2; return; }
  statik();
  ayristirici();
  userId = (await ensureTestAdmin()).id;
  const whId = await fixtureWarehouseId();
  ids.item = (await prisma.item.create({ data: { code: `${P}-I`, name: `${P} KUMAS`, itemType: "FABRIC" }, select: { id: true } })).id;
  const M = (await prisma.customer.create({ data: { code: `${P}-M`, name: `${P} MUSTERI` }, select: { id: true } })).id;
  ids.customers.push(M);

  console.log("\n── §2 Doğuş ──");
  const q0 = (await ship.createShipmentFromRolls({ rollIds: [await top("R0", whId)], customerId: M, orderless: true }, userId)).data as { id: string };
  ids.shipments.push(q0.id);
  check("§2a Hızlı Sevk alansız → plannedDate NULL (bugünkü davranış)", (await kolon(q0.id)) === null);
  const q1 = (await ship.createShipmentFromRolls({ rollIds: [await top("R1", whId)], customerId: M, orderless: true, plannedDate: parsePlannedDate("2099-05-21") }, userId)).data as { id: string };
  ids.shipments.push(q1.id);
  check("§2b Hızlı Sevk `plannedDate` ile → kolon aynı gün (dilim kayması yok)", (await kolon(q1.id)) === "2099-05-21", String(await kolon(q1.id)));
  for (const s of await prisma.sack.findMany({ where: { shipmentId: { in: [q0.id, q1.id] } }, select: { id: true } })) ids.sacks.push(s.id);

  console.log("\n── §3 Düzenleme ──");
  const pl = await planli(M, "1", null);
  const r3a = await ship.setPlannedDate(pl, parsePlannedDate("2099-05-20"), userId);
  check("§3a PLANNED'e yazıldı, yanıt YYYY-AA-GG", r3a.data?.plannedDate === "2099-05-20" && (await kolon(pl)) === "2099-05-20");
  await ship.setPlannedDate(pl, parsePlannedDate("2099-05-22"), userId);
  check("§3b değiştirildi", (await kolon(pl)) === "2099-05-22");
  await ship.setPlannedDate(pl, null, userId);
  check("§3c temizlendi (null)", (await kolon(pl)) === null);
  const disp = await planli(M, "D", "2099-05-20", ShipmentStatus.DISPATCHED);
  const e3d = await hata(() => ship.setPlannedDate(disp, parsePlannedDate("2099-05-25"), userId));
  check("§3d ⭐ sevk EDİLMİŞ → 409 SHIPMENT_NOT_PLANNED, değer değişmez", kod(e3d) === "409/SHIPMENT_NOT_PLANNED" && (await kolon(disp)) === "2099-05-20", kod(e3d));
  check("§3e yok → 404", (await hata(() => ship.setPlannedDate("00000000-0000-4000-8000-0000000000ff", null, userId)))?.statusCode === 404);

  console.log("\n── §4 Pano ajandası ──");
  const t20 = await planli(M, "T20", "2099-05-20");
  const t20b = await planli(M, "T20B", "2099-05-20");
  const past = await planli(M, "P01", "2099-05-01");
  const nod = await planli(M, "N", null);
  const a = await agendaBox(GATES, { gun: "2099-05-20", ay: "2099-05" });
  check("§4a ay hücresi: 20 Mayıs `sevk` 2 (DISPATCHED tarihli sayılmaz), toplam'a girer",
    gunSay(a, "2099-05-20") === 2 && (a.ayGunleri.find((d) => d.gun === "2099-05-20")?.toplam ?? 0) >= 2, String(gunSay(a, "2099-05-20")));
  check("§4b gün listesi: iki tarihli sevkiyat 20 Mayıs listesinde, gün alanı dolu",
    listede(a, t20) && listede(a, t20b) && !listede(a, disp) && a.isler.sevkiyat?.kalemler.every((k) => k.gun === "2099-05-20") === true);
  check("§4c ⭐ tarihli sevkiyat tarihsiz listede DEĞİL; tarihsiz olan orada", !tarihsizde(a, t20) && tarihsizde(a, nod));
  check("§4d geçmiş tarihli yalnız kendi gününde (1 Mayıs hücresi 1, 20 Mayıs listesinde yok)", gunSay(a, "2099-05-01") === 1 && !listede(a, past));
  const b = await agendaBox(GATES, { gun: "2099-05-01", ay: "2099-06" });
  check("§4e gün ayın dışında → ayrı gün sorgusu (1 Mayıs listesinde geçmiş tarihli)", listede(b, past) && b.ayGunleri.every((d) => d.sevk === 0));
  const kapali = await agendaBox({ ...GATES, sevkeHazir: false } as PanoGates, { gun: "2099-05-20", ay: "2099-05" });
  check("§4f kapı kapalı → sevkiyat listesi null, hücreler 0", kapali.isler.sevkiyat === null && kapali.planliSevkiyat === null && gunSay(kapali, "2099-05-20") === 0);
}

async function teardown(): Promise<void> {
  const sh = ids.shipments;
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: sh } } }).catch(() => {});
  await prisma.sackAllocation.deleteMany({ where: { sackId: { in: ids.sacks } } }).catch(() => {});
  await prisma.warehouseMovement.deleteMany({ where: { OR: [{ rollId: { in: ids.rolls } }, { shipmentId: { in: sh } }] } }).catch(() => {});
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids.rolls } } }).catch(() => {});
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids.rolls } } }).catch(() => {});
  await prisma.roll.updateMany({ where: { id: { in: ids.rolls } }, data: { sackId: null, shipmentId: null } }).catch(() => {});
  await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } }).catch(() => {});
  await prisma.sackWeighing.deleteMany({ where: { sackId: { in: ids.sacks } } }).catch(() => {});
  await prisma.sack.deleteMany({ where: { id: { in: ids.sacks } } }).catch(() => {});
  await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: sh } } }).catch(() => {});
  await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: sh } } }).catch(() => {});
  await prisma.shipment.deleteMany({ where: { id: { in: sh } } }).catch((e) => console.error("teardown shipment:", (e as Error).message));
  if (ids.item) await prisma.item.deleteMany({ where: { id: ids.item } }).catch(() => {});
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } }).catch((e) => console.error("teardown customer:", (e as Error).message));
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => {
    await teardown().catch((e) => console.error("teardown hatası:", e));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
