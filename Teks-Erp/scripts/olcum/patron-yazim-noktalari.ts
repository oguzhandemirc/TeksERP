// =============================================================================
// PATRON BULUTU — YAZIM NOKTALARI ÖLÇÜMÜ (DB'SİZ, statik)
// Çalıştır: npx tsx scripts/olcum/patron-yazim-noktalari.ts [--json]
// =============================================================================
// `updatedAt` filigranı iki yerde kördür ve ikisi de ADIYLA ölçülür:
//   ① SATIR SİLEN yol — silinen satırın `updatedAt`i yoktur: Prisma `delete` /
//      `deleteMany` (delegate), İÇ İÇE silme (`lines: { deleteMany }` — delegate
//      çağrısı yok, model bağlamsal TİPTEN çözülür) ve ham `DELETE FROM`.
//   ①b GENEL hard delete — `BaseController.hardRemove` → `BaseService.hardDelete`
//      → `this.delegate.delete`: delegate DİNAMİKTİR, ① onu göremez (ölçüldü
//      2026-09-29: customers/items/warehouses ①'de sıfır görünüyordu). Rota
//      dosyasındaki `/:id/permanent` + `.hardRemove` bağından model çözülür.
//   ② HAM UPDATE — Prisma'nın `@updatedAt` kancasını atlar; SET listesinde
//      `updatedAt` yoksa ve bir OPT-IN kolon değişiyorsa değişiklik görünmez.
//      (Prisma `update`/`updateMany` `@updatedAt`i yazar — ölçüldü, belge §4.2.)
// Kapsam: katalogdaki kök + bağımlılık tabloları; yalnız `src/`. Tablo adı
// dinamik (`"${rule.table}"`) olan ham SQL AYRICA basılır — model çözülemez.
// Tip denetleyicili program kurar (≈ 30–60 sn).
// =============================================================================
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import * as ts from "typescript";
import { CONTEXT_COMPLETIONS, tipliProgram } from "../revoke-ast-tarama";
import { SILEN, defterYazimlariniTara } from "../lib/defter-yazim-tarama";
import { KAYIT_PROJEKSIYONLARI } from "./patron-katalog";

const KOK = join(__dirname, "..", "..");
const JSON_CIKTI = process.argv.includes("--json");

/** schema.prisma'dan model ↔ tablo (@@map) eşlemesi. */
function modelTablolari(): Map<string, string> {
  const sema = readFileSync(join(KOK, "prisma", "schema.prisma"), "utf8");
  const m = new Map<string, string>();
  let model: string | null = null;
  for (const satir of sema.split("\n")) {
    const b = /^model\s+(\w+)\s*\{/.exec(satir);
    if (b) { model = b[1]; m.set(model, model); continue; }
    const map = /^\s*@@map\("([^"]+)"\)/.exec(satir);
    if (model && map) m.set(model, map[1]);
    if (/^\}/.test(satir)) model = null;
  }
  return m;
}

/** İç içe GÜNCELLEME girdisi tipinden model adı (`<Model>UpdateManyWithout…NestedInput`). */
const ICICE_GUNCELLEME = /\b([A-Z]\w*?)(?:Unchecked)?Update(?:Many|One)(?:Without\w+?)?NestedInput\b/;
const ICICE_SILEN = new Set(["delete", "deleteMany"]);

interface Bulgu { tablo: string; model: string; dosya: string; satir: number; nasil: string }
interface HamGuncelleme {
  tablo: string; dosya: string; satir: number; setKolonlari: string[]; updatedAtYazar: boolean;
  optInDokunan: string[]; dinamik: boolean;
}


/**
 * ①b `/:id/permanent` → `controller.hardRemove` (BaseController) bağları. Model
 * rota dosyasındaki `modelName: "x"` sabitinden, o yoksa import edilen servis
 * dosyasından çözülür. Servis sınıfı `hardDelete`i eziyorsa gövdesinde
 * `super.hardDelete(` aranır: yoksa fiziksel silme DEĞİLDİR (ör. sipariş → iptal).
 */
