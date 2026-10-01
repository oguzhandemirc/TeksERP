// SENARYO L — L35 · L36: lisans v2 G4 (ara imzacı · iptal belgesi · dönem töreni atlanması). Tasarım
// `docs/design/LISANS-V2-CEVRIMDISI-KIRA.md` §2.1–§2.4 · §6 K4; kural `docs/kurallar/lisans.md` (:21 hiyerarşi · :72–:76
// iptal deposu/pin/zincir). Satıcı tarafı tören araçlarıyla yürür (gerçek `scripts/anahtar.ts`: ara-uret · iptal-uret ·
// donem-ice-aktar · emekliye-ayir; runbook `docs/ops/URETIM-SATICI-TOREN.md` §8) — taklit belge basılmaz.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DAY_MS } from "../../src/lib/license/protocol";
import { LICENSE_FILES } from "../../src/lib/license/store";
import type { LisansDetayi, Yanit } from "./senaryo-lisans-istemci";
import { SATICI_KOKU } from "./senaryo-lisans-surec";
import { kur, type AdimYuzu, type MerdivenBaglami, type RolFabrika } from "./senaryo-lisans-v2-merdiven";
import { nedenOzeti } from "./senaryo-lisans-v2-duzenek";

/** Merdiven bağlamı + satıcının anahtar birimi ve dünya saati (L35–L38). */
export interface G4Baglami<F extends RolFabrika> extends MerdivenBaglami<F> {
  readonly anahtarDizini: string;
  readonly kokKid: string;
  /** Satıcı CLI ortamı (`ANAHTAR_DIZINI` + `GUVEN_CAPASI_DOSYASI` + satıcı `_test` DB'si). */
  readonly saticiEnv: NodeJS.ProcessEnv;
  readonly saticiGenel: string;
  readonly dunyayiIlerlet: (ms: number) => Promise<void>;
  /** Satıcı temizliğine kid / lisans kimliği ekler. */
  readonly kidEkle: (kid: string) => void;
  readonly kurulumKimligiEkle: (id: string) => void;
}

interface AraImzaci {
  readonly kid: string;
  readonly parola: string;
  readonly dosya: string;
}
interface Zincir {
  hakImzacisi: { kind: string; kid: string; sertifika: { bitis: string } | null } | null;
  iptal: { sira: number | null; pin: number | null; durum: string };
}

const K_PARMAK_IZI = { makine: "5E0A0001-0000-4000-8000-0000000000E1", seri: "SENARYOK01" };
/** L35'in kurduğu K ve ikinci ara imzacı — L36 (koşumun sonunda) aynı kurulumla devam eder. */
const durum: { k: { f: RolFabrika; dbId: string; hakId: string } | null; ara: AraImzaci | null } = { k: null, ara: null };

const ozet = (y: Yanit): string => `${y.status}${y.kod ? ` ${y.kod}` : ""}`;
const kademe = (d: LisansDetayi): string => `${d.durum.hesaplananKademe}/${d.durum.uygulananKademe}`;
const bekle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const tamam = (d: LisansDetayi): boolean => d.durum.gecerlilik === "GECERLI" && kademe(d) === "NORMAL/NORMAL";

function anahtarCli<F extends RolFabrika>(b: G4Baglami<F>, argv: string[], girdi = ""): { ok: boolean; cikti: string } {
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/anahtar.ts", ...argv], { cwd: SATICI_KOKU, env: b.saticiEnv, input: girdi, encoding: "utf8", timeout: 120_000 });
  return { ok: r.status === 0, cikti: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-2).join(" | ") };
}

async function zincir(f: RolFabrika): Promise<Zincir | null> {
  return ((await f.istemci.istek("GET", "/api/license/detay")).veri.zincir ?? null) as Zincir | null;
}
const zincirOzeti = (z: Zincir | null): string =>
  `imzaci=${z?.hakImzacisi?.kind}:${z?.hakImzacisi?.kid} iptal=sira ${String(z?.iptal.sira)}/pin ${String(z?.iptal.pin)}/${z?.iptal.durum}`;

