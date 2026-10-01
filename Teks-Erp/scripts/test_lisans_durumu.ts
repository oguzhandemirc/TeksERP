// =============================================================================
// BEKÇİ — LİSANS DURUMU: saf durum fonksiyonu (kademe · ek süre · saat · tavan · gözlem)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts lisans_durumu   (DB'SİZ)
//
// NE ÖLÇER: `src/lib/license/state.ts` + `state-rules.ts` + `saat.ts`. Her kural bir
// POZİTİF (kural tetiklenir) ve bir KARŞI (komşu koşulda tetiklenmez) kontrolle ölçülür;
// belgeler protokolün gerçek imzalayıcısı + doğrulayıcısından geçer (elle nesne yok).
//   ⭐ fabrika ASLA aniden durmaz: ek süre İMZALI tarihten (v2: ödenmiş tarih P) · zamanın getirdiği
//      KISITLI iki anahtarlı (ikincisi: son 24 saatte başarılı kira alışverişi YOK) · saat ileri/geri erken bitirmez · ÖLÇÜLEMEDİ'de üretim açık · gözlemde
//      uygulanan etki bugünkü davranış (sıfır fark)
//   ⭐ kaçış yok: kirayı/HAK'ı silmek ek süreyi yenilemez, K4'ü kaldırmaz, kipi gevşetmez
//
// NEGATİF SONDA — dosya DIŞI mutasyon zinciri (bir kezlik, ✓B; cp + shasum ile birebir geri
// alındı; sayılar commit mesajında):
//   B1 iki anahtar kaldırıldı (süre bitince daima KISITLI)      → 2 ❌ (§4b · §5c)
//   B2 gözlemde hesaplanan etki uygulandı                       → 2 ❌ (§2b · §2d)
//   B3 tavan ÖLÇÜLEMEDİ'de de uygulandı                          → 2 ❌ (§7b · §7c)
//   B4 SAAT_İLERİ'de duvar saati güvenildi                       → 2 ❌ (§5a · §5b)
//   B5 kira silinince HAK verilişi yerine ilk açılış çapası      → 1 ❌ (§9d)
//   B6 K3 tarihi geçince KISITLI'ya geçiş kaldırıldı             → 1 ❌ (§11e)
//   Faz 1c (yönetici kararı 2 — sunucu kararları kalıcı, fail-open yalnız belirsizlikte):
//   D1 ek sürede HAK tavanı yeniden gevşetildi                  → 2 ❌ (§3b · §7d)
//   D2 son kira anlık görüntüsü (sonYaptirim) yok sayıldı        → 2 ❌ (§14c · §14d)
//   D3 dondurma yalnız HAK tavanı varken uygulandı              → 2 ❌ (§14b · §14f)
//   P0 (D4 saat kayması bilgidir):
//   P1 SAAT_KAYIK geçerlilik etkisi ÖLÇÜLEMEDİ yapıldı           → 1 ❌ (§6d)
//   F1a (D2 geri alma · D4 · saat kapalı süre kredisi · D1 okunamayan belge):
//   P2 geri alma denetimi (evaluateRollback) kaldırıldı          → 6 ❌ (§15a/b/e/f/g/h)
//   P3 SAAT_KAYIK kademe taşıdı (UYARI)                          → 1 ❌ (§6e)
//   P4 üst eşik kapalı süre kredisini yok saydı                  → 1 ❌ (§5f)
//   P5 okunamayan kira YOK sayıldı (KIRA_YOK)                    → 1 ❌ (§16a)
//   L2-5 (lisans v2: P modeli · K1 bant · K3 ikinci anahtar):
//   S1 P modeli kapalı (paidThrough hep null)                  → 15 ❌ (§5c · §17 · §18)
//   S2 ufuk P'yi sınırlamaz                                     → 4 ❌ (§17f/g/i/m)
//   S3 ufuk sınıf tavanı kırpması kalktı                         → 1 ❌ (§17m)
//   S4 bant görünürlük koşulu kalktı                            → 3 ❌ (§18c/d/i)
//   S5 sözleşme sonu yok sayıldı                                → 1 ❌ (§18b)
//   S6 ikinci anahtar hep "internet var"                        → 15 ❌ (§4 · §5d · §8 · §9 · §12c · §17 · §19a)
//   S7 durum kaydının son kirası sayılmaz                       → 1 ❌ (§4e)
//   S8 gelecek tarihli "son kira" süzgeci kalktı                → 1 ❌ (§4g)
//   S9 tek v2 alanı yeter                                       → 2 ❌ (§17k · §19a)
//   S10 HAK silinince kiranın P'si sürer                        → 4 ❌ (§17j/k/l · §19a)
//   S11 bütünlük merdiveni eski anahtar                         → 1 ❌ (§4h)
//   S12 "7 gün internetsiz" yerine 24 saat                      → 1 ❌ (§18d)
//   S13 v1'de kira çapası kalktı                                → 29 ❌ (§19a kâhini dahil)
//   Her mutasyonun UYGULANDIĞI (sha farkı) ve geri alındığı (sha eşitliği) ayrıca ölçüldü.
//   Doğuşta ısıran GERÇEK kusur: §5e — zehirli yüksek suyu üst eşikte tavanlamak güvenilir
//   saati duvarın ilerisine itip sahte SAAT_GERİ üretiyordu; `saat.ts` bu dilimde düzeltildi.
// ⚠️ Gerekli mi (reçete md. 20): fonksiyon bu dilimde doğdu; yazım sırasında §5e kendi
//   ağacında bir kusur yakaladı (yukarıda) — dış popülasyonda gerekçe ÖLÇÜLMEDİ.
// =============================================================================
import { randomUUID } from "node:crypto";
import {
  DAY_MS,
  verifyEntitlement,
  verifyLease,
  msToIso,
  type EntitlementDoc,
  type LeaseDoc,
} from "../src/lib/license/protocol";
import {
  OBSERVE_EFFECT,
  REASON_CODES,
  REASON_VALIDITY,
  toDocResult,
  computeLicenseState,
  isModuleLicensed,
  type LicenseState,
  type LicenseStateInput,
} from "../src/lib/license/state";
import {
  accumulatedRuntime,
  verifyStateRecord,
  signStateRecord,
  monotonicElapsed,
  evaluateClock,
} from "../src/lib/license/saat";
import { fiksturKur, hakBas, kiraBas, sertifikaBas, sertifikaYuku } from "./lib/lisans-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detay ? ` — ${detay}` : ""}`);
  }
}

const SIMDI = Date.parse("2026-10-01T09:00:00.000Z");
const SAAT = 60 * 60 * 1000;
const f = fiksturKur(SIMDI);
const KIRA_ID = randomUUID();
const ALT = sertifikaBas(f.kok, sertifikaYuku(f, f.alt, "ALT", { baslangic: msToIso(SIMDI - 400 * DAY_MS), bitis: msToIso(SIMDI + 170 * DAY_MS) }));

type Belge<T> = Partial<T> | "YOK" | "BOZUK";
interface Senaryo {
  readonly hak?: Belge<EntitlementDoc>;
  readonly kira?: Belge<LeaseDoc>;
  readonly girdi?: Partial<LicenseStateInput>;
  readonly saat?: Partial<LicenseStateInput["saat"]>;
}

/** İmzanın ortasında bir bit çevrilir: karakter değiştirmek kanonik kuyrukta no-op olabilir. */
function bozuk(token: string): string {
  const [b, y, s] = token.split(".");
  const imza = Buffer.from(s, "base64url");
  imza[10] ^= 0x01;
  return `${b}.${y}.${imza.toString("base64url")}`;
}

