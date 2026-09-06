// =============================================================================
// BEKÇİ — BACKEND LOG KANALI (`src/lib/logger.ts`)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts logger_kanali
//
// ⭐ NEDEN YAZILDI: kanalın değeri BİÇİMİNDE. 2026-09-06'da fabrikanın beş
//    haftalık hata log'u (5648 satır) elle ayrıştırıldı ve fark ölçüldü:
//      · `[etiket]` taşıyan 531 satır saniyede gruplandı,
//      · etiketsiz ~5100 satır ancak okunarak sınıflandı.
//    Biçim bozulursa kanal sessizce eski hâline döner ve bunu kimse fark etmez
//    — hiçbir uç 500 vermez, hiçbir ekran değişmez. Bu yüzden bekçi biçimi
//    ÖLÇER, varlığını değil.
//
// NE ÖLÇER:
//   §2 satır biçimi `SEVIYE [alan] mesaj`
//   §3 akış ayrımı — `bilgi` stdout, `hata`/`uyari` stderr (pm2 ayrı dosyaya yazar)
//   §4 ⭐ SAYILABİLİRLİK: bir hata = TEK etiketli satır (yığın izi etiketsiz)
//   §5 `satir()` etiket almaz (açılış banner'ı okunur kalsın)
//   §6 mekanik: `src/` içinde `console.` YALNIZ kanalın kendi dosyasında
//   §7 mekanik: ESLint `no-console` açık ve kanalın dosyası ADLI istisna
//
// ⭐ NEGATİF SONDA (2026-09-07, ölçüldü): `bicimle` etiketi düşürülünce §2
//    KIRMIZI · `uyari` `console.log`a çevrilince §3 KIRMIZI · yığın izi
//    etiketli basılınca §4 KIRMIZI · `satir` etiket ekleyince §5 KIRMIZI ·
//    bir servise çıplak `console.error` konunca §6 KIRMIZI · eslint'ten
//    `"no-console"` satırı silinince §7 KIRMIZI.
// =============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { hata, uyari, bilgi, satir } from "../src/lib/logger";

const KOK = join(__dirname, "..");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

/** Kanalı çağırırken üç akışı da ayrı ayrı toplar. */
function yakala(fn: () => void): { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const o = console.log, w = console.warn, e = console.error;
  console.log = (...a: unknown[]) => { out.push(a.map(String).join(" ")); };
  console.warn = (...a: unknown[]) => { err.push(a.map(String).join(" ")); };
  console.error = (...a: unknown[]) => { err.push(a.map(String).join(" ")); };
  try { fn(); } finally { console.log = o; console.warn = w; console.error = e; }
  return { out, err };
}

// ── §1 KÖRLÜK ZEMİNİ ────────────────────────────────────────────────────────
console.log("\n§1 — körlük zemini");
const zemin = yakala(() => { bilgi("zemin", "deneme"); });
check("yakalayıcı çalışıyor (0 satır ≠ hiç bakılmadı)", zemin.out.length === 1, `${zemin.out.length} satır`);

// ── §2 SATIR BİÇİMİ ─────────────────────────────────────────────────────────
console.log("\n§2 — satır biçimi `SEVIYE [alan] mesaj`");
const b = yakala(() => {
  hata("alanA", "mesajA");
  uyari("alanB", "mesajB");
  bilgi("alanC", "mesajC");
});
check("⭐ `hata` → `HATA [alanA] mesajA`", b.err[0] === "HATA [alanA] mesajA", b.err[0]);
check("⭐ `uyari` → `UYARI [alanB] mesajB`", b.err[1] === "UYARI [alanB] mesajB", b.err[1]);
check("⭐ `bilgi` → `BILGI [alanC] mesajC`", b.out[0] === "BILGI [alanC] mesajC", b.out[0]);

const ekli = yakala(() => { uyari("alan", "mesaj", "ayrıntı"); });
check("ek bilgi ` — ` ile eklenir", ekli.err[0] === "UYARI [alan] mesaj — ayrıntı", ekli.err[0]);

