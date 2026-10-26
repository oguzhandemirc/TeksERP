// =============================================================================
// BEKÇİ — Etiket adedi KAYNAĞI: GLOBAL | STATION (2026-10-24)
// Çalıştır: npx tsx scripts/test_label_copies_source.ts
// =============================================================================
// Kural: akış etiketinin (top · kartela · çuval) adedi TEK çözücüden gelir
// (`services/helpers/label-copies.helper.ts`):
//   GLOBAL  → BUGÜNKÜ API davranışı aynen: istek varsa sessizce 1–5'e kırpılır,
//             yoksa/biçimsizse genel adet (`label.copies`). Eski `test_label_copies` değişmeden yeşil.
//   STATION → istek (1–5; dışı 400) > istasyon varsayılanı (aktif oturum) > genel adet.
// Varsayılan kaynak GLOBAL = bugünkü davranış (ölçüldü 2026-10-24; hiçbir istemci
// akış etiketine `copies` göndermiyordu ama uç kabul edip kırpıyordu).
//
// §1 saf çözücü (dört durum + sınır dışı 400) · §2 sorgu ayrıştırıcı
// §3 tek kaynak (statik): label.service akış yolları çözücüden geçer, okuyucuyu
//    doğrudan çağırmaz — denetleyici negatif sondayla kanıtlanır
// §4 varsayılan beyanları üç uçta birebir (backend · panel · tablet)
// §5 DB: servis yolu uçtan uca (GLOBAL kırpar · STATION istek/istasyon/genel ·
//    400 · toplu) + istasyon yazma doğrulaması + DB CHECK seddi
//
// NEGATİF SONDA (elle, 2026-10-24): STATION dalı `return globalCount` yapılınca §1c/§1d/§1g/§5c/§5d
// kırmızı; GLOBAL kırpma dalı `return globalCount` yapılınca §1a/§1b/§5a/§5b kırmızı;
// label.service'te bir yol `readLabelCopies()`e döndürülünce §3 kırmızı (§3b otomatik).
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import {
  assertStationDefaultLabelCopies,
  parseCopiesQuery,
  resolveLabelCopies,
} from "../src/services/helpers/label-copies.helper";
import { DEFAULT_LABEL_COPIES_SOURCE, LABEL_COPIES_MAX, SETTING_KEYS } from "../src/services/system-setting.service";
import { testActorId } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const KOK = join(__dirname, "..", "..");
const read = (rel: string): string => readFileSync(join(KOK, rel), "utf8");

function throws400(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: string } };
    return err.statusCode === 400 && err.details?.code === "LABEL_COPIES_RANGE";
  }
}

async function rejects400(p: Promise<unknown>): Promise<boolean> {
  try {
    await p;
    return false;
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: string } };
    return err.statusCode === 400 && err.details?.code === "LABEL_COPIES_RANGE";
  }
}

