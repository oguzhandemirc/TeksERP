// =============================================================================
// BEKÇİ — Duruşun İSTASYON kapsamı (2026-11-09, Gülkesim): istasyon kapısı + sebebin istasyon türü kapsamı
// =============================================================================
//   §1 `Station.machineStopEnabled` varsayılanı true (bugünkü davranış) — servis yoluyla doğan istasyonda da.
//   §2 kapı KAPALI istasyonun makinesine insan duruşu AÇILAMAZ: 400 `STOP_STATION_DISABLED`, satır doğmaz;
//      kapı AÇIK iken aynı çağrı 201.
//   §3 kapı sonradan kapatılınca AÇIK duruş kapatılabilir ve sınıflanabilir (kilitli duruş kalmaz).
//   §4 makine SİNYALİ (MACHINE kaynağı) kapıya takılmaz — sinyal olgudur, bildirim değil.
//   §5 sebep kapsamı: MACHINE_STOP'ta `stationKinds` yazılır (tekrar atılır); başka kind'de dolu → 400
//      `STOP_STATION_KINDS_NOT_APPLICABLE`; çoğaltma kapsamı taşır; boşaltma = her istasyon.
//   §6 liste süzgeci SUNUCUDA: `stationKind=PROCESS_QC` TAMBUR'a özgü satırı DIŞLAR, kapsamsızı TUTAR;
//      `stationKind=TAMBUR` tutar; parametresiz çağrı hepsini döner (eski istemci); `quickPick` süzülmüş
//      listede hesaplanır (süzülmüş listenin ilk 4 aktifi true).
//   §7 katalog ↔ migration: `stationKinds: WEAVING_ONLY` taşıyan sistem kodları migration'ın UPDATE listesiyle
//      AYNI küme; uzlaştırma işi kapsamı doğuşta yazar ve var olan satırın kapsamını EZMEZ.
//   §8 HTTP: `GET /api/reason-presets?stationKind=BILINMEYEN` → 400 (fail-closed); geçerli tür 200.
//   §9 YAZMA KAPISI (2026-11-09): insan yolu kapsam dışı sebebi YAZAMAZ → 400 `STOP_REASON_OUT_OF_SCOPE`, satır
//      değişmez: sebepli açılış · sınıflama · yeniden sınıflama (defter satırı doğmaz) · toplu sınıflama (satır
//      `failed[]`). Kapsamsız sebep her istasyonda geçer. Makine yolu (sinyalli açılış, MACHINE sınıflaması) TAKILMAZ.
//      Liste süzgeci ile yazma kapısı TEK yüklemi paylaşır (`station-kind-scope.helper.ts`, AST: `resolveStopPreset`
//      `assertStopReasonInScope` çağırır, `reason-preset.service` yüklemi kendisi tanımlamaz).
// NEGATİF SONDALAR (2026-11-09):
//   S1 `openStopCore`daki `machineStopEnabled` kapısı silindi → §2a/§2b kırmızı.
//   S2 `list` `stationKindScopeWhere`i uygulamadı → §6a/§6d kırmızı.
//   S3 `resolveStationKinds` kind kontrolü silindi → §5b kırmızı (CHECK 23514 → AppError değil).
//   S4 `resolveStopPreset`teki `assertStopReasonInScope` çağrısı silindi → §9a/§9b/§9c/§9d/§9f/§9g/§9h/§9i/§9j kırmızı.
//   S5 makine yolu muafiyeti silindi (sinyal/MACHINE da kapıdan geçti) → §9e/§9g kırmızı.
// ⚠️ DB'ye YAZAR (TEST-DIK- istasyon/makine/preset; MACHINE_STOP sırasını fotoğraflayıp geri koyar) → `hedefDbEngeli()`.
// =============================================================================
import type { Server } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MachineDataSource, MachineStopLossClass, ReasonPresetKind, StationKind } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin, kosumaOzguParola, testActorId } from "./fixture-test-user";
import { QUICK_PICK_COUNT, MACHINE_STOP_REASONS } from "../src/constants/reason-presets";
import { ReasonPresetService } from "../src/services/reason-preset.service";
import { stationService } from "../src/routes/station.routes";
import { classifyStop, closeManualStop, openManualStop, openStopCore, reclassifyStop } from "../src/services/machine-stop.service";
import { classifyBulkStops } from "../src/services/machine-stop-bulk.service";
import { openMachineStop } from "../src/services/machine-stop-signal.service";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
async function hata(fn: () => Promise<unknown>): Promise<AppError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof AppError ? e : null;
  }
}
const kod = (e: AppError | null): string => String(e?.details?.code ?? e?.statusCode ?? "yok");