function girdi(s: Senaryo = {}): LicenseStateInput {
  const hakTok = s.hak === "YOK" ? null : s.hak === "BOZUK" ? bozuk(hakBas(f)) : hakBas(f, s.hak);
  const kiraEk = typeof s.kira === "object" ? s.kira : {};
  const kiraTok = s.kira === "YOK" ? null : kiraBas(f, { kiraId: KIRA_ID, altSertifika: ALT, ...kiraEk });
  return {
    kurulumId: f.kurulumId,
    kurulumAnahtarKimligi: f.kurulum.kid,
    hak: toDocResult(hakTok === null ? null : verifyEntitlement(hakTok, f.kokler)),
    kira: toDocResult(kiraTok === null ? null : verifyLease(s.kira === "BOZUK" ? bozuk(kiraTok) : kiraTok, f.kokler)),
    saat: { duvarMs: SIMDI, yuksekSuMs: SIMDI - 2 * SAAT, monotonik: { kiraId: KIRA_ID, gecenMs: SAAT }, durumDosyasiGecerli: true, ...s.saat },
    parmakIziEslesme: "ESLESTI",
    butunluk: "KAPSAM_DISI",
    derlemeTarihiMs: SIMDI - 30 * DAY_MS,
    ilkAcilisMs: SIMDI - 400 * DAY_MS,
    varsayilanKip: "gozlem",
    sonKiraZorlamasi: null,
    sonYaptirim: null,
    ...s.girdi,
  };
}

function durum(s: Senaryo = {}): LicenseState {
  return computeLicenseState(girdi(s));
}
function nedenVar(d: LicenseState, kod: string): boolean {
  return d.nedenler.some((n) => n.kod === kod);
}
function ozet(d: LicenseState): string {
  return `${d.gecerlilik}/${d.hesaplananKademe}→${d.uygulananKademe} [${d.nedenler.map((n) => n.kod).join(",")}]`;
}

/** Kira `gun` gün önce verilmiş ve `bitisGun` gün önce bitmiş; monotonik birikim gerçek zamanla uyumlu. */
function eskiKira(gun: number, bitisGun: number, ek: Partial<LeaseDoc> = {}): Senaryo {
  const verilis = SIMDI - gun * DAY_MS;
  return {
    kira: { verilis: msToIso(verilis), sunucuSaati: msToIso(verilis), bitis: msToIso(SIMDI - bitisGun * DAY_MS), ...ek },
    saat: { monotonik: { kiraId: KIRA_ID, gecenMs: gun * DAY_MS } },
  };
}

interface V2 {
  /** P = SIMDI + pGun gün; null = ödeme beyanı süresiz. */
  readonly pGun: number | null;
  /** HAK'ın çevrimdışı ufku (gün; null = süresiz). Varsayılan 400. */
  readonly ufuk?: number | null;
  /** Kira (ve son başarılı alışveriş) kaç SAAT önce; varsayılan 1. */
  readonly kiraSaat?: number;
  /** Eski vade (`gecerlilikBitis`): "P" = P'ye eşit (sözleşme sonu, varsayılan) · sayı = P + gün (taksit: 15) · null. */
  readonly vade?: "P" | number | null;
}

/** v2 belgeleri: HAK ufuk, kira ödenmiş tarih taşır; monotonik birikim kiranın yaşıyla uyumlu. */
function v2(o: V2): Senaryo {
  const saat = o.kiraSaat ?? 1;
  const verilis = SIMDI - saat * SAAT;
  const p = o.pGun === null ? null : SIMDI + o.pGun * DAY_MS;
  const vade = o.vade === undefined ? "P" : o.vade;
  const gecerlilikBitis = vade === null || p === null ? null : msToIso(vade === "P" ? p : p + vade * DAY_MS);
  return {
    hak: { cevrimdisiUfukGun: o.ufuk === undefined ? 400 : o.ufuk },
    kira: { verilis: msToIso(verilis), sunucuSaati: msToIso(verilis), bitis: msToIso(verilis + 29 * DAY_MS), odenmisTarih: p === null ? null : msToIso(p), gecerlilikBitis },
    saat: { monotonik: { kiraId: KIRA_ID, gecenMs: saat * SAAT } },
  };
}

/** Aynı senaryonun v2 alanı çıkarılmış hâli: "hak" (ufuk yok) · "kira" (P yok) · "ikisi" (v1 belge). */
function alansiz(s: Senaryo, alan: "hak" | "kira" | "ikisi"): Senaryo {
  const hak: Partial<EntitlementDoc> = typeof s.hak === "object" ? { ...s.hak } : {};
  const kira: Partial<LeaseDoc> = typeof s.kira === "object" ? { ...s.kira } : {};
  if (alan !== "kira") delete hak.cevrimdisiUfukGun;
  if (alan !== "hak") delete kira.odenmisTarih;
  return { ...s, hak, kira };
}

function normalBolumu(): void {
  console.log("\n§1 — normal: geçerli HAK + kira, zorlama");
  const d = durum();
  check("§1a GEÇERLİ / NORMAL / zorla", d.gecerlilik === "GECERLI" && d.hesaplananKademe === "NORMAL" && d.kip === "zorla", ozet(d));
  check("§1b bant yok, güncelleme izinli", d.uygulanan.bant === null && d.uygulanan.guncellemeIzni);
  check("§1c tavan uygulanır: HAK'taki modül açık, dışındaki kapalı", isModuleLicensed(d, "finance.enabled") && !isModuleLicensed(d, "iplik.enabled"));
  check("§1d saat duvardan, bulgu yok", d.saat.finding === null && d.saat.trustedMs === SIMDI);
}

function gozlemBolumu(): void {
  console.log("\n§2 — gözlem kipi: hesaplanır ama UYGULANMAZ (sıfır fark)");
  const d = durum({ kira: { zorlama: false, yaptirim: { kademe: "K5", mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: false } } });
  check("§2a ⭐ hesaplanan DURDURULMUŞ, uygulanan NORMAL", d.hesaplananKademe === "DURDURULMUS" && d.uygulananKademe === "NORMAL", ozet(d));
  check("§2b ⭐ uygulanan etki = bugünkü davranış (bant yok, güncelleme serbest, tavan yok)", d.uygulanan === OBSERVE_EFFECT);
  check("§2c hesaplanan bant ve kesilen güncelleme raporda görünür", d.hesaplanan.bant !== null && !d.hesaplanan.guncellemeIzni);
  check("§2d gözlemde HAK dışı modül de açık (tavan uygulanmaz)", isModuleLicensed(d, "iplik.enabled"));
  const z = durum({ kira: { yaptirim: { kademe: "K5", mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: false } } });
  check("§2e karşı: zorlamada aynı kira DURDURULMUŞ uygular", z.uygulananKademe === "DURDURULMUS", ozet(z));
  const v = durum({ kira: "YOK", hak: "YOK" });
  check("§2f kira yoksa kip derleme varsayılanından (gözlem)", v.kip === "gozlem" && v.uygulananKademe === "NORMAL", ozet(v));
}

function ekSureBolumu(): void {
  console.log("\n§3 — ek süre İMZALI kira.bitis'ten türer");
  const d = durum(eskiKira(35, 5));
  check("§3a kira 5 gün önce bitti → EK_SÜRE, 25 gün kaldı", d.hesaplananKademe === "EK_SURE" && d.ekSureKalanGun === 25, `${ozet(d)} kalan=${d.ekSureKalanGun}`);
  check(
    "§3b ⭐ ek süre BELİRSİZLİK DEĞİL: HAK tavanı sürer (HAK dışı modül kapalı, HAK'taki açık)",
    !isModuleLicensed(d, "iplik.enabled") && isModuleLicensed(d, "finance.enabled"),
  );
  check("§3c karşı: bitişe 1 gün varken NORMAL", durum(eskiKira(29, -1)).hesaplananKademe === "NORMAL");
  const v = durum(eskiKira(20, -10, { gecerlilikBitis: msToIso(SIMDI - 2 * DAY_MS) }));
  check("§3d vade (gecerlilikBitis) kiradan önce dolarsa ek süre vadeden başlar", nedenVar(v, "VADE_DOLDU") && v.ekSureKalanGun === 28, `${ozet(v)} kalan=${v.ekSureKalanGun}`);
  const s = durum(eskiKira(35, 5, { ekSureGun: 0 }));
  check("§3e ek süre 0 gün: süre biter bitmez iki anahtar sorusu", nedenVar(s, "EK_SURE_BITTI"), ozet(s));
}

/** Vadesi `vadeGun` gün önce dolmuş, `saat` saat önce verilmiş (dolayısıyla son başarılı alışveriş o an) kira. */
function vadesiGecmis(saat: number, vadeGun = 61): Senaryo {
  const verilis = SIMDI - saat * SAAT;
  return {
    kira: { verilis: msToIso(verilis), sunucuSaati: msToIso(verilis), bitis: msToIso(verilis + 29 * DAY_MS), gecerlilikBitis: msToIso(SIMDI - vadeGun * DAY_MS) },
    saat: { monotonik: { kiraId: KIRA_ID, gecenMs: saat * SAAT } },
  };
}

