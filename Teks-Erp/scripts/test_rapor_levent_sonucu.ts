// =============================================================================
// DOKUMA LEVENT/KAPASİTE RAPORLARI — levent sonucu · kapasite kullanımı · levent bitiş tahmini (S1c)
// =============================================================================
// Koşum: npx tsx scripts/run-all-tests.ts rapor_levent_sonucu   (DB'ye YAZAR; TST- fikstürü; bayraklar fotoğrafa döner)
//
// Sözleşme: docs/design/DOKUMA-MANUEL-PLAN.md § S1c + docs/kurallar/dokuma.md § Raporların İKİ DEĞİŞMEZİ.
//   §1 levent sonucu: take-up %5, 1000 m sarım, KK1 190 m top (doff + auto-consume → CONSUMED 200/190), bitiş
//      → beklenen 950 · gerçek 190 (otomatik) · fire 760 · %80; H5 düzeltilmiş top `meta.duzeltilmisTop`
//   §2 take-up NULL → beklenen null, fire null, `ozet.olculemedi` 1, oran paydasına girmez
//   §3 açık levent (MOUNTED): fire alanları null, `kullanimPct` dolu; elle tüketim `gercekKaynak.elle`de AYRI
//   §4 kapasite: nominal 600, atkı/cm 20 → 18 m/sa; potansiyel = 18 × takvim saati; gerçek = doff'lu top metresi;
//      nominal yok → null + "nominal yok", satır özet oranının DIŞINDA
//   §5 bitiş tahmini: kalan ÷ (son 7 gün tüketimi ÷ 7) → gün + fabrika günü; tüketim yok → null + gerekçe
//   §6 `meta.ufuk` = LOOM_HORIZON_DAY üç raporda (servis + HTTP)
//   §7 HTTP zarfı: süzgeçliyken kökte `suzgec` (+dusenSatir), süzgeçsizken YOK; `data.meta`; strict 400;
//      devere kapalı → levent uçları 403 MODULE_DISABLED, kapasite 200
//
// NEGATİF SONDALAR (md5 ile geri alındı):
//   SONDA 1: take-up çarpanı kaldırıldı → bu bekçi 3 ❌ (§1a/§1c/§1e)
//   SONDA 2: kalan `warpBeamLengthSign` döngüsüyle elle toplandı → test_levent_kalan_tek_okuyucu 1 ❌ (§2)
//   SONDA 3: kapasite servisinde `meta.ufuk` düşürüldü → bu bekçi 2 ❌ (§6a/§7a)
// =============================================================================
import type { AddressInfo } from "node:net";
import { MachineDataSource, Prisma, RollEntrySource, StationType, WarpBeamOrigin, WarpKgSource } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { LOOM_HORIZON_DAY } from "../src/constants/dokuma-ufku";
import { factoryYmd } from "../src/constants/time";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { InventoryService } from "../src/services/inventory.service";
import { openDoff } from "../src/services/machine-doff.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { mountBeam } from "../src/services/warp-beam-mount.service";
import { consumeBeam, exhaustBeam } from "../src/services/warp-beam-consume.service";
import { beamResultReport } from "../src/services/reports/levent-sonucu.report.service";
import { capacityUsageReport } from "../src/services/reports/kapasite-kullanimi.report.service";
import { finishForecastReport } from "../src/services/reports/levent-bitis-tahmini.report.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TST-LS-${process.pid}`;
const FLAGS = [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.DEVERE_AUTO_CONSUME];
const setFlag = (key: string, v: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: String(v) }, update: { value: String(v) } });
const near = (a: number | null | undefined, b: number, eps = 0.01) => typeof a === "number" && Math.abs(a - b) <= eps;

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("=== DOKUMA LEVENT/KAPASİTE RAPORLARI (S1c) ===\n");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  const stDv = await prisma.station.create({ data: { name: `${TAG}-DEVERE`, code: `${TAG}-DV`.slice(0, 32), type: StationType.INTERNAL, producesWarpBeam: true }, select: { id: true } });
  const stLoom = await prisma.station.create({ data: { name: `${TAG}-DOKUMA`, code: `${TAG}-DK`.slice(0, 32), type: StationType.INTERNAL, kind: "WEAVING", consumesWarpBeam: true }, select: { id: true } });
  const t1 = await prisma.machine.create({ data: { stationId: stLoom.id, name: `${TAG}-T1`, code: `${TAG}-T1`.slice(0, 32), warpBeamSlots: 1 }, select: { id: true, code: true } });
  const t2 = await prisma.machine.create({ data: { stationId: stLoom.id, name: `${TAG}-T2`, code: `${TAG}-T2`.slice(0, 32), warpBeamSlots: 1 }, select: { id: true, code: true } });
  await prisma.machineSpec.create({ data: { machineId: t1.id, nominalUnitsPerMin: 600 } });
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  const spec5 = await prisma.warpSpec.create({ data: { code: `${TAG}-CK5`, name: `${TAG} çözgü %5`, yarnItemId: yarn.id, endsCount: 3000, takeUpPct: 5 }, select: { id: true } });
  const specNull = await prisma.warpSpec.create({ data: { code: `${TAG}-CK0`, name: `${TAG} take-up yok`, yarnItemId: yarn.id, endsCount: 3000 }, select: { id: true } });
  const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} fasoncu` }, select: { id: true } });
  const fabric = await prisma.item.create({ data: { code: `${TAG}-KM`, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } });
  const inventory = new InventoryService();
  const beamIds: string[] = [];
  const rollIds: string[] = [];
  const now = Date.now();
  const run = await prisma.machineRun.create({ data: { machineId: t1.id, startedAt: new Date(now - 2 * 3_600_000), endedAt: new Date(now - 60_000), unitsPerCm: 20 }, select: { id: true } });
  const sar = async (m: number, specId: string) => {
    const p = await createWarpBeam({ warpSpecId: specId, plannedLengthM: m, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: sub.id });
    beamIds.push(p.data.id);
    await windWarpBeam(p.data.id, { lengthM: m, kgSource: WarpKgSource.THEORETICAL });
    return p.data.id;
  };
  const top = async (machineId: string, m: number) => {
    const d = (await openDoff({ machineId, productionLineNo: 1, pieceCount: 1, counterSource: MachineDataSource.OPERATOR })).data!.id;
    const r = await inventory.createInitialEntry({ itemId: fabric.id, initialQty: m }, undefined, null, false, { forcedEntrySource: RollEntrySource.WEAVING, doffEventId: d });
    const id = (r.data as { id: string }).id;
    rollIds.push(id);
    return id;
  };
  const server = app.listen(0);
  await new Promise<void>((res) => server.once("listening", () => res()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const k of [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.DEVERE_AUTO_CONSUME]) await setFlag(k, true);
    await setFlag(SETTING_KEYS.IPLIK_ENABLED, false);
    const today = factoryYmd();

    // ── fikstür: A (%5, 1000 m) T1'de 190 m top → bitiş · B (NULL, 500 m) T2'de 100 m top → bitiş ·
    //    C (%5, 1000 m) T1'de 50 m top + elle 10 m/9 m kumaş, AÇIK · D (%5, 300 m) T2'de tüketimsiz AÇIK
    const A = await sar(1000, spec5.id);
    await mountBeam(A, { machineId: t1.id, position: 1 });
    const rollA = await top(t1.id, 190);
    const consA = await prisma.warpBeamEvent.findMany({ where: { beamId: A, kind: "CONSUMED" }, select: { lengthM: true, fabricLengthM: true, rollId: true } });
    check("§0 fikstür: A'ya otomatik CONSUMED 200 m çözgü / 190 m kumaş (rollId dolu)", consA.length === 1 && consA[0]!.lengthM!.equals(200) && consA[0]!.fabricLengthM!.equals(190) && consA[0]!.rollId === rollA, JSON.stringify(consA));
    await exhaustBeam(A, { residualM: 800 });
    const B = await sar(500, specNull.id);
    await mountBeam(B, { machineId: t2.id, position: 1 });
    await top(t2.id, 100);
    await exhaustBeam(B, { residualM: 400 });
    const C = await sar(1000, spec5.id);
    await mountBeam(C, { machineId: t1.id, position: 1 });
    await top(t1.id, 50);
    await consumeBeam(C, { lengthM: 10, lengthSource: "ESTIMATED", fabricLengthM: 9 });
    const Dm = await sar(300, spec5.id);
    await mountBeam(Dm, { machineId: t2.id, position: 1 });

    console.log("\n── §1 Levent sonucu: beklenen · gerçek · fire ──");
    const r5 = (await beamResultReport({ from: today, to: today, warpSpecId: spec5.id })).data;
    const a = r5.kapananlar.find((r) => r.beamId === A);
    check("§1a ⭐ A beklenen 950 (1000 × (1 − 0,05))", near(a?.beklenenKumasM, 950), `${a?.beklenenKumasM}`);
    check("§1b ⭐ A gerçek 190 = otomatik 190 + elle 0 (kırılım ayrı)", near(a?.gercekKumasM, 190) && near(a?.gercekKaynak.otomatik, 190) && near(a?.gercekKaynak.elle, 0), JSON.stringify(a?.gercekKaynak));
    check("§1c ⭐ A fire 760 m · %80", near(a?.fireM, 760) && near(a?.firePct, 80), `${a?.fireM} / ${a?.firePct}`);
    check("§1d A satır alanları: sarılan 1000, kalan 0, EXHAUSTED, kapanış damgası, tezgah T1, kg kaynağı", a?.sarilanM === 1000 && a?.kalanM === 0 && a?.status === "EXHAUSTED" && a?.kapanisAt instanceof Date && a?.tezgahlar.join() === t1.code && a?.kgKaynak === "THEORETICAL" && a?.sarilanKg !== null, JSON.stringify({ s: a?.sarilanM, k: a?.kalanM, t: a?.tezgahlar, kg: a?.kgKaynak }));
    check("§1e ⭐ özet (çözgü %5 süzgeci): 1 levent · beklenen 950 · gerçek 190 · fire 760 · %80 · ölçülemedi 0", r5.ozet.leventSayisi === 1 && near(r5.ozet.beklenenM, 950) && near(r5.ozet.gercekM, 190) && near(r5.ozet.fireM, 760) && near(r5.ozet.firePct, 80) && r5.ozet.olculemedi === 0, JSON.stringify(r5.ozet));
    check("§1f H5: düzeltilmemiş topla `meta.duzeltilmisTop` 0", r5.meta.duzeltilmisTop === 0, `${r5.meta.duzeltilmisTop}`);
    await prisma.roll.update({ where: { id: rollA }, data: { initialQty: 185, currentQty: 185 } });
    const r5b = (await beamResultReport({ from: today, to: today, warpSpecId: spec5.id })).data;
    check("§1g ⭐ H5: top metresi sonradan 185'e değişti → tüketim 190'da donar, `meta.duzeltilmisTop` 1 (beyan)", r5b.meta.duzeltilmisTop === 1 && near(r5b.kapananlar.find((r) => r.beamId === A)?.gercekKumasM, 190), `${r5b.meta.duzeltilmisTop}`);
    const dun = (await beamResultReport({ from: "1993-06-05", to: "1993-06-05", warpSpecId: spec5.id })).data;
    check("§1h pencere = kapanış günü: bugün kapanan levent geçmiş günün penceresinde YOK", !dun.kapananlar.some((r) => r.beamId === A), `${dun.kapananlar.length}`);

    console.log("\n── §2 take-up NULL → ölçülemedi ──");
    const rN = (await beamResultReport({ from: today, to: today, warpSpecId: specNull.id })).data;
    const b = rN.kapananlar.find((r) => r.beamId === B);
    check("§2a ⭐ B beklenen null, fire null, fire% null; gerçek yine 100", b?.beklenenKumasM === null && b?.fireM === null && b?.firePct === null && near(b?.gercekKumasM, 100), JSON.stringify({ be: b?.beklenenKumasM, f: b?.fireM }));
    check("§2b ⭐ özet `olculemedi` 1; beklenen/fire paydasına girmedi (0 / null)", rN.ozet.olculemedi === 1 && rN.ozet.beklenenM === 0 && rN.ozet.fireM === 0 && rN.ozet.firePct === null && near(rN.ozet.gercekM, 100), JSON.stringify(rN.ozet));

    console.log("\n── §3 Açık levent (kesit) ──");
    const c = r5.acikLeventler.find((r) => r.beamId === C);
    const d0 = r5.acikLeventler.find((r) => r.beamId === Dm);
    check("§3a ⭐ C açık: fire alanları null, kapanış null, durum MOUNTED", !!c && c.fireM === null && c.firePct === null && c.kapanisAt === null && c.status === "MOUNTED");
    const cKalan = 1000 - 50 / 0.95 - 10;
    check("§3b ⭐ C kullanimPct = (1000 − kalan) ÷ 1000 dolu", near(c?.kullanimPct, ((1000 - cKalan) / 1000) * 100) && near(c?.kalanM, cKalan, 0.002), `${c?.kullanimPct} · kalan ${c?.kalanM}`);
    check("§3c ⭐ C gerçek = otomatik 50 + elle 9 (tek sayıya çökmedi)", near(c?.gercekKaynak.otomatik, 50) && near(c?.gercekKaynak.elle, 9) && near(c?.gercekKumasM, 59), JSON.stringify(c?.gercekKaynak));
    check("§3d D (bağlı, tüketimsiz) açıkta; kapanmışlar listesinde değil; özet açık sayısı ≥ 2", !!d0 && !r5.kapananlar.some((r) => r.beamId === C || r.beamId === Dm) && r5.ozet.acikLeventSayisi >= 2);
    const rT2 = (await beamResultReport({ from: today, to: today, machineId: t2.id })).data;
    check("§3e tezgah süzgeci: T2 → B kapanan + D açık; A/C yok; seçenekler süzgeçten bağımsız (T1 de listede)", rT2.kapananlar.some((r) => r.beamId === B) && rT2.acikLeventler.some((r) => r.beamId === Dm) && ![...rT2.kapananlar, ...rT2.acikLeventler].some((r) => r.beamId === A || r.beamId === C) && rT2.meta.secenekler.machineId.some((o) => o.id === t1.id));

    console.log("\n── §4 Kapasite kullanımı ──");
    const k1 = (await capacityUsageReport({ from: today, to: today, machineId: t1.id })).data;
    const k1r = k1.satirlar[0];
    check("§4a ⭐ T1: nominal 600, atkı/cm 20 → teorik 18 m/sa", k1.satirlar.length === 1 && k1r?.nominalUnitsPerMin === 600 && k1r?.unitsPerCm === 20 && k1r?.teorikMSaat === 18, JSON.stringify(k1r));
    check("§4b ⭐ T1 takvim 24 sa (tek gün) · potansiyel 432 · gerçek 185 + 50 · kullanım %", k1r?.takvimSaat === 24 && k1r?.potansiyelM === 432 && near(k1r?.gercekM, 235) && near(k1r?.kullanimPct, (235 / 432) * 100), JSON.stringify({ t: k1r?.takvimSaat, p: k1r?.potansiyelM, g: k1r?.gercekM, u: k1r?.kullanimPct }));
    check("§4c hafta anahtarı YYYY-Www, başlangıç pazartesi ve bugünden büyük değil", /^\d{4}-W\d{2}$/.test(k1r?.hafta ?? "") && (k1r?.haftaBaslangic ?? "9") <= today && new Date(`${k1r?.haftaBaslangic}T00:00:00Z`).getUTCDay() === 1, `${k1r?.hafta} ${k1r?.haftaBaslangic}`);
    const k2 = (await capacityUsageReport({ from: today, to: today, machineId: t2.id })).data;
    const k2r = k2.satirlar[0];
    check("§4d ⭐ T2 nominal yok → teorik/potansiyel/kullanım null + gerekçe 'nominal yok'; gerçek 100 yine basılı", k2r?.nominalUnitsPerMin === null && k2r?.teorikMSaat === null && k2r?.potansiyelM === null && k2r?.kullanimPct === null && k2r?.hesaplanamadi === "nominal yok" && near(k2r?.gercekM, 100), JSON.stringify(k2r));
    check("§4e özet: hesaplanamayan satır oranın DIŞINDA, sayısı ve metresi ayrı", k2.ozet.hesaplanamadi === 1 && k2.ozet.kullanimPct === null && near(k2.ozet.hesaplanamayanGercekM, 100) && k1.ozet.hesaplanamadi === 0 && near(k1.ozet.kullanimPct, (235 / 432) * 100), JSON.stringify(k2.ozet));
    await prisma.machineRun.update({ where: { id: run.id }, data: { unitsPerCm: null } });
    const k1n = (await capacityUsageReport({ from: today, to: today, machineId: t1.id })).data.satirlar[0];
    check("§4f koşumda atkı/cm yok → 'atkı/cm yok', teorik null", k1n?.unitsPerCm === null && k1n?.teorikMSaat === null && k1n?.hesaplanamadi === "atkı/cm yok", JSON.stringify(k1n));
    await prisma.machineRun.update({ where: { id: run.id }, data: { unitsPerCm: 20 } });
    let rangeErr = "";
    try { await capacityUsageReport({ from: today, to: "1993-01-01" }); } catch (e) { rangeErr = (e as { details?: { code?: string } }).details?.code ?? String(e); }
    check("§4g ters aralık 400 INVALID_RANGE", rangeErr === "INVALID_RANGE", rangeErr);

    console.log("\n── §5 Levent bitiş tahmini ──");
    const f1 = (await finishForecastReport({ machineId: t1.id })).data;
    const fc = f1.satirlar.find((r) => r.beamId === C);
    const ort = (50 / 0.95 + 10) / 7;
    check("§5a ⭐ C günlük ort. = son 7 gün tüketimi ÷ 7 (otomatik + elle AYRI)", near(fc?.gunlukOrtM, ort, 0.002) && near(fc?.kaynak.otomatik, 50 / 0.95, 0.002) && near(fc?.kaynak.elle, 10), JSON.stringify(fc));
    const gun = Math.round((cKalan / Number(fc?.gunlukOrtM)) * 10) / 10;
    const bitis = new Date(`${today}T00:00:00Z`);
    bitis.setUTCDate(bitis.getUTCDate() + Math.ceil(gun));
    check("§5b ⭐ C kalan gün = kalan ÷ ort; bitiş günü = bugün + ⌈gün⌉ (fabrika günü)", fc?.kalanGun === gun && fc?.tahminiBitisGun === bitis.toISOString().slice(0, 10) && fc?.machine.code === t1.code && fc?.position === 1, `${fc?.kalanGun} → ${fc?.tahminiBitisGun}`);
    const f2 = (await finishForecastReport({ machineId: t2.id })).data;
    const fd = f2.satirlar.find((r) => r.beamId === Dm);
    check("§5c ⭐ D tüketim yok → ort/gün/bitiş null + gerekçe; kalan 300", fd?.gunlukOrtM === null && fd?.kalanGun === null && fd?.tahminiBitisGun === null && !!fd?.hesaplanamadi && fd?.kalanM === 300, JSON.stringify(fd));
    check("§5d kesit: bitmiş leventler (A, B) listede yok", !f1.satirlar.some((r) => r.beamId === A) && !f2.satirlar.some((r) => r.beamId === B));

    console.log("\n── §6 Ufuk ──");
    check("§6a ⭐ servis: üç raporda `meta.ufuk` = LOOM_HORIZON_DAY ve ufukOncesiSatir sayı", [r5.meta, k1.meta, f1.meta].every((m) => m.ufuk === LOOM_HORIZON_DAY && typeof m.ufukOncesiSatir === "number"), [r5.meta.ufuk, k1.meta.ufuk, f1.meta.ufuk].join(" · "));

    console.log("\n── §7 HTTP zarfı ──");
    const cred = await ensureTestAdmin({ password: kosumaOzguParola() });
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: cred.username, password: cred.password, clientType: "electron" }) });
    const lb = (await login.json()) as { data?: { token?: string } };
    const tok = lb.data?.token;
    check("§7z oturum açıldı (körlük zemini)", !!tok, `HTTP ${login.status}`);
    const get = async (path: string) => {
      const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${tok}` } });
      return { status: r.status, body: (await r.json()) as Record<string, any> };
    };
    const uclar = [
      `/api/reports/dokuma/levent-sonucu?from=${today}&to=${today}`,
      `/api/reports/dokuma/kapasite-kullanimi?from=${today}&to=${today}`,
      `/api/reports/dokuma/levent-bitis-tahmini`,
    ];
    for (const u of uclar) {
      const ad = u.split("/")[4]!.split("?")[0];
      const duz = await get(u);
      check(`§7a ⭐ ${ad}: 200, success, data.meta.ufuk, kökte suzgec YOK (süzgeçsiz)`, duz.status === 200 && duz.body.success === true && duz.body.data?.meta?.ufuk === LOOM_HORIZON_DAY && !("suzgec" in duz.body) && typeof duz.body.range === "object", `HTTP ${duz.status} ${JSON.stringify(duz.body).slice(0, 160)}`);
      const sz = await get(`${u}${u.includes("?") ? "&" : "?"}machineId=${t1.id}`);
      check(`§7b ⭐ ${ad}: süzgeçli → kökte suzgec.machineId + dusenSatir sayı`, sz.status === 200 && sz.body.suzgec?.machineId === t1.id && typeof sz.body.suzgec?.dusenSatir === "number", JSON.stringify(sz.body.suzgec));
      const yanlis = await get(`${u}${u.includes("?") ? "&" : "?"}tezgah=x`);
      check(`§7c ${ad}: tanınmayan parametre 400 (strict)`, yanlis.status === 400, `HTTP ${yanlis.status}`);
    }
    await setFlag(SETTING_KEYS.DEVERE_ENABLED, false);
    const kapaliL = await get(uclar[0]!);
    const kapaliB = await get(uclar[2]!);
    const kapaliK = await get(uclar[1]!);
    check("§7d ⭐ devere kapalı → levent uçları 403 MODULE_DISABLED; kapasite 200 (deverede değil)", kapaliL.status === 403 && kapaliL.body.details?.code === "MODULE_DISABLED" && kapaliB.status === 403 && kapaliK.status === 200, `${kapaliL.status}/${kapaliB.status}/${kapaliK.status} ${JSON.stringify(kapaliL.body).slice(0, 160)}`);
    await setFlag(SETTING_KEYS.DEVERE_ENABLED, true);
    await setFlag(SETTING_KEYS.DOKUMA_ENABLED, false);
    const kapaliD = await get(uclar[1]!);
    check("§7e dokuma kapalı → kapasite 403 MODULE_DISABLED", kapaliD.status === 403, `HTTP ${kapaliD.status}`);
  } finally {
    await new Promise<void>((res) => server.close(() => res()));
    const evIds = (await prisma.warpBeamEvent.findMany({ where: { beamId: { in: beamIds } }, select: { id: true } })).map((e) => e.id);
    await prisma.warpBeamEvent.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...beamIds, ...evIds] } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.doffEvent.deleteMany({ where: { machineId: { in: [t1.id, t2.id] } } });
    await prisma.machineRun.deleteMany({ where: { machineId: { in: [t1.id, t2.id] } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.warpSpec.deleteMany({ where: { id: { in: [spec5.id, specNull.id] } } });
    await prisma.item.deleteMany({ where: { id: { in: [yarn.id, fabric.id] } } });
    await prisma.subcontractor.delete({ where: { id: sub.id } }).catch(() => undefined);
    await prisma.machineSpec.deleteMany({ where: { machineId: { in: [t1.id, t2.id] } } });
    await prisma.machine.deleteMany({ where: { id: { in: [t1.id, t2.id] } } });
    await prisma.station.deleteMany({ where: { id: { in: [stDv.id, stLoom.id] } } });
    for (const key of FLAGS) {
      const eski = foto.find((f) => f.key === key);
      if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exitCode = 1;
});
