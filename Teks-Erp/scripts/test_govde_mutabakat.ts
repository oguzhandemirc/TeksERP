// =============================================================================
// DEVERECİ GÖVDE MUTABAKATI — devere S6 (GERÇEK DB, sunucusuz servis bekçisi)
// =============================================================================
//   §1 geri alınan sevk: gövde listeye girmez, hareket sayılmaz (ileri + _CANCEL çifti etkisiz)
//   §2 sahibine iade edilmiş (RETURNED_TO_OWNER) gövde listede yok; gidiş + dönüş hareketi dönemde görünür
//   §3 başka deverecinin gövdesi sızmaz (liste + hareket); kendi deverecisinin mutabakatında görünür
//   §4 liste: sahibi (bizim / müşteri adı), yaş fabrika günü, özet sayıları
//   §5 basım: ilk basım v1 · aynı içerik yeni sürüm doğurmaz · değişince v2 (v1 SUPERSEDED) · iç not OPT-IN
//   §6 gövde kipi OFF → 403 BEAM_BODY_MODE_OFF (JSON, basım, generic /current)
//   §7 `/statement` alt-router'ı `/:id`den ÖNCE bağlı (yoksa "statement" kimlik sanılır → 400)
// NEGATİF SONDA: `collectMoves` içinden `isEffective(e)` koşulu çıkarılınca §1b kırmızı (2026-11-22).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BeamBodyStatus, Prisma, PrintedDocStatus, PrintedDocType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_DYE_HOUSE, TEST_KARTELA } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createBeamBody, type BeamBodyOwnerInput } from "../src/services/beam-body/write";
import { listBeamBodyEvents } from "../src/services/beam-body/read";
import { applyBeamBodyTransition, undoBeamBodyEvent } from "../src/services/beam-body/transition";
import { createBeamBodyReturn } from "../src/services/beam-body/returns";
import { buildBeamBodyStatement, printBeamBodyStatement } from "../src/services/beam-body/statement";
import { printedDocumentService, type PrintedDocSnapshot } from "../src/services/printed-document.service";
import { renderBeamBodyStatementHtml, type BeamBodyStatementDoc } from "../src/services/document-render/beam-body-statement.html";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-GMT${process.pid}`;
const errCode = async (fn: () => Promise<unknown>): Promise<string | null> => {
  try {
    await fn();
    return null;
  } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string } };
    return `${x.statusCode} ${x.details?.code ?? ""}`;
  }
};
const SETTING_FOTO = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.DEVERE_BEAM_BODY_MODE] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
const DOC = PrintedDocType.BEAM_BODY_STATEMENT;

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== DEVERECİ GÖVDE MUTABAKATI (devere S6) ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const X = await ensureTestSubcontractor(TEST_KARTELA);
  const Y = await ensureTestSubcontractor(TEST_DYE_HOUSE);
  const W = await fixtureWarehouseId();
  const customerIds: string[] = [];
  const returnTokens: string[] = [];
  let n = 0;
  const body = async (owner: BeamBodyOwnerInput = { kind: "OURS" }, notes: string | null = null) =>
    (await createBeamBody({ clientToken: randomUUID(), bodyNo: `${TAG}-${++n}`, owner, warehouseId: W, notes }, U)).data;
  const ship = (id: string, subId: string) => applyBeamBodyTransition(id, { kind: "SHIP_EMPTY", subcontractorId: subId }, U);
  const mine = <T extends { bodyNo: string }>(rows: T[]) => rows.filter((r) => r.bodyNo.startsWith(TAG));
  try {
    await prisma.printedDocument.deleteMany({ where: { docType: DOC, sourceId: { in: [X.id, Y.id] } } });
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "true");
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OPTIONAL");
    const c1 = await prisma.customer.create({ data: { code: `${TAG}-C1`, name: `${TAG} SAHIP` }, select: { id: true, name: true } });
    customerIds.push(c1.id);

    const A = await body();
    const B = await body({ kind: "CUSTOMER", customerId: c1.id }, `${TAG}-GIZLI-NOT`);
    const C = await body();
    const D = await body();
    const E = await body({ kind: "CUSTOMER", customerId: c1.id });
    await ship(A.id, X.id);
    await ship(B.id, X.id);
    await ship(C.id, X.id);
    const cShip = (await listBeamBodyEvents(C.id)).find((e) => e.kind === "SHIP_EMPTY")!;
    await undoBeamBodyEvent(C.id, cShip.id, "yanlış gövde", U);
    await ship(D.id, Y.id);
    await ship(E.id, X.id);
    await applyBeamBodyTransition(E.id, { kind: "RETURN_EMPTY", warehouseId: W }, U);
    const rTok = randomUUID();
    returnTokens.push(rTok);
    await createBeamBodyReturn({ clientToken: rTok, ownerCustomerId: c1.id, bodyIds: [E.id] }, U);

    const st = await buildBeamBodyStatement(prisma, X.id);
    const bodies = mine(st.bodies);
    const moves = mine(st.moves);
    const movesOf = (no: string) => moves.filter((m) => m.bodyNo === no);

    // ── §1 geri alınan sevk ──
    check("§1a geri alınan sevkin gövdesi listede yok", !bodies.some((b) => b.bodyNo === C.bodyNo));
    check("§1b geri alınan sevk hareket sayılmaz", movesOf(C.bodyNo).length === 0, JSON.stringify(movesOf(C.bodyNo)));

    // ── §2 sahibine iade ──
    const e = (await prisma.beamBody.findUniqueOrThrow({ where: { id: E.id }, select: { status: true } })).status;
    check("§2a iade edilen gövde RETURNED_TO_OWNER ve listede yok", e === BeamBodyStatus.RETURNED_TO_OWNER && !bodies.some((b) => b.bodyNo === E.bodyNo));
    const em = movesOf(E.bodyNo);
    check("§2b iade öncesi gidiş + dönüş dönem hareketinde", em.length === 2 && em[0]!.direction === "SENT" && em[1]!.direction === "RETURNED" && em[1]!.kindLabel === "Boş döndü", em.map((m) => `${m.direction}:${m.kindLabel}`).join(" "));

    // ── §3 başka devereci ──
    check("§3a başka deverecinin gövdesi listeye ve harekete sızmaz", !bodies.some((b) => b.bodyNo === D.bodyNo) && movesOf(D.bodyNo).length === 0);
    const sty = await buildBeamBodyStatement(prisma, Y.id);
    check("§3b kendi deverecisinin mutabakatında görünür", mine(sty.bodies).some((b) => b.bodyNo === D.bodyNo) && !mine(sty.bodies).some((b) => b.bodyNo === A.bodyNo));

    // ── §4 liste alanları ──
    const a = bodies.find((b) => b.bodyNo === A.bodyNo);
    const b = bodies.find((x) => x.bodyNo === B.bodyNo);
    check("§4a deverecide iki gövde (A bizim, B müşterinin) · durum Boş · yaş 0 gün", bodies.length === 2 && a?.ownerText === "Bizim" && b?.ownerText === c1.name && a.stateText === "Boş" && a.ageDays === 0, JSON.stringify(bodies.map((x) => [x.bodyNo, x.ownerText, x.ageDays])));
    check("§4b özet sayıları listeyle tutarlı (körlük zemini: ≥2)", st.totals.bodies === st.bodies.length && st.totals.ours + st.totals.others === st.totals.bodies && st.totals.bodies >= 2 && st.totals.sent === st.moves.filter((m) => m.direction === "SENT").length);
    check("§4c A'nın gidişi 'Boş gönderildi' olarak SENT", movesOf(A.bodyNo).length === 1 && movesOf(A.bodyNo)[0]!.direction === "SENT" && movesOf(A.bodyNo)[0]!.kindLabel === "Boş gönderildi");

    // ── §5 basım ──
    const p1 = await printBeamBodyStatement(X.id, U);
    const p2 = await printBeamBodyStatement(X.id, U);
    check("§5a ilk basım v1 · aynı içerik yeni sürüm doğurmaz", p1.created && p1.version === 1 && !p2.created && p2.version === 1 && p1.documentNo === X.code);
    await applyBeamBodyTransition(A.id, { kind: "RETURN_EMPTY", warehouseId: W }, U);
    const p3 = await printBeamBodyStatement(X.id, U);
    const vers = await prisma.printedDocument.findMany({ where: { docType: DOC, sourceId: X.id }, orderBy: { version: "asc" }, select: { version: true, status: true, reissueReason: true } });
    check("§5b içerik değişince v2 · v1 SUPERSEDED · gerekçe yazılı", p3.created && p3.version === 2 && vers.length === 2 && vers[0]!.status === PrintedDocStatus.SUPERSEDED && vers[1]!.status === PrintedDocStatus.ACTIVE && !!vers[1]!.reissueReason);
    const html = (await printedDocumentService.getHtml(DOC, X.id)).data?.html ?? "";
    check("§5c basılı HTML: B gövdesi var, iç not YOK (opt-in kapalı)", html.includes(B.bodyNo) && !html.includes(`${TAG}-GIZLI-NOT`) && html.includes("GÖVDE MUTABAKATI"));
    const latest = await prisma.printedDocument.findFirstOrThrow({ where: { docType: DOC, sourceId: X.id, status: PrintedDocStatus.ACTIVE }, select: { snapshot: true } });
    const snap = latest.snapshot as unknown as PrintedDocSnapshot;
    const optIn = renderBeamBodyStatementHtml({ ...snap, docConfigOverride: { ...(snap.docConfigOverride ?? {}), sections: { internalNotes: true } } });
    check("§5d iç not yalnız `sections.internalNotes: true` ile basılır", optIn.includes(`${TAG}-GIZLI-NOT`));
    const doc = snap.doc as unknown as BeamBodyStatementDoc;
    check("§5e donmuş payload'da fiyat/ücret alanı yok", !/price|fee|amount|ucret/i.test(JSON.stringify(doc)));

    // ── §6 OFF ──
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OFF");
    const offJson = await errCode(() => buildBeamBodyStatement(prisma, X.id));
    const offPrint = await errCode(() => printBeamBodyStatement(X.id, U));
    const offCur = await errCode(() => printedDocumentService.getCurrent(DOC, Y.id));
    check("§6 OFF → 403 BEAM_BODY_MODE_OFF (JSON · basım · generic /current)", [offJson, offPrint, offCur].every((c) => c === "403 BEAM_BODY_MODE_OFF"), `${offJson} | ${offPrint} | ${offCur}`);
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OPTIONAL");

    // ── §7 route sırası ──
    const routes = fs.readFileSync(path.resolve(__dirname, "../src/routes/beam-body.routes.ts"), "utf8");
    const mount = routes.indexOf("router.use(\"/\", beamBodyStatementRoutes)");
    check("§7 `/statement` alt-router'ı `/:id`den önce bağlı", mount > 0 && mount < routes.indexOf("router.get(\"/:id\""));
  } finally {
    await prisma.printedDocument.deleteMany({ where: { docType: DOC, sourceId: { in: [X.id, Y.id] } } });
    const bodies = await prisma.beamBody.findMany({ where: { bodyNo: { startsWith: TAG } }, select: { id: true } });
    const ids = bodies.map((x) => x.id);
    const rets = await prisma.beamBodyReturn.findMany({ where: { OR: [{ clientToken: { in: returnTokens } }, { items: { some: { bodyId: { in: ids } } } }] }, select: { id: true } });
    await prisma.beamBodyReturnItem.deleteMany({ where: { returnId: { in: rets.map((r) => r.id) } } });
    await prisma.beamBodyReturn.deleteMany({ where: { id: { in: rets.map((r) => r.id) } } });
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: ids }, reversesId: { not: null } } });
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: ids } } });
    await prisma.beamBody.deleteMany({ where: { id: { in: ids } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids, ...rets.map((r) => r.id)] } } });
    await cleanupTestCustomers(customerIds);
    for (const key of SETTING_FOTO) {
      const f = foto.find((s) => s.key === key);
      if (f) await prisma.systemSetting.update({ where: { key }, data: { value: f.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
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
