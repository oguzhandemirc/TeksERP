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

export type AynaEksigi = {
  /** Beyanda VAR, mobilde YOK — kesişim boş, §1 bu tipi hiç ölçmez. */
  beyanliAmaYok: string[];
  /** Mobilde VAR, beyanda YOK — beyan bayatlamış; silinse §1 sessizce susardı. */
  aynaliAmaBeyansiz: string[];
  /** Beyanda VAR ama backend enum'u değil — yazım hatası ya da silinmiş enum. */
  beyanliAmaEnumDegil: string[];
};

/**
 * ⭐ KESİŞİM BOŞ OLAN TİP, SESSİZ YEŞİLDİR. §1'in kapsamı `backend ∩ mobil`;
 * mobilde HİÇ karşılığı olmayan bir backend enum'u kapsamdan düşer ve
 * ölçülmediği hiçbir yerde görünmez (`MachineDataSource` böyle kaçtı —
 * ölçüldü 2026-09-14: 81 backend enum, 16 mobil type, kesişim 13).
 * Bu, sınırsız eşleşmenin ÜÇÜNCÜ biçimidir: kelime sınırı ya da bağlam değil,
 * **BOŞ KÜME**. ⇒ Kesişim bir kapsam DEĞİL, bir SONUÇTUR; kapsamı BEYAN belirler.
 */
