// =============================================================================
// ESKİ İSTEMCİ SİMÜLASYONU — okutulan serinin biçim kilidi (C0b / ISTEMCI)
// =============================================================================
// SORU: "Okutulan serinin biçimi, sahadaki panel ve tabletler güncellenmeden
// değiştirilemez" kilidi GERÇEKTEN gerekli mi, ve NE ZAMAN açılabilir?
//
// YÖNTEM: sahadaki istemcilerin barkod sınıflandırma kuralları, yayınlandıkları
// commit'ten (`git show`) çıkarılır ve SAF fonksiyon olarak koşulur. Aday kodlar
// SUNUCUNUN KENDİ biçimleyicisiyle (`formatSeriesCode` / `seriesPrefix`) üretilir;
// bu dosyada biçimleyici yoktur. Sonuç üç değerli: DOĞRU TÜR · YANLIŞ TÜR · TANIMAZ.
//
// SÜRÜM KAYNAKLARI (tahmin değil, git):
//   panel 1.3.1  → etiket `panel-v1.3.1` = `97d891c2`; sürüm damgası `9915ce11`'de
//                  (Electron/src farkı YOK) · surum-notlari.json `2026-09-07b`.
//   tablet 1.0.6 → etiket `tablet-v1.0.6` = `3caf8e69`; damga `4839ab08` (sınıflandırıcı
//                  dosyaları aynı) · surum-notlari.json `2026-09-04g`. SAHADAKİ tablet.
//   tablet 1.0.7 → YAYINLANMADI (etiket yok). `mobil/app.json` `7119345e`'den beri
//                  "1.0.7" diyor; aynı etiket Faz B'siz (`7119345e`) ve Faz B'li
//                  (sunucu tablosunu çeken) derlemeleri kapsıyor ⇒ tek commit olarak ÖLÇÜLEMEZ.
//                  İlk "1.0.7" commit'i ayrı sütun olarak ölçülür.
//
// ÜÇ İDDİA:
//   (a) KONTROL — bugünkü biçim her istemcide, kapsamındaki her seride DOĞRU TÜR.
//       Tutmazsa ölçüm kirlidir ve (b)/(c) hiçbir şey söylemez.
//   (b) KİLİDİN GEREKÇESİ — kilidin kapsadığı değişikliklerden en az biri sahadaki
//       panelde ve sahadaki tablette yanlış/tanınmaz.
//   (c) AÇILMA KOŞULU — HEAD istemcisi (sunucu tablosuyla) her değişikliği ve
//       değişiklikten SONRA eski etiketi doğru okur; eşik (`FAZ_B_ONCESI`) Faz B'siz
//       ölçülen her etiketi kapsar.
//
// ⭐ NEGATİF SONDA (2026-09-23, commit mesajında sayılarla):
//   ① HEAD panel `FALLBACK_SERIES` sack `CV`→`CX` → (a) ❌ (HEAD yedek kontrolü).
//   ② HEAD panel `prefixAnchor` emekli ön ekleri atlasın → (c) ❌ (eski etiket).
//   ③ tablet kural çıkarıcısında tanıtıcı adı bozuk → ÖLÇÜLEMEDİ ❌.
//   ④ `FAZ_B_ONCESI.mobil` "1.0.6"ya çekildi → (c) eşik ❌.
// ⭐ POZİTİF SONDA: sahadaki panel yerine HEAD panel (sunucu tablosuyla) koşturuldu
//   → (b) ❌ "gerekçe yok" — yani (b) boş bir iddia değil; geri alınınca ✅.
//
// DB'siz. Koşum: npx tsx scripts/run-all-tests.ts eski_istemci_okutma
// =============================================================================
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FAZ_B_ONCESI,
  FAZ_D_ONCESI,
  SCANNED_CLIENT_BREAKING_AXES,
  compareClientVersions,
  scanningClientsMissingPhases,
  type SeriesFormatAxis,
} from "../src/config/client-version-policy";
import { NUMBER_SERIES_CATALOG, type NumberSeriesCatalogEntry } from "../src/constants/number-series-catalog";
import { formatSeriesCode, seriesPrefix, type NumberSeriesFormat } from "../src/services/helpers/series-format.helper";
import type { SeriesClassifierRow } from "../src/services/number-series.service";
import { git } from "./lib/git";

let pass = 0,
  fail = 0,
  atlandi = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const KOK = join(__dirname, "..", "..");
const TARIH = new Date("2026-09-23T09:00:00Z");

