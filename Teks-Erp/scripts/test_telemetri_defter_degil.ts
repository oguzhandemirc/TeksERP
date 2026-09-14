// =============================================================================
// BEKÇİ — TELEMETRİ ≠ DEFTER: budanan her tablo SINIFLANMIŞ mı
// Çalıştır: npx tsx scripts/run-all-tests.ts telemetri_defter_degil
// =============================================================================
// NEDEN: `docs/kurallar/defter.md` § "Telemetri ≠ defter" altı kural koyuyor. Bugün
// ölçülebilen çekirdeği ①③④'ün ortak önkoşuludur: ***budanan bir tablo, sınıfı BEYAN
// EDİLMEDEN budanamaz.*** Kapısı yoktu ve bedeli ölçüldü (2026-09-14): bugün budanan
// TEK canlı tablo `EndpointLatencyDaily` beyan tablosunda HİÇ YOKTU — `test_defter_ters_yol`
// §1 evreni "append-only model" olduğu için onu hiç sormuyordu, `§10` ise TELEMETRİ
// sınıfını silme taramasının kapsamı DIŞINDA tutuyordu. İki kapı da doğru çalışıyordu;
// aradaki boşlukta budanan bir tablo sınıfsız durdu.
//
// ⚠️ KAPSAM BEYANI — bu bekçi altı kuralın HEPSİNİ ölçmez:
//   ÖLÇÜLÜR bugün: ① sınıf beyanı + budama yolunun beyanı · ④ budayan yolun TEK dosyada
//     olması · "tavanlı" olmanın yapısal karşılığı (yüklem YAŞA bağlı, ada değil).
//   ÖLÇÜLEMEZ bugün (Faz 2, `test_machine_prune_safety`): ② donan sayı · ③ manifest
//     bekçisi · ⑤ tek helper + DB seddi ikizi · ⑥ açık koşum/vardiya/mühürsüz pencere.
//   Bu ayrım BEYAN EDİLİR ki "telemetri kapısı var" cümlesi hepsini kapsıyor sanılmasın.
//
// DB GEREKTİRMEZ: statik analiz (AST).
// =============================================================================
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { DEFTER_BEYANI } from "./lib/defter-beyan";
import { walkTs } from "./lib/ts-tarama";

const KOK = join(__dirname, "..");

/**
 * DEFTER-OLMAYAN BUDANAN TABLOLAR — kendi beyanı, `DEFTER_BEYANI`nden AYRI.
 *
 * ⚠️ NEDEN AYRI TABLO: `DEFTER_BEYANI`nin evreni "append-only model"dir (`updatedAt` yok)
 * ve o tabloya girmek üç şey birden getirir — §1c/§2 evren kontrolleri ve §10'un silme
 * taraması. `Session` oraya yazıldığında (denendi, 2026-09-14) üç kırmızı doğdu ve biri
 * GERÇEK bir yan etkiydi: test script'lerindeki oturum temizlikleri §10b2'nin sayısına
 * girdi, yani BİR BEYAN yüzünden bir kapının borcu arttı. ⇒ *Bir beyan tablosunun evreni
 * o tablonun sözleşmesidir; başka bir evrenin satırını oraya koymak ölçümü kirletir.*
 * Bu liste yalnız "yaşa göre budanan ama defter evreninde olmayan" tabloları taşır.
 */
export const BUDANAN_DEFTER_DISI: Array<{ model: string; sinif: "DURUM" | "TELEMETRI"; gerekce: string; silen: string[] }> = [
  { model: "Session", sinif: "DURUM",
    gerekce: "oturum kaydı; iptal `revokedAt` damgası, doğrulama fail-closed (kayıt yoksa geçersiz) ⇒ ÖLÜ oturumun satırı hiçbir sayıya girmez. \"Ne oldu\" sorusunun cevabı audit'in AUTH kategorisindedir",
    silen: ["src/services/session-registry.service.ts"] },
];
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

/** Yaş yüklemi anahtarları — "şu tarihten eski" demenin Prisma biçimleri. */
const YAS_ANAHTARI = new Set(["lt", "lte"]);