/** Gerçek tören aracıyla ara imzacı (kök parolası + ara parolası ×2 stdin'den); anahtar deposu 2 sn'de yenilenir. */
async function araUret<F extends RolFabrika>(b: G4Baglami<F>, a: AdimYuzu, ad: string): Promise<AraImzaci | null> {
  const kid = `ara-2026-${100 + Math.floor(Math.random() * 899)}`;
  const parola = `Senaryo-Ara-${randomBytes(9).toString("base64url")}!9`;
  const r = anahtarCli(b, ["ara-uret", `--kid=${kid}`, `--kok=${b.kokKid}`, `--dizin=${b.anahtarDizini}`], `${b.kokParolasi}\n${parola}\n${parola}\n`);
  b.kidEkle(kid);
  await bekle(3_000);
  const an = await b.portal.istek("GET", "/anahtarlar");
  const satir = ((an.veri.anahtarlar ?? []) as Array<{ kid: string; yuklu: boolean; tur: string }>).find((x) => x.kid === kid);
  a.kontrol(`${ad}: tören aracı ara imzacı üretti (kök imzalı HAK sertifikası, 120 g) → satıcı deposunda yüklü — §2.1 · §2.4 · lisans.md:21`, r.ok && satir?.yuklu === true, `${r.cikti} · portal ${satir?.tur ?? "-"} yuklu=${String(satir?.yuklu)}`);
  return r.ok ? { kid, parola, dosya: path.join(b.anahtarDizini, `${kid}.ara.json`) } : null;
}

/** İptal belgesi (yalnız kök) → tören paketinin içe aktarımı (VDS adımı 6). */
function iptalYayinla<F extends RolFabrika>(b: G4Baglami<F>, a: AdimYuzu, ara: AraImzaci): number | null {
  const gecici = fs.mkdtempSync(path.join(os.tmpdir(), "senaryo-iptal-"));
  try {
    const cikti = path.join(gecici, "iptal.json");
    const u = anahtarCli(b, ["iptal-uret", `--kok=${b.kokKid}`, `--kok-dizin=${b.anahtarDizini}`, `--cikti=${cikti}`, `--iptal=${ara.dosya}`, "--neden=Senaryo L35 ara imzacı ele geçti"], `${b.kokParolasi}\n`);
    const belge = u.ok ? (JSON.parse(fs.readFileSync(cikti, "utf8")) as { sira: number; belge: string }) : null;
    const paket = path.join(gecici, "ice-aktar.json");
    if (belge) fs.writeFileSync(paket, JSON.stringify({ v: 1, tur: "tekserp-donem-ice-aktar", iptal: belge.belge, haklar: [] }));
    const i = belge ? anahtarCli(b, ["donem-ice-aktar", `--dosya=${paket}`]) : { ok: false, cikti: "-" };
    a.kontrol(`iptal belgesi (kök; ${ara.kid} satırı) üretildi ve içe aktarıldı → EKLENDI — §2.3 tür/alanlar · runbook §8 adım 6`, Boolean(belge) && i.ok && /EKLENDI/.test(i.cikti), `${u.cikti} · ${i.cikti}`);
    return belge && i.ok ? belge.sira : null;
  } finally {
    fs.rmSync(gecici, { recursive: true, force: true });
  }
}

