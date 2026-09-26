// =============================================================================
// Bekçi: "EN SON" OKUYUCUSU EŞİTLİK BOZUCUSUZ YAZILMAZ — defter okuyucuları cırcırı (DB'siz, AST)
// Çalıştır: npx tsx scripts/test_esitlik_bozucu.ts
// =============================================================================
// NEDEN: aynı tx'te aynı varlığa çok satır yazan defterde `createdAt` eşit düşebilir; tek satır okuyan
// (`findFirst` · `take: ±1`) ve yalnız `createdAt` ile sıralayan okuyucu o zaman rastgele UUID sırasına kalır.
// Kural: sıranın yanında `id` eşitlik bozucusu. Tarama `scripts/lib/esitlik-bozucu-tarama.ts`.
//   §1 saf sondalar (tarayıcının kendisi) · §2 körlük zemini · §3 her okunan model bir sınıfa düşer
//   (kapsam: DEFTER · SATIR_EBEVEYN · PIVOT_TICARI; muaf sınıf kümesi KAPALI, gerekçeli) · §4 borç CIRCIR
//   (artış sert; çürüme commit kapısında uyarı, CI'da sert — `circir-kolu`).
// Kalan risk: ham SQL `ORDER BY … LIMIT 1` ve değişkende tutulan delege (`const d = tx.x; d.findFirst`) görülmez.
//
// NEGATİF SONDA (2026-09-26, md5 ile geri alındı): `statusBeforeEntry`in `id` bozucusu kaldırıldı → §4a ❌ (26 > 25).
// POZİTİF SONDA (aynı gün): bir ChequeEvent okuyucusuna `id` eklendi → gerçek 24, CI kipinde §4b ❌, commit kapısı
//   kipinde ⏭ uyarı — taban düşürülebilir.
// =============================================================================
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";
import { atlamaDefteri } from "./lib/atlama";
import { curumeKolu } from "./lib/circir-kolu";
import { DEFTER_BEYANI, type DefterSinifi } from "./lib/defter-beyan";
import { delegeModeli, diskOkuyucu, okuyuculariTara, semaOku, type Okuyucu } from "./lib/esitlik-bozucu-tarama";
import { walkTs } from "./lib/ts-tarama";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}
const ATLAMA = atlamaDefteri((mesaj) => check(mesaj, false));

/** Kapsamdaki (defter) eşitlik bozucusuz ya da ölçülemeyen okuyucu sayısı — YALNIZ DÜŞER; sabiti entegratör trende düşürür. */
const BORC_TABANI = 15;

const KAPSAM = ["DEFTER", "SATIR_EBEVEYN", "PIVOT_TICARI"] as const;
type KapsamSinifi = (typeof KAPSAM)[number];
/** Muaf sınıflar — KAPALI küme: `DefterSinifi`e yeni sınıf gelirse tip burada karar ister. */
const MUAF_SINIFLARI: Record<Exclude<DefterSinifi, KapsamSinifi> | "DURUM_TABLOSU", string> = {
  PIVOT_YAPILANDIRMA: "saf ayar kümesi; kronoloji sorusu cevaplamaz",
  TELEMETRI: "budanabilir / yalnız ayak izi; iş kararına girmez",
  DURUM: "tek kullanımlık durum kaydı; olay dizisi değil",
  DURUM_TABLOSU: "`updatedAt` taşıyan durum tablosu (\"şu an ne\"); \"en son yaratılan satır\" bir olay kronolojisi değil",
};

const KOK = join(__dirname, "..");
const sema = semaOku(readFileSync(join(KOK, "prisma/schema.prisma"), "utf8"));
const beyanSinifi = new Map(DEFTER_BEYANI.map((b) => [b.model, b.sinif]));
const sinifi = (model: string): string | null =>
  beyanSinifi.get(model) ?? (sema.get(model)?.guncellenen ? "DURUM_TABLOSU" : null);

function saf(metin: string, sanal: Record<string, string> = {}): Okuyucu[] {
  const oku = (d: string) => (sanal[d] !== undefined ? ts.createSourceFile(d, sanal[d]!, ts.ScriptTarget.Latest, true) : null);
  return okuyuculariTara("/v/a.ts", metin, sema, oku);
}

