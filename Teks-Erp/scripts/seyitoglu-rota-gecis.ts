// =============================================================================
// SEYİTOĞLU ROTA GEÇİŞİ — SY-G2 (TASARIM-2026-10-31 §8.5, §8.8 "geçiş rehberi")
// =============================================================================
// Kurşun/tambur içeri alındığı gün: eski rotayı kullanan varyantları yeni rotaya alır.
// Varsayılan KURU KOŞU: etkilenen varyantları, açık iş emirlerini (snapshot'ını korur,
// DEĞİŞMEZ) ve iki rotanın son adımını listeler; `--apply` olmadan yazım YOK.
//
// Koşum (DATABASE_URL ortamdan):
//   tsx scripts/seyitoglu-rota-gecis.ts --eski-rota=<kod|ad> --yeni-rota=<kod|ad>
//   tsx scripts/seyitoglu-rota-gecis.ts --eski-rota=… --yeni-rota=… --apply --kullanici=<ad>
// Çıkış: 0 tamam · 1 uygulanamadı (rota yok/pasif/belirsiz, kullanıcı yok) · 2 kullanım.
// =============================================================================
import { hedefDbAdi } from "./lib/hedef-db-kapisi";

const USAGE =
  "❌ kullanım: tsx scripts/seyitoglu-rota-gecis.ts --eski-rota=<kod|ad> --yeni-rota=<kod|ad> [--apply --kullanici=<kullanıcı adı>]";

function argValue(args: string[], name: string): string | undefined {
  return args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const fromRef = argValue(args, "eski-rota");
  const toRef = argValue(args, "yeni-rota");
  const username = argValue(args, "kullanici");
  const known = ["--eski-rota=", "--yeni-rota=", "--kullanici="];
  const unknownArgs = args.filter((a) => a !== "--apply" && !known.some((k) => a.startsWith(k)));
  if (unknownArgs.length > 0 || !fromRef || !toRef || (apply && !username)) {
    console.error(USAGE);
    return 2;
  }
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL ortamda yok.");
    return 2;
  }
  const { default: prisma } = await import("../src/lib/prisma");
  const lib = await import("./lib/rota-gecis");
  try {
    let plan;
    try {
      plan = await lib.planRouteSwitch(fromRef, toRef);
    } catch (e) {
      if (e instanceof lib.RouteSwitchError) {
        console.error(`❌ ${e.message}`);
        return 1;
      }
      throw e;
    }
    console.log(`=== Seyitoğlu rota geçişi — ${apply ? "UYGULAMA" : "KURU KOŞU"} ===`);
    console.log(`🎯 Hedef veritabanı: ${hedefDbAdi()}`);
    console.log(`  Eski rota: ${lib.describeRoute(plan.from)}`);
    console.log(`  Yeni rota: ${lib.describeRoute(plan.to)}`);
    if (plan.to.lastStep?.external) console.log(`ℹ️  ${lib.EXTERNAL_LAST_STEP_NOTE}`);
    console.log(`── Etkilenen varyantlar (${plan.variants.length})`);
    for (const v of plan.variants) {
      const wo = v.openWorkOrders.length > 0 ? ` · açık iş emri: ${v.openWorkOrders.join(", ")}` : "";
      console.log(`  ${v.code} — ${v.name}${wo}`);
    }
    console.log(`── Eski rotadan açık iş emirleri (${plan.openWorkOrders.length}) — kendi adımlarını korur, DEĞİŞMEZ`);
    for (const w of plan.openWorkOrders) console.log(`  ${w.number} (${w.status})`);

    if (!apply) {
      console.log(
        `KURU KOŞU — ${plan.variants.length} varyant yeni rotaya alınacaktı; yazılan 0. Uygulamak için --apply --kullanici=<ad>.`,
      );
      return 0;
    }
    if (plan.variants.length === 0) {
      console.log("Taşınacak varyant yok; yazılan 0.");
      return 0;
    }
    const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (!user) {
      console.error(`❌ kullanıcı bulunamadı: ${username}`);
      return 1;
    }
    const { written, skipped } = await lib.applyRouteSwitch(plan, user.id);
    if (skipped.length > 0) console.log(`⚠️  Arada rotası değişmiş, atlandı: ${skipped.join(", ")}`);
    console.log(`✅ ${written.length} varyant yeni rotaya alındı; açık iş emirlerine dokunulmadı.`);
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
      console.error(`❌ rota geçişi uygulanamadı: ${(e as Error).message}`);
      process.exitCode = 1;
    },
  );
}
