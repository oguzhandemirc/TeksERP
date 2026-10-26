// =============================================================================
// BEKÇİ — BİLDİRİM ÖNİZLEMESİ (N4-MOTOR, Karar Y3): "haftada ~N" ölçümden, YAZMAZ
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_onizleme
// =============================================================================
//   §1 tohumlu sayaç: kişinin tek görünür türünde haftalık tahmin bağımsız hesaba ±%10 tolerans (2026-10-25) · kaynak `olcum`
//   §2 taslak: UYGULAMA kapatılan tür (özet de kapalı) önizlemeden düşer; kaydedilmiş tercih DEĞİŞMEZ
//   §3 ⭐ yazmaz: tercih/ayar/takip/gelen kutusu/sayaç tablolarının sayımı önce = sonra
//
// NEGATİF SONDA (2026-10-25, md5 ile birebir geri alındı): önizlemede gün sayısı sabit 30 alındı → §1a ❌ (4/1; 17 ~ 73).
// Sayaç tohumu `notification_daily_stats`e EKLENİR ve `finally`de aynı miktar geri düşülür (satır silinmez).
// =============================================================================
import prisma from "../src/lib/prisma";
import { factoryDayKeyUtcMidnight } from "../src/constants/time";
import { BildirimFikstur } from "./lib/bildirim-http-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const ek = Date.now().toString(36);
const fx = new BildirimFikstur(`bonz-${ek}`);
const KIND = "sistem.esitleme-gecikti"; // admin:users · varsayılan HERKES · kanallar UYGULAMA/OZET/MASAUSTU
const DAY = 86_400_000;
const seeded: Array<{ factoryDay: Date; n: number }> = [];

async function seed(daysAgo: number, n: number): Promise<void> {
  const factoryDay = new Date(factoryDayKeyUtcMidnight().getTime() - daysAgo * DAY);
  await prisma.notificationDailyStats.upsert({
    where: { factoryDay_kind: { factoryDay, kind: KIND } },
    create: { factoryDay, kind: KIND, events: n },
    update: { events: { increment: n } },
  });
  seeded.push({ factoryDay, n });
}

async function counts(): Promise<string> {
  const [a, b, c, d, e] = await Promise.all([
    prisma.notificationPreference.count(),
    prisma.notificationUserSetting.count(),
    prisma.recordFollow.count(),
    prisma.notificationInbox.count(),
    prisma.notificationDailyStats.aggregate({ _sum: { events: true }, _count: true }),
  ]);
  return JSON.stringify([a, b, c, d, e._sum.events, e._count]);
}

/** Bağımsız hesap: pencere (30 fabrika günü) içi toplam ÷ ilk satırdan bugüne gün × 7. */
async function expectedWeekly(): Promise<number> {
  const today = factoryDayKeyUtcMidnight();
  const since = new Date(today.getTime() - 29 * DAY);
  const all = await prisma.notificationDailyStats.findMany({ where: { factoryDay: { gte: since, lte: today } }, select: { factoryDay: true, kind: true, events: true } });
  const first = Math.min(...all.map((r) => r.factoryDay.getTime()));
  const days = Math.min(30, Math.max(1, Math.round((today.getTime() - first) / DAY) + 1));
  const sum = all.filter((r) => r.kind === KIND).reduce((s, r) => s + r.events, 0);
  return (sum / days) * 7;
}

async function main(): Promise<void> {
  console.log("\n=== Bildirim önizlemesi ===\n");
  try {
    await fx.ac();
    await fx.bayrak(true);
    const u = await fx.kullanici("u", ["admin:users"]);
    await seed(6, 40);
    await seed(0, 30);
    const beklenen = await expectedWeekly();

    console.log("=== §1 tohumlu ölçüm ===");
    const once = await counts();
    const r = await fx.istek(u.token, "POST", "/api/bildirim/tercihler/onizleme", {});
    const d = r.json?.data;
    const tur = (d?.enCok ?? []).find((x: any) => x.kind === KIND);
    check("§1a haftalık bağımsız hesaba ±%10", r.status === 200 && beklenen > 0 && Math.abs(tur?.sayi - beklenen) <= beklenen * 0.1, `${tur?.sayi} ~ ${beklenen.toFixed(1)}`);
    check("§1b kaynak `olcum`", d?.kaynak === "olcum", `${d?.kaynak}`);

    console.log("\n=== §2 taslak ===");
    const t = await fx.istek(u.token, "POST", "/api/bildirim/tercihler/onizleme", { tercihler: [{ tur: KIND, kanal: "UYGULAMA", acik: false }] });
    const dusen = !(t.json?.data?.enCok ?? []).some((x: any) => x.kind === KIND);
    check("§2a taslakta kapatılan tür önizlemeden düşer", t.status === 200 && dusen, JSON.stringify(t.json?.data?.enCok));
    const kayitli = await prisma.notificationPreference.count({ where: { userId: u.id } });
    check("§2b taslak kaydedilmez (kişinin satırı yok)", kayitli === 0, `${kayitli}`);

    console.log("\n=== §3 yazmaz ===");
    const sonra = await counts();
    check("§3 ⭐ tablo sayımları önce = sonra", once === sonra, `${once} → ${sonra}`);
  } finally {
    for (const s of seeded) {
      await prisma.notificationDailyStats.update({ where: { factoryDay_kind: { factoryDay: s.factoryDay, kind: KIND } }, data: { events: { decrement: s.n } } });
    }
    await fx.kapat();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (err) => {
  console.error("❌ beklenmeyen hata:", err);
  await fx.kapat().catch(() => undefined);
  await prisma.$disconnect();
  process.exitCode = 1;
});
