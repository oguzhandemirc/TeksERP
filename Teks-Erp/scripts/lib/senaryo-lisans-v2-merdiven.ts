// SENARYO L — L31…L34: lisans v2 süre çapası P ve iz merdiveni (tasarım `docs/design/LISANS-V2-CEVRIMDISI-KIRA.md`
// §1.1–§1.4 · §3.1–§3.2 · §6 K1/K7; kural `docs/kurallar/lisans.md`). Her senaryo kendi rolünü (kendi müşteri/kurulum +
// kendi `_test` DB'si) alır ve saat YALNIZ o fabrikada kayar (duvar + monotonik birlikte = gerçek geçen süre): satıcı ve
// ana fabrika C etkilenmez. İz silmeleri fabrika DURURKEN yapılır — depo açılışta okunur, DB izi ise saatlik GERÇEK
// zamanlayıcıyla (≤ 1 sa, lisans.md:66) okunur ve IPC saati onu tetiklemez; tasarımın senaryosu da açılıştır (§1.6).
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import { DAY_MS, b64uEncode, msToIso } from "../../src/lib/license/protocol";
import { LICENSE_FILES } from "../../src/lib/license/store";
import type { FabrikaIstemcisi, LisansDetayi, PortalIstemcisi, Yanit } from "./senaryo-lisans-istemci";
import type { Aktarici } from "./senaryo-lisans-surec";
import { etkinlestirZayifOnayli, nedenOzeti } from "./senaryo-lisans-v2-duzenek";

type Kontrol = (ad: string, ok: boolean, ayrinti?: string) => boolean;
export interface AdimYuzu {
  kontrol: Kontrol;
  not(metin: string): void;
  kismi(neden: string): void;
}

export interface RolFabrika {
  readonly ad: string;
  readonly istemci: FabrikaIstemcisi;
  readonly aktarici: Aktarici;
  readonly databaseUrl: string;
  readonly lisansDizini: string;
  ekDuvarMs: number;
  ekMonoMs: number;
}

/** Koşucunun `main()` kapanışları (W1 düzenek notu madde 1). */
export interface MerdivenBaglami<F extends RolFabrika> {
  readonly portal: PortalIstemcisi;
  readonly kokParolasi: string;
  readonly kanal: string;
  readonly hakModulleri: readonly string[];
  readonly saticiSimdi: () => number;
  readonly yeniFabrika: (ad: string, databaseUrl: string, parmakIzi: { makine: string; seri: string }) => Promise<F>;
  readonly rolDb: (rol: string) => Promise<string>;
  readonly baslat: (f: F) => Promise<void>;
  readonly durdur: (f: F) => Promise<void>;
  readonly saatUygula: (f: F) => Promise<void>;
  readonly db: (url: string) => Pool;
  readonly detayKurulum: (dbId: string) => Promise<Record<string, unknown>>;
  /** Satıcı DB'si (`_test`): portalın göstermediği son bildirilen durum kaydı sırası buradan okunur. */
  readonly saticiDbUrl: string;
}

const PARMAK_IZLERI = {
  F: { makine: "5E0A0001-0000-4000-8000-0000000000F1", seri: "SENARYOF01" },
  G: { makine: "5E0A0001-0000-4000-8000-0000000000F2", seri: "SENARYOG01" },
  H: { makine: "5E0A0001-0000-4000-8000-0000000000F3", seri: "SENARYOH01" },
  J: { makine: "5E0A0001-0000-4000-8000-0000000000F4", seri: "SENARYOJ01" },
} as const;
type Rol = keyof typeof PARMAK_IZLERI;

/** Bu adımların açtığı kurulumlar (rol → portal DB kimliği); L34'ün yabancı dosyası bunlardan birinden üretilir. */
const kurulumlar = new Map<Rol, string>();

const SAAT_MS = 60 * 60 * 1000;
const ozet = (y: Yanit): string => `${y.status}${y.kod ? ` ${y.kod}` : ""}`;
const kademe = (d: LisansDetayi): string => `${d.durum.hesaplananKademe}/${d.durum.uygulananKademe}`;
const bulgular = (d: LisansDetayi): string[] => d.durum.nedenler.map((n) => n.kod);
const guvenilirMs = (d: LisansDetayi): number => Date.parse(d.durum.saat.guvenilir);
const pMs = (d: LisansDetayi): number => Date.parse(d.durum.odenmisTarih?.tarih ?? "");
const gunArasi = (v: number | null, alt: number, ust: number): boolean => v !== null && v >= alt && v <= ust;
const durumOzeti = (d: LisansDetayi): string =>
  `${kademe(d)} ${d.durum.gecerlilik} kip=${d.durum.kip} ekSure=${d.durum.ekSureKalanGun} bant=${d.durum.uygulanan.bant?.ton ?? "yok"} [${nedenOzeti(d)}]`;

