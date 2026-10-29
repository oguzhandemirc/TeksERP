// =============================================================================
// HİZMET VEREN AYAR PAKETİ — BEKÇİ (2026-10-29, DALGA2-HIZMET-TASARIM §4, §7, §8 H5)
// =============================================================================
// `scripts/hizmet-ayar-paketi.ts` varsayılan KURU KOŞUDUR: listeler, yazmaz.
//   ① SAF — plan yüklemi dört durumu doğru ayırıyor mu, paket tekil mi?
//   ② CANLI — kuru koşu `system_settings` ve `system_logs`ta 0 yazım mı?
//   ③ KULLANIM — `--apply` kullanıcısız ve bilinmeyen argüman çıkış 2, yazım 0 mı?
//   ④ UYGULAMA — bilinen bir anahtarla yazım yolu: değer tuttu mu, audit yazıldı mı,
//      yeniden okuma doğrulaması boş mu? (test DB'de; sonunda eski değer geri yazılır)
// Koşum: DATABASE_URL=<test DB> npx tsx scripts/test_hizmet_ayar_paketi.ts
// NEGATİF SONDA — 2026-10-29: kuru koşu dalına `systemSetting.updateMany({where:{}, data:{updatedAt}})`
// eklendi → çıkış 1 · 2 ❌ · §2c + §3c (taban 10/0); cp ile geri alındı.
// NEGATİF SONDA — 2026-10-29 (§4): `paketiYazVeDogrula` içindeki `setFeatureFlags` çağrısı
// kaldırıldı → 11/3, §4b + §4c + §4d kırmızı (taban 14/0); cp ile geri alındı.
// =============================================================================
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { HIZMET_AYAR_PAKETI, paketiYazVeDogrula, paketPlani, type PaketSatiri } from "./hizmet-ayar-paketi";
import { testActorId } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const BETIK = path.join(__dirname, "hizmet-ayar-paketi.ts");

function kos(args: string[]): { kod: number | null; cikti: string } {
  const r = spawnSync("npx", ["tsx", BETIK, ...args], { env: process.env, encoding: "utf8", timeout: 120_000 });
  return { kod: r.status, cikti: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Ayar tablosunun ve audit günlüğünün parmak izi: içerik + damga + satır sayısı. */
async function izAl(): Promise<string> {
  const ayar = await prisma.systemSetting.findMany({ orderBy: { key: "asc" } });
  const log = await prisma.systemLog.count();
  return JSON.stringify({ ayar, log });
}

function satir(p: Partial<PaketSatiri> & Pick<PaketSatiri, "anahtar" | "alan" | "hedef">): PaketSatiri {
  return { dilim: "T", ...p };
}

async function main(): Promise<void> {
  // ── §1 SAF ──
  const paket = [
    satir({ anahtar: "a.yok", alan: "aYok", hedef: true }),
    satir({ anahtar: "a.alansiz", alan: "aAlansiz", hedef: true }),
    satir({ anahtar: "a.ayni", alan: "aAyni", hedef: "OUT" }),
    satir({ anahtar: "a.degisir", alan: "aDegisir", hedef: 2 }),
  ];
  const plan = paketPlani({ aAyni: "OUT", aDegisir: null }, new Set(["a.alansiz", "a.ayni", "a.degisir"]), paket);
  check(
    "§1a plan dört durumu ayırıyor (ANAHTAR_YOK · ALAN_YOK · AYNI · DEGISECEK)",
    plan.map((p) => p.durum).join(",") === "ANAHTAR_YOK,ALAN_YOK,AYNI,DEGISECEK",
    plan.map((p) => p.durum).join(","),
  );
  const anahtarlar = HIZMET_AYAR_PAKETI.map((p) => p.anahtar);
  check("§1b paket anahtarları tekil", new Set(anahtarlar).size === anahtarlar.length, `${anahtarlar.length} satır`);
  const alanlar = HIZMET_AYAR_PAKETI.map((p) => p.alan);
  check("§1c paket alanları tekil", new Set(alanlar).size === alanlar.length);

  // ── §2 CANLI kuru koşu ──
  const engel = hedefDbEngeli();
  if (engel) {
    check("§2 hedef DB test DB'si", false, engel);
    return;
  }
  const once = await izAl();
  const kuru = kos([]);
  check("§2a kuru koşu çıkış 0", kuru.kod === 0, `kod=${kuru.kod} ${kuru.cikti.split("\n").slice(-3).join(" | ")}`);
  check("§2b kuru koşu 'yazılan 0' diyor", /KURU KOŞU — \d+ ayar değişecekti; yazılan 0/.test(kuru.cikti));
  check("§2c kuru koşu sonrası ayar + audit parmak izi AYNI (yazım 0)", (await izAl()) === once);
  const listelenen = HIZMET_AYAR_PAKETI.filter((p) => kuru.cikti.includes(p.anahtar)).length;
  check(
    "§2d kuru koşu paketin HER satırını listeliyor",
    listelenen === HIZMET_AYAR_PAKETI.length,
    `${listelenen}/${HIZMET_AYAR_PAKETI.length}`,
  );

  // ── §3 KULLANIM ──
  const kullanicisiz = kos(["--apply"]);
  check("§3a --apply kullanıcısız → çıkış 2", kullanicisiz.kod === 2, `kod=${kullanicisiz.kod}`);
  const yanlis = kos(["--uygula"]);
  check("§3b bilinmeyen argüman → çıkış 2", yanlis.kod === 2, `kod=${yanlis.kod}`);
  check("§3c kullanım hatalarından sonra parmak izi AYNI", (await izAl()) === once);

  // ── §4 UYGULAMA yolu (paket satırları henüz ANAHTAR_YOK — bugün var olan bir anahtarla ölçülür) ──
  const { systemSettingService, SETTING_KEYS } = await import("../src/services/system-setting.service");
  const kullanici = { id: await testActorId() };
  const deneme = [
    satir({ anahtar: SETTING_KEYS.FINANCE_AUTO_DRAFT_FROM_SHIPMENT_ENABLED, alan: "financeAutoDraftFromShipmentEnabled", hedef: true }),
  ];
  const bilinen = new Set<string>(Object.values(SETTING_KEYS));
  const eski = ((await systemSettingService.getFeatureFlags()).data as unknown as Record<string, unknown>)
    .financeAutoDraftFromShipmentEnabled;
  deneme[0].hedef = eski !== true;
  const planU = paketPlani(
    (await systemSettingService.getFeatureFlags()).data as unknown as Record<string, unknown>,
    bilinen,
    deneme,
  );
  check("§4a deneme satırı DEGISECEK", planU[0]?.durum === "DEGISECEK", planU[0]?.durum);
  const logOnce = await prisma.systemLog.count();
  try {
    const kalan = await paketiYazVeDogrula(planU, kullanici.id, deneme);
    check("§4b yeniden okuma doğrulaması boş (yazım tuttu)", kalan.length === 0, kalan.map((p) => p.durum).join(","));
    const okunan = ((await systemSettingService.getFeatureFlags()).data as unknown as Record<string, unknown>)
      .financeAutoDraftFromShipmentEnabled;
    check("§4c değer hedefe geçti", okunan === deneme[0].hedef, `${String(eski)} → ${String(okunan)}`);
    check("§4d audit satırı yazıldı", (await prisma.systemLog.count()) > logOnce);
  } finally {
    await systemSettingService.setFeatureFlags({ financeAutoDraftFromShipmentEnabled: eski === true }, kullanici.id);
  }
}

main()
  .catch((e) => {
    fail++;
    console.error(`❌ beklenmeyen hata: ${(e as Error).message}`);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
  });
