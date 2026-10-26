// =============================================================================
// BEKÇİ — Tezgah Salonu "SEBEP ATA" (sebepsiz açık duruşa salondan sebep; tekli + seçili çoklu)
// =============================================================================
// Sözleşme (tasarım TEZGAH-SALONU-SECIM-IS-VERME §B "Sebep ata"): ikinci yazar YOK — satır başına mevcut
// İLK sınıflandırma yolu (`classifyStop`, `reasonCode IS NULL` claim'i, kayıp sınıfı katalogdan kopyalanıp donar);
// hedef yalnız AÇIK ve sebepsiz duruş (sebep→sebep düzeltmesi Tezgah Duruşları'nda, `reclassify` defteriyle);
// sebep bir kez; satırlar sunucuda tezgah kodu sırasıyla; tek özet audit; izin `loom:classify`.
//   §1 önizleme (CLASSIFY): her tezgah adıyla; sebepsiz açık duruş seçili · açık duruş yok / zaten sebepli /
//      mühürlü vardiya BLOCKED; YAZMAZ; zaman damgası yok
//   §2 sebep ata: her satırda aynı kod + not, kayıp sınıfı katalogdan, sınıflayan dolu, kaynak SUPERVISOR,
//      duruşun olguları (başlangıç · bitiş · stopKey) değişmez, defter (reclass) satırı YAZILMAZ
//   §3 replay: aynı kullanıcı + aynı sebep → ok (replayed), satır ikinci kez yazılmaz; başka sebep → STOP_ALREADY_CLASSIFIED
//   §4 başkası sınıflandırmışsa satır STOP_ALREADY_CLASSIFIED (üzerine yazılmaz); geri alınmış duruş STOP_REVOKED;
//      geçersiz sebep istek düzeyinde 400
//   §5 eşzamanlı iki farklı sebep → tek karar, kaybeden STOP_ALREADY_CLASSIFIED
//   §6 sıra (tezgah kodu) + tek özet audit (MACHINE_STOP_BULK kind CLASSIFY)
//   §7 yapısal: servis tabloya kendi yazmaz, `classifyStop` çağırır, `reclassifyStop` çağırmaz; rotalar
//      `loom:classify` ister ve `/:id/*`ten ÖNCE bağlı
// Koşum: npx tsx scripts/run-all-tests.ts machine_stop_bulk_classify
//
// NEGATİF SONDALAR (2026-10-13, koşuldu, dosyalar md5 ile geri alındı):
//   ① önizlemede "zaten sebepli" engeli kaldırıldı → §1b ❌ · ② classify replay dalı kaldırıldı → §3a ❌
//   ③ classifyStop yerine reclassifyStop çağrısı eklendi (yorum dışı) → §7a ❌ · ④ rota izni loom:manual-entry → §7b ❌
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";
import { yorumlariSok } from "./lib/regime-gate-scan";
import { classifyStop, closeManualStop, openManualStop, revokeStop } from "../src/services/machine-stop.service";
import { classifyBulkStops, previewBulkStops } from "../src/services/machine-stop-bulk.service";
import { factoryDayKeyUtcMidnight } from "../src/constants/time";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}
async function hataKodu(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "yok";
  } catch (e) {
    return e instanceof AppError ? `${e.statusCode}:${String((e.details as { code?: unknown } | undefined)?.code ?? "")}` : `ham:${String(e).slice(0, 80)}`;
  }
}