export interface BudamaYeri { model: string; dosya: string; satir: number; yas: boolean; alan: string }

/**
 * Bir `deleteMany` yüklemi YAŞA mı dayanıyor? SAF — girdi AST, çıktı karar.
 *
 * "Tavanlı" olmanın yapısal karşılığı budur: budama BİR TARİH EŞİĞİNE bakar
 * (`day: { lt: cutoff }`), bir ADA ya da tekil kimliğe değil. Ada dayanan bir silme
 * budama değil, TEMİZLİKTİR ve başka bir kapının konusudur (§10b).
 */
export function yasYuklemi(where: ts.ObjectLiteralExpression, sf: ts.SourceFile): { yas: boolean; alan: string } {
  let bulunan = "";
  const gez = (n: ts.Node, yol: string): void => {
    if (bulunan) return;
    if (ts.isPropertyAssignment(n)) {
      const ad = ts.isIdentifier(n.name) ? n.name.text : n.name.getText(sf);
      if (YAS_ANAHTARI.has(ad) && yol) { bulunan = yol; return; }
      gez(n.initializer, ad === "AND" || ad === "OR" || ad === "NOT" ? yol : ad);
      return;
    }
    n.forEachChild((c) => gez(c, yol));
  };
  where.properties.forEach((p) => gez(p, ""));
  return { yas: bulunan !== "", alan: bulunan };
}

/** `prisma.<model>.deleteMany(...)` çağrılarını bulur. SAF — girdi kaynak, çıktı yerler. */
export function budamalariTara(kaynak: string, dosya: string): BudamaYeri[] {
  const sf = ts.createSourceFile(dosya, kaynak, ts.ScriptTarget.Latest, true);
  const out: BudamaYeri[] = [];
  const gez = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "deleteMany") {
      const ic = n.expression.expression;
      if (ts.isPropertyAccessExpression(ic)) {
        const arg = n.arguments[0];
        if (arg && ts.isObjectLiteralExpression(arg)) {
          const w = arg.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === "where");
          if (w && ts.isPropertyAssignment(w) && ts.isObjectLiteralExpression(w.initializer)) {
            const { yas, alan } = yasYuklemi(w.initializer, sf);
            if (yas) {
              out.push({
                model: ic.name.text.charAt(0).toUpperCase() + ic.name.text.slice(1),
                dosya, satir: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, yas, alan,
              });
            }
          }
        }
      }
    }
    n.forEachChild(gez);
  };
  gez(sf);
  return out;
}

