// =============================================================================
// BEKÇİ — ZİNCİRLİ İŞARETÇİ ADI VE SEÇİMİ (D8): `paket-zinciri.ts` `selectChainedDocument` + Rust aynası
// `tekserp-guncelleyici/src/release.rs` `select_chained`
// =============================================================================
// Çalıştırma: npx tsx scripts/test_zincir_secimi.ts               (DB'SİZ, ağsız)
//             npx tsx scripts/test_zincir_secimi.ts --vektor-yaz  (vektör dosyasını TS'ten yeniden üretir)
//
// NE ÖLÇER (tasarım `docs/design/PAKET-ANAHTARI-KOK-ALTINDA.md` §3.2, §7 D8):
//   §1 adlar: `chainedFileName` / `parseChainedFileName` (son ailesine kid'li ad yok · pkt-* dışı kid yok)
//   §2 adlı seçim vakaları → beklenen (kazanan ad + elenenlerin kodu ya da hata kodu): eski ad · yeni ad · çift kid
//      (en geç bitiş) · ⭐ iptalli en geç bitiş elenir · ad kid'i ≠ imzalayan · paket-* imzalı zincirli ad · farklı
//      belge / eşit bitiş → belirsiz (SURUM_ISARETCI) · hepsi geçersiz (ilk elenenin kodu) · aday yok (null) · pg ailesi
//   §3 vektör dosyası `native/test-vektorleri/zincir-secimi.json` (Rust `tests/zincir_secimi.rs` okur): bayat yok · adlar
//   §4 ✓K bayatlık karşılaştırıcısı mutasyonda ısırır, eşitte susar
//
// NEGATİF SONDA (✓B, bir kezlik; arşiv 2026-10-08): seçimde `revoked` denetimi kaldırılınca §2 "iptalli en geç bitiş
//   elenir" ve "hepsi geçersiz" kırmızı; en geç bitiş yerine ilk geçerli seçilince §2 "çift kid" kırmızı.
// =============================================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DAY_MS,
  PackageRevocationSchema,
  TYP,
  chainedFileName,
  chainedPgCandidate,
  chainedReleaseCandidate,
  msToIso,
  parseChainedFileName,
  selectChainedDocument,
  signDocument,
  verifyPackageRevocation,
  type ChainedFamily,
  type PackagePublicKey,
  type PackageRevocationDoc,
  type PackageVerifyMode,
  type RootKey,
} from "../src/lib/license/protocol";
import { anahtarUret, fiksturKur, hamImzala, sertifikaBas, sertifikaYuku, type TestAnahtari } from "./lib/lisans-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const TEKS = path.resolve(__dirname, "..");
const DOSYA = path.join(TEKS, "native", "test-vektorleri", "zincir-secimi.json");
const BICIM = 1;
const T0 = Date.parse("2026-10-01T00:00:00.000Z");
const KANAL = "testfabrika";

interface GuvenGirdisi {
  readonly keys: PackagePublicKey[];
  readonly roots: RootKey[];
  readonly mode: PackageVerifyMode;
  readonly nowMs?: number;
  readonly iptal: string | null;
}
interface Vektor {
  readonly ad: string;
  readonly aile: ChainedFamily;
  readonly kanal: string;
  readonly guven: GuvenGirdisi;
  readonly adaylar: readonly { readonly ad: string; readonly metin: string }[];
}
interface Kayit {
  readonly vektor: Vektor;
  readonly beklenen: unknown;
}

function jsonKopya(x: unknown): unknown {
  return x === undefined ? null : JSON.parse(JSON.stringify(x));
}

/** Bir vektörün BUGÜNKÜ TS sonucu (Rust testi aynı biçimi üretir; hata metni değil yalnız kod). */
function degerlendir(v: Vektor): unknown {
  const g = v.guven;
  let revocation = null;
  if (g.iptal !== null) {
    const r = verifyPackageRevocation(g.iptal, g.roots);
    if (!r.ok) return { iptalHatasi: r.code };
    revocation = r.value;
  }
  const zincir = { roots: g.roots, mode: g.mode, revocation, ...(g.nowMs === undefined ? {} : { nowMs: g.nowMs }) };
  const secim =
    v.aile === "pg"
      ? selectChainedDocument(v.aile, v.adaylar.map((a) => chainedPgCandidate(a.ad, a.metin, { keys: g.keys, zincir })))
      : selectChainedDocument(v.aile, v.adaylar.map((a) => chainedReleaseCandidate(a.ad, a.metin, { keys: g.keys, kanal: v.kanal, zincir })));
  if (secim === null) return { secim: null };
  if (!secim.ok) return { ok: false, code: secim.code };
  return { ok: true, ad: secim.value.ad, kid: secim.value.signed.kid, elenen: secim.value.elenen.map((e) => ({ ad: e.ad, code: e.code })) };
}