// ── §3 denetleyicisi: saf fonksiyon ki negatif sonda aynı kodu sınasın ──
const FLOW_FUNCS = [
  "buildRollRenderInput",
  "getBulkRollLabelsHtml",
  "getBulkRollLabelsNative",
  "buildSwatchRenderInput",
  "buildSackRenderInput",
];
function methodBody(src: string, name: string): string | null {
  const m = new RegExp(`\\n  (?:private )?async ${name}\\(`).exec(src);
  if (!m) return null;
  const next = /\n  (?:private )?async \w+\(/g;
  next.lastIndex = m.index + m[0].length;
  const n = next.exec(src);
  return src.slice(m.index, n ? n.index : undefined);
}
function tekKaynakIhlalleri(labelServiceSrc: string): string[] {
  const out: string[] = [];
  if (/\breadLabelCopies\b/.test(labelServiceSrc)) out.push("label.service readLabelCopies'i doğrudan anıyor");
  if (/\bclampRollCopies\b/.test(labelServiceSrc)) out.push("label.service clampRollCopies (eski kırpıcı) taşıyor");
  for (const f of FLOW_FUNCS) {
    const body = methodBody(labelServiceSrc, f);
    if (body === null) out.push(`${f} bulunamadı`);
    else if (!/resolveFlowLabelCopies\(/.test(body)) out.push(`${f} çözücüden geçmiyor`);
  }
  return out;
}

async function main(): Promise<void> {
  // ── §1 saf çözücü ──
  console.log("\n── §1 saf çözücü ──");
  check("§1a ⭐ GLOBAL: istek kabul (bugünkü API), istasyon varsayılanı YOK SAYILIR", resolveLabelCopies({ mode: "GLOBAL", globalCount: 2, stationDefault: 4, requested: 3 }) === 3);
  check("§1b ⭐ GLOBAL: sınır dışı istek 400 değil, sessizce kırpılır (99 → 5, 0 → 1)", resolveLabelCopies({ mode: "GLOBAL", globalCount: 2, requested: 99 }) === LABEL_COPIES_MAX && resolveLabelCopies({ mode: "GLOBAL", globalCount: 2, requested: 0 }) === 1);
  check("§1b2 GLOBAL: istek yok → genel adet (istasyon varsayılanı yok sayılır)", resolveLabelCopies({ mode: "GLOBAL", globalCount: 2, stationDefault: 4 }) === 2);
  check("§1b3 GLOBAL: biçimsiz istek (NaN) → genel adet (eski controller undefined sayardı)", resolveLabelCopies({ mode: "GLOBAL", globalCount: 2, requested: Number.NaN }) === 2);
  check("§1c ⭐ STATION: istek kabul", resolveLabelCopies({ mode: "STATION", globalCount: 2, stationDefault: 4, requested: 3 }) === 3);
  check("§1d ⭐ STATION: istek yok → istasyon varsayılanı", resolveLabelCopies({ mode: "STATION", globalCount: 2, stationDefault: 4 }) === 4);
  check("§1e ⭐ STATION: istek yok + istasyon tanımsız → genel adet", resolveLabelCopies({ mode: "STATION", globalCount: 2, stationDefault: null }) === 2);
  check("§1f STATION: bozuk istasyon değeri (9) → genel adet", resolveLabelCopies({ mode: "STATION", globalCount: 2, stationDefault: 9 }) === 2);
  check("§1g ⭐ STATION: 0 → 400 LABEL_COPIES_RANGE", throws400(() => resolveLabelCopies({ mode: "STATION", globalCount: 2, requested: 0 })));
  check(`§1h ⭐ STATION: ${LABEL_COPIES_MAX + 1} → 400 (kırpma yok)`, throws400(() => resolveLabelCopies({ mode: "STATION", globalCount: 2, requested: LABEL_COPIES_MAX + 1 })));
  check("§1i STATION: NaN (biçimsiz) → 400", throws400(() => resolveLabelCopies({ mode: "STATION", globalCount: 2, requested: Number.NaN })));
  check("§1j STATION: 2.5 → 400", throws400(() => resolveLabelCopies({ mode: "STATION", globalCount: 2, requested: 2.5 })));
  check(`§1k STATION: sınır ${LABEL_COPIES_MAX} kabul`, resolveLabelCopies({ mode: "STATION", globalCount: 2, requested: LABEL_COPIES_MAX }) === LABEL_COPIES_MAX);

  // ── §2 sorgu ayrıştırıcı ──
  console.log("\n── §2 ?copies= ayrıştırıcı ──");
  check("§2a yok → undefined", parseCopiesQuery(undefined) === undefined);
  check("§2b '3' → 3", parseCopiesQuery("3") === 3);
  check("§2c 'abc' / '-1' / dizi → NaN", [parseCopiesQuery("abc"), parseCopiesQuery("-1"), parseCopiesQuery(["2"])].every(Number.isNaN));

  // ── §3 tek kaynak ──
  console.log("\n── §3 tek kaynak (statik) ──");
  const labelSvc = read("Teks-Erp/src/services/label.service.ts");
  const ihlal = tekKaynakIhlalleri(labelSvc);
  check("§3a ⭐ label.service akış yollarının hepsi resolveFlowLabelCopies'ten geçer", ihlal.length === 0, ihlal.join(" · "));
  const sonda = labelSvc.replace(
    /const copies = await resolveFlowLabelCopies\(\{ requested: opts\?\.copies, deviceId: opts\?\.deviceId \}\);/,
    "const copies = opts?.copies ?? (await readLabelCopies());",
  );
  check("§3b NEGATİF SONDA: bir yolu okuyucuya döndüren kaynak yakalanır", sonda !== labelSvc && tekKaynakIhlalleri(sonda).length > 0);
  const ctrl = read("Teks-Erp/src/controllers/label.controller.ts");
  const ctrlFlow = ctrl.slice(0, ctrl.indexOf("listStandaloneTemplates = async"));
  check(
    "§3c controller akış uçları ?copies='yi ayrıştırıcıdan geçirir (sessiz parseInt yok)",
    !/parseInt\(req\.query\.copies/.test(ctrlFlow) && (ctrlFlow.match(/parseCopiesQuery\(req\.query\.copies\)/g) ?? []).length >= 7,
  );

  // ── §4 varsayılan beyanları ──
  console.log("\n── §4 varsayılan beyanları ──");
  check("§4a backend varsayılanı GLOBAL (bugünkü davranış)", DEFAULT_LABEL_COPIES_SOURCE === "GLOBAL");
  const panel = read("Electron/src/pages/GeneralSettings/LabelCopiesFields.tsx");
  check("§4b panel varsayılan beyanı birebir", /DEFAULT_LABEL_COPIES_SOURCE(?::\s*\w+)?\s*=\s*"GLOBAL"/.test(panel));
  const mobil = read("mobil/src/services/featureFlag.service.ts");
  check("§4c tablet fail-closed varsayılanı GLOBAL (seçici gizli = bugünkü ekran)", /labelCopiesSource:\s*'GLOBAL'/.test(mobil));

  // ── §5 DB ──
  console.log("\n── §5 DB (servis yolu) ──");
  const engel = hedefDbEngeli();
  if (engel) {
    check("§5 hedef kapısı", false, engel);
    return;
  }
  // Dinamik import: §1-§4 DB'siz koşsun diye servis zinciri burada yüklenir.
  const { LabelService } = await import("../src/services/label.service");
  const { InventoryService } = await import("../src/services/inventory.service");
  const svc = new LabelService();
  const ts = Date.now();
  const keys = [SETTING_KEYS.LABEL_COPIES, SETTING_KEYS.LABEL_COPIES_SOURCE];
  const once = await prisma.systemSetting.findMany({ where: { key: { in: keys } } });
  const cleanup: Array<() => Promise<unknown>> = [];
  const setSetting = (key: string, value: string | number) =>
    prisma.systemSetting.upsert({ where: { key }, create: { key, value, description: "test — etiket adedi kaynağı" }, update: { value } });
  const countLabels = (html: string) => (html.match(/class="label"/g) ?? []).length;

  try {
    const item = await prisma.item.create({
      data: { code: `TEST-ETADET-${ts}`, name: `TEST ETIKET ADET ${ts}`, itemType: "FABRIC", unit: "MT" },
      select: { id: true },
    });
    cleanup.push(() => prisma.item.delete({ where: { id: item.id } }));
    const inv = new InventoryService();
    const r1 = (await inv.createInitialEntry({ itemId: item.id, initialQty: 50 })).data as { id: string };
    const r2 = (await inv.createInitialEntry({ itemId: item.id, initialQty: 60 })).data as { id: string };
    cleanup.unshift(() => prisma.roll.deleteMany({ where: { id: { in: [r1.id, r2.id] } } }));

    const station = await prisma.station.create({
      data: { code: `TEST-EA-${ts % 1e8}`, name: `TEST Etiket Adet ${ts}`, type: "INTERNAL", defaultLabelCopies: 3 },
      select: { id: true },
    });
    cleanup.push(() => prisma.station.delete({ where: { id: station.id } }));
    const device = await prisma.device.create({
      data: { deviceId: `test-etadet-${ts}`, name: `TEST etiket adet ${ts}`, status: "APPROVED" },
      select: { id: true },
    });
    cleanup.unshift(() => prisma.device.delete({ where: { id: device.id } }));
    const userId = await testActorId();
    const session = await prisma.workSession.create({
      data: { userId, deviceId: device.id, stationId: station.id },
      select: { id: true },
    });
    cleanup.unshift(() => prisma.workSession.delete({ where: { id: session.id } }));

    await setSetting(SETTING_KEYS.LABEL_COPIES, 2);
    await setSetting(SETTING_KEYS.LABEL_COPIES_SOURCE, "GLOBAL");
    const g = await svc.getRollLabelHtml(r1.id, undefined, { copies: 4, deviceId: device.id });
    check("§5a ⭐ GLOBAL: istek 4 kabul (bugünkü API)", countLabels(g.data.html) === 4, `sayfa=${countLabels(g.data.html)}`);
    const gBig = await svc.getRollLabelHtml(r1.id, undefined, { copies: 99 });
    check("§5b ⭐ GLOBAL: sınır dışı istek 400 değil → 5'e kırpılır", countLabels(gBig.data.html) === LABEL_COPIES_MAX, `sayfa=${countLabels(gBig.data.html)}`);
    const gDef = await svc.getRollLabelHtml(r1.id, undefined, { deviceId: device.id });
    check("§5b2 GLOBAL: istek yok → genel 2 (oturum istasyonunun 3'ü yok sayılır)", countLabels(gDef.data.html) === 2, `sayfa=${countLabels(gDef.data.html)}`);

    await setSetting(SETTING_KEYS.LABEL_COPIES_SOURCE, "STATION");
    const s1 = await svc.getRollLabelHtml(r1.id, undefined, { copies: 4, deviceId: device.id });
    check("§5c ⭐ STATION: istek 4 kabul", countLabels(s1.data.html) === 4, `sayfa=${countLabels(s1.data.html)}`);
    const s2 = await svc.getRollLabelHtml(r1.id, undefined, { deviceId: device.id });
    check("§5d ⭐ STATION: istek yok → oturumun istasyonu (3) — eski tablet yolu", countLabels(s2.data.html) === 3, `sayfa=${countLabels(s2.data.html)}`);
    const s3 = await svc.getRollLabelHtml(r1.id, undefined, {});
    check("§5e STATION: cihaz/oturum yok (panel) → genel 2", countLabels(s3.data.html) === 2);
    check("§5f ⭐ STATION: istek 6 → 400 LABEL_COPIES_RANGE", await rejects400(svc.getRollLabelHtml(r1.id, undefined, { copies: 6 })));
    const bulk = await svc.getBulkRollLabelsHtml([r1.id, r2.id], { deviceId: device.id });
    check("§5g STATION: toplu baskı istasyon varsayılanıyla (2 top × 3)", countLabels(bulk.data.html) === 6, `sayfa=${countLabels(bulk.data.html)}`);
    await prisma.station.update({ where: { id: station.id }, data: { defaultLabelCopies: null } });
    const s4 = await svc.getRollLabelHtml(r1.id, undefined, { deviceId: device.id });
    check("§5h STATION: istasyon varsayılanı boş → genel 2", countLabels(s4.data.html) === 2);

    // İstasyon yazma yolu (BaseController — Zod'suz): servis doğrular, DB CHECK son kapı.
    check("§5i istasyon yazma: 7 → 400", throws400(() => assertStationDefaultLabelCopies({ defaultLabelCopies: 7 })));
    check("§5j istasyon yazma: '3' (metin) → 400", throws400(() => assertStationDefaultLabelCopies({ defaultLabelCopies: "3" })));
    const bos: Record<string, unknown> = { defaultLabelCopies: "" };
    assertStationDefaultLabelCopies(bos);
    check("§5k istasyon yazma: '' → null (genel adete dön)", bos.defaultLabelCopies === null);
    let checkErr = "";
    try {
      await prisma.$executeRawUnsafe(`UPDATE stations SET "defaultLabelCopies" = 9 WHERE id = $1::uuid`, station.id);
    } catch (e) {
      checkErr = String((e as Error).message);
    }
    check("§5l ⭐ DB CHECK stations_default_label_copies_range 9'u reddeder", /stations_default_label_copies_range|23514/.test(checkErr), checkErr.slice(0, 120));
  } finally {
    for (const c of cleanup) await c().catch((e) => console.error("temizlik:", (e as Error).message));
    // SystemSetting BİREBİR geri: önce yoksa sil, varsa eski değer.
    for (const key of keys) {
      const row = once.find((o) => o.key === key);
      if (row) await prisma.systemSetting.update({ where: { key }, data: { value: row.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
}

main()
  .catch((e) => {
    fail++;
    console.error(e);
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
