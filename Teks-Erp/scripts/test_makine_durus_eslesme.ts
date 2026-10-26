// =============================================================================
// Bekçi: HAM DURUŞ KODU → SEBEP EŞLEMESİ (makine kaynaklı duruş D2)
// Çalıştır: npx tsx scripts/test_makine_durus_eslesme.ts
// =============================================================================
// Kodun anlamı KART TİPİNE bağlıdır; tezgah satırı kart tipi genelini ezer; eşleşme yoksa duruş
// sebepsiz açılır (bugünkü davranış).
//   §1 saf öncelik (`pickStopCodeMapping`): tezgah > kart tipi geneli > yok
//   §2 çözücü (DB): genel · üst-yazım · pasif eşleme · kullanılamaz sebep · eksik anahtar → null
//   §3 tekillik: canlı satırda anahtar başına tek eşleme (tezgahsız satır dahil, NULLS NOT DISTINCT); pasif yer işgal etmez
//   §4 makine açılışı: eşleşen kod sebebi MAKİNE kararıyla dondurur (hedef süre dahil); eşleşmeyen sebepsiz
//   §5 yazma yolu (`MachineStopCodeMapService`): gövde allowlist · anahtar değişmez · sebep türü/pasif · biçim ·
//      mükerrer 409 · pasife alma · yeniden etkinleştirmede ikiz 409 · künye oturumdan · her yazım audit'te
//   §6 statik: eşleme tablosunu okuyan tek çözücü; sinyal servisi onu çağırır
// Negatif sondalar (kırmızı görüldü, geri alındı): `pickStopCodeMapping`te `general ?? own` → §1a+§2b+§4c ·
// `stopCodeCandidateWhere`ten eşlemenin `isActive: true`su kaldırıldı → §2c+§2d · `openMachineStop`ta
// eşleme sonucu `openStopCore`a geçirilmedi → §4a+§4b+§4c+§6b · `createSchema`dan `.strict()` kaldırıldı → §5c.
// Ön kontrol (`assertNoLiveTwin`) kaldırılınca §5f YEŞİL kalır: mükerreri DB seddi + P2002 eşlemesi de 409'a çevirir.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { pickStopCodeMapping, resolveMachineStopCode } from "../src/services/helpers/machine-stop-code.helper";
import { closeMachineStop, openMachineStop } from "../src/services/machine-stop-signal.service";
import { machineStopCodeMapService as svc } from "../src/routes/machine-stop-code-map.routes";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const MIN = 60_000;
const ek = Date.now().toString(36);
const TYPE = `TEST-MDE-${ek}`.toUpperCase().slice(0, 32);
const ids = { station: "", machines: [] as string[], presets: [] as string[], collector: "" };

function saf(): void {
  console.log("\n§1 — saf öncelik");
  const m = "m-1";
  const genel = { id: "g", machineId: null, stopReason: { id: "r1", code: "A" } };
  const ozel = { id: "o", machineId: m, stopReason: { id: "r2", code: "B" } };
  const baska = { id: "x", machineId: "m-2", stopReason: { id: "r3", code: "C" } };
  check("§1a tezgah satırı genel satırı ezer (sıra fark etmez)", pickStopCodeMapping([genel, ozel], m)?.reasonCode === "B" && pickStopCodeMapping([ozel, genel], m)?.scope === "MACHINE");
  check("§1b tezgah satırı yoksa kart tipi geneli", pickStopCodeMapping([genel, baska], m)?.scope === "COLLECTOR_TYPE");
  check("§1c başka tezgahın satırı bu tezgaha uygulanmaz → null", pickStopCodeMapping([baska], m) === null);
  check("§1d aday yok → null", pickStopCodeMapping([], m) === null);
}

async function preset(n: string, targetMinutes: number | null, kind: "MACHINE_STOP" | "ROLL_SCRAP" = "MACHINE_STOP"): Promise<{ id: string; code: string }> {
  const p = await prisma.reasonPreset.create({
    data: { kind, code: `TEST_MDE_${n}_${ek}`.toUpperCase(), label: `Test eşleme ${n}`, stopLossClass: "UNPLANNED", targetMinutes, isActive: true },
    select: { id: true, code: true },
  });
  ids.presets.push(p.id);
  return p;
}

