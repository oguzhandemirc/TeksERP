// =============================================================================
// BEKÇİ — BİLDİRİM S2: üretim · dokuma · kurşun · tambur · bakım olayları + duruş/teklif koşulları + özetler + K7
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_uretim
// =============================================================================
// NEDEN: S2 türleri (geniş katalog 2026-11-14) gerçek yazma yollarına bağlı olmalı; bağ kopunca bildirim sessizce
// kesilir ve hiçbir başka bekçi bunu görmez. Ölçülenler:
//   §0 AST — her OLAY türünün `src/`de TEK `emitNotification` literali `notification-sources/uretim.ts`te ve her yayma
//      fonksiyonu beklenen yazma yolu dosyasından çağrılıyor; özet/koşul türlerinde emit literali yok.
//   §1 DB (geri sarılan tx; global durum yazmaz) — arıza duruşu → `bakim.ariza`/`bakim.tamamlandi`, arıza olmayan kod
//      → satır YOK; levent gerçek yolu `applyWarpBeamEventTx` MOUNTED/EXHAUSTED; kurşun hedefe eşit → yok, farklı → var;
//      desen aynı kumaşta yazmaz, farklıda yazar; Tambur geri gönderimi.
//   §2 KOSUL — `overrideStopSourceDeps` sahte okuyucularla: modül/rejim kapalı → boş küme; tezgah sorgusu WEAVING süzgeçli;
//      istasyon sorgusu WEAVING dışı; uzun duruş arıza kodlu. Teklif süresi doldu: commit'li TEST- teklif + maliyet bayrağı
//      birebir geri yüklenir.
//   §3 özetler — beş kaynak kayıtlı; her biri gerçek DB'de bir tur (SQL geçerli, sonuç empty/emitted/no-window).
//   §4 K7 — modül kapalıyken tür görünmez (`canSeeNotificationType`).
// NEGATİF SONDA (2026-11-14): `machine-stop.service.ts`ten closeStopCore'daki `emitBreakdownClosedTx(...)` satırı silindi ⇒
//   §0b + §0b3 ❌; `stopFacts`taki `isBreakdownReason` süzgeci kaldırıldı ⇒ §1 "arıza olmayan kod" iki satırı ❌ (ikisi md5 ile geri alındı).
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { Prisma, StationKind, WarpBeamStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { walkTs } from "./lib/ts-tarama";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { readMaliyetEnabled } from "../src/services/system-setting/modules";
import { NOTIFICATION_CATALOG, NOTIFICATION_KINDS, type NotificationKind } from "../src/constants/notification-catalog";
import { canSeeNotificationType } from "../src/services/helpers/notification-visibility.helper";
import { applyWarpBeamEventTx } from "../src/services/helpers/warp-beam-event.helper";
import { KURSUN_PROPERTY_CODE } from "../src/services/helpers/quality-station.helper";
import {
  emitBreakdownClosedTx, emitBreakdownStopTx, emitKursunDeviationTx, emitRunPatternChangedTx, emitSendToDyeTx, isBreakdownReason,
} from "../src/services/notification-sources/uretim";
import { STOP_CONDITION_KINDS, openStopSubjects, overrideStopSourceDeps, type OpenStopRow } from "../src/services/notification-sources/uretim-kosul";
import { expiredQuoteSubjects } from "../src/services/notification-sources/teklif-kosul";
import { registerProductionDigestSources } from "../src/services/notification-sources/uretim-ozet";
import { digestStampKey, registeredDigestKinds, runDigestOnce } from "../src/jobs/notification-digest.job";
import { factoryDayStart } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

const S2_OLAY = [
  "bakim.ariza", "bakim.tamamlandi", "dokuma.levent-takildi", "dokuma.levent-bitti", "dokuma.desen-degisti",
  "kursun.gramaj-sapmasi", "tambur.yeniden-islem",
] as const satisfies readonly NotificationKind[];
const S2_KOSUL = [...STOP_CONDITION_KINDS, "teklif.suresi-doldu"] as const satisfies readonly NotificationKind[];
const S2_OZET = [
  "uretim.top-uretildi-ozet", "uretim.gun-sonu-ozet", "kalite.gunluk-ozet", "kursun.gunluk-ozet", "dokuma.vardiya-ozet",
] as const satisfies readonly NotificationKind[];

/** Yayma fonksiyonu → onu çağırması gereken yazma yolu dosyaları (src/ göreli). */
const CAGRI_YERLERI: Record<string, string[]> = {
  emitBreakdownStopTx: ["services/machine-stop.service.ts"],
  emitBreakdownClosedTx: ["services/machine-stop.service.ts"],
  emitWarpBeamEventTx: ["services/helpers/warp-beam-event.helper.ts"],
  emitRunPatternChangedTx: ["services/machine-run.service.ts"],
  emitKursunDeviationTx: ["services/helpers/kursun-operation.helper.ts"],
  emitSendToDyeTx: ["services/tambur-manual.service.ts"],
};
/** machine-stop.service'te bakim.ariza'nın üç yolu (sebepli açılış · ilk sınıflama · arızaya yeniden sınıflama). */
const ARIZA_FONKSIYONLARI = ["openStopCore", "classifyStop", "reclassifyStop"];

// ── §0 AST ──────────────────────────────────────────────────────────────────
function bolum0(): void {
  console.log("\n§0 AST — tek yayma noktası + çağrı yerleri");
  const SRC = join(__dirname, "..", "src");
  const literaller = new Map<string, string[]>();
  const cagrilar = new Map<string, Set<string>>();
  const arizaIcinde = new Set<string>();
  const kapanisIcinde = new Set<string>();
  for (const f of walkTs(SRC)) {
    const rel = relative(SRC, f).split(sep).join("/");
    const sf = ts.createSourceFile(rel, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
    const gez = (n: ts.Node, fn: string | null): void => {
      const ad0 = ts.isFunctionDeclaration(n) && n.name ? n.name.text : fn;
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const ad = n.expression.text;
        if (ad === "emitNotification") {
          const a = n.arguments[1];
          if (a && ts.isStringLiteral(a)) literaller.set(a.text, [...(literaller.get(a.text) ?? []), rel]);
        }
        if (ad in CAGRI_YERLERI) cagrilar.set(ad, (cagrilar.get(ad) ?? new Set()).add(rel));
        if (rel === "services/machine-stop.service.ts" && ad0) {
          if (ad === "emitBreakdownStopTx") arizaIcinde.add(ad0);
          if (ad === "emitBreakdownClosedTx") kapanisIcinde.add(ad0);
        }
      }
      ts.forEachChild(n, (c) => gez(c, ad0));
    };
    gez(sf, null);
  }
  const KAYNAK = "services/notification-sources/uretim.ts";
  const ihlal = S2_OLAY.filter((k) => JSON.stringify(literaller.get(k)) !== JSON.stringify([KAYNAK]))
    .map((k) => `${k}: ${JSON.stringify(literaller.get(k) ?? [])}`);
  check("§0a ⭐ her S2 OLAY türünün TEK emit literali notification-sources/uretim.ts", ihlal.length === 0, ihlal.join(" · ") || `${S2_OLAY.length} tür`);
  const eksik = Object.entries(CAGRI_YERLERI).flatMap(([fn, dosyalar]) => dosyalar.filter((d) => !cagrilar.get(fn)?.has(d)).map((d) => `${fn} ← ${d}`));
  check("§0b ⭐ her yayma fonksiyonu yazma yolundan çağrılıyor", eksik.length === 0, eksik.join(" · ") || `${Object.keys(CAGRI_YERLERI).length} fonksiyon`);
  const arizaEksik = ARIZA_FONKSIYONLARI.filter((f) => !arizaIcinde.has(f));
  check("§0b2 bakim.ariza üç duruş yolundan (openStopCore · classifyStop · reclassifyStop)", arizaEksik.length === 0, arizaEksik.join(", ") || "3 yol");
  check("§0b3 bakim.tamamlandi closeStopCore ana kapanışından", kapanisIcinde.has("closeStopCore"), [...kapanisIcinde].join(", "));
  check("§0c özet türleri `ozet` beyanlı, koşul türleri `kosul` beyanlı; ikisinde de emit literali yok",
    S2_OZET.every((k) => "ozet" in NOTIFICATION_CATALOG[k] && !literaller.has(k))
    && S2_KOSUL.every((k) => !literaller.has(k)));
  check("§0d S2 türlerinin hepsi katalogda", [...S2_OLAY, ...S2_KOSUL, ...S2_OZET].every((k) => NOTIFICATION_KINDS.includes(k)));
  check("§0e arıza kümesi tek yüklem (MEKANIK/ELEKTRIK/JAKAR arıza; kopuş/elektrik kesintisi değil)",
    isBreakdownReason("MEKANIK_ARIZA") && isBreakdownReason("JAKAR_ARIZA") && !isBreakdownReason("ELEKTRIK_KESINTISI") && !isBreakdownReason(null));
}

// ── §1 DB (geri sarılan tx) ─────────────────────────────────────────────────
class GeriSar extends Error {}
const ek = Date.now().toString(36);

async function bolum1(): Promise<void> {
  console.log("\n§1 olay → outbox (tek tx, sonda geri sarılır)");
  const sonuc: Array<[string, boolean, string]> = [];
  try {
    await prisma.$transaction(async (tx) => {
      for (const key of [SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, SETTING_KEYS.DEVERE_ENABLED]) {
        await tx.systemSetting.upsert({ where: { key }, create: { key, value: true }, update: { value: true } });
      }
      const t0 = new Date(Date.now() - 1000);
      const u = await tx.user.create({ data: { username: `tbu_${ek}`, fullName: `TEST-BU Ali ${ek}`, passwordHash: "x" }, select: { id: true } });
      const satir = (kind: string, subjectId: string) => tx.notificationOutbox.findMany({ where: { kind, subjectId, createdAt: { gte: t0 } }, select: { payload: true } });
      const olc = async (label: string, kind: string, subjectId: string, beklenen: number, ek2?: (p: Record<string, unknown>) => boolean): Promise<void> => {
        const rows = await satir(kind, subjectId);
        const p = (rows[0]?.payload ?? {}) as Record<string, unknown>;
        sonuc.push([label, rows.length === beklenen && (ek2 && beklenen > 0 ? ek2(p) : true), `${rows.length} satır ${JSON.stringify(p).slice(0, 120)}`]);
      };

      const st = await tx.station.create({ data: { code: `TBU-${ek}`.slice(0, 32), name: `TEST-BU İstasyon ${ek}`, type: "INTERNAL", kind: StationKind.WEAVING }, select: { id: true } });
      const m = await tx.machine.create({ data: { stationId: st.id, code: `TBU-${ek}`.slice(0, 32), name: `TEST-BU Tezgah ${ek}` }, select: { id: true } });
      const now = new Date();
      const stop = (reasonCode: string, endedAt: Date | null) => tx.machineStopEvent.create({
        data: { machineId: m.id, stopKey: randomUUID(), startedAt: new Date(now.getTime() - 600_000), endedAt, durationSec: endedAt ? 600 : null, reasonCode, lossClass: "UNPLANNED", factoryDay: new Date(factoryDayStart(now).toISOString().slice(0, 10) + "T00:00:00Z"), source: "OPERATOR" },
        select: { id: true },
      });
      const ariza = await stop("MEKANIK_ARIZA", now);
      await emitBreakdownStopTx(tx, ariza.id, u.id);
      await olc("bakim.ariza arıza kodunda yazılır", "bakim.ariza", ariza.id, 1, (p) => p.sebep === "Mekanik arıza" && p.kullanici === `TEST-BU Ali ${ek}`);
      await emitBreakdownClosedTx(tx, ariza.id, u.id);
      await olc("bakim.tamamlandi süreyle yazılır", "bakim.tamamlandi", ariza.id, 1, (p) => p.sureDk === 10);
      const kopus = await stop("ELEKTRIK_KESINTISI", now);
      await emitBreakdownStopTx(tx, kopus.id, u.id);
      await emitBreakdownClosedTx(tx, kopus.id, u.id);
      await olc("⭐ arıza olmayan kodda bakim.ariza YOK", "bakim.ariza", kopus.id, 0);
      await olc("⭐ arıza olmayan kodda bakim.tamamlandi YOK", "bakim.tamamlandi", kopus.id, 0);

      // Levent: gerçek yol `applyWarpBeamEventTx` (claim + defter + bildirim aynı tx).
      const yarn = await tx.item.create({ data: { code: `TBU-Y-${ek}`, name: `TEST-BU İplik ${ek}`, itemType: "YARN" }, select: { id: true } });
      const spec = await tx.warpSpec.create({ data: { code: `TBU-${ek}`.slice(0, 32), name: `TEST-BU Çözgü ${ek}`, yarnItemId: yarn.id, endsCount: 100 }, select: { id: true } });
      const beam = await tx.warpBeam.create({ data: { beamNo: `TBU-${ek}`.slice(0, 32), warpSpecId: spec.id, status: WarpBeamStatus.READY, plannedLengthM: new Prisma.Decimal(100) }, select: { id: true } });
      await applyWarpBeamEventTx(tx, { beamId: beam.id, kind: "MOUNTED", from: WarpBeamStatus.READY, to: WarpBeamStatus.MOUNTED, data: { machineId: m.id, mountPosition: 1, createdById: u.id }, place: { currentMachineId: m.id, currentPosition: 1 } });
      await olc("⭐ levent takıldı (gerçek yol)", "dokuma.levent-takildi", beam.id, 1, (p) => p.tezgahAd === `TEST-BU Tezgah ${ek}`);
      await applyWarpBeamEventTx(tx, { beamId: beam.id, kind: "EXHAUSTED", from: WarpBeamStatus.MOUNTED, to: WarpBeamStatus.EXHAUSTED, data: { machineId: m.id, createdById: u.id }, place: { currentMachineId: null, currentPosition: null } });
      await olc("levent bitti (gerçek yol)", "dokuma.levent-bitti", beam.id, 1);

      // Desen: aynı kumaş yazmaz, farklı kumaş yazar.
      const k1 = await tx.item.create({ data: { code: `TBU-K1-${ek}`, name: `TEST-BU Kumaş1 ${ek}`, itemType: "FABRIC" }, select: { id: true } });
      const k2 = await tx.item.create({ data: { code: `TBU-K2-${ek}`, name: `TEST-BU Kumaş2 ${ek}`, itemType: "FABRIC" }, select: { id: true } });
      await emitRunPatternChangedTx(tx, { machineId: m.id, from: { itemId: k1.id, colorId: null }, to: { itemId: k1.id, colorId: null } }, u.id);
      await olc("desen aynı kumaşta yazılmaz", "dokuma.desen-degisti", m.id, 0);
      await emitRunPatternChangedTx(tx, { machineId: m.id, from: { itemId: k1.id, colorId: null }, to: { itemId: k2.id, colorId: null } }, u.id);
      await olc("desen farklı kumaşta yazılır", "dokuma.desen-degisti", m.id, 1, (p) => p.eskiKumas === `TEST-BU Kumaş1 ${ek}` && p.yeniKumas === `TEST-BU Kumaş2 ${ek}`);

      // Kurşun: İE hedefi (KURSUN varyantı) = basılan → yok; farklı → var.
      const base = await tx.fabricProperty.upsert({ where: { code: KURSUN_PROPERTY_CODE }, create: { code: KURSUN_PROPERTY_CODE, name: "Kurşun" }, update: {}, select: { id: true } });
      const variant = (await tx.fabricProperty.findFirst({ where: { variantOfPropertyId: base.id }, select: { id: true } }))
        ?? (await tx.fabricProperty.create({ data: { code: `TBU-V-${ek}`.slice(0, 32), name: `TEST-BU Gramaj ${ek}`, variantOfPropertyId: base.id }, select: { id: true } }));
      const v1 = await tx.fabricPropertyValue.create({ data: { propertyId: variant.id, code: `TBU1-${ek}`.slice(0, 32), name: "120 gr" }, select: { id: true } });
      const v2 = await tx.fabricPropertyValue.create({ data: { propertyId: variant.id, code: `TBU2-${ek}`.slice(0, 32), name: "140 gr" }, select: { id: true } });
      const wo = await tx.workOrder.create({ data: { workOrderNumber: `TEST-BU-${ek}`, type: "STOCK_PRODUCTION", targetItemId: k1.id }, select: { id: true } });
      const step = await tx.workOrderStep.create({ data: { workOrderId: wo.id, stationId: st.id, stepSequence: 1 }, select: { id: true } });
      await tx.workOrderTargetValue.create({ data: { workOrderId: wo.id, propertyId: variant.id, valueId: v1.id } });
      await emitKursunDeviationTx(tx, { rollId: randomUUID(), stepId: step.id, valueId: v1.id }, u.id);
      await olc("⭐ kurşun hedefe eşit → sapma yok", "kursun.gramaj-sapmasi", wo.id, 0);
      await emitKursunDeviationTx(tx, { rollId: randomUUID(), stepId: step.id, valueId: v2.id }, u.id);
      await olc("⭐ kurşun hedeften farklı → sapma", "kursun.gramaj-sapmasi", wo.id, 1, (p) => p.gramaj === "140 gr" && p.hedef === "120 gr");

      await emitSendToDyeTx(tx, { workOrderId: wo.id, workOrderNumber: `TEST-BU-${ek}`, rollBarcode: "TBU-TOP", targetStationName: "Boya", reason: "  renk tutmadı  " }, u.id);
      await olc("tambur yeniden işlem", "tambur.yeniden-islem", wo.id, 1, (p) => p.sebep === "renk tutmadı" && p.istasyonAd === "Boya");

      // Bayrak kapalı → hiçbir OLAY yazılmaz.
      await tx.systemSetting.update({ where: { key: SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED }, data: { value: false } });
      const ariza2 = await stop("JAKAR_ARIZA", null);
      await emitBreakdownStopTx(tx, ariza2.id, u.id);
      await olc("gelen kutusu kapalıyken bakim.ariza yazılmaz", "bakim.ariza", ariza2.id, 0);
      throw new GeriSar();
    });
  } catch (e) {
    if (!(e instanceof GeriSar)) throw e;
  }
  for (const [l, ok, d] of sonuc) check(`§1 ${l}`, ok, d);
  const leftover = await prisma.station.count({ where: { code: { startsWith: "TBU-" } } });
  check("§1z geri sarma: test istasyonu kalıcı değil", leftover === 0, `${leftover}`);
}

// ── §2 KOSUL ────────────────────────────────────────────────────────────────
async function bolum2(): Promise<void> {
  console.log("\n§2 koşul kaynakları");
  const satir: OpenStopRow = { id: "s1", startedAt: new Date("2026-03-15T08:00:00Z"), reasonCode: "MEKANIK_ARIZA", reasonLabel: "Mekanik arıza", machineName: "T1", stationName: "Dokuma" };
  const sorgular: Array<{ before: Date; where: Prisma.MachineStopEventWhereInput }> = [];
  let modul = true;
  let rejim = { weaving: true, general: false };
  const NOW = new Date("2026-03-15T12:00:00Z").getTime();
  const geri = overrideStopSourceDeps({
    moduleOpen: async () => modul,
    regime: async () => rejim,
    openStops: async (before, where) => { sorgular.push({ before, where }); return [satir]; },
    params: () => ({ dakika: 15, saat: 2 }),
    now: () => NOW,
  });
  try {
    const js = (w: unknown) => JSON.stringify(w);
    const tezgah = await openStopSubjects("dokuma.tezgah-durdu");
    check("§2a ⭐ tezgah-durdu: WEAVING süzgeçli sorgu, eşik dakika", tezgah.length === 1 && tezgah[0]!.key === "s1" && js(sorgular.at(-1)!.where).includes(`"kind":"WEAVING"`) && sorgular.at(-1)!.before.getTime() === NOW - 15 * 60_000, js(sorgular.at(-1)));
    await openStopSubjects("uretim.istasyon-durdu");
    check("§2b istasyon-durdu: WEAVING DIŞI süzgeç", js(sorgular.at(-1)!.where).includes(`"not":"WEAVING"`), js(sorgular.at(-1)!.where));
    const uzun = await openStopSubjects("bakim.uzun-durus");
    check("§2c ⭐ uzun-durus: arıza kodlu süzgeç, eşik saat", uzun.length === 1 && js(sorgular.at(-1)!.where).includes("MEKANIK_ARIZA") && sorgular.at(-1)!.before.getTime() === NOW - 2 * 3_600_000, js(sorgular.at(-1)));
    rejim = { weaving: false, general: true };
    const n0 = sorgular.length;
    check("§2d dokumasız genel rejimde tezgah-durdu boş küme (sorgu yok)", (await openStopSubjects("dokuma.tezgah-durdu")).length === 0 && sorgular.length === n0);
    rejim = { weaving: false, general: false };
    check("§2e ⭐ duruş rejimi kapalı → üç tür de boş", (await Promise.all(STOP_CONDITION_KINDS.map((k) => openStopSubjects(k)))).every((r) => r.length === 0));
    rejim = { weaving: true, general: false };
    modul = false;
    check("§2f ⭐ modül kapalı → boş küme", (await openStopSubjects("bakim.uzun-durus")).length === 0);
  } finally {
    geri();
  }

  // Teklif süresi doldu — commit'li kayıt (global prisma okur); maliyet bayrağı birebir geri.
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU — ${engel}`);
  const key = SETTING_KEYS.MALIYET_ENABLED;
  const ilk = await prisma.systemSetting.findUnique({ where: { key } });
  const cust = await prisma.customer.create({ data: { code: `TEST-BU-${ek}`, name: `TEST-BU Müşteri ${ek}` }, select: { id: true } });
  const q = await prisma.salesQuote.create({
    data: { quoteNo: `TEST-BU-${ek}`.slice(0, 32), clientToken: randomUUID(), customerId: cust.id, status: "SENT", quoteDate: new Date("2001-01-01T00:00:00Z"), validUntilDate: new Date("2001-01-10T00:00:00Z"), currency: "TRY", fxRate: new Prisma.Decimal(1) },
    select: { id: true },
  });
  try {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: true }, update: { value: true } });
    if (await readMaliyetEnabled()) {
      const acik = await expiredQuoteSubjects();
      const bu = acik.find((s) => s.key === q.id);
      check("§2g ⭐ süresi dolmuş SENT teklif koşul kümesinde", !!bu && (bu.payload as Record<string, unknown>).musteriAd === `TEST-BU Müşteri ${ek}`, JSON.stringify(bu?.payload));
    } else {
      console.log("ℹ️ §2g atlandı — maliyet modülü lisans tavanıyla kapalı");
    }
    await prisma.systemSetting.update({ where: { key }, data: { value: false } });
    check("§2h maliyet modülü kapalı → teklif koşulu boş", (await expiredQuoteSubjects()).length === 0);
  } finally {
    await prisma.salesQuote.delete({ where: { id: q.id } });
    await prisma.customer.delete({ where: { id: cust.id } });
    await prisma.systemSetting.deleteMany({ where: { key } });
    if (ilk) await prisma.systemSetting.create({ data: { ...ilk, value: (ilk.value ?? Prisma.JsonNull) as Prisma.InputJsonValue } });
  }
}

// ── §3 özetler ──────────────────────────────────────────────────────────────
async function bolum3(): Promise<void> {
  console.log("\n§3 özet kaynakları");
  registerProductionDigestSources();
  check("§3a beş S2 özet kaynağı kayıtlı", S2_OZET.every((k) => registeredDigestKinds().includes(k)), registeredDigestKinds().join(","));
  const keys = [SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, ...S2_OZET.map(digestStampKey)];
  const ilk = await prisma.systemSetting.findMany({ where: { key: { in: keys } } });
  const t0 = new Date(Date.now() - 1000);
  try {
    await prisma.systemSetting.upsert({ where: { key: keys[0]! }, create: { key: keys[0]!, value: true }, update: { value: true } });
    for (const k of S2_OZET) {
      // Damga "eski pencere" → tur compute'u gerçekten koşturur (taban turu atlanır).
      const sk = digestStampKey(k);
      await prisma.systemSetting.upsert({ where: { key: sk }, create: { key: sk, value: "TEST-BU-eski" }, update: { value: "TEST-BU-eski" } });
      const r = await runDigestOnce(k);
      const izin: string[] = k === "dokuma.vardiya-ozet" ? ["empty", "emitted", "no-window"] : ["empty", "emitted"];
      check(`§3b ${k} turu hatasız (SQL geçerli)`, izin.includes(r), r);
    }
    const yazilan = await prisma.notificationOutbox.findMany({ where: { kind: { in: [...S2_OZET] }, createdAt: { gte: t0 } }, select: { id: true, payload: true } });
    check("§3c özet yükü tutar taşımaz", yazilan.every((r) => !Object.keys(r.payload as object).some((x) => /tutar|fiyat/i.test(x))), `${yazilan.length} satır`);
    await prisma.notificationOutbox.deleteMany({ where: { id: { in: yazilan.map((r) => r.id) } } });
  } finally {
    await prisma.systemSetting.deleteMany({ where: { key: { in: keys } } });
    for (const row of ilk) await prisma.systemSetting.create({ data: { ...row, value: (row.value ?? Prisma.JsonNull) as Prisma.InputJsonValue } });
  }
}

// ── §4 K7 ───────────────────────────────────────────────────────────────────
function bolum4(): void {
  console.log("\n§4 K7 modül kapısı");
  const viewer = { permissions: ["*"] };
  const gor = (kind: NotificationKind, modules: Record<string, boolean>) => canSeeNotificationType(viewer, kind, { modules, gates: {} });
  const ihlal = [...S2_OLAY, ...S2_KOSUL, ...S2_OZET].filter((k) => {
    const modul = (NOTIFICATION_CATALOG[k] as { modul?: string }).modul;
    return !modul || gor(k, { [modul]: false }) || !gor(k, { [modul]: true });
  });
  check("§4 ⭐ her S2 türü modülü kapalıyken görünmez, açıkken görünür", ihlal.length === 0, ihlal.join(", ") || "hepsi");
  check("§4b dokuma kapalıyken tezgah duruşu görünmez", !gor("dokuma.tezgah-durdu", { dokumaEnabled: false }));
}

async function main(): Promise<void> {
  console.log("=== Bildirim S2 — üretim · dokuma · kurşun · tambur · bakım ===");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU — ${engel}`);
  bolum0();
  bolum4();
  await bolum1();
  await bolum2();
  await bolum3();
}

main()
  .catch((e) => { fail++; console.error("❌ beklenmeyen hata:", e); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