function ikiAnahtarBolumu(): void {
  console.log("\n§4 — zamanın getirdiği KISITLI iki anahtarlıdır: ikinci anahtar 'son 24 saatte başarılı kira alışverişi YOK' (K3)");
  const a = durum(vadesiGecmis(25));
  check("§4a ⭐ vade+ek süre bitti VE son başarılı alışveriş 25 saat önce → KISITLI", a.hesaplananKademe === "KISITLI" && !a.baglanti.internetVar, ozet(a));
  const b = durum(vadesiGecmis(23));
  check("§4b ⭐ aynı süre, son alışveriş 23 saat önce (internet VAR) → EK_SÜRE (0 gün), kısıtlama yok", b.hesaplananKademe === "EK_SURE" && b.ekSureKalanGun === 0 && b.baglanti.internetVar, ozet(b));
  check("§4c neden portala raporlanır (EK_SURE_BITTI); son alışveriş = kiranın sunucu saati", nedenVar(b, "EK_SURE_BITTI") && b.baglanti.sonAlisverisMs === SIMDI - 23 * SAAT);
  check(
    "§4d ⭐ bellekteki yoklama sinyali girdi DEĞİL: adresi kapalı / hiç yoklamamış kurulum da merdivene girer (yalnız imzalı kira sayılır)",
    !("sonYoklamaBasarisizMi" in girdi()) && durum(vadesiGecmis(72)).hesaplananKademe === "KISITLI",
  );
  const hakEski = { verilis: msToIso(SIMDI - 100 * DAY_MS) };
  const taze = durum({ hak: hakEski, kira: "YOK", girdi: { sonKira: { kiraId: randomUUID(), verilisMs: SIMDI - 2 * SAAT } } });
  check("§4e ⭐ kira dosyası silindi ama durum kaydının son kirası 2 saat önce → internet VAR, EK_SÜRE (0 gün)", taze.hesaplananKademe === "EK_SURE" && taze.ekSureKalanGun === 0, ozet(taze));
  const bayat = durum({ hak: hakEski, kira: "YOK", girdi: { sonKira: { kiraId: randomUUID(), verilisMs: SIMDI - 2 * DAY_MS } } });
  check("§4f karşı: durum kaydının son kirası 2 gün önce → KISITLI", bayat.hesaplananKademe === "KISITLI", ozet(bayat));
  const ileri = durum({ hak: hakEski, kira: "YOK", girdi: { sonKira: { kiraId: randomUUID(), verilisMs: SIMDI + 30 * DAY_MS } } });
  check("§4g kurcalı kayıt: güvenilir saatin ötesindeki 'son kira' internet sayılmaz → KISITLI", ileri.hesaplananKademe === "KISITLI" && ileri.baglanti.sonAlisverisMs === null, ozet(ileri));
  const butunluk = { butunluk: "GECERSIZ" as const, butunlukIlkUyusmazlikMs: SIMDI - 31 * DAY_MS };
  const bk = durum({ ...eskiKira(2, -20), girdi: butunluk });
  const bv = durum({ girdi: butunluk });
  check(
    "§4h bütünlük merdiveni AYNI ikinci anahtarı kullanır: 31. gün + son alışveriş 2 gün önce → KISITLI · 1 saat önce → EK_SÜRE (0)",
    bk.hesaplananKademe === "KISITLI" && bv.hesaplananKademe === "EK_SURE" && bv.ekSureKalanGun === 0,
    `${ozet(bk)} | ${ozet(bv)}`,
  );
}

function saatIleriBolumu(): void {
  console.log("\n§5 — saat İLERİ sıçrar: erken bitiş YOK");
  const d = durum({ saat: { duvarMs: SIMDI + 90 * DAY_MS } });
  check("§5a ⭐ monotonik varken 90 gün ileri saat → ÖLÇÜLEMEDİ(SAAT_İLERİ), kademe düşmez", d.saat.finding === "SAAT_ILERI" && d.hesaplananKademe === "UYARI", ozet(d));
  check("§5b güvenilir saat monotonik tahmine sabitlenir", d.saat.trustedMs === SIMDI && d.saat.source === "MONOTONIK");
  const durumsuz = { saat: { duvarMs: SIMDI + 90 * DAY_MS, monotonik: null, durumDosyasiGecerli: false } };
  const b = durum({ ...v2({ pGun: 365 }), ...durumsuz });
  check("§5c ⭐ v2: durum kaydı yok + saat 90 gün ileri → P'ye (1 yıl) dek çalışır, ek süre/kısıtlama YOK", b.hesaplananKademe === "UYARI" && nedenVar(b, "DURUM_DOSYASI"), ozet(b));
  const c = durum(durumsuz);
  check("§5d karşı: v1 belge aynı durumda → kira bitişi + ek süre geçti, son alışveriş 90 gün önce → KISITLI (ikinci anahtar budur)", c.hesaplananKademe === "KISITLI", ozet(c));
  const z = durum({ saat: { yuksekSuMs: SIMDI + 200 * DAY_MS } });
  check("§5e zehirli yüksek su (geçmişte ileri giden saat) tavanlanır, ek süre doğmaz", z.saat.finding === "SAAT_ILERI" && z.hesaplananKademe === "UYARI" && z.saat.trustedMs === SIMDI, ozet(z));
  // Makine 3 gün KAPALI kaldı: monotonik tahmin (alt sınır) duvarın 3 gün gerisinde. Tutarlı saatle yazılmış
  // kayıttan gelen kapalı süre kredisi üst eşiği genişletir — sahte SAAT_İLERİ yok, güvenilir = duvar.
  const kapali = { duvarMs: SIMDI + 3 * DAY_MS, kapaliKrediMs: 3 * DAY_MS };
  const k = durum({ saat: kapali });
  check("§5f ⭐ 3 gün kapalı kalan makine (kredi 3 gün) → SAAT_İLERİ YOK, güvenilir = duvar", k.saat.finding === null && k.saat.trustedMs === SIMDI + 3 * DAY_MS && k.gecerlilik === "GECERLI", ozet(k));
  const kk = durum({ saat: { duvarMs: SIMDI + 3 * DAY_MS } });
  check("§5g karşı: aynı duvar kredi olmadan → SAAT_İLERİ (tahmin alt sınırdır)", kk.saat.finding === "SAAT_ILERI", ozet(kk));
  const ks = durum({ saat: { ...kapali, duvarMs: SIMDI + 3 * DAY_MS + 40 * DAY_MS } });
  check("§5h ⭐ kredinin ötesine sıçrayan saat yine SAAT_İLERİ, güvenilir = alt sınır (erken bitiş yok)", ks.saat.finding === "SAAT_ILERI" && ks.saat.trustedMs === SIMDI, ozet(ks));
  const kl = durum({ saat: { ...kapali, duvarMs: SIMDI + 90 * DAY_MS, monotonik: null, durumDosyasiGecerli: false } });
  check("§5i kredi alt sınıra GİRMEZ: durum kaydı yokken kredi hiçbir şey açmaz", kl.saat.source === "DUVAR" && kl.saat.trustedMs === SIMDI + 90 * DAY_MS, ozet(kl));
}

