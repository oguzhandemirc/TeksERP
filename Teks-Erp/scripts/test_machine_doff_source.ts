// =============================================================================
// BEKÇİ — TOP İNDİRME (DoffEvent) yazma yüzeyi: kaydet · bağla · geri al · PENCERE
// =============================================================================
// Sözleşme: docs/design/DOKUMA-IS-EMRI-VE-TABLET-TASARIMI.md §3.8b (bekçi tablosu).
// İki yazar, iki tx, tek bağ: doff tablette (tx-A, `openDoff`), top KK1'de (tx-B,
// `createInitialEntry` + `doffEventId`). Bekçi §5b bu iki tx'in ARASINDAKİ pencereyi
// ölçer — kanıt bloklanan çağrının SIRASI ve sonucudur, `p2002` sayısı değil.
//
//   §1 replay: aynı token → aynı id, ikinci satır YOK; geri alınmış kayıtta 409 DOFF_REVOKED
//   §2 koşumsuz doff 201 + warnings KAYBI söyler; başka makinenin koşumu 409 DOFF_RUN_MISMATCH
//   §3 tx-A stok defterine satır YAZMAZ (§3.8 bekçi maddesi 2'nin çalışma-zamanı ikizi)
//   §4 KK1: WEAVING + doffEventId bağ kurar; revoked doff 409; başka makinenin doff'u 409;
//      WEAVING olmayan topa doff 400
//   §5 DOFF_CANCEL: topsuz doff damgalanır, Roll dokunulmaz; toplu doff 409 DOFF_HAS_ROLLS
//      barkodlarla; İPTAL EDİLMİŞ topla da 409 (statüye bakılmaz)
//   §5b ⭐ İKİ PENCERE: (1) tx-B topu yazmış, commit etmemiş — iptal bloklanır, sonra 409;
//      (2) tx-B claim'i almış, topu HENÜZ yazmamış — iptal yine bloklanır (asıl açık buradadır:
//      FK'nın KEY SHARE kilidi iptalin NO KEY UPDATE'iyle çatışmaz, yalnız FOR UPDATE tutar)
//   §6 kod biçimi DF+GGAAYY+NNNN ve günlük sıra artar
//
// Negatif sondalar (2026-09-13, üç ayrı mutasyon, cp+sha256 ile geri):
//   · `claimDoffForRollTx` FOR UPDATE → düz SELECT: §5b-4/5 kırmızı (iptal beklemeden
//     geçti, top geri alınmış doff'a bağlı) — §5b-1/2 YEŞİL kaldı çünkü Roll INSERT'in
//     FK KEY SHARE kilidi tek başına iptali bloklar; ikinci pencere bu yüzden yazıldı.
//   · `revokeDoff` başındaki FOR UPDATE kaldırılınca: §5b-2/3 kırmızı — iptal bloklandı
//     ama uyanınca `NOT EXISTS` yüklemini ESKİ snapshot'la değerlendirdi (EvalPlanQual
//     yalnız hedef satırı tazeler), damgaladı. İlk sürüm tam bu kusuru taşıyordu.
//   · `rolls: { none: {} }` düşürülünce: §5b/§5d/§5b-2/3 kırmızı.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım.
// =============================================================================
import { MachineDataSource, RollEntrySource, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { openDoff, revokeDoff, DOFF_CODE_PREFIX } from "../src/services/machine-doff.service";
import { claimDoffForRollTx } from "../src/services/helpers/machine-doff-link.helper";
import { InventoryService } from "../src/services/inventory.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
function kod(e: unknown): string {
  return e instanceof AppError ? String((e.details as { code?: string } | undefined)?.code ?? e.statusCode) : String((e as Error)?.message ?? e).slice(0, 80);
}
async function bekle<T>(p: Promise<T>): Promise<{ ok: true; v: T } | { ok: false; e: unknown }> {
  try { return { ok: true, v: await p }; } catch (e) { return { ok: false, e }; }
}
const uuid = (): string => crypto.randomUUID();

const rollIds: string[] = [];
const doffIds: string[] = [];

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exit(1); }
  console.log("\n=== Top indirme (DoffEvent): kaydet · bağla · geri al · pencere ===\n");
  const ek = Date.now().toString(36);
  const station = await prisma.station.create({
    data: { name: `TEST-DF-IST-${ek}`, code: `TEST-DF-S-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "PROCESS_QC", isActive: true },
  });
  const makine = await prisma.machine.create({ data: { stationId: station.id, name: `TEST-DF-M1-${ek}`, code: `TEST-DF-M1-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
  const makine2 = await prisma.machine.create({ data: { stationId: station.id, name: `TEST-DF-M2-${ek}`, code: `TEST-DF-M2-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
  const item = await prisma.item.create({ data: { code: `TEST-DF-${ek}`, name: `TEST-DF-${ek} kumaş`, itemType: "FABRIC" }, select: { id: true } });
  const inventory = new InventoryService();
  const taban = { machineId: makine.id, productionLineNo: 1, pieceCount: 2, counterSource: MachineDataSource.OPERATOR };

  try {
    // ── §1 replay ──────────────────────────────────────────────────────────
    const tok = uuid();
    const a1 = await openDoff({ ...taban, clientToken: tok });
    doffIds.push(a1.data!.id);
    const a2 = await openDoff({ ...taban, clientToken: tok });
    const sayi = await prisma.doffEvent.count({ where: { clientToken: tok } });
    check("§1a aynı token → aynı id, ikinci satır YOK", a2.data!.id === a1.data!.id && sayi === 1, `id eşit=${a2.data!.id === a1.data!.id} satır=${sayi}`);
    const farkli = await bekle(openDoff({ ...taban, pieceCount: 5, clientToken: tok }));
    check("§1b aynı token, farklı gövde → 409 CLIENT_TOKEN_COLLISION", !farkli.ok && kod(farkli.e) === "CLIENT_TOKEN_COLLISION", farkli.ok ? "geçti" : kod(farkli.e));
    await revokeDoff(a1.data!.id, "bekçi §1");
    const olu = await bekle(openDoff({ ...taban, clientToken: tok }));
    check("§1c geri alınmış kaydın token'ı → 409 DOFF_REVOKED (dördüncü durum)", !olu.ok && kod(olu.e) === "DOFF_REVOKED", olu.ok ? "geçti" : kod(olu.e));

    // ── §2 koşum bağı ──────────────────────────────────────────────────────
    const b1 = await openDoff({ ...taban });
    doffIds.push(b1.data!.id);
    check("§2a koşumsuz doff 201 ve warnings KAYBI söyler", (b1.warnings ?? []).some((w) => w.includes("GİRMİYOR")), (b1.warnings ?? []).join(" | ").slice(0, 90));
    const yabanciRun = await prisma.machineRun.create({ data: { machineId: makine2.id, productionLineNo: 1, startedAt: new Date(Date.now() - 3600_000) }, select: { id: true } });
    const b2 = await bekle(openDoff({ ...taban, machineRunId: yabanciRun.id }));
    check("§2b başka makinenin koşumu → 409 DOFF_RUN_MISMATCH", !b2.ok && kod(b2.e) === "DOFF_RUN_MISMATCH", b2.ok ? "geçti" : kod(b2.e));
    await prisma.machineRun.delete({ where: { id: yabanciRun.id } });

    // ── §3 stok defteri ────────────────────────────────────────────────────
    const once = await prisma.warehouseMovement.count();
    const c1 = await openDoff({ ...taban, pieceCount: 1 });
    doffIds.push(c1.data!.id);
    const sonra = await prisma.warehouseMovement.count();
    check("§3 tx-A stok defterine satır YAZMAZ", once === sonra, `önce=${once} sonra=${sonra}`);

    // ── §4 KK1 bağı ────────────────────────────────────────────────────────
    const d1 = await openDoff({ ...taban });
    doffIds.push(d1.data!.id);
    const top = await inventory.createInitialEntry({ itemId: item.id, initialQty: 50 }, undefined, makine.id, false, {
      forcedEntrySource: RollEntrySource.WEAVING, doffEventId: d1.data!.id,
    });
    const topId = (top.data as { id: string }).id;
    rollIds.push(topId);
    const topRow = await prisma.roll.findUnique({ where: { id: topId }, select: { doffEventId: true, entrySource: true } });
    check("§4a WEAVING + doffEventId: bağ kuruldu", topRow?.doffEventId === d1.data!.id && topRow.entrySource === RollEntrySource.WEAVING, `doff=${topRow?.doffEventId === d1.data!.id} kaynak=${topRow?.entrySource}`);
    const d2 = await openDoff({ ...taban });
    doffIds.push(d2.data!.id);
    await revokeDoff(d2.data!.id, "bekçi §4b");
    const r4b = await bekle(inventory.createInitialEntry({ itemId: item.id, initialQty: 50 }, undefined, makine.id, false, { forcedEntrySource: RollEntrySource.WEAVING, doffEventId: d2.data!.id }));
    check("§4b geri alınmış doff'a top → 409 DOFF_NOT_LINKABLE", !r4b.ok && kod(r4b.e) === "DOFF_NOT_LINKABLE", r4b.ok ? "geçti" : kod(r4b.e));
    if (r4b.ok) rollIds.push((r4b.v.data as { id: string }).id);
    const r4c = await bekle(inventory.createInitialEntry({ itemId: item.id, initialQty: 50 }, undefined, makine2.id, false, { forcedEntrySource: RollEntrySource.WEAVING, doffEventId: d1.data!.id }));
    check("§4c başka makinenin doff'una top → 409 DOFF_NOT_LINKABLE", !r4c.ok && kod(r4c.e) === "DOFF_NOT_LINKABLE", r4c.ok ? "geçti" : kod(r4c.e));
    if (r4c.ok) rollIds.push((r4c.v.data as { id: string }).id);
    const r4d = await bekle(inventory.createInitialEntry({ itemId: item.id, initialQty: 50 }, undefined, makine.id, false, { forcedEntrySource: RollEntrySource.MANUAL_ENTRY, doffEventId: d1.data!.id }));
    check("§4d WEAVING olmayan topa doff → 400 DOFF_LINK_REQUIRES_WEAVING", !r4d.ok && kod(r4d.e) === "DOFF_LINK_REQUIRES_WEAVING", r4d.ok ? "geçti" : kod(r4d.e));
    if (r4d.ok) rollIds.push((r4d.v.data as { id: string }).id);

    // ── §5 DOFF_CANCEL ─────────────────────────────────────────────────────
    const e1 = await revokeDoff(c1.data!.id, "bekçi §5a");
    check("§5a topsuz doff geri alındı (revokedAt dolu)", e1.data!.revokedAt !== null);
    const e2 = await bekle(revokeDoff(d1.data!.id, "bekçi §5b"));
    const e2det = !e2.ok && e2.e instanceof AppError ? (e2.e.details as { barcodes?: string[] }) : undefined;
    check("§5b toplu doff → 409 DOFF_HAS_ROLLS, top ADIYLA", !e2.ok && kod(e2.e) === "DOFF_HAS_ROLLS" && (e2det?.barcodes?.length ?? 0) === 1, e2.ok ? "geçti" : `${kod(e2.e)} barkod=${e2det?.barcodes?.length ?? 0}`);
    const topSonra = await prisma.roll.findUnique({ where: { id: topId }, select: { doffEventId: true, status: true } });
    check("§5c Roll'a dokunulmadı (bağ duruyor)", topSonra?.doffEventId === d1.data!.id);
    await prisma.roll.update({ where: { id: topId }, data: { status: RollStatus.CANCELLED } });
    const e3 = await bekle(revokeDoff(d1.data!.id, "bekçi §5d"));
    check("§5d İPTAL EDİLMİŞ topla da 409 (statüye bakılmaz — doff tarihsel olgu)", !e3.ok && kod(e3.e) === "DOFF_HAS_ROLLS", e3.ok ? "geçti" : kod(e3.e));

    // ── §5b ⭐ PENCERE ─────────────────────────────────────────────────────
    const w = await openDoff({ ...taban });
    doffIds.push(w.data!.id);
    let birak!: () => void;
    const kapi = new Promise<void>((res) => { birak = res; });
    kapi.catch(() => undefined);
    let txBBitti = false;
    const txB = prisma.$transaction(async (tx) => {
      await claimDoffForRollTx(tx, { doffEventId: w.data!.id, entrySource: RollEntrySource.WEAVING, createdMachineId: makine.id });
      const r = await tx.roll.create({
        data: { barcode: `TEST-DF-W-${ek}`, itemId: item.id, initialQty: 10, currentQty: 10, status: RollStatus.STOCK, entrySource: RollEntrySource.WEAVING, doffEventId: w.data!.id },
        select: { id: true },
      });
      rollIds.push(r.id);
      await kapi;
    }, { timeout: 15_000 }).then(() => { txBBitti = true; });
    await new Promise((r) => setTimeout(r, 150));
    let iptalBitti = false;
    const iptal = bekle(revokeDoff(w.data!.id, "bekçi §5b pencere")).then((r) => { iptalBitti = true; return r; });
    await new Promise((r) => setTimeout(r, 400));
    check("§5b-1 tx-B doff satırını tutarken iptal BLOKLANDI (400 ms içinde dönmedi)", !iptalBitti && !txBBitti, `iptal=${iptalBitti} txB=${txBBitti}`);
    birak();
    await txB;
    const sonuc = await iptal;
    check("§5b-2 tx-B commit'inden SONRA iptal 409 DOFF_HAS_ROLLS döndü", !sonuc.ok && kod(sonuc.e) === "DOFF_HAS_ROLLS", sonuc.ok ? "geçti (PENCERE AÇIK)" : kod(sonuc.e));
    const wRow = await prisma.doffEvent.findUnique({ where: { id: w.data!.id }, select: { revokedAt: true, rolls: { select: { id: true } } } });
    check("§5b-3 doff canlı ve top bağlı — iptal edilmiş doff'a bağlı top YOK", wRow?.revokedAt === null && wRow.rolls.length === 1, `revoked=${wRow?.revokedAt !== null} top=${wRow?.rolls.length}`);

    // ── §5b-4 ⭐ İKİNCİ PENCERE: claim alındı, top HENÜZ yazılmadı ──────────
    // Yukarıdaki pencerede FK'nın KEY SHARE kilidi (Roll INSERT) iptali tek başına
    // bloklar; asıl açık, claim ile INSERT arasındadır: düz okuma olsaydı iptal
    // (FOR NO KEY UPDATE) KEY SHARE ile çatışmaz, araya girer, top geri alınmış
    // doff'a bağlanırdı. Kanıt yine SIRA: iptal claim'de bloklanmalı.
    const w2 = await openDoff({ ...taban });
    doffIds.push(w2.data!.id);
    let birak2!: () => void;
    const kapi2 = new Promise<void>((res) => { birak2 = res; });
    kapi2.catch(() => undefined);
    let txB2Bitti = false;
    const txB2 = prisma.$transaction(async (tx) => {
      await claimDoffForRollTx(tx, { doffEventId: w2.data!.id, entrySource: RollEntrySource.WEAVING, createdMachineId: makine.id });
      await kapi2;
      const r = await tx.roll.create({
        data: { barcode: `TEST-DF-W2-${ek}`, itemId: item.id, initialQty: 10, currentQty: 10, status: RollStatus.STOCK, entrySource: RollEntrySource.WEAVING, doffEventId: w2.data!.id },
        select: { id: true },
      });
      rollIds.push(r.id);
    }, { timeout: 15_000 }).then(() => { txB2Bitti = true; });
    await new Promise((r) => setTimeout(r, 150));
    let iptal2Bitti = false;
    const iptal2 = bekle(revokeDoff(w2.data!.id, "bekçi §5b-4")).then((r) => { iptal2Bitti = true; return r; });
    await new Promise((r) => setTimeout(r, 400));
    check("§5b-4 claim tutulurken (top henüz yok) iptal BLOKLANDI", !iptal2Bitti && !txB2Bitti, `iptal=${iptal2Bitti} txB=${txB2Bitti}`);
    birak2();
    await txB2;
    const sonuc2 = await iptal2;
    const w2Row = await prisma.doffEvent.findUnique({ where: { id: w2.data!.id }, select: { revokedAt: true, rolls: { select: { id: true } } } });
    check("§5b-5 sıra: tx-B commit → iptal 409, doff canlı, top bağlı", !sonuc2.ok && kod(sonuc2.e) === "DOFF_HAS_ROLLS" && w2Row?.revokedAt === null && w2Row.rolls.length === 1, sonuc2.ok ? "iptal GEÇTİ (pencere açık)" : `${kod(sonuc2.e)} revoked=${w2Row?.revokedAt !== null} top=${w2Row?.rolls.length}`);

    // ── §6 kod ─────────────────────────────────────────────────────────────
    const kodlar = [a1, b1, c1, d1, d2, w, w2].map((x) => x.data!.code);
    const desen = new RegExp(`^${DOFF_CODE_PREFIX}\\d{6}\\d{4}$`);
    const seqs = kodlar.map((c) => Number(c.slice(-4)));
    check("§6 kod DF+GGAAYY+NNNN ve günlük sıra artıyor", kodlar.every((c) => desen.test(c)) && seqs.every((s, i) => i === 0 || s > seqs[i - 1]!), kodlar.join(","));
  } finally {
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...doffIds] } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.doffEvent.deleteMany({ where: { machineId: { in: [makine.id, makine2.id] } } });
    await prisma.machineRun.deleteMany({ where: { machineId: { in: [makine.id, makine2.id] } } });
    await prisma.machine.deleteMany({ where: { stationId: station.id } });
    await prisma.station.deleteMany({ where: { id: station.id } });
    await prisma.item.deleteMany({ where: { id: item.id } });
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
