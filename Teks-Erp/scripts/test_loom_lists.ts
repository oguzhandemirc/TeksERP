// =============================================================================
// BEKÇİ — TEZGAH LİSTELERİ: açık koşumlar · günün indirmeleri · bağlanmamış indirmeler
// Çalıştır: npx tsx scripts/run-all-tests.ts loom_lists
// =============================================================================
// Tablet tezgah ekranı ve KK1'in "hangi indirmeden?" seçim listesinin backend ön
// koşulu (DOKUMA-IS-EMRI §3.9 J.2 — "Backend ÖNCE", ilk dilim yerel durumla yapılmaz).
// Üç yüklem SUNUCUDA süzülür; bekçi her yüklemi bir "girmemesi gereken" satırla ölçer:
//   §1 açık koşum: kapalı ve geri alınmış koşum LİSTEYE GİRMEZ; makine yoksa 404
//   §2 günün indirmeleri: fabrika günü penceresi (dün girmez), geri alınmış girmez,
//      `rollCount` bağı taşır; `date=dün` dünü getirir
//   §3 bağlanmamış: top doğurmuş ve geri alınmış girmez; pencere `sinceDays` (1 → yalnız
//      bugün); makine süzgeci; makinesiz çağrı tüm tezgahları görür (masa KK1)
//   §4 liste + sayı aynı where'den: `meta.total` ve `truncated` (körlük zemini: total > 0)
//   §5 yüzey: iki GET `requireAnyPermission(... "mobile:dokuma")` ile ve `requireDokumaEnabled`
//      altında (metin ölçümü — guard türü 5e'nin regime_gate kapısında, izin kabulü burada)
// Negatif sondalar (2026-09-14, cp+sha256 ile geri):
//   · `listOpenMachineRuns` where'inden `endedAt: null` düşürülünce: §1a kırmızı
//   · `listDoffsForDay` where'inden `revokedAt: null` düşürülünce: §2a/§2b/§4 kırmızı
//   · `listUnlinkedDoffs` where'inden `rolls: { none: {} }` düşürülünce: §3a kırmızı
//   · GET'lerden `mobile:dokuma` düşürülünce: §5 kırmızı — §5b bunu BELLEK İÇİNDE her koşumda
//     tekrarlar (yüklem `...MOBILE_DOKUMA` ile `)` arasına başka izin (`...MOBILE_KK1`) sığdırır;
//     eski birebir metin yüklemi KK1 izni eklenince sahte kırmızı verdi, 2026-09-14)
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { MachineDataSource, RollEntrySource, RollStatus, StationKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { listDoffsForDay, listOpenMachineRuns, listUnlinkedDoffs } from "../src/services/loom-list.service";
import { factoryDayStart, factoryYmd } from "../src/constants/time";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
async function bekle<T>(p: Promise<T>): Promise<{ ok: true; v: T } | { ok: false; e: unknown }> {
  try { return { ok: true, v: await p }; } catch (e) { return { ok: false, e }; }
}

const TAG = `TEST-LL-${Date.now()}`;
const rollIds: string[] = [];
const machineIds: string[] = [];
let stationId = "";
let itemId = "";

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exit(1); }
  console.log("\n=== Tezgah listeleri: açık koşum · günün indirmeleri · bağlanmamış ===\n");
  const st = await prisma.station.create({ data: { name: `${TAG}-ST`, code: `${TAG}-ST`.slice(0, 32), type: "INTERNAL", kind: StationKind.WEAVING, isActive: true }, select: { id: true } });
  stationId = st.id;
  const mk = async (n: number): Promise<string> => {
    const m = await prisma.machine.create({ data: { stationId, name: `${TAG}-T${n}`, code: `${TAG}-T${n}`.slice(0, 32), isActive: true, productionLineCount: 2 }, select: { id: true } });
    machineIds.push(m.id);
    return m.id;
  };
  const t1 = await mk(1);
  const t2 = await mk(2);
  itemId = (await prisma.item.create({ data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;
  const now = new Date();
  const dun = new Date(factoryDayStart().getTime() - 12 * 3600_000); // dünün fabrika günü içinde bir an
  const doff = (machineId: string, at: Date, ek: Record<string, unknown> = {}) =>
    prisma.doffEvent.create({ data: { machineId, productionLineNo: 1, doffedAt: at, pieceCount: 1, counterSource: MachineDataSource.OPERATOR, code: `${TAG}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase().slice(0, 32), ...ek }, select: { id: true } });

  try {
    // fikstür: koşumlar
    const acik = await prisma.machineRun.create({ data: { machineId: t1, productionLineNo: 1, startedAt: new Date(now.getTime() - 3600_000) }, select: { id: true } });
    await prisma.machineRun.create({ data: { machineId: t1, productionLineNo: 2, startedAt: new Date(now.getTime() - 7200_000), endedAt: new Date(now.getTime() - 3600_000) }, select: { id: true } });
    await prisma.machineRun.create({ data: { machineId: t1, productionLineNo: 2, startedAt: new Date(now.getTime() - 1800_000), revokedAt: now, revokeReason: "bekçi" }, select: { id: true } });
    await prisma.machineRun.create({ data: { machineId: t2, productionLineNo: 1, startedAt: new Date(now.getTime() - 600_000) }, select: { id: true } });
    // fikstür: indirmeler
    const dBugunBagli = await doff(t1, now);
    const dBugunBos = await doff(t1, new Date(now.getTime() - 60_000));
    const dBugunRevoked = await doff(t1, new Date(now.getTime() - 120_000), { revokedAt: now, revokeReason: "bekçi" });
    const dDun = await doff(t1, dun);
    const dT2 = await doff(t2, now);
    const top = await prisma.roll.create({ data: { barcode: `${TAG}-R1`, itemId, initialQty: 10, currentQty: 10, status: RollStatus.STOCK, entrySource: RollEntrySource.WEAVING, doffEventId: dBugunBagli.id }, select: { id: true } });
    rollIds.push(top.id);

    // ── §1 açık koşumlar ────────────────────────────────────────────────────
    const r1 = await listOpenMachineRuns(t1);
    check("§1a açık koşum listesi: yalnız açık olan (kapalı ve geri alınmış GİRMEZ), total 1", r1.data!.length === 1 && r1.data![0]!.id === acik.id && r1.meta.total === 1 && !r1.meta.truncated, `n=${r1.data!.length} total=${r1.meta.total}`);
    const r1b = await bekle(listOpenMachineRuns("00000000-0000-0000-0000-000000000000"));
    check("§1b olmayan makine → 404", !r1b.ok && r1b.e instanceof AppError && r1b.e.statusCode === 404, r1b.ok ? "geçti" : String((r1b.e as AppError).statusCode));

    // ── §2 günün indirmeleri ────────────────────────────────────────────────
    const r2 = await listDoffsForDay({ machineId: t1 });
    const ids2 = new Set(r2.data!.map((d) => d.id));
    check("§2a bugün: bağlı + boş (2), dün GİRMEZ, öteki makine GİRMEZ", ids2.size === 2 && ids2.has(dBugunBagli.id) && ids2.has(dBugunBos.id) && !ids2.has(dDun.id) && !ids2.has(dT2.id), [...ids2].length + "");
    check("§2b geri alınmış indirme GİRMEZ", !ids2.has(dBugunRevoked.id));
    check("§2c rollCount bağı taşır (bağlı 1 · boş 0)", r2.data!.find((d) => d.id === dBugunBagli.id)?.rollCount === 1 && r2.data!.find((d) => d.id === dBugunBos.id)?.rollCount === 0);
    const r2d = await listDoffsForDay({ machineId: t1, date: factoryYmd(dun) });
    check("§2d date=dün → yalnız dünkü", r2d.data!.length === 1 && r2d.data![0]!.id === dDun.id, `n=${r2d.data!.length}`);

    // ── §3 bağlanmamış ──────────────────────────────────────────────────────
    const r3 = await listUnlinkedDoffs({});
    const ids3 = new Set(r3.data!.map((d) => d.id));
    check("§3a bağlanmamış (varsayılan 3 gün, makinesiz): boş-bugün + dün + t2; BAĞLI ve GERİ ALINMIŞ girmez", ids3.has(dBugunBos.id) && ids3.has(dDun.id) && ids3.has(dT2.id) && !ids3.has(dBugunBagli.id) && !ids3.has(dBugunRevoked.id), `bağlı=${ids3.has(dBugunBagli.id)} revoked=${ids3.has(dBugunRevoked.id)}`);
    const r3m = await listUnlinkedDoffs({ machineId: t1 });
    const ids3m = new Set(r3m.data!.map((d) => d.id));
    check("§3b makine süzgeci: t2'nin indirmesi girmez", ids3m.has(dBugunBos.id) && ids3m.has(dDun.id) && !ids3m.has(dT2.id));
    const r3s = await listUnlinkedDoffs({ machineId: t1, sinceDays: 1 });
    const ids3s = new Set(r3s.data!.map((d) => d.id));
    check("§3c sinceDays=1 → yalnız bugün (dün girmez)", ids3s.has(dBugunBos.id) && !ids3s.has(dDun.id), `n=${ids3s.size}`);

    // ── §4 liste + sayı ─────────────────────────────────────────────────────
    check("§4 meta.total liste ile aynı where'den (t1 bugün 2/2, truncated false) — körlük zemini total > 0", r2.meta.total === 2 && r2.data!.length === 2 && r2.meta.truncated === false);

    // ── §5 yüzey (metin) ────────────────────────────────────────────────────
    const kok = path.resolve(__dirname, "..");
    const runR = readFileSync(path.join(kok, "src/routes/machine-run.routes.ts"), "utf8");
    const doffR = readFileSync(path.join(kok, "src/routes/machine-doff.routes.ts"), "utf8");
    const getOk = (t: string): boolean => /router\.get\("\/", requireAnyPermission\("loom:run", "loom:doff", \.\.\.MOBILE_DOKUMA[^)]*\)/.test(t) && /MOBILE_DOKUMA = \["mobile:dokuma"\] as const/.test(t) && /router\.use\(verifyToken, requireDokumaEnabled\)/.test(t);
    check("§5 iki GET requireAnyPermission(... mobile:dokuma) ile ve requireDokumaEnabled altında", getOk(runR) && getOk(doffR), `run=${getOk(runR)} doff=${getOk(doffR)}`);
    // §5b ⭐ sonda bellek içi: MOBILE_DOKUMA düşürülünce yüklem kırmızı (KK1 izni kalsa bile).
    // Yalnız GET satırından düşürülür (ilk eşleşme başka bir uç olabilir — düz string replace TUZAK).
    const runKirp = runR.replace(/(router\.get\("\/", requireAnyPermission\("loom:run", "loom:doff"), \.\.\.MOBILE_DOKUMA\)/, "$1)");
    const doffKirp = doffR.replace(/(router\.get\("\/", requireAnyPermission\("loom:run", "loom:doff", )\.\.\.MOBILE_DOKUMA, /, "$1");
    check("§5b ⭐ sonda: iki GET'ten `...MOBILE_DOKUMA` düşürülünce §5 kırmızı", runKirp !== runR && doffKirp !== doffR && !getOk(runKirp) && !getOk(doffKirp));
  } finally {
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.doffEvent.deleteMany({ where: { machineId: { in: machineIds } } });
    await prisma.machineRun.deleteMany({ where: { machineId: { in: machineIds } } });
    await prisma.machine.deleteMany({ where: { id: { in: machineIds } } });
    await prisma.station.deleteMany({ where: { id: stationId } });
    await prisma.item.deleteMany({ where: { id: itemId } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("❌ bekçi çöktü:", e);
  await prisma.$disconnect().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