function saatGeriBolumu(): void {
  console.log("\n§6 — saat GERİ alınır: süre uzamaz");
  const d = durum({ saat: { duvarMs: SIMDI - 3 * DAY_MS } });
  check("§6a saat 3 gün geri → ÖLÇÜLEMEDİ(SAAT_GERİ), güvenilir saat bilinen olgulara yaslanır", d.saat.finding === "SAAT_GERI" && d.saat.trustedMs === SIMDI, ozet(d));
  const e = durum({ ...eskiKira(35, 5), saat: { duvarMs: SIMDI - 10 * DAY_MS, monotonik: { kiraId: KIRA_ID, gecenMs: 35 * DAY_MS } } });
  check("§6b ⭐ bitmiş kirada saati bitiş öncesine almak NORMAL'e döndürmez", e.hesaplananKademe === "EK_SURE", ozet(e));
  const y = durum({ saat: { duvarMs: SIMDI - 3 * DAY_MS, monotonik: null, durumDosyasiGecerli: false, yuksekSuMs: SIMDI } });
  check("§6c durum kaydı yokken yüksek su tutar", y.saat.finding === "SAAT_GERI" && y.saat.trustedMs === SIMDI, ozet(y));
  // D4: satıcı saati imzasızdır — kayma raporlanır ama geçerliliği/kademeyi değiştiremez.
  check(
    "§6d SAAT_KAYIK neden listesinde ve BİLGİdir (geçerlilik etkisi yok; ÖLÇÜLEMEDİ sayılan SAAT_GERİ'den ayrı)",
    (REASON_CODES as readonly string[]).includes("SAAT_KAYIK") && REASON_VALIDITY.SAAT_KAYIK === null && REASON_VALIDITY.SAAT_GERI === "OLCULEMEDI",
  );
  const kayik = durum({ girdi: { saticiSapmaMs: -20 * 60_000 } });
  const duz = durum();
  check(
    "§6e ⭐ satıcı 20 dk kayma bildirdi → SAAT_KAYIK raporlanır; geçerlilik, kademe ve güvenilir saat DEĞİŞMEZ",
    nedenVar(kayik, "SAAT_KAYIK") && kayik.gecerlilik === duz.gecerlilik && kayik.hesaplananKademe === duz.hesaplananKademe && kayik.saat.trustedMs === duz.saat.trustedMs,
    ozet(kayik),
  );
  check("§6f karşı: tolerans içi sapma (5 dk) → SAAT_KAYIK yok", !nedenVar(durum({ girdi: { saticiSapmaMs: 5 * 60_000 } }), "SAAT_KAYIK"));
}

function uretimAcikBolumu(): void {
  console.log("\n§7 — tavan YALNIZ geçerli HAK'la; ÖLÇÜLEMEDİ'de üretim açık (L26)");
  const hak = { moduller: ["finance.enabled"] };
  const g = durum({ hak });
  check("§7a karşı: GEÇERLİ + zorla → HAK'ta olmayan production KAPALI", !isModuleLicensed(g, "production.enabled"), ozet(g));
  const o = durum({ hak, saat: { duvarMs: SIMDI + 90 * DAY_MS } });
  check("§7b ⭐ ÖLÇÜLEMEDİ (saat) → production AÇIK", o.gecerlilik === "OLCULEMEDI" && isModuleLicensed(o, "production.enabled"), ozet(o));
  const p = durum({ hak, girdi: { parmakIziEslesme: "OLCULEMEDI" } });
  check("§7c ÖLÇÜLEMEDİ (parmak izi) → production AÇIK", isModuleLicensed(p, "production.enabled"), ozet(p));
  const e = durum({ hak, ...eskiKira(35, 5) });
  check("§7d karşı: ek süre belirsizlik değil → HAK dışı production KAPALI (yönetici kararı 2)", e.hesaplananKademe === "EK_SURE" && !isModuleLicensed(e, "production.enabled"), ozet(e));
  const y = durum({ hak: "YOK", kira: "YOK", girdi: { ilkAcilisMs: SIMDI - 10 * DAY_MS, varsayilanKip: "zorla" } });
  check("§7f etkinleşmemiş kurulum (HAK yok) → production AÇIK", isModuleLicensed(y, "production.enabled"), ozet(y));
  const b = durum({ hak: "BOZUK" });
  check("§7e HAK bozuk → tavan yok (ham)", b.gecerlilik === "GECERSIZ" && isModuleLicensed(b, "production.enabled"), ozet(b));
}

function etkinlesmemisBolumu(): void {
  console.log("\n§8 — hiç etkinleşmemiş kurulum: ilk açılıştan 30 gün");
  const a = durum({ hak: "YOK", kira: "YOK", girdi: { ilkAcilisMs: SIMDI - 10 * DAY_MS, varsayilanKip: "zorla" } });
  check("§8a 10. gün → GEÇERSİZ(HAK_YOK) + EK_SÜRE 20 gün", a.gecerlilik === "GECERSIZ" && a.hesaplananKademe === "EK_SURE" && a.ekSureKalanGun === 20, ozet(a));
  const b = durum({ hak: "YOK", kira: "YOK", girdi: { ilkAcilisMs: SIMDI - 31 * DAY_MS, varsayilanKip: "zorla" } });
  check("§8b ⭐ 31. gün → KISITLI (K3: etkinleşmemiş kurulum hiç alışveriş yapmadı — yoklama sinyali beklenmez)", b.hesaplananKademe === "KISITLI" && b.uygulananKademe === "KISITLI", ozet(b));
  const g = durum({ hak: "YOK", kira: "YOK", girdi: { ilkAcilisMs: SIMDI - 31 * DAY_MS } });
  check("§8d gözlem derlemesinde (Faz 4 öncesi) aynı kurulum: hesaplanan KISITLI, uygulanan NORMAL (sıfır fark)", g.hesaplananKademe === "KISITLI" && g.uygulananKademe === "NORMAL" && g.uygulanan === OBSERVE_EFFECT, ozet(g));
  const c = durum({ hak: "YOK", kira: "YOK", girdi: { ilkAcilisMs: null } });
  check("§8c ilk açılış bilinmiyor → ÖLÇÜLEMEDİ nedeni, kısıtlama yok", nedenVar(c, "ILK_ACILIS_BILINMIYOR") && c.hesaplananKademe === "UYARI", ozet(c));
}

function kacisBolumu(): void {
  console.log("\n§9 — silmek kaçış değildir");
  const hakEski = { verilis: msToIso(SIMDI - 100 * DAY_MS) };
  const a = durum({ hak: hakEski, kira: "YOK", girdi: { sonKiraZorlamasi: true } });
  check("§9a ⭐ kira silindi → çapa HAK verilişi; ek süre YENİLENMEZ → KISITLI", a.hesaplananKademe === "KISITLI" && a.uygulananKademe === "KISITLI", ozet(a));
  check("§9b ⭐ silinen kira kipi gevşetmez (son kiranın zorlaması)", a.kip === "zorla");
  const k4 = durum({ kira: { yaptirim: { kademe: "K4", mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: false } } });
  check("§9c K4 kirası → KISITLI", k4.uygulananKademe === "KISITLI", ozet(k4));
  const yeni = durum({ kira: "YOK" });
  check("§9d karşı: taze HAK + kira yok → EK_SÜRE (29 gün), anında kısıtlama değil", yeni.hesaplananKademe === "EK_SURE" && yeni.ekSureKalanGun === 29, ozet(yeni));
  const h = durum({ hak: "BOZUK", ...eskiKira(20, -10) });
  check("§9e HAK bozuk ama kira kuruluma bağlı → çapa kira, anında kısıtlama yok", h.gecerlilik === "GECERSIZ" && h.hesaplananKademe === "UYARI", ozet(h));
  const kb = durum({ kira: "BOZUK", hak: hakEski, girdi: { sonKiraZorlamasi: true } });
  check("§9f kira bozuk → silinmiş gibi (HAK verilişinden) KISITLI", kb.hesaplananKademe === "KISITLI" && nedenVar(kb, "KIRA_GECERSIZ"), ozet(kb));
}

