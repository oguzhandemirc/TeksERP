// =============================================================================
// SEYİTOĞLU AYAR PAKETİ — SY-L1 + SY-I1 (TASARIM-2026-10-31 §13, §10, §15.1)
// =============================================================================
// Lisans TAM paket (kullanıcı kararı 2026-10-31): yeni profil YOK, `tam` seçilir.
// Davranış ayarları profile GİRMEZ; bu paket §15.1'in Seyitoğlu değerlerini ve duruş
// kurulum verisini (sebep · vardiya · salon) BİLEREK uygular — `hizmet-ayar-paketi` emsali.
//
// Koşum (DATABASE_URL ortamdan):
//   tsx scripts/seyitoglu-ayar-paketi.ts                          → KURU KOŞU: listeler, 0 yazım
//   tsx scripts/seyitoglu-ayar-paketi.ts --apply --kullanici=<ad> → listeler, sonra yazar
// Kodda henüz olmayan ayar ANAHTAR_YOK ("ayar sonraki dilimde") diye ATLANIR; SY-D2/E1/J1/
// M1/F1 ve D4-G2b indikçe paket kendiliğinden kapsar. Anahtar gelip `alan` adı farklı
// yazılırsa ALAN_YOK → çıkış 1 (bekçi kırmızı): o dilim bu satırı da düzeltir.
// Çıkış: 0 tamam · 1 uygulanamadı · 2 kullanım.
// =============================================================================
import { hedefDbAdi } from "./lib/hedef-db-kapisi";
import { paketiYazVeDogrula, paketPlani, type PaketSatiri } from "./hizmet-ayar-paketi";
import { applySetup, planSetupFromDb, type SetupRow } from "./lib/seyitoglu-kurulum-verisi";

/**
 * §15.1 Seyitoğlu sütunu. `maliyet.verimlilik.sureKaynagi` İKİNCİ ayar olarak açılmaz
 * (§15.1 notu): Gülkesim D4-G2b'nin `maliyet.karlilik.makineSuresi` ayarı okunur, KOSUM = OTURUM.
 */
export const SEYITOGLU_SETTINGS: readonly PaketSatiri[] = [
  { anahtar: "maliyet.dokumaStandartYontemi", alan: "costWeavingStandardMethod", hedef: "ATKI_UCRETI", dilim: "SY-D2" },
  { anahtar: "maliyet.karlilik.makineSuresi", alan: "costProfitabilityMachineTime", hedef: "OTURUM", dilim: "D4-G2b" },
  // S5 cevabına kadar Excel uyumu (fabrika "ham tartı" derse NET_HAM'a çekilir).
  { anahtar: "maliyet.terbiyeKgTabani", alan: "costFinishingKgBasis", hedef: "IPLIK_TUKETIMI", dilim: "SY-E1" },
  { anahtar: "maliyet.sunumDovizi", alan: "costPresentationCurrency", hedef: "USD", dilim: "SY-J1" },
  { anahtar: "siparis.uretimOnerisi", alan: "orderProductionProposal", hedef: "ONIZLEME", dilim: "SY-M1" },
  { anahtar: "siparis.hedefDegerOnerisi", alan: "orderTargetValueSuggestion", hedef: "MUSTERI_SON", dilim: "SY-F1" },
];

/** TAM profilin Seyitoğlu için şart modülleri; kapalıysa uyarı (profil seçimi kurulumda). */
const REQUIRED_MODULES = ["dokumaEnabled", "tezgahEnabled", "devereEnabled", "iplikEnabled", "maliyetEnabled"] as const;

const SETUP_GROUP_LABEL: Record<SetupRow["group"], string> = {
  REASON_CATALOG: "sebep kataloğu",
  REASON: "duruş sebebi",
  SHIFT: "vardiya",
  HALL: "salon",
};

