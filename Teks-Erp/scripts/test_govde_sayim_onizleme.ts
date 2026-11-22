// =============================================================================
// GÖVDE OKUT-SAY ÖNİZLEMESİ — devere S7 (GERÇEK DB, sunucusuz servis bekçisi)
// =============================================================================
//   §0 statik: sayım servisi YAZMAZ (create/update/delete/upsert/AuditService yok) · kod çözümü TEK boğazdan
//   §1 depo kapsamı: eşleşen · eksik · başka yerde (+ Boş dönüş önerisi) · tanımsız kümeleri doğru
//   §2 önizleme yazmaz: gövde/olay/audit satır sayısı ve gövde `updatedAt` değişmez
//   §3 esnek no: ayar KAPALI → tanımsız; AÇIK → eşleşen + matchedBy NORMALIZED; iki aday → tanımsız + adaylar
//   §4 toplu eşleştirici ↔ tekli `matchBeamBodyNo` birebir (kapalı + açık)
//   §5 devereci kapsamı: deverecideki eşleşir · depodaki boş okunursa Boş gönder önerisi · okunmayan → Boş dönüş önerisi
//   §6 sınırlar: pasif depo 400 BEAM_BODY_PLACE_INVALID · bağlam sayıları beklenen kümeyle aynı
// NEGATİF SONDA: `isExpectedInScope` durum süzgeci kaldırılınca (bakımdaki gövde depoda "beklenen" sayılınca) §1a/§1d/§1f kırmızı (2026-11-22).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createBeamBody } from "../src/services/beam-body/write";
import { applyBeamBodyTransition } from "../src/services/beam-body/transition";
import { beamBodyCountContext, previewBeamBodyCount, type BeamBodyCountLine } from "../src/services/beam-body/count";
import { matchBeamBodyNo, matchBeamBodyNos } from "../src/services/helpers/beam-body-no.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TSTGS${process.pid}`;
const SETTING_FOTO = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.DEVERE_BEAM_BODY_MODE, SETTING_KEYS.DEVERE_BODY_NO_LOOSE_MATCH] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
const mine = (ls: BeamBodyCountLine[]) => ls.filter((l) => l.bodyNo.startsWith(TAG)).map((l) => l.bodyNo).sort();
const errCode = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return "hata yok";
  } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string } };
    return `${x.statusCode} ${x.details?.code ?? String(e)}`;
  }
};