function kimlikBolumu(): void {
  console.log("\n§10 — kimlik bağları: kurulum, anahtar, parmak izi, bütünlük");
  const a = durum({ girdi: { kurulumId: f.hakId } });
  check("§10a HAK başka kuruluma ait → GEÇERSİZ", nedenVar(a, "HAK_KURULUM_UYUSMAZ") && a.gecerlilik === "GECERSIZ", ozet(a));
  const b = durum({ girdi: { kurulumAnahtarKimligi: "kur-baskaanahtar" } });
  check("§10b kira başka kurulum anahtarına verilmiş → bağ uyuşmaz", nedenVar(b, "KIRA_BAG_UYUSMAZ"), ozet(b));
  const c = durum({ girdi: { parmakIziEslesme: "ESLESMEDI" } });
  check("§10c parmak izi uyuşmaz → GEÇERSİZ + UYARI, anında kısıtlama YOK", c.gecerlilik === "GECERSIZ" && c.hesaplananKademe === "UYARI", ozet(c));
  const d = durum({ girdi: { butunluk: "GECERSIZ" } });
  check("§10d bütünlük uyuşmaz → GEÇERSİZ + UYARI", d.gecerlilik === "GECERSIZ" && d.hesaplananKademe === "UYARI", ozet(d));
  check("§10e karşı: bütünlük kapsam dışı (Faz 1) etkisiz", durum().gecerlilik === "GECERLI");
  const e = durum({ saat: { monotonik: { kiraId: randomUUID(), gecenMs: SAAT } } });
  check("§10f durum kaydı başka kiraya ait → ÖLÇÜLEMEDİ(DURUM_DOSYASI)", nedenVar(e, "DURUM_DOSYASI") && e.gecerlilik === "OLCULEMEDI", ozet(e));
  const s = durum({ kira: { hakSurum: 2 } });
  check("§10g kira HAK'ın başka sürümüne ait → bağ uyuşmaz", nedenVar(s, "KIRA_BAG_UYUSMAZ"), ozet(s));
}

function yaptirim(kademe: "K0" | "K1" | "K2" | "K3" | "K4" | "K5", ek: Partial<LeaseDoc["yaptirim"]> = {}): Senaryo {
  return { kira: { yaptirim: { kademe, mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: false, ...ek } } };
}

function yaptirimBolumu(): void {
  console.log("\n§11 — yaptırım kataloğu K0…K5 + DEVREDİLDİ");
  const k0 = durum(yaptirim("K0", { mesaj: "Ödeme hatırlatması" }));
  check("§11a K0 → NORMAL + mesaj bandı", k0.hesaplananKademe === "NORMAL" && k0.uygulanan.bant?.metin === "Ödeme hatırlatması", ozet(k0));
  const k1 = durum(yaptirim("K1"));
  check("§11b K1 → güncelleme kesilir, kademe NORMAL", !k1.uygulanan.guncellemeIzni && k1.hesaplananKademe === "NORMAL", ozet(k1));
  const k2 = durum(yaptirim("K2", { donmusModuller: ["finance.enabled"] }));
  check("§11c K2 → dondurulan modül tavandan düşer, diğeri açık", !isModuleLicensed(k2, "finance.enabled") && isModuleLicensed(k2, "production.enabled"), ozet(k2));
  const k3 = durum(yaptirim("K3", { kisitlamaTarihi: msToIso(SIMDI + 7 * DAY_MS) }));
  check("§11d K3 tarih ileride → UYARI + 7 gün geri sayım", k3.hesaplananKademe === "UYARI" && k3.kisitlamaKalanGun === 7, ozet(k3));
  const k3b = durum(yaptirim("K3", { kisitlamaTarihi: msToIso(SIMDI - SAAT) }));
  check("§11e ⭐ K3 tarihi geçti → KISITLI (sunucu kararı: yoklama başarılı olsa da)", k3b.hesaplananKademe === "KISITLI", ozet(k3b));
  const k5 = durum(yaptirim("K5"));
  check("§11f K5 → DURDURULMUŞ, güncelleme kapalı", k5.hesaplananKademe === "DURDURULMUS" && !k5.uygulanan.guncellemeIzni, ozet(k5));
  const dv = durum({ kira: { devredildi: true } });
  check("§11g DEVREDİLDİ → KISITLI + tehlike bandı", dv.hesaplananKademe === "KISITLI" && dv.devredildi && dv.uygulanan.bant?.ton === "tehlike", ozet(dv));
}

function bakimBolumu(): void {
  console.log("\n§12 — bakım sonu: son hak edilen sürümde kalır");
  const bitmis = { bakimBitis: msToIso(SIMDI - 5 * DAY_MS) };
  const a = durum({ hak: bitmis, girdi: { derlemeTarihiMs: SIMDI - 30 * DAY_MS } });
  check("§12a bakım içinde çıkmış sürüm → NORMAL, yalnız güncelleme kesilir", a.hesaplananKademe === "NORMAL" && !a.uygulanan.guncellemeIzni && nedenVar(a, "BAKIM_BITTI"), ozet(a));
  const b = durum({ hak: bitmis, girdi: { derlemeTarihiMs: SIMDI - 2 * DAY_MS } });
  check("§12b bakım SONRASI çıkmış sürüm → EK_SÜRE (28 gün)", b.hesaplananKademe === "EK_SURE" && b.ekSureKalanGun === 28, ozet(b));
  const ihlal = { hak: { bakimBitis: msToIso(SIMDI - 60 * DAY_MS) }, girdi: { derlemeTarihiMs: SIMDI - 40 * DAY_MS } };
  const c = durum({ ...ihlal, kira: eskiKira(2, -20).kira, saat: eskiKira(2, -20).saat });
  check("§12c ihlalde 30 gün geçti + son alışveriş 2 gün önce → KISITLI", c.hesaplananKademe === "KISITLI" && nedenVar(c, "BAKIM_IHLALI"), ozet(c));
  const ci = durum(ihlal);
  check("§12f karşı: aynı ihlal, son alışveriş 1 saat önce (internet VAR) → EK_SÜRE (0 gün)", ci.hesaplananKademe === "EK_SURE" && ci.ekSureKalanGun === 0, ozet(ci));
  const d = durum({ hak: { bakimBitis: msToIso(SIMDI + 10 * DAY_MS) } });
  check("§12d bakıma 10 gün → bilgi nedeni, kademe NORMAL", d.nedenler.some((n) => n.kod === "BAKIM_BITIYOR" && n.ayrinti === "10") && d.hesaplananKademe === "NORMAL", ozet(d));
  const e = durum({ girdi: { derlemeTarihiMs: null } });
  check("§12e derleme tarihi yok → bilgi nedeni, kademe NORMAL", nedenVar(e, "DERLEME_TARIHI_YOK") && e.hesaplananKademe === "NORMAL", ozet(e));
}

function kaliciKararBolumu(): void {
  console.log("\n§14 — sunucu kararları KALICIDIR: ek süre ve belirsizlik gevşetmez (yönetici kararı 2)");
  const k2 = { yaptirim: { kademe: "K2" as const, mesaj: null, kisitlamaTarihi: null, donmusModuller: ["finance.enabled"], guncellemeDonuk: false } };
  const a = durum({ ...eskiKira(35, 5, k2) });
  check(
    "§14a ⭐ K2 + kira bitti (EK_SÜRE) → dondurulan modül KAPALI, HAK'taki diğeri açık",
    a.hesaplananKademe === "EK_SURE" && !isModuleLicensed(a, "finance.enabled") && isModuleLicensed(a, "production.enabled"),
    ozet(a),
  );
  const b = durum({ kira: k2, saat: { duvarMs: SIMDI + 90 * DAY_MS } });
  check(
    "§14b ⭐ K2 + ÖLÇÜLEMEDİ (saat) → dondurulan KAPALI, HAK tavanı açık (HAK dışı modül açık)",
    b.gecerlilik === "OLCULEMEDI" && !isModuleLicensed(b, "finance.enabled") && isModuleLicensed(b, "iplik.enabled"),
    ozet(b),
  );
  const son = (kademe: "K2" | "K5" | null, donmus: string[] = []) => ({
    kademe, mesaj: null, kisitlamaTarihi: null, donmusModuller: donmus, guncellemeDonuk: false, devredildi: false,
  });
  const c = durum({ kira: "YOK", girdi: { sonYaptirim: son("K5"), sonKiraZorlamasi: true } });
  check("§14c ⭐ kira SİLİNDİ, son kiranın K5'i sürer → DURDURULMUŞ", c.hesaplananKademe === "DURDURULMUS" && c.uygulananKademe === "DURDURULMUS", ozet(c));
  const d = durum({ kira: "BOZUK", girdi: { sonYaptirim: son("K2", ["finance.enabled"]), sonKiraZorlamasi: true } });
  check("§14d ⭐ kira BOZUK, son kiranın dondurduğu modül kapalı kalır", !isModuleLicensed(d, "finance.enabled"), ozet(d));
  const e = durum({ kira: "YOK", girdi: { sonYaptirim: null, sonKiraZorlamasi: true } });
  check("§14e karşı: son kira kararı yoksa yaptırım yok (kademe EK_SÜRE, DURDURULMUŞ değil)", e.hesaplananKademe === "EK_SURE", ozet(e));
  const f2 = durum({ hak: "BOZUK", kira: k2 });
  check(
    "§14f HAK bozuk (belirsizlik) → HAK tavanı açık ama dondurulan modül KAPALI",
    isModuleLicensed(f2, "iplik.enabled") && !isModuleLicensed(f2, "finance.enabled"),
    ozet(f2),
  );
  const g = durum({ girdi: { sonYaptirim: son("K5") } });
  check("§14g karşı: kullanılabilir kira varsa ESKİ anlık görüntü yok sayılır (yaptırım kalktı)", g.hesaplananKademe === "NORMAL", ozet(g));
}