const ek = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const TAG = `TEST-DIK-${ek}`;
const ids = { stations: [] as string[], machines: [] as string[], presets: [] as string[] };

async function fixtureMachine(tag: string, data: { kind: StationKind; machineStopEnabled?: boolean }): Promise<{ stationId: string; machineId: string }> {
  const station = await prisma.station.create({
    data: { name: `${TAG}-${tag}`, code: `${TAG}-${tag}`.slice(0, 32), type: "INTERNAL", kind: data.kind, isActive: true, ...(data.machineStopEnabled === undefined ? {} : { machineStopEnabled: data.machineStopEnabled }) },
  });
  ids.stations.push(station.id);
  const m = await prisma.machine.create({ data: { stationId: station.id, name: `${TAG}-M-${tag}`, code: `${TAG}-M${tag}`.slice(0, 32), isActive: true } });
  ids.machines.push(m.id);
  return { stationId: station.id, machineId: m.id };
}

/** Migration'daki `"code" IN (...)` listesi — katalogla aynı küme olmalı (§7a). */
function migrationWeavingCodes(): string[] {
  const dir = join(__dirname, "..", "prisma", "migrations");
  const name = readdirSync(dir).find((d) => d.endsWith("_station_machine_stop_scope"));
  if (!name) return [];
  const sql = readFileSync(join(dir, name, "migration.sql"), "utf8");
  const m = /"code" IN \(([^)]*)\)/.exec(sql);
  return m ? [...m[1]!.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]!).sort() : [];
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exitCode = 1; return; }
  console.log("\n=== Duruşun istasyon kapsamı — istasyon kapısı + sebep istasyon türü ===\n");
  await reconcileReasonPresets(); // izole DB'de boot koşmaz; katalog yalnız ekler (idempotent)

  // ── §1 varsayılan ─────────────────────────────────────────────────────────
  const acik = await fixtureMachine("ACIK", { kind: StationKind.TAMBUR });
  const st = await prisma.station.findUniqueOrThrow({ where: { id: acik.stationId }, select: { machineStopEnabled: true } });
  check("§1a kolon varsayılanı true (bugünkü davranış)", st.machineStopEnabled === true);
  const svc = await stationService.create({ name: `${TAG}-SVC`, type: "INTERNAL", kind: "PROCESS_QC" });
  const svcId = (svc.data as { id: string; machineStopEnabled: boolean }).id;
  ids.stations.push(svcId);
  check("§1b servis yoluyla alan gönderilmeden doğan istasyonda true", (svc.data as { machineStopEnabled: boolean }).machineStopEnabled === true);

  // ── §2 kapı kapalı → açılamaz ─────────────────────────────────────────────
  const kapali = await fixtureMachine("KAPALI", { kind: StationKind.TAMBUR, machineStopEnabled: false });
  const red = await hata(() => openManualStop({ machineId: kapali.machineId, source: MachineDataSource.OPERATOR }, undefined));
  check("§2a kapı kapalı istasyon: 400 STOP_STATION_DISABLED", red?.statusCode === 400 && kod(red) === "STOP_STATION_DISABLED", kod(red));
  check("§2b reddedilen açılış satır doğurmaz", (await prisma.machineStopEvent.count({ where: { machineId: kapali.machineId } })) === 0);
  const ok = await openManualStop({ machineId: acik.machineId, source: MachineDataSource.OPERATOR }, undefined);
  check("§2c kapı açık istasyon: duruş açılır", ok.success && ok.data.endedAt === null);

  // ── §3 sonradan kapatılan istasyonda açık duruş kapanır/sınıflanır ────────
  await prisma.station.update({ where: { id: acik.stationId }, data: { machineStopEnabled: false } });
  const yeni = await hata(() => openManualStop({ machineId: acik.machineId, source: MachineDataSource.OPERATOR, clientToken: randomUUID() }, undefined));
  check("§3a kapatılan istasyonda yeni açılış reddedilir", kod(yeni) === "STOP_STATION_DISABLED", kod(yeni));
  const sinif = await classifyStop(ok.data.id, { reasonCode: "MEKANIK_ARIZA" }, undefined, MachineDataSource.OPERATOR);
  check("§3b açık duruş SINIFLANIR (kapı yalnız açılışı keser)", sinif.data.reasonCode === "MEKANIK_ARIZA");
  const kapa = await closeManualStop(ok.data.id, undefined, undefined, MachineDataSource.OPERATOR);
  check("§3c açık duruş KAPANIR (kilitli duruş kalmaz)", kapa.data.endedAt !== null);

  // ── §4 makine sinyali kapıya takılmaz ─────────────────────────────────────
  const sinyal = await hata(() => openMachineStop({ machineId: kapali.machineId, stopKey: randomUUID(), startedAt: new Date(), source: MachineDataSource.MACHINE }));
  check("§4 makine sinyali kapı kapalı istasyonda da açılır (olgu, bildirim değil)", sinyal === null && (await prisma.machineStopEvent.count({ where: { machineId: kapali.machineId } })) === 1, kod(sinyal));

  // ── §5 sebep kapsamı yazımı ───────────────────────────────────────────────
  const foto = await prisma.reasonPreset.findMany({ where: { kind: ReasonPresetKind.MACHINE_STOP }, select: { id: true, sortOrder: true } });
  try {
    const tam = await ReasonPresetService.create({ kind: ReasonPresetKind.MACHINE_STOP, label: `${TAG} tambur bıçak`, stopLossClass: MachineStopLossClass.UNPLANNED, stationKinds: [StationKind.TAMBUR, StationKind.TAMBUR] });
    ids.presets.push(tam.id);
    check("§5a MACHINE_STOP'ta kapsam yazılır, tekrar atılır", JSON.stringify(tam.stationKinds) === JSON.stringify([StationKind.TAMBUR]), JSON.stringify(tam.stationKinds));
    const yanlis = await hata(() => ReasonPresetService.create({ kind: ReasonPresetKind.ROLL_SCRAP, label: `${TAG} fire`, stationKinds: [StationKind.TAMBUR] }));
    check("§5b başka kind'de dolu kapsam → 400 STOP_STATION_KINDS_NOT_APPLICABLE", yanlis?.statusCode === 400 && kod(yanlis) === "STOP_STATION_KINDS_NOT_APPLICABLE", kod(yanlis));
    const kopya = await ReasonPresetService.duplicate(tam.id, `${TAG} tambur bıçak 2`);
    ids.presets.push(kopya.id);
    check("§5c çoğaltma kapsamı taşır", JSON.stringify(kopya.stationKinds) === JSON.stringify([StationKind.TAMBUR]));
    const bos = await ReasonPresetService.update(kopya.id, { stationKinds: [] });
    check("§5d kapsam boşaltılır (= her istasyon)", bos.stationKinds.length === 0);

    // ── §6 liste süzgeci + quickPick ────────────────────────────────────────
    const hepsi = await ReasonPresetService.list({ kind: ReasonPresetKind.MACHINE_STOP });
    const kursun = await ReasonPresetService.list({ kind: ReasonPresetKind.MACHINE_STOP, stationKind: StationKind.PROCESS_QC });
    const tambur = await ReasonPresetService.list({ kind: ReasonPresetKind.MACHINE_STOP, stationKind: StationKind.TAMBUR });
    check("§6a PROCESS_QC süzgeci TAMBUR'a özgü satırı DIŞLAR, kapsamsızı TUTAR", !kursun.some((r) => r.id === tam.id) && kursun.some((r) => r.id === kopya.id));
    check("§6b TAMBUR süzgeci TAMBUR'a özgü satırı TUTAR", tambur.some((r) => r.id === tam.id));
    check("§6c parametresiz liste hepsini döner (eski istemci)", hepsi.some((r) => r.id === tam.id) && hepsi.length > kursun.length);
    const dokumaKodu = MACHINE_STOP_REASONS.find((r) => r.stationKinds?.includes(StationKind.WEAVING))!.code;
    check("§6d dokumaya özgü sistem sebebi TAMBUR listesinde YOK, WEAVING listesinde VAR", !tambur.some((r) => r.code === dokumaKodu) && (await ReasonPresetService.list({ kind: ReasonPresetKind.MACHINE_STOP, stationKind: StationKind.WEAVING })).some((r) => r.code === dokumaKodu), dokumaKodu);
    // TAMBUR satırını en öne al: tam listede de süzülmüşte de ilk sırada → süzülmüşün ilk 4'ü tam listenin ilk 4'ünden farklı küme olmalı.
    const allIds = (await prisma.reasonPreset.findMany({ where: { kind: ReasonPresetKind.MACHINE_STOP }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true } })).map((r) => r.id);
    const dokumaIds = (await prisma.reasonPreset.findMany({ where: { kind: ReasonPresetKind.MACHINE_STOP, stationKinds: { has: StationKind.WEAVING } }, select: { id: true } })).map((r) => r.id);
    // Dokuma sebeplerini öne diz: tam listenin ilk 4'ü dokuma, TAMBUR süzgecinde ise genel sebepler işaret almalı.
    await ReasonPresetService.reorder(ReasonPresetKind.MACHINE_STOP, [...dokumaIds, ...allIds.filter((id) => !dokumaIds.includes(id))]);
    const tamburQ = await ReasonPresetService.list({ kind: ReasonPresetKind.MACHINE_STOP, stationKind: StationKind.TAMBUR });
    check(`§6e quickPick süzülmüş listede: TAMBUR listesinin ilk ${QUICK_PICK_COUNT} aktifi true, gerisi false`, tamburQ.length > QUICK_PICK_COUNT && tamburQ.slice(0, QUICK_PICK_COUNT).every((r) => r.quickPick) && tamburQ.slice(QUICK_PICK_COUNT).every((r) => !r.quickPick), `${tamburQ.length} satır`);
  } finally {
    for (const f of foto) await prisma.reasonPreset.update({ where: { id: f.id }, data: { sortOrder: f.sortOrder } }).catch(() => undefined);
  }

  // ── §7 katalog ↔ migration + uzlaştırma ezmez ───────────────────────────
  const katalog = MACHINE_STOP_REASONS.filter((r) => r.stationKinds?.includes(StationKind.WEAVING)).map((r) => r.code).sort();
  const mig = migrationWeavingCodes();
  check("§7a katalogdaki DOKUMA kapsamlı kodlar = migration UPDATE listesi", katalog.length === 12 && JSON.stringify(katalog) === JSON.stringify(mig), `katalog ${katalog.length} · migration ${mig.length}`);
  const sys = await prisma.reasonPreset.findFirstOrThrow({ where: { kind: ReasonPresetKind.MACHINE_STOP, code: katalog[0]! }, select: { id: true, stationKinds: true } });
  check("§7b uzlaştırma sistem satırını kapsamıyla doğurur", sys.stationKinds.includes(StationKind.WEAVING), JSON.stringify(sys.stationKinds));
  await prisma.reasonPreset.update({ where: { id: sys.id }, data: { stationKinds: [StationKind.WEAVING, StationKind.TAMBUR] } });
  try {
    await reconcileReasonPresets();
    const sonra = await prisma.reasonPreset.findUniqueOrThrow({ where: { id: sys.id }, select: { stationKinds: true } });
    check("§7c uzlaştırma fabrikanın değiştirdiği kapsamı EZMEZ", sonra.stationKinds.includes(StationKind.TAMBUR), JSON.stringify(sonra.stationKinds));
  } finally {
    await prisma.reasonPreset.update({ where: { id: sys.id }, data: { stationKinds: sys.stationKinds } });
  }

  // ── §9 yazma kapısı ──────────────────────────────────────────────────────
  await scopeWriteGate(katalog[0]!);

  // ── §8 HTTP ───────────────────────────────────────────────────────────────
  const parola = kosumaOzguParola();
  const admin = await ensureTestAdmin({ password: parola });
  const server: Server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: admin.username, password: parola }) });
    const token = ((await login.json()) as { data?: { token?: string; accessToken?: string } }).data;
    const bearer = token?.accessToken ?? token?.token;
    if (!bearer) {
      check("§8 HTTP oturumu açılamadı", false, `login ${login.status}`);
    } else {
      const h = { Authorization: `Bearer ${bearer}` };
      const kotu = await fetch(`${base}/api/reason-presets?stationKind=BILINMEYEN`, { headers: h });
      check("§8a tanınmayan stationKind → 400 (fail-closed)", kotu.status === 400, String(kotu.status));
      const iyi = await fetch(`${base}/api/reason-presets?kind=MACHINE_STOP&stationKind=TAMBUR`, { headers: h });
      const rows = (await iyi.json()) as Array<{ code: string; stationKinds: string[] }>;
      check("§8b geçerli tür 200 + dokuma sebebi süzülmüş", iyi.status === 200 && Array.isArray(rows) && rows.length > 0 && !rows.some((r) => r.stationKinds.includes("WEAVING") && !r.stationKinds.includes("TAMBUR")), String(iyi.status));
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

/** §9 — insan yolu kapsam dışı sebebi yazamaz; makine yolu takılmaz; yüklem tek kaynak. */
async function scopeWriteGate(dokumaKodu: string): Promise<void> {
  const kursun = await fixtureMachine("K9", { kind: StationKind.PROCESS_QC });
  const dokuma = await fixtureMachine("D9", { kind: StationKind.WEAVING });
  const tamburOnly = await ReasonPresetService.create({ kind: ReasonPresetKind.MACHINE_STOP, label: `${TAG} yalnız tambur`, stopLossClass: MachineStopLossClass.UNPLANNED, stationKinds: [StationKind.TAMBUR] });
  ids.presets.push(tamburOnly.id);

  // Her adım kendi makinesinde: sonda altında (kapı yok) bir adımın yanlışlıkla açtığı duruş sonrakini 409'a düşürmesin.
  const kursunA = await fixtureMachine("K9A", { kind: StationKind.PROCESS_QC });
  const acRed = await hata(() => openManualStop({ machineId: kursunA.machineId, reasonCode: dokumaKodu, source: MachineDataSource.OPERATOR }, undefined));
  check("§9a sebepli açılış: dokumaya özgü sebep kurşun makinesinde 400 STOP_REASON_OUT_OF_SCOPE, satır doğmaz", acRed?.statusCode === 400 && kod(acRed) === "STOP_REASON_OUT_OF_SCOPE" && (await prisma.machineStopEvent.count({ where: { machineId: kursunA.machineId } })) === 0, kod(acRed));

  const stop = (await openManualStop({ machineId: kursun.machineId, source: MachineDataSource.OPERATOR }, undefined)).data;
  const sinifRed = await hata(() => classifyStop(stop.id, { reasonCode: dokumaKodu }, undefined, MachineDataSource.OPERATOR));
  const sonra = await prisma.machineStopEvent.findUniqueOrThrow({ where: { id: stop.id }, select: { reasonCode: true } });
  check("§9b sınıflama: kapsam dışı sebep 400, duruş sebepsiz kalır", kod(sinifRed) === "STOP_REASON_OUT_OF_SCOPE" && sonra.reasonCode === null, kod(sinifRed));
  const sinifOk = await hata(() => classifyStop(stop.id, { reasonCode: "MEKANIK_ARIZA" }, undefined, MachineDataSource.SUPERVISOR));
  check("§9c kapsamsız sebep (boş kapsam = her yer) kurşun makinesinde sınıflanır", sinifOk === null, kod(sinifOk));
  const reRed = await hata(() => reclassifyStop(stop.id, { fromReasonCode: "MEKANIK_ARIZA", toReasonCode: dokumaKodu, reason: "sonda" }, undefined));
  const reSay = await prisma.machineStopReclass.count({ where: { stopEventId: stop.id } });
  check("§9d yeniden sınıflama: kapsam dışı hedef 400, defter satırı doğmaz, karar değişmez", kod(reRed) === "STOP_REASON_OUT_OF_SCOPE" && reSay === 0 && (await prisma.machineStopEvent.findUniqueOrThrow({ where: { id: stop.id }, select: { reasonCode: true } })).reasonCode === "MEKANIK_ARIZA", kod(reRed));

  // Makine yolu: sinyalli açılış eşlenmiş kodu kapsamına bakmadan yazar; MACHINE sınıflaması da öyle.
  await closeManualStop(stop.id, undefined, undefined, MachineDataSource.OPERATOR);
  const sinyal = await hata(() => openStopCore({
    machineId: kursun.machineId, stopKey: randomUUID(), started: { value: new Date(), warning: null }, source: MachineDataSource.MACHINE, actorId: null,
    reasonCode: dokumaKodu, signal: { signalKind: null, rawStopCode: "SONDA", collectorId: null }, fingerprint: () => [],
  }));
  check("§9e makine sinyali (eşlenmiş kod) kapsam dışı sebeple de açılır — eşleme fabrikanın kararı", sinyal === null, kod(sinyal));
  const kursun2 = await fixtureMachine("K9B", { kind: StationKind.PROCESS_QC });
  const acikSinyal = (await openStopCore({
    machineId: kursun2.machineId, stopKey: randomUUID(), started: { value: new Date(), warning: null }, source: MachineDataSource.MACHINE, actorId: null,
    reasonCode: null, signal: { signalKind: null, rawStopCode: "SONDA2", collectorId: null }, fingerprint: () => [],
  })).data!;
  const insanRed = await hata(() => classifyStop(acikSinyal.id, { reasonCode: dokumaKodu }, undefined, MachineDataSource.OPERATOR));
  check("§9f aynı duruşu İNSAN kapsam dışı sebeple sınıflayamaz", kod(insanRed) === "STOP_REASON_OUT_OF_SCOPE", kod(insanRed));
  const makineOk = await hata(() => classifyStop(acikSinyal.id, { reasonCode: dokumaKodu }, undefined, MachineDataSource.MACHINE));
  check("§9g MACHINE kaynaklı sınıflama kapıya takılmaz", makineOk === null, kod(makineOk));

  // Toplu sınıflama: sunucu her satırı ayrı denetler → satır failed[]'e STOP_REASON_OUT_OF_SCOPE ile düşer.
  const U = await testActorId();
  const dStop = (await openManualStop({ machineId: dokuma.machineId, source: MachineDataSource.SUPERVISOR }, U)).data;
  const toplu = (await classifyBulkStops({ reasonCode: tamburOnly.code, rows: [{ stopId: dStop.id }] }, U)).data!;
  check("§9h toplu sınıflama: yalnız TAMBUR kapsamlı sebep dokuma duruşunda failed[] STOP_REASON_OUT_OF_SCOPE", toplu.ok.length === 0 && toplu.failed.length === 1 && toplu.failed[0]!.code === "STOP_REASON_OUT_OF_SCOPE", JSON.stringify(toplu.failed));
  const topluOk = (await classifyBulkStops({ reasonCode: dokumaKodu, rows: [{ stopId: dStop.id }] }, U)).data!;
  check("§9i aynı duruş kapsamındaki (dokuma) sebeple toplu sınıflanır", topluOk.ok.length === 1);

  // Tek kaynak: liste süzgeci ve yazma kapısı aynı helper'dan.
  const ctx = readFileSync(join(__dirname, "..", "src", "services", "helpers", "machine-stop-context.helper.ts"), "utf8");
  const rp = readFileSync(join(__dirname, "..", "src", "services", "reason-preset.service.ts"), "utf8");
  check("§9j tek yüklem: `resolveStopPreset` `assertStopReasonInScope` çağırır, `reason-preset.service` yüklemi tanımlamaz (helper'dan alır)", /assertStopReasonInScope\(row, stationKind\)/.test(ctx) && !/function stationKindScopeWhere/.test(rp) && /from "\.\/helpers\/station-kind-scope\.helper"/.test(rp));
}

async function cleanup(): Promise<void> {
  try {
    const stops = await prisma.machineStopEvent.findMany({ where: { machineId: { in: ids.machines } }, select: { id: true } });
    const sid = stops.map((s) => s.id);
    await prisma.machineStopReclass.deleteMany({ where: { stopEventId: { in: sid } } });
    await prisma.machineStopEvent.updateMany({ where: { id: { in: sid } }, data: { classifiedById: null, reasonSource: null } });
    await prisma.machineStopEvent.deleteMany({ where: { id: { in: sid } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids.presets, ...ids.stations, ...sid] } } }).catch(() => undefined);
    await prisma.reasonPreset.deleteMany({ where: { id: { in: ids.presets } } });
    await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } });
    await prisma.station.deleteMany({ where: { id: { in: ids.stations } } });
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