function staticChecks(): void {
  const src = readFileSync(path.join(__dirname, "..", "src/services/beam-body/count.ts"), "utf8");
  const writes = src.match(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|AuditService|\$transaction|transitionBeamBodyTx/g) ?? [];
  check("§0a sayım servisi yazmaz (create/update/delete/upsert/audit/tx yok)", writes.length === 0, writes.join(", "));
  check("§0b kod çözümü TEK boğaz `matchBeamBodyNos` (bodyNo eşitliği servis içinde yok)", /matchBeamBodyNos\(/.test(src) && !/bodyNo:\s*\{/.test(src));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== GÖVDE OKUT-SAY ÖNİZLEMESİ (devere S7) ===");
  staticChecks();
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const W = await fixtureWarehouseId();
  const tmpWarehouseIds: string[] = [];
  const mk = async (no: string, extra: { initialStatus?: "AT_SUBCONTRACTOR"; subcontractorId?: string } = {}) =>
    (await createBeamBody({ clientToken: randomUUID(), bodyNo: `${TAG}-${no}`, owner: { kind: "OURS" }, ...(extra.initialStatus ? extra : { warehouseId: W }) }, U)).data;
  try {
    for (const [k, v] of [[SETTING_KEYS.DEVERE_ENABLED, "true"], [SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OPTIONAL"], [SETTING_KEYS.DEVERE_BODY_NO_LOOSE_MATCH, "false"]] as const) await setSetting(k, v);
    const A = await mk("0001");
    const B = await mk("0002");
    const C = await mk("0003", { initialStatus: "AT_SUBCONTRACTOR", subcontractorId: sub.id });
    const D = await mk("0004", { initialStatus: "AT_SUBCONTRACTOR", subcontractorId: sub.id });
    const M = await mk("0005");
    await applyBeamBodyTransition(M.id, { kind: "MAINTENANCE_IN" }, U);

    // ── §1 depo kapsamı ───────────────────────────────────────────────
    const p1 = await previewBeamBodyCount({ warehouseId: W }, [A.bodyNo.toLowerCase(), C.bodyNo, M.bodyNo, `${TAG}-NOPE`, A.bodyNo]);
    check("§1a eşleşen: okunan depodaki gövde (harf farkı + tekrar okutma tek satır)", JSON.stringify(mine(p1.matched)) === JSON.stringify([A.bodyNo]), JSON.stringify(mine(p1.matched)));
    check("§1b eksik: depoda beklenip okunmayan", mine(p1.missing).includes(B.bodyNo) && !mine(p1.missing).includes(A.bodyNo), JSON.stringify(mine(p1.missing)));
    const cLine = p1.unexpected.find((l) => l.id === C.id);
    check("§1c başka yerde: deverecideki gövde depoda okundu → Boş dönüş önerisi + yer adı", cLine?.suggestion?.kind === "RETURN_EMPTY" && cLine.suggestion.warehouseId === W && cLine.placeLabel.includes(sub.name), JSON.stringify(cLine));
    const mLine = p1.unexpected.find((l) => l.id === M.id);
    check("§1d bakımdaki gövde depoda beklenmez; okunursa Bakımdan çıkar önerisi", mLine?.suggestion?.kind === "MAINTENANCE_OUT" && !mine(p1.missing).includes(M.bodyNo), JSON.stringify(mLine));
    check("§1e tanımsız: sistemde olmayan no", p1.unknown.some((u) => u.code === `${TAG}-NOPE` && u.candidates.length === 0), JSON.stringify(p1.unknown));
    check("§1f beklenen sayısı = eşleşen + eksik", p1.expectedCount === p1.matched.length + p1.missing.length, `${p1.expectedCount} vs ${p1.matched.length}+${p1.missing.length}`);

    // ── §2 önizleme yazmaz ────────────────────────────────────────────
    const ids = [A.id, B.id, C.id, D.id, M.id];
    const snap = async () => JSON.stringify({
      bodies: await prisma.beamBody.count(), events: await prisma.beamBodyEvent.count(), logs: await prisma.systemLog.count({ where: { recordId: { in: ids } } }),
      stamps: (await prisma.beamBody.findMany({ where: { id: { in: ids } }, select: { updatedAt: true, status: true }, orderBy: { id: "asc" } })).map((r) => `${r.status}@${r.updatedAt.toISOString()}`),
    });
    const before = await snap();
    await previewBeamBodyCount({ warehouseId: W }, [A.bodyNo, C.bodyNo]);
    await previewBeamBodyCount({ subcontractorId: sub.id }, [A.bodyNo, C.bodyNo]);
    check("§2 önizleme yazmaz (gövde/olay/audit sayısı + durum/updatedAt aynı)", (await snap()) === before);

    // ── §3 esnek no ───────────────────────────────────────────────────
    const loose = `${TAG.toLowerCase()} 1`;
    const off = await previewBeamBodyCount({ warehouseId: W }, [loose]);
    check("§3a ayar kapalı: \"tag 1\" tanımsız", off.unknown.length === 1 && off.matched.length === 0);
    await setSetting(SETTING_KEYS.DEVERE_BODY_NO_LOOSE_MATCH, "true");
    const on = await previewBeamBodyCount({ warehouseId: W }, [loose]);
    check("§3b ayar açık: \"tag 1\" → A eşleşen + matchedBy NORMALIZED", on.matched.length === 1 && on.matched[0]!.id === A.id && on.matched[0]!.matchedBy === "NORMALIZED", JSON.stringify(on.matched));
    const twin = (await createBeamBody({ clientToken: randomUUID(), bodyNo: `${TAG}-1.`, owner: { kind: "OURS" }, warehouseId: W }, U)).data;
    const amb = await previewBeamBodyCount({ warehouseId: W }, [`${TAG} 01`]);
    check("§3c iki aday → tanımsız + aday gövde noları", amb.unknown.length === 1 && amb.unknown[0]!.candidates.sort().join() === [A.bodyNo, twin.bodyNo].sort().join(), JSON.stringify(amb.unknown));

    // ── §4 toplu ↔ tekli ──────────────────────────────────────────────
    const vec = [A.bodyNo, A.bodyNo.toLowerCase(), loose, `${TAG} 01`, `${TAG}-0003`, `${TAG} 3`, `${TAG}-NOPE`, "  "];
    let diff = "";
    for (const lo of [false, true]) {
      const batch = await matchBeamBodyNos(prisma, vec, { loose: lo });
      for (const v of vec.filter((x) => x.trim())) {
        const one = await matchBeamBodyNo(prisma, v, { loose: lo });
        const b = batch.get(v.trim());
        if (!b || b.matchedBy !== one.matchedBy || [...b.ids].sort().join() !== [...one.ids].sort().join()) diff += ` ${lo ? "açık" : "kapalı"}:${v}`;
      }
    }
    check("§4 toplu eşleştirici tekli çözümle birebir (kapalı + açık)", diff === "", diff);
    await setSetting(SETTING_KEYS.DEVERE_BODY_NO_LOOSE_MATCH, "false");

    // ── §5 devereci kapsamı ───────────────────────────────────────────
    const p5 = await previewBeamBodyCount({ subcontractorId: sub.id }, [C.bodyNo, B.bodyNo]);
    check("§5a deverecideki okunan gövde eşleşir", mine(p5.matched).join() === C.bodyNo, JSON.stringify(mine(p5.matched)));
    const bLine = p5.unexpected.find((l) => l.id === B.id);
    check("§5b depodaki boş gövde deverecide okundu → Boş gönder önerisi (bu devereci)", bLine?.suggestion?.kind === "SHIP_EMPTY" && bLine.suggestion.subcontractorId === sub.id, JSON.stringify(bLine));
    const dLine = p5.missing.find((l) => l.id === D.id);
    check("§5c deverecide okunmayan → Boş dönüş önerisi", dLine?.suggestion?.kind === "RETURN_EMPTY", JSON.stringify(dLine));

    // ── §6 sınırlar + bağlam ──────────────────────────────────────────
    const pw = await prisma.warehouse.create({ data: { name: `${TAG}-PASIF`, code: `${TAG}P`, isActive: false }, select: { id: true } });
    tmpWarehouseIds.push(pw.id);
    check("§6a pasif depo kapsamı → 400 BEAM_BODY_PLACE_INVALID", (await errCode(() => previewBeamBodyCount({ warehouseId: pw.id }, []))) === "400 BEAM_BODY_PLACE_INVALID");
    const ctx = await beamBodyCountContext();
    const ctxW = ctx.warehouses.find((w) => w.id === W)?.expectedCount;
    const ctxS = ctx.subcontractors.find((s) => s.id === sub.id)?.expectedCount;
    const pW = (await previewBeamBodyCount({ warehouseId: W }, [])).expectedCount;
    const pS = (await previewBeamBodyCount({ subcontractorId: sub.id }, [])).expectedCount;
    const pAll = (await previewBeamBodyCount({ warehouseId: null }, [])).expectedCount;
    check("§6b bağlam sayıları önizlemenin beklenen kümesiyle aynı (depo · devereci · bütün depolar)", ctxW === pW && ctxS === pS && ctx.stockTotal === pAll, `${ctxW}/${pW} · ${ctxS}/${pS} · ${ctx.stockTotal}/${pAll}`);
  } finally {
    const bodies = await prisma.beamBody.findMany({ where: { bodyNo: { startsWith: TAG } }, select: { id: true } });
    const ids = bodies.map((x) => x.id);
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: ids }, reversesId: { not: null } } });
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: ids } } });
    await prisma.beamBodyMachine.deleteMany({ where: { bodyId: { in: ids } } });
    await prisma.beamBody.deleteMany({ where: { id: { in: ids } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: ids } } });
    await prisma.warehouse.deleteMany({ where: { id: { in: tmpWarehouseIds } } });
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