function geriAlmaBolumu(): void {
  console.log("\n§15 — geri alma (D2): durum kaydının bildiği son kiradan ESKİ kira ya da ters HAK pini kullanılmaz");
  const k5 = { kademe: "K5" as const, mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: false, devredildi: false };
  const pin = { hakId: f.hakId, surum: 1, sinif: "URETIM" as const, kokTuru: "kok" as const };
  const sonra = { kiraId: randomUUID(), verilisMs: SIMDI };
  const a = durum({ girdi: { sonKira: sonra, sonHak: pin, sonYaptirim: k5, sonKiraZorlamasi: true } });
  check(
    "§15a ⭐ diskteki kira durum kaydının son kirasından ESKİ → KIRA_GERI_ALINDI, ÖLÇÜLEMEDİ; K5 ve zorlama kayıttan sürer",
    nedenVar(a, "KIRA_GERI_ALINDI") && a.gecerlilik === "OLCULEMEDI" && a.hesaplananKademe === "DURDURULMUS" && a.uygulananKademe === "DURDURULMUS" && a.kip === "zorla",
    ozet(a),
  );
  const g = durum({ kira: { zorlama: false }, girdi: { sonKira: sonra, sonHak: pin, sonYaptirim: k5, sonKiraZorlamasi: true } });
  check("§15b ⭐ geri alınan gözlem kirası kipi GEVŞETMEZ (son kabulün zorlaması sürer)", g.kip === "zorla" && g.uygulananKademe === "DURDURULMUS", ozet(g));
  const ayni = durum({ girdi: { sonKira: { kiraId: KIRA_ID, verilisMs: SIMDI + DAY_MS }, sonHak: pin, sonYaptirim: k5 } });
  check("§15c karşı: kira durum kaydının son kirasıyla AYNI → kira otoritedir (kayıttaki eski yaptırım yok sayılır)", !nedenVar(ayni, "KIRA_GERI_ALINDI") && ayni.hesaplananKademe === "NORMAL", ozet(ayni));
  const yeni = durum({ girdi: { sonKira: { kiraId: randomUUID(), verilisMs: SIMDI - 30 * DAY_MS }, sonHak: pin, sonYaptirim: k5 } });
  check("§15d karşı: kira kayıttakinden YENİ → kira otoritedir (yaptırım kalkmış olabilir)", !nedenVar(yeni, "KIRA_GERI_ALINDI") && yeni.hesaplananKademe === "NORMAL", ozet(yeni));
  const sinif = durum({ girdi: { sonHak: { ...pin, sinif: "DEMO" } } });
  check("§15e ⭐ HAK sınıf pini ters (kayıt DEMO, disk ÜRETİM) → KIRA_GERI_ALINDI (SINIF)", sinif.nedenler.some((n) => n.kod === "KIRA_GERI_ALINDI" && n.ayrinti === "SINIF") && sinif.gecerlilik === "OLCULEMEDI", ozet(sinif));
  const kok = durum({ girdi: { sonHak: { ...pin, kokTuru: "hazirlik" } } });
  check("§15f ⭐ kök türü pini ters (kayıt hazırlık kökü, disk üretim kökü) → KIRA_GERI_ALINDI (KOK)", kok.nedenler.some((n) => n.kod === "KIRA_GERI_ALINDI" && n.ayrinti === "KOK"), ozet(kok));
  const surum = durum({ girdi: { sonHak: { ...pin, surum: 3 } } });
  check("§15g diskteki HAK kayıttaki sürümden ESKİ → KIRA_GERI_ALINDI (HAK_SURUM)", surum.nedenler.some((n) => n.kod === "KIRA_GERI_ALINDI" && n.ayrinti === "HAK_SURUM"), ozet(surum));
  const tavan = durum({ hak: { moduller: ["finance.enabled", "iplik.enabled"] }, girdi: { sonHak: { ...pin, sinif: "DEMO" } } });
  check("§15h geri almada HAK tavanı belirsizlik sayılır (üretim açık), yaptırımsız kayıtta kademe düşmez", isModuleLicensed(tavan, "production.enabled") && tavan.hesaplananKademe !== "KISITLI", ozet(tavan));
  const esit = durum({ girdi: { sonHak: pin, sonKira: { kiraId: KIRA_ID, verilisMs: SIMDI } } });
  check("§15i karşı: pin ve son kira eşit → bulgu yok, GEÇERLİ", !nedenVar(esit, "KIRA_GERI_ALINDI") && esit.gecerlilik === "GECERLI", ozet(esit));
}

function depoBolumu(): void {
  console.log("\n§16 — okunamayan depo dosyası (D1): YOK değil, ÖLÇÜLEMEDİ; sunucu kararı durum kaydından");
  const k4 = { kademe: "K4" as const, mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: false, devredildi: false };
  const a = durum({ girdi: { kira: { status: "OKUNAMADI" }, depoOkunamadi: ["kira.jws"], sonYaptirim: k4, sonKiraZorlamasi: true } });
  check(
    "§16a ⭐ kira okunamadı → DEPO_OKUNAMADI, ÖLÇÜLEMEDİ (KIRA_YOK/GEÇERSİZ değil); K4 kayıttan sürer",
    nedenVar(a, "DEPO_OKUNAMADI") && a.gecerlilik === "OLCULEMEDI" && !nedenVar(a, "KIRA_YOK") && a.uygulananKademe === "KISITLI",
    ozet(a),
  );
  const h = durum({ girdi: { hak: { status: "OKUNAMADI" }, depoOkunamadi: ["hak.jws"] } });
  check("§16b HAK okunamadı → ÖLÇÜLEMEDİ (HAK_YOK değil), tavan belirsizlikte açık", h.gecerlilik === "OLCULEMEDI" && !nedenVar(h, "HAK_YOK") && isModuleLicensed(h, "production.enabled"), ozet(h));
  const y = durum({ kira: "YOK", girdi: { sonYaptirim: k4, sonKiraZorlamasi: true } });
  check("§16c karşı: kira gerçekten YOK → KIRA_YOK (GEÇERSİZ)", nedenVar(y, "KIRA_YOK") && y.gecerlilik === "GECERSIZ", ozet(y));
}

