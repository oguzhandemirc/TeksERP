// =============================================================================
// TESİS SAATİ — bildirim gün anahtarı (dedup kimliği) ve sessiz saat TESİSİN saat diliminden (ANLIK
// `tesis.saatDilimi`), bulut sunucusunun ya da UTC'nin diliminden DEĞİL (`src/lib/facility-clock.ts`).
//   §1 gün/dakika seçilen dilimden · §2 sessiz pencere tesis saatine göre · §3 tanınmayan dilim → varsayılan
//   §4 `evaluate` gün anahtarı `timeZone`dan (aynı an iki dilimde iki ayrı gün) · §5 okuyucular dilimi TAŞIR
//   (olay üretimi ve gönderim `tesis` projeksiyonunu okur; çıplak çağrı varsayılana düşerdi).
// ⭐ KALICI SONDA: §5 yüklemi dilimsiz çağrıda ısırır, dilimli çağrıda susar (sentetik metin).
// Koşum: npx tsx scripts/test_tesis_saati.ts   (DB GEREKMEZ)
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS } from "../src/catalog/notifications";
import { DEFAULT_FACILITY_TIMEZONE, facilityDay, facilityMinute, facilityTimeZone, quietUntil } from "../src/lib/facility-clock";
import { evaluate } from "../src/services/notification-events";

let gecti = 0;
let kaldi = 0;
function kontrol(ad: string, kosul: boolean, ayrinti = ""): void {
  if (kosul) gecti++;
  else kaldi++;
  console.log(`  ${kosul ? "✅" : "❌"} ${ad}${ayrinti ? ` — ${ayrinti}` : ""}`);
}

const AT = Date.parse("2026-09-30T21:30:00Z"); // İstanbul 1 Ekim 00:30 · New York 30 Eylül 17:30

console.log("§1 gün ve dakika seçilen dilimden");
kontrol("§1a varsayılan dilim İstanbul", facilityDay(AT) === "2026-10-01" && facilityMinute(AT) === 30);
kontrol("§1b New York", facilityDay(AT, "America/New_York") === "2026-09-30" && facilityMinute(AT, "America/New_York") === 17 * 60 + 30);
kontrol("§1c UTC", facilityDay(AT, "UTC") === "2026-09-30" && facilityMinute(AT, "UTC") === 21 * 60 + 30);

console.log("§2 sessiz pencere tesis saatine göre");
const gece = { acik: true, baslangic: "22:00", bitis: "07:00" };
const nyGece = quietUntil(gece, AT, "America/New_York");
const istGece = quietUntil(gece, AT, "Europe/Istanbul");
kontrol("§2a İstanbul 00:30 sessizde — bitiş 07:00 İstanbul (04:00Z)", istGece === Date.parse("2026-10-01T04:00:00Z"), String(istGece && new Date(istGece).toISOString()));
kontrol("§2b New York 17:30 sessizde DEĞİL", nyGece === null);

console.log("§3 tanınmayan dilim → varsayılan (sessiz saat kaybolmasın)");
kontrol("§3a geçerli dilim korunur", facilityTimeZone("America/New_York") === "America/New_York");
kontrol(
  "§3b geçersiz/boş/zararlı → varsayılan",
  [undefined, null, 5, "", "Mars/Olympus", "Europe/Istanbul'; --"].every((v) => facilityTimeZone(v) === DEFAULT_FACILITY_TIMEZONE),
);

console.log("§4 evaluate gün anahtarı dilimden");
const facts = (timeZone: string) => ({
  nowMs: AT,
  timeZone,
  accounts: [{ id: "a1", settings: { ...DEFAULT_SETTINGS, acik: true, esikler: { ...DEFAULT_SETTINGS.esikler, gecikenKalemUst: 0 } } }],
  snapshots: new Map<string, unknown>([["ozet.siparis", { gecikenKalem: 3 }]]),
  lastPackageAt: new Date(AT),
  inbox: [],
});
const keyOf = (tz: string) => evaluate(facts(tz)).find((c) => c.kind === "geciken-siparis")?.dedupKey ?? "yok";
kontrol("§4a İstanbul gün anahtarı 2026-10-01", keyOf("Europe/Istanbul") === "geciken-siparis:2026-10-01", keyOf("Europe/Istanbul"));
kontrol("§4b New York gün anahtarı 2026-09-30", keyOf("America/New_York") === "geciken-siparis:2026-09-30", keyOf("America/New_York"));

console.log("§5 okuyucular dilimi taşır");
const KOK = path.resolve(__dirname, "..");
/** Dilim parametresi verilmeden çağrılan tesis saati yardımcısı (varsayılana sessizce düşer). */
function dilimsizCagri(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\b(facilityDay|facilityMinute)\(([^()]*)\)/g)) if (!m[2]!.includes(",")) out.push(m[0]);
  for (const m of src.matchAll(/\bquietUntil\(([^()]*)\)/g)) if (m[1]!.split(",").length < 3) out.push(m[0]);
  return out;
}
for (const f of ["src/services/notification-events.ts", "src/services/notification-sender.ts"]) {
  const src = readFileSync(path.join(KOK, f), "utf8");
  kontrol(`§5 ${f}: dilimsiz çağrı yok`, dilimsizCagri(src).length === 0, dilimsizCagri(src).join(" · "));
  kontrol(`§5 ${f}: 'tesis' projeksiyonunu okur`, src.includes("FACILITY_TIMEZONE_SOURCE"));
}

console.log("\n✓K kalıcı sonda (sentetik)");
kontrol(
  "✓K1 dilimsiz çağrı ısırır · dilimli susar",
  dilimsizCagri("const d = facilityDay(f.nowMs); quietUntil(q, ms);").length === 2 &&
    dilimsizCagri("const d = facilityDay(f.nowMs, f.timeZone); quietUntil(q, ms, tz);").length === 0,
);

console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
process.exit(kaldi > 0 ? 1 : 0);