function main(): void {
  console.log("=== TELEMETRİ ≠ DEFTER ===\n");
  const beyan = new Map<string, { sinif: string; silen?: string[] }>([
    ...DEFTER_BEYANI.map((b) => [b.model, { sinif: b.sinif, silen: b.silen }] as const),
    ...BUDANAN_DEFTER_DISI.map((b) => [b.model, { sinif: b.sinif, silen: b.silen }] as const),
  ]);
  const telemetri = [
    ...DEFTER_BEYANI.filter((b) => b.sinif === "TELEMETRI").map((b) => ({ model: b.model, silen: b.silen })),
    ...BUDANAN_DEFTER_DISI.map((b) => ({ model: b.model, silen: b.silen })),
  ];

  const budamalar: BudamaYeri[] = [];
  for (const f of walkTs(join(KOK, "src"))) {
    const rel = relative(KOK, f);
    budamalar.push(...budamalariTara(readFileSync(f, "utf8"), rel));
  }

  check("§1 körlük zemini: yaş budaması bulundu", budamalar.length > 0,
    `${budamalar.length} yaş yüklemli deleteMany · ${telemetri.length} TELEMETRİ beyanı`);

  // §2 ⭐ ASIL KURAL: budanan tablo SINIFSIZ kalamaz.
  const sinifsiz = budamalar.filter((b) => !beyan.has(b.model));
  check("§2 ⭐ YAŞA göre budanan her tablo beyan tablosunda SINIFLANMIŞ", sinifsiz.length === 0,
    sinifsiz.length
      ? `SINIFSIZ: ${sinifsiz.map((b) => `${b.model} (${b.dosya}:${b.satir})`).join(" · ")} — budanan bir tablo sınıfı beyan edilmeden budanamaz`
      : budamalar.map((b) => `${b.model}[${beyan.get(b.model)!.sinif}]`).join(" · "));

  // §3 ⭐ TELEMETRİ'nin budayanı BEYANLI ve küme BİREBİR (iki yönlü — ölü beyan da kırmızı).
  for (const t of telemetri) {
    const gercek = [...new Set(budamalar.filter((b) => b.model === t.model).map((b) => b.dosya))].sort();
    const beyanli = [...(t.silen ?? [])].sort();
    if (gercek.length === 0 && beyanli.length === 0) {
      console.log(`   ⓘ ${t.model} — budayıcı HENÜZ YOK (beyan da yok); indiği gün §2/§3 sorar`);
      continue;
    }
    const yeni = gercek.filter((d) => !beyanli.includes(d));
    const olu = beyanli.filter((d) => !gercek.includes(d));
    check(`§3 ${t.model} budayan dosya kümesi beyanla BİREBİR`, yeni.length === 0 && olu.length === 0,
      [yeni.length ? `BEYANSIZ budayıcı: ${yeni.join(", ")}` : "", olu.length ? `ÖLÜ beyan: ${olu.join(", ")}` : ""].filter(Boolean).join(" · ")
        || `${gercek.length} dosya`);
    check(`§4 ${t.model} budayan yol TEK dosyada (④ kuralı)`, gercek.length <= 1, `${gercek.length} dosya: ${gercek.join(", ")}`);
  }

  // §5 — DEFTER sınıfı YAŞA göre budanamaz: bu kuralın ta kendisidir.
  // ÖLÜ BEYAN: defter-dışı listede olup artık budanmayan tablo — muafiyet sessizce kalır.
  const oluDisi = BUDANAN_DEFTER_DISI.filter((b) => !budamalar.some((x) => x.model === b.model)).map((b) => b.model);
  check("§4b defter-dışı beyan listesinde ölü satır yok", oluDisi.length === 0,
    oluDisi.length ? `ÖLÜ: ${oluDisi.join(", ")}` : `${BUDANAN_DEFTER_DISI.length} satır`);

  const defterBudanan = budamalar.filter((b) => beyan.get(b.model)?.sinif === "DEFTER");
  check("§5 ⭐ DEFTER sınıflı tablo YAŞA göre budanmıyor", defterBudanan.length === 0,
    defterBudanan.length ? defterBudanan.map((b) => `${b.model} ← ${b.dosya}:${b.satir}`).join(" · ") : "defter budanmıyor");

  console.log("\n=== §6 SONDALAR (saf yüklem) ===");
  const S = (k: string) => budamalariTara(k, "sonda.ts");
  check("§6a ⭐ `lt` tarih eşiği YAŞ budamasıdır",
    S("await prisma.x.deleteMany({ where: { day: { lt: cutoff } } });")[0]?.alan === "day");
  check("§6b ⭐ `lte` de sayılır", S("await prisma.x.deleteMany({ where: { createdAt: { lte: c } } });").length === 1);
  check("§6c ⭐ KİMLİK yüklemi budama DEĞİL (temizlik — §10b'nin konusu)",
    S("await prisma.x.deleteMany({ where: { rollId: { in: ids } } });").length === 0);
  check("§6d ⭐ çıplak eşitlik budama DEĞİL", S("await prisma.x.deleteMany({ where: { code: \"TEST\" } });").length === 0);
  check("§6e iç içe yüklemde de bulunur (AND)",
    S("await prisma.x.deleteMany({ where: { AND: [{ day: { lt: c } }] } });")[0]?.alan === "day");
  check("§6f model adı büyük harfe çevrilir", S("await prisma.endpointLatencyDaily.deleteMany({ where: { day: { lt: c } } });")[0]?.model === "EndpointLatencyDaily");

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