function show(v: unknown): string {
  return v === undefined ? "—" : JSON.stringify(v);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const username = args.find((a) => a.startsWith("--kullanici="))?.slice("--kullanici=".length);
  const unknownArgs = args.filter((a) => a !== "--apply" && !a.startsWith("--kullanici="));
  if (unknownArgs.length > 0 || (apply && !username)) {
    console.error("❌ kullanım: tsx scripts/seyitoglu-ayar-paketi.ts [--apply --kullanici=<kullanıcı adı>]");
    return 2;
  }
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL ortamda yok.");
    return 2;
  }
  const { default: prisma } = await import("../src/lib/prisma");
  const { systemSettingService, SETTING_KEYS } = await import("../src/services/system-setting.service");
  try {
    const flags = ((await systemSettingService.getFeatureFlags()).data ?? {}) as unknown as Record<string, unknown>;
    const plan = paketPlani(flags, new Set<string>(Object.values(SETTING_KEYS)), SEYITOGLU_SETTINGS);
    console.log(`=== Seyitoğlu ayar paketi — ${apply ? "UYGULAMA" : "KURU KOŞU"} ===`);
    console.log(`🎯 Hedef veritabanı: ${hedefDbAdi()}`);
    const closed = REQUIRED_MODULES.filter((m) => flags[m] !== true);
    console.log(closed.length === 0 ? "  Modüller: TAM profil şartları açık." : `⚠️  Kapalı modül: ${closed.join(", ")} — kurulumda profil "tam" seçilmeli.`);
    console.log("── Ayarlar (§15.1)");
    for (const p of plan) {
      const extra = p.durum === "ANAHTAR_YOK" ? ` (ayar sonraki dilimde: ${p.dilim})` : "";
      console.log(`  ${p.durum.padEnd(11)} ${p.anahtar}: ${show(p.mevcut)} → ${show(p.hedef)}${extra}`);
    }
    const setup = await planSetupFromDb();
    console.log("── Duruş kurulum verisi (SY-I1)");
    for (const r of setup) {
      console.log(`  ${r.action.padEnd(11)} ${SETUP_GROUP_LABEL[r.group]}: ${r.label}${r.note ? ` (${r.note})` : ""}`);
    }
    const fieldMissing = plan.filter((p) => p.durum === "ALAN_YOK");
    if (fieldMissing.length > 0) {
      console.error(`❌ paket ↔ servis ayrışmış (alan yok): ${fieldMissing.map((p) => `${p.anahtar}→${p.alan}`).join(", ")}`);
      return 1;
    }
    const changing = plan.filter((p) => p.durum === "DEGISECEK");
    const creating = setup.filter((r) => r.action === "CREATE");
    if (!apply) {
      console.log(
        `KURU KOŞU — ${changing.length} ayar değişecekti, ${creating.length} kurulum kaydı yaratılacaktı; yazılan 0. Uygulamak için --apply --kullanici=<ad>.`,
      );
      return 0;
    }
    if (changing.length === 0 && creating.length === 0) {
      console.log("Yazılacak ayar ya da kayıt yok; yazılan 0.");
      return 0;
    }
    const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (!user) {
      console.error(`❌ kullanıcı bulunamadı: ${username}`);
      return 1;
    }
    if (changing.length > 0) {
      const left = await paketiYazVeDogrula(changing, user.id, SEYITOGLU_SETTINGS);
      if (left.length > 0) {
        console.error(`❌ yazım tutmadı (yeniden okumada farklı): ${left.map((p) => p.anahtar).join(", ")}`);
        return 1;
      }
    }
    const written = await applySetup(setup, user.id);
    const after = (await planSetupFromDb()).filter((r) => r.action === "CREATE");
    if (after.length > 0) {
      console.error(`❌ kurulum kaydı tutmadı: ${after.map((r) => r.label).join(", ")}`);
      return 1;
    }
    console.log(`✅ ${changing.length} ayar + ${written} kurulum kaydı yazıldı ve yeniden okumayla doğrulandı.`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(`❌ paket uygulanamadı: ${(e as Error).message}`);
      process.exitCode = 1;
    },
  );
}
