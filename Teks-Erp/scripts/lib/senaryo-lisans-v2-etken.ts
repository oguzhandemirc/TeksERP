// SENARYO L — L38b · L39: güçlü etkenli makine (K8). Tasarım `docs/design/LISANS-V2-CEVRIMDISI-KIRA.md` §3.1-6 ("Karar" ·
// "Meşru değişiklik" · "Zayıf tanıma") · §6 K8; kural `docs/kurallar/lisans.md:128`; arşiv 2026-10-01 L2-11 (öğrenme · zayıf
// tanıma). Makine `SENARYO_ETKENLER` sahte toplayıcısıyla canlanır (`senaryo-lisans-ayar.ts` ④): f1..f4 Linux yollarından
// okunmuş gibi, f5 gerçek PostgreSQL kimliği. Güçlü etkenler f2 · f3 · f4 (`STRONG_FINGERPRINT_FACTORS`).
import fs from "node:fs";
import path from "node:path";
import { LICENSE_FILES } from "../../src/lib/license/store";
import type { LisansDetayi, Yanit } from "./senaryo-lisans-istemci";
import type { SahteMakine } from "./senaryo-lisans-surec";
import { nedenOzeti, zayifTanimaTalebi } from "./senaryo-lisans-v2-duzenek";
import { kur, portalZinciri, type AdimYuzu, type MerdivenBaglami, type RolFabrika } from "./senaryo-lisans-v2-merdiven";

type Etkenler = NonNullable<SahteMakine["etkenler"]>;
type Kume = Record<"f1" | "f2" | "f3" | "f4" | "f5", string | null>;
type Makineli = RolFabrika & { readonly parmakIzi: SahteMakine };
interface KiraYuku {
  kiraId?: string;
  parmakIzi?: Kume;
  parmakIziKurali?: string;
}

const ozet = (y: Yanit): string => `${y.status}${y.kod ? ` ${y.kod}` : ""}${typeof y.details.vendorCode === "string" ? `/${y.details.vendorCode}` : ""}`;
const tamam = (d: LisansDetayi): boolean => d.durum.gecerlilik === "GECERLI" && d.durum.uygulananKademe === "NORMAL" && d.parmakIzi.karar === "ESLESTI";
const durumu = (d: LisansDetayi): string =>
  `${d.durum.gecerlilik} ${d.durum.hesaplananKademe}/${d.durum.uygulananKademe} parmakIzi=${d.parmakIzi.karar}(${String(d.parmakIzi.eslesen)}/${String(d.parmakIzi.olculebilen)}) [${nedenOzeti(d)}]`;
const kisa = (x: string | null | undefined): string => (x ? x.slice(0, 6) : "∅");
const kumeOzeti = (k: Kume | undefined): string => (k ? (["f1", "f2", "f3", "f4", "f5"] as const).map((f) => `${f}=${kisa(k[f])}`).join(" ") : "yok");
const ayniMi = (a: Kume | undefined, b: Kume | undefined, alanlar: readonly (keyof Kume)[]): boolean => Boolean(a && b) && alanlar.every((f) => a![f] === b![f]);

/** Fabrikanın elindeki kiranın yükü (imza denetlenmez; kiranın taşıdığı küme ve kural okunur). */
function kiraYuku(f: RolFabrika): KiraYuku {
  try {
    const jws = fs.readFileSync(path.join(f.lisansDizini, LICENSE_FILES.LEASE), "utf8").trim();
    return JSON.parse(Buffer.from(jws.split(".")[1] ?? "", "base64url").toString("utf8")) as KiraYuku;
  } catch {
    return {};
  }
}

/** Portalın kabul edilen parmak izi (kurulum künyesi — tuzlu özet). */
async function kabulEdilen<F extends RolFabrika>(b: MerdivenBaglami<F>, dbId: string): Promise<Kume | undefined> {
  const k = (await b.detayKurulum(dbId)).kurulum as { kabulEdilenParmakIzi?: Kume | null } | undefined;
  return k?.kabulEdilenParmakIzi ?? undefined;
}

/** Kurulumun (her durumdaki) donanım/zayıf tanıma talepleri. */
async function talepler<F extends RolFabrika>(b: MerdivenBaglami<F>, dbId: string): Promise<Array<{ tur: string; durum: string }>> {
  const l = await b.portal.istek("GET", "/donanim-talepleri?limit=200");
  return ((l.veri.items ?? []) as Array<{ kurulumId: string; tur: string; durum: string }>).filter((t) => t.kurulumId === dbId);
}