export function aynaEksikleriOlc(
  backendAdlari: Set<string>,
  mobilAdlari: Set<string>,
  beklenen: Set<string>,
): AynaEksigi {
  return {
    beyanliAmaYok: [...beklenen].filter((t) => backendAdlari.has(t) && !mobilAdlari.has(t)).sort(),
    aynaliAmaBeyansiz: [...mobilAdlari].filter((t) => backendAdlari.has(t) && !beklenen.has(t)).sort(),
    beyanliAmaEnumDegil: [...beklenen].filter((t) => !backendAdlari.has(t)).sort(),
  };
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

// ─────────────────────────────────────────────────────────────────────────────
// MOBİLDE AYNASI OLMASI BEKLENEN backend enum'ları — BEYAN, envanter DEĞİL.
//
// Hangi enum'ların VAR OLDUĞU ölçülür (`backendEnumlari`/`mobilTipleri`); bu
// liste hangisinin AYNALANMASI GEREKTİĞİNİ söyler. İkisi ayrı şeydir: kesişim
// bir SONUÇTUR, kapsam bir KARARDIR. Liste olmadan, mobilde hiç karşılığı
// olmayan bir enum "ölçülmedi" bile demeden düşer.
//
// ⛔ Satır eklemek/çıkarmak bir KARARDIR. Liste kendi kendini tazeler: mobilde
//    AYNALI olup burada YAZMAYAN bir tip §0f'de KIRMIZI verir (yoksa beyan
//    bayatlar ve mobilden silinen bir union sessizce kapsam dışına çıkardı).
// ⛔ GEREKÇE UYDURULMAZ: bugün aynalı olanların gerekçesi ÖLÇÜLEN olgudur
//    ("bugün mobilde aynalı"); niçin aynalandıkları ölçülmedi.
// ─────────────────────────────────────────────────────────────────────────────
const MOBILDE_BEKLENEN: Record<string, string> = {
  CompanyType: "bugün mobilde aynalı (ölçüldü 2026-09-14)",
  DefectSeverity: "bugün mobilde aynalı (ölçüldü 2026-09-14)",
  LabelKind: "bugün mobilde aynalı (ölçüldü 2026-09-14)",
  OrderStatus: "bugün mobilde aynalı (ölçüldü 2026-09-14)",
  QualityGradeRole: "bugün mobilde aynalı (ölçüldü 2026-09-14)",
  RollEntrySource: "bugün mobilde aynalı (ölçüldü 2026-09-14)",
  RollStatus: "bugün mobilde aynalı (ölçüldü 2026-09-14)",
  StationKind: "bugün mobilde aynalı (ölçüldü 2026-09-14)",
  StationType: "bugün mobilde aynalı (ölçüldü 2026-09-14)",
  StepStatus: "bugün mobilde aynalı (ölçüldü 2026-09-14)",
  TravelerCardStatus: "bugün mobilde aynalı (ölçüldü 2026-09-14)",
  WorkOrderStatus: "bugün mobilde aynalı (ölçüldü 2026-09-14)",
  WorkOrderType: "bugün mobilde aynalı (ölçüldü 2026-09-14)",
  // Bugün mobilde YOK; borç `BEKLENEN_EKSIK`te beyanlı (aşağıda).
  MachineDataSource: "tablet dilimi BEKLENİYOR — beyanlı eksik",
};

// ─────────────────────────────────────────────────────────────────────────────
// BEKLENEN AMA HENÜZ YOK — beyanlı eksikler. Her girdi TARİH · SAHİP · KAPANIŞ
// CÜMLESİ taşır; sahipsiz ya da kapanışsız bir borç, borç değil bir alışkanlıktır.
//
// ÜÇ SONUÇ (1e hükmü 2026-09-14):
//   girdi VAR ∧ union YOK → ⚠️ SESLİ, kırmızı DEĞİL — borç görünür, kapı susmaz
//   girdi VAR ∧ union VAR → ❌ beyan BAYAT ⇒ girdi silinir (§0h)
//   girdi YOK ∧ union YOK → ❌ (§0e) — beyansız eksik kabul edilmez
//
// ⚠️ NEDEN SÜREKLİ KIRMIZI DEĞİL (ölçüldü 2026-09-14, 47/47 günü): *sürekli bir
// kırmızı sessiz değildir, DUYULMAZDIR.* Her turda kırmızı basan bir kapı
// listeyi okuyanın gözünde arka plana karışır ve YENİ bir kırmızıyı da gizler;
// bedelini yalnız borcun sahibi değil, o listeye bakan herkes öder. Emsal:
// stok defterinin `K_TABAN` cırcırı.
// ─────────────────────────────────────────────────────────────────────────────
const BEKLENEN_EKSIK: Record<string, { tarih: string; sahip: string; kapanis: string }> = {
  MachineDataSource: {
    tarih: "2026-09-14",
    sahip: "0c/47 — tablet dilimi",
    kapanis: "mobil `models.ts`e `MachineDataSource` union'ı doğunca bu girdi SİLİNİR",
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

  // ── §0d–§0g KESİŞİMİN KÖR NOKTASI ─────────────────────────────────────────
  // §1'in kapsamı `backend ∩ mobil`; kesişimden düşen tip HİÇ ölçülmez ve bunu
  // hiçbir satır söylemez. Beyan bu boşluğu kapatır.
  const eksik = aynaEksikleriOlc(
    new Set(be.keys()),
    new Set(mo.keys()),
    new Set(Object.keys(MOBILDE_BEKLENEN)),
  );
  check(
    "§0d beyandaki her ad GERÇEK bir backend enum'u",
    eksik.beyanliAmaEnumDegil.length === 0,
    eksik.beyanliAmaEnumDegil.length === 0
      ? `${Object.keys(MOBILDE_BEKLENEN).length} beyan`
      : `${eksik.beyanliAmaEnumDegil.join(",")} ⇒ enum silindi ya da ad yanlış yazıldı`,
  );
  // Beyanlı eksik = BİLİNEN borç (⚠️ sesli) · beyansız eksik = KIRMIZI.
  const beyansizEksik = eksik.beyanliAmaYok.filter((t) => !BEKLENEN_EKSIK[t]);
  const beyanliEksik = eksik.beyanliAmaYok.filter((t) => BEKLENEN_EKSIK[t]);
  check(
    "§0e ⭐ beyanlı her tipin mobilde AYNASI VAR (kesişim boş değil)",
    beyansizEksik.length === 0,
    beyansizEksik.length === 0
      ? `boş kesişim yok${beyanliEksik.length ? ` (${beyanliEksik.length} beyanlı eksik ⚠️ aşağıda)` : ""}`
      : beyansizEksik.join(",") +
          "  ⇒ mobil union'ı HİÇ YOK: §1 bu tipi ölçmedi, ÖLÇEMEZ de — sessiz yeşil." +
          " Çare mobil `models.ts`e union'ı eklemek; beyandan silmek DEĞİL." +
          " Bilinçli bir borçsa BEKLENEN_EKSIK'e tarih + sahip + kapanış cümlesiyle yaz.",
  );
  for (const t of beyanliEksik) {
    const b = BEKLENEN_EKSIK[t];
    console.log(`⚠️ §0e BEYANLI EKSİK — ${t}: mobil union'ı YOK · ${b.tarih} · sahip: ${b.sahip}\n   ↳ ${b.kapanis}`);
  }
  // ⭐ İKİ YÖNLÜ: borç kapandıysa beyan da kapanır, yoksa taban çürür.
  const bayatBeyan = Object.keys(BEKLENEN_EKSIK).filter((t) => mo.has(t));
  check(
    "§0h ⭐ BEKLENEN_EKSIK girdisi hâlâ geçerli (borç kapandıysa beyan da kapanır)",
    bayatBeyan.length === 0,
    bayatBeyan.length === 0
      ? `${Object.keys(BEKLENEN_EKSIK).length} beyanlı eksik`
      : `${bayatBeyan.join(",")} ⇒ mobil union'ı DOĞMUŞ; BEKLENEN_EKSIK'ten SİL (kapanış cümlesi bunu söylüyordu)`,
  );
  check(
    "§0i BEKLENEN_EKSIK'teki her ad MOBILDE_BEKLENEN'de de var",
    Object.keys(BEKLENEN_EKSIK).every((t) => MOBILDE_BEKLENEN[t] !== undefined),
    Object.keys(BEKLENEN_EKSIK)
      .filter((t) => MOBILDE_BEKLENEN[t] === undefined)
      .join(",") || "tutarlı",
  );
  check(
    "§0f ⭐ mobilde aynalı her tip BEYANDA da var (beyan bayatlamasın)",
    eksik.aynaliAmaBeyansiz.length === 0,
    eksik.aynaliAmaBeyansiz.length === 0
      ? "beyan taze"
      : `${eksik.aynaliAmaBeyansiz.join(",")} ⇒ MOBILDE_BEKLENEN'e ekle (yoksa mobilden silindiği gün §1 sessizce susar)`,
  );
  // ⏭ SESLİ: beyan dışı yüzey ölçülmez — ama ölçülmediği GÖRÜNÜR.
  const beyanDisi = [...be.keys()].filter((k) => !MOBILDE_BEKLENEN[k]).sort();
  const mobildeVarBackenddeYok = [...mo.keys()].filter((k) => !be.has(k)).sort();
  console.log(
    `⏭ §0g beyan dışı ${beyanDisi.length} backend enum ÖLÇÜLMEDİ (tablette karşılığı beklenmiyor) — ` +
      `${beyanDisi.slice(0, 6).join(",")}${beyanDisi.length > 6 ? ", …" : ""}`,
  );
  console.log(
    `⏭ §0g mobilde union'ı olup backend'de enum'u OLMAYAN ${mobildeVarBackenddeYok.length} tip ÖLÇÜLMEDİ ` +
      `(ayna değil, mobilin kendi tipi) — ${mobildeVarBackenddeYok.join(",") || "—"}`,
  );
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
  // BOŞ KÜME sondaları — §1'in kapsamı kesişim olduğu için bu üç durumun
  // hiçbirini göremez; §0d–§0f'nin ısırdığı yer burasıdır.
  const eks = (bes: string[], mos: string[], bek: string[]) =>
    aynaEksikleriOlc(S(bes), S(mos), S(bek));
  check(
    "§3f ⭐ beyanlı ama mobilde YOK → yakalanır (kesişim boş)",
    eks(["A", "B"], ["A"], ["A", "B"]).beyanliAmaYok.join() === "B",
    "eski hâlde bu tip kapsamdan düşer ve HİÇBİR satır basılmazdı",
  );
  check(
    "§3g ⭐ mobilde aynalı ama BEYANSIZ → yakalanır (beyan bayatlamasın)",
    eks(["A", "B"], ["A", "B"], ["A"]).aynaliAmaBeyansiz.join() === "B",
  );
  check(
    "§3h ⭐ beyanda var ama backend enum'u değil → yakalanır",
    eks(["A"], ["A"], ["A", "C"]).beyanliAmaEnumDegil.join() === "C",
  );
  check(
    "§3i beyanlı + iki yanda da var → üç liste de BOŞ (yanlış pozitif yok)",
    (() => {
      const e = eks(["A"], ["A"], ["A"]);
      return e.beyanliAmaYok.length === 0 && e.aynaliAmaBeyansiz.length === 0 && e.beyanliAmaEnumDegil.length === 0;
    })(),
  );
  console.log("");

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
