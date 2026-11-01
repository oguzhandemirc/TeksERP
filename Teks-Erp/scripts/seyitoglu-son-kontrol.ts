// =============================================================================
// SEYİTOĞLU İÇ "SON KONTROL" ADIMI — SY-P4 (TASARIM-2026-10-31 §8.5 md. 4, #343 kararı)
// =============================================================================
// Son adımı fason (boyahane) rotada top kalitesiz doğar. Bu betik rotanın sonuna kalite
// veren iç istasyon adımı ekler (yoksa "Son kontrol" Tambur istasyonunu yaratır). VERİ işidir:
// betiği koşmayan fabrikada davranış değişmez. Varsayılan KURU KOŞU; `--apply` olmadan yazım YOK.
//
// Koşum (DATABASE_URL ortamdan):
//   tsx scripts/seyitoglu-son-kontrol.ts --rota=<kod|ad> [--istasyon=<kod>]
//   tsx scripts/seyitoglu-son-kontrol.ts --rota=… --apply --kullanici=<ad>
// Çıkış: 0 tamam · 1 uygulanamadı (rota yok/pasif/belirsiz, istasyon kalite veremez, kullanıcı yok) · 2 kullanım.
// =============================================================================
import { hedefDbAdi } from "./lib/hedef-db-kapisi";

const USAGE =
  "❌ kullanım: tsx scripts/seyitoglu-son-kontrol.ts --rota=<kod|ad> [--istasyon=<kod>] [--apply --kullanici=<kullanıcı adı>]";

function argValue(args: string[], name: string): string | undefined {
  return args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const routeRef = argValue(args, "rota");
  const stationCode = argValue(args, "istasyon");
  const username = argValue(args, "kullanici");
  const known = ["--rota=", "--istasyon=", "--kullanici="];
  const unknownArgs = args.filter((a) => a !== "--apply" && !known.some((k) => a.startsWith(k)));
  if (unknownArgs.length > 0 || !routeRef || stationCode === "" || (apply && !username)) {
    console.error(USAGE);
    return 2;
  }
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL ortamda yok.");
    return 2;
  }
  const { default: prisma } = await import("../src/lib/prisma");
  const lib = await import("./lib/son-kontrol-adimi");
  const { RouteSwitchError, describeRoute } = await import("./lib/rota-gecis");
  try {
    let plan;
    try {
      plan = await lib.planFinalCheck(routeRef, stationCode ?? lib.DEFAULT_FINAL_CHECK_CODE);
    } catch (e) {
      if (e instanceof RouteSwitchError) {
        console.error(`❌ ${e.message}`);
        return 1;
      }
      throw e;
    }
    console.log(`=== Seyitoğlu iç Son kontrol adımı — ${apply ? "UYGULAMA" : "KURU KOŞU"} ===`);
    console.log(`🎯 Hedef veritabanı: ${hedefDbAdi()}`);
    console.log(`  Rota: ${describeRoute(plan.route)}`);
    if (plan.action === "NOT_NEEDED") {
      console.log("✅ Gerek yok: rotanın son adımı zaten iç istasyon (top orada finalize olur). yazılan 0");
      return 0;
    }
    const st = plan.station.id ? "var olan istasyon" : "YARATILACAK istasyon (iç · Tambur türü · muayene açık)";
    console.log(`  Eklenecek adım: sıra ${plan.nextSequence} — ${plan.station.code} · ${plan.station.name} (${st})`);
    console.log("  Kalite: Tambur ekranında topun TAMAMI tek kesimle kaliteye ayrılır; çıkan top depoya kaliteli iner.");
    console.log(`── Açık iş emirleri (${plan.openWorkOrders.length}) — kendi adımlarını korur, yeni adım YALNIZ yeni iş emirlerine girer`);
    for (const n of plan.openWorkOrders) console.log(`  ${n}`);
    if (!apply) {
      console.log("ℹ️  Kuru koşu: yazılan 0. Uygulamak için --apply --kullanici=<ad>.");
      return 0;
    }
    const user = await prisma.user.findFirst({ where: { username, isActive: true }, select: { id: true } });
    if (!user) {
      console.error(`❌ aktif kullanıcı bulunamadı: ${username}`);
      return 1;
    }
    const res = await lib.applyFinalCheck(plan, user.id);
    if (!res.written) {
      console.log("⚠️  Atlandı: rota plan ile uygulama arasında değişti (yazılan 0). Betiği yeniden koşun.");
      return 0;
    }
    console.log(`✅ yazılan 1 adım${res.stationCreated ? " + 1 istasyon" : ""}.`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    console.error("💥", e);
    process.exitCode = 1;
  });
