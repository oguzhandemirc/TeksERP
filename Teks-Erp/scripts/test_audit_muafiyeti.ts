// =============================================================================
// BEKÇİ — "her CUD → AuditService.log()" kuralının İSTİSNALARI BEYANLI mı (iki yönlü)
// Çalıştır: npx tsx scripts/run-all-tests.ts audit_muafiyeti
// =============================================================================
// NEDEN: kural yazılıydı, İSTİSNASI ÖLÇÜLMÜYORDU. Kök `CLAUDE.md` "tek istisna
// `UserPreference`" diyordu; ölçüm (2026-09-14) CUD yapan 136 modelin 127'sinin audit
// yazdığını, DOKUZUNUN sessiz olduğunu gösterdi. Sekizi meşrudur — ama beyansız bir
// sessizlik, UNUTULMUŞ bir audit'ten ayırt edilemez. Kapı bu ayrımı kurar.
//
// ÖLÇÜT — 1e hükmü 2026-09-14: audit "model başına YAZMA YOLUNDA" aranır, DOSYA
// KATMANINDA değil. Bir model serviste `AuditService.log` ile de, ucunda
// `tableName: "..."` ile de denetlenebilir; ikisi de yazma yoludur. Katman farkı
// GÖRÜNÜR sınıf olarak basılır, kırmızı değildir.
//
// İKİ YÖNLÜ: ① sessiz bir model beyansızsa kırmızı · ② beyanlı bir model artık audit
// yazıyorsa kırmızı (ölü muafiyet, gerçek bir ihlali sessizce kapsam dışında tutar).
//
// ⚠️ MODEL DÜZEYİNİN SINIRI ÖLÇÜLDÜ ve BEYAN EDİLİR (sonda 2026-09-14): bir servisin
// audit'i susturulduğunda §2 SUSAR — çünkü aynı modeli yazan BAŞKA bir yol hâlâ denetliyor
// olabilir. Yani model düzeyi kol *"bu modelin HİÇBİR yerde audit'i yok"*u yakalar,
// *"bu YOL audit'ini kaybetti"*yi değil. Boşluk kovalanmadan bırakılmadı: §7 aynı soruyu
// DOSYA düzeyinde bir cırcırla sorar (audit taşımayan yazıcı dosya sayısı ARTAMAZ).
// ⇒ Gevşek bir iddia, dar bir iddiayla tamamlanır; tek başına bırakılırsa sessiz yeşildir.
//
// DB GEREKTİRMEZ: statik analiz (metin + AST'siz desen; delegate adı yapısal).
// =============================================================================
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { AUDIT_EXEMPT_MODELS, AUDIT_MUAF_SINIFLARI } from "./lib/audit-muafiyeti";
import { atlamaDefteri } from "./lib/atlama";
import { curumeKolu } from "./lib/circir-kolu";
import { walkTs } from "./lib/ts-tarama";

const KOK = join(__dirname, "..");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

/** `FabricPropertyValue` → `FABRIC_PROPERTY_VALUE`. SAF. */
export function tabloAdi(model: string): string {
  return model.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

const CUD = /\b(?:prisma|tx|db)\.([a-z][A-Za-z0-9]*)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g;

/** Dosyadaki CUD delegate'leri → model adı. SAF. */
export function cudModelleri(kaynak: string): string[] {
  return [...new Set([...kaynak.matchAll(CUD)].map((m) => m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1)))];
}

const ATLAMA = atlamaDefteri((mesaj) => check(mesaj, false));