/** Yalnız bu fabrikanın saati ilerler (duvar + monotonik: gerçek geçen süre). */
export async function ilerlet<F extends RolFabrika>(b: MerdivenBaglami<F>, f: F, ms: number): Promise<void> {
  f.ekDuvarMs += ms;
  f.ekMonoMs += ms;
  await b.saatUygula(f);
}

type Iz = "kira" | "durum" | "db";
/** Fabrika dururken izleri siler ve yeniden açar (tespit açılıştadır). */
async function izleriSil<F extends RolFabrika>(b: MerdivenBaglami<F>, f: F, izler: readonly Iz[]): Promise<void> {
  await b.durdur(f);
  if (izler.includes("kira")) fs.rmSync(path.join(f.lisansDizini, LICENSE_FILES.LEASE), { force: true });
  if (izler.includes("durum")) fs.rmSync(path.join(f.lisansDizini, LICENSE_FILES.STATE), { force: true });
  if (izler.includes("db")) await b.db(f.databaseUrl).query(`DELETE FROM system_settings WHERE key = 'license.trace'`);
  await b.baslat(f);
}

/** Satıcının bu kurulum için son gördüğü durum kaydı sırası; `ms` boyunca ≥ 1 olmasını bekler. */
async function saticiSirasi<F extends RolFabrika>(b: MerdivenBaglami<F>, dbId: string, ms: number): Promise<number | null> {
  const t0 = Date.now();
  for (;;) {
    const r = await b.db(b.saticiDbUrl).query<{ s: number | null }>(`SELECT "sonDurumSirasi" AS s FROM kurulum WHERE id = $1`, [dbId]);
    const s = r.rows[0]?.s ?? null;
    if ((s ?? 0) >= 1 || Date.now() - t0 >= ms) return s;
    await new Promise((res) => setTimeout(res, 250));
  }
}

async function dbIziVar<F extends RolFabrika>(b: MerdivenBaglami<F>, f: F, ms = 0): Promise<boolean> {
  const t0 = Date.now();
  for (;;) {
    const r = await b.db(f.databaseUrl).query(`SELECT 1 FROM system_settings WHERE key = 'license.trace'`);
    if ((r.rowCount ?? 0) > 0) return true;
    if (Date.now() - t0 >= ms) return false;
    await new Promise((res) => setTimeout(res, 250));
  }
}

/** Portaldaki AÇIK yerel müdahale uyarısının nedenleri ve sıra ölçümü (§3.1-5). */
async function yerelMudahale<F extends RolFabrika>(b: MerdivenBaglami<F>, dbId: string): Promise<{ nedenler: string[]; sira: string }> {
  const uyarilar = (await b.detayKurulum(dbId)).kopyaUyarilari as Array<{ tur: string; durum: string; ayrinti?: { nedenler?: string[]; sonSira?: number | null; oncekiSira?: number | null } }>;
  const u = uyarilar.find((x) => x.tur === "YEREL_MUDAHALE" && x.durum === "ACIK");
  return { nedenler: u?.ayrinti?.nedenler ?? [], sira: `${String(u?.ayrinti?.oncekiSira)}→${String(u?.ayrinti?.sonSira)}` };
}

