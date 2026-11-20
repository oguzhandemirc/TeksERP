// =============================================================================
// LEVENT GÖVDESİ ENVANTERİ — devere ek B1 (GERÇEK DB, sunucusuz servis bekçisi)
// =============================================================================
//   §1 `BEAM_BODY_EVENT_KINDS` ↔ CHECK `beam_body_events_kind_ck` iki yönlü
//   §2 OFF → 403 BEAM_BODY_MODE_OFF · OPTIONAL'da kayıt: seri no (LG-…), REGISTER olayı, fromStatus null
//   §3 elle no · büyük/küçük harf çakışması 409 BEAM_BODY_NO_TAKEN
//   §4 replay aynı kart (replayed) · aynı token farklı içerik 409 CLIENT_TOKEN_COLLISION
//   §5 sahip: WARPER fasoncu → bağlı cari · bağsız 400 BEAM_BODY_OWNER_UNLINKED · OURS + cari 400
//   §6 AT_SUBCONTRACTOR'da devereci zorunlu (400 BEAM_BODY_PLACE_REQUIRED)
//   §7 transitionBeamBodyTx yanlış "from" → 409 BEAM_BODY_STATE; doğru "from" geçer + olay
//   §8 patch: sahip değişimi yalnız EMPTY_STOCK (aksi 409 BEAM_BODY_BUSY) · pasife alma kuralı
//   §9 kayıt iptali: hareketsiz → REGISTER_CANCEL + pasif · hareketli 409 BEAM_BODY_HAS_HISTORY · çift iptal 409
//   §10 uyum: satırsız = uyar · listede yok WARN → uyarı · BLOCK → 409 BEAM_BODY_MACHINE_MISFIT
//   §11 özet şeridi (byOwner/byStatus/ownerReturnDue) liste where'iyle tutarlı
//   §12 varsayılanlar: ayar satırı yokken mode OFF, fit WARN
// NEGATİF SONDA: §7 — `transitionBeamBodyTx` claim WHERE'inden `status: input.from` çıkarılınca §7a kırmızı (2026-11-20).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import { randomUUID } from "node:crypto";
import { BeamBodyStatus, Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";
import { SETTING_KEYS, readDevereBeamBodyMachineFit, readDevereBeamBodyMode } from "../src/services/system-setting.service";
import { BEAM_BODY_EVENT_KINDS } from "../src/constants/beam-body";
import { beamBodyMachineFitVerdictTx, transitionBeamBodyTx } from "../src/services/helpers/beam-body.helper";
import { cancelBeamBodyRegistration, createBeamBody, patchBeamBody, previewCancelBeamBodyRegistration, type BeamBodyCreateInput } from "../src/services/beam-body/write";
import { listBeamBodies, listBeamBodyEvents } from "../src/services/beam-body/read";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-LG${process.pid}`;
type Err = { status?: number; code?: string; msg: string };
const errOf = async (fn: () => Promise<unknown>): Promise<Err | null> => {
  try {
    await fn();
    return null;
  } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string }; message?: string };
    return { status: x.statusCode, code: x.details?.code, msg: String(x.message ?? e) };
  }
};
const show = (e: Err | null) => (e ? `${e.status} ${e.code ?? ""} ${e.msg.slice(0, 120)}` : "hata yok");
const SETTING_FOTO = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.DEVERE_BEAM_BODY_MODE, SETTING_KEYS.DEVERE_BEAM_BODY_MACHINE_FIT] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
const LIST_BASE = { owner: [], ownerCustomerId: null, status: [], subcontractorId: null, machineId: null, warehouseId: null, active: "all" as const, limit: 200 };

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== LEVENT GÖVDESİ ENVANTERİ (devere ek B1) ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const subFoto = await prisma.subcontractor.findUniqueOrThrow({ where: { id: sub.id }, select: { customerId: true } });
  const customerIds: string[] = [];
  const machineIds: string[] = [];
  let stationId: string | null = null;
  const tokens: string[] = [];
  const create = (input: Omit<BeamBodyCreateInput, "clientToken"> & { clientToken?: string }) => {
    const clientToken = input.clientToken ?? randomUUID();
    tokens.push(clientToken);
    return createBeamBody({ ...input, clientToken }, U);
  };
  try {
    // ── §12 varsayılanlar (satır yok) ─────────────────────────────────────
    await prisma.systemSetting.deleteMany({ where: { key: { in: [SETTING_KEYS.DEVERE_BEAM_BODY_MODE, SETTING_KEYS.DEVERE_BEAM_BODY_MACHINE_FIT] } } });
    check("§12a ayar satırı yokken devere.beamBodyMode = OFF (bugünkü davranış)", (await readDevereBeamBodyMode()) === "OFF");
    check("§12b ayar satırı yokken devere.beamBodyMachineFit = WARN", (await readDevereBeamBodyMachineFit()) === "WARN");

    // ── §1 olay türü evreni ↔ CHECK ───────────────────────────────────────
    const ck = await prisma.$queryRaw<Array<{ def: string }>>`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'beam_body_events_kind_ck'`;
    const dbKinds = new Set([...(ck[0]?.def ?? "").matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!));
    const codeKinds = new Set<string>(BEAM_BODY_EVENT_KINDS);
    const missingInDb = [...codeKinds].filter((k) => !dbKinds.has(k));
    const missingInCode = [...dbKinds].filter((k) => !codeKinds.has(k));
    check("§1 BEAM_BODY_EVENT_KINDS ↔ CHECK iki yönlü eşit", dbKinds.size > 0 && missingInDb.length === 0 && missingInCode.length === 0, `kodda-fazla=${missingInDb.join(",")} db-fazla=${missingInCode.join(",")}`);

    // ── §2 OFF kapısı + OPTIONAL kayıt ────────────────────────────────────
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "true");
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OFF");
    const off = await errOf(() => create({ owner: { kind: "OURS" } }));
    check("§2a OFF → 403 BEAM_BODY_MODE_OFF", off?.status === 403 && off.code === "BEAM_BODY_MODE_OFF", show(off));
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OPTIONAL");
    const a = await create({ owner: { kind: "OURS" }, widthCm: 180, tareKg: 95.5 });
    const aEv = await listBeamBodyEvents(a.data.id);
    check("§2b seri no LG-… · durum EMPTY_STOCK · bizim · aktif", /^LG-\d{5,}$/.test(a.data.bodyNo) && a.data.status === BeamBodyStatus.EMPTY_STOCK && a.data.owner.kind === "OURS" && a.data.isActive && !a.replayed, `${a.data.bodyNo} ${a.data.status}`);
    check("§2c tek REGISTER olayı · fromStatus null · toStatus EMPTY_STOCK", aEv.length === 1 && aEv[0]?.kind === "REGISTER" && aEv[0].fromStatus === null && aEv[0].toStatus === BeamBodyStatus.EMPTY_STOCK, JSON.stringify(aEv.map((e) => e.kind)));

    // ── §3 elle no + çakışma ──────────────────────────────────────────────
    const manualNo = `${TAG}-a1`;
    const b = await create({ bodyNo: manualNo, owner: { kind: "OURS" } });
    check("§3a elle no aynen saklanır", b.data.bodyNo === manualNo, b.data.bodyNo);
    const dup = await errOf(() => create({ bodyNo: manualNo.toUpperCase(), owner: { kind: "OURS" } }));
    check("§3b büyük/küçük harf farklı aynı no → 409 BEAM_BODY_NO_TAKEN", dup?.status === 409 && dup.code === "BEAM_BODY_NO_TAKEN", show(dup));
    const badNo = await errOf(() => create({ bodyNo: "ç ş", owner: { kind: "OURS" } }));
    check("§3c QR'a basılamayan no → 400 BEAM_BODY_NO_INVALID", badNo?.status === 400 && badNo.code === "BEAM_BODY_NO_INVALID", show(badNo));

    // ── §4 replay ─────────────────────────────────────────────────────────
    const tok = randomUUID();
    const r1 = await create({ clientToken: tok, bodyNo: `${TAG}-r1`, owner: { kind: "OURS" } });
    const r2 = await create({ clientToken: tok, bodyNo: `${TAG}-r1`, owner: { kind: "OURS" } });
    check("§4a aynı deneme → aynı kart, replayed", r2.replayed && r2.data.id === r1.data.id);
    const coll = await errOf(() => create({ clientToken: tok, bodyNo: `${TAG}-r2`, owner: { kind: "OURS" } }));
    check("§4b aynı token farklı içerik → 409 CLIENT_TOKEN_COLLISION", coll?.status === 409 && coll.code === "CLIENT_TOKEN_COLLISION", show(coll));

    // ── §5 sahip ──────────────────────────────────────────────────────────
    const cust = await prisma.customer.create({ data: { code: `${TAG}-C`, name: `${TAG} DEVERECI CARI` }, select: { id: true } });
    customerIds.push(cust.id);
    await prisma.subcontractor.update({ where: { id: sub.id }, data: { customerId: null } });
    const unl = await errOf(() => create({ owner: { kind: "WARPER", subcontractorId: sub.id } }));
    check("§5a bağsız devereci → 400 BEAM_BODY_OWNER_UNLINKED", unl?.status === 400 && unl.code === "BEAM_BODY_OWNER_UNLINKED", show(unl));
    await prisma.subcontractor.update({ where: { id: sub.id }, data: { customerId: cust.id } });
    const w = await create({ bodyNo: `${TAG}-w1`, owner: { kind: "WARPER", subcontractorId: sub.id } });
    check("§5b WARPER fasoncu → bağlı cari sahip · rol WARPER · sahibine iade edilecek", w.data.owner.kind === "WARPER" && w.data.owner.customer?.id === cust.id && w.data.ownerReturnDue, JSON.stringify(w.data.owner));
    const oursCust = await errOf(() => create({ owner: { kind: "OURS", customerId: cust.id } }));
    check("§5c OURS + cari → 400 BEAM_BODY_OWNER_INVALID", oursCust?.status === 400 && oursCust.code === "BEAM_BODY_OWNER_INVALID", show(oursCust));

    // ── §6 deverecide kayıt ───────────────────────────────────────────────
    const noSub = await errOf(() => create({ owner: { kind: "OURS" }, initialStatus: BeamBodyStatus.AT_SUBCONTRACTOR }));
    check("§6a AT_SUBCONTRACTOR devecisiz → 400 BEAM_BODY_PLACE_REQUIRED", noSub?.status === 400 && noSub.code === "BEAM_BODY_PLACE_REQUIRED", show(noSub));
    const atSub = await create({ bodyNo: `${TAG}-s1`, owner: { kind: "OURS" }, initialStatus: BeamBodyStatus.AT_SUBCONTRACTOR, subcontractorId: sub.id });
    check("§6b deverecide kayıt: yer = devereci", atSub.data.status === BeamBodyStatus.AT_SUBCONTRACTOR && atSub.data.place.subcontractor?.id === sub.id);
    const badInit = await errOf(() => create({ owner: { kind: "OURS" }, initialStatus: BeamBodyStatus.MOUNTED }));
    check("§6c kayıt yalnız EMPTY_STOCK/AT_SUBCONTRACTOR → 400 BEAM_BODY_REGISTER_STATUS", badInit?.status === 400 && badInit.code === "BEAM_BODY_REGISTER_STATUS", show(badInit));

    // ── §7 geçiş claim'i ──────────────────────────────────────────────────
    const wrong = await errOf(() => prisma.$transaction((tx) => transitionBeamBodyTx(tx, {
      bodyId: atSub.data.id, kind: "MAINTENANCE_IN", from: BeamBodyStatus.EMPTY_STOCK, to: BeamBodyStatus.MAINTENANCE,
      place: { warehouseId: null, subcontractorId: null, machineId: null }, userId: U,
    })));
    const afterWrong = await prisma.beamBody.findUniqueOrThrow({ where: { id: atSub.data.id }, select: { status: true } });
    check("§7a yanlış 'from' → 409 BEAM_BODY_STATE, durum değişmez", wrong?.status === 409 && wrong.code === "BEAM_BODY_STATE" && afterWrong.status === BeamBodyStatus.AT_SUBCONTRACTOR, show(wrong));
    const ok = await prisma.$transaction((tx) => transitionBeamBodyTx(tx, {
      bodyId: atSub.data.id, kind: "RETURN_EMPTY", from: BeamBodyStatus.AT_SUBCONTRACTOR, to: BeamBodyStatus.EMPTY_STOCK,
      place: { warehouseId: null, subcontractorId: null, machineId: null }, userId: U,
    }));
    const afterOk = await prisma.beamBody.findUniqueOrThrow({ where: { id: atSub.data.id }, select: { status: true, subcontractorId: true } });
    check("§7b doğru 'from' → kart EMPTY_STOCK + RETURN_EMPTY olayı (from AT_SUBCONTRACTOR)", afterOk.status === BeamBodyStatus.EMPTY_STOCK && afterOk.subcontractorId === null && ok.kind === "RETURN_EMPTY" && ok.fromStatus === BeamBodyStatus.AT_SUBCONTRACTOR);

    // ── §8 düzenleme ──────────────────────────────────────────────────────
    const busy = await create({ bodyNo: `${TAG}-s2`, owner: { kind: "OURS" }, initialStatus: BeamBodyStatus.AT_SUBCONTRACTOR, subcontractorId: sub.id });
    const ownBusy = await errOf(() => patchBeamBody(busy.data.id, { owner: { kind: "CUSTOMER", customerId: cust.id } }, U));
    check("§8a deverecideyken sahip değişimi → 409 BEAM_BODY_BUSY", ownBusy?.status === 409 && ownBusy.code === "BEAM_BODY_BUSY", show(ownBusy));
    const deactBusy = await errOf(() => patchBeamBody(busy.data.id, { isActive: false }, U));
    check("§8b deverecideyken pasife alma → 409 BEAM_BODY_BUSY", deactBusy?.status === 409 && deactBusy.code === "BEAM_BODY_BUSY", show(deactBusy));
    const own = await patchBeamBody(b.data.id, { owner: { kind: "CUSTOMER", customerId: cust.id }, widthCm: 200, notes: "not" }, U);
    check("§8c depoda boşken sahip CUSTOMER olur + ölçü/not güncellenir", own.owner.kind === "CUSTOMER" && own.owner.customer?.id === cust.id && own.widthCm === "200.00" && own.notes === "not");
    const deact = await patchBeamBody(b.data.id, { isActive: false }, U);
    check("§8d depoda boşken pasife alınır", deact.isActive === false);

    // ── §9 kayıt iptali ───────────────────────────────────────────────────
    const pv = await previewCancelBeamBodyRegistration(a.data.id);
    check("§9a önizleme: hareketsiz → iptal edilebilir", pv.cancellable && pv.laterEventCount === 0 && pv.blocker === null);
    const canc = await cancelBeamBodyRegistration(a.data.id, `${TAG} yanlış kayıt`, U);
    const cEv = await listBeamBodyEvents(a.data.id);
    check("§9b REGISTER_CANCEL (reversesId = REGISTER) + kart pasif + REGISTER işaretli", !canc.isActive && cEv.length === 2 && cEv[1]?.kind === "REGISTER_CANCEL" && cEv[1].reversesId === cEv[0]?.id && cEv[0]?.reversed === true, JSON.stringify(cEv.map((e) => [e.kind, e.reversed])));
    const twice = await errOf(() => cancelBeamBodyRegistration(a.data.id, `${TAG} tekrar`, U));
    check("§9c çift iptal → 409", twice?.status === 409, show(twice));
    const pvHist = await previewCancelBeamBodyRegistration(atSub.data.id);
    const hist = await errOf(() => cancelBeamBodyRegistration(atSub.data.id, `${TAG} hareketli`, U));
    const histEv = await prisma.beamBodyEvent.count({ where: { bodyId: atSub.data.id } });
    check("§9d hareketli gövde: önizleme engelli · iptal 409 BEAM_BODY_HAS_HISTORY · olay yazılmaz", !pvHist.cancellable && pvHist.laterEventCount === 1 && hist?.status === 409 && hist.code === "BEAM_BODY_HAS_HISTORY" && histEv === 2, show(hist));

    // ── §10 gövde–tezgâh uyumu ────────────────────────────────────────────
    stationId = (await prisma.station.create({ data: { code: `${TAG}-H`, name: `TEST-LG Hol ${TAG}`, type: "INTERNAL", kind: "WEAVING" }, select: { id: true } })).id;
    for (const n of [1, 2]) machineIds.push((await prisma.machine.create({ data: { stationId, code: `${TAG}-M${n}`, name: `TEST-LG Tezgah ${n}`, isActive: true }, select: { id: true } })).id);
    const [m1, m2] = machineIds as [string, string];
    const free = await prisma.$transaction((tx) => beamBodyMachineFitVerdictTx(tx, w.data.id, m1));
    check("§10a uyum satırı yok → her tezgâha uyar (uyarı yok)", free.length === 0, JSON.stringify(free));
    const fit = await patchBeamBody(w.data.id, { machineIds: [m1] }, U);
    check("§10b uyum kümesi REPLACE yazılır", fit.machineFits.length === 1 && fit.machineFits[0]?.id === m1);
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MACHINE_FIT, "WARN");
    const fitOk = await prisma.$transaction((tx) => beamBodyMachineFitVerdictTx(tx, w.data.id, m1));
    const warn = await prisma.$transaction((tx) => beamBodyMachineFitVerdictTx(tx, w.data.id, m2));
    check("§10c listede → uyarı yok · listede yok + WARN → tek uyarı", fitOk.length === 0 && warn.length === 1, JSON.stringify(warn));
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MACHINE_FIT, "BLOCK");
    const block = await errOf(() => prisma.$transaction((tx) => beamBodyMachineFitVerdictTx(tx, w.data.id, m2)));
    check("§10d listede yok + BLOCK → 409 BEAM_BODY_MACHINE_MISFIT", block?.status === 409 && block.code === "BEAM_BODY_MACHINE_MISFIT", show(block));

    // ── §11 özet şeridi ↔ liste ───────────────────────────────────────────
    const all = await listBeamBodies({ ...LIST_BASE, search: TAG });
    const sumOwner = Object.values(all.summary.byOwner).reduce((s, n) => s + n, 0);
    const sumStatus = Object.values(all.summary.byStatus).reduce((s, n) => s + n, 0);
    check("§11a özet count = liste satırı = byOwner Σ = byStatus Σ", all.summary.count === all.data.length && sumOwner === all.data.length && sumStatus === all.data.length && all.data.length >= 5, `${all.summary.count}/${all.data.length}/${sumOwner}/${sumStatus}`);
    check("§11b byOwner WARPER = listedeki WARPER", all.summary.byOwner.WARPER === all.data.filter((d) => d.owner.kind === "WARPER").length);
    check("§11c ownerReturnDue = DTO bayrağı sayısı", all.summary.ownerReturnDue === all.data.filter((d) => d.ownerReturnDue).length && all.summary.ownerReturnDue >= 1);
    const due = await listBeamBodies({ ...LIST_BASE, search: TAG, ownerReturnDue: true });
    check("§11d ownerReturnDue süzgeci = özet sayısı", due.data.length === all.summary.ownerReturnDue && due.data.every((d) => d.ownerReturnDue));
    const active = await listBeamBodies({ ...LIST_BASE, search: TAG, active: "active" });
    check("§11e active süzgeci pasifleri dışlar", active.data.every((d) => d.isActive) && active.data.length < all.data.length);
  } finally {
    const bodies = await prisma.beamBody.findMany({ where: { OR: [{ clientToken: { in: tokens } }, { bodyNo: { startsWith: TAG } }] }, select: { id: true } });
    const ids = bodies.map((x) => x.id);
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: ids }, reversesId: { not: null } } });
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: ids } } });
    await prisma.beamBodyMachine.deleteMany({ where: { bodyId: { in: ids } } });
    await prisma.beamBody.deleteMany({ where: { id: { in: ids } } });
    if (machineIds.length > 0) await prisma.machine.deleteMany({ where: { id: { in: machineIds } } });
    if (stationId) await prisma.station.delete({ where: { id: stationId } });
    await prisma.subcontractor.update({ where: { id: sub.id }, data: { customerId: subFoto.customerId } });
    await cleanupTestCustomers(customerIds);
    await prisma.systemSetting.deleteMany({ where: { key: { in: [...SETTING_FOTO] } } });
    for (const s of foto) await prisma.systemSetting.create({ data: { key: s.key, value: s.value as Prisma.InputJsonValue } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