// ── Sürüm çapaları ───────────────────────────────────────────────────────────
const PANEL_131 = { sha: `97d891c2969227f94d0bfda96d9f15eba18eded1`, etiket: "panel-v1.3.1", damga: `9915ce11`, surum: "1.3.1" };
const TABLET_106 = { sha: `3caf8e69ba02a591698e2976f68a94d74ff52535`, etiket: "tablet-v1.0.6", damga: `4839ab08`, surum: "1.0.6" };
const TABLET_107_ILK = { sha: `7119345ee0b93fa82328180d14c374813de5cf1c`, surum: "1.0.7" };

const PANEL_DOSYA = "Electron/src/lib/scanner/barcode-kind.ts";
const TABLET_DOSYA = "mobil/src/services/scanSeries.service.ts";

/** Eski tabletin sınıflandırması dört ekrana dağılmış regex'lerdir (Faz B öncesi). */
const TABLET_KURALLARI = [
  { ad: "isSwatch", dosya: "mobil/src/screens/Modules/Depo/DepoScreen.tsx", tanitici: "const isSwatchBarcode = " },
  { ad: "isRoll", dosya: "mobil/src/screens/Modules/FasonSevk/FasonSevkScreen.tsx", tanitici: "const looksLikeRollBarcode = (code: string) => " },
  { ad: "isCard", dosya: "mobil/src/screens/Modules/FasonSevk/FasonSevkScreen.tsx", tanitici: "const looksLikeCardBarcode = (code: string) => " },
  { ad: "isSack", dosya: "mobil/src/screens/Modules/TartiPaket/PaketlemeScreen.tsx", tanitici: "const isSackCode = (code: string) => " },
] as const;
type TabletYuklem = Record<(typeof TABLET_KURALLARI)[number]["ad"], (c: string) => boolean>;

function nesneVar(sha: string): boolean {
  try {
    git(["cat-file", "-e", `${sha}^{commit}`], { cwd: KOK, stdio: "yut" });
    return true;
  } catch {
    return false;
  }
}
const eskiMetin = (sha: string, yol: string): string => git(["show", `${sha}:${yol}`], { cwd: KOK });

// ── Kaynak metni modül olarak yükleme ────────────────────────────────────────
const GECICI = mkdtempSync(join(tmpdir(), "tekserp-eski-istemci-"));
let sunucuTablosu: unknown[] = [];
(globalThis as Record<string, unknown>).__eskiIstemciSunucu = () => sunucuTablosu;
const API_STUB =
  "const apiClient = { get: async () => ({ data: { success: true, data: (globalThis as any).__eskiIstemciSunucu() } }) };";
const API_IMPORT_RE = /^import (?:apiClient|\{ apiClient \}) from ["'][^"']+["'];$/m;

let modulSayac = 0;
async function kaynaktanYukle<T>(metin: string): Promise<T> {
  // Tek dış bağ istemcinin HTTP katmanıdır; ağ yerine sunucu tablosunu veren stub.
  const govde = API_IMPORT_RE.test(metin) ? metin.replace(API_IMPORT_RE, API_STUB) : metin;
  if (/^import /m.test(govde)) throw new Error("beklenmeyen import kaldı — kaynak değişmiş, ölçüm kurulamadı");
  const yol = join(GECICI, `m${++modulSayac}.ts`);
  writeFileSync(yol, govde);
  return (await import(yol)) as T;
}