// ============================================================ L35
export async function l35IptalTuru<F extends RolFabrika>(b: G4Baglami<F>, a: AdimYuzu): Promise<void> {
  const k = await kur(b, a, "K", { parmakIzi: K_PARMAK_IZI });
  if (!k) return;
  const { f, dbId, hakId } = k;
  durum.k = k;
  const ara1 = await araUret(b, a, "ara-1");
  if (!ara1) return;
  const plan = await b.portal.istek("GET", `/haklar/${hakId}/imza-plani`);
  if (!a.kontrol("K: hak-ara bildiren kurulumda imza planı ARA (ara-1) — §2.6-2 · lisans.md:21", plan.veri.imzaci === "ARA" && plan.veri.kid === ara1.kid, `${ozet(plan)} ${JSON.stringify(plan.veri)}`)) {
    a.kismi("kurulum hak-ara yeteneğini bildirmiyor (çekirdek canlı değil?) — ara imzalı HAK bu düzenekte kurulamadı");
    return;
  }
  const s2 = await b.portal.istek("POST", `/haklar/${hakId}/surum`, { imzaci: "ARA", imzaParolasi: ara1.parola, sebep: "Senaryo L35 ara imzalı sürüm", moduller: [...b.hakModulleri] });
  await f.istemci.yokla();
  const d2 = await f.istemci.detay();
  const z2 = await zincir(f);
  const eski = f.aktarici.sonKayit("/v1/yokla");
  const eskiYanit = eski ? (JSON.parse(eski.yanit) as { hak?: string | null }) : null;
  a.kontrol(
    "HAK v2 ara-1 imzalı → K yoklamada alır; detay zinciri ARA + sertifika, GECERLI/NORMAL — §2.2 · lisans.md:76",
    s2.status === 201 && s2.veri.imzalayanKid === ara1.kid && d2.hak?.surum === 2 && z2?.hakImzacisi?.kind === "ARA" && z2.hakImzacisi.kid === ara1.kid && Boolean(z2.hakImzacisi.sertifika) && tamam(d2) && Boolean(eskiYanit?.hak),
    `${ozet(s2)} hak.surum=${d2.hak?.surum} ${zincirOzeti(z2)} ${kademe(d2)} yanıtta hak=${eskiYanit?.hak ? "var" : "yok"}`,
  );
  const ara2 = await araUret(b, a, "ara-2");
  if (!ara2) return;
  durum.ara = ara2;
  const sira = iptalYayinla(b, a, ara1);
  if (sira === null) return;
  const ib1 = await b.portal.istek("GET", "/iptal-belgeleri");
  const bek = ib1.veri.bekleyen as { sira: number; engeller: Array<{ tur: string; kid: string; hakId?: string }> } | null;
  a.kontrol(
    "satıcı kapısı: iptal, onu geçersiz kılacağı HAK yeniden basılmadan + eski anahtar emekliye ayrılmadan DAĞITILMAZ (bekleyen: HAK + ANAHTAR) — §2.3 satıcı kapısı · runbook §8 adım 7",
    bek?.sira === sira && bek.engeller.some((e) => e.tur === "HAK" && e.hakId === hakId && e.kid === ara1.kid) && bek.engeller.some((e) => e.tur === "ANAHTAR" && e.kid === ara1.kid) && ib1.veri.dagitilanSira !== sira,
    `dagitilan=${String(ib1.veri.dagitilanSira)} bekleyen=${JSON.stringify(bek)}`,
  );
  const y3 = await f.istemci.yokla();
  const d3 = await f.istemci.detay();
  a.kontrol("kapıda bekleyen iptal fabrikaya gitmez; K aniden durmaz (BASARILI, HAK v2, NORMAL) — §2.3 'fabrika aniden durmaz'", y3.outcome === "BASARILI" && d3.hak?.surum === 2 && tamam(d3), `${y3.outcome} ${y3.code ?? ""} ${zincirOzeti(await zincir(f))} ${kademe(d3)}`);
  const rb = await b.portal.istek("POST", "/haklar/toplu-yeniden-bas", { imzaParolasi: ara2.parola, sebep: "Senaryo L35 iptal öncesi yeniden basım", hakIdleri: [hakId] });
  const basilan = (rb.veri.basilan ?? []) as Array<{ hakId: string; imzalayanKid: string }>;
  const emk = anahtarCli(b, ["emekliye-ayir", `--kid=${ara1.kid}`, "--uygula", `--dizin=${b.anahtarDizini}`]);
  await bekle(3_000);
  const ib2 = await b.portal.istek("GET", "/iptal-belgeleri");
  a.kontrol(
    "toplu yeniden basım (ara-2) + ara-1 emekliye → kapı açılır, belge dağıtılır — §2.3 · §2.4 'eski özel yarılar silinir' · runbook §8 adım 8",
    rb.status === 201 && basilan.some((x) => x.hakId === hakId && x.imzalayanKid === ara2.kid) && emk.ok && ib2.veri.dagitilanSira === sira && ib2.veri.bekleyen === null,
    `${ozet(rb)} ${JSON.stringify(basilan)} · ${emk.cikti} · dagitilan=${String(ib2.veri.dagitilanSira)} bekleyen=${JSON.stringify(ib2.veri.bekleyen)}`,
  );
  const y4 = await f.istemci.yokla();
  const d4 = await f.istemci.detay();
  const z4 = await zincir(f);
  a.kontrol(
    "K yeni arayla imzalı HAK'ı (v3, ara-2) ve kirayla gelen iptal belgesini kabul eder: zincir ara-2, iptal GUNCEL + pin = sıra; NORMAL — §2.3 dağıtım (kirayla yayılır) · lisans.md:72–:76",
    y4.outcome === "BASARILI" && d4.hak?.surum === 3 && z4?.hakImzacisi?.kid === ara2.kid && z4.iptal.sira === sira && z4.iptal.pin === sira && z4.iptal.durum === "GUNCEL" && tamam(d4),
    `${y4.outcome} hak.surum=${d4.hak?.surum} ${zincirOzeti(z4)} ${kademe(d4)}`,
  );
  if (eskiYanit) {
    const r = await f.istemci.istek("POST", "/api/license/cevrimdisi-yanit", { yanit: eskiYanit });
    a.kontrol(
      "iptal edilmiş arayla (ara-1) imzalı HAK taşıyan yanıt → RED 400 LICENSE_RESPONSE_INVALID / SERTIFIKA_IPTAL; kurulum etkilenmez — §2.3 'hata kodu SERTIFIKA_IPTAL'",
      r.status === 400 && r.kod === "LICENSE_RESPONSE_INVALID" && r.details.protocolCode === "SERTIFIKA_IPTAL" && (await f.istemci.detay()).hak?.surum === 3,
      `${ozet(r)} protocolCode=${String(r.details.protocolCode)}`,
    );
  }
  await iptalKaybi(b, a, f, sira);
}