const f = fiksturKur(T0);
const PKT1 = anahtarUret("pkt-2026-1");
const PKT2 = anahtarUret("pkt-2027-1");
const PKT3 = anahtarUret("pkt-2027-2");
const ESKI = anahtarUret("paket-2026");
const ESKI_KEYS: PackagePublicKey[] = [{ kid: ESKI.kid, x: ESKI.x }];

const SERT1 = sertifikaYuku(f, PKT1, "PAKET");
const SERT2 = sertifikaYuku(f, PKT2, "PAKET", { bitis: msToIso(T0 + 530 * DAY_MS) });
const SERT3 = sertifikaYuku(f, PKT3, "PAKET", { bitis: SERT2.bitis });
const SERT: Record<string, { yuk: typeof SERT1; token: string }> = {
  [PKT1.kid]: { yuk: SERT1, token: sertifikaBas(f.kok, SERT1) },
  [PKT2.kid]: { yuk: SERT2, token: sertifikaBas(f.kok, SERT2) },
  [PKT3.kid]: { yuk: SERT3, token: sertifikaBas(f.kok, SERT3) },
};

const PAKET_ID = "6f1c2b8e-3a4d-4e5f-9a0b-1c2d3e4f5a6b";
const PG_YUK = {
  v: 1,
  urun: "postgresql",
  platform: "win32-x64",
  cizgi: 16,
  surum: "16.15",
  derleme: 4,
  paket: { ad: "postgresql-16.15-4-win-x64.zip", boyut: 97_000_000, sha256: "2".repeat(64) },
  icerikSha256: "3".repeat(64),
  icuSurum: "67",
  yayinZamani: "2026-09-30T21:00:00.000Z",
};

/** Sürüm bildirimi yükü; yeniden imzada (`yeniden`) zip adı/özeti değişir, belge kimliği değişmez. */
function bildirim(imzaci: TestAnahtari, ek: Record<string, unknown> = {}, yeniden = false): Record<string, unknown> {
  return {
    v: 1,
    urun: "backend",
    platform: "win32-x64",
    kanal: KANAL,
    surum: "2.11.0",
    commit: "91c79ebd",
    derlemeTarihi: "2026-09-30T18:00:00.000Z",
    yayinZamani: "2026-09-30T20:00:00.000Z",
    paket: yeniden
      ? { ad: `tekserp-backend-2.11.0-${imzaci.kid}.zip`, boyut: 187_654_400, sha256: "b".repeat(64), paketId: PAKET_ID }
      : { ad: "tekserp-backend-2.11.0.zip", boyut: 187_654_321, sha256: "a".repeat(64), paketId: PAKET_ID },
    paketImzaKid: imzaci.kid,
    minKaynakSurum: "2.9.0",
    gocSayisi: 251,
    pg: { cizgi: 16, enAz: "16.9", hedef: null },
    runtime: { node: "24.18.0" },
    notlar: { ozet: "Sevkiyat ekranı hızlandı." },
    zorunlu: false,
    ...ek,
  };
}

/** İşaretçi metni `{v:1, bildirim}`; `pkt-*` imzacıda sertifika + imza anı yüke girer. */
function isaretci(typ: string, imzaci: TestAnahtari, yuk: Record<string, unknown>): string {
  const p = imzaci.kid.startsWith("pkt-") ? { ...yuk, paketSertifikasi: SERT[imzaci.kid]!.token, imzaZamani: msToIso(T0) } : yuk;
  return JSON.stringify({ v: 1, bildirim: hamImzala(typ, imzaci, p) });
}
const surum = (imzaci: TestAnahtari, ek: Record<string, unknown> = {}, yeniden = false) => isaretci(TYP.SURUM, imzaci, bildirim(imzaci, ek, yeniden));
const pg = (imzaci: TestAnahtari) => isaretci(TYP.PG, imzaci, PG_YUK);