interface GenelSilme { dosya: string; satir: number; model: string | null; sonuc: string }
function genelHardDeleteBaglari(): GenelSilme[] {
  const rotaDizini = join(KOK, "src", "routes");
  const out: GenelSilme[] = [];
  const modelAdlari = (metin: string): string[] => [...metin.matchAll(/modelName:\s*"(\w+)"/g)].map((m) => m[1]);
  for (const ad of readdirSync(rotaDizini).filter((f) => f.endsWith(".ts"))) {
    const yol = join(rotaDizini, ad);
    const metin = readFileSync(yol, "utf8");
    const satirlar = metin.split("\n");
    satirlar.forEach((satir, i) => {
      if (!/"\/:id\/permanent"/.test(satir) && !(/^\s*"\/:id\/permanent",?\s*$/.test(satir))) return;
      // Çok satırlı çağrı: bağlayıcı en fazla 6 satır aşağıda.
      const govde = satirlar.slice(i, i + 7).join(" ");
      if (!/\.hardRemove\b/.test(govde)) return;
      let modeller = modelAdlari(metin);
      let servisMetni: string | null = null;
      const imp = [...metin.matchAll(/import\s*\{([^}]+)\}\s*from\s*"(\.\.\/services\/[^"]+)"/g)];
      for (const m of imp) {
        const dosya = resolve(dirname(yol), `${m[2]}.ts`);
        let t: string;
        try { t = readFileSync(dosya, "utf8"); } catch { continue; }
        if (!/extends BaseService/.test(t)) continue;
        servisMetni = t;
        if (modeller.length === 0) modeller = modelAdlari(t);
      }
      const model = modeller.length === 1 ? modeller[0][0].toUpperCase() + modeller[0].slice(1) : null;
      let sonuc: string;
      if (!model) sonuc = `ÇÖZÜLEMEDİ (modelName: ${modeller.join(",") || "yok"}) — elle sınıflanır`;
      else if (servisMetni && /async hardDelete\(/.test(servisMetni)) {
        const govdeBas = servisMetni.indexOf("async hardDelete(");
        const sonraki = servisMetni.slice(govdeBas + 1).search(/\n  (?:async |private |public |static |\/\*\*)/);
        const hdGovde = servisMetni.slice(govdeBas, sonraki < 0 ? undefined : govdeBas + 1 + sonraki);
        sonuc = /super\.hardDelete\(/.test(hdGovde) ? "FİZİKSEL (guard'lı override → super.hardDelete)" : "override — fiziksel DEĞİL (gövde super.hardDelete çağırmıyor)";
      } else sonuc = "FİZİKSEL (BaseService.hardDelete, guard YOK)";
      out.push({ dosya: relative(KOK, yol), satir: i + 1, model, sonuc });
    });
  }
  return out;
}

function main(): void {
  const eslem = modelTablolari();
  const tabloModel = new Map([...eslem].map(([m, t]) => [t, m]));
  const ilgili = new Set<string>();
  for (const p of KAYIT_PROJEKSIYONLARI) {
    ilgili.add(p.kok.tablo);
    for (const b of p.bagimliliklar) ilgili.add(b.tablo);
  }
  const optIn = new Map<string, Set<string>>();
  for (const p of KAYIT_PROJEKSIYONLARI) optIn.set(p.kok.tablo, new Set(p.kolonlar.map((c) => c.kaynak)));

  const hedefler = new Map<string, { delegate: string; tablo: string }>();
  for (const t of ilgili) {
    const model = tabloModel.get(t);
    if (!model) continue;
    hedefler.set(model, { delegate: model[0].toLowerCase() + model.slice(1), tablo: t });
  }

  const hazir = tipliProgram(KOK, "tsconfig.json");
  const src = (rel: string): boolean => rel.startsWith("src/");

  // ① delegate delete/deleteMany + ham DELETE FROM (ortak altyapı)
  const { bulgular: silen, taranan } = defterYazimlariniTara(KOK, hedefler, src, "tsconfig.json", SILEN, hazir);
  const silmeler: Bulgu[] = silen.map((b) => ({ tablo: hedefler.get(b.model)!.tablo, model: b.model, dosya: b.dosya, satir: b.satir, nasil: b.nasil }));

  // ① iç içe silme + ② ham UPDATE — tek gezinti
  const hamlar: HamGuncelleme[] = [];
  const dinamikSilme: Array<{ dosya: string; satir: number; metin: string }> = [];
  /**
   * KÖRLÜK ZEMİNİ: SÖZDİZİMSEL olarak bulunan her iç içe silme (`x: { deleteMany }`).
   * Tipi çözülemeyen (gövdesi `Record<string, unknown>` olan BaseService yolu) AYRICA
   * basılır — "sıfır bulgu" ile "bakılamadı" aynı çıktıya inmesin.
   */
  const iciceTum: string[] = [];
  const iciceCozulemeyen: string[] = [];
  for (const sf of hazir.program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const rel = relative(KOK, sf.fileName);
    if (!src(rel)) continue;
    const satirNo = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const gez = (n: ts.Node): void => {
      // İç içe yük iki biçimde yazılır: `lines: { deleteMany }` (özellik) ve
      // `next.lines = { deleteMany }` (atama, BaseService gövdesi) — ikisi de sayılır.
      const yuk =
        ts.isPropertyAssignment(n) && ts.isObjectLiteralExpression(n.initializer)
          ? { alan: n.name.getText(sf), nesne: n.initializer }
          : ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
              ts.isPropertyAccessExpression(n.left) && ts.isObjectLiteralExpression(n.right)
            ? { alan: n.left.name.text, nesne: n.right }
            : null;
      if (yuk) {
        const sil = yuk.nesne.properties
          .filter((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name))
          .map((p) => (p.name as ts.Identifier).text)
          .filter((a) => ICICE_SILEN.has(a));
        if (sil.length > 0) {
          const tip = hazir.checker.getContextualType(yuk.nesne, CONTEXT_COMPLETIONS);
          const m = tip ? ICICE_GUNCELLEME.exec(hazir.checker.typeToString(tip)) : null;
          iciceTum.push(`${rel}:${satirNo(n)}`);
          if (!m) iciceCozulemeyen.push(`${rel}:${satirNo(n)} ${yuk.alan}.{${sil.join("+")}}`);
          if (m && hedefler.has(m[1])) {
            silmeler.push({ tablo: hedefler.get(m[1])!.tablo, model: m[1], dosya: rel, satir: satirNo(n), nasil: `${yuk.alan}.${sil.join("+")} (iç içe)` });
          }
        }
      }
      if (ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isStringLiteral(n)) {
        const metin = n.getText(sf);
        if (/DELETE\s+FROM\s+"?\$\{/i.test(metin)) dinamikSilme.push({ dosya: rel, satir: satirNo(n), metin: metin.slice(0, 80).replace(/\s+/g, " ") });
        const re = /UPDATE\s+"?(\$\{[^}]+\}|\w+)"?\s+(?:\w+\s+)?SET\s+([\s\S]*?)(?=\bWHERE\b|\bFROM\b|\bRETURNING\b|`|$)/gi;
        let u: RegExpExecArray | null;
        while ((u = re.exec(metin)) !== null) {
          const dinamik = u[1].startsWith("${");
          const tablo = dinamik ? `(dinamik ${u[1]})` : u[1];
          if (!dinamik && !ilgili.has(tablo)) continue;
          const setKolonlari = [...u[2].matchAll(/"(\w+)"\s*=/g)].map((x) => x[1]);
          const oi = optIn.get(tablo);
          hamlar.push({
            tablo, dosya: rel, satir: satirNo(n), setKolonlari, dinamik,
            updatedAtYazar: setKolonlari.includes("updatedAt"),
            optInDokunan: oi ? setKolonlari.filter((c) => oi.has(c)) : [],
          });
        }
      }
      n.forEachChild(gez);
    };
    gez(sf);
  }

  // ①b genel hard delete — fiziksel olanlar silme listesine katılır.
  const genel = genelHardDeleteBaglari();
  for (const g of genel) {
    if (!g.model || !g.sonuc.startsWith("FİZİKSEL")) continue;
    const h = hedefler.get(g.model);
    if (h) silmeler.push({ tablo: h.tablo, model: g.model, dosya: g.dosya, satir: g.satir, nasil: `BaseController.hardRemove → ${g.sonuc}` });
  }
  if (genel.length === 0) {
    console.error("ÖLÇÜLEMEDİ: hiç `/:id/permanent` → hardRemove bağı bulunamadı (2026-09-29'da ≥ 6 vardı) — tarama kör.");
    process.exit(1);
  }

  // Tablo başına silme özeti → katalogdaki `silme` stratejisiyle karşılaştır.
  const silmeTablolari = new Map<string, Bulgu[]>();
  for (const s of silmeler) {
    if (!silmeTablolari.has(s.tablo)) silmeTablolari.set(s.tablo, []);
    silmeTablolari.get(s.tablo)!.push(s);
  }
  const uyumsuz: string[] = [];
  for (const p of KAYIT_PROJEKSIYONLARI) {
    const var_ = silmeTablolari.has(p.kok.tablo);
    if (var_ && p.silme === "YOK") uyumsuz.push(`${p.ad}: katalog 'YOK' diyor ama ${p.kok.tablo} için ${silmeTablolari.get(p.kok.tablo)!.length} silme yolu var`);
    if (!var_ && p.silme === "DAMGA") uyumsuz.push(`${p.ad}: katalog 'DAMGA' diyor ama ${p.kok.tablo} için uygulama silme yolu YOK (kaskad/dinamik olabilir — şema ölçümü ③)`);
  }
  const gorunmezGuncelleme = hamlar.filter((h) => !h.dinamik && !h.updatedAtYazar && h.optInDokunan.length > 0);

  const sonuc = {
    taranan: taranan.length,
    silmeler: silmeler.sort((a, b) => a.tablo.localeCompare(b.tablo) || a.dosya.localeCompare(b.dosya) || a.satir - b.satir),
    genel, dinamikSilme, hamlar, gorunmezGuncelleme, uyumsuz, iciceTum, iciceCozulemeyen,
  };
  if (iciceTum.length === 0) {
    console.error("ÖLÇÜLEMEDİ: sözdizimsel iç içe silme bile bulunamadı (src'de en az 3 var, 2026-09-29) — tarama kör.");
    process.exit(1);
  }
  if (JSON_CIKTI) {
    console.log(JSON.stringify(sonuc, null, 2));
  } else {
    console.log(`# Patron bulutu yazım noktaları — ${sonuc.taranan} src dosyası tarandı\n`);
    console.log(`## ① Satır SİLEN yollar (${silmeler.length})`);
    for (const [t, l] of [...silmeTablolari].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`- ${t} (${l.length}): ${l.map((s) => `${s.dosya}:${s.satir} ${s.nasil}`).join(" · ")}`);
    }
    console.log(`\n## ①b Genel /permanent bağları (${genel.length}) — katalog dışı modeller dahil`);
    for (const g of genel) console.log(`- ${g.dosya}:${g.satir} ${g.model ?? "?"} → ${g.sonuc}`);
    console.log(`\n(körlük zemini: ${iciceTum.length} sözdizimsel iç içe silme; tipi ÇÖZÜLEMEYEN ${iciceCozulemeyen.length} — elle sınıflanır: ${iciceCozulemeyen.join(" · ") || "—"})`);
    console.log(`\n## ① Dinamik tablolu DELETE (${dinamikSilme.length}) — model çözülemez, elle sınıflanır`);
    for (const d of dinamikSilme) console.log(`- ${d.dosya}:${d.satir} ${d.metin}`);
    console.log(`\n## ② Ham UPDATE (${hamlar.length})`);
    for (const h of hamlar) {
      console.log(`- ${h.tablo} ${h.dosya}:${h.satir} SET[${h.setKolonlari.join(",")}] updatedAt:${h.updatedAtYazar ? "YAZAR" : "YAZMAZ"} opt-in:${h.optInDokunan.join(",") || "—"}`);
    }
    console.log(`\n## ②⭐ Filigrana GÖRÜNMEZ güncelleme (opt-in kolon değişir, updatedAt yazılmaz): ${gorunmezGuncelleme.length}`);
    for (const h of gorunmezGuncelleme) console.log(`- ${h.tablo} ${h.dosya}:${h.satir} → ${h.optInDokunan.join(",")}`);
    console.log(`\n## Katalog ↔ kod uyumsuzluğu (${uyumsuz.length})`);
    for (const u of uyumsuz) console.log(`- ${u}`);
  }
  process.exit(uyumsuz.length > 0 ? 1 : 0);
}

main();