/** Pin varken iptal belgesinin iki kopyası (dosya + DB) — §2.3 'Dosya silinirse DB izinden geri gelir' · lisans.md:74. */
async function iptalKaybi<F extends RolFabrika>(b: G4Baglami<F>, a: AdimYuzu, f: RolFabrika, sira: number): Promise<void> {
  const dosya = path.join(f.lisansDizini, LICENSE_FILES.REVOCATION);
  f.aktarici.kipAyarla("kesik");
  await b.durdur(f as F);
  fs.rmSync(dosya, { force: true });
  await b.baslat(f as F);
  const d1 = await f.istemci.detay();
  const z1 = await zincir(f);
  a.kontrol("yalnız iptal.jws silinir → DB kopyasından onarılır, bulgu yok — §2.3 · lisans.md:72", fs.existsSync(dosya) && z1?.iptal.durum === "GUNCEL" && !nedenOzeti(d1).includes("IPTAL_BELGESI_KAYIP"), `dosya=${fs.existsSync(dosya)} ${zincirOzeti(z1)} [${nedenOzeti(d1)}]`);
  await b.durdur(f as F);
  fs.rmSync(dosya, { force: true });
  await b.db(f.databaseUrl).query(`DELETE FROM system_settings WHERE key = 'license.revocation'`);
  await b.baslat(f as F);
  const d2 = await f.istemci.detay();
  const z2 = await zincir(f);
  a.kontrol(
    "iki kopya da yok, pin var → IPTAL_BELGESI_KAYIP (ÖLÇÜLEMEDİ); kira ve HAK düşmez, aniden durmaz — §2.3 · lisans.md:74",
    nedenOzeti(d2).includes("IPTAL_BELGESI_KAYIP") && z2?.iptal.durum === "KAYIP" && z2.iptal.pin === sira && d2.kira !== null && d2.hak?.surum === 3 && d2.durum.hesaplananKademe !== "KISITLI",
    `${zincirOzeti(z2)} ${d2.durum.gecerlilik} ${kademe(d2)} [${nedenOzeti(d2)}]`,
  );
  f.aktarici.kipAyarla("acik");
  const y = await f.istemci.yokla();
  const d3 = await f.istemci.detay();
  const z3 = await zincir(f);
  a.kontrol("internet geri → yoklama yanıtındaki belge iki kopyayı onarır, bulgu kalkar — §2.3 dağıtım · lisans.md:72", y.outcome === "BASARILI" && z3?.iptal.durum === "GUNCEL" && !nedenOzeti(d3).includes("IPTAL_BELGESI_KAYIP") && fs.existsSync(dosya), `${y.outcome} ${zincirOzeti(z3)} [${nedenOzeti(d3)}]`);
}