/** Fabrika dururken etkenler değişir (donanım değişti), yeniden açılır. */
async function degistir<F extends Makineli>(b: MerdivenBaglami<F>, f: F, yeni: Etkenler): Promise<void> {
  await b.durdur(f);
  f.parmakIzi.etkenler = { ...f.parmakIzi.etkenler, ...yeni };
  await b.baslat(f);
}

const S_ETKEN: Etkenler = { f1: "5e0a00010000400080000000000053f1", f2: "5E0A0002-0000-4000-8000-0000000053F2", f3: "SENARYO-S-DISK-01", f4: "SENARYOS-SYS-01" };

// ============================================================ L38b
export async function l38bOgrenme<F extends Makineli>(b: MerdivenBaglami<F>, a: AdimYuzu): Promise<void> {
  const k = await kur(b, a, "S", { parmakIzi: { makine: "5E0A0001-0000-4000-8000-0000000000F5", seri: "SENARYOS01", etkenler: { ...S_ETKEN } } });
  if (!k) return;
  const f = k.f;
  const d0 = await f.istemci.detay();
  const t0 = await talepler(b, k.dbId);
  const kira0 = kiraYuku(f);
  a.kontrol(
    "güçlü ≥ 2 makine (f2 · f3 · f4 okunur) ONAYSIZ etkinleşti: zayıf tanıma talebi yok, kira `parmakIziKurali: standart`, ESLESTI — §3.1-6 'Zayıf tanıma' karşıtı · lisans.md:128",
    t0.length === 0 && kira0.parmakIziKurali === "standart" && tamam(d0) && d0.parmakIzi.olculebilen === 5,
    `talep=${t0.length} kural=${String(kira0.parmakIziKurali)} ${durumu(d0)}`,
  );

  // (a) çevrimiçi, bir güçlü etken (disk, f3) değişir: güçlü 2 tutar → satıcı portal onayı OLMADAN öğrenir.
  const kabul0 = await kabulEdilen(b, k.dbId);
  await degistir(b, f, { f3: "SENARYO-S-DISK-02" });
  await f.istemci.yokla();
  const w1 = await f.istemci.bekle((d) => d.kira?.kiraId !== kira0.kiraId && tamam(d), 20_000);
  const kabul1 = await kabulEdilen(b, k.dbId);
  const kira1 = kiraYuku(f);
  const t1 = await talepler(b, k.dbId);
  a.kontrol(
    "çevrimiçi, bir güçlü etken (f3) değişti, güçlü 2 tutuyor → satıcı yeni kümeyi KENDİLİĞİNDEN öğrendi (kabul edilen f3 değişti, f1 · f2 · f4 · f5 aynı), yeni kira yeni kümeyi taşır, portal onayı/talebi YOK; ESLESTI, NORMAL — §3.1-6 'Meşru değişiklik' · arşiv L2-11 öğrenme",
    w1.ms !== null && kabul0?.f3 !== kabul1?.f3 && ayniMi(kabul0, kabul1, ["f1", "f2", "f4", "f5"]) && ayniMi(kira1.parmakIzi, kabul1, ["f1", "f2", "f3", "f4", "f5"]) && t1.length === 0,
    `kabul önce [${kumeOzeti(kabul0)}] → sonra [${kumeOzeti(kabul1)}] · kira [${kumeOzeti(kira1.parmakIzi)}] talep=${t1.length} · ${durumu(w1.detay)}`,
  );

  // (b) iki güçlü etken birden (f2 + f4) değişir: tutan güçlü 1 → öğrenme yok, merdiven.
  const yoklamaOnce = ((await b.detayKurulum(k.dbId)).yoklamalar as Array<{ id: string }>).map((y) => y.id);
  await degistir(b, f, { f2: "5E0A0002-0000-4000-8000-0000000053F9", f4: "SENARYOS-SYS-02" });
  await f.istemci.yokla();
  const w2 = await f.istemci.bekle((d) => d.kira?.kiraId !== kira1.kiraId && d.parmakIzi.karar === "ESLESMEDI", 20_000);
  const kabul2 = await kabulEdilen(b, k.dbId);
  const kira2 = kiraYuku(f);
  a.kontrol(
    "iki güçlü etken birden (f2 + f4) değişti, tutan güçlü 1 → öğrenme YOK: kabul edilen küme aynı, yeni kira ESKİ kümeyi taşır — §3.1-6 karar (güçlülerden ≥ 2) · lisans.md:128 'tutmuyorsa öğrenmez'",
    w2.ms !== null && ayniMi(kabul1, kabul2, ["f1", "f2", "f3", "f4", "f5"]) && ayniMi(kira2.parmakIzi, kabul1, ["f1", "f2", "f3", "f4", "f5"]),
    `kabul [${kumeOzeti(kabul2)}] · kira [${kumeOzeti(kira2.parmakIzi)}]`,
  );
  const d2 = w2.detay;
  a.kontrol(
    "fabrika: PARMAK_IZI_UYUSMAZ merdiveni → UYARI (14 g; KISITLI değil, aniden durma yok) — §3.1-6 'Eşiğin altında 14 g UYARI → 30 g EK_SURE → KISITLI'",
    d2.durum.nedenler.some((n) => n.kod === "PARMAK_IZI_UYUSMAZ") && d2.durum.hesaplananKademe === "UYARI",
    durumu(d2),
  );
  const pd = await b.detayKurulum(k.dbId);
  const yeniYoklama = (pd.yoklamalar as Array<{ id: string; durum: { hesaplananKademe?: string; nedenler?: string[] } }>).filter((y) => !yoklamaOnce.includes(y.id));
  const kayit = yeniYoklama.find((y) => y.durum.hesaplananKademe === "UYARI" && (y.durum.nedenler ?? []).includes("PARMAK_IZI_UYUSMAZ"));
  const uyari = (pd.kopyaUyarilari as Array<{ tur: string; durum: string }>).filter((u) => u.tur === "PARMAK_IZI_UYUSMAZ");
  a.kontrol(
    "portal kaydı: yoklama geçmişinde fabrikanın bildirdiği UYARI + PARMAK_IZI_UYUSMAZ satırı (kurulum künyesi 'Yoklama geçmişi'); bekleyen donanım talebi YOK (yoklama talep açmaz, 'bildir' açar) — §3.1-6 · arşiv L2-11",
    kayit !== undefined && (await talepler(b, k.dbId)).length === 0,
    `yeni yoklama=${yeniYoklama.length} UYARI satırı=${kayit ? "var" : "yok"} · kopya uyarısı PARMAK_IZI_UYUSMAZ=${uyari.map((u) => u.durum).join(",") || "yok"}`,
  );
  if (uyari.length === 0) {
    a.not("satıcı PARMAK_IZI_UYUSMAZ kopya uyarısı AÇMADI: uyarı koşulu v1 kararıyla (renewal.service.ts `vsAccepted` kural vermeden compareFingerprints → eşleşen 3/5 ESLESTI) — v2 alıcıda eşik altı uyuşmazlık yalnız yoklama satırında görünür (soru: uyarı/bildirim kiranın kuralıyla mı açılmalı?)");
  }
  await b.durdur(f);
}