function main(): void {
  console.log("=== EN SON OKUYUCUSU EŞİTLİK BOZUCUSU ===\n§1 Saf sondalar");
  // Sonda metni birleştirilerek kurulur: düz literal, keyfi-arama mandalına ortam araması gibi görünür.
  const c = (delege: string, yontem: string) => `p.${delege}.${yontem}`;
  const s = (m: string, sanal?: Record<string, string>) => saf(m, sanal).map((o) => `${o.model}:${o.sonuc}`).join(",");
  check("§1a findFirst yalnız createdAt → IHLAL", s(`${c("warehouseMovement", "findFirst")}({ where: {}, orderBy: { createdAt: "desc" } })`) === "WarehouseMovement:IHLAL");
  check("§1b id bozuculu dizi → UYUMLU", s(`${c("warehouseMovement", "findFirst")}({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] })`) === "WarehouseMovement:UYUMLU");
  check("§1c findMany take 1 → IHLAL; take'siz findMany kapsam dışı",
    s(`${c("chequeEvent", "findMany")}({ orderBy: { createdAt: "asc" }, take: 1 }); ${c("chequeEvent", "findMany")}({ orderBy: { createdAt: "asc" } })`) === "ChequeEvent:IHLAL");
  check("§1d iç içe ilişki `take: 1` hedef modeliyle yakalanır",
    s(`${c("roll", "findMany")}({ include: { warehouseMovements: { orderBy: { createdAt: "desc" }, take: 1 } } })`) === "WarehouseMovement:IHLAL");
  check("§1e aynı dosyadaki const (`satisfies`) çözülür",
    s(`const D = [{ createdAt: "desc" }, { id: "desc" }] satisfies X[]; ${c("cariTransaction", "findFirst")}({ orderBy: D })`) === "CariTransaction:UYUMLU");
  check("§1f göreli import edilen const çözülür (yeniden adlandırmalı)",
    s(`import { S as T } from "./sira"; ${c("workOrderEvent", "findFirst")}({ orderBy: T })`, { "/v/sira.ts": `export const S = { createdAt: "desc" } as const;` }) === "WorkOrderEvent:IHLAL");
  check("§1g çözülemeyen ifade ÖLÇÜLEMEDİ (sessizce uyumlu değil)", s(`${c("rollOperation", "findFirst")}({ orderBy: siraYap() })`) === "RollOperation:OLCULEMEDI");
  check("§1h koşullu ifadede kötü kol IHLAL", s(`${c("rollOperation", "findFirst")}({ orderBy: k ? { createdAt: "asc" } : [{ createdAt: "desc" }, { id: "desc" }] })`) === "RollOperation:IHLAL");
  check("§1i createdAt'siz sıra ve model olmayan delege sayılmaz", s(`${c("rollOperation", "findFirst")}({ orderBy: { seq: "desc" } }); ${c("foo", "findFirst")}({ orderBy: { createdAt: "desc" } })`) === "");

  console.log("§2 Körlük zemini");
  const dosyalar = walkTs(join(KOK, "src"));
  const oku = diskOkuyucu();
  const hepsi = dosyalar.flatMap((d) => okuyuculariTara(d, readFileSync(d, "utf8"), sema, oku)).map((o) => ({ ...o, dosya: relative(KOK, o.dosya) }));
  check("§2a src taranıyor ve createdAt'li tek satır okuyucusu bulundu", dosyalar.length > 100 && hepsi.length > 20, `${dosyalar.length} dosya · ${hepsi.length} okuyucu`);
  check("§2b delege → model çözümü şemadan", delegeModeli(sema, "warehouseMovement") === "WarehouseMovement" && delegeModeli(sema, "yok") === null);

  console.log("§3 Sınıf");
  const sinifsiz = [...new Set(hepsi.filter((o) => sinifi(o.model) === null).map((o) => o.model))];
  check("§3a okunan her model bir sınıfa düşer (defter beyanı ya da `updatedAt`)", sinifsiz.length === 0, sinifsiz.join(", "));
  const bilinmeyen = [...new Set(hepsi.map((o) => sinifi(o.model)).filter((c): c is string => c !== null))]
    .filter((c) => !(KAPSAM as readonly string[]).includes(c) && !(c in MUAF_SINIFLARI));
  check("§3b her sınıf ya kapsamda ya KAPALI muaf kümede", bilinmeyen.length === 0, bilinmeyen.join(", "));

  console.log("§4 Borç cırcırı");
  const borcList = hepsi.filter((o) => o.sonuc !== "UYUMLU" && (KAPSAM as readonly string[]).includes(sinifi(o.model) ?? ""));
  const muaf = hepsi.filter((o) => o.sonuc !== "UYUMLU" && !(KAPSAM as readonly string[]).includes(sinifi(o.model) ?? ""));
  const grup = new Map<string, number>();
  for (const o of borcList) grup.set(`${o.model}${o.sonuc === "OLCULEMEDI" ? " (ölçülemedi)" : ""}`, (grup.get(`${o.model}${o.sonuc === "OLCULEMEDI" ? " (ölçülemedi)" : ""}`) ?? 0) + 1);
  console.log(`   ⓘ defter borcu ${borcList.length}: ${[...grup].map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  for (const o of borcList) console.log(`      ${o.dosya}:${o.satir} ${o.model} ${o.bicim}${o.sonuc === "OLCULEMEDI" ? " (ölçülemedi)" : ""}`);
  console.log(`   ⓘ muaf sınıfta bozucusuz okuyucu ${muaf.length} (sayılmaz)`);
  check("⭐ §4a defter okuyucusu borcu ARTMADI", borcList.length <= BORC_TABANI, `gerçek ${borcList.length} · taban ${BORC_TABANI}`);
  curumeKolu(check, ATLAMA.atla, "§4b borç tabanı ÇÜRÜMEDİ (bozucu eklenen okuyucu listeden düştü)", borcList.length, BORC_TABANI);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