async function makine(n: number): Promise<string> {
  const m = await prisma.machine.create({ data: { stationId: ids.station, name: `TEST-MDE-T${n}-${ek}`, code: `TEST-MDE-T${n}-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
  ids.machines.push(m.id);
  return m.id;
}

const esle = (rawStopCode: string, stopReasonId: string, machineId: string | null = null, isActive = true) =>
  prisma.machineStopCodeMap.create({ data: { collectorType: TYPE, rawStopCode, stopReasonId, machineId, isActive } });

async function dbBolumu(): Promise<void> {
  const [m1, m2] = [await makine(1), await makine(2)];
  const pA = await preset("A", 15);
  const pB = await preset("B", null);
  const pPasif = await preset("P", null);
  const key = (rawStopCode: string | null, machineId: string, collectorType: string | null = TYPE) => ({ collectorType, rawStopCode, machineId });

  console.log("\n§2 — çözücü");
  await esle("E-17", pA.id);
  await esle("E-17", pB.id, m1);
  const r1 = await resolveMachineStopCode(prisma, key("E-17", m1));
  const r2 = await resolveMachineStopCode(prisma, key("E-17", m2));
  check("§2a kart tipi geneli başka tezgahta uygulanır", r2?.reasonCode === pA.code && r2.scope === "COLLECTOR_TYPE", JSON.stringify(r2));
  check("§2b tezgah üst-yazımı geneli ezer", r1?.reasonCode === pB.code && r1.scope === "MACHINE", JSON.stringify(r1));
  await esle("E-20", pB.id, m1, false);
  await esle("E-20", pA.id);
  const r3 = await resolveMachineStopCode(prisma, key("E-20", m1));
  check("§2c pasif üst-yazım yok sayılır → genel", r3?.reasonCode === pA.code && r3.scope === "COLLECTOR_TYPE", JSON.stringify(r3));
  await esle("E-21", pA.id, null, false);
  check("§2d yalnız pasif eşleme → null", (await resolveMachineStopCode(prisma, key("E-21", m1))) === null);
  await esle("E-22", pPasif.id, m1);
  await esle("E-22", pA.id);
  await prisma.reasonPreset.update({ where: { id: pPasif.id }, data: { isActive: false } });
  const r4 = await resolveMachineStopCode(prisma, key("E-22", m1));
  check("§2e sebebi pasif üst-yazım kullanılamaz → genele düşer", r4?.reasonCode === pA.code && r4.scope === "COLLECTOR_TYPE", JSON.stringify(r4));
  const other = await preset("F", null, "ROLL_SCRAP");
  await esle("E-23", other.id);
  check("§2f duruş sebebi olmayan katalog satırı (tür ≠ MACHINE_STOP) çözülmez → null", (await resolveMachineStopCode(prisma, key("E-23", m1))) === null);
  check("§2g bilinmeyen ham kod → null", (await resolveMachineStopCode(prisma, key("E-99", m1))) === null);
  check("§2h kart tipi yok (toplayıcısız sinyal) → null, sorgu yok", (await resolveMachineStopCode(prisma, key("E-17", m1, null))) === null);
  check("§2i ham kod yok → null", (await resolveMachineStopCode(prisma, key(null, m1))) === null);
  check("§2j kart tipi birebir (başka tip aynı kodu bilmez) → null", (await resolveMachineStopCode(prisma, key("E-17", m1, `${TYPE}X`.slice(0, 32)))) === null);

  console.log("\n§3 — tekillik");
  const p2002 = async (p: Promise<unknown>): Promise<boolean> => {
    try { await p; return false; } catch (e) { return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"; }
  };
  check("§3a aynı kart tipi + kod için ikinci canlı GENEL satır → P2002 (NULLS NOT DISTINCT)", await p2002(esle("E-17", pB.id)));
  check("§3b aynı tezgah için ikinci canlı üst-yazım → P2002", await p2002(esle("E-17", pA.id, m1)));
  check("§3c pasif satır yer işgal etmez (E-21 geneli yeniden tanımlanır)", !(await p2002(esle("E-21", pB.id))));
  check("§3d ikinci pasif satır da serbest", !(await p2002(esle("E-21", pA.id, null, false))));

  console.log("\n§4 — makine açılışı");
  ids.collector = (await prisma.machineCollector.create({ data: { collectorKey: `test-mde-${ek}`, name: `TEST MDE ${ek}`, collectorType: TYPE }, select: { id: true } })).id;
  const startedAt = new Date(Date.now() - 20 * MIN);
  const k1 = randomUUID();
  const k2 = randomUUID();
  const o1 = await openMachineStop({ machineId: m2, stopKey: k1, startedAt, source: "MACHINE", rawStopCode: "E-17", collectorId: ids.collector });
  const d1 = o1.data;
  check("§4a eşleşen kod sebebi açılışta yazar (MAKİNE kararı: kaynak MACHINE, sınıflayan NULL, borç yok)",
    d1.reasonCode === pA.code && d1.reasonSource === "MACHINE" && d1.classifiedById === null && d1.requiresReason === false && d1.lossClass === "UNPLANNED",
    `${d1.reasonCode} ${d1.reasonSource} ${d1.requiresReason}`);
  check("§4b sebebin hedef süresi açılışta donar", d1.targetMinutes === 15, String(d1.targetMinutes));
  await closeMachineStop({ machineId: m2, stopKey: k1, endedAt: new Date(Date.now() - 10 * MIN), source: "MACHINE" });
  const o2 = await openMachineStop({ machineId: m1, stopKey: k2, startedAt: new Date(Date.now() - 5 * MIN), source: "MACHINE", rawStopCode: "E-17", collectorId: ids.collector });
  check("§4c üst-yazımlı tezgahta tezgah satırının sebebi", o2.data.reasonCode === pB.code, String(o2.data.reasonCode));
  await closeMachineStop({ machineId: m1, stopKey: k2, endedAt: new Date(Date.now() - 4 * MIN), source: "MACHINE" });
  const o3 = await openMachineStop({ machineId: m1, stopKey: randomUUID(), startedAt: new Date(Date.now() - 3 * MIN), source: "MACHINE", rawStopCode: "E-99", collectorId: ids.collector });
  check("§4d eşleşmeyen kod sebepsiz açılır (sınıflandırma borcu)", o3.data.reasonCode === null && o3.data.requiresReason === true && o3.data.reasonSource === null);
}

/** Hata kodu (`details.code`; Zod doğrulaması "ZOD") ve durum; hata yoksa "ok". */
async function kod(p: Promise<unknown>): Promise<string> {
  try { await p; return "ok"; } catch (e) {
    if ((e as Error).constructor?.name === "ZodError") return "400:ZOD";
    const err = e as { statusCode?: number; details?: { code?: string } };
    return `${err.statusCode ?? "?"}:${err.details?.code ?? (e as Error).message}`;
  }
}

async function auditVar(recordId: string, action: string): Promise<boolean> {
  return (await prisma.systemLog.count({ where: { tableName: "MACHINE_STOP_CODE_MAP", recordId, action } })) > 0;
}

async function yazmaBolumu(): Promise<void> {
  console.log("\n§5 — yazma yolu");
  const actor = await testActorId();
  const m = ids.machines[0]!;
  const pA = await preset("WA", null);
  const pB = await preset("WB", null);
  const pRoll = await preset("WR", null, "ROLL_SCRAP");
  const created = await svc.create({ collectorType: TYPE, rawStopCode: " W-1 ", stopReasonId: pA.id }, actor);
  const row = created.data as { id: string; rawStopCode: string; machineId: string | null; isActive: boolean; createdById: string | null };
  check("§5a geçerli eşleme doğar (ham kod kırpılır, genel, etkin, künye oturumdan)", row.rawStopCode === "W-1" && row.machineId === null && row.isActive && row.createdById === actor);
  check("§5b doğuş audit'te (CREATE)", await auditVar(row.id, "CREATE"));
  check("§5c tanınmayan alan (künye dahil) gövdeden yazılamaz → 400", (await kod(svc.create({ collectorType: TYPE, rawStopCode: "W-2", stopReasonId: pA.id, createdById: randomUUID() }, actor))) === "400:ZOD");
  check("§5d kart tipi biçimi (küçük harf) → 400", (await kod(svc.create({ collectorType: "teks-esp32", rawStopCode: "W-2", stopReasonId: pA.id }, actor))) === "400:ZOD");
  check("§5e sebep MACHINE_STOP değil → 400 STOP_REASON_INVALID", (await kod(svc.create({ collectorType: TYPE, rawStopCode: "W-2", stopReasonId: pRoll.id }, actor))) === "400:STOP_REASON_INVALID");
  check("§5f aynı kapsamda etkin eşleme → 409 STOP_CODE_MAP_DUPLICATE", (await kod(svc.create({ collectorType: TYPE, rawStopCode: "W-1", stopReasonId: pB.id }, actor))) === "409:STOP_CODE_MAP_DUPLICATE");
  const ust = await svc.create({ collectorType: TYPE, rawStopCode: "W-1", machineId: m, stopReasonId: pB.id }, actor);
  check("§5g aynı kod için tezgah üst-yazımı ayrı kapsamdır", (ust.data as { machineId: string }).machineId === m);
  check("§5h anahtar alanı PATCH ile değişmez → 400", (await kod(svc.update(row.id, { rawStopCode: "W-9" }, actor))) === "400:ZOD");
  await svc.update(row.id, { stopReasonId: pB.id }, actor);
  check("§5i sebep değişimi yazılır ve audit'te (UPDATE)", (await prisma.machineStopCodeMap.findUnique({ where: { id: row.id } }))?.stopReasonId === pB.id && (await auditVar(row.id, "UPDATE")));
  await svc.softDelete(row.id, actor);
  check("§5j silme = pasife alma (satır durur) ve audit'te (DELETE)", (await prisma.machineStopCodeMap.findUnique({ where: { id: row.id } }))?.isActive === false && (await auditVar(row.id, "DELETE")));
  const yeni = await svc.create({ collectorType: TYPE, rawStopCode: "W-1", stopReasonId: pA.id }, actor);
  check("§5k pasif satır yerine yenisi açılır", (yeni.data as { isActive: boolean }).isActive === true);
  check("§5l etkin ikizi varken pasif satır etkinleştirilemez → 409", (await kod(svc.update(row.id, { isActive: true }, actor))) === "409:STOP_CODE_MAP_DUPLICATE");
  await prisma.reasonPreset.update({ where: { id: pA.id }, data: { isActive: false } });
  check("§5m pasif sebebe eşleme yazılamaz → 400", (await kod(svc.update((yeni.data as { id: string }).id, { stopReasonId: pA.id }, actor))) === "400:STOP_REASON_INVALID");
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (n.endsWith(".ts")) out.push(p);
  }
  return out;
}

function statikBolum(): void {
  console.log("\n§6 — tek çözücü (statik)");
  const kok = join(__dirname, "..");
  const yorumsuz = (f: string) => readFileSync(f, "utf8").replace(/^\s*(\/\/|\*).*$/gm, "");
  const okuyan: string[] = [];
  for (const f of tsFiles(join(kok, "src"))) {
    if (/machineStopCodeMap\s*\.\s*(findMany|findFirst|findFirstOrThrow)\s*\(/.test(yorumsuz(f))) okuyan.push(relative(kok, f));
  }
  check("§6a eşleme adayını okuyan tek yer çözücü helper", okuyan.length === 1 && okuyan[0] === "src/services/helpers/machine-stop-code.helper.ts", okuyan.join(", ") || "yok");
  const sinyal = yorumsuz(join(kok, "src/services/machine-stop-signal.service.ts"));
  check("§6b sinyal servisi çözücüyü çağırır ve sonucu çekirdeğe geçirir", /resolveMachineStopCode\(/.test(sinyal) && /reasonCode:\s*mapped\?\.reasonCode|openStopCoreFor\([^)]*mapped\?\.reasonCode/.test(sinyal));
}

async function cleanup(): Promise<void> {
  try {
    // Fikstür temizliği (üretim yolu değil): makine kararlı satırlar silme seddinden geçer.
    await prisma.loomAlarm.deleteMany({ where: { machineId: { in: ids.machines } } });
    await prisma.machineStopEvent.deleteMany({ where: { machineId: { in: ids.machines } } });
    await prisma.machineStopCodeMap.deleteMany({ where: { collectorType: TYPE } });
    if (ids.collector) await prisma.machineCollector.deleteMany({ where: { id: ids.collector } });
    await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } });
    await prisma.reasonPreset.deleteMany({ where: { id: { in: ids.presets } } });
    if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
  } catch (e) {
    fail++;
    console.error("❌ temizlik hatası (kalıntı büyür):", (e as Error).message);
  }
}

async function main(): Promise<void> {
  console.log("\n=== Ham duruş kodu → sebep eşlemesi ===");
  saf();
  ids.station = (await prisma.station.create({
    data: { name: `TEST-MDE-HOL-${ek}`, code: `TEST-MDE-H-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true },
  })).id;
  try {
    await dbBolumu();
    await yazmaBolumu();
  } catch (e) {
    fail++;
    console.error("❌ beklenmeyen hata:", e);
  }
  statikBolum();
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    await cleanup();
    console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
