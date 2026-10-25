// =============================================================================
// test_rapor_analiz_uctan_uca — "çözgü hatası gece vardiyasında mı fazla?" uçtan uca (R3-ANALIZ)
// =============================================================================
// §1 kapı (DB'siz): demo fikstürü yalnız `tekserp_<ad>_test`e yazar — saf kapı fabrika/üretim adlarını
//    keser; script kapıyı Prisma'yı yüklemeden ÖNCE sorar (kaynak sırası) ve fabrika adıyla koşunca
//    bağlanmadan 1 ile çıkar.
// §2 şablon (DB'siz): "Vardiyaya göre çözgü hatası" gövdesi tanım şemasından geçer; analiz bloğu
//    maruziyetli, izni `report:quality`.
// §3 demo (DB): fikstür iki kez → aynı sayılar (idempotent); şablon SISTEM satırı olarak uzlaşır,
//    ayrıntı gövdeyi döner, koşu analiz bloğunu hesaplar: Gece öne çıkar, "güçlü kanıt" (olasılık < 0,01).
// §4 küçük (DB): 9 çözgü kaydı → kanıt cümlesi YOK, örneklem uyarısı VAR ("güvenilir değil").
// §5 üretilen her cümle yasak sözcük listesinden geçer.
// NEGATİF SONDALAR (2026-10-25, md5 ile birebir geri alındı): script kapısı kaldırıldı → 2 ❌ ·
//   şablon koşu yolu kapatıldı (`rapor-kosu.service.ts`) → 1 ❌ (409, §3 koşulamaz).
// =============================================================================
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { demoTargetBlock } from "./lib/demo-db-gate";
import { DEMO_TAG, removeDemo, writeDemo, type DemoSummary } from "./lib/demo-rapor-veri";
import { SHIFT_WARP_TEMPLATE_KEY, SYSTEM_TEMPLATES } from "../src/services/reports/semantik/sistem-sablonlari";
import { checkReportDefinition } from "../src/services/reports/semantik/rapor-tanimi.schema";
import { reconcileReportDefinitionCatalog } from "../src/jobs/report-definition-catalog.job";
import { getDefinition } from "../src/services/rapor-tanimi.service";
import { runDefinition } from "../src/services/rapor-kosu.service";
import { yasakSozcukBul } from "../src/services/reports/anlati/yasak-sozcuk";
import type { AccessContext } from "../src/services/reports/semantik/izin";
import { MODULE_SETTING_KEY_BY_FLAG } from "../src/services/system-setting.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const ROOT = join(__dirname, "..");
const MONTH = "2096-02";
const GUARD_USER = "demo-rpr-bekci";

// --- §1 kapı -------------------------------------------------------------------------------
console.log("\n§1 demo fikstürünün hedef kapısı");
const url = (db: string) => `postgresql://u:p@127.0.0.1:1/${db}`;
for (const db of ["tekserp", "tekserp_prod", "adnansahin_db", "tekserp_fabrika_0923", "tekserp_r3analiz_test_eski", "postgres"]) {
  check(`§1 '${db}' reddedilir`, demoTargetBlock(url(db)) !== null);
}
check("§1 bozuk adres reddedilir", demoTargetBlock("bozuk") !== null && demoTargetBlock(undefined) !== null);
check("§1 'tekserp_r3analiz_test' kabul edilir", demoTargetBlock(url("tekserp_r3analiz_test")) === null);

