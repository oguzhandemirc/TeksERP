// =============================================================================
// MOBİL ENUM AYNASI — backend `enum X` ↔ `mobil/src/types/models.ts` `type X`
//
// NEDEN VAR (ölçüldü 2026-09-13): `RollEntrySource` mobilde backend'in GERİSİNDE
// kaldı (`PURCHASE_RECEIPT` 2026-08-13, `SEMI_FINISHED` 2026-08-17 eklendi, mobil
// union'a hiç girmedi) ve bunu ÖLÇEN hiçbir bekçi yoktu. Sapma sessizdir:
// backend o değeri gönderdiğinde mobil TS tipi YALAN SÖYLER — derleyici susar,
// `switch` dalı düşer, arayüz boş/yanlış etiket basar.
//
// ⚠️ ENVANTER ÖLÇÜLÜR, ELLE YAZILMAZ: kapsam = backend enum adları ∩ mobil
// `export type` adları. Yeni bir aynalı tip doğduğu gün kendiliğinden kapsama
// girer — elle tutulan bir liste onu sessizce dışarıda bırakırdı.
//
// ⚠️ TABAN BEYANLI: bugün 5 sapma VAR ve mandal doğduğu gün ısıramaz. Her
// kabul edilen sapma ADIYLA ve GEREKÇESİYLE aşağıda durur; beyan edilmemiş
// HER sapma kırmızıdır. Taban İKİ YÖNLÜDÜR: beyan edilen bir sapma ortadan
// kalkarsa da kırmızı verir ("taban çürümesin").
//
// ⛔ GEREKÇELER UYDURULMAZ: bugün ölçülen şey SAPMANIN KENDİSİ; sapmanın NEDEN
// var olduğu ölçülmedi ve o satırlarda "gerekçe ÖLÇÜLMEDİ" yazar. Bir tabanın
// dürüst hâli, bilmediğini de yazandır.
//
// Koşum: npx tsx scripts/test_mobil_enum_aynasi.ts
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const SEMA = path.resolve(__dirname, "../prisma/schema.prisma");
const MOBIL = path.resolve(__dirname, "../../mobil/src/types/models.ts");

/**
 * ⚠️ YORUMLAR ÖNCE SOYULUR. İlk yazımda soymamıştım ve `RollStatus` bloğu
 * `'KARTELA_CONSUMED'; // Kartela kabulünde kapandı` ile bittiği için `;$`
 * çapası tutmadı: ayrıştırıcı BİR SONRAKİ tipi de yuttu ve `RollStatus`u
 * 20 değerli gösterdi (gerçek 13). Elle doğrulama yakaladı.
 * ⇒ *Bir ayrıştırıcı, ölçtüğü dilin YORUM kurallarını da bilmek zorundadır.*
 */
export function yorumlariSoy(kaynak: string): string {
  return kaynak
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

export function backendEnumlari(sema: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of sema.matchAll(/^enum (\w+) \{(.*?)^\}/gms)) {
    const govde = yorumlariSoy(m[2]);
    out.set(m[1], new Set([...govde.matchAll(/^\s{2}([A-Z][A-Z0-9_]*)/gm)].map((x) => x[1])));
  }
  return out;
}