/** Rolün kendi müşteri → tesis → kurulum → HAK → kodu + fabrikası; etkinleşir (Mac = zayıf tanıma onayı, K8). */
export async function kur<F extends RolFabrika>(
  b: MerdivenBaglami<F>,
  a: AdimYuzu,
  rol: string,
  o: { bakimGun?: number; kipAltSiniriZorla?: boolean; zorla?: boolean; parmakIzi?: { makine: string; seri: string } } = {},
): Promise<{ f: F; dbId: string; hakId: string } | null> {
  const p = b.portal;
  const m = await p.istek("POST", "/musteriler", { ad: `Senaryo L Tekstil ${rol} ${randomBytes(3).toString("hex")}` });
  const t = await p.istek("POST", "/tesisler", { musteriId: String(m.veri.id), ad: `Tesis ${rol}` });
  const k = await p.istek("POST", "/kurulumlar", { tesisId: String(t.veri.id), sinif: "URETIM", kanalKodu: b.kanal, yoklamaAraligiDk: 5 });
  const dbId = String(k.veri.id);
  const h = await p.istek("POST", `/kurulumlar/${dbId}/hak`, { moduller: [...b.hakModulleri], kalici: false, bakimBitis: msToIso(b.saticiSimdi() + (o.bakimGun ?? 365) * DAY_MS) });
  const s = await p.istek("POST", `/haklar/${String(h.veri.id)}/surum`, { kokParolasi: b.kokParolasi, sebep: `Senaryo ${rol} ilk imza`, ...(o.kipAltSiniriZorla ? { kipAltSiniriZorla: true } : {}) });
  const kod = await p.istek("POST", `/kurulumlar/${dbId}/etkinlestirme-kodu`, {});
  const zincir = [m, t, k, h, s, kod];
  const portalOk = zincir.every((y) => y.status === 201);
  a.kontrol(`${rol}: portal müşteri → tesis → kurulum → hak sürüm 1${o.kipAltSiniriZorla ? " (kip alt sınırı zorla)" : ""} → kod`, portalOk, zincir.map(ozet).join(" "));
  if (!portalOk) return null;
  const parmakIzi = o.parmakIzi ?? (rol in PARMAK_IZLERI ? PARMAK_IZLERI[rol as Rol] : null);
  if (!parmakIzi) throw new Error(`rol ${rol}: parmak izi verilmedi`);
  const f = await b.yeniFabrika(rol, await b.rolDb(rol), parmakIzi);
  await b.baslat(f);
  await f.istemci.sozlesmeyiKabulEt();
  const e = await etkinlestirZayifOnayli({ fabrika: f.istemci, portal: p, kurulumDbId: dbId, kod: String(kod.veri.kod), kontrol: (x, ok, ay) => a.kontrol(x, ok, ay), etiket: rol });
  a.kontrol(`${rol}: etkinleşti → 200`, e.status === 200, ozet(e));
  if (e.status !== 200) return null;
  if (rol in PARMAK_IZLERI) kurulumlar.set(rol as Rol, dbId);
  if (o.zorla) {
    const z = await p.istek("POST", `/kurulumlar/${dbId}/zorlama`, { zorla: true, sebep: `Senaryo ${rol} zorlama` });
    await f.istemci.yokla();
    const w = await f.istemci.bekle((d) => d.durum.kip === "zorla", 20_000);
    a.kontrol(`${rol}: portal zorlama → kip zorla (uygulanan = hesaplanan)`, z.status === 200 && w.ms !== null, `${ozet(z)} ${w.detay.durum.kip}`);
  }
  return { f, dbId, hakId: String(h.veri.id) };
}

// ============================================================ L31
export async function l31Internetsiz400<F extends RolFabrika>(b: MerdivenBaglami<F>, a: AdimYuzu): Promise<void> {
  // Bakım bitişi ufkun ötesinde: ölçülen tek eksen P olsun.
  const k = await kur(b, a, "F", { bakimGun: 900, zorla: true });
  if (!k) return;
  const { f } = k;
  const d0 = await f.istemci.detay();
  const p = pMs(d0);
  a.kontrol(
    "P = kira verilişi + HAK ufku 400 g (kaynak UFUK, sözleşme sonu yok) — §1.1 formül · lisans.md:12",
    d0.durum.odenmisTarih?.kaynak === "UFUK" && d0.durum.odenmisTarih.sozlesmeSonu === false && Math.abs(p - guvenilirMs(d0) - 400 * DAY_MS) < 2 * DAY_MS,
    `${JSON.stringify(d0.durum.odenmisTarih)} T=${d0.durum.saat.guvenilir}`,
  );
  a.kontrol("başlangıç: GECERLI, NORMAL, bant yok — §1.3 satır 1", d0.durum.gecerlilik === "GECERLI" && kademe(d0) === "NORMAL/NORMAL" && d0.durum.uygulanan.bant === null, durumOzeti(d0));
  f.aktarici.kipAyarla("kesik");
  // Kira bitişinin ötesine (v1'de burada ek süre başlardı): §1.3 "kira bitişi geçmiş olabilir; bu bir bulgu değildir".
  const kiraBitis = d0.kira ? Date.parse(d0.kira.bitis) : guvenilirMs(d0);
  await ilerlet(b, f, Math.max(100 * DAY_MS, kiraBitis - guvenilirMs(d0) + 2 * DAY_MS));
  const y1 = await f.istemci.yokla();
  const d1 = await f.istemci.detay();
  a.kontrol(
    "internetsiz, kira bitişi geçti: yoklama BASARISIZ, internet YOK, yine GECERLI + NORMAL, bant/bulgu yok — §1.2 · §1.3 satır 1 · Z2",
    y1.outcome === "BASARISIZ" && !d1.durum.baglanti.internetVar && guvenilirMs(d1) > kiraBitis && d1.durum.gecerlilik === "GECERLI" && kademe(d1) === "NORMAL/NORMAL" && d1.durum.uygulanan.bant === null,
    `${y1.outcome} ${y1.code ?? ""} internet=${String(d1.durum.baglanti.internetVar)} T=${d1.durum.saat.guvenilir} kira.bitis=${d1.kira?.bitis} ${durumOzeti(d1)}`,
  );
  await ilerlet(b, f, p - 31 * DAY_MS - guvenilirMs(d1));
  const d2 = await f.istemci.detay();
  a.kontrol("P − 31 g: NORMAL, bilgi bandı YOK (K1 penceresi P − 30) — §1.3 satır 1 · K1", kademe(d2) === "NORMAL/NORMAL" && d2.durum.uygulanan.bant === null && !bulgular(d2).includes("ODEME_YAKLASIYOR"), `T=${d2.durum.saat.guvenilir} ${durumOzeti(d2)}`);
  await ilerlet(b, f, 2 * DAY_MS);
  const d3 = await f.istemci.detay();
  const bant = d3.durum.uygulanan.bant;
  a.kontrol(
    "P − 29 g, internetsiz (son alışveriş > 7 g): NORMAL + BİLGİ bandı ODEME_YAKLASIYOR (\"QR/dosya ile yenileyin\"), uyarı kademesi değil — §1.3 satır 2 · K1 · lisans.md:31",
    kademe(d3) === "NORMAL/NORMAL" && bulgular(d3).includes("ODEME_YAKLASIYOR") && bant?.ton === "bilgi" && /QR/.test(bant.metin),
    `${durumOzeti(d3)} metin="${bant?.metin ?? ""}"`,
  );
  await ilerlet(b, f, p + 2 * DAY_MS - guvenilirMs(d3));
  const d4 = await f.istemci.detay();
  a.kontrol("P + 2 g: EK_SURE, geri sayım 27–29 g, uyarı bandı — §1.3 satır 3 · Z2 · lisans.md:10", kademe(d4) === "EK_SURE/EK_SURE" && gunArasi(d4.durum.ekSureKalanGun, 27, 29) && d4.durum.uygulanan.bant?.ton === "uyari", durumOzeti(d4));
  await ilerlet(b, f, 29 * DAY_MS);
  const y5 = await f.istemci.yokla();
  const d5 = await f.istemci.detay();
  a.kontrol("P + 31 g, internet YOK (iki anahtar): KISITLI + tehlike bandı — §1.3 satır 4 · Z2 · K3", y5.outcome === "BASARISIZ" && kademe(d5) === "KISITLI/KISITLI" && d5.durum.uygulanan.bant?.ton === "tehlike", `${y5.outcome} ${durumOzeti(d5)}`);
  const yaz = await f.istemci.istek("POST", "/api/orders", {});
  a.kontrol("KISITLI (zorla): POST /api/orders → 403 LICENSE_RESTRICTED — lisans.md:56", yaz.status === 403 && yaz.kod === "LICENSE_RESTRICTED", `${ozet(yaz)} ${JSON.stringify(yaz.details)}`);
  await veriErisimiAcik(f, a);
  await b.durdur(f);
}