// ============================================================ L36
/** Portal bildirimi: `ANAHTAR_SURESI_BITIYOR`, bu kid ve eşik (K4: 30/15/7/1). */
async function anahtarUyarisi<F extends RolFabrika>(b: G4Baglami<F>, kid: string, esik: number): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    const l = await b.portal.istek("GET", "/bildirimler?olay=ANAHTAR_SURESI_BITIYOR&limit=200");
    if (((l.veri.items ?? []) as unknown[]).some((x) => JSON.stringify(x).includes(kid) && JSON.stringify(x).includes(`${esik} gün kala`))) return true;
    await bekle(500);
  }
  return false;
}

export async function l36TorenAtlanmasi<F extends RolFabrika>(b: G4Baglami<F>, a: AdimYuzu): Promise<void> {
  const { k, ara } = durum;
  if (!k || !ara) {
    a.kismi("L35 K kurulumu / ara-2 yok — L36 L35'in tören sonrası hâlinden devam eder");
    return;
  }
  const f = k.f as F;
  const kokDosyasi = path.join(b.anahtarDizini, `${b.kokKid}.kok.json`);
  const kokYedegi = `${kokDosyasi}.senaryo-disarida`;
  // G4 düzeni (§2.6-2): kök VDS'te durmaz — kök gerektiren iş kuyruğa düşer.
  fs.renameSync(kokDosyasi, kokYedegi);
  try {
    await bekle(3_000);
    await torenAdimlari(b, a, f, k, ara);
  } finally {
    fs.renameSync(kokYedegi, kokDosyasi);
  }
}

