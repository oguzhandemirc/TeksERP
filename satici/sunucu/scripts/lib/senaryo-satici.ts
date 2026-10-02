// SENARYO L — satıcı tarafının fikstür yardımcısı (tek atımlık CLI; `test_` öneki yok → bekçi değil).
// Teks-Erp'teki koşucu (`Teks-Erp/scripts/senaryo-lisans.ts`) satıcı kodunu içe aktaramaz
// (`rootDir` sınırı) — bu dosyayı satıcı kökünde ayrı süreç olarak koşturur, sonucu tek JSON
// satırından okur. Hedef DB kapısı (yalnız `_test`) her komutta ilk iştir.
//   hazirla  → anahtar dizini (parolalı kökler, ALT, İNDİRME, çapa) + portal yöneticisi
//   temizle  → senaryonun kurulumları (kurulum kimliğiyle) · bayileri · portal kullanıcıları · anahtar künyesi ·
//              kanalı (kurulumsuz kaldıysa) · iptal belgesi defterinde verilen yükleyen etiketli satırlar (L35)
// Çıktı `SENARYO_JSON <json>` satırıdır; sırlar (parola, TOTP) yalnız bu boruya yazılır, loga değil.
import { anahtarOrtamiKur, bayiKurulumlari, hedefDbKapisi, kapat, portalKullaniciAc, temizleIptalBelgeleri, temizleKurulumlar, temizlePortal, TEST_KOK_PAROLASI } from "./test-ortam";

function flag(name: string): string[] {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).split(",").map((s) => s.trim()).filter(Boolean) : [];
}

function emit(value: unknown): void {
  process.stdout.write(`SENARYO_JSON ${JSON.stringify(value)}\n`);
}

async function prepare(): Promise<void> {
  const ortam = await anahtarOrtamiKur(Date.now());
  const yonetici = await portalKullaniciAc(ortam.ctx, "SATICI_YONETICI");
  emit({
    dizin: ortam.dizin,
    capaDosyasi: ortam.capaDosyasi,
    kokParolasi: TEST_KOK_PAROLASI,
    kokKid: ortam.f.kok.kid,
    indirme: { kid: ortam.f.ind.kid, x: ortam.f.ind.x },
    kidler: ortam.kidler,
    yonetici,
  });
}

async function cleanup(): Promise<void> {
  const { prisma } = await import("../../src/lib/prisma");
  const installationIds = flag("kurulum-idleri");
  const namePrefixes = flag("bayi-adi-oneki");
  const dealers = new Set(flag("bayiler"));
  for (const prefix of namePrefixes) {
    for (const b of await prisma.bayi.findMany({ where: { ad: { startsWith: prefix } }, select: { id: true } })) dealers.add(b.id);
  }
  const rows = installationIds.length > 0 ? await prisma.kurulum.findMany({ where: { kurulumId: { in: installationIds } }, select: { id: true } }) : [];
  const dbIds = [...new Set([...rows.map((r) => r.id), ...(await bayiKurulumlari([...dealers]))])];
  await temizleKurulumlar(dbIds, flag("kidler"));
  await temizlePortal({ kullanicilar: flag("kullanicilar"), bayiler: [...dealers], kanallar: flag("kanallar") });
  for (const yukleyen of flag("iptal-yukleyen")) await temizleIptalBelgeleri(yukleyen);
  emit({ kurulum: dbIds.length, bayi: dealers.size });
}

async function main(): Promise<void> {
  hedefDbKapisi();
  const command = process.argv[2];
  if (command === "hazirla") await prepare();
  else if (command === "temizle") await cleanup();
  else throw new Error("Komut: hazirla | temizle");
}

main()
  .then(async () => {
    await kapat();
    process.exit(0);
  })
  .catch(async (err: Error) => {
    console.error(`senaryo-satici: ${err.stack ?? err.message}`);
    await kapat();
    process.exit(1);
  });