function paketIptal(kidler: readonly string[]): string {
  const yuk: PackageRevocationDoc = {
    v: 1,
    iptalId: randomUUID(),
    sira: 1,
    verilis: msToIso(T0 - DAY_MS),
    iptaller: kidler.map((kid) => ({ kid, sertifikaId: SERT[kid]!.yuk.sertifikaId, tarih: msToIso(T0 - DAY_MS), neden: "sızıntı" })),
  };
  return signDocument({ typ: TYP.PAKET_IPTAL, schema: PackageRevocationSchema, payload: yuk, key: f.kok });
}

const guven = (ek: Partial<GuvenGirdisi> = {}): GuvenGirdisi => ({ keys: ESKI_KEYS, roots: f.kokler, mode: "YERLESIK", iptal: null, ...ek });
const KABUL = guven({ mode: "KABUL", nowMs: T0 });
const ESKI_AD = chainedFileName("surum");
const ad = (kid: string, aile: ChainedFamily = "surum") => chainedFileName(aile, kid);
const vaka = (baslik: string, adaylar: Vektor["adaylar"], g: GuvenGirdisi = guven(), aile: ChainedFamily = "surum"): Vektor => ({ ad: baslik, aile, kanal: KANAL, guven: g, adaylar });

/** Adlı vaka + beklenen: kazanan ad (elenenler `AD:KOD`) ya da hata kodu ya da `YOK` (aday yok). */
const VAKALAR: { vektor: Vektor; beklenen: string }[] = [
  { beklenen: "YOK", vektor: vaka("aday yok", []) },
  { beklenen: `${ESKI_AD}`, vektor: vaka("yalnız eski ad (kid'siz) geçerli", [{ ad: ESKI_AD, metin: surum(PKT1) }]) },
  { beklenen: `${ad(PKT1.kid)}`, vektor: vaka("yalnız yeni ad (kid'li) geçerli", [{ ad: ad(PKT1.kid), metin: surum(PKT1) }]) },
  {
    beklenen: `${ad(PKT2.kid)}`,
    vektor: vaka("çift kid: en geç bitiş kazanır (yeniden imzada zip adı farklı, belge aynı)", [
      { ad: ESKI_AD, metin: surum(PKT1) },
      { ad: ad(PKT2.kid), metin: surum(PKT2, {}, true) },
    ]),
  },
  {
    beklenen: `${ad(PKT2.kid)}`,
    vektor: vaka("çift kid KABUL kipinde", [
      { ad: ESKI_AD, metin: surum(PKT1) },
      { ad: ad(PKT2.kid), metin: surum(PKT2, {}, true) },
    ], KABUL),
  },
  {
    beklenen: `${ad(PKT1.kid)} ← ${ESKI_AD}:PAKET_SERTIFIKA_IPTAL`,
    vektor: vaka("iptalli en geç bitiş elenir (YERLEŞİK)", [
      { ad: ESKI_AD, metin: surum(PKT2) },
      { ad: ad(PKT1.kid), metin: surum(PKT1, {}, true) },
    ], guven({ iptal: paketIptal([PKT2.kid]) })),
  },
  {
    beklenen: `${ad(PKT2.kid)} ← ${ESKI_AD}:PAKET_SERTIFIKA_IPTAL`,
    vektor: vaka("kid'siz iptalli + kid'li geçerli (KABUL)", [
      { ad: ESKI_AD, metin: surum(PKT1) },
      { ad: ad(PKT2.kid), metin: surum(PKT2, {}, true) },
    ], { ...KABUL, iptal: paketIptal([PKT1.kid]) }),
  },
  { beklenen: "JWS_KID", vektor: vaka("ad kid'i imzalayan değil", [{ ad: ad(PKT2.kid), metin: surum(PKT1) }]) },
  { beklenen: "PAKET_SERTIFIKA_YOK", vektor: vaka("paket-* imzalı zincirli ad", [{ ad: ESKI_AD, metin: surum(ESKI) }]) },
  {
    beklenen: "SURUM_ISARETCI",
    vektor: vaka("farklı belge → belirsiz", [
      { ad: ESKI_AD, metin: surum(PKT1) },
      { ad: ad(PKT2.kid), metin: surum(PKT2, { notlar: { ozet: "başka not" } }, true) },
    ]),
  },
  {
    beklenen: "SURUM_ISARETCI",
    vektor: vaka("farklı paketId → belirsiz", [
      { ad: ESKI_AD, metin: surum(PKT1) },
      { ad: ad(PKT2.kid), metin: surum(PKT2, { paket: { ad: "x.zip", boyut: 1, sha256: "c".repeat(64), paketId: randomUUID() } }) },
    ]),
  },
  {
    beklenen: "SURUM_ISARETCI",
    vektor: vaka("eşit bitiş → belirsiz", [
      { ad: ad(PKT2.kid), metin: surum(PKT2, {}, true) },
      { ad: ad(PKT3.kid), metin: surum(PKT3, {}, true) },
    ]),
  },
  {
    beklenen: "PAKET_SERTIFIKA_IPTAL",
    vektor: vaka("hepsi geçersiz: iki aday da iptalli", [
      { ad: ESKI_AD, metin: surum(PKT1) },
      { ad: ad(PKT2.kid), metin: surum(PKT2, {}, true) },
    ], guven({ iptal: paketIptal([PKT1.kid, PKT2.kid]) })),
  },
  {
    beklenen: "PAKET_SERTIFIKA_YOK",
    vektor: vaka("hepsi geçersiz: ilk elenenin kodu (kid'siz önce)", [
      { ad: ad(PKT2.kid), metin: surum(PKT2, {}, true) },
      { ad: ESKI_AD, metin: surum(ESKI) },
    ], guven({ iptal: paketIptal([PKT2.kid]) })),
  },
  {
    beklenen: `${ad(PKT1.kid)} ← ${ESKI_AD}:SURUM_ISARETCI`,
    vektor: vaka("bozuk işaretçi elenir, geçerli kid'li seçilir", [
      { ad: ESKI_AD, metin: "{bozuk" },
      { ad: ad(PKT1.kid), metin: surum(PKT1) },
    ]),
  },
  {
    beklenen: `${ad(PKT1.kid)} ← ${ESKI_AD}:SURUM_KANAL`,
    vektor: vaka("başka kanalın bildirimi elenir", [
      { ad: ESKI_AD, metin: surum(PKT2, { kanal: "adnansahin" }) },
      { ad: ad(PKT1.kid), metin: surum(PKT1) },
    ]),
  },
  { beklenen: "SURUM_ISARETCI", vektor: vaka("başka ailenin adı", [{ ad: chainedFileName("pg"), metin: surum(PKT1) }]) },
  { beklenen: "SURUM_ISARETCI", vektor: vaka("son ailesinde kid'li ad yok", [{ ad: "son-zincir-pkt-2026-1.json", metin: surum(PKT1) }], guven(), "son") },
  { beklenen: "son-zincir.json", vektor: vaka("son ailesi kid'siz", [{ ad: "son-zincir.json", metin: surum(PKT1) }], guven(), "son") },
  {
    beklenen: `${ad(PKT2.kid, "pg")}`,
    vektor: vaka("pg ailesi: çift kid", [
      { ad: chainedFileName("pg"), metin: pg(PKT1) },
      { ad: ad(PKT2.kid, "pg"), metin: pg(PKT2) },
    ], guven(), "pg"),
  },
  {
    beklenen: `${chainedFileName("pg")} ← ${ad(PKT2.kid, "pg")}:PAKET_SERTIFIKA_IPTAL`,
    vektor: vaka("pg ailesi: iptalli kid'li elenir", [
      { ad: chainedFileName("pg"), metin: pg(PKT1) },
      { ad: ad(PKT2.kid, "pg"), metin: pg(PKT2) },
    ], guven({ iptal: paketIptal([PKT2.kid]) }), "pg"),
  },
];