// ============================================================ L39
const T_ETKEN: Etkenler = { f1: "5e0a00010000400080000000000054f1", f2: "", f3: "SENARYO-T-DISK-01", f4: "" };
const U_ETKEN: Etkenler = { f1: "5e0a00010000400080000000000055f1", f2: "5E0A0002-0000-4000-8000-0000000055F2", f3: "SENARYO-U-DISK-01", f4: "SENARYOU-SYS-01" };

/** Çıplak akış (yardımcısız): portal zinciri → fabrika → sözleşme kabulü → etkinleştirme isteği. */
async function ciplakEtkinlestir<F extends Makineli>(b: MerdivenBaglami<F>, a: AdimYuzu, rol: string, makine: SahteMakine): Promise<{ f: F; dbId: string; kod: string; ilk: Yanit } | null> {
  const z = await portalZinciri(b, a, rol);
  if (!z) return null;
  const f = await b.yeniFabrika(rol, await b.rolDb(rol), makine);
  await b.baslat(f);
  await f.istemci.sozlesmeyiKabulEt();
  return { f, dbId: z.dbId, kod: z.kod, ilk: await f.istemci.istek("POST", "/api/license/etkinlestir", { kod: z.kod }) };
}

export async function l39ZayifTanima<F extends Makineli>(b: MerdivenBaglami<F>, a: AdimYuzu): Promise<void> {
  // (a) Docker/LinuxKit benzeri: DMI/SMBIOS yok (f2 · f4 değersiz) → okunan f1 · f3 · f5, güçlü yalnız f3.
  const t = await ciplakEtkinlestir(b, a, "T", { makine: "5E0A0001-0000-4000-8000-0000000000F6", seri: "SENARYOT01", etkenler: { ...T_ETKEN } });
  if (!t) return;
  const anahtar = (await t.f.istemci.detay()).kurulum.anahtarKimligi ?? "";
  const talep = await zayifTanimaTalebi(b.portal, t.dbId, anahtar);
  const kodlar = (await b.detayKurulum(t.dbId)).etkinlestirmeKodlari as Array<{ durum: string }>;
  const d1 = await t.f.istemci.detay();
  a.kontrol(
    "güçlü etken < 2 (okunan f1 · f3 · f5; güçlü yalnız f3) → etkinleştirme 409, satıcı kodu ZAYIF_TANIMA_ONAY_BEKLIYOR — §3.1-6 'Zayıf tanıma' · tasarım §4 kod tablosu",
    t.ilk.status === 409 && t.ilk.details.vendorCode === "ZAYIF_TANIMA_ONAY_BEKLIYOR",
    ozet(t.ilk),
  );
  a.kontrol(
    "ucuz ön denetim: kod TÜKETİLMEDİ (AKTIF), fabrika etkinleşmedi; portal onay kuyruğunda ZAYIF_TANIMA talebi BEKLIYOR (kurulum + anahtar) — §3.1-6 'kod ve nonce tüketilmez' · arşiv L2-11 zayıf tanıma",
    kodlar[0]?.durum === "AKTIF" && !d1.kurulum.etkin && talep?.tur === "ZAYIF_TANIMA" && talep.durum === "BEKLIYOR",
    `kod=${kodlar[0]?.durum ?? "-"} etkin=${String(d1.kurulum.etkin)} talep=${talep ? `${talep.tur} ${talep.durum}` : "yok"}`,
  );
  if (talep) {
    const onay = await b.portal.istek("POST", `/donanim-talepleri/${talep.id}/onayla`, { sebep: "Senaryo L39 zayıf tanıma onayı" });
    const e2 = await t.f.istemci.istek("POST", "/api/license/etkinlestir", { kod: t.kod });
    const d2 = (await t.f.istemci.bekle((d) => tamam(d), 15_000)).detay;
    const kira = kiraYuku(t.f);
    a.kontrol(
      "portal onayı → ONAYLANDI; AYNI kod → 200, kira `parmakIziKurali: zayif`; ESLESTI, NORMAL — §3.1-6 'Portal onayından sonra kira zayif taşır'",
      onay.status === 200 && onay.veri.durum === "ONAYLANDI" && e2.status === 200 && kira.parmakIziKurali === "zayif" && tamam(d2),
      `onay ${ozet(onay)} ${String(onay.veri.durum)} → etkinleştir ${ozet(e2)} kural=${String(kira.parmakIziKurali)} ${durumu(d2)}`,
    );
  }
  await b.durdur(t.f);

  // (b) KARŞIT: güçlü ≥ 2 makine ilk denemede etkinleşir.
  const u = await ciplakEtkinlestir(b, a, "U", { makine: "5E0A0001-0000-4000-8000-0000000000F7", seri: "SENARYOU01", etkenler: { ...U_ETKEN } });
  if (!u) return;
  const du = (await u.f.istemci.bekle((d) => tamam(d), 15_000)).detay;
  const tu = await talepler(b, u.dbId);
  const kiraU = kiraYuku(u.f);
  a.kontrol(
    "KARŞIT: güçlü ≥ 2 makine (f2 · f3 · f4) İLK denemede 200 — onay talebi yok, kira `parmakIziKurali: standart` — §3.1-6",
    u.ilk.status === 200 && tu.length === 0 && kiraU.parmakIziKurali === "standart" && tamam(du),
    `${ozet(u.ilk)} talep=${tu.length} kural=${String(kiraU.parmakIziKurali)} ${durumu(du)}`,
  );
  await b.durdur(u.f);
}