function main(): void {
  console.log("=== AUDIT MUAFİYETİ ===\n");
  const dosyalar = [...walkTs(join(KOK, "src"))];
  const yazan = new Map<string, string[]>();          // model → CUD yapan dosyalar
  const auditDosya = new Set<string>();               // AuditService taşıyan dosyalar
  const tabloAdlari = new Set<string>();              // `tableName: "X"` geçen adlar
  const metin = new Map<string, string>();
  for (const f of dosyalar) {
    const rel = relative(KOK, f);
    const s = readFileSync(f, "utf8");
    metin.set(rel, s);
    if (s.includes("AuditService")) auditDosya.add(rel);
    for (const m of s.matchAll(/tableName:\s*"([A-Z0-9_]+)"/g)) tabloAdlari.add(m[1]!);
    for (const mdl of cudModelleri(s)) {
      if (!yazan.has(mdl)) yazan.set(mdl, []);
      yazan.get(mdl)!.push(rel);
    }
  }

  const sinifi = (mdl: string): "SERVIS" | "UC_KATMANI" | "SESSIZ" => {
    if (yazan.get(mdl)!.some((f) => auditDosya.has(f))) return "SERVIS";
    if (tabloAdlari.has(tabloAdi(mdl))) return "UC_KATMANI";
    return "SESSIZ";
  };
  const modeller = [...yazan.keys()].sort();
  const sessiz = modeller.filter((m) => sinifi(m) === "SESSIZ");
  const ucKatmani = modeller.filter((m) => sinifi(m) === "UC_KATMANI");

  check("§1 körlük zemini: kapsam dolu", modeller.length > 100 && auditDosya.size > 20,
    `${dosyalar.length} dosya · ${modeller.length} CUD modeli · ${auditDosya.size} audit dosyası · ${sessiz.length} sessiz`);

  const muaf = new Map(AUDIT_EXEMPT_MODELS.map((x) => [x.model, x]));

  // §2 ⭐ İLK YÖN: sessiz bir model BEYANSIZ kalamaz (fail-closed).
  const beyansiz = sessiz.filter((m) => !muaf.has(m));
  check("§2 ⭐ audit yazmayan her model MUAFİYET listesinde", beyansiz.length === 0,
    beyansiz.length
      ? `BEYANSIZ SESSİZLİK: ${beyansiz.map((m) => `${m} ← ${yazan.get(m)!.join(",")}`).join(" · ")}`
      : `${sessiz.length} sessiz model, hepsi beyanlı`);

  // §3 ⭐ İKİNCİ YÖN: beyanlı bir model artık audit yazıyorsa muafiyet ÖLÜDÜR.
  const oluMuaf = AUDIT_EXEMPT_MODELS.filter((x) => yazan.has(x.model) && sinifi(x.model) !== "SESSIZ");
  const hayaletMuaf = AUDIT_EXEMPT_MODELS.filter((x) => !yazan.has(x.model));
  check("§3 ⭐ muafiyet listesinde ÖLÜ satır yok", oluMuaf.length === 0 && hayaletMuaf.length === 0,
    [oluMuaf.length ? `artık AUDIT YAZIYOR: ${oluMuaf.map((x) => `${x.model}(${sinifi(x.model)})`).join(", ")}` : "",
     hayaletMuaf.length ? `CUD yolu YOK: ${hayaletMuaf.map((x) => x.model).join(", ")}` : ""].filter(Boolean).join(" · ")
      || `${AUDIT_EXEMPT_MODELS.length} satır canlı`);

  // §4 sınıf KAPALI kümeden (fail-closed).
  const kotuSinif = AUDIT_EXEMPT_MODELS.filter((x) => !(AUDIT_MUAF_SINIFLARI as readonly string[]).includes(x.sinif));
  check("§4 muafiyet sınıfı KAPALI kümeden", kotuSinif.length === 0,
    kotuSinif.length ? kotuSinif.map((x) => `${x.model}→"${x.sinif}"`).join(" · ") : `${AUDIT_MUAF_SINIFLARI.length} sınıf`);

  // §5 ⭐ `EBEVEYN_EYLEMDE` bir İDDİADIR ve ÖLÇÜLÜR: yazan dosyanın çağıranlarından en az
  // biri audit taşımalı. Ölçülmeyen bir gerekçe, gerekçe değil temennidir.
  for (const x of AUDIT_EXEMPT_MODELS.filter((y) => y.sinif === "EBEVEYN_EYLEMDE")) {
    const yazanlar = yazan.get(x.model) ?? [];
    const cagiranAudit: string[] = [];
    for (const w of yazanlar) {
      const modul = w.replace(/\.ts$/, "").split("/").pop()!;
      for (const [rel, s] of metin) {
        if (rel === w || !auditDosya.has(rel)) continue;
        if (s.includes(`/${modul}"`) || s.includes(`/${modul}'`)) { cagiranAudit.push(rel); break; }
      }
    }
    const ucta = tabloAdlari.has(tabloAdi(x.model)) || yazanlar.some((w) => {
      const modul = w.replace(/\.ts$/, "").split("/").pop()!;
      return [...metin].some(([rel, s]) => rel !== w && /routes|controllers/.test(rel) && (s.includes(`/${modul}"`) || s.includes(`/${modul}'`)) && /tableName:\s*"/.test(s));
    });
    check(`§5 ${x.model} EBEVEYN_EYLEMDE iddiası ÖLÇÜLDÜ`, cagiranAudit.length > 0 || ucta,
      cagiranAudit.length ? `çağıran audit yazıyor: ${cagiranAudit.slice(0, 3).join(", ")}` : ucta ? "uç katmanında `tableName` var" : "ÇAĞIRAN AUDIT YAZMIYOR — gerekçe ölçümle çürüdü");
  }

  // GÖRÜNÜR: uç katmanında denetlenen modeller (kırmızı DEĞİL, katman borcu).
  if (ucKatmani.length > 0) {
    console.log(`   ⓘ uç katmanında denetlenen (${ucKatmani.length}) — servis değil route/controller \`tableName\`i:`);
    for (const m of ucKatmani) console.log(`      • ${m} ← ${yazan.get(m)!.join(", ")}`);
  }
  console.log(`   ⓘ muafiyet dağılımı: ${AUDIT_MUAF_SINIFLARI.map((k) => `${k} ${AUDIT_EXEMPT_MODELS.filter((x) => x.sinif === k).length}`).join(" · ")}`);

  // §7 ⭐ DOSYA DÜZEYİ CIRCIR — §2'nin ölçülmüş kör noktası.
  // Bugünkü 29 dosyanın tamamı `helpers/` ve `jobs/` altında: audit'leri ÇAĞIRAN eylemde
  // (aynı `EBEVEYN_EYLEMDE` kalıbı, dosya düzeyinde). Sayı ARTAMAZ — yeni bir yazıcı dosya
  // audit'siz doğarsa kırmızı; azalırsa taban entegratörde düşer.
  // 29 → 30 (2026-09-18, 1e onayı 16:58): `helpers/cash-ledger.helper.ts` — kasa/banka defterinin TEK YAZARI, tx İÇİNDE;
  // audit'i çağıran servis basar (payment.service · cash-transaction.service · cheque.service) — EBEVEYN_EYLEMDE kalıbı.
  // Model beyanı DEĞİL (CashTransaction zaten uç katmanında audit'li → §3 ölü beyan sayar), dosya düzeyi beyanlı sınıf ekleme.
  const AUDITSIZ_YAZICI_TABAN = 30;
  const auditsizYazici: string[] = [];
  for (const [rel, s] of metin) {
    if (auditDosya.has(rel) || /tableName:\s*"/.test(s)) continue;
    const dis = cudModelleri(s).filter((m) => !muaf.has(m));
    if (dis.length) auditsizYazici.push(`${rel} → ${dis.join(",")}`);
  }
  check("§7 ⭐ audit taşımayan YAZICI DOSYA sayısı ARTMADI", auditsizYazici.length <= AUDITSIZ_YAZICI_TABAN,
    auditsizYazici.length <= AUDITSIZ_YAZICI_TABAN
      ? `${auditsizYazici.length} ≤ ${AUDITSIZ_YAZICI_TABAN} (hepsi helpers/jobs — audit çağıran eylemde)`
      : `${auditsizYazici.length} > ${AUDITSIZ_YAZICI_TABAN} ⇒ YENİ audit'siz yazıcı:\n      ` + auditsizYazici.slice(0, 10).join("\n      "));
  curumeKolu(check, ATLAMA.atla, "§7b ⭐ audit'siz yazıcı tabanı ÇÜRÜMEDİ", auditsizYazici.length, AUDITSIZ_YAZICI_TABAN);

  console.log("\n=== §6 SONDALAR (saf yüklem) ===");
  check("§6a ⭐ tablo adı dönüşümü", tabloAdi("FabricPropertyValue") === "FABRIC_PROPERTY_VALUE" && tabloAdi("Item") === "ITEM");
  check("§6b ⭐ `prisma.x.create` CUD sayılır", cudModelleri("await prisma.userPreference.create({});").join() === "UserPreference");
  check("§6c ⭐ `tx.x.updateMany` de CUD", cudModelleri("await tx.session.updateMany({});").join() === "Session");
  check("§6d ⭐ salt OKUMA CUD DEĞİL", cudModelleri("await prisma.session.findMany({});").length === 0);
  check("§6e aynı dosyada iki model de sayılır", cudModelleri("prisma.a.create(); prisma.b.delete();").length === 2);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