/** KISITLI'da okuma, dışa aktarma ve yedek açık (§1.3 satır 4 · lisans.md:10 · :56). */
export async function veriErisimiAcik(f: RolFabrika, a: AdimYuzu): Promise<void> {
  const oku = await f.istemci.istek("GET", "/api/orders");
  const varliklar = await f.istemci.istek("GET", "/api/import/entities");
  const liste = Array.isArray(varliklar.json.data) ? (varliklar.json.data as Array<{ entity: string; canRead: boolean }>) : [];
  const varlik = (liste.find((v) => v.entity === "colors") ?? liste.find((v) => v.canRead))?.entity ?? "colors";
  const disa = await f.istemci.istek("GET", `/api/import/${varlik}/export`);
  const al = await f.istemci.istek("POST", "/api/admin/backup");
  let dosya: string | null = null;
  for (let i = 0; i < 120 && !dosya && al.status === 202; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const l = await f.istemci.istek("GET", "/api/admin/backups");
    dosya = ((l.json.files ?? []) as Array<{ name: string }>)[0]?.name ?? null;
  }
  a.kontrol(
    "KISITLI: okuma (GET 200) · dışa aktarma (200) · yedek (202 + dosya) açık — §1.3 satır 4 · lisans.md:56",
    oku.status === 200 && disa.status === 200 && al.status === 202 && dosya !== null,
    `GET ${ozet(oku)} · export/${varlik} ${ozet(disa)} · yedek ${ozet(al)} ${dosya ?? "dosya yok"}`,
  );
}