const script = readFileSync(join(ROOT, "scripts/fixture-rapor-demo.ts"), "utf8");
const gateAt = script.search(/demoTargetBlock\(process\.env\.DATABASE_URL\)/);
const prismaAt = script.indexOf('import("../src/lib/prisma")');
check("§1 script kapıyı Prisma'yı yüklemeden önce sorar", gateAt > 0 && prismaAt > gateAt, `kapı @${gateAt}, prisma @${prismaAt}`);
check("§1 script Prisma'yı ve yazıcıyı statik içe aktarmaz", !/^import[^\n]*(src\/lib\/prisma|demo-rapor-veri)/m.test(script));
const run = spawnSync("npx", ["tsx", "scripts/fixture-rapor-demo.ts"], {
  cwd: ROOT,
  env: { ...process.env, DATABASE_URL: url("tekserp_fabrika_0923") },
  encoding: "utf8",
  timeout: 60_000,
});
check("§1 fabrika adıyla koşum bağlanmadan 1 ile çıkar", run.status === 1 && run.stderr.includes("DEMO-KAPI") && !/ECONNREFUSED|connect/i.test(run.stderr), `çıkış ${run.status}: ${run.stderr.trim().slice(-160)}`);

// --- §2 şablon -----------------------------------------------------------------------------
console.log("\n§2 sistem şablonu");
const template = SYSTEM_TEMPLATES.find((t) => t.anahtar === SHIFT_WARP_TEMPLATE_KEY);
check("§2 şablon kayıtlı", !!template && template.ad === "Vardiyaya göre çözgü hatası");
const tc = checkReportDefinition(template?.govde);
check("§2 şablon gövdesi tanım şemasından geçer", tc.gecerli, tc.gecerli ? "" : JSON.stringify(tc.hatalar));
if (tc.gecerli) {
  const blk = tc.govde.bloklar.find((b) => b.tur === "analiz");
  check("§2 analiz bloğu maruziyetli ki-kare (vardiya × çözgü)", blk?.tur === "analiz" && blk.yontem === "kiKare" && blk.x === "vardiya" && !!blk.maruziyet);
  check("§2 gereken izin kalite raporu", tc.gerekenIzinler.includes("report:quality") && template?.izin === "report:quality", tc.gerekenIzinler.join(","));
}

// --- §3–§4 DB ------------------------------------------------------------------------------
const sentences: string[] = [];
const snapshot = async () => ({
  top: await prisma.roll.count({ where: { barcode: { startsWith: DEMO_TAG } } }),
  hata: await prisma.rollError.count({ where: { roll: { barcode: { startsWith: DEMO_TAG } } } }),
});

async function analysisOf(definitionId: string, ctx: AccessContext, summary: DemoSummary) {
  const result = await runDefinition(
    definitionId,
    { parametreler: { donem: { baslangic: summary.aralik.dateFrom, bitis: summary.aralik.dateTo } }, yenile: true },
    ctx,
    { userId: ctx.userId, permissions: ctx.permissions },
  );
  const blk = result.bloklar.find((b) => b.tur === "analiz");
  const analysis = blk?.durum === "tamam" ? blk.analiz : undefined;
  const text = analysis?.sunum.anlati.map((a) => a.metin) ?? [];
  sentences.push(...text);
  return { result, analysis, text };
}