function odenmisTarihBolumu(): void {
  console.log("\n§17 — v2 süre çapası: ödenmiş tarih P = min(kira.odenmisTarih, kira.verilis + HAK ufku); kira bitişi yalnız tazelik");
  const ic = v2({ pGun: 60, kiraSaat: 200 * 24 });
  const a = durum(ic);
  check(
    "§17a ⭐ 200 gün internetsiz: kira bitişi 171 gün önce geçti ama P 60 gün sonra → NORMAL, GEÇERLİ, süre bulgusu yok",
    a.hesaplananKademe === "NORMAL" && a.gecerlilik === "GECERLI" && !nedenVar(a, "KIRA_SURESI_DOLDU") && a.odenmisTarih?.tarihMs === SIMDI + 60 * DAY_MS && a.odenmisTarih.kaynak === "ODEME",
    ozet(a),
  );
  const v1 = durum(alansiz(ic, "ikisi"));
  check("§17b karşı: aynı belgeler P alanları olmadan → eski çapa (kira bitişi) → KISITLI", v1.hesaplananKademe === "KISITLI" && nedenVar(v1, "KIRA_SURESI_DOLDU") && v1.odenmisTarih === null, ozet(v1));
  const c = durum(v2({ pGun: -5, kiraSaat: 50 * 24 }));
  check(
    "§17c ⭐ P 5 gün önce geçti (internetsiz) → EK_SÜRE 25 gün (ODENMIS_TARIH_DOLDU), HAK tavanı sürer",
    c.hesaplananKademe === "EK_SURE" && c.ekSureKalanGun === 25 && nedenVar(c, "ODENMIS_TARIH_DOLDU") && !isModuleLicensed(c, "iplik.enabled") && isModuleLicensed(c, "finance.enabled"),
    ozet(c),
  );
  const d = durum(v2({ pGun: -31, kiraSaat: 50 * 24 }));
  check("§17d ⭐ P + 30 gün geçti, internetsiz → KISITLI (veri erişimi bandı)", d.hesaplananKademe === "KISITLI" && nedenVar(d, "EK_SURE_BITTI") && d.hesaplanan.bant?.ton === "tehlike", ozet(d));
  const e = durum(v2({ pGun: -31 }));
  check("§17e ⭐ P + 30 gün geçti ama internet VAR → EK_SÜRE (0 gün): kısıtlamayı satıcı getirir", e.hesaplananKademe === "EK_SURE" && e.ekSureKalanGun === 0, ozet(e));
  const f1 = durum(v2({ pGun: 730, ufuk: 200, kiraSaat: 210 * 24 }));
  check(
    "§17f ⭐ ufuk P'yi sınırlar (ALT ödeme tarihini uzatamaz): ödeme 2 yıl sonra, ufuk 200 gün, kira 210 gün önce → P 10 gün önce, EK_SÜRE 20",
    f1.odenmisTarih?.kaynak === "UFUK" && f1.odenmisTarih.tarihMs === SIMDI - 10 * DAY_MS && f1.hesaplananKademe === "EK_SURE" && f1.ekSureKalanGun === 20,
    ozet(f1),
  );
  const g = durum(v2({ pGun: 730, ufuk: 200, kiraSaat: 190 * 24 }));
  check("§17g karşı: kira 190 gün önce → P 10 gün sonra, NORMAL", g.hesaplananKademe === "NORMAL" && g.odenmisTarih?.tarihMs === SIMDI + 10 * DAY_MS, ozet(g));
  const h = durum(v2({ pGun: null, ufuk: null, kiraSaat: 300 * 24 }));
  check("§17h süresiz (ödeme beyanı ve ufuk süresiz): 300 gün internetsiz → NORMAL, P yok", h.hesaplananKademe === "NORMAL" && h.odenmisTarih?.tarihMs === null && h.odenmisTarih.kaynak === "SURESIZ", ozet(h));
  const i = durum(v2({ pGun: null, ufuk: 200, kiraSaat: 201 * 24 }));
  check("§17i karşı: ödeme süresiz ama ufuk 200 gün, kira 201 gün önce → EK_SÜRE (P ufuktan)", i.hesaplananKademe === "EK_SURE" && i.odenmisTarih?.kaynak === "UFUK", ozet(i));
  const silindi = durum({ ...ic, hak: "YOK" });
  const bozuk = durum({ ...ic, hak: "BOZUK" });
  check(
    "§17j ⭐ HAK silinir ya da bozulursa P UZATILMAZ: ufuk bilinmez, eski çapaya (kira bitişi) düşer → KISITLI (silmek yalnız kısaltır)",
    silindi.odenmisTarih === null && silindi.hesaplananKademe === "KISITLI" && nedenVar(silindi, "KIRA_SURESI_DOLDU") && bozuk.odenmisTarih === null && bozuk.hesaplananKademe === "KISITLI",
    `${ozet(silindi)} | ${ozet(bozuk)}`,
  );
  const ufuksuz = durum(alansiz(ic, "hak"));
  const odemesiz = durum(alansiz(ic, "kira"));
  check(
    "§17k ⭐ iki alandan biri yoksa eski çapa: HAK ufuk taşımıyor / kira P taşımıyor → KIRA_SURESI_DOLDU, P yok",
    ufuksuz.odenmisTarih === null && nedenVar(ufuksuz, "KIRA_SURESI_DOLDU") && odemesiz.odenmisTarih === null && nedenVar(odemesiz, "KIRA_SURESI_DOLDU"),
    `${ozet(ufuksuz)} | ${ozet(odemesiz)}`,
  );
  const demo = durum({ ...v2({ pGun: 60, kiraSaat: 50 * 24 }), hak: { sinif: "DEMO", cevrimdisiUfukGun: 400 } });
  check(
    "§17l DEMO HAK'ı 400 gün ufuk taşıyamaz: doğrulayıcı RED (UFUK_TAVANI_ASIMI) → P yok, eski çapa",
    demo.nedenler.some((n) => n.kod === "HAK_GECERSIZ" && n.ayrinti === "UFUK_TAVANI_ASIMI") && demo.odenmisTarih === null,
    ozet(demo),
  );
  const gecerli = verifyEntitlement(hakBas(f, { cevrimdisiUfukGun: 400 }), f.kokler);
  if (!gecerli.ok) throw new Error("fikstür HAK doğrulanmadı");
  const demoElle = { status: "GECERLI" as const, value: { ...gecerli.value, document: { ...gecerli.value.document, sinif: "DEMO" as const } } };
  const k = durum({ ...v2({ pGun: 60, kiraSaat: 50 * 24 }), girdi: { hak: demoElle } });
  check(
    "§17m savunma derinliği: doğrulayıcıyı atlayan DEMO + 400 gün ufuk yine 45 güne kırpılır → P = kira + 45 (5 gün önce), EK_SÜRE 25",
    k.odenmisTarih?.kaynak === "UFUK" && k.odenmisTarih.tarihMs === SIMDI - 5 * DAY_MS && k.ekSureKalanGun === 25,
    ozet(k),
  );
}

function bantBolumu(): void {
  console.log("\n§18 — bilgi bandı (K1): P − 30 gün ≤ T < P, kademe NORMAL; yalnız internetsizken ya da P sözleşme sonuyken");
  const a = durum(v2({ pGun: 20, kiraSaat: 10 * 24, vade: 15 }));
  check(
    "§18a ⭐ internetsiz (son alışveriş 10 gün önce), taksit, P 20 gün sonra → NORMAL + BİLGİ bandı (kalan gün + QR/dosya)",
    a.hesaplananKademe === "NORMAL" && a.gecerlilik === "GECERLI" && a.hesaplanan.bant?.ton === "bilgi" && /20 gün/.test(a.hesaplanan.bant.metin) && /QR/.test(a.hesaplanan.bant.metin) &&
      a.nedenler.some((n) => n.kod === "ODEME_YAKLASIYOR" && n.ayrinti === "20"),
    ozet(a),
  );
  const b = durum(v2({ pGun: 20, vade: "P" }));
  check(
    "§18b ⭐ sözleşme sonu (vade = P), internet VAR → bant VAR (sözleşme metni)",
    b.hesaplanan.bant?.ton === "bilgi" && /sözleşmesi 20 gün/.test(b.hesaplanan.bant.metin) && nedenVar(b, "ODEME_YAKLASIYOR"),
    ozet(b),
  );
  const c = durum(v2({ pGun: 20, vade: 15 }));
  check("§18c ⭐ internetli taksit (vade = P + 15) → bant YOK, neden YOK, NORMAL", c.hesaplanan.bant === null && !nedenVar(c, "ODEME_YAKLASIYOR") && c.hesaplananKademe === "NORMAL", ozet(c));
  const alti = durum(v2({ pGun: 20, kiraSaat: 6 * 24, vade: 15 }));
  const sekiz = durum(v2({ pGun: 20, kiraSaat: 8 * 24, vade: 15 }));
  check("§18d 'internetsiz' = son alışveriş 7 günden eski: taksitte 6 gün → bant yok · 8 gün → var", alti.hesaplanan.bant === null && sekiz.hesaplanan.bant?.ton === "bilgi", `${ozet(alti)} | ${ozet(sekiz)}`);
  const uzak = durum(v2({ pGun: 31, kiraSaat: 10 * 24 }));
  const yakin = durum(v2({ pGun: 1, kiraSaat: 10 * 24 }));
  check("§18e pencere: P 31 gün sonra → bant yok · 1 gün sonra → '1 gün'", uzak.hesaplanan.bant === null && /1 gün/.test(yakin.hesaplanan.bant?.metin ?? ""), `${ozet(uzak)} | ${ozet(yakin)}`);
  check("§18f bant UYARI kademesi değildir: ek süre sayacı yok, kademe NORMAL", a.ekSureKalanGun === null && a.uygulananKademe === "NORMAL" && a.uygulanan.bant?.ton === "bilgi");
  const gozlem = durum({ ...v2({ pGun: 20, kiraSaat: 10 * 24 }), kira: { ...(v2({ pGun: 20, kiraSaat: 10 * 24 }).kira as Partial<LeaseDoc>), zorlama: false } });
  check("§18g gözlem kipinde bant HESAPLANIR ama UYGULANMAZ (sıfır fark)", gozlem.hesaplanan.bant?.ton === "bilgi" && gozlem.uygulanan === OBSERVE_EFFECT, ozet(gozlem));
  const v1 = durum(alansiz(v2({ pGun: 20, kiraSaat: 10 * 24 }), "ikisi"));
  check("§18h karşı: v1 belge aynı tarihlerde → bant yok, ODEME_YAKLASIYOR yok", v1.hesaplanan.bant === null && !nedenVar(v1, "ODEME_YAKLASIYOR"), ozet(v1));
  const vadesiz = durum(v2({ pGun: 20, vade: null }));
  check("§18i vade yok (gecerlilikBitis null) sözleşme sonu sayılmaz → internetliyken bant yok", vadesiz.hesaplanan.bant === null, ozet(vadesiz));
  const olcu = durum({ ...v2({ pGun: 20, kiraSaat: 10 * 24 }), saat: { monotonik: null, durumDosyasiGecerli: false } });
  check("§18j ölçülemedi (UYARI) bandı bilgi bandından önce gelir", olcu.hesaplanan.bant?.ton === "uyari" && nedenVar(olcu, "ODEME_YAKLASIYOR"), ozet(olcu));
}