// ============================================================ L32
export async function l32UcIzSilme<F extends RolFabrika>(b: MerdivenBaglami<F>, a: AdimYuzu): Promise<void> {
  // HAK'ta kip alt sınırı zorla: izler gidince kip HAK'tan gelir (§3.1-4 kip sırası) — KISITLI uygulanabilir ölçülür.
  const k = await kur(b, a, "G", { kipAltSiniriZorla: true });
  if (!k) return;
  const { f, dbId } = k;
  await f.istemci.yokla();
  // Sıfırlanma ancak satıcı bir sıra (≥ 1) görmüşse ayırt edilir; ilk yoklama kabul ÖNCESİ sırayı (0) taşır, zil ikinci
  // yoklamayı yapmayabilir: fabrika sırası ≥ 1 olunca bir yoklama daha, satıcının gördüğü sıra DB'den ölçülür.
  await f.istemci.bekle((d) => (d.depo.durumKaydi.sira ?? 0) >= 1, 10_000);
  await f.istemci.yokla();
  const saticiSira = await saticiSirasi(b, dbId, 5_000);
  const d0 = await f.istemci.detay();
  const dosyaVar = (ad: string): boolean => fs.existsSync(path.join(f.lisansDizini, ad));
  a.kontrol(
    "başlangıç: kip zorla (HAK alt sınırı), NORMAL; üç iz yerinde (kira · durum kaydı · DB izi); satıcı sıra ≥ 1 gördü — §3.1-4 · §3.1-5 · lisans.md:66",
    d0.durum.kip === "zorla" && kademe(d0) === "NORMAL/NORMAL" && dosyaVar(LICENSE_FILES.LEASE) && dosyaVar(LICENSE_FILES.STATE) && (await dbIziVar(b, f)) && (saticiSira ?? 0) >= 1,
    `${durumOzeti(d0)} sira=${d0.depo.durumKaydi.sira} satıcıSıra=${saticiSira}`,
  );
  f.aktarici.kipAyarla("kesik");
  await izleriSil(b, f, ["kira", "durum", "db"]);
  const d1 = (await f.istemci.bekle((d) => d.depo.durumKaydi.sira !== null, 10_000)).detay;
  a.kontrol("üç iz birden yok → HEMEN EK_SURE (14 g UYARI atlanır) — K7 · §3.1-4 · Z8 · lisans.md:10", kademe(d1) === "EK_SURE/EK_SURE", durumOzeti(d1));
  a.kontrol("ek süre çapası tespit anı: kalan 29–30 g — §3.1-4", gunArasi(d1.durum.ekSureKalanGun, 29, 30), String(d1.durum.ekSureKalanGun));
  a.kontrol(
    "LISANS_IZI_KAYIP + KİRASIZ kayıt (kira yok, durum kaydı sırası 0); kip zorla (HAK alt sınırı) — lisans.md:67 · §3.1-4 kip sırası",
    bulgular(d1).includes("LISANS_IZI_KAYIP") && d1.kira === null && d1.depo.durumKaydi.sira === 0 && d1.durum.kip === "zorla",
    `kira=${d1.kira?.kiraId ?? "yok"} sira=${d1.depo.durumKaydi.sira} kip=${d1.durum.kip}`,
  );
  const iz = await dbIziVar(b, f, 5_000);
  const w = await f.istemci.istek("GET", "/api/work-orders");
  a.kontrol("çapa DB izine yeniden yazıldı; üretim açık (GET /api/work-orders 200) — §3.1-4 · Z8 tavanı", iz && w.status === 200, `iz=${String(iz)} ${ozet(w)}`);
  // Sonraki yoklama satıcıya ulaşır ama yanıtı yolda kalır: portal tarafı ölçülür, fabrika K7 hâlinde kalır.
  f.aktarici.kipAyarla("yut");
  const y = await f.istemci.yokla();
  f.aktarici.kipAyarla("kesik");
  const kayit = f.aktarici.sonKayit("/v1/yokla");
  const ym = await yerelMudahale(b, dbId);
  a.kontrol("sonraki yoklama satıcıya ulaştı (yanıt yutuldu → fabrika kira almadı)", kayit?.yutuldu === true && y.outcome === "BASARISIZ", `${y.outcome} satıcı=${String(kayit?.durum)}`);
  a.kontrol(
    "portal: YEREL_MUDAHALE — sıra sıfırlandı (SIRA_SIFIRLANDI) + LISANS_IZI_KAYIP — §3.1-5 · §6 K7 notu",
    ym.nedenler.includes("SIRA_SIFIRLANDI") && ym.nedenler.includes("LISANS_IZI_KAYIP"),
    `nedenler=${ym.nedenler.join(",") || "yok"} sıra ${ym.sira}`,
  );
  const bl = await b.portal.istek("GET", "/bildirimler?olay=YEREL_MUDAHALE_SUPHESI&limit=200");
  const bildirim = ((bl.veri.items ?? []) as Array<{ kurulumId: string | null }>).filter((x) => x.kurulumId === dbId).length;
  a.kontrol("bildirim YEREL_MUDAHALE_SUPHESI (bu kurulum) — §3.1-5", bl.status === 200 && bildirim > 0, `${ozet(bl)} ${bildirim} satır`);
  await ilerlet(b, f, 5 * DAY_MS);
  await b.durdur(f);
  await b.baslat(f);
  const d2 = await f.istemci.detay();
  a.kontrol("+5 g + yeniden başlatma: ek süre TAZELENMEZ (kalan 24–25 g) — lisans.md:67", kademe(d2) === "EK_SURE/EK_SURE" && gunArasi(d2.durum.ekSureKalanGun, 24, 25), durumOzeti(d2));
  await izleriSil(b, f, ["kira", "durum", "db"]);
  const d3 = (await f.istemci.bekle((d) => d.depo.durumKaydi.sira !== null, 10_000)).detay;
  a.kontrol("silme tekrarlandı: ek süre YENİDEN başlar (kalan 29–30 g; bağlanınca görünür) — §1.6 · §6 K7 notu", kademe(d3) === "EK_SURE/EK_SURE" && gunArasi(d3.durum.ekSureKalanGun, 29, 30), durumOzeti(d3));
  await ilerlet(b, f, 31 * DAY_MS);
  const d4 = await f.istemci.detay();
  const s = await f.istemci.istek("POST", "/api/orders", {});
  const r = await f.istemci.istek("GET", "/api/orders");
  a.kontrol(
    "+31 g internetsiz → KISITLI (kip HAK'tan zorla): POST 403 LICENSE_RESTRICTED · GET 200 — Z8 · lisans.md:56",
    kademe(d4) === "KISITLI/KISITLI" && s.status === 403 && s.kod === "LICENSE_RESTRICTED" && r.status === 200,
    `${durumOzeti(d4)} POST ${ozet(s)} GET ${ozet(r)}`,
  );
  await b.durdur(f);
}