async function dbSections(): Promise<void> {
  console.log("\n§3 demo verisi → güçlü kanıt");
  const first = await writeDemo({ month: MONTH });
  const firstCounts = await snapshot();
  const second = await writeDemo({ month: MONTH });
  const secondCounts = await snapshot();
  check("§3 fikstür idempotent (iki koşum aynı özet)", JSON.stringify(first) === JSON.stringify(second), JSON.stringify(second.vardiya));
  check("§3 fikstür idempotent (DB sayıları aynı)", firstCounts.top === secondCounts.top && firstCounts.hata === secondCounts.hata && secondCounts.top === 336, JSON.stringify(secondCounts));
  const night = second.vardiya.find((v) => v.ad === "Gece")!;
  const morning = second.vardiya.find((v) => v.ad === "Sabah")!;
  check("§3 demo gece oranı sabahın ~2 katı", night.cozgu / night.metre > 1.8 * (morning.cozgu / morning.metre), JSON.stringify(second.vardiya));

  await reconcileReportDefinitionCatalog();
  const row = await prisma.reportDefinition.findUnique({ where: { key: SHIFT_WARP_TEMPLATE_KEY }, select: { id: true, kind: true, status: true, category: { select: { code: true } } } });
  check("§3 şablon SISTEM satırı, Kalite altında, yayında", row?.kind === "SISTEM" && row.status === "YAYINDA" && row.category.code === "kalite", JSON.stringify(row));
  if (!row) return;
  const user = await prisma.user.upsert({ where: { username: GUARD_USER }, update: {}, create: { username: GUARD_USER, passwordHash: "x", fullName: "Demo rapor bekçisi" }, select: { id: true } });
  const ctx: AccessContext = { userId: user.id, permissions: ["report:quality"], openModuleKeys: new Set(Object.values(MODULE_SETTING_KEY_BY_FLAG)) };
  const detail = await getDefinition(row.id, { userId: user.id, permissions: ["report:quality"] });
  check("§3 ayrıntı şablon gövdesini döner (kopyalanabilir)", detail.sablon && !!detail.govde && detail.duzenleyebilir === false);
  const denied = await getDefinition(row.id, { userId: user.id, permissions: ["report:sales"] }).then(() => false, () => true);
  check("§3 kalite izni yoksa şablon görünmez (404)", denied);

  const strong = await analysisOf(row.id, ctx, second);
  const stats = strong.analysis?.istatistik;
  const top = [...(stats?.gruplar ?? [])].sort((a, b) => (b.oran ?? 0) - (a.oran ?? 0))[0];
  check("§3 analiz bloğu hesaplandı", !!strong.analysis && !!stats, JSON.stringify(strong.result.bloklar.map((b) => [b.id, b.durum])));
  check("§3 olasılık < 0,01 ve uyarı yok", (stats?.kanitP ?? 1) < 0.01 && (stats?.uyarilar.length ?? 1) === 0, `kanitP ${stats?.kanitP}, uyarılar ${stats?.uyarilar}`);
  check("§3 en yüksek oran Gece", top?.ad === "Gece", JSON.stringify(stats?.gruplar?.map((g) => [g.ad, g.oran])));
  check("§3 cümle: Gece + güçlü kanıt + nedensellik notu", strong.text.some((t) => t.includes("Gece") && t.includes("güçlü kanıt") && t.includes("İlişki, nedeni göstermez.")), strong.text.join(" | "));
  const others = strong.result.bloklar.filter((b) => b.tur !== "analiz");
  check("§3 şablonun diğer blokları da hesaplandı (ısı haritası, tablo)", others.every((b) => b.durum === "tamam"), JSON.stringify(others.map((b) => [b.id, b.durum])));

  console.log("\n§4 9 kayıt → güvenilir değil");
  const small = await writeDemo({ month: MONTH, small: true });
  check("§4 küçük senaryo 9 çözgü", small.vardiya.reduce((s, v) => s + v.cozgu, 0) === 9, JSON.stringify(small.vardiya));
  const weak = await analysisOf(row.id, ctx, small);
  const ws = weak.analysis?.istatistik;
  check("§4 n = 9 ve örneklem uyarısı", ws?.n === 9 && (ws?.uyarilar.includes("azOrnek") ?? false), `n ${ws?.n}, uyarılar ${ws?.uyarilar}`);
  check("§4 kanıt cümlesi kurulmaz, uyarı cümlesi var", weak.text.some((t) => t.startsWith("Yalnız 9")) && !weak.text.some((t) => /güçlü kanıt|kanıt var/.test(t)), weak.text.join(" | "));
}

async function main(): Promise<void> {
  const block = hedefDbEngeli() ?? demoTargetBlock(process.env.DATABASE_URL);
  if (block) throw new Error(block);
  try {
    await dbSections();
  } finally {
    await removeDemo();
    await prisma.reportRun.deleteMany({ where: { user: { username: GUARD_USER } } });
    await prisma.user.deleteMany({ where: { username: GUARD_USER } });
  }
  console.log("\n§5 yasak sözcük");
  const dirty = sentences.filter((m) => yasakSozcukBul(m).length > 0);
  check("§5 analiz cümlelerinde formül dili yok", sentences.length >= 2 && dirty.length === 0, dirty.join(" | ") || `${sentences.length} cümle`);
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
