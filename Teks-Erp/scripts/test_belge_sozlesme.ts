// =============================================================================
// Bekçi: BELGE VERİ SÖZLEŞMESİ — tasarımcı şablonunun gördüğü bağlam (DB gerekmez)
// Çalıştır: npx tsx scripts/test_belge_sozlesme.ts
//           (özet yenileme: npx tsx scripts/lib/belge-sozlesme-ozeti.ts --yaz)
// =============================================================================
// Plan `docs/design/BELGE-SABLON-TASARIMCISI-PLAN.md` §3.1 (T0). Şablon belgeyi YALNIZ
// `sozlesme/` katmanının ürettiği düz JSON'dan görür; bu katman üç sözü kilitler:
//   · iç alan OPT-IN, tek kapı `internalFields` (Z4) — müşteri belgesine sızmaz
//   · sözleşme YALNIZ BÜYÜR — yayınlanmış şablonun atıf yaptığı yol kaybolmaz
//   · eski/eksik snapshot baskıyı düşürmez — eksik değer null olur
// §0 kayıt · §1 her senaryoda bütün yollar · §2 iç alan kapısı · §3 özet yalnız büyür
// §4 eski snapshot · §5 ayarNormalize eksiksiz · §6 pilot: altın fikstür + renderer hizası
// §7 refakat kartı: uzman kataloğu ↔ sözleşme eşleme tablosu iki yönlü hiza
// §8 `ornek` senaryosunda toplam kolonu satır toplamı = toplamlar.<k> (tasarımcı örnek belgesi)
//
// Negatif sondalar (2026-10-24): `belge.plaka` silindi → §3 ❌ · `fillFields` iç alanı opt-in'siz
// yazdı → §2 ❌ · `belge.no` türü değişti → §1+§3 ❌ · `cuval_iz` ic→musteri → §3 ❌ · `getContract`
// bilinmeyende ilk sözleşmeye düştü → §0 ❌ · `toplamlar.metre` satırlardan toplandı → §6 ❌;
// hepsi geri alındı, md5 eşit.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  unknownInternalFields,
  getContract,
  internalFieldsOf,
  listContracts,
  shownToInternalFields,
  contractPaths,
  type RegisteredContract,
} from "../src/services/document-template/sozlesme/kayit";
import { CONTEXT_ROOTS, type FieldType, type ConfigFieldType, type TemplateContext } from "../src/services/document-template/sozlesme/tipler";
import { REQUIRED_SCENARIOS } from "../src/services/document-template/sozlesme/senaryolar";
import { renderShipmentDispatchTables } from "../src/services/document-render/shipment-dispatch.html";
import type { PrintedDocSnapshot } from "../src/services/printed-document.service";
import type { DocumentConfig } from "../src/services/system-setting.service";
import { AppError } from "../src/utils/app-error";
import { TRAVELER_FIELDS, TRAVELER_LOOPS } from "../src/config/traveler-card-fields";
import { TRAVELER_KEY_MAP } from "../src/services/document-template/sozlesme/traveler-card";
import { ozetEksikleri, ozetIhlalleri, ozetOku, ozetUret, type Ozet } from "./lib/belge-sozlesme-ozeti";
import { SEVK_BELGE_CFGS, SEVK_BELGE_DOCS, sevkBelgeKombinasyonlari } from "./lib/sevk-belge-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}
const ilk = (xs: string[], n = 6) => xs.slice(0, n).join(" · ");

/** Değer beyan edilen türe uyuyor mu (null her türde serbest). */
function turUyar(tur: FieldType | ConfigFieldType, v: unknown): boolean {
  if (v === null) return true;
  switch (tur) {
    case "metin":
    case "tarih":
    case "tarih_saat":
    case "takvim":
    case "para":
    case "gorsel":
    case "secim":
      return typeof v === "string";
    case "sayi":
      return typeof v === "number" && Number.isFinite(v);
    case "mantiksal":
      return typeof v === "boolean";
    case "liste":
      return Array.isArray(v);
    case "nesne":
      return typeof v === "object" && !Array.isArray(v);
  }
}

