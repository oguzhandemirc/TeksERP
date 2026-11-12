// =============================================================================
// BEKÇİ — KAPALI RAPOR LİSTESİNDE EMEKLİ ANAHTAR (eski rapor kaldırma D5, 2026-11-12)
// Çalıştır: npx tsx scripts/test_rapor_emekli_anahtar.ts
// =============================================================================
// NEDEN: panel `reportsClosedKeys`i OLDUĞU GİBİ geri yazar. Eski rapor panelden kalkınca (v1 `emekli:true`)
// ya da katalogdan silinince listede kalan anahtar yazmayı 400 `REPORT_KEY_UNKNOWN`e düşürür ve Sistem →
// Modüller "Raporlar" aç/kapa düğmesi kırılır. Kural: emekli anahtar okumada AYIKLANIR, yazmada SESSİZCE
// DÜŞER; emekli kümesi kodda beyanlıdır (`DELETED_REPORT_KEYS` + `emekli:true`), tanınmayan YENİ anahtar 400.
//   §1 yüklem: emekli v1 satırı + silinmiş anahtar emekli; hazır v2 ve araç satırı DEĞİL
//   §2 yazma: emekli anahtar düşer, kalan saklanır (200) · tanınmayan anahtar yine 400 `REPORT_KEY_UNKNOWN`
//   §3 okuma: panele giden liste emekli ve katalog dışı anahtarı taşımaz (DB'de dursa da)
// Silinmiş anahtar sondası: `DELETED_REPORT_KEYS` koşum süresince bir sonda anahtarıyla genişletilir, finally'de geri.
// NEGATİF SONDA (2026-11-12, md5 ile geri alındı): yazmadaki emekli süzgeci kaldırıldı → ❌ §2a · okumadaki süzgeç
//   kaldırıldı → ❌ §3a.
// ⚠️ DB'YE YAZAR (`reports.closedKeys` satırı) → `hedefDbEngeli()` ilk adım; satır birebir geri yüklenir.
// =============================================================================
import prisma from "../src/lib/prisma";
import { Prisma } from "@prisma/client";
import { DELETED_REPORT_KEYS, REPORT_CATALOG, isRetiredReportKey } from "../src/constants/report-catalog";
import { systemSettingService } from "../src/services/system-setting.service";
import { getFeatureFlags, invalidateFeatureFlagsCache } from "../src/services/system-setting/feature-flags-read";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const KEY = "reports.closedKeys";
const PROBE = "sales/__silinmis-sonda__";

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(engel);
    process.exitCode = 1;
    return;
  }
  const deleted = DELETED_REPORT_KEYS as string[];
  const original = await prisma.systemSetting.findUnique({ where: { key: KEY }, select: { value: true } });
  deleted.push(PROBE);
  try {
    // §1 yüklem
    const ready = REPORT_CATALOG.find((e) => e.nesil === "v2" && e.hazir)!;
    const tool = REPORT_CATALOG.find((e) => e.nesil === "v1" && e.yeniHali.tur !== "birlesti" && !e.emekli)!;
    const retiredRow = REPORT_CATALOG.find((e) => e.nesil === "v1" && e.emekli);
    check("§1a silinmiş anahtar emekli; hazır v2 ve araç satırı emekli DEĞİL",
      isRetiredReportKey(PROBE) && !isRetiredReportKey(ready.key) && !isRetiredReportKey(tool.key) && !isRetiredReportKey("yok/boyle-rapor"),
      `v2 ${ready.key} · araç ${tool.key}`);
    check("§1b `emekli:true` v1 satırı emekli sayılır (satır varsa)", retiredRow ? isRetiredReportKey(retiredRow.key) : true,
      retiredRow ? retiredRow.key : "henüz emekli satır yok (yalnız silinmiş anahtar sondası)");

    const admin = await ensureTestAdmin();
    // §2 yazma
    const retired = [PROBE, ...(retiredRow ? [retiredRow.key] : [])];
    let wroteOk = true;
    try {
      await systemSettingService.setFeatureFlags({ reportsClosedKeys: [ready.key, ...retired] }, admin.id);
    } catch (e) {
      wroteOk = false;
      console.log(`   yazma hatası: ${(e as Error).message}`);
    }
    const stored = await prisma.systemSetting.findUnique({ where: { key: KEY }, select: { value: true } });
    check("§2a ⭐ emekli anahtar yazmada SESSİZCE düşer, kalan saklanır (400 yok)",
      wroteOk && JSON.stringify(stored?.value) === JSON.stringify([ready.key]), `saklanan ${JSON.stringify(stored?.value)}`);
    let code: unknown = null;
    try {
      await systemSettingService.setFeatureFlags({ reportsClosedKeys: [ready.key, "yok/boyle-rapor"] }, admin.id);
    } catch (e) {
      code = (e as { details?: { code?: unknown } }).details?.code ?? null;
    }
    check("§2b ⭐ tanınmayan YENİ anahtar yine 400 `REPORT_KEY_UNKNOWN` (fail-closed bozulmaz)", code === "REPORT_KEY_UNKNOWN", `code=${String(code)}`);

    // §3 okuma: DB'ye doğrudan bayat liste koy (eski sürümün bıraktığı hâl).
    await prisma.systemSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: [ready.key, ...retired, "yok/boyle-rapor"] },
      update: { value: [ready.key, ...retired, "yok/boyle-rapor"] },
    });
    invalidateFeatureFlagsCache();
    const read = (await getFeatureFlags()).data?.reportsClosedKeys ?? null;
    check("§3a ⭐ panele giden liste emekli ve katalog dışı anahtarı taşımaz", JSON.stringify(read) === JSON.stringify([ready.key]), `okunan ${JSON.stringify(read)}`);
  } finally {
    deleted.splice(deleted.indexOf(PROBE), 1);
    if (original) await prisma.systemSetting.update({ where: { key: KEY }, data: { value: original.value === null ? Prisma.JsonNull : original.value } });
    else await prisma.systemSetting.deleteMany({ where: { key: KEY } });
    invalidateFeatureFlagsCache();
    const after = await prisma.systemSetting.findUnique({ where: { key: KEY }, select: { value: true } });
    check("§z satır ilk hâline döndü", JSON.stringify(after?.value ?? null) === JSON.stringify(original?.value ?? null));
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

void main().finally(() => prisma.$disconnect());