// ============================================================ L33
export async function l33TekIzSilme<F extends RolFabrika>(b: MerdivenBaglami<F>, a: AdimYuzu): Promise<void> {
  const k = await kur(b, a, "H", { zorla: true });
  if (!k) return;
  const { f, dbId } = k;
  const kiraYolu = path.join(f.lisansDizini, LICENSE_FILES.LEASE);
  const d0 = await f.istemci.detay();
  const kiraYedegi = fs.readFileSync(kiraYolu);
  f.aktarici.kipAyarla("kesik");
  // Tek iz: kira (durum kaydı + DB izi duruyor) — §3.2 Z4 "bozuk (DB izi var)".
  await izleriSil(b, f, ["kira"]);
  const d1 = await f.istemci.detay();
  a.kontrol(
    "yalnız kira silindi: LISANS_IZI_KAYIP (ÖLÇÜLEMEDİ bulgusu) → UYARI, EK_SURE değil — §3.1-3 · Z4 · lisans.md:67",
    bulgular(d1).includes("LISANS_IZI_KAYIP") && kademe(d1) === "UYARI/UYARI",
    durumOzeti(d1),
  );
  // Görünümün P alanı belgeden (kira + HAK) hesaplanır, kira yokken boştur; çapa ayakta kalan izden okunur.
  a.kontrol(
    "süre çapası ayakta kalan izlerden: izler aynı çapayı taşır (LISANS_IZI_CELISKI yok), süre kısalmadı (ek süre yok) — lisans.md:68",
    !bulgular(d1).includes("LISANS_IZI_CELISKI") && d1.durum.ekSureKalanGun === null && d1.durum.hesaplananKademe !== "EK_SURE",
    `P(görünüm) ${d0.durum.odenmisTarih?.tarih} → ${d1.durum.odenmisTarih?.tarih ?? "yok (kira yok)"} · genel geçerlilik ${d1.durum.gecerlilik}`,
  );
  await b.durdur(f);
  fs.writeFileSync(kiraYolu, kiraYedegi);
  await b.baslat(f);
  const d2 = await f.istemci.detay();
  a.kontrol("kira dosyası geri kondu: LISANS_IZI_KAYIP SÜRER (yeni kiraya dek kalıcı) — lisans.md:67", bulgular(d2).includes("LISANS_IZI_KAYIP") && kademe(d2) === "UYARI/UYARI", durumOzeti(d2));
  f.aktarici.kipAyarla("acik");
  const y = await f.istemci.yokla();
  const d3 = await f.istemci.detay();
  a.kontrol(
    "başarılı yoklama → yeni kira: iz onarıldı, birikim sıfır, GECERLI + NORMAL — §3.1-3 · lisans.md:65 · :67",
    y.outcome === "BASARILI" && d3.kira?.kiraId !== d0.kira?.kiraId && !bulgular(d3).includes("LISANS_IZI_KAYIP") && d3.durum.gecerlilik === "GECERLI" && kademe(d3) === "NORMAL/NORMAL",
    `${y.outcome} ${durumOzeti(d3)}`,
  );
  const ym = await yerelMudahale(b, dbId);
  a.kontrol("portal: YEREL_MUDAHALE nedeni LISANS_IZI_KAYIP (tek iz kaybı da) — §3.1-5", ym.nedenler.includes("LISANS_IZI_KAYIP"), `nedenler=${ym.nedenler.join(",") || "yok"}`);
  // Merdiven: aynı tek iz kaybı internetsiz sürer (birikim çalışma süresiyle).
  f.aktarici.kipAyarla("kesik");
  await izleriSil(b, f, ["kira"]);
  await ilerlet(b, f, 13 * DAY_MS);
  const d4 = await f.istemci.detay();
  a.kontrol("+13 g (birikim < 14 g): UYARI sürer — §3.1-3 · Z4", kademe(d4) === "UYARI/UYARI" && bulgular(d4).includes("LISANS_IZI_KAYIP"), durumOzeti(d4));
  await ilerlet(b, f, DAY_MS + SAAT_MS);
  const d5 = await f.istemci.detay();
  a.kontrol(
    "+14 g 1 sa: BELIRSIZLIK_SURUYOR → EK_SURE (kalan 29–30 g) — §3.1-3 · Z4 · lisans.md:65",
    kademe(d5) === "EK_SURE/EK_SURE" && bulgular(d5).includes("BELIRSIZLIK_SURUYOR") && gunArasi(d5.durum.ekSureKalanGun, 29, 30),
    durumOzeti(d5),
  );
  await ilerlet(b, f, 30 * DAY_MS);
  const d6 = await f.istemci.detay();
  const s = await f.istemci.istek("POST", "/api/orders", {});
  a.kontrol(
    "+44 g 1 sa, internet YOK: KISITLI, POST 403 LICENSE_RESTRICTED — Z4 · K3 · lisans.md:56",
    kademe(d6) === "KISITLI/KISITLI" && s.status === 403 && s.kod === "LICENSE_RESTRICTED",
    `${durumOzeti(d6)} POST ${ozet(s)}`,
  );
  await b.durdur(f);
}