/** v1 belgelerinin bugünkü (eski) davranışının BAĞIMSIZ kâhini: çapa min(kira bitişi, vade), ek süre 30, iki anahtar. */
function v1Kahin(o: { kiraSaat: number; vadeGun: number | null }): { kademe: string; kod: string | null; kalan: number | null; bitti: boolean } {
  const verilis = SIMDI - o.kiraSaat * SAAT;
  const bitis = verilis + 29 * DAY_MS;
  const vade = o.vadeGun === null ? Number.POSITIVE_INFINITY : SIMDI + o.vadeGun * DAY_MS;
  const capa = Math.min(bitis, vade);
  const kod = vade < bitis ? "VADE_DOLDU" : "KIRA_SURESI_DOLDU";
  if (SIMDI < capa) return { kademe: "NORMAL", kod: null, kalan: null, bitti: false };
  const son = capa + 30 * DAY_MS;
  if (SIMDI < son) return { kademe: "EK_SURE", kod, kalan: Math.ceil((son - SIMDI) / DAY_MS), bitti: false };
  return o.kiraSaat <= 24 ? { kademe: "EK_SURE", kod, kalan: 0, bitti: true } : { kademe: "KISITLI", kod, kalan: null, bitti: true };
}

function sifirFarkBolumu(): void {
  console.log("\n§19 — eski belge (P alanı yok) ile SIFIR FARK: kâhin tablosu + tek alanlı belge v1 gibi davranır");
  const sapma: string[] = [];
  let satir = 0;
  for (const kiraSaat of [1, 30, 40 * 24]) {
    for (const vadeGun of [null, -45, -5, 20]) {
      const verilis = SIMDI - kiraSaat * SAAT;
      const sen: Senaryo = {
        kira: { verilis: msToIso(verilis), sunucuSaati: msToIso(verilis), bitis: msToIso(verilis + 29 * DAY_MS), gecerlilikBitis: vadeGun === null ? null : msToIso(SIMDI + vadeGun * DAY_MS) },
        saat: { monotonik: { kiraId: KIRA_ID, gecenMs: kiraSaat * SAAT } },
      };
      const d = durum(sen);
      const k = v1Kahin({ kiraSaat, vadeGun });
      const iz = (x: LicenseState) => JSON.stringify([x.hesaplananKademe, x.nedenler, x.hesaplanan.bant, x.ekSureKalanGun, x.odenmisTarih]);
      const tek = [durum({ ...sen, hak: { cevrimdisiUfukGun: 400 } }), durum({ ...sen, kira: { ...(sen.kira as Partial<LeaseDoc>), odenmisTarih: msToIso(SIMDI + 500 * DAY_MS) } })];
      const uyar =
        d.hesaplananKademe === k.kademe &&
        (k.kod === null ? !nedenVar(d, "KIRA_SURESI_DOLDU") && !nedenVar(d, "VADE_DOLDU") : nedenVar(d, k.kod)) &&
        nedenVar(d, "EK_SURE_BITTI") === k.bitti &&
        (k.kalan === null || d.ekSureKalanGun === k.kalan) &&
        d.odenmisTarih === null && !nedenVar(d, "ODEME_YAKLASIYOR") && !nedenVar(d, "ODENMIS_TARIH_DOLDU") &&
        tek.every((t) => iz(t) === iz(d));
      satir++;
      if (!uyar) sapma.push(`kira ${kiraSaat} sa · vade ${vadeGun}: ${ozet(d)} kalan=${d.ekSureKalanGun} ≠ kâhin ${JSON.stringify(k)}`);
    }
  }
  check(`§19a ⭐ ${satir} satırlık v1 tablosu kâhinle birebir; tek v2 alanı taşıyan belge v1'den ayırt edilemez`, sapma.length === 0, sapma.join(" | "));
}

function safBolumu(): void {
  console.log("\n§13 — saflık ve saat yardımcıları");
  const g = girdi(eskiKira(35, 5));
  const once = JSON.stringify(g.saat);
  const x = JSON.stringify(computeLicenseState(g));
  check("§13a aynı girdi → aynı çıktı, girdi değişmez", x === JSON.stringify(computeLicenseState(g)) && once === JSON.stringify(g.saat));
  check("§13b biriken süre: kayıt + hrtime farkı", accumulatedRuntime({ storedMs: 1000, loadHrNs: 5_000_000_000n, nowHrNs: 7_000_000_000n }) === 3000);
  check("§13c hrtime geri gitmiş görünürse birikim küçülmez", accumulatedRuntime({ storedMs: 1000, loadHrNs: 9n, nowHrNs: 1n }) === 1000);
  const tok = signStateRecord(
    { v: 1, kurulumId: f.kurulumId, kiraId: KIRA_ID, birikenMs: 42, yazildi: msToIso(SIMDI), yuksekSu: msToIso(SIMDI), sonKiraZorlamasi: true, sonYaptirim: null, sira: 3 },
    f.kurulum.privateKey,
    f.kurulum.x,
  );
  const dog = verifyStateRecord(tok, { publicKeyX: f.kurulum.x, installationId: f.kurulumId });
  check("§13d durum kaydı imza gidiş-dönüş, bu kiraya ait birikim okunur", dog.ok && monotonicElapsed(dog, KIRA_ID) === 42);
  check("§13e başka kiranın birikimi okunmaz", monotonicElapsed(dog, randomUUID()) === null);
  check("§13f başka kurulumun durum kaydı RED", !verifyStateRecord(tok, { publicKeyX: f.kurulum.x, installationId: f.hakId }).ok);
  const s = evaluateClock({ wallMs: SIMDI, highWaterMs: 0, leaseServerTimeMs: SIMDI - SAAT, monotonicElapsedMs: SAAT - 60_000, pollIntervalMs: SAAT });
  check("§13g tolerans içindeki fark bulgu üretmez", s.finding === null && s.trustedMs === SIMDI);
}

normalBolumu();
gozlemBolumu();
ekSureBolumu();
ikiAnahtarBolumu();
saatIleriBolumu();
saatGeriBolumu();
uretimAcikBolumu();
etkinlesmemisBolumu();
kacisBolumu();
kimlikBolumu();
yaptirimBolumu();
bakimBolumu();
kaliciKararBolumu();
geriAlmaBolumu();
depoBolumu();
odenmisTarihBolumu();
bantBolumu();
sifirFarkBolumu();
safBolumu();
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