export function mobilTipleri(kaynak: string): Map<string, Set<string>> {
  const temiz = yorumlariSoy(kaynak);
  const out = new Map<string, Set<string>>();
  for (const m of temiz.matchAll(/^export type (\w+)\s*=(.*?);/gms)) {
    const degerler = [...m[2].matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((x) => x[1]);
    if (degerler.length > 0) out.set(m[1], new Set(degerler));
  }
  return out;
}

export type Sapma = { geride: string[]; fazla: string[] };

export function sapmaOlc(be: Set<string>, mo: Set<string>): Sapma {
  return {
    geride: [...be].filter((x) => !mo.has(x)).sort(),
    fazla: [...mo].filter((x) => !be.has(x)).sort(),
  };
}

export const sapmaVar = (s: Sapma): boolean => s.geride.length > 0 || s.fazla.length > 0;
export const sapmaMetni = (s: Sapma): string =>
  [s.geride.length ? `GERİDE: ${s.geride.join(",")}` : "", s.fazla.length ? `FAZLA: ${s.fazla.join(",")}` : ""]
    .filter(Boolean)
    .join(" | ");

// ─────────────────────────────────────────────────────────────────────────────
// BEYAN EDİLMİŞ TABAN — her satır bir KABUL, ve gerekçesi yanında.
// ⛔ Buraya satır eklemek bir KARARDIR: "bu sapma bilinçli" demektir.
// ─────────────────────────────────────────────────────────────────────────────
const TABAN: Record<string, { sapma: string; gerekce: string }> = {
  CompanyType: {
    sapma: "GERİDE: SUPPLIER | FAZLA: SUBCONTRACTOR",
    gerekce: "gerekçe ÖLÇÜLMEDİ — sahibi tablet alanı",
  },
  TravelerCardStatus: {
    sapma: "GERİDE: REPRINTED",
    gerekce: "gerekçe ÖLÇÜLMEDİ — sahibi tablet alanı",
  },
  WorkOrderStatus: {
    sapma: "GERİDE: SUPERSEDED | FAZLA: PARTIAL_SHIPPED",
    gerekce: "gerekçe ÖLÇÜLMEDİ — sahibi tablet alanı",
  },
  WorkOrderType: {
    sapma: "FAZLA: REPAIR_REWORK,SAMPLE_PRODUCTION",
    gerekce: "backend'de HİÇ var olmadı (emsal: 'KK1_INITIAL'/'MANUAL'); gerekçe ÖLÇÜLMEDİ",
  },
};

function main(): void {
  console.log("\n=== Mobil enum aynası — backend enum ↔ mobil union ===\n");

  const sema = readFileSync(SEMA, "utf8");
  const mobilKaynak = readFileSync(MOBIL, "utf8");
  const be = backendEnumlari(sema);
  const mo = mobilTipleri(mobilKaynak);

  // ── §0 KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  // Boş bir kapsam, her şeyi yeşil geçirirdi.
  console.log("§0 — körlük zemini");
  check("§0a backend enum'ları okundu", be.size > 50, `${be.size} enum`);
  check("§0b mobil tipleri okundu", mo.size > 10, `${mo.size} type`);
  const kapsam = [...be.keys()].filter((k) => mo.has(k)).sort();
  check("§0c ⭐ ayna kapsamı ÖLÇÜLDÜ (elle liste yok)", kapsam.length > 0, `${kapsam.length} aynalı tip`);
  console.log("");

  // ── §1 SAPMA ──────────────────────────────────────────────────────────────
  console.log("§1 — her aynalı tip: beyan edilmemiş sapma YOK");
  const gercekSapmalar = new Map<string, Sapma>();
  for (const t of kapsam) {
    const s = sapmaOlc(be.get(t)!, mo.get(t)!);
    if (sapmaVar(s)) gercekSapmalar.set(t, s);
    const beyan = TABAN[t];
    if (!sapmaVar(s)) {
      check(`§1 ${t} birebir`, true, `${be.get(t)!.size} değer`);
    } else if (beyan && beyan.sapma === sapmaMetni(s)) {
      check(`§1 ${t} sapma BEYANLI`, true, `${sapmaMetni(s)} · ${beyan.gerekce}`);
    } else {
      check(
        `§1 ⭐ ${t} BEYAN EDİLMEMİŞ sapma`,
        false,
        `${sapmaMetni(s)}${beyan ? ` (beyan başka: ${beyan.sapma})` : ""} ⇒ mobil union'a ekle ya da TABAN'a gerekçesiyle yaz`,
      );
    }
  }
  console.log("");

  // ── §2 TABAN ÇÜRÜMESİN (iki yönlü) ────────────────────────────────────────
  console.log("§2 — taban çürümesin: kapanan sapma TABAN'da kalmaz");
  for (const t of Object.keys(TABAN)) {
    const s = gercekSapmalar.get(t);
    check(
      `§2 ⭐ ${t} hâlâ sapıyor`,
      s !== undefined && sapmaMetni(s) === TABAN[t].sapma,
      s === undefined ? "sapma KAPANDI ⇒ TABAN'dan SİL" : `gerçek: ${sapmaMetni(s)}`,
    );
  }
  console.log("");

  // ── §3 SONDALAR ───────────────────────────────────────────────────────────
  console.log("§3 — sondalar");
  const S = (a: string[]) => new Set(a);
  check("§3a ⭐ eksik değer GERİDE sayılır", sapmaOlc(S(["A", "B"]), S(["A"])).geride.join() === "B");
  check("§3b ⭐ fazla değer FAZLA sayılır", sapmaOlc(S(["A"]), S(["A", "B"])).fazla.join() === "B");
  check("§3c birebir küme sapma vermez", !sapmaVar(sapmaOlc(S(["A"]), S(["A"]))));
  check(
    "§3d ⭐ SATIR-İÇİ YORUM blok sınırını gizlemez",
    mobilTipleri("export type X =\n  | 'A'; // kuyruk yorumu\nexport type Y =\n  | 'B';").get("X")?.size === 1,
    "ilk yazımda bu yüzden RollStatus 20 değerli görünüyordu",
  );
  check(
    "§3e ⭐ enum gövdesindeki yorum değer sanılmaz",
    backendEnumlari("enum Z {\n  A // not\n  B\n}").get("Z")?.size === 2,
  );
  console.log("");

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