// ============================================================ L34
export async function l34UzatmaDosyasi<F extends RolFabrika>(b: MerdivenBaglami<F>, a: AdimYuzu): Promise<void> {
  const k = await kur(b, a, "J", { zorla: true });
  if (!k) return;
  const { f, dbId } = k;
  const p = b.portal;
  const yukle = (yanit: unknown): Promise<Yanit> => f.istemci.istek("POST", "/api/license/cevrimdisi-yanit", { yanit, kaynak: "dosya" });
  const dosyaUret = async (): Promise<{ y: Yanit; dosya: Record<string, unknown> | undefined }> => {
    const y = await p.istek("POST", `/kurulumlar/${dbId}/uzatma-dosyasi`, {});
    return { y, dosya: y.veri.dosya as Record<string, unknown> | undefined };
  };
  const g0 = await p.istek("POST", `/kurulumlar/${dbId}/gecerlilik`, { tarih: msToIso(b.saticiSimdi() + 10 * DAY_MS), sebep: "Senaryo L34 sözleşme sonu" });
  const y0 = await f.istemci.yokla();
  const d0 = await f.istemci.detay();
  a.kontrol(
    "sözleşme sonu +10 g → kira P'yi taşır: NORMAL + bilgi bandı — §1.1 · §1.3 satır 2 · K1",
    g0.status < 300 && y0.outcome === "BASARILI" && d0.durum.odenmisTarih?.sozlesmeSonu === true && Math.abs(pMs(d0) - b.saticiSimdi() - 10 * DAY_MS) < DAY_MS && kademe(d0) === "NORMAL/NORMAL" && d0.durum.uygulanan.bant?.ton === "bilgi",
    `${ozet(g0)} ${y0.outcome} P=${d0.durum.odenmisTarih?.tarih} ${durumOzeti(d0)}`,
  );
  f.aktarici.kipAyarla("kesik");
  // (1) Aynı gün: dosya üretildiği gün yüklenir (taşıma gecikmesi yok).
  const g1 = await p.istek("POST", `/kurulumlar/${dbId}/gecerlilik`, { tarih: msToIso(b.saticiSimdi() + 20 * DAY_MS), sebep: "Senaryo L34 ödeme (+10 g)" });
  const u0 = await dosyaUret();
  const r0 = await yukle(u0.dosya);
  const dA = await f.istemci.detay();
  a.kontrol(
    "aynı gün uzatma dosyası (internet kesik): portal üretir → \"Lisans dosyası yükle\" 200 → kira = dosyanın kirası, P ileri (+20 g), GECERLI + NORMAL — §1.4-3",
    g1.status < 300 && u0.y.status < 300 && r0.status === 200 && dA.kira?.kiraId === u0.y.veri.kiraId && Math.abs(pMs(dA) - b.saticiSimdi() - 20 * DAY_MS) < DAY_MS && dA.durum.gecerlilik === "GECERLI" && kademe(dA) === "NORMAL/NORMAL",
    `${ozet(u0.y)} ${String(u0.y.veri.dosyaAdi)} → ${ozet(r0)} P=${dA.durum.odenmisTarih?.tarih} ${durumOzeti(dA)}`,
  );
  // (2) P geçer (internetsiz), ödeme sonra gelir; dosyalar fabrikanın saatine göre 22 gün önce üretilmiş (taşındı).
  await ilerlet(b, f, 22 * DAY_MS);
  const d1 = await f.istemci.detay();
  a.kontrol("internet kesik, +22 g (P + 2): EK_SURE — §1.3 satır 3", kademe(d1) === "EK_SURE/EK_SURE", durumOzeti(d1));
  const pYeni = b.saticiSimdi() + 365 * DAY_MS;
  const g2 = await p.istek("POST", `/kurulumlar/${dbId}/gecerlilik`, { tarih: msToIso(pYeni), sebep: "Senaryo L34 ödeme alındı" });
  const u1 = await dosyaUret();
  const u2 = await dosyaUret();
  a.kontrol(
    "portal: istek gerektirmeyen uzatma dosyası (imzalı yanıt; iki üretim, ikincisi daha yeni), P = yeni ödenmiş tarih — §1.4-3",
    g2.status < 300 && u1.y.status < 300 && u2.y.status < 300 && typeof u2.dosya?.kira === "string" && u1.y.veri.kiraId !== u2.y.veri.kiraId && Math.abs(Date.parse(String(u2.y.veri.odenmisTarih)) - pYeni) < DAY_MS,
    `${ozet(g2)} ${ozet(u1.y)} ${ozet(u2.y)} P=${String(u2.y.veri.odenmisTarih)}`,
  );
  if (!u1.dosya || !u2.dosya) return;
  const [h, pl, imza] = String(u2.dosya.kira).split(".");
  const yuk = JSON.parse(Buffer.from(pl ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  const kurcali = { ...u2.dosya, kira: `${h}.${b64uEncode(JSON.stringify({ ...yuk, odenmisTarih: msToIso(pYeni + 365 * DAY_MS) }))}.${imza}` };
  const r1 = await yukle(kurcali);
  a.kontrol("kurcalı dosya (ödenmiş tarih +1 yıl, imza aynı) → 400 LICENSE_RESPONSE_INVALID — §1.4 · uç sözleşmesi (L23 emsali)", r1.status === 400 && r1.kod === "LICENSE_RESPONSE_INVALID", `${ozet(r1)} ${String(r1.details.protocolCode ?? "")}`);
  const baskasi = [...kurulumlar.entries()].find(([rol]) => rol !== "J")?.[1];
  if (baskasi) {
    const ub = await p.istek("POST", `/kurulumlar/${baskasi}/uzatma-dosyasi`, {});
    const r2 = await yukle(ub.veri.dosya);
    a.kontrol("yabancı dosya (başka kurulumun imzalı uzatma dosyası) → 400 LICENSE_RESPONSE_INVALID — §1.4", ub.status < 300 && r2.status === 400 && r2.kod === "LICENSE_RESPONSE_INVALID", `${ozet(ub)} → ${ozet(r2)} ${String(r2.details.protocolCode ?? "")}`);
  } else a.kismi("yabancı dosya ölçülemedi: başka kurulum yok (L31–L33 kurulamadı)");
  const dRet = await f.istemci.detay();
  a.kontrol("retler lisansa dokunmadı (kira aynı, EK_SURE)", dRet.kira?.kiraId === d1.kira?.kiraId && kademe(dRet) === "EK_SURE/EK_SURE", durumOzeti(dRet));
  const r3 = await yukle(u2.dosya);
  const d3 = await f.istemci.detay();
  a.kontrol(
    "taşınmış dosya yüklendi → 200, kira = dosyanın kirası, P ileri (+365 g, sözleşme sonu), EK_SURE kalktı — §1.4-3",
    r3.status === 200 && d3.kira?.kiraId === u2.y.veri.kiraId && Math.abs(pMs(d3) - pYeni) < DAY_MS && d3.durum.hesaplananKademe !== "EK_SURE",
    `${ozet(r3)} kira=${d3.kira?.kiraId.slice(0, 8)} P=${d3.durum.odenmisTarih?.tarih}`,
  );
  // Kabulde süreklilik: taşınan kira tahmini geri çekemez (tasarım §1.5 alt sınır, lisans.md güvenilir saat satırı).
  a.kontrol(
    "taşınmış dosya (fabrika saatine göre 22 g önce üretildi) sonrası SAAT_ILERI YOK, GECERLI + NORMAL, bant yok — §1.4 · §1.5 kabulde süreklilik · K1",
    !bulgular(d3).includes("SAAT_ILERI") && d3.durum.gecerlilik === "GECERLI" && kademe(d3) === "NORMAL/NORMAL" && d3.durum.uygulanan.bant === null,
    durumOzeti(d3),
  );
  const r4 = await yukle(u1.dosya);
  const r5 = await yukle(u0.dosya);
  a.kontrol("eski dosyalar (önce üretilen ikisi) → 409 LICENSE_LEASE_STALE — §1.4 · lisans.md:31", r4.status === 409 && r4.kod === "LICENSE_LEASE_STALE" && r5.status === 409 && r5.kod === "LICENSE_LEASE_STALE", `${ozet(r4)} · ${ozet(r5)}`);
  const satir = ((await b.detayKurulum(dbId)).kiralar as Array<{ id: string; karar: string }>).find((x) => x.id === u2.y.veri.kiraId);
  a.kontrol("portal: dosyanın kirası defterde karar DOSYA", satir?.karar === "DOSYA", String(satir?.karar));
  await b.durdur(f);
}