/** Sonucun kısa biçimi: `YOK` · hata kodu · `<kazanan> ← <elenen>:<kod>, …`. */
function ozet(b: unknown): string {
  const r = b as { secim?: null; ok?: boolean; code?: string; ad?: string; elenen?: { ad: string; code: string }[]; iptalHatasi?: string };
  if (r.iptalHatasi) return `IPTAL:${r.iptalHatasi}`;
  if ("secim" in r) return "YOK";
  if (!r.ok) return String(r.code);
  const e = r.elenen ?? [];
  return e.length === 0 ? String(r.ad) : `${r.ad} ← ${e.map((x) => `${x.ad}:${x.code}`).join(", ")}`;
}

function bayatlar(kayitlar: readonly Kayit[]): string[] {
  return kayitlar.filter((k) => JSON.stringify(degerlendir(k.vektor)) !== JSON.stringify(k.beklenen)).map((k) => k.vektor.ad);
}

const TAZE: Kayit[] = VAKALAR.map((v) => ({ vektor: jsonKopya(v.vektor) as Vektor, beklenen: degerlendir(v.vektor) }));

function bolum1(): void {
  console.log("\n§1 — zincirli adlar");
  check("§1a kid'siz ad", chainedFileName("surum") === "surum-zincir.json" && chainedFileName("pg") === "pg-zincir.json");
  check("§1b kid'li ad", chainedFileName("surum", "pkt-2027-1") === "surum-zincir-pkt-2027-1.json");
  let son = false;
  try {
    chainedFileName("son", "pkt-2027-1");
  } catch {
    son = true;
  }
  let eski = false;
  try {
    chainedFileName("pg", "paket-2026");
  } catch {
    eski = true;
  }
  check("§1c son ailesine ve pkt-* dışı kid'e ad verilmez", son && eski);
  const p = parseChainedFileName("pg-zincir-pkt-2027-1.json");
  check("§1d ayrıştırma: aile + kid", p?.aile === "pg" && p.kid === "pkt-2027-1" && parseChainedFileName("surum-zincir.json")?.kid === null);
  check(
    "§1e ayrıştırma reddi: son kid'li · paket-* kid · eski adlar · yol",
    ["son-zincir-pkt-2027-1.json", "surum-zincir-paket-2026.json", "surum.json", "pg.json", "x/surum-zincir.json", "surum-zincir-pkt-.json"].every((a) => parseChainedFileName(a) === null),
  );
}