// ── §3 AKIŞ AYRIMI ──────────────────────────────────────────────────────────
// pm2 stdout ve stderr'i AYRI dosyaya yazar (`out_file` / `error_file`).
// Birleştirmek `backend-err.log`u işe yaramaz hale getirirdi.
console.log("\n§3 — akış ayrımı (pm2 iki ayrı dosyaya yazıyor)");
check("⭐ `bilgi` stdout'a yazar, stderr'e DEĞİL", b.out.length === 1 && b.err.length === 2);
check("⭐ `hata` ve `uyari` stderr'e yazar", b.err.length === 2 && b.out.length === 1);

// ── §4 SAYILABİLİRLİK ───────────────────────────────────────────────────────
// Fabrikanın eski log'unda 64 kez tekrarlayan bir hata, tam da bu ayrım
// olmadığı için `grep -c` ile sayılamadı — yığın izinin her satırı ayrı bir
// "hata satırı" gibi görünüyordu.
console.log("\n§4 — bir hata = TEK etiketli satır");
const y = yakala(() => { hata("alan", "patladı", new Error("gerçek sebep")); });
const etiketli = y.err.filter((l) => l.startsWith("HATA ["));
check("⭐ yığın izli hatada ETİKETLİ satır tam olarak 1 tane", etiketli.length === 1,
  `${etiketli.length} etiketli / ${y.err.length} satır`);
check("hata cümlesi etiketli satıra girer", etiketli[0]?.includes("gerçek sebep") === true, etiketli[0]);
check("yığın izi ayrı satır(lar)da basılır", y.err.length >= 2, `${y.err.length} satır`);

// ── §5 BANNER KAÇIŞI ────────────────────────────────────────────────────────
console.log("\n§5 — `satir()` etiket ALMAZ (açılış kutusu okunur kalsın)");
const bnr = yakala(() => { satir("===== kutu ====="); satir(); });
check("⭐ `satir` metni olduğu gibi basar", bnr.out[0] === "===== kutu =====", bnr.out[0]);
check("`satir()` argümansız boş satır basar", bnr.out[1] === "", `"${bnr.out[1]}"`);

// ── §6 KANAL TEK ─────────────────────────────────────────────────────────────
console.log("\n§6 — `src/` içinde çıplak `console.` yalnız kanalın dosyasında");
function tsDosyalari(dir: string, acc: string[] = []): string[] {
  for (const ad of readdirSync(dir)) {
    const tam = join(dir, ad);
    if (statSync(tam).isDirectory()) tsDosyalari(tam, acc);
    else if (ad.endsWith(".ts")) acc.push(tam);
  }
  return acc;
}
const srcDosyalar = tsDosyalari(join(KOK, "src"));
const KANAL = join(KOK, "src", "lib", "logger.ts");
// Yorumda geçen `console.error` sayılmaz — bu dosyanın kendi dersi (bkz.
// test_deploy_log_rotation başlığı): metni değil KODU ölç.
const ciplak = srcDosyalar.filter((f) => {
  if (f === KANAL) return false;
  return readFileSync(f, "utf8")
    .split("\n")
    .some((l) => {
      const t = l.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return false;
      return /\bconsole\.(log|warn|error|info|debug)\s*\(/.test(t);
    });
});
check("körlük zemini: src taraması dosya buldu", srcDosyalar.length > 100, `${srcDosyalar.length} dosya`);
check("⭐ kanal dışında çıplak `console.` yok", ciplak.length === 0,
  ciplak.length ? ciplak.slice(0, 5).map((f) => f.replace(KOK + "/", "")).join(" · ") : "temiz");

// ── §7 KURAL AÇIK MI ────────────────────────────────────────────────────────
// §6 bugünü ölçer, §7 yarını: kural kapalıysa bir sonraki çıplak `console`
// commit kapısından geçer ve §6 ancak paket koşulunca kırmızı verir.
console.log("\n§7 — ESLint `no-console` açık ve istisna ADLI");
const eslintKaynak = readFileSync(join(KOK, "eslint.config.mjs"), "utf8");
const eslintKod = eslintKaynak
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("//"))
  .join("\n");
check('⭐ `"no-console": "error"` tanımlı', /"no-console":\s*"error"/.test(eslintKod));
check('⭐ kanalın dosyası ADLI istisna (`no-console: off` + logger.ts bloğu)',
  /"no-console":\s*"off"/.test(eslintKod) && eslintKod.includes('files: ["src/lib/logger.ts"]'));

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