/** `const x = (code) => /re/i.test(` satırından regex'i çıkarır; bulamazsa null (ÖLÇÜLEMEDİ). */
function regexCikar(metin: string, tanitici: string): RegExp | null {
  const i = metin.indexOf(tanitici);
  if (i < 0) return null;
  const m = /^\/((?:\\.|[^/\\\n])+)\/([a-z]*)\.test\(/.exec(metin.slice(i + tanitici.length));
  return m ? new RegExp(m[1], m[2]) : null;
}

// ── Seriler ve aday değişiklikler ────────────────────────────────────────────
const OKUTULAN = NUMBER_SERIES_CATALOG.filter((e) => e.kind !== undefined);
/** Başka okutulan seriyle çakışmayan yeni ön ek (sunucu kapısı ③'ün koşulu). */
const YENI_ONEK: Record<string, string> = {
  roll: "RL",
  workOrder: "IS",
  swatch: "KRX",
  sack: "CX",
  shipment: "SVX",
  subcontractorDispatch: "FD",
  subcontractorReceipt: "FA",
  kartelaDispatch: "KT",
  kartelaReceipt: "KB",
};

function bugunkuBicim(e: NumberSeriesCatalogEntry): NumberSeriesFormat {
  return {
    prefix: e.seedPrefix,
    dateSegment: e.seedDateSegment,
    digits: e.seedDigits,
    separator: e.seedSeparator,
    retiredPrefixes: [...(e.seedRetiredPrefixes ?? [])],
    ...(e.infix ? { infix: e.infix.re } : {}),
  };
}

interface Degisiklik {
  ad: string;
  uygula: (f: NumberSeriesFormat, key: string) => NumberSeriesFormat;
}
const DEGISIKLIKLER: Degisiklik[] = [
  { ad: "önek", uygula: (f, k) => ({ ...f, prefix: YENI_ONEK[k], retiredPrefixes: [f.prefix, ...f.retiredPrefixes] }) },
  { ad: "tarih YYMM", uygula: (f) => ({ ...f, dateSegment: "YYMM" }) },
  { ad: "tarih NONE", uygula: (f) => ({ ...f, dateSegment: "NONE" }) },
  { ad: "tarih YYYYMMDD", uygula: (f) => ({ ...f, dateSegment: "YYYYMMDD" }) },
  { ad: "hane 5", uygula: (f) => ({ ...f, digits: 5 }) },
  { ad: "ayraç -", uygula: (f) => ({ ...f, separator: "-" }) },
  { ad: "ayraç2 /", uygula: (f) => ({ ...f, separator2: "/" }) },
];

/** Kod SUNUCU biçimleyicisinden; top barkodunda infix (faz harfi) tarih ile sıra arasına. */
function kodUret(f: NumberSeriesFormat): string {
  if (f.infix) return `${seriesPrefix(f, TARIH)}H${String(1).padStart(f.digits, "0")}`;
  return formatSeriesCode(f, 1, TARIH);
}

/** `/api/scan/series` satırı — tip `SeriesClassifierRow`a bağlı (tel sözleşmesi). */
function sunucuSatiri(e: NumberSeriesCatalogEntry, f: NumberSeriesFormat): SeriesClassifierRow {
  return {
    key: e.key,
    kind: e.kind!,
    prefixes: [f.prefix, ...f.retiredPrefixes],
    dateSegment: f.dateSegment,
    digits: f.digits,
    separator: f.separator,
    ...(f.separator2 != null ? { separator2: f.separator2 } : {}),
    ...(f.infix ? { infix: f.infix } : {}),
  };
}
function sunucuTablosuKur(degisen?: { key: string; f: NumberSeriesFormat }): SeriesClassifierRow[] {
  return OKUTULAN.map((e) => sunucuSatiri(e, degisen && degisen.key === e.key ? degisen.f : bugunkuBicim(e)));
}

// ── İstemci modelleri ────────────────────────────────────────────────────────
type Tur = string; // ROLL · TRAVELER_CARD · … · UNKNOWN · ITEM (paketleme: top/kartela sunucuda)
interface Istemci {
  ad: string;
  /** seri → (bağlam, beklenen tür) listesi; boş = istemci bu seriyi öneke göre ayırmıyor. */
  kapsam: (key: string, kind: string) => Array<{ baglam: string; beklenen: Tur }>;
  /** Bu değişiklikte sunucunun yayınladığı tablo yüklenir (Faz B'siz istemci yok sayar). */
  tabloYukle: (tablo: SeriesClassifierRow[]) => Promise<void>;
  sinifla: (baglam: string, kod: string) => Tur;
}

const PANEL_TUM = (_k: string, kind: string) => [{ baglam: "classifyBarcode", beklenen: kind }];

/** Tablet bağlamları: her ekran ikili bir karar verir, "hayır" dalı varsayılan türe düşer. */
function tabletBaglam(y: TabletYuklem, baglam: string, kod: string): Tur {
  const c = kod.trim();
  switch (baglam) {
    case "Depo":
      return y.isSwatch(c) ? "SWATCH" : "ROLL";
    case "FasonKart":
      return y.isRoll(c) ? "ROLL" : "TRAVELER_CARD";
    case "FasonTop":
      return y.isCard(c) ? "TRAVELER_CARD" : "ROLL";
    case "Paketleme":
      return y.isSack(c) ? "SACK" : "ITEM";
    default:
      throw new Error(`bilinmeyen bağlam ${baglam}`);
  }
}
const TABLET_KAPSAM: Record<string, Array<{ baglam: string; beklenen: Tur }>> = {
  roll: [
    { baglam: "Depo", beklenen: "ROLL" },
    { baglam: "FasonTop", beklenen: "ROLL" },
    { baglam: "FasonKart", beklenen: "ROLL" },
    { baglam: "Paketleme", beklenen: "ITEM" },
  ],
  swatch: [
    { baglam: "Depo", beklenen: "SWATCH" },
    { baglam: "Paketleme", beklenen: "ITEM" },
  ],
  workOrder: [
    { baglam: "FasonKart", beklenen: "TRAVELER_CARD" },
    { baglam: "FasonTop", beklenen: "TRAVELER_CARD" },
  ],
  sack: [{ baglam: "Paketleme", beklenen: "SACK" }],
};
const tabletKapsam = (key: string) => TABLET_KAPSAM[key] ?? [];

type HeadPanel = {
  classifyBarcode: (raw: string) => { kind: string };
  loadScanSeries: () => Promise<string>;
  resetScanSeries: () => void;
  scanSeriesSource: () => string;
};
type HeadTablet = {
  classifyWithTable: (rows: readonly unknown[], raw: string) => { kind: string };
  scanSeriesService: { get: () => Promise<unknown[]> };
  FALLBACK_SCAN_SERIES: readonly unknown[];
};

function tabletYuklemFromTable(m: HeadTablet, rows: readonly unknown[]): TabletYuklem {
  const k = (c: string) => m.classifyWithTable(rows, c).kind;
  return {
    isSwatch: (c) => k(c) === "SWATCH",
    isRoll: (c) => k(c) === "ROLL",
    isCard: (c) => k(c) === "TRAVELER_CARD",
    isSack: (c) => k(c) === "SACK",
  };
}

// ── Sonuç ────────────────────────────────────────────────────────────────────
type Hucre = { durum: "DOĞRU" | "YANLIŞ" | "TANIMAZ" | "KAPSAM DIŞI"; not?: string };
function degerlendir(ist: Istemci, e: NumberSeriesCatalogEntry, kod: string): Hucre {
  const kapsam = ist.kapsam(e.key, e.kind!);
  if (kapsam.length === 0) return { durum: "KAPSAM DIŞI" };
  for (const { baglam, beklenen } of kapsam) {
    const tur = ist.sinifla(baglam, kod);
    if (tur === beklenen) continue;
    return tur === "UNKNOWN"
      ? { durum: "TANIMAZ", not: baglam === "classifyBarcode" ? undefined : baglam }
      : { durum: "YANLIŞ", not: `${tur}${baglam === "classifyBarcode" ? "" : "@" + baglam}` };
  }
  return { durum: "DOĞRU" };
}
function hucreMetni(h: Hucre): string {
  if (h.durum === "DOĞRU") return "✓";
  if (h.durum === "KAPSAM DIŞI") return "—";
  if (h.durum === "TANIMAZ") return `?tanımaz${h.not ? "@" + h.not : ""}`;
  return `✗→${h.not}`;
}

async function main(): Promise<void> {
  // ── 0. Sürüm çapaları gerçekten o sürüm mü? ────────────────────────────────
  const gecmisVar = [PANEL_131.sha, TABLET_106.sha, TABLET_107_ILK.sha].every(nesneVar);
  const istemciler: Istemci[] = [];

  if (!gecmisVar) {
    atlandi += 3;
    console.log("⏭ ÖLÇÜLEMEDİ: sahadaki sürümlerin commit'leri bu klonda yok (sığ klon) — eski istemci sütunları atlandı");
  } else {
    const etiket = (t: string) => {
      try {
        return git(["rev-list", "-n1", t], { cwd: KOK, stdio: "yut" }).trim();
      } catch {
        return null;
      }
    };
    for (const s of [PANEL_131, TABLET_106]) {
      const e = etiket(s.etiket);
      if (e === null) console.log(`   ⓘ etiket ${s.etiket} bu klonda yok — çapa sabit sha ile sürer`);
      else check(`§0 etiket ${s.etiket} = ${s.sha.slice(0, 8)}`, e === s.sha, e.slice(0, 8));
    }
    const surum = (sha: string, yol: string, alan: RegExp) => alan.exec(eskiMetin(sha, yol))?.[1];
    check(
      `§0 panel 1.3.1 damgası: ${PANEL_131.damga} Electron/package.json 1.3.1 ve Electron/src farkı yok`,
      surum(PANEL_131.damga, "Electron/package.json", /"version":\s*"([^"]+)"/) === "1.3.1" &&
        git(["diff", "--name-only", PANEL_131.sha, PANEL_131.damga, "--", "Electron/src"], { cwd: KOK }).trim() === "",
    );
    const tabletDosyalari = [...new Set(TABLET_KURALLARI.map((k) => k.dosya))];
    check(
      `§0 tablet 1.0.6 damgası: ${TABLET_106.damga} mobil/app.json 1.0.6 ve sınıflandırıcı ekranlar aynı`,
      surum(TABLET_106.damga, "mobil/app.json", /"version":\s*"([^"]+)"/) === "1.0.6" &&
        git(["diff", "--name-only", TABLET_106.sha, TABLET_106.damga, "--", ...tabletDosyalari], { cwd: KOK }).trim() === "",
    );
    check(
      `§0 tablet "1.0.7" etiketi Faz B'siz bir commit'te de var (${TABLET_107_ILK.sha.slice(0, 8)}) ⇒ tek sürüm olarak ÖLÇÜLEMEZ`,
      surum(TABLET_107_ILK.sha, "mobil/app.json", /"version":\s*"([^"]+)"/) === "1.0.7",
    );
    // Faz B öncesi istemciler sunucu tablosunu HİÇ çekmez: davranış = sabit kurallar.
    for (const [ad, sha, yol] of [
      ["panel 1.3.1", PANEL_131.sha, "Electron/src"],
      ["tablet 1.0.6", TABLET_106.sha, "mobil/src"],
      ["tablet 1.0.7-ilk", TABLET_107_ILK.sha, "mobil/src"],
    ] as const) {
      let bulgu = "";
      try {
        bulgu = git(["grep", "-l", "scan/series", sha, "--", yol], { cwd: KOK, stdio: "yut" }).trim();
      } catch {
        bulgu = "";
      }
      check(`§0 ${ad} /api/scan/series tüketmiyor — yalnız sabit kurallar`, bulgu === "", bulgu);
    }

    // Eski panel: sabit tablo, kaynaktan modül olarak.
    const p131 = await kaynaktanYukle<{ classifyBarcode: (raw: string) => { kind: string } }>(
      eskiMetin(PANEL_131.sha, PANEL_DOSYA),
    );
    istemciler.push({
      ad: "panel 1.3.1",
      // SVK bu sürümde tanınmıyor (aşağıda ÖLÇÜLÜR); kapsam dışı.
      kapsam: (k, kind) => (k === "shipment" ? [] : PANEL_TUM(k, kind)),
      tabloYukle: async () => {},
      sinifla: (_b, kod) => p131.classifyBarcode(kod).kind,
    });
    const svk = p131.classifyBarcode(kodUret(bugunkuBicim(OKUTULAN.find((e) => e.key === "shipment")!))).kind;
    check("§0 panel 1.3.1 kapsam beyanı: SVK bugünkü biçimde de UNKNOWN (sevkiyat okutması bu sürümde yok)", svk === "UNKNOWN", svk);

    // Eski tabletler: dört ekrandaki regex'ler.
    for (const [ad, sha] of [
      ["tablet 1.0.6", TABLET_106.sha],
      ["tablet 1.0.7-ilk", TABLET_107_ILK.sha],
    ] as const) {
      const y: Partial<TabletYuklem> = {};
      for (const k of TABLET_KURALLARI) {
        const re = regexCikar(eskiMetin(sha, k.dosya), k.tanitici);
        check(`§0 ${ad} ${k.ad} kuralı çıkarıldı`, re !== null, re ? String(re) : "ÖLÇÜLEMEDİ — tanıtıcı bulunamadı");
        if (re) y[k.ad] = (c: string) => re.test(c.trim());
      }
      if (Object.keys(y).length !== TABLET_KURALLARI.length) continue;
      istemciler.push({ ad, kapsam: tabletKapsam, tabloYukle: async () => {}, sinifla: (b, kod) => tabletBaglam(y as TabletYuklem, b, kod) });
    }
  }

  // ── HEAD istemcileri (çalışma ağacı) — sunucu tablosu ve yedek katman ──────
  const hp = await kaynaktanYukle<HeadPanel>(readFileSync(join(KOK, PANEL_DOSYA), "utf8"));
  const ht = await kaynaktanYukle<HeadTablet>(readFileSync(join(KOK, TABLET_DOSYA), "utf8"));
  let htRows: readonly unknown[] = ht.FALLBACK_SCAN_SERIES;
  const headPanel: Istemci = {
    ad: "HEAD panel",
    kapsam: PANEL_TUM,
    tabloYukle: async (t) => {
      sunucuTablosu = t;
      await hp.loadScanSeries();
    },
    sinifla: (_b, kod) => hp.classifyBarcode(kod).kind,
  };
  const headTablet: Istemci = {
    ad: "HEAD tablet",
    kapsam: tabletKapsam,
    tabloYukle: async (t) => {
      sunucuTablosu = t;
      htRows = await ht.scanSeriesService.get();
    },
    sinifla: (b, kod) => tabletBaglam(tabletYuklemFromTable(ht, htRows), b, kod),
  };
  const headPanelYedek: Istemci = { ...headPanel, ad: "HEAD panel·yedek", tabloYukle: async () => hp.resetScanSeries() };
  const headTabletYedek: Istemci = {
    ...headTablet,
    ad: "HEAD tablet·yedek",
    tabloYukle: async () => {
      htRows = ht.FALLBACK_SCAN_SERIES;
    },
  };

  await headPanel.tabloYukle(sunucuTablosuKur());
  check("§0 HEAD panel sunucu tablosunu yükledi (kaynak=server)", hp.scanSeriesSource() === "server", hp.scanSeriesSource());

  // ── (a) KONTROL ────────────────────────────────────────────────────────────
  const sutunlar = [...istemciler, headPanel, headTablet, headPanelYedek, headTabletYedek];
  for (const ist of sutunlar) {
    await ist.tabloYukle(sunucuTablosuKur());
    const hatalar: string[] = [];
    let kapsanan = 0;
    for (const e of OKUTULAN) {
      const h = degerlendir(ist, e, kodUret(bugunkuBicim(e)));
      if (h.durum === "KAPSAM DIŞI") continue;
      kapsanan++;
      if (h.durum !== "DOĞRU") hatalar.push(`${e.key}:${hucreMetni(h)}`);
    }
    check(`(a) KONTROL ${ist.ad}: bugünkü biçim kapsamdaki ${kapsanan} seride DOĞRU TÜR`, kapsanan > 0 && hatalar.length === 0, hatalar.join(" · "));
  }

  // ── Tablo: seri × değişiklik × istemci ─────────────────────────────────────
  const KILITLI = OKUTULAN.filter((e) => !e.lockedReason); // ISTEMCI kilidinin tek başına tuttuğu seriler
  const basliklar = [...istemciler.map((i) => i.ad), "HEAD panel", "HEAD tablet", "HEAD panel·eski etiket", "HEAD tablet·eski etiket", "HEAD panel·yedek", "HEAD tablet·yedek"];
  console.log(`\n   seri · değişiklik · kod | ${basliklar.join(" | ")}`);
  const kirilan: Record<string, number> = {};
  const headHata: string[] = [];
  const gerekceli: Record<string, Set<string>> = {};
  for (const e of OKUTULAN) {
    for (const d of DEGISIKLIKLER) {
      const yeni = d.uygula(bugunkuBicim(e), e.key);
      const kod = kodUret(yeni);
      const eskiKod = kodUret(bugunkuBicim(e));
      const tablo = sunucuTablosuKur({ key: e.key, f: yeni });
      const satir: string[] = [];
      for (const ist of istemciler) {
        await ist.tabloYukle(tablo);
        const h = degerlendir(ist, e, kod);
        satir.push(hucreMetni(h));
        if (!e.lockedReason && (h.durum === "YANLIŞ" || h.durum === "TANIMAZ")) {
          kirilan[ist.ad] = (kirilan[ist.ad] ?? 0) + 1;
          (gerekceli[e.key] ??= new Set()).add(d.ad);
        }
      }
      for (const [ist, k] of [
        [headPanel, kod],
        [headTablet, kod],
        [headPanel, eskiKod],
        [headTablet, eskiKod],
      ] as const) {
        await ist.tabloYukle(tablo);
        const h = degerlendir(ist, e, k);
        satir.push(hucreMetni(h));
        if (!e.lockedReason && (h.durum === "YANLIŞ" || h.durum === "TANIMAZ"))
          headHata.push(`${ist.ad} ${e.key}/${d.ad}${k === eskiKod ? "(eski etiket)" : ""} ${hucreMetni(h)}`);
      }
      for (const ist of [headPanelYedek, headTabletYedek]) {
        await ist.tabloYukle(tablo);
        satir.push(hucreMetni(degerlendir(ist, e, kod)));
      }
      console.log(`   ${e.key}${e.lockedReason ? "[YAPISAL]" : ""} · ${d.ad} · ${kod} | ${satir.join(" | ")}`);
    }
  }
  // Seri başına: hangi eksen ESKİ istemcilerden en az birinde kırılıyor (bilgi).
  for (const e of KILITLI) {
    const s = gerekceli[e.key];
    console.log(`   ⓘ ${e.key}: ${s ? `eski istemcide kıran eksen(ler): ${[...s].join(", ")}` : "HİÇBİR eksen eski istemcide kırılmıyor — kilidin bu seri için istemci gerekçesi YOK"}`);
  }
  console.log("");

  // ── (a2) KİLİT TABLOSU ↔ SİMÜLASYON — İKİ YÖNLÜ EŞLEME (1e kararı) ─────────
  // ⚠️ Kilit artık EKSEN düzeyinde ve kaynağı bu simülasyondur. Beyan
  // (`SCANNED_CLIENT_BREAKING_AXES`) ile ölçüm İKİ YÖNDEN eşlenir:
  //   · simülasyonun KIRDIĞI bir eksen beyanda YOKSA → koruma eksik (kırmızı)
  //   · simülasyonun KIRMADIĞI bir eksen beyanda VARSA → GEREKSİZ kilit (kırmızı),
  //     çünkü fabrikanın değiştirebileceği bir ayarı sebepsiz kapatır.
  // Eksen adı eşlemesi burada, çünkü değişiklik listesi de burada tanımlı.
  const EKSEN_OF: Record<string, SeriesFormatAxis> = {
    "önek": "prefix",
    "tarih YYMM": "dateSegment",
    "tarih NONE": "dateSegment",
    "tarih YYYYMMDD": "dateSegment",
    "hane 5": "digits",
    "ayraç -": "separator",
    "ayraç2 /": "separator2",
  };
  const eksikKoruma: string[] = [];
  const gereksizKilit: string[] = [];
  for (const e of KILITLI) {
    const kiran = new Set<SeriesFormatAxis>();
    for (const ad of gerekceli[e.key] ?? []) {
      const eksen = EKSEN_OF[ad];
      if (eksen) kiran.add(eksen);
    }
    const beyan = new Set(SCANNED_CLIENT_BREAKING_AXES[e.key] ?? []);
    for (const a of kiran) if (!beyan.has(a)) eksikKoruma.push(`${e.key}:${a}`);
    for (const a of beyan) if (!kiran.has(a)) gereksizKilit.push(`${e.key}:${a}`);
  }
  check("(a2) körlük zemini: simülasyon en az bir seride kıran eksen buldu",
    KILITLI.some((e) => (gerekceli[e.key]?.size ?? 0) > 0));
  check("(a2) ⭐ simülasyonun KIRDIĞI her eksen kilit tablosunda VAR (koruma eksik değil)",
    eksikKoruma.length === 0, eksikKoruma.join(", "));
  check("(a2) ⭐ kilit tablosundaki her eksen simülasyonda GERÇEKTEN kırılıyor (gereksiz kilit yok)",
    gereksizKilit.length === 0, gereksizKilit.join(", "));
  // Kilitsiz seri de BEYANLI: tabloda anahtarı olmayan okutulan seri, "ölçülmedi"
  // ile "kırılmıyor"u karıştırır.
  const beyansizSeri = KILITLI.filter((e) => SCANNED_CLIENT_BREAKING_AXES[e.key] === undefined);
  check("(a2) ⭐ okutulan her serinin kilit tablosunda BİR SATIRI var (boş dizi de beyandır)",
    beyansizSeri.length === 0, beyansizSeri.map((e) => e.key).join(", "));

  // ── (b) KİLİDİN GEREKÇESİ ──────────────────────────────────────────────────
  const eksik = scanningClientsMissingPhases();
  check("(b) kilit bugün AÇIK DEĞİL (sahadaki istemciler Faz B/D eşiğinin altında)", eksik.length > 0, `eksik fazlar: ${eksik.join(",") || "yok"}`);
  if (gecmisVar) {
    const toplam = KILITLI.length * DEGISIKLIKLER.length;
    for (const ad of ["panel 1.3.1", "tablet 1.0.6"]) {
      check(`(b) GEREKÇE ${ad}: kilitli ${toplam} değişiklikten en az biri yanlış/tanınmaz`, (kirilan[ad] ?? 0) > 0, `${kirilan[ad] ?? 0}/${toplam}`);
    }
  }

  // ── (c) AÇILMA KOŞULU ──────────────────────────────────────────────────────
  check(
    `(c) HEAD panel + tablet (sunucu tablosu): kilitli ${KILITLI.length} seri × ${DEGISIKLIKLER.length} değişiklik, yeni kod ve eski etiket DOĞRU`,
    headHata.length === 0,
    headHata.slice(0, 6).join(" · "),
  );
  // Faz B'nin varlığı İÇERİKTEN ölçülür (commit sha'sı iniş sırasında değişebilir).
  for (const [ad, yol] of [
    ["panel", PANEL_DOSYA],
    ["tablet", TABLET_DOSYA],
  ] as const) {
    check(`(c) HEAD ${ad} sınıflandırıcısı /api/scan/series tüketiyor — bu ağaçtan üretilen paket Faz B'yi taşır`, readFileSync(join(KOK, yol), "utf8").includes("/api/scan/series"));
  }
  if (gecmisVar) {
    // Faz B'siz ölçülen HER etiket eşiğin altında ya da eşitinde olmalı: aksi hâlde
    // `minVersion > eşik` kilidi Faz B'siz bir derlemeye açardı.
    const fazBsiz = { panel: [PANEL_131.surum], tablet: [TABLET_106.surum, TABLET_107_ILK.surum] };
    for (const [ad, esik, list] of [
      ["panel", FAZ_B_ONCESI.electron, fazBsiz.panel],
      ["tablet", FAZ_B_ONCESI.mobil, fazBsiz.tablet],
    ] as const) {
      const asan = list.filter((v) => compareClientVersions(v, esik) > 0);
      check(`(c) eşik FAZ_B_ONCESI.${ad === "panel" ? "electron" : "mobil"}=${esik} Faz B'siz etiketleri (${list.join(", ")}) kapsıyor`, asan.length === 0, asan.join(","));
    }
  }
  // Çalışma ağacının etiketi: eşiğe EŞİTSE bu ağaçtan çıkan paket kilidi açamaz.
  const agacEtiketi = {
    panel: /"version":\s*"([^"]+)"/.exec(readFileSync(join(KOK, "Electron/package.json"), "utf8"))?.[1] ?? "?",
    tablet: /"version":\s*"([^"]+)"/.exec(readFileSync(join(KOK, "mobil/app.json"), "utf8"))?.[1] ?? "?",
  };
  console.log(
    `   ⓘ açılma koşulu: panel > ${FAZ_B_ONCESI.electron} VE tablet > ${FAZ_B_ONCESI.mobil} (Faz D eşiği ${FAZ_D_ONCESI.electron}/${FAZ_D_ONCESI.mobil}) sahada; ` +
      `ağaç etiketi panel ${agacEtiketi.panel} · tablet ${agacEtiketi.tablet}` +
      (compareClientVersions(agacEtiketi.tablet, FAZ_B_ONCESI.mobil) <= 0 || compareClientVersions(agacEtiketi.panel, FAZ_B_ONCESI.electron) <= 0
        ? " — ⚠️ etiket eşiği AŞMIYOR: paketlemede sürüm yükseltilmezse kilit bu paketle açılamaz"
        : ""),
  );

  // Faz D tel alanını (`retiredFormats`) okuyan istemci yok; bugün zararsız olması
  // tam-biçim testinin yalnız ROLL (YAPISAL kilitli) için çağrılmasına bağlı.
  const tamBicim = git(
    ["grep", "-n", "-E", "matchesFullFormat(WithTable)?\\(", "--", "Electron/src", "mobil/src", ":!*.test.*", ":!**/__tests__/**"],
    { cwd: KOK },
  )
    .split("\n")
    .filter((s) => s && !/barcode-kind\.ts:|scanSeries\.service\.ts:|useScanSeries\.ts:/.test(s));
  const turler = tamBicim.map((s) => /matchesFullFormat(?:WithTable)?\(\s*["'](\w+)["']/.exec(s)?.[1] ?? "?");
  check(
    "(c) tam-biçim testi yalnız ROLL için çağrılıyor (Faz D okuyucusu yokken eski etiketin tek kırılma yolu)",
    tamBicim.length > 0 && turler.every((t) => t === "ROLL"),
    `${tamBicim.length} çağrı: ${[...new Set(turler)].join(",")}`,
  );

  console.log(`\nSonuç: ${pass} geçti, ${fail} başarısız${atlandi ? `, ${atlandi} atlandı` : ""}`);
}

main()
  .catch((e) => {
    fail++;
    console.log(`❌ ÖLÇÜLEMEDİ: ${(e as Error).message}`);
    console.log(`\nSonuç: ${pass} geçti, ${fail} başarısız`);
  })
  .finally(() => {
    rmSync(GECICI, { recursive: true, force: true });
    process.exit(fail > 0 ? 1 : 0);
  });
