// =============================================================================
// BEKÇİ — Tezgah Salonu TOPLU DURUŞ (önizleme · aç · kapat "Hepsi çalıştı" · geri al)
// =============================================================================
// Sözleşme (tasarım TEZGAH-SALONU-SECIM-IS-VERME §E F2 + karar 7): ikinci yazar YOK (satır başına
// `openManualStop` / `closeManualStop` / `revokeStop` — alarm dürtmesi onların içinde), satır başına tx,
// sonuç PARÇALI, satırlar sunucuda tezgah kodu sırasıyla, sebep/gerekçe bir kez, tek özet audit.
//   §1 önizleme (OPEN): her tezgah kodu+adıyla; zaten duruşta / pasif / çakışma / mühürlü BLOCKED; YAZMAZ
//   §2 toplu aç: aynı sebep + başlangıç + açan (openedById) her satırda; sınıflandırma borcu yok
//   §3 geçmiş saat çakışması satır bazında STOP_OVERLAP; mühürlü vardiya SHIFT_SEALED; tekli uç değişmedi
//   §4 kısmi başarı: olmayan satır kod + Türkçe sebeple
//   §5 token replay: aynı token'lar → aynı duruşlar, yeni satır yok
//   §6 toplu kapat: önizleme CLOSE/BLOCKED; kapanan satırda bitiş + kapatan; aynı bitişle replay ok, farklı bitiş 409
//   §7 toplu geri al: gerekçe her satırda + geri alan; replay ok; kısa gerekçe 400
//   §8 eşzamanlı iki toplu aç / iki toplu kapat → tezgahta TEK açık duruş, kaybeden 409 sınıfı
//   §9 sıra: girdi ters verilse de ok[] tezgah kodu sırasında
//   §10 tek özet audit (MACHINE_STOP_BULK)
//   §11 yapısal: toplu servis duruş tablosuna KENDİ yazmaz, Promise.all yok; bulk rotaları `/:id/*`ten önce
// Koşum: npx tsx scripts/run-all-tests.ts machine_stop_bulk
//
// NEGATİF SONDALAR (2026-10-12, koşuldu, servis dosyası geri alındı — sha aynı):
//   ① openManualStop'a `rejectOverlap` geçirilmedi → §3a ❌ · ② satır `clientToken`ı geçirilmedi → §2d/§5a ❌
//   ③ `userId` yerine undefined (açan) → §2c ❌ · ④ önizlemede vardiya kapısı kaldırıldı → §1b ❌
//   ⑤ `sort(byCode)` (aç) kaldırıldı → §9 ❌ · ⑥ kapat replay dalı kaldırıldı → §6c ❌
// =============================================================================
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";
import { yorumlariSok } from "./lib/regime-gate-scan";
import { closeManualStop, openManualStop } from "../src/services/machine-stop.service";
import { closeBulkStops, openBulkStops, previewBulkStops, revokeBulkStops } from "../src/services/machine-stop-bulk.service";
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
    data: { name: `TEST-MSB-HOL-${ek}`, code: `TMSB-S-${ek}`.slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true },
  });
  ids.station = station.id;
  const tezgah = async (n: string, isActive = true) => {
    const m = await prisma.machine.create({
      data: { stationId: station.id, name: `TEST-MSB Tezgah ${n} ${ek}`, code: `TMSB-${ek}-${n}`.slice(0, 32), isActive },
      select: { id: true, code: true, name: true },
    });
    ids.machines.push(m.id);
    return m;
  };
  const [A, B, C, D, E, F, F2, G, H, I, J] = [
    await tezgah("A"), await tezgah("B"), await tezgah("C"), await tezgah("D", false), await tezgah("E"),
    await tezgah("F"), await tezgah("F2"), await tezgah("G"), await tezgah("H"), await tezgah("I"), await tezgah("J"),
  ];

  // Başlangıç 10 dk önce (kullanıcı kararı: kesinti 10 dk önce olduysa geçmiş saat seçilir).
  const T0 = new Date(Date.now() - 10 * 60_000);
  // T0'ı kapsayan EN GEÇ başlayan vardiya bu fikstür olur (çözücü startsAt desc) — G'nin karnesi mühürlü.
  const shiftDef = await prisma.shiftDefinition.create({ data: { code: `B${ek}`.slice(0, 8), name: `TEST-MSB vardiya ${ek}`, startMinute: 0, durationMinutes: 480 } });
  ids.shiftDef = shiftDef.id;
  const shift = await prisma.shiftInstance.create({
    data: { shiftDefinitionId: shiftDef.id, factoryDayKey: factoryDayKeyUtcMidnight(T0), startsAt: new Date(T0.getTime() - 60_000), endsAt: new Date(T0.getTime() + 3600_000) },
  });
  ids.shift = shift.id;
  const stat = await prisma.machineShiftStat.create({
    data: { machineId: G.id, shiftInstanceId: shift.id, factoryDay: factoryDayKeyUtcMidnight(T0), stopThresholdSec: 20, source: "OPERATOR", monitoringState: "OFF", sealState: "SEALED", sealGeneration: 1, sealedAt: new Date() },
  });
  ids.stat = stat.id;

  // E: zaten açık duruş · F/F2: T0'dan SONRA biten kapanmış duruş (geçmiş saat çakışması).
  await openManualStop({ machineId: E.id, startedAt: new Date(Date.now() - 20 * 60_000) }, U);
  for (const m of [F, F2]) {
    const s = await openManualStop({ machineId: m.id, startedAt: new Date(Date.now() - 30 * 60_000) }, U);
    await closeManualStop(s.data.id, new Date(Date.now() - 5 * 60_000), U);
  }
  const stopCount = () => prisma.machineStopEvent.count({ where: { machineId: { in: ids.machines } } });

  // ── §1 önizleme (OPEN) ──────────────────────────────────────────────────
  const once = await stopCount();
  const pv = (await previewBulkStops({ action: "OPEN", machineIds: [G.id, F.id, E.id, D.id, B.id, A.id], at: T0 })).data!;
  const row = (id: string) => pv.rows.find((r) => r.machineId === id);
  check("§1a her tezgah AYRI satırda, kodu + adıyla (6 satır)", pv.rows.length === 6 && row(A.id)?.machineName === A.name && pv.rows.every((r) => r.machineCode.startsWith("TMSB-")), `${pv.rows.length}`);
  check(
    "§1b sonuçlar: A/B OPEN · E zaten duruşta (açık duruşuyla) · D pasif · F çakışma · G mühürlü",
    row(A.id)?.outcome === "OPEN" && row(B.id)?.outcome === "OPEN" && row(E.id)?.block?.code === "STOP_ALREADY_OPEN" && !!row(E.id)?.current
      && row(D.id)?.block?.code === "MACHINE_NOT_LOOM" && row(F.id)?.block?.code === "STOP_OVERLAP" && row(G.id)?.block?.code === "SHIFT_SEALED",
    JSON.stringify(pv.rows.map((r) => [r.machineCode.split("-").pop(), r.outcome, r.block?.code ?? ""])),
  );
  check("§1c varsayılan seçim yalnız OPEN satırlarında (engelli seçilemez)", pv.rows.every((r) => r.defaultSelected === (r.outcome === "OPEN")));
  check("§1d satırlar tezgah kodu sırasında", pv.rows.map((r) => r.machineCode).join() === [...pv.rows].map((r) => r.machineCode).sort((a, b) => a.localeCompare(b, "tr")).join());
  check("§1e önizleme YAZMAZ (duruş sayısı aynı)", (await stopCount()) === once);
  const pvNow = (await previewBulkStops({ action: "OPEN", machineIds: [F.id] })).data!;
  check("§1f varsayılan an = şimdi: F'nin kapanmış duruşu şimdiden önce bitti → çakışma YOK", pvNow.rows[0]?.outcome === "OPEN" && !!pvNow.at, JSON.stringify(pvNow.rows[0]?.block));

  // ── §2 toplu aç ─────────────────────────────────────────────────────────
  const tok = { A: randomUUID(), B: randomUUID(), C: randomUUID() };
  const body2 = { startedAt: T0, reasonCode: "ELEKTRIK_KESINTISI", reasonNote: "trafo", rows: [{ machineId: A.id, clientToken: tok.A }, { machineId: B.id, clientToken: tok.B }, { machineId: C.id, clientToken: tok.C }] };
  const preset = await prisma.reasonPreset.findFirst({ where: { kind: "MACHINE_STOP", code: body2.reasonCode, isActive: true }, select: { code: true } });
  if (!preset) body2.reasonCode = (await prisma.reasonPreset.findFirstOrThrow({ where: { kind: "MACHINE_STOP", isActive: true, stopLossClass: { not: null } }, select: { code: true } })).code;
  const r2 = (await openBulkStops(body2, U)).data!;
  const yeni = await prisma.machineStopEvent.findMany({ where: { id: { in: r2.ok.map((o) => o.stopId) } }, select: { machineId: true, startedAt: true, reasonCode: true, reasonNote: true, openedById: true, requiresReason: true, stopKey: true, endedAt: true } });
  check("§2a üç tezgahta üç açık duruş, failed boş", r2.ok.length === 3 && r2.failed.length === 0 && yeni.every((s) => s.endedAt === null), JSON.stringify(r2.failed));
  check("§2b ⭐ sebep BİR KEZ: her satırda aynı kod + not + başlangıç (geçmiş saat), sınıflandırma borcu yok",
    yeni.every((s) => s.reasonCode === body2.reasonCode && s.reasonNote === "trafo" && s.startedAt.getTime() === T0.getTime() && !s.requiresReason));
  check("§2c ⭐ açan kişi (openedById) her satırda dolu", yeni.length === 3 && yeni.every((s) => s.openedById === U));
  check("§2d satır kimliği istemci token'ı (stopKey)", yeni.find((s) => s.machineId === A.id)?.stopKey === tok.A);

  // ── §3 çakışma + mühür + tekli uç ───────────────────────────────────────
  const r3 = (await openBulkStops({ startedAt: T0, rows: [{ machineId: F.id, clientToken: randomUUID() }, { machineId: G.id, clientToken: randomUUID() }, { machineId: H.id, clientToken: randomUUID() }] }, U)).data!;
  check("§3a ⭐ geçmiş saat çakışması satır bazında: F failed STOP_OVERLAP, H ok", r3.failed.some((f) => f.machineId === F.id && f.code === "STOP_OVERLAP") && r3.ok.some((o) => o.machineId === H.id), JSON.stringify(r3.failed));
  check("§3b ⭐ mühürlü vardiya: G failed SHIFT_SEALED, duruş yazılmadı",
    r3.failed.some((f) => f.machineId === G.id && f.code === "SHIFT_SEALED") && (await prisma.machineStopEvent.count({ where: { machineId: G.id } })) === 0, JSON.stringify(r3.failed));
  const tekli = await hataKodu(() => openManualStop({ machineId: F2.id, startedAt: T0 }, U));
  check("§3c tekli uçta davranış DEĞİŞMEDİ (opt-in): F2'de aynı çakışma tekli açılışı durdurmaz", tekli === "yok", tekli);
  await closeBulkStops({ endedAt: new Date(), rows: [{ stopId: r3.ok.find((o) => o.machineId === H.id)!.stopId }] }, U);

  // ── §4 kısmi başarı ─────────────────────────────────────────────────────
  const r4 = (await openBulkStops({ startedAt: new Date(), rows: [{ machineId: D.id, clientToken: randomUUID() }, { machineId: E.id, clientToken: randomUUID() }, { machineId: I.id, clientToken: randomUUID() }] }, U)).data!;
  check("§4a ⭐ parçalı sonuç: 1 oldu, 2 olmadı; requested 3", r4.requested === 3 && r4.ok.length === 1 && r4.failed.length === 2);
  check("§4b olmayan her satır tezgah kodu + kod + Türkçe sebeple (pasif · zaten duruşta)",
    r4.failed.some((f) => f.machineId === D.id && f.code === "MACHINE_NOT_LOOM") && r4.failed.some((f) => f.machineId === E.id && f.code === "STOP_ALREADY_OPEN")
      && r4.failed.every((f) => f.message.length > 10 && f.machineCode.startsWith("TMSB-")),
    JSON.stringify(r4.failed));
  check("§4c geçersiz sebep kodu istek düzeyinde 400 (her satırda tekrarlanmaz)", (await hataKodu(() => openBulkStops({ startedAt: new Date(), reasonCode: "YOK_BOYLE", rows: [{ machineId: J.id, clientToken: randomUUID() }] }, U))) === "400:REASON_CODE_INVALID");

  // ── §5 token replay ─────────────────────────────────────────────────────
  const sayi5 = await stopCount();
  const r5 = (await openBulkStops(body2, U)).data!;
  check("§5a ⭐ aynı token'larla yeniden gönderim → aynı duruş id'leri, replayed işaretli", r5.ok.length === 3 && r5.ok.map((o) => o.stopId).sort().join() === r2.ok.map((o) => o.stopId).sort().join() && r5.ok.every((o) => o.replayed), JSON.stringify(r5.failed));
  check("§5b replay yeni satır YAZMAZ", (await stopCount()) === sayi5);

  // ── §6 toplu kapat ──────────────────────────────────────────────────────
  const pv6 = (await previewBulkStops({ action: "CLOSE", machineIds: [B.id, C.id, J.id] })).data!;
  check("§6a kapat önizlemesi: açık duruş CLOSE (seçili, duruş id'siyle), duruşsuz BLOCKED STOP_NOT_OPEN",
    pv6.rows.find((r) => r.machineId === B.id)?.outcome === "CLOSE" && pv6.rows.find((r) => r.machineId === B.id)?.current?.id === r2.ok.find((o) => o.machineId === B.id)?.stopId
      && pv6.rows.find((r) => r.machineId === B.id)?.defaultSelected === true && pv6.rows.find((r) => r.machineId === J.id)?.block?.code === "STOP_NOT_OPEN");
  const END = new Date(Date.now() - 1000);
  const body6 = { endedAt: END, rows: pv6.rows.filter((r) => r.current).map((r) => ({ stopId: r.current!.id })) };
  const r6 = (await closeBulkStops(body6, U)).data!;
  const kapali = await prisma.machineStopEvent.findMany({ where: { id: { in: body6.rows.map((x) => x.stopId) } }, select: { endedAt: true, closedById: true, durationSec: true, updatedAt: true } });
  check("§6b ⭐ \"Hepsi çalıştı\": iki duruş kapandı, bitiş aynı, kapatan (closedById) dolu, süre hesaplandı",
    r6.ok.length === 2 && kapali.every((k) => k.endedAt?.getTime() === END.getTime() && k.closedById === U && (k.durationSec ?? -1) >= 590), JSON.stringify(r6.failed));
  const r6b = (await closeBulkStops(body6, U)).data!;
  const kapali2 = await prisma.machineStopEvent.findMany({ where: { id: { in: body6.rows.map((x) => x.stopId) } }, select: { updatedAt: true } });
  check("§6c ⭐ aynı bitişle yeniden gönderim → ok (replayed), satır ikinci kez yazılmaz",
    r6b.ok.length === 2 && r6b.ok.every((o) => o.replayed) && kapali2.map((k) => k.updatedAt.getTime()).sort().join() === kapali.map((k) => k.updatedAt.getTime()).sort().join());
  const r6c = (await closeBulkStops({ endedAt: new Date(), rows: body6.rows.slice(0, 1) }, U)).data!;
  check("§6d farklı bitişle (yeni deneme) → STOP_ALREADY_CLOSED", r6c.failed[0]?.code === "STOP_ALREADY_CLOSED", JSON.stringify(r6c));

  // ── §7 toplu geri al ────────────────────────────────────────────────────
  const pv7 = (await previewBulkStops({ action: "REVOKE", machineIds: [A.id, B.id] })).data!;
  check("§7a geri al önizlemesi: açık duruş REVOKE (seçili), kapanmış duruşlu tezgah STOP_NOT_OPEN (salonda yalnız açık duruş)",
    pv7.rows.find((r) => r.machineId === A.id)?.outcome === "REVOKE" && pv7.rows.find((r) => r.machineId === A.id)?.defaultSelected === true && pv7.rows.find((r) => r.machineId === B.id)?.block?.code === "STOP_NOT_OPEN");
  const aStop = r2.ok.find((o) => o.machineId === A.id)!.stopId;
  const body7 = { reason: "yanlış hol seçildi", rows: [{ stopId: aStop }] };
  const r7 = (await revokeBulkStops(body7, U)).data!;
  const geri = await prisma.machineStopEvent.findUnique({ where: { id: aStop }, select: { revokedAt: true, revokedById: true, revokeReason: true } });
  check("§7b ⭐ gerekçe her satıra aynı, geri alan (revokedById) dolu, satır silinmedi", r7.ok.length === 1 && !!geri?.revokedAt && geri.revokedById === U && geri.revokeReason === body7.reason);
  const r7b = (await revokeBulkStops(body7, U)).data!;
  check("§7c aynı gerekçeyle yeniden gönderim → ok (replayed); başka gerekçe → STOP_ALREADY_REVOKED",
    r7b.ok[0]?.replayed === true && (await revokeBulkStops({ reason: "başka gerekçe", rows: body7.rows }, U)).data!.failed[0]?.code === "STOP_ALREADY_REVOKED");
  check("§7d gerekçe < 3 karakter → 400 REVOKE_REASON_REQUIRED", (await hataKodu(() => revokeBulkStops({ reason: " a ", rows: body7.rows }, U))) === "400:REVOKE_REASON_REQUIRED");

  // ── §8 eşzamanlılık ─────────────────────────────────────────────────────
  const [p1, p2] = await Promise.all([
    openBulkStops({ startedAt: new Date(), rows: [{ machineId: I.id, clientToken: randomUUID() }, { machineId: J.id, clientToken: randomUUID() }] }, U),
    openBulkStops({ startedAt: new Date(), rows: [{ machineId: J.id, clientToken: randomUUID() }, { machineId: I.id, clientToken: randomUUID() }] }, U),
  ]);
  const acik = async (id: string) => prisma.machineStopEvent.count({ where: { machineId: id, endedAt: null, revokedAt: null } });
  const kaybeden = [...p1.data!.failed, ...p2.data!.failed];
  check("§8a ⭐ aynı tezgahlara eşzamanlı iki toplu aç → her tezgahta TEK açık duruş, J'yi biri açtı, kaybeden 409 sınıfı",
    (await acik(I.id)) === 1 && (await acik(J.id)) === 1 && p1.data!.ok.length + p2.data!.ok.length === 1 && kaybeden.length === 3
      && kaybeden.every((f) => ["STOP_ALREADY_OPEN", "TRANSIENT_CONFLICT"].includes(f.code)),
    kaybeden.map((f) => f.code).join());
  const jStop = (await prisma.machineStopEvent.findFirstOrThrow({ where: { machineId: J.id, endedAt: null, revokedAt: null }, select: { id: true } })).id;
  const [q1, q2] = await Promise.all([
    closeBulkStops({ endedAt: new Date(Date.now() + 1000), rows: [{ stopId: jStop }] }, U),
    closeBulkStops({ endedAt: new Date(Date.now() + 2000), rows: [{ stopId: jStop }] }, U),
  ]);
  const qKay = [...q1.data!.failed, ...q2.data!.failed];
  check("§8b ⭐ aynı duruşa eşzamanlı iki toplu kapat (farklı bitiş) → biri olur, öteki STOP_ALREADY_CLOSED/RACE",
    q1.data!.ok.length + q2.data!.ok.length === 1 && qKay.length === 1 && ["STOP_ALREADY_CLOSED", "MACHINE_STOP_RACE", "TRANSIENT_CONFLICT"].includes(qKay[0]!.code), qKay.map((f) => f.code).join());

  // ── §9 sıra ─────────────────────────────────────────────────────────────
  // J'nin §8 kapanışı birkaç sn ileride: başlangıç ondan sonra (aksi hâlde doğru biçimde STOP_OVERLAP olur).
  const r9 = (await openBulkStops({ startedAt: new Date(Date.now() + 5000), rows: [{ machineId: J.id, clientToken: randomUUID() }, { machineId: C.id, clientToken: randomUUID() }] }, U)).data!;
  check("§9 ⭐ satırlar SUNUCUDA tezgah kodu sırasıyla işlenir (girdi J, C → sonuç C, J)", r9.ok.map((o) => o.machineId).join() === [C.id, J.id].join(), r9.ok.map((o) => o.machineCode).join());

  // ── §10 tek özet audit ──────────────────────────────────────────────────
  const audit0 = await prisma.systemLog.count({ where: { action: "MACHINE_STOP_BULK" } });
  const r10 = (await openBulkStops({ startedAt: new Date(), rows: [{ machineId: D.id, clientToken: randomUUID() }] }, U)).data!;
  const son = await prisma.systemLog.findFirst({ where: { action: "MACHINE_STOP_BULK" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { newData: true } });
  const yuk = (son?.newData ?? {}) as { kind?: string; requested?: number; ok?: number; failed?: number };
  check("§10 ⭐ toplu işlem başına TEK özet audit (tür · istendi · oldu · olmadı)",
    (await prisma.systemLog.count({ where: { action: "MACHINE_STOP_BULK" } })) === audit0 + 1 && yuk.kind === "OPEN" && yuk.requested === 1 && yuk.ok === r10.ok.length && yuk.failed === 1, JSON.stringify(yuk));

  // ── §11 yapısal ─────────────────────────────────────────────────────────
  const kod = yorumlariSok(fs.readFileSync(path.join(__dirname, "../src/services/machine-stop-bulk.service.ts"), "utf8"));
  check("§11a toplu servis duruş tablosuna KENDİ yazmaz — openManualStop/closeManualStop/revokeStop çağırır",
    !/machineStopEvent\.(create|update|updateMany|upsert|delete)/.test(kod) && /openManualStop\(/.test(kod) && /closeManualStop\(/.test(kod) && /revokeStop\(/.test(kod));
  check("§11b satırlar sırayla (Promise.all yok)", !/Promise\.all/.test(kod));
  // Bağlanma sırası kaynak metinden: Express rotaları tanım sırasıyla eşler.
  const rota = yorumlariSok(fs.readFileSync(path.join(__dirname, "../src/routes/machine-stop.routes.ts"), "utf8"));
  const yollar = [...rota.matchAll(/router\.post\("([^"]+)"/g)].map((m) => m[1]!);
  const sira = (p: string) => yollar.indexOf(p);
  check("§11c bulk rotaları `/:id/close` · `/:id/revoke`tan ÖNCE bağlı (yoksa \"bulk\" duruş id'si sanılır)",
    sira("/bulk/close") >= 0 && sira("/bulk/revoke") >= 0 && sira("/bulk/close") < sira("/:id/close") && sira("/bulk/revoke") < sira("/:id/revoke"), yollar.join(" "));
}

async function cleanup(): Promise<void> {
  try {
    const sid = (await prisma.machineStopEvent.findMany({ where: { machineId: { in: ids.machines } }, select: { id: true } })).map((s) => s.id);
    await prisma.loomAlarmEvent.deleteMany({ where: { alarm: { stopEventId: { in: sid } } } }).catch(() => undefined);
    await prisma.loomAlarm.deleteMany({ where: { stopEventId: { in: sid } } }).catch(() => undefined);
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