async function torenAdimlari<F extends RolFabrika>(b: G4Baglami<F>, a: AdimYuzu, f: F, k: { dbId: string; hakId: string }, ara: AraImzaci): Promise<void> {
  const bitisMs = Date.parse(((await zincir(f))?.hakImzacisi?.sertifika?.bitis ?? "") || "");
  const kalan = (): number => (bitisMs - b.saticiSimdi()) / DAY_MS;
  const p = b.portal;
  const m = await p.istek("POST", "/musteriler", { ad: `Senaryo L Tekstil eski derleme ${randomBytes(3).toString("hex")}` });
  const t = await p.istek("POST", "/tesisler", { musteriId: String(m.veri.id), ad: "Tesis eski derleme" });
  const ku = await p.istek("POST", "/kurulumlar", { tesisId: String(t.veri.id), sinif: "URETIM", kanalKodu: b.kanal, yoklamaAraligiDk: 5 });
  if (typeof ku.veri.kurulumId === "string") b.kurulumKimligiEkle(ku.veri.kurulumId);
  const h = await p.istek("POST", `/kurulumlar/${String(ku.veri.id)}/hak`, { moduller: [...b.hakModulleri], kalici: false, bakimBitis: new Date(b.saticiSimdi() + 365 * DAY_MS).toISOString() });
  await b.dunyayiIlerlet((kalan() - 29.5) * DAY_MS);
  const uyari30 = await anahtarUyarisi(b, ara.kid, 30);
  const plan = await p.istek("GET", `/haklar/${String(h.veri.id)}/imza-plani`);
  const kuyruk = await p.istek("POST", `/haklar/${String(h.veri.id)}/surum`, { imzaci: "KUYRUK", sebep: "Senaryo L36 eski derleme HAK'ı" });
  const kl = await p.istek("GET", "/kok-kuyrugu?durum=BEKLIYOR");
  const kuyrukta = ((kl.veri.items ?? []) as Array<{ id: string }>).some((x) => x.id === kuyruk.veri.talepId);
  a.kontrol(
    `ara imzacının bitişine ${kalan().toFixed(1)} g: portal ANAHTAR_SURESI_BITIYOR (30 g) · kök gerektiren iş (yeteneksiz kurulumun HAK'ı) KÖK KUYRUĞUNDA bekler (202) — §2.4 önceden uyarı · §2.6-2 · K4`,
    uyari30 && plan.veri.imzaci === "KUYRUK" && plan.veri.neden === "YETENEK_YOK" && kuyruk.status === 202 && kuyrukta,
    `uyarı30=${uyari30} plan=${JSON.stringify(plan.veri)} kuyruk=${ozet(kuyruk)} talep=${String(kuyruk.veri.talepId)} listede=${kuyrukta}`,
  );
  const s = await p.istek("POST", `/haklar/${k.hakId}/surum`, { imzaci: "ARA", imzaParolasi: ara.parola, sebep: "Senaryo L36 pencere içinde ara imzalı değişiklik", bakimBitis: new Date(b.saticiSimdi() + 400 * DAY_MS).toISOString() });
  await kiraSurer(a, f, "pencere içinde: ara imzacı HAK imzalamaya devam eder (yetenekli K), K yoklar → yeni kira + yeni HAK, NORMAL", s.status === 201 && s.veri.imzalayanKid === ara.kid, ozet(s));
  for (const esik of [15, 7, 1]) {
    await b.dunyayiIlerlet((kalan() - (esik - 0.5)) * DAY_MS);
    const u = await anahtarUyarisi(b, ara.kid, esik);
    await kiraSurer(a, f, `bitişe ${kalan().toFixed(1)} g: ANAHTAR_SURESI_BITIYOR (${esik} g) tekrarı; kira (ALT) sürer, K NORMAL — §2.4 · K4`, u, `uyarı${esik}=${u}`);
  }
  await b.dunyayiIlerlet((kalan() + 1.5) * DAY_MS);
  const once = (await f.istemci.detay()).hak?.surum;
  const plan2 = await p.istek("GET", `/haklar/${k.hakId}/imza-plani`);
  const s2 = await p.istek("POST", `/haklar/${k.hakId}/surum`, { imzaci: "KUYRUK", sebep: "Senaryo L36 tören atlandı" });
  await kiraSurer(
    a,
    f,
    "tören atlandı (ara imzacı süresi doldu): HAK değişikliği kuyrukta (ARA_IMZACI_YOK, 202), fabrika P'ye dek etkilenmez — yeni kira gelir, HAK aynı, NORMAL — §2.4 'tören atlanırsa'",
    plan2.veri.imzaci === "KUYRUK" && plan2.veri.neden === "ARA_IMZACI_YOK" && s2.status === 202,
    `plan=${JSON.stringify(plan2.veri)} ${ozet(s2)} hak.surum önce=${once}`,
    once,
  );
}

/** K yoklar: başarılı + yeni kira + NORMAL (+ istenirse HAK sürümü değişmedi). */
async function kiraSurer(a: AdimYuzu, f: RolFabrika, ad: string, ek: boolean, kanit: string, hakSurumu?: number): Promise<void> {
  const once = (await f.istemci.detay()).kira?.kiraId;
  const y = await f.istemci.yokla();
  const d = (await f.istemci.bekle((x) => x.kira?.kiraId !== once, 15_000)).detay;
  a.kontrol(ad, ek && d.kira?.kiraId !== once && tamam(d) && (hakSurumu === undefined || d.hak?.surum === hakSurumu), `${kanit} · yoklama=${y.outcome} ${y.code ?? ""} yeniKira=${d.kira?.kiraId !== once} ${kademe(d)} hak.surum=${d.hak?.surum}`);
}