function bolum2(): void {
  console.log("\n§2 — adlı seçim vakaları");
  for (const v of VAKALAR) {
    const got = ozet(degerlendir(v.vektor));
    check(`§2 ${v.vektor.aile} · ${v.vektor.ad} → ${v.beklenen}`, got === v.beklenen, got === v.beklenen ? "" : `gelen ${got}`);
  }
}

function dosyaOku(): { bicim: number; kayitlar: Kayit[] } | null {
  if (!existsSync(DOSYA)) return null;
  return JSON.parse(readFileSync(DOSYA, "utf8")) as { bicim: number; kayitlar: Kayit[] };
}

function bolum3(): void {
  console.log("\n§3 — vektör dosyası (native/test-vektorleri/zincir-secimi.json)");
  const d = dosyaOku();
  check(`§3a dosya var ve biçim ${BICIM}`, d !== null && d.bicim === BICIM && d.kayitlar.length === VAKALAR.length, d ? `${d.kayitlar.length} kayıt` : "yok — --vektor-yaz");
  if (!d) return;
  const bayat = bayatlar(d.kayitlar);
  check("§3b ⭐ bayat değil (beklenen = bugünkü TS)", bayat.length === 0, bayat.slice(0, 5).join(" · ") || "temiz");
  const adlar = new Set(VAKALAR.map((v) => v.vektor.ad));
  check("§3c dosyadaki adlar = vaka adları (tekil)", adlar.size === VAKALAR.length && d.kayitlar.every((k) => adlar.has(k.vektor.ad)));
}

function bolum4(): void {
  console.log("\n§4 — ✓K kalıcı sonda");
  const saglam = TAZE.slice(0, 4);
  check("§4a bayatlık denetimi özdeş kayıtta SUSAR", bayatlar(saglam).length === 0);
  const bozuk = saglam.map((k, i) => (i === 3 ? { ...k, beklenen: { ok: false, code: "SURUM_ISARETCI" } } : k));
  check("§4b bayatlık denetimi mutasyonlu beklenende ISIRIR", bayatlar(bozuk).length === 1);
}

function vektorYaz(): void {
  mkdirSync(path.dirname(DOSYA), { recursive: true });
  const bas = JSON.stringify({ bicim: BICIM, not: "Üreten: Teks-Erp/scripts/test_zincir_secimi.ts --vektor-yaz (TS kâhini). Elle düzenlenmez." });
  writeFileSync(DOSYA, `${bas.slice(0, -1)},"kayitlar":[\n${TAZE.map((k) => JSON.stringify(k)).join(",\n")}\n]}\n`);
  console.log(`✓ ${path.relative(TEKS, DOSYA)} — ${TAZE.length} kayıt`);
}

function main(): void {
  if (process.argv.includes("--vektor-yaz")) return vektorYaz();
  bolum1();
  bolum2();
  bolum3();
  bolum4();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
