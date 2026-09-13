// =============================================================================
// BEKÇİ — TOP İNDİRME (DoffEvent) yazma yüzeyi: kaydet · bağla · geri al · PENCERE
// =============================================================================
// Sözleşme: docs/design/DOKUMA-IS-EMRI-VE-TABLET-TASARIMI.md §3.8b (bekçi tablosu).
// İki yazar, iki tx, tek bağ: doff tablette (tx-A, `openDoff`), top KK1'de (tx-B,
// `createInitialEntry` + `doffEventId`). Bekçi §5b bu iki tx'in ARASINDAKİ pencereyi
// ölçer — kanıt bloklanan çağrının SIRASI ve sonucudur, `p2002` sayısı değil.
//
//   §1 replay: aynı token → aynı id, ikinci satır YOK; geri alınmış kayıtta 409 DOFF_REVOKED;
//      replay cevabı da `warnings` taşır (sıralı VE paralel P2002 dalı)
//   §2 koşumsuz doff 201 + warnings KAYBI söyler; başka makinenin koşumu 409 DOFF_RUN_MISMATCH;
//      koşumlu ama İŞSİZ doff da uyarır (dördüncü kova)
//   §3 tx-A stok defterine satır YAZMAZ, top YAZMAZ (fikstür ürününe daraltılmış sayım —
//      global sayım paralel bekçide sahte kırmızı verirdi)
//   §4 KK1: WEAVING + doffEventId bağ kurar; revoked doff 409; başka makinenin doff'u 409;
//      WEAVING olmayan topa doff 400; MASA KK1'de (makinesiz) bağ KABUL, eşleşme yalnız tezgah-bağlı KK1'de;
//      HTTP şeması `doffEventId`i TAŞIR ve yarı mamulle birlikte reddeder
//   §5 DOFF_CANCEL: topsuz doff damgalanır, Roll dokunulmaz; toplu doff 409 DOFF_HAS_ROLLS
//      barkodlarla; İPTAL EDİLMİŞ topla da 409 (statüye bakılmaz); mesaj çare ÖNERMEZ;
//      21 topta SAYI kırpılmaz (mesaj +1, details.total 21); P2028 → 409 DOFF_LINK_IN_PROGRESS
//   §5b ⭐ İKİ PENCERE: (1) tx-B topu yazmış, commit etmemiş — iptal bloklanır, sonra 409;
//      (2) tx-B claim'i almış, topu HENÜZ yazmamış — iptal yine bloklanır (asıl açık buradadır:
//      FK'nın KEY SHARE kilidi iptalin NO KEY UPDATE'iyle çatışmaz, yalnız FOR UPDATE tutar)
//      Bloklanmayan iptalin taban süresi 3 ms (1c W8, 2026-09-13); 400 ms eşiği ×130 pay.
//   §6 kod biçimi DF+GGAAYY+NNNN ve günlük sıra artar; ⭐ 8029 kilidi: elle tutulan kilit
//      kaydı BLOKLAR (sıra kanıtı) ve 25 paralel kayıt 25 tekil kod / 0 hata verir
//      (kilitsiz sürüm 1c W9'da 23/2 vermişti)
//
// Negatif sondalar (2026-09-13, cp+sha256 ile geri; her kalem için kırmızı verdiği bölüm):
//   · `claimDoffForRollTx` FOR UPDATE → düz SELECT: §5b-4/5 kırmızı (iptal beklemeden
//     geçti, top geri alınmış doff'a bağlı) — §5b-1/2 YEŞİL kaldı çünkü Roll INSERT'in
//     FK KEY SHARE kilidi tek başına iptali bloklar; ikinci pencere bu yüzden yazıldı.
//   · `revokeDoff` başındaki FOR UPDATE kaldırılınca: §5b-2/3/5 kırmızı — iptal bloklandı
//     ama uyanınca `NOT EXISTS` yüklemini ESKİ snapshot'la değerlendirdi (EvalPlanQual
//     yalnız hedef satırı tazeler), damgaladı. İlk sürüm tam bu kusuru taşıyordu.
//   · `rolls: { none: {} }` düşürülünce: §5b/§5d/§5b-2/3 kırmızı.
//   · replay'den `deriveRunWarnings` düşürülünce: §1d/§1e kırmızı.
//   · `nextDoffCodeTx`ten `lockCodeScopeTx` düşürülünce: §6b kırmızı (kilit beklemedi).
//   · `claimDoffForRollTx`e "damga yoksa 400" konunca: §4e kırmızı (ölü kapı, 1e hükmü).
//   · şemadan `doffEventId` düşürülünce: §4f kırmızı (alan sessizce düşer).
//   · `diagnoseRevokeRefusal`e `take: 20` konunca: §5e kırmızı (sayı 20'ye kırpılır).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım.
// =============================================================================
import { MachineDataSource, Prisma, RollEntrySource, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { openDoff, revokeDoff, mapRevokeTimeout, DOFF_CODE_PREFIX } from "../src/services/machine-doff.service";
import { claimDoffForRollTx } from "../src/services/helpers/machine-doff-link.helper";
import { lockCodeScopeTx } from "../src/services/helpers/code-unique.helper";
import { initialEntrySchema } from "../src/controllers/inventory.controller";
import { dailyCodePrefix } from "../src/utils/code-format";
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
    const kayip = (w?: string[]): boolean => (w ?? []).some((x) => x.includes("GİRMİYOR"));
    check("§1d sıralı replay cevabı da warnings taşır (koşumsuz: GİRMİYOR)", kayip(a2.warnings), (a2.warnings ?? []).join(" | ").slice(0, 90));
    const tok2 = uuid();
    const [p1, p2] = await Promise.all([openDoff({ ...taban, clientToken: tok2 }), openDoff({ ...taban, clientToken: tok2 })]);
    doffIds.push(p1.data!.id);
    const sayi2 = await prisma.doffEvent.count({ where: { clientToken: tok2 } });
    check("§1e paralel aynı token: tek satır, aynı id, İKİ cevap da warnings taşır (P2002 replay dalı)", sayi2 === 1 && p1.data!.id === p2.data!.id && kayip(p1.warnings) && kayip(p2.warnings), `satır=${sayi2} w1=${kayip(p1.warnings)} w2=${kayip(p2.warnings)}`);

    // ── §2 koşum bağı ──────────────────────────────────────────────────────
    const b1 = await openDoff({ ...taban });
    doffIds.push(b1.data!.id);
    check("§2a koşumsuz doff 201 ve warnings KAYBI söyler", kayip(b1.warnings), (b1.warnings ?? []).join(" | ").slice(0, 90));
    const yabanciRun = await prisma.machineRun.create({ data: { machineId: makine2.id, productionLineNo: 1, startedAt: new Date(Date.now() - 3600_000) }, select: { id: true } });
    const b2 = await bekle(openDoff({ ...taban, machineRunId: yabanciRun.id }));
    check("§2b başka makinenin koşumu → 409 DOFF_RUN_MISMATCH", !b2.ok && kod(b2.e) === "DOFF_RUN_MISMATCH", b2.ok ? "geçti" : kod(b2.e));
    await prisma.machineRun.delete({ where: { id: yabanciRun.id } });
    const issizRun = await prisma.machineRun.create({ data: { machineId: makine.id, productionLineNo: 1, startedAt: new Date(Date.now() - 3600_000) }, select: { id: true } });
    const b3tok = uuid();
    const b3 = await openDoff({ ...taban, machineRunId: issizRun.id, clientToken: b3tok });
    doffIds.push(b3.data!.id);
    const b3r = await openDoff({ ...taban, machineRunId: issizRun.id, clientToken: b3tok });
    check("§2c koşumlu ama İŞSİZ doff: ilk cevap VE replay 'dokuma işine bağlı değil' uyarır (dördüncü kova)", kayip(b3.warnings) && kayip(b3r.warnings) && (b3r.warnings ?? []).some((w) => w.includes("dokuma işine bağlı değil")), `ilk=${kayip(b3.warnings)} replay=${(b3r.warnings ?? []).join(" | ").slice(0, 80)}`);

    // ── §3 stok defteri — fikstür ürününe daraltılmış sayım ────────────────
    const stokSay = (): Promise<number> => prisma.warehouseMovement.count({ where: { roll: { itemId: item.id } } });
    const topSay = (): Promise<number> => prisma.roll.count({ where: { itemId: item.id } });
    const [once, topOnce] = [await stokSay(), await topSay()];
    const c1 = await openDoff({ ...taban, pieceCount: 1 });
    doffIds.push(c1.data!.id);
    const [sonra, topSonra3] = [await stokSay(), await topSay()];
    check("§3 tx-A stok defterine satır YAZMAZ, top YAZMAZ", once === sonra && topOnce === topSonra3 && topOnce === 0, `defter ${once}→${sonra} top ${topOnce}→${topSonra3}`);

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
    // §4e — MASA KK1 (makine damgası yok): bağ KABUL. KK1 damgası muayene istasyonunu
    // taşır, tezgahı değil; makine eşleşmesi yalnız tezgah-bağlı KK1'de denetlenir
    // (1e hükmü 2026-09-13; "damga yoksa 400" hiç geçemeyen ölü kapı olurdu).
    const d4e = await openDoff({ ...taban });
    doffIds.push(d4e.data!.id);
    const r4e = await bekle(inventory.createInitialEntry({ itemId: item.id, initialQty: 50 }, undefined, null, false, { forcedEntrySource: RollEntrySource.WEAVING, doffEventId: d4e.data!.id }));
    const r4eId = r4e.ok ? (r4e.v.data as { id: string }).id : null;
    if (r4eId) rollIds.push(r4eId);
    const r4eRow = r4eId ? await prisma.roll.findUnique({ where: { id: r4eId }, select: { doffEventId: true, createdMachineId: true } }) : null;
    check("§4e MASA KK1 (makinesiz oturum): doff bağı KABUL — top bağlı, createdMachineId null", r4e.ok && r4eRow?.doffEventId === d4e.data!.id && r4eRow.createdMachineId === null, r4e.ok ? `doff=${r4eRow?.doffEventId === d4e.data!.id} makine=${r4eRow?.createdMachineId}` : kod(r4e.e));
    const httpGovde = { itemId: item.id, initialQty: 50, doffEventId: d1.data!.id };
    const parsed = initialEntrySchema.safeParse(httpGovde);
    const karisik = initialEntrySchema.safeParse({ ...httpGovde, semiFinished: true });
    check("§4f HTTP şeması doffEventId'yi TAŞIR (sessizce düşmez) ve yarı mamulle birlikte REDDEDER", parsed.success && parsed.data.doffEventId === d1.data!.id && !karisik.success, `taşıdı=${parsed.success && parsed.data.doffEventId === d1.data!.id} karışık=${karisik.success ? "geçti" : "400"}`);

    // ── §5 DOFF_CANCEL ─────────────────────────────────────────────────────
    const e1 = await revokeDoff(c1.data!.id, "bekçi §5a");
    check("§5a topsuz doff geri alındı (revokedAt dolu)", e1.data!.revokedAt !== null);
    const e2 = await bekle(revokeDoff(d1.data!.id, "bekçi §5b"));
    const e2det = !e2.ok && e2.e instanceof AppError ? (e2.e.details as { barcodes?: string[] }) : undefined;
    check("§5b toplu doff → 409 DOFF_HAS_ROLLS, top ADIYLA", !e2.ok && kod(e2.e) === "DOFF_HAS_ROLLS" && (e2det?.barcodes?.length ?? 0) === 1, e2.ok ? "geçti" : `${kod(e2.e)} barkod=${e2det?.barcodes?.length ?? 0}`);
    const e2msg = !e2.ok ? String((e2.e as Error).message) : "";
    check("§5b' mesaj çare ÖNERMEZ ('önce topu iptal' yok; 'geri alınamaz' var)", !e2msg.includes("önce topu iptal") && e2msg.includes("geri alınamaz"), e2msg.slice(0, 100));
    const topSonra = await prisma.roll.findUnique({ where: { id: topId }, select: { doffEventId: true, status: true } });
    check("§5c Roll'a dokunulmadı (bağ duruyor)", topSonra?.doffEventId === d1.data!.id);
    await prisma.roll.update({ where: { id: topId }, data: { status: RollStatus.CANCELLED } });
    const e3 = await bekle(revokeDoff(d1.data!.id, "bekçi §5d"));
    check("§5d İPTAL EDİLMİŞ topla da 409 (statüye bakılmaz — doff tarihsel olgu)", !e3.ok && kod(e3.e) === "DOFF_HAS_ROLLS", e3.ok ? "geçti" : kod(e3.e));
    // §5e — 21 top: liste 20'de kırpılır, SAYI kırpılmaz (warehouse-stock.helper emsali).
    const d21 = await openDoff({ ...taban, pieceCount: 21 });
    doffIds.push(d21.data!.id);
    for (let i = 0; i < 21; i++) {
      const r = await prisma.roll.create({ data: { barcode: `TEST-DF-21-${ek}-${i}`, itemId: item.id, initialQty: 1, currentQty: 1, status: RollStatus.STOCK, entrySource: RollEntrySource.WEAVING, doffEventId: d21.data!.id }, select: { id: true } });
      rollIds.push(r.id);
    }
    const e5 = await bekle(revokeDoff(d21.data!.id, "bekçi §5e"));
    const e5det = !e5.ok && e5.e instanceof AppError ? (e5.e.details as { barcodes?: string[]; rollIds?: string[]; total?: number }) : undefined;
    const e5msg = !e5.ok ? String((e5.e as Error).message) : "";
    check("§5e 21 topta SAYI kırpılmaz: mesaj '21 top' + '(+1)', details.total=21, barcodes/rollIds 21", !e5.ok && kod(e5.e) === "DOFF_HAS_ROLLS" && e5msg.includes("21 top") && e5msg.includes("+1)") && e5det?.total === 21 && e5det.barcodes?.length === 21 && e5det.rollIds?.length === 21, e5.ok ? "geçti" : `${e5msg.slice(0, 60)}… total=${e5det?.total} barkod=${e5det?.barcodes?.length}`);
    // §5f — P2028 (KK1 kilidi tx zaman aşımından uzun tuttu) 409'a çevrilir; başka hata geçer.
    const p2028 = new Prisma.PrismaClientKnownRequestError("tx timeout", { code: "P2028", clientVersion: "bekçi" });
    const m1 = mapRevokeTimeout(p2028, d21.data!.id);
    const baska = new Error("başka");
    check("§5f P2028 → 409 DOFF_LINK_IN_PROGRESS 'tekrar deneyin'; P2028 olmayan hata olduğu gibi geçer", m1 instanceof AppError && m1.statusCode === 409 && kod(m1) === "DOFF_LINK_IN_PROGRESS" && m1.message.includes("tekrar deneyin") && mapRevokeTimeout(baska, "x") === baska, m1 instanceof AppError ? `${m1.statusCode} ${kod(m1)}` : String(m1));

    // ── §5b ⭐ PENCERE ─────────────────────────────────────────────────────
    const w = await openDoff({ ...taban });
    doffIds.push(w.data!.id);
    let birak!: () => void;
    const kapi = new Promise<void>((res) => { birak = res; });
    let txBBitti = false;
    // Reddedebilen promise SAHİPLİ olsun ([ES-19]): erken red `await`e kadar
    // sahipsiz kalırsa süreç Sonuç satırı basılmadan ölür, `finally` koşmaz.
    // No-op catch türetilmiş dala bağlanır; aşağıdaki `await txB` yine reddeder.
    const txB = prisma.$transaction(async (tx) => {
      await claimDoffForRollTx(tx, { doffEventId: w.data!.id, entrySource: RollEntrySource.WEAVING, createdMachineId: makine.id });
      const r = await tx.roll.create({
        data: { barcode: `TEST-DF-W-${ek}`, itemId: item.id, initialQty: 10, currentQty: 10, status: RollStatus.STOCK, entrySource: RollEntrySource.WEAVING, doffEventId: w.data!.id },
        select: { id: true },
      });
      rollIds.push(r.id);
      await kapi;
    }, { timeout: 15_000 }).then(() => { txBBitti = true; });
    txB.catch(() => undefined);
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
    txB2.catch(() => undefined);
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

    // ── §6b ⭐ 8029 KİLİDİ — sıra kanıtı + 25 paralel ────────────────────────
    // Kilit elle tutulurken kayıt BLOKLANMALI (kanıt: 400 ms içinde dönmez, kilit
    // bırakılınca döner). `p2002 === 0` pencereyi kanıtlamaz; ayırt edici SIRADIR.
    let birakKilit!: () => void;
    const kilitKapi = new Promise<void>((res) => { birakKilit = res; });
    const kilitTx = prisma.$transaction(async (tx) => {
      await lockCodeScopeTx(tx, "doffEvent", dailyCodePrefix(DOFF_CODE_PREFIX, new Date()));
      await kilitKapi;
    }, { timeout: 15_000 });
    kilitTx.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 150));
    let kayitBitti = false;
    const kayit = openDoff({ ...taban }).then((r) => { kayitBitti = true; return r; });
    kayit.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 400));
    check("§6b-1 8029 kilidi tutulurken kayıt BLOKLANDI (400 ms içinde dönmedi)", !kayitBitti, `bitti=${kayitBitti}`);
    birakKilit();
    await kilitTx;
    const kayitSonuc = await kayit;
    doffIds.push(kayitSonuc.data!.id);
    check("§6b-2 kilit bırakılınca kayıt tamamlandı", kayitBitti && desen.test(kayitSonuc.data!.code), kayitSonuc.data!.code);
    const paralel = await Promise.all(Array.from({ length: 25 }, () => bekle(openDoff({ ...taban }))));
    const basarili = paralel.filter((p): p is { ok: true; v: Awaited<ReturnType<typeof openDoff>> } => p.ok);
    for (const p of basarili) doffIds.push(p.v.data!.id);
    const tekil = new Set(basarili.map((p) => p.v.data!.code)).size;
    check("§6b-3 25 paralel kayıt: 25 başarılı, 25 tekil kod, 0 hata (kilitsiz 23/2 idi)", basarili.length === 25 && tekil === 25, `başarılı=${basarili.length} tekil=${tekil} hata=${paralel.filter((p) => !p.ok).map((p) => kod(p.e)).join(",")}`);
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