const ek = Date.now().toString(36).toUpperCase();
const ids = { station: "", machines: [] as string[], shiftDef: "", shift: "", stat: "" };

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(1);
  }
  const U = await testActorId();
  const station = await prisma.station.create({
    data: { name: `TEST-MSC-HOL-${ek}`, code: `TMSC-S-${ek}`.slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true },
  });
  ids.station = station.id;
  const tezgah = async (n: string) => {
    const m = await prisma.machine.create({
      data: { stationId: station.id, name: `TEST-MSC Tezgah ${n} ${ek}`, code: `TMSC-${ek}-${n}`.slice(0, 32), isActive: true },
      select: { id: true, code: true, name: true },
    });
    ids.machines.push(m.id);
    return m;
  };
  const [A, B, C, D, E, F, G, H] = [await tezgah("A"), await tezgah("B"), await tezgah("C"), await tezgah("D"), await tezgah("E"), await tezgah("F"), await tezgah("G"), await tezgah("H")];

  // G: mühürlü vardiyada açılmış sebepsiz duruş (vardiya fikstürü yalnız G'nin karnesini mühürler).
  const T0 = new Date(Date.now() - 10 * 60_000);
  const shiftDef = await prisma.shiftDefinition.create({ data: { code: `C${ek}`.slice(0, 8), name: `TEST-MSC vardiya ${ek}`, startMinute: 0, durationMinutes: 480 } });
  ids.shiftDef = shiftDef.id;
  const shift = await prisma.shiftInstance.create({
    data: { shiftDefinitionId: shiftDef.id, factoryDayKey: factoryDayKeyUtcMidnight(T0), startsAt: new Date(T0.getTime() - 60_000), endsAt: new Date(T0.getTime() + 3600_000) },
  });
  ids.shift = shift.id;

  const ac = async (id: string, reasonCode: string | null = null) => (await openManualStop({ machineId: id, startedAt: T0, reasonCode }, U)).data.id;
  const sA = await ac(A.id);
  const sB = await ac(B.id);
  const sC = await ac(C.id, "MEKANIK_ARIZA"); // zaten sebepli
  // D: açık duruş yok (kapanmış sebepsiz duruş — salonda hedef değil).
  await closeManualStop(await ac(D.id), new Date(Date.now() - 60_000), U);
  const sE = await ac(E.id);
  const sF = await ac(F.id);
  const sG = await ac(G.id);
  const sH = await ac(H.id);
  const gShift = (await prisma.machineStopEvent.findUniqueOrThrow({ where: { id: sG }, select: { shiftInstanceId: true } })).shiftInstanceId;
  if (gShift) {
    ids.stat = (await prisma.machineShiftStat.create({
      data: { machineId: G.id, shiftInstanceId: gShift, factoryDay: factoryDayKeyUtcMidnight(T0), stopThresholdSec: 20, source: "OPERATOR", monitoringState: "OFF", sealState: "SEALED", sealGeneration: 1, sealedAt: new Date() },
    })).id;
  }
  const stopCount = () => prisma.machineStopEvent.count({ where: { machineId: { in: ids.machines } } });
  const reclassCount = () => prisma.machineStopReclass.count({ where: { stopEvent: { machineId: { in: ids.machines } } } });

  // ── §1 önizleme ─────────────────────────────────────────────────────────
  const once = await stopCount();
  const pv = (await previewBulkStops({ action: "CLASSIFY", machineIds: [G.id, D.id, C.id, B.id, A.id] })).data!;
  const row = (id: string) => pv.rows.find((r) => r.machineId === id);
  check("§1a her tezgah AYRI satırda, kodu + adıyla; zaman damgası yok", pv.rows.length === 5 && row(A.id)?.machineName === A.name && pv.at === null, `${pv.rows.length}`);
  check(
    "§1b ⭐ sonuçlar: A/B CLASSIFY (açık duruş id'siyle, seçili) · C zaten sebepli · D açık duruş yok · G mühürlü",
    row(A.id)?.outcome === "CLASSIFY" && row(A.id)?.current?.id === sA && row(A.id)?.defaultSelected === true && row(B.id)?.outcome === "CLASSIFY"
      && row(C.id)?.block?.code === "STOP_ALREADY_CLASSIFIED" && row(D.id)?.block?.code === "STOP_NOT_OPEN"
      && (gShift ? row(G.id)?.block?.code === "SHIFT_SEALED" : true),
    pv.rows.map((r) => `${r.machineCode.slice(-1)}:${r.block?.code ?? r.outcome}`).join(" "),
  );
  check("§1c engelli satır seçili değil; satırlar tezgah kodu sırasında", pv.rows.every((r) => r.defaultSelected === (r.outcome === "CLASSIFY"))
    && pv.rows.map((r) => r.machineCode).join() === [...pv.rows].map((r) => r.machineCode).sort((a, b) => a.localeCompare(b, "tr")).join());
  check("§1d önizleme YAZMAZ", (await stopCount()) === once && (await prisma.machineStopEvent.count({ where: { id: { in: [sA, sB] }, reasonCode: { not: null } } })) === 0);

  // ── §2 sebep ata ────────────────────────────────────────────────────────
  const onceA = await prisma.machineStopEvent.findUniqueOrThrow({ where: { id: sA }, select: { startedAt: true, endedAt: true, stopKey: true } });
  const reclass0 = await reclassCount();
  const body = { reasonCode: "IPLIK_BITTI", reasonNote: "bobin bekleniyor", rows: [{ stopId: sB }, { stopId: sA }] };
  const r2 = (await classifyBulkStops(body, U)).data!;
  const yeni = await prisma.machineStopEvent.findMany({ where: { id: { in: [sA, sB] } }, select: { id: true, reasonCode: true, reasonNote: true, lossClass: true, classifiedById: true, reasonSource: true, endedAt: true } });
  const preset = await prisma.reasonPreset.findFirst({ where: { kind: "MACHINE_STOP", code: "IPLIK_BITTI" }, select: { stopLossClass: true } });
  check("§2a iki satır oldu, failed boş", r2.ok.length === 2 && r2.failed.length === 0, JSON.stringify(r2.failed));
  check("§2b ⭐ sebep BİR KEZ: her satırda aynı kod + not; kayıp sınıfı katalogdan", yeni.length === 2 && yeni.every((s) => s.reasonCode === "IPLIK_BITTI" && s.reasonNote === "bobin bekleniyor" && s.lossClass === preset?.stopLossClass));
  check("§2c ⭐ sınıflayan (classifiedById) dolu, kaynak SUPERVISOR, duruş AÇIK kaldı", yeni.every((s) => s.classifiedById === U && s.reasonSource === "SUPERVISOR" && s.endedAt === null));
  const sonraA = await prisma.machineStopEvent.findUniqueOrThrow({ where: { id: sA }, select: { startedAt: true, endedAt: true, stopKey: true } });
  check("§2d olgular değişmez (başlangıç · bitiş · stopKey) ve ilk sınıflandırma defter (reclass) satırı YAZMAZ",
    JSON.stringify(onceA) === JSON.stringify(sonraA) && (await reclassCount()) === reclass0);

  // ── §3 replay ───────────────────────────────────────────────────────────
  const upd = async () => (await prisma.machineStopEvent.findMany({ where: { id: { in: [sA, sB] } }, select: { updatedAt: true } })).map((x) => x.updatedAt.getTime()).sort().join();
  const u0 = await upd();
  const r3 = (await classifyBulkStops(body, U)).data!;
  check("§3a ⭐ aynı kullanıcı + aynı sebeple yeniden gönderim → ok (replayed), satır ikinci kez yazılmaz", r3.ok.length === 2 && r3.ok.every((o) => o.replayed) && (await upd()) === u0, JSON.stringify(r3.failed));
  const r3b = (await classifyBulkStops({ reasonCode: "MEKANIK_ARIZA", rows: [{ stopId: sA }] }, U)).data!;
  check("§3b başka sebeple → STOP_ALREADY_CLASSIFIED (değiştirme salonda yok)", r3b.failed[0]?.code === "STOP_ALREADY_CLASSIFIED", JSON.stringify(r3b));

  // ── §4 başka yazar · geri alınmış · geçersiz sebep ──────────────────────
  await classifyStop(sE, { reasonCode: "IPLIK_BITTI" }, undefined); // başka yazar (kullanıcısız kaynak)
  await revokeStop(sF, "yanlış tezgah", U);
  const r4 = (await classifyBulkStops({ reasonCode: "IPLIK_BITTI", rows: [{ stopId: sE }, { stopId: sF }] }, U)).data!;
  const eNow = await prisma.machineStopEvent.findUniqueOrThrow({ where: { id: sE }, select: { classifiedById: true } });
  check("§4a ⭐ başkasının kararı üzerine yazılmaz: E STOP_ALREADY_CLASSIFIED (aynı sebep olsa da), F STOP_REVOKED",
    r4.ok.length === 0 && r4.failed.find((f) => f.machineId === E.id)?.code === "STOP_ALREADY_CLASSIFIED" && r4.failed.find((f) => f.machineId === F.id)?.code === "STOP_REVOKED" && eNow.classifiedById === null,
    r4.failed.map((f) => f.code).join());
  check("§4b geçersiz sebep istek düzeyinde 400", (await hataKodu(() => classifyBulkStops({ reasonCode: "YOK_BOYLE", rows: [{ stopId: sH }] }, U))) === "400:REASON_CODE_INVALID");
  if (gShift) {
    const r4c = (await classifyBulkStops({ reasonCode: "IPLIK_BITTI", rows: [{ stopId: sG }] }, U)).data!;
    check("§4c mühürlü vardiya satır bazında SHIFT_SEALED", r4c.failed[0]?.code === "SHIFT_SEALED", JSON.stringify(r4c.failed));
  } else {
    check("§4c mühürlü vardiya (fikstür vardiyası çözülmedi — ölçülemedi)", false, "shiftInstanceId null");
  }

  // ── §5 eşzamanlılık ─────────────────────────────────────────────────────
  const [p1, p2] = await Promise.all([
    classifyBulkStops({ reasonCode: "IPLIK_BITTI", rows: [{ stopId: sH }] }, U),
    classifyBulkStops({ reasonCode: "MEKANIK_ARIZA", rows: [{ stopId: sH }] }, U),
  ]);
  const kay = [...p1.data!.failed, ...p2.data!.failed];
  const hNow = await prisma.machineStopEvent.findUniqueOrThrow({ where: { id: sH }, select: { reasonCode: true } });
  check("§5 ⭐ eşzamanlı iki farklı sebep → tek karar, kaybeden STOP_ALREADY_CLASSIFIED/TRANSIENT",
    p1.data!.ok.length + p2.data!.ok.length === 1 && kay.length === 1 && ["STOP_ALREADY_CLASSIFIED", "TRANSIENT_CONFLICT"].includes(kay[0]!.code) && ["IPLIK_BITTI", "MEKANIK_ARIZA"].includes(hNow.reasonCode ?? ""),
    kay.map((f) => f.code).join());

  // ── §6 sıra + audit ─────────────────────────────────────────────────────
  check("§6a satırlar SUNUCUDA tezgah kodu sırasıyla (girdi B, A → sonuç A, B)", r2.ok.map((o) => o.machineId).join() === [A.id, B.id].join(), r2.ok.map((o) => o.machineCode).join());
  const audit0 = await prisma.systemLog.count({ where: { action: "MACHINE_STOP_BULK" } });
  await classifyBulkStops({ reasonCode: "IPLIK_BITTI", rows: [{ stopId: sC }] }, U);
  const son = await prisma.systemLog.findFirst({ where: { action: "MACHINE_STOP_BULK" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { newData: true } });
  const yuk = (son?.newData ?? {}) as { kind?: string; requested?: number; ok?: number; failed?: number; reasonCode?: string };
  check("§6b ⭐ toplu işlem başına TEK özet audit (kind CLASSIFY · istendi · oldu · olmadı · sebep)",
    (await prisma.systemLog.count({ where: { action: "MACHINE_STOP_BULK" } })) === audit0 + 1 && yuk.kind === "CLASSIFY" && yuk.requested === 1 && yuk.ok === 0 && yuk.failed === 1 && yuk.reasonCode === "IPLIK_BITTI", JSON.stringify(yuk));

  // ── §7 yapısal ──────────────────────────────────────────────────────────
  const kod = yorumlariSok(fs.readFileSync(path.join(__dirname, "../src/services/machine-stop-bulk.service.ts"), "utf8"));
  check("§7a ⭐ servis tabloya KENDİ yazmaz; classifyStop çağırır, reclassifyStop (sebep düzeltme) ÇAĞIRMAZ",
    !/machineStopEvent\.(create|update|updateMany|upsert|delete)/.test(kod) && /classifyStop\(/.test(kod) && !/reclassifyStop/.test(kod) && !/Promise\.all/.test(kod));
  const rota = yorumlariSok(fs.readFileSync(path.join(__dirname, "../src/routes/machine-stop.routes.ts"), "utf8"));
  const izni = (p: string) => new RegExp(`router\\.post\\("${p.replace(/\//g, "\\/")}", requirePermission\\("loom:classify"\\)`).test(rota);
  check("§7b ⭐ iki rota da yalnız `loom:classify` ister (sebep KARARI izni)", izni("/bulk/classify/preview") && izni("/bulk/classify"));
  const yollar = [...rota.matchAll(/router\.post\("([^"]+)"/g)].map((m) => m[1]!);
  const sira = (p: string) => yollar.indexOf(p);
  check("§7c bulk/classify rotaları `/:id/classify`tan ÖNCE bağlı", sira("/bulk/classify") >= 0 && sira("/bulk/classify/preview") >= 0 && sira("/bulk/classify") < sira("/:id/classify"), yollar.join(" "));
}

async function cleanup(): Promise<void> {
  try {
    const sid = (await prisma.machineStopEvent.findMany({ where: { machineId: { in: ids.machines } }, select: { id: true } })).map((s) => s.id);
    await prisma.loomAlarmEvent.deleteMany({ where: { alarm: { stopEventId: { in: sid } } } }).catch(() => undefined);
    await prisma.loomAlarm.deleteMany({ where: { stopEventId: { in: sid } } }).catch(() => undefined);
    await prisma.machineStopReclass.deleteMany({ where: { stopEventId: { in: sid } } }).catch(() => undefined);
    // BEFORE DELETE seddi insan kararlı satırı korur — fikstür temizliği ÖNCE kararı siler (üretim yolu değil).
    await prisma.machineStopEvent.updateMany({ where: { id: { in: sid } }, data: { classifiedById: null, reasonSource: null } });
    await prisma.machineStopEvent.deleteMany({ where: { id: { in: sid } } });
    if (ids.stat) await prisma.machineShiftStat.deleteMany({ where: { id: ids.stat } });
    if (ids.shift) await prisma.shiftInstance.deleteMany({ where: { id: ids.shift } });
    if (ids.shiftDef) await prisma.shiftDefinition.deleteMany({ where: { id: ids.shiftDef } });
    await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } });
    if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
  } catch (e) {
    fail++;
    console.error("❌ temizlik hatası (kalıntı büyür):", (e as Error).message);
  }
}

main()
  .catch((e) => {
    fail++;
    console.error("❌ Bekçi hata ile durdu:", e);
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