/** `ayar` alt ağacında noktalı yolun değeri (yoksa undefined). */
function yolDegeri(o: unknown, yol: string): unknown {
  let cur: unknown = o;
  for (const p of yol.split(".")) {
    if (!cur || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, p)) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Bağlamın `ayar` dışındaki yaprak yolları — tablo satırı `tablolar.t[].k` biçiminde. */
function baglamYollari(c: TemplateContext): Set<string> {
  const out = new Set<string>();
  for (const kok of CONTEXT_ROOTS) {
    if (kok === "ayar") continue;
    if (kok === "tablolar") {
      for (const [t, rows] of Object.entries(c.tablolar)) for (const r of rows) for (const k of Object.keys(r)) out.add(`tablolar.${t}[].${k}`);
      continue;
    }
    for (const k of Object.keys(c[kok] as object)) out.add(`${kok}.${k}`);
  }
  return out;
}

/**
 * Beyanlı her yolun bağlamdaki karşılığı — eksik/tür dışı olanları döndürür. `icAcik`
 * false ise iç yollar BEKLENMEZ (onların yokluğunu §2 ölçer).
 */
function yolDenetimi(s: RegisteredContract, c: TemplateContext, icAcik: ReadonlySet<string>): { eksik: string[]; turDisi: string[]; beyansiz: string[] } {
  const yollar = contractPaths(s);
  const icYol = new Map(internalFieldsOf(s).map((a) => [a.yol, a.kod]));
  const eksik: string[] = [];
  const turDisi: string[] = [];
  for (const [yol, g] of Object.entries(yollar)) {
    if (g.sinif === "ic" && !icAcik.has(icYol.get(yol) ?? "")) continue;
    if (yol.startsWith("ayar.")) {
      if (yol.includes("[]")) continue;
      const v = yolDegeri(c.ayar, yol.slice(5));
      if (v === undefined) eksik.push(yol);
      else if (!turUyar(g.tur, v)) turDisi.push(yol);
      continue;
    }
    const m = /^tablolar\.([^.[]+)\[\]\.(.+)$/.exec(yol);
    if (m) {
      const rows = c.tablolar[m[1]!];
      if (!Array.isArray(rows)) eksik.push(yol);
      else for (const r of rows) {
        if (!Object.prototype.hasOwnProperty.call(r, m[2]!) || r[m[2]!] === undefined) eksik.push(yol);
        else if (!turUyar(g.tur, r[m[2]!])) turDisi.push(yol);
      }
      continue;
    }
    const [kok, ...geri] = yol.split(".");
    const o = (c as unknown as Record<string, Record<string, unknown>>)[kok!];
    const k = geri.join(".");
    if (!o || !Object.prototype.hasOwnProperty.call(o, k) || o[k] === undefined) eksik.push(yol);
    else if (!turUyar(g.tur, o[k])) turDisi.push(yol);
  }
  const beyansiz = [...baglamYollari(c)].filter((y) => !(y in yollar));
  return { eksik: [...new Set(eksik)], turDisi: [...new Set(turDisi)], beyansiz };
}

const duzJson = (c: unknown) => isDeepStrictEqual(JSON.parse(JSON.stringify(c)), c);

const sozlesmeler = listContracts();

// ── §0 ───────────────────────────────────────────────────────────────────────
console.log("§0 Kayıt — docType başına tek satır, alfabetik; bilinmeyen tür fail-closed");
const indexSatirlari = readFileSync(
  join(__dirname, "..", "src", "services", "document-template", "sozlesme", "index.ts"),
  "utf8",
)
  .split("\n")
  .filter((l) => l.startsWith("export"));
const satirDeseni = /^export \{ (\w+) \} from "\.\/([\w-]+)"; \/\/ ([A-Z_]+)$/;
const kotuSatir = indexSatirlari.filter((l) => !satirDeseni.test(l));
check("index.ts her satırı `export { x } from \"./dosya\"; // DOCTYPE`", kotuSatir.length === 0, ilk(kotuSatir));
const satirTurleri = indexSatirlari.map((l) => satirDeseni.exec(l)?.[3] ?? "");
check(
  "index.ts satırları docType'a göre alfabetik ve tekil",
  isDeepStrictEqual(satirTurleri, [...new Set(satirTurleri)].sort()),
  satirTurleri.join(", "),
);
check(
  "kayıtlı sözleşmeler = index satırları",
  isDeepStrictEqual(sozlesmeler.map((s) => s.docType).sort(), [...satirTurleri].sort()),
  sozlesmeler.map((s) => s.docType).join(", "),
);
check("en az bir sözleşme kayıtlı (körlük zemini)", sozlesmeler.length >= 1, `${sozlesmeler.length}`);
let bilinmeyenHata: unknown = null;
try {
  getContract("YOK_BOYLE_BELGE");
} catch (e) {
  bilinmeyenHata = e;
}
check(
  "bilinmeyen docType → 400 DOCUMENT_CONTRACT_UNKNOWN (details.code)",
  bilinmeyenHata instanceof AppError &&
    bilinmeyenHata.statusCode === 400 &&
    (bilinmeyenHata.details as { code?: string } | undefined)?.code === "DOCUMENT_CONTRACT_UNKNOWN",
);
check("SHIPMENT_DISPATCH (pilot) kayıtlı", getContract("SHIPMENT_DISPATCH").docType === "SHIPMENT_DISPATCH");

for (const s of sozlesmeler) {
  const dt = s.docType;
  check(`${dt}: contractVersion pozitif tam sayı`, Number.isInteger(s.contractVersion) && s.contractVersion >= 1);
  const adlar = s.senaryolar().map((x) => x.ad);
  const eksikSen = REQUIRED_SCENARIOS.filter((a) => !adlar.includes(a));
  check(`${dt}: zorunlu senaryolar var, adlar tekil`, eksikSen.length === 0 && new Set(adlar).size === adlar.length, ilk(eksikSen));
  const kokYollari = s.kokler.map((a) => a.yol);
  check(`${dt}: kök alan yolları tekil`, new Set(kokYollari).size === kokYollari.length);
  const izinliKok = new Set(["belge", "firma", "karsi_taraf", "toplamlar", "baski"]);
  const yabanci = kokYollari.filter((y) => !izinliKok.has(y.split(".")[0]!) || y.split(".").length !== 2);
  check(`${dt}: kök alanlar izinli köklerde ve tek seviye`, yabanci.length === 0, ilk(yabanci));
  const tumAlan = [...s.kokler, ...s.tablolar.flatMap((t) => t.kolonlar)];
  const icKodsuz = tumAlan.filter((a) => (a.sinif === "ic") !== !!a.icKod).map((a) => a.yol);
  check(`${dt}: iç alanın kodu var, müşteri alanının yok`, icKodsuz.length === 0, ilk(icKodsuz));
  const kodlar = internalFieldsOf(s).map((a) => a.kod);
  check(`${dt}: iç alan kodları tekil`, new Set(kodlar).size === kodlar.length);
  const ornekDisi = tumAlan.filter((a) => a.ornek === undefined || !turUyar(a.tur, a.ornek)).map((a) => a.yol);
  check(`${dt}: her alanın örneği türüne uyuyor`, ornekDisi.length === 0, ilk(ornekDisi));
  const tabloAdlari = s.tablolar.map((t) => t.anahtar);
  check(`${dt}: tablo anahtarları tekil`, new Set(tabloAdlari).size === tabloAdlari.length);
}

// ── §1 ───────────────────────────────────────────────────────────────────────
console.log("§1 Her senaryoda beyanlı bütün yollar tanımlı (null olabilir), bağlam düz JSON");
for (const s of sozlesmeler) {
  const hepsi = internalFieldsOf(s).map((a) => a.kod);
  for (const sen of s.senaryolar()) {
    for (const [ad, ic] of [["iç alanlar açık", hepsi], ["iç alanlar kapalı", []]] as const) {
      let c: TemplateContext | null = null;
      let hata = "";
      try {
        c = s.insa(sen.snapshot, {}, ic, sen.ek);
      } catch (e) {
        hata = (e as Error).message;
      }
      if (!c) {
        check(`${s.docType}/${sen.ad} (${ad}): bağlam kuruldu`, false, hata);
        continue;
      }
      const d = yolDenetimi(s, c, new Set(ic));
      check(
        `${s.docType}/${sen.ad} (${ad}): kökler tam, yollar tanımlı ve türünde, beyansız yol yok, düz JSON`,
        isDeepStrictEqual(Object.keys(c).sort(), [...CONTEXT_ROOTS].sort()) &&
          d.eksik.length + d.turDisi.length + d.beyansiz.length === 0 &&
          duzJson(c),
        [d.eksik.length ? `eksik ${ilk(d.eksik)}` : "", d.turDisi.length ? `tür ${ilk(d.turDisi)}` : "", d.beyansiz.length ? `beyansız ${ilk(d.beyansiz)}` : ""]
          .filter(Boolean)
          .join(" | "),
      );
    }
  }
}

// ── §2 ───────────────────────────────────────────────────────────────────────
console.log("§2 İç alan OPT-IN: kapalıyken yol YOK, `ic_acik` daima mantıksal");
for (const s of sozlesmeler) {
  const ic = internalFieldsOf(s);
  for (const sen of s.senaryolar()) {
    const kapali = s.insa(sen.snapshot, {}, [], sen.ek);
    const yollar = baglamYollari(kapali);
    const sizan = ic.filter((a) => yollar.has(a.yol)).map((a) => a.yol);
    const icTablo = new Map(ic.map((a) => [`${a.tablo}.${a.yol.split("[].")[1]}`, a]));
    const kolonda = Object.entries(kapali.ayar.kolonlar as Record<string, Array<{ anahtar: string }>>).flatMap(([t, gs]) =>
      gs.filter((g) => icTablo.has(`${t}.${g.anahtar}`)).map((g) => `${t}.${g.anahtar}`),
    );
    const icAcikTam = ic.every((a) => kapali.ic_acik[a.kod] === false) && Object.keys(kapali.ic_acik).length === ic.length;
    check(
      `${s.docType}/${sen.ad}: opt-in yokken iç yol yok, kolon düzeninde iç kolon yok, ic_acik hepsi false`,
      sizan.length === 0 && kolonda.length === 0 && icAcikTam,
      [ilk(sizan), ilk(kolonda)].filter(Boolean).join(" | "),
    );
  }
  // Tek tek açma: yalnız açılan kodun yolu doğar.
  const sen = s.senaryolar().find((x) => x.ad === "cok_sayfa") ?? s.senaryolar()[0]!;
  for (const a of ic) {
    const c = s.insa(sen.snapshot, {}, [a.kod], sen.ek);
    const yollar = baglamYollari(c);
    const digerleri = ic.filter((b) => b.kod !== a.kod && yollar.has(b.yol)).map((b) => b.yol);
    const acilan = a.tablo ? (c.tablolar[a.tablo] ?? []).length === 0 || yollar.has(a.yol) : yollar.has(a.yol);
    const bayraklar = ic.every((b) => typeof c.ic_acik[b.kod] === "boolean" && c.ic_acik[b.kod] === (b.kod === a.kod));
    check(`${s.docType}: yalnız "${a.kod}" açılınca yalnız o yol var, ic_acik yalnız onda true`, acilan && digerleri.length === 0 && bayraklar, ilk(digerleri));
  }
  const sahte = s.insa(sen.snapshot, {}, ["yok_boyle_alan"], sen.ek);
  check(
    `${s.docType}: bilinmeyen iç alan kodu bağlama hiçbir şey eklemez, unknownInternalFields onu bildirir`,
    isDeepStrictEqual(sahte, s.insa(sen.snapshot, {}, [], sen.ek)) &&
      isDeepStrictEqual(unknownInternalFields(s, ["yok_boyle_alan", ...ic.map((x) => x.kod)]), ["yok_boyle_alan"]),
  );
}

// Pilot: sözleşmenin iç kolonları = Sistem renderer'ının opt-in (`defaultHidden`) kolonları.
{
  const s = getContract("SHIPMENT_DISPATCH");
  const snap = s.senaryolar().find((x) => x.ad === "cok_sayfa")!.snapshot;
  const meta = s.senaryolar().find((x) => x.ad === "cok_sayfa")!.ek!.canli as Record<string, unknown>;
  const tablolarIle = (cfg: DocumentConfig) =>
    renderShipmentDispatchTables({ ...(snap as PrintedDocSnapshot), docConfigOverride: cfg } as PrintedDocSnapshot, meta).tables;
  const kapali = tablolarIle({});
  const herKolon = (t: string) => s.tablolar.find((x) => x.anahtar === t)!.kolonlar.flatMap((c) => (c.kaynakKolon ? [c.kaynakKolon] : []));
  const acik = tablolarIle({ columns: Object.fromEntries(["urun", "cuval", "ceki"].map((t) => [t, { shown: herKolon(t) }])) });
  for (const t of ["urun", "cuval", "ceki"]) {
    const a = new Set(kapali.find((x) => x.key === t)!.columns.map((c) => c.key));
    const optIn = acik.find((x) => x.key === t)!.columns.map((c) => c.key).filter((k) => !a.has(k)).sort();
    const sozIc = internalFieldsOf(s).filter((x) => x.tablo === t).map((x) => x.kaynakKolon!).sort();
    check(`SHIPMENT_DISPATCH/${t}: renderer opt-in kolonları = sözleşmenin iç kolonları`, isDeepStrictEqual(optIn, sozIc), `renderer [${optIn}] · sözleşme [${sozIc}]`);
  }
  check(
    "SHIPMENT_DISPATCH: P-d dönüşümü — `columns.*.shown` iç kolonları internalFields'e taşınır",
    isDeepStrictEqual(
      shownToInternalFields(s, { columns: { cuval: { shown: ["packingGroupCode", "note", "x"] }, ceki: { shown: ["packingGroupCode"] } } }).sort(),
      ["ceki_parti_kodu", "cuval_aciklama", "cuval_parti_kodu"],
    ),
  );
}

// ── §3 ───────────────────────────────────────────────────────────────────────
console.log("§3 Özet yalnız büyür (`scripts/lib/belge-sozlesme-ozeti.json`)");
const guncel = ozetUret();
const dosya = ozetOku();
check("özet dosyası var", dosya !== null);
const ihlal = dosya ? ozetIhlalleri(dosya, guncel) : ["dosya yok"];
check("alan/tür çıkarılmadı, tür ve sınıf değişmedi, büyüme sürümlü", ihlal.length === 0, ilk(ihlal, 4));
const eksik = dosya ? ozetEksikleri(dosya, guncel) : [];
check("özet güncel (yeni alan → `npx tsx scripts/lib/belge-sozlesme-ozeti.ts --yaz`)", eksik.length === 0, ilk(eksik, 4));
// Karşılaştırıcının kendi sondası — sentetik özetlerle.
{
  const taban: Ozet = { X: { contractVersion: 1, alanlar: { "belge.no": { tur: "metin", sinif: "musteri" }, "tablolar.t[].k": { tur: "metin", sinif: "ic" } } } };
  const kopya = (): Ozet => JSON.parse(JSON.stringify(taban)) as Ozet;
  const silinmis = kopya();
  delete silinmis.X!.alanlar["belge.no"];
  const turDegisen = kopya();
  turDegisen.X!.alanlar["belge.no"] = { tur: "sayi", sinif: "musteri" };
  const sinifDegisen = kopya();
  sinifDegisen.X!.alanlar["tablolar.t[].k"] = { tur: "metin", sinif: "musteri" };
  const surumsuz = kopya();
  surumsuz.X!.alanlar["belge.yeni"] = { tur: "metin", sinif: "musteri" };
  const surumlu = kopya();
  surumlu.X!.alanlar["belge.yeni"] = { tur: "metin", sinif: "musteri" };
  surumlu.X!.contractVersion = 2;
  check("sonda: alan çıkarma → ihlal", ozetIhlalleri(taban, silinmis).length === 1);
  check("sonda: tür değişimi → ihlal", ozetIhlalleri(taban, turDegisen).length === 1);
  check("sonda: ic → musteri → ihlal", ozetIhlalleri(taban, sinifDegisen).length === 1);
  check("sonda: sürüm artmadan büyüme → ihlal", ozetIhlalleri(taban, surumsuz).length === 1);
  check("sonda: sözleşme kaydını çıkarma → ihlal", ozetIhlalleri(taban, {}).length === 1);
  check("sonda: sürümlü büyüme ihlal değil, eksik olarak görünür", ozetIhlalleri(taban, surumlu).length === 0 && ozetEksikleri(taban, surumlu).length === 2);
}

// ── §4 ───────────────────────────────────────────────────────────────────────
console.log("§4 Alanı eksik eski snapshot null üretir, hata vermez");
const zarf = (doc: unknown, ek: Record<string, unknown> = {}) =>
  ({ schemaVersion: 1, frozenAt: "2026-01-01T00:00:00.000Z", company: { name: "F", letterhead: {} }, docConfigOverride: null, doc, ...ek }) as unknown as PrintedDocSnapshot;
{
  const s = getContract("SHIPMENT_DISPATCH");
  const hepsi = internalFieldsOf(s).map((a) => a.kod);
  const bozuklar: Array<[string, PrintedDocSnapshot]> = [
    ["altın fikstürün eski belgesi", zarf(SEVK_BELGE_DOCS.eski)],
    ["boş doc", zarf({})],
    ["doc null", zarf(null)],
    ["şekli bozuk doc", zarf({ header: "x", products: "x", sacks: [null, 3], cekiRows: {}, totals: [] })],
    ["firma/künye yok", { doc: SEVK_BELGE_DOCS.eski } as unknown as PrintedDocSnapshot],
  ];
  for (const [ad, snap] of bozuklar) {
    let c: TemplateContext | null = null;
    let hata = "";
    try {
      c = s.insa(snap, null, hepsi);
    } catch (e) {
      hata = (e as Error).message;
    }
    const d = c ? yolDenetimi(s, c, new Set(hepsi)) : null;
    check(`SHIPMENT_DISPATCH ${ad}: bağlam kuruldu, bütün yollar tanımlı`, !!c && !!d && d.eksik.length + d.turDisi.length === 0 && duzJson(c), hata || (d ? ilk([...d.eksik, ...d.turDisi]) : ""));
  }
  const eski = s.insa(zarf(SEVK_BELGE_DOCS.eski), {}, hepsi);
  const ceki0 = eski.tablolar.ceki?.[0] ?? {};
  const cuval0 = eski.tablolar.cuval?.[0] ?? {};
  check(
    "eski belgede taşınmayan alanlar null (en, parti no, sevk partisi, parti kodu, beyan adedi)",
    ceki0.en === null && ceki0.parti_no === null && ceki0.sevk_partisi === null && cuval0.parti_kodu === null && eski.toplamlar.cuval_beyan_adedi === null,
    JSON.stringify({ en: ceki0.en, parti: ceki0.parti_no, sp: ceki0.sevk_partisi, pk: cuval0.parti_kodu }),
  );
  check(
    "eski belgede müşteri adı yoksa bizim ad basılır (fail-open, `customerNameOr`)",
    eski.tablolar.urun?.[0]?.musteri_ad === "Linen 330cm." && eski.tablolar.ceki?.[0]?.musteri_desen === "Linen",
  );
}

// ── §5 ───────────────────────────────────────────────────────────────────────
console.log("§5 ayarNormalize: boş/kısmi/bozuk ayar → eksiksiz nesne, idempotent");
for (const s of sozlesmeler) {
  const girdiler: Array<[string, unknown]> = [
    ["{}", {}],
    ["undefined", undefined],
    ["null", null],
    ["dizi", []],
    ["dize", "x"],
    ["bozuk tipler", { titleOverride: 3, sections: "x", style: { pageSize: "A3", fontScale: "büyük" }, columns: [] }],
    ...Object.entries(SEVK_BELGE_CFGS).map(([ad, cfg]): [string, unknown] => [`fikstür ${ad}`, cfg]),
  ];
  for (const [ad, raw] of girdiler) {
    const a = s.ayarNormalize(raw) as Record<string, unknown>;
    const eksikAyar = s.ayarSemasi.filter((x) => yolDegeri(a, x.yol) === undefined || !turUyar(x.tur, yolDegeri(a, x.yol))).map((x) => x.yol);
    const secimDisi = s.ayarSemasi.filter((x) => x.secenekler && !x.secenekler.includes(yolDegeri(a, x.yol) as string)).map((x) => x.yol);
    const ust = new Set(s.ayarSemasi.map((x) => x.yol.split(".")[0]));
    const beyansizUst = Object.keys(a).filter((x) => !ust.has(x));
    check(
      `${s.docType} ${ad}: ayar şemasının her yolu dolu ve türünde, beyansız anahtar yok, idempotent`,
      eksikAyar.length + secimDisi.length + beyansizUst.length === 0 && duzJson(a) && isDeepStrictEqual(s.ayarNormalize(a), a),
      ilk([...eksikAyar, ...secimDisi, ...beyansizUst]),
    );
  }
  check(`${s.docType}: ayarNormalize({}) ≡ ayarNormalize(undefined)`, isDeepStrictEqual(s.ayarNormalize({}), s.ayarNormalize(undefined)));
}
{
  const s = getContract("SHIPMENT_DISPATCH");
  const a = s.ayarNormalize({
    titleOverride: "Sevk Fişi",
    sections: { date: false, listHeader: true },
    style: { pageSize: "A5", fontWeight: "bold" },
    columns: { urun: { hidden: ["rollCount"], labels: { name: "ÜRÜN" } }, cuval: { shown: ["note", "packingGroupCode"] } },
    language: "en",
  }) as unknown as {
    titleOverride: string;
    sections: Record<string, boolean>;
    style: { pageSize: string; fontWeight: string; margins: { top: number } };
    columns: Record<string, { hidden: string[]; shown: string[] }>;
    kolonlar: Record<string, Array<{ kaynak: string; etiket: string }>>;
    language: string;
    showSignatures: boolean;
  };
  check(
    "kısmi ayar korunur, kalanı varsayılana tamamlanır",
    a.titleOverride === "Sevk Fişi" && a.sections.date === false && a.sections.listHeader === true && a.sections.docNo === true &&
      a.style.pageSize === "A5" && a.style.fontWeight === "bold" && a.style.margins.top === 9 && a.showSignatures === true,
  );
  check("iç kolon `shown` ile açılamaz (tek kapı internalFields) — normalize onu düşürür", a.columns.cuval!.shown.length === 0);
  check("dil daima tr (EN eşleniği kapsam dışı, plan P-d)", a.language === "tr");
  check(
    "kolon düzeni ayardan: gizlenen düşer, başlık ezmesi uygulanır",
    !a.kolonlar.urun!.some((g) => g.kaynak === "rollCount") && a.kolonlar.urun!.find((g) => g.kaynak === "name")?.etiket === "ÜRÜN",
  );
}

// ── §6 ───────────────────────────────────────────────────────────────────────
console.log("§6 Pilot: altın fikstür kombinasyonları — bağlam kurulur, toplam donmuş, kolon düzeni = Sistem");
{
  const s = getContract("SHIPMENT_DISPATCH");
  const komb = sevkBelgeKombinasyonlari().filter((k) => !k.ad.endsWith("/ticari"));
  let kurulan = 0;
  const hatalar: string[] = [];
  const toplamFarki: string[] = [];
  const kolonFarki: string[] = [];
  for (const k of komb) {
    const cfg = { ...(k.snapshot.docConfigOverride ?? {}) } as DocumentConfig;
    delete cfg.language;
    const meta = { ...k.meta } as Record<string, unknown>;
    // Tek seferlik ezmeler (?sections, ?merge) ayar kopyasına uygulanır (plan §3.6) — burada dışarıda.
    delete meta.listSections;
    delete meta.mergeSections;
    delete meta.draft;
    delete meta.status;
    const ic = [
      ...shownToInternalFields(s, cfg),
      ...(meta.forceRowNotes ? ["cuval_aciklama"] : []),
      ...(meta.forceRowTags ? ["cuval_iz"] : []),
    ];
    let c: TemplateContext;
    try {
      c = s.insa(k.snapshot, cfg, ic, { canli: meta });
      kurulan++;
    } catch (e) {
      hatalar.push(`${k.ad}: ${(e as Error).message}`);
      continue;
    }
    const t = (k.snapshot.doc as { totals: Record<string, unknown> }).totals;
    if (c.toplamlar.metre !== t.totalMeters || c.toplamlar.kg !== t.totalKg || c.toplamlar.top_adedi !== t.totalRolls) toplamFarki.push(k.ad);
    const sistem = renderShipmentDispatchTables({ ...k.snapshot, docConfigOverride: cfg }, meta);
    if (c.belge.baslik !== sistem.header.find(([, v]) => v === null)?.[0]) kolonFarki.push(`${k.ad} başlık`);
    for (const tb of sistem.tables) {
      const bekl = tb.columns.map((x) => `${x.key}=${x.label}`);
      const ger = ((c.ayar.kolonlar as Record<string, Array<{ kaynak: string; etiket: string }>>)[tb.key] ?? []).map((g) => `${g.kaynak}=${g.etiket}`);
      if (!isDeepStrictEqual(bekl, ger)) kolonFarki.push(`${k.ad}/${tb.key}: [${bekl}] ≠ [${ger}]`);
    }
  }
  check("kombinasyon zemini ≥ 300", komb.length >= 300, `${komb.length}`);
  check("her kombinasyonda bağlam kuruldu", hatalar.length === 0 && kurulan === komb.length, ilk(hatalar, 3));
  check("toplamlar donmuş snapshot'tan (brüt) — her kombinasyonda aynı", toplamFarki.length === 0, ilk(toplamFarki, 3));
  check("kolon kümesi/sırası/başlığı ve belge başlığı Sistem renderer'ıyla aynı", kolonFarki.length === 0, ilk(kolonFarki, 3));

  // Toplam yeniden HESAPLANMAZ: satırlarla çelişen donmuş toplam olduğu gibi gelir.
  const celiski = { ...(SEVK_BELGE_DOCS.eski as Record<string, unknown>), totals: { totalRolls: 99, totalMeters: 12345.67, totalKg: 1.5, sackCount: 7, manualSackCount: 3 } };
  const c = s.insa(zarf(celiski), {}, []);
  check(
    "satırlarla çelişen donmuş toplam aynen basılır (iade sonrası brüt belge)",
    c.toplamlar.top_adedi === 99 && c.toplamlar.metre === 12345.67 && c.toplamlar.kg === 1.5 && c.toplamlar.cuval_adedi === 7 && c.toplamlar.cuval_beyan_adedi === 3,
  );
}

console.log("§7 Refakat kartı: katalog (`TRAVELER_FIELDS`+`TRAVELER_LOOPS`) ↔ `TRAVELER_KEY_MAP` iki yönlü hiza");
{
  const katalog = [
    ...TRAVELER_FIELDS.map((f) => f.key),
    ...TRAVELER_LOOPS.flatMap((l) => [l.key, ...l.fields.map((f) => `${l.key}.${f.key}`)]),
  ];
  const harita = Object.keys(TRAVELER_KEY_MAP);
  const eksik = katalog.filter((k) => !(k in TRAVELER_KEY_MAP));
  const fazla = harita.filter((k) => !katalog.includes(k));
  check(`kataloğun her anahtarı eşlemede (alan eklenince iki taraf) — eksik: ${eksik.join(", ") || "yok"}`, eksik.length === 0);
  check(`eşlemede katalogda olmayan anahtar yok — fazla: ${fazla.join(", ") || "yok"}`, fazla.length === 0);
  check(`körlük zemini: katalog ≥ 46 anahtar (27 alan + 3 döngü + 16 döngü alanı) — ${katalog.length}`, katalog.length >= 46 && TRAVELER_LOOPS.length >= 3);
  const kart = getContract("TRAVELER_CARD");
  const yollar = contractPaths(kart);
  const tablolar = new Set(kart.tablolar.map((t) => `tablolar.${t.anahtar}`));
  const kopuk = Object.entries(TRAVELER_KEY_MAP)
    .map(([k, v]) => [k, v.split("|")[0]!.trim()] as const)
    .filter(([, yol]) => !(yol in yollar) && !tablolar.has(yol));
  check(`eşlenen her yol sözleşmede beyanlı — kopuk: ${kopuk.map(([k, y]) => `${k}→${y}`).join(", ") || "yok"}`, kopuk.length === 0);
}

// ── §8 ───────────────────────────────────────────────────────────────────────
// Tasarımcının "Örnek belge yükle"si satırları ve toplamı `ornek` senaryosundan basar:
// toplam kolonunun satır toplamı `toplamlar.<k>` ile tutmazsa önizleme yanlış hesap gösterir.
console.log("§8 `ornek` senaryosunda toplam kolonları: satır toplamı = toplamlar.<k>");
{
  let denenen = 0;
  for (const s of sozlesmeler) {
    const sen = s.senaryolar().find((x) => x.ad === "ornek");
    if (!sen) continue;
    const c = s.insa(sen.snapshot, {}, internalFieldsOf(s).map((a) => a.kod), sen.ek);
    const toplamlar = c.toplamlar as Record<string, unknown>;
    const tablolarC = c.tablolar as Record<string, Array<Record<string, unknown>>>;
    for (const t of s.tablolar) {
      for (const k of t.kolonlar.filter((x) => x.toplam)) {
        const beyan = toplamlar[k.toplam!];
        if (typeof beyan !== "number") continue; // toplam bu türde basılmıyor (null) → karşılaştırılacak sayı yok
        const satirlar = tablolarC[t.anahtar] ?? [];
        const sayilar = satirlar.map((r) => r[k.yol]).filter((v): v is number => typeof v === "number");
        if (!sayilar.length) continue;
        denenen++;
        const toplam = Math.round(sayilar.reduce((a, b) => a + b, 0) * 1000) / 1000;
        check(`${s.docType}/${t.anahtar}.${k.yol}: Σ satır ${toplam} = toplamlar.${k.toplam} ${beyan}`, Math.abs(toplam - beyan) < 0.005);
      }
    }
  }
  check(`körlük zemini: en az 5 toplam kolonu denendi — ${denenen}`, denenen >= 5);
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail === 0 ? 0 : 1;
