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
//   L2-7 (G4 iptal belgesi, §28):
//   S7 değerlendirici susar                                     → 5 ❌ (§28b/c/e/f/h)
//   S8 IPTAL_BELGESI_KAYIP birikime girmez                       → 1 ❌ (§28b)
//   S14 gereken sıra ≥ 1 (eski girdiye de bulgu)                 → 1 ❌ (§28g)
//   L2-9 (kabulde saat sürekliliği, §29; `saat.ts` mutasyonu):
//   N1 max kaldırıldı (taban = kira sunucu saati)               → 3 ❌ (§29d/e/f)
//   N2 kabul anında duvar tabana girdi                          → 2 ❌ (§29e/f)
//   N3 kapalı süre kredisi devretmez                            → 1 ❌ (§29f)
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
  leaseClockAnchor,
  type RememberedAnchor,
} from "../src/lib/license/saat";
import type { TraceInput } from "../src/lib/license/state-rules-trace";
import { revocationPin } from "../src/lib/license/state-rules-revocation";
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
function nedenAyrinti(d: LicenseState, kod: string): string {
  return d.nedenler.find((n) => n.kod === kod)?.ayrinti ?? "";
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
  console.log("\n§7 — tavan HAK'tan; üretim (çekirdek modül) HER HÂLDE açık (G12 §3.1-2)");
  const hak = { moduller: ["finance.enabled"] };
  const g = durum({ hak });
  check(
    "§7a ⭐ GEÇERLİ + zorla: HAK'ta olmayan modül (iplik) KAPALI, HAK'ta olmasa da production AÇIK (çekirdek)",
    !isModuleLicensed(g, "iplik.enabled") && isModuleLicensed(g, "production.enabled"),
    ozet(g),
  );
  const o = durum({ hak, saat: { duvarMs: SIMDI + 90 * DAY_MS } });
  check("§7b ⭐ ÖLÇÜLEMEDİ (saat) → production AÇIK", o.gecerlilik === "OLCULEMEDI" && isModuleLicensed(o, "production.enabled"), ozet(o));
  const p = durum({ hak, girdi: { parmakIziEslesme: "OLCULEMEDI" } });
  check("§7c ÖLÇÜLEMEDİ (parmak izi) → production AÇIK", isModuleLicensed(p, "production.enabled"), ozet(p));
  const e = durum({ hak, ...eskiKira(35, 5) });
  check("§7d karşı: ek süre belirsizlik değil → HAK dışı modül (iplik) KAPALI (yönetici kararı 2)", e.hesaplananKademe === "EK_SURE" && !isModuleLicensed(e, "iplik.enabled"), ozet(e));
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
    "§14b ⭐ K2 + ÖLÇÜLEMEDİ (saat) → dondurulan KAPALI ve HAK tavanı SÜRER (G12: belirsizlik tavanı kaldırmaz; HAK dışı iplik kapalı)",
    b.gecerlilik === "OLCULEMEDI" && !isModuleLicensed(b, "finance.enabled") && !isModuleLicensed(b, "iplik.enabled") && isModuleLicensed(b, "production.enabled"),
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

// ── Lisans v2 G12 (L2-6): iz · belirsizlik · parmak izi merdivenleri ──────────────────────────────────────
/** Dosya SAĞLAM izler: kira + durum kaydı + DB izi, kalıcı kayıp yok. */
const SAGLAM: TraceInput = { etkin: true, durumDosyasi: true, dbIzi: "GECERLI", dbIziKurulu: true, kayip: [] };
const SAAT_ONCE = (saat: number): number => SIMDI - saat * SAAT;

/** İzlerin hatırladığı süre çapası: P = SIMDI + pGun (yoksa P modeli işlemiyordu), eski çapa = SIMDI + eskiGun. */
function capa(o: { pGun?: number | null; eskiGun: number; kiraId?: string }): RememberedAnchor {
  return {
    kiraId: o.kiraId ?? KIRA_ID,
    ...(o.pGun === undefined ? {} : { odenmis: o.pGun === null ? null : msToIso(SIMDI + o.pGun * DAY_MS) }),
    eski: msToIso(SIMDI + o.eskiGun * DAY_MS),
    eskiNeden: "KIRA_SURESI_DOLDU",
    ekSureGun: 30,
  };
}

/**
 * Kira dosyası YOK, durum kaydı/DB izi ayakta: kip ve yaptırım kayıttan, son alışveriş `sonKiraSaat` saat önce.
 * `izler` verilmezse durum kaydı dosyası yok, DB izi geçerli (Z4'ün "bozuk, DB izi var" hâli).
 */
function kirasiz(o: { sonKiraSaat: number; capalar?: RememberedAnchor[]; izler?: Partial<TraceInput>; girdi?: Partial<LicenseStateInput>; hak?: Senaryo["hak"] }): Senaryo {
  return {
    kira: "YOK",
    ...(o.hak === undefined ? {} : { hak: o.hak }),
    girdi: {
      sonKiraZorlamasi: true,
      sonKira: { kiraId: KIRA_ID, verilisMs: SAAT_ONCE(o.sonKiraSaat) },
      sonCapalar: o.capalar ?? [capa({ pGun: 300, eskiGun: 20 })],
      izler: { ...SAGLAM, durumDosyasi: false, ...o.izler },
      ...o.girdi,
    },
  };
}

function zTablosuBolumuA(): void {
  console.log("\n§20 — §3.2 durum ve geçiş tablosu Z1–Z4 (zorla; saf durum fonksiyonu)");
  const z1 = [durum(v2({ pGun: 10 })), durum(v2({ pGun: -5 })), durum(v2({ pGun: -31 }))];
  check(
    "§20-Z1 ⭐ internet VAR · sağlam · HAK ✓ · çapa P: NORMAL → EK_SÜRE → EK_SÜRE(0); kısıtlı yalnız satıcı kararıyla",
    z1[0].hesaplananKademe === "NORMAL" && z1[1].hesaplananKademe === "EK_SURE" && z1[2].hesaplananKademe === "EK_SURE" && z1[2].ekSureKalanGun === 0 &&
      durum({ ...v2({ pGun: -31 }), girdi: { izler: SAGLAM } }).hesaplananKademe === "EK_SURE",
    z1.map(ozet).join(" | "),
  );
  const z2 = [durum(v2({ pGun: 20, kiraSaat: 10 * 24, vade: 15 })), durum(v2({ pGun: -5, kiraSaat: 50 * 24 })), durum(v2({ pGun: -31, kiraSaat: 50 * 24 }))];
  check(
    "§20-Z2 ⭐ internet YOK · sağlam · HAK ✓ · çapa P: NORMAL + bilgi bandı → EK_SÜRE 30 → KISITLI",
    z2[0].hesaplananKademe === "NORMAL" && z2[0].hesaplanan.bant?.ton === "bilgi" && z2[1].hesaplananKademe === "EK_SURE" && z2[2].hesaplananKademe === "KISITLI",
    z2.map(ozet).join(" | "),
  );
  const z3 = durum(kirasiz({ sonKiraSaat: 2, izler: { durumDosyasi: true }, girdi: { belirsizlikMs: 60 * DAY_MS } }));
  check(
    "§20-Z3 ⭐ internet VAR · bozuk (kira yok) · HAK ✓: LISANS_IZI_KAYIP(KIRA); birikim 60 gün olsa da EK_SÜRE(0) — sonraki yoklama Z1'e döndürür",
    nedenAyrinti(z3, "LISANS_IZI_KAYIP") === "KIRA" && z3.hesaplananKademe === "EK_SURE" && z3.ekSureKalanGun === 0 && z3.baglanti.internetVar,
    ozet(z3),
  );
  const z4 = (gun: number): LicenseState => durum(kirasiz({ sonKiraSaat: 10 * 24, girdi: { belirsizlikMs: gun * DAY_MS } }));
  const [a, b, c, d] = [z4(13.9), z4(14), z4(43.9), z4(44)];
  check(
    "§20-Z4 ⭐ internet YOK · bozuk (kira + durum kaydı yok, DB izi var) · HAK ✓ · çapa birikim: 13,9 g UYARI → 14 g EK_SÜRE 30 → 43,9 g EK_SÜRE 1 → 44 g KISITLI",
    a.hesaplananKademe === "UYARI" && b.hesaplananKademe === "EK_SURE" && b.ekSureKalanGun === 30 && c.ekSureKalanGun === 1 && d.hesaplananKademe === "KISITLI" &&
      nedenAyrinti(d, "LISANS_IZI_KAYIP") === "KIRA,DURUM" && nedenVar(d, "BELIRSIZLIK_SURUYOR"),
    [a, b, c, d].map((x) => `${ozet(x)} kalan=${x.ekSureKalanGun}`).join(" | "),
  );
  const z4y = durum(kirasiz({ sonKiraSaat: 10 * 24, girdi: { belirsizlikMs: 15 * DAY_MS, sonYaptirim: { kademe: "K2", mesaj: null, kisitlamaTarihi: null, donmusModuller: ["finance.enabled"], guncellemeDonuk: false, devredildi: false } } }));
  check(
    "§20-Z4b yaptırım kaynağı durum kaydı → DB izi: K2 dondurması sürer; tavan HAK'tan (HAK ✓)",
    !isModuleLicensed(z4y, "finance.enabled") && !isModuleLicensed(z4y, "iplik.enabled") && isModuleLicensed(z4y, "ticaret.enabled"),
    ozet(z4y),
  );
}

function zTablosuBolumuB(): void {
  console.log("\n§20 — §3.2 durum ve geçiş tablosu Z5–Z9 (zorla; saf durum fonksiyonu)");
  const tavan = { sonBilinenTavan: ["production.enabled", "finance.enabled"] };
  const z5 = durum({ ...v2({ pGun: 60 }), hak: "BOZUK", girdi: { izler: SAGLAM, ...tavan } });
  check(
    "§20-Z5 ⭐ internet VAR · sağlam · HAK ✗: UYARI, çapa eski (P yok), tavan SON BİLİNEN (finans açık, ticaret kapalı)",
    z5.hesaplananKademe === "UYARI" && z5.odenmisTarih === null && isModuleLicensed(z5, "finance.enabled") && !isModuleLicensed(z5, "ticaret.enabled"),
    ozet(z5),
  );
  const z6a = durum({ ...eskiKira(35, 5), hak: "BOZUK", girdi: { izler: SAGLAM, ...tavan } });
  const z6b = durum({ ...eskiKira(70, 35), hak: "BOZUK", girdi: { izler: SAGLAM, ...tavan } });
  check(
    "§20-Z6 ⭐ internet YOK · sağlam · HAK ✗ · eski çapa (kira bitişi): EK_SÜRE 25 → KISITLI; tavan son bilinen",
    z6a.hesaplananKademe === "EK_SURE" && z6a.ekSureKalanGun === 25 && z6b.hesaplananKademe === "KISITLI" && !isModuleLicensed(z6b, "ticaret.enabled"),
    `${ozet(z6a)} | ${ozet(z6b)}`,
  );
  const z7 = durum(kirasiz({ sonKiraSaat: 2, hak: "BOZUK", izler: { durumDosyasi: true }, girdi: { belirsizlikMs: 60 * DAY_MS, ...tavan } }));
  check(
    "§20-Z7 internet VAR · bozuk · HAK ✗: EK_SÜRE(0) (yanıt HAK ve kirayı getirir), tavan son bilinen",
    z7.hesaplananKademe === "EK_SURE" && z7.ekSureKalanGun === 0 && !isModuleLicensed(z7, "ticaret.enabled") && isModuleLicensed(z7, "finance.enabled"),
    ozet(z7),
  );
  const ucYok = { durumDosyasi: false, dbIzi: "YOK" as const, dbIziKurulu: false };
  const z8 = durum({ kira: "YOK", hak: "BOZUK", girdi: { sonKiraZorlamasi: true, izler: { ...SAGLAM, ...ucYok } } });
  const z8b = durum({ kira: "YOK", hak: "BOZUK", girdi: { sonKiraZorlamasi: true, belirsizlikMs: 44 * DAY_MS, izler: { ...SAGLAM, ...ucYok } } });
  const z8h = durum({ kira: "YOK", girdi: { sonKiraZorlamasi: true, izler: { ...SAGLAM, ...ucYok } } });
  check(
    "§20-Z8 ⭐ internet YOK · üç iz yok (K7): 14 günlük uyarı ATLANIR → hemen EK_SÜRE 30 → (44 g) KISITLI; HAK ✗ → ham tavan (üretim açık), HAK ✓ → HAK tavanı; yaptırım kaynağı yok",
    z8.belirsizlik.ucIzYok && z8.hesaplananKademe === "EK_SURE" && z8.ekSureKalanGun === 30 && z8.belirsizlik.birikenMs === 14 * DAY_MS &&
      nedenAyrinti(z8, "LISANS_IZI_KAYIP") === "KIRA,DURUM,IZ" && z8b.hesaplananKademe === "KISITLI" &&
      isModuleLicensed(z8, "iplik.enabled") && isModuleLicensed(z8, "production.enabled") && !isModuleLicensed(z8h, "iplik.enabled") && z8.yaptirimKademesi === null,
    `${ozet(z8)} kalan=${z8.ekSureKalanGun} | ${ozet(z8b)}`,
  );
  const z9 = durum({ ...v2({ pGun: -5, kiraSaat: 2 }), girdi: { imzaYok: true, depoOkunamadi: ["kurulum-anahtari.json"], izler: SAGLAM, belirsizlikMs: 15 * DAY_MS } });
  const z9v = durum({ ...v2({ pGun: -31, kiraSaat: 2 }), girdi: { imzaYok: true, depoOkunamadi: ["kurulum-anahtari.json"], izler: SAGLAM } });
  check(
    "§20-Z9 ⭐ anahtar okunamaz (imza yok): DEPO_OKUNAMADI merdivene girer, İnternet YOK sayılır (son kira 2 saat önce olsa da) → P + 30 geçti → KISITLI; tavan/yaptırım aynı",
    nedenVar(z9, "DEPO_OKUNAMADI") && z9.belirsizlik.suruyor && !z9.baglanti.internetVar && z9.hesaplananKademe === "EK_SURE" && z9v.hesaplananKademe === "KISITLI" && !isModuleLicensed(z9, "iplik.enabled"),
    `${ozet(z9)} | ${ozet(z9v)}`,
  );
}

function belirsizlikBolumu(): void {
  console.log("\n§21 — belirsizlik birikimi (§3.1-3): çalışma süresiyle, yalnız yeni kira sıfırlar; düzelse de kademe birikimden");
  const sure = (x: Partial<LicenseStateInput>): LicenseState => durum({ ...v2({ pGun: 200, kiraSaat: 10 * 24 }), girdi: { izler: SAGLAM, ...x } });
  const a = sure({ belirsizlikMs: 20 * DAY_MS });
  check("§21a ⭐ ölçülemedi DÜZELDİ ama birikim 20 gün (yeni kira yok) → EK_SÜRE sürer (bulgu ile birikim ayrı eksen)", a.hesaplananKademe === "EK_SURE" && a.ekSureKalanGun === 24 && !a.belirsizlik.suruyor, ozet(a));
  const b = sure({ belirsizlikMs: 5 * DAY_MS });
  check("§21b karşı: birikim 5 gün, ölçülemedi yok → NORMAL, bulgu yok (birikim sessizce saklı)", b.hesaplananKademe === "NORMAL" && !nedenVar(b, "BELIRSIZLIK_SURUYOR"), ozet(b));
  const c = sure({ belirsizlikMs: 5 * DAY_MS, saticiSapmaMs: null, depoOkunamadi: ["kira.jws"] });
  check("§21c süren ölçülemedi (depo) + 5 gün → BELIRSIZLIK_SURUYOR (UYARI, ayrıntı gün), motor birikimi ilerletir (suruyor)", c.belirsizlik.suruyor && nedenAyrinti(c, "BELIRSIZLIK_SURUYOR") === "5" && c.hesaplananKademe === "UYARI", ozet(c));
  const saat = durum({ ...v2({ pGun: 200, kiraSaat: 10 * 24 }), saat: { duvarMs: SIMDI + 90 * DAY_MS }, girdi: { izler: SAGLAM } });
  check("§21d SAAT_İLERİ birikime girer (süren ölçülemedi)", saat.belirsizlik.suruyor && nedenVar(saat, "SAAT_ILERI"), ozet(saat));
  const butunluk = sure({ butunluk: "OLCULEMEDI" });
  check("§21e karşı: bütünlük ölçülemedisi kendi merdivenindedir, belirsizlik birikimine girmez", !butunluk.belirsizlik.suruyor, ozet(butunluk));
  const etkinsiz = durum({ hak: "YOK", kira: "YOK", saat: { duvarMs: SIMDI - 3 * DAY_MS, monotonik: null, durumDosyasiGecerli: false, yuksekSuMs: SIMDI }, girdi: { izler: { ...SAGLAM, etkin: false } } });
  check("§21f etkinleşmemiş kurulumda birikim yürümez (kendi ilk açılış merdiveni var)", !etkinsiz.belirsizlik.suruyor, ozet(etkinsiz));
  const g = durum({ ...v2({ pGun: 200, kiraSaat: 2 }), girdi: { izler: SAGLAM, belirsizlikMs: 50 * DAY_MS } });
  check("§21g internet VAR iken birikim dolsa da KISITLI yok → EK_SÜRE(0)", g.hesaplananKademe === "EK_SURE" && g.ekSureKalanGun === 0, ozet(g));
}

function izKaybiBolumu(): void {
  console.log("\n§22 — iz kaybı (§3.1-4): tek iz de kayıptır ve kalıcıdır; DB izinin yokluğu ancak kurulduysa; bilinmiyorsa kayıp yok");
  const iz = (x: Partial<TraceInput>, ek: Partial<LicenseStateInput> = {}): LicenseState => durum({ ...v2({ pGun: 200, kiraSaat: 2 }), girdi: { izler: { ...SAGLAM, ...x }, ...ek } });
  const durumYok = iz({ durumDosyasi: false });
  check("§22a ⭐ yalnız durum kaydı dosyası yok (kira + DB izi var) → LISANS_IZI_KAYIP(DURUM), ÖLÇÜLEMEDİ, birikime girer", nedenAyrinti(durumYok, "LISANS_IZI_KAYIP") === "DURUM" && durumYok.gecerlilik === "OLCULEMEDI" && durumYok.belirsizlik.suruyor, ozet(durumYok));
  const izYok = iz({ dbIzi: "YOK" });
  check("§22b ⭐ yalnız DB izi yok (kurulmuştu) → LISANS_IZI_KAYIP(IZ)", nedenAyrinti(izYok, "LISANS_IZI_KAYIP") === "IZ", ozet(izYok));
  const ilk = iz({ dbIzi: "YOK", dbIziKurulu: false });
  const bilinmiyor = iz({ dbIzi: "BILINMIYOR" });
  check("§22c karşı: DB izi hiç kurulmamış (yükseltme sonrası ilk açılış) ya da okunamadı → kayıp YOK", !nedenVar(ilk, "LISANS_IZI_KAYIP") && !nedenVar(bilinmiyor, "LISANS_IZI_KAYIP") && ilk.gecerlilik === "GECERLI", `${ozet(ilk)} | ${ozet(bilinmiyor)}`);
  const kalici = iz({ kayip: ["DURUM"] });
  check("§22d ⭐ dosya geri konsa da kayıtlı iz kaybı yeni kiraya dek KALICI (merdiven durmaz)", nedenAyrinti(kalici, "LISANS_IZI_KAYIP") === "DURUM" && kalici.belirsizlik.suruyor, ozet(kalici));
  const kira = durum(kirasiz({ sonKiraSaat: 30 * 24, izler: { durumDosyasi: true }, capalar: [capa({ pGun: 200, eskiGun: -1 })] }));
  check("§22e ⭐ yalnız kira dosyası yok → LISANS_IZI_KAYIP(KIRA); süre çapası izlerden (P 200 gün sonra) → kısıtlama yok", nedenAyrinti(kira, "LISANS_IZI_KAYIP") === "KIRA" && kira.hesaplananKademe === "UYARI", ozet(kira));
  const okunamayan = durum({ ...v2({ pGun: 200, kiraSaat: 2 }), girdi: { izler: SAGLAM, kira: { status: "OKUNAMADI" }, depoOkunamadi: ["kira.jws"] } });
  check("§22f karşı: okunamayan kira iz KAYBI değildir (DEPO_OKUNAMADI, kalıcı bayrak yok)", !nedenVar(okunamayan, "LISANS_IZI_KAYIP") && nedenVar(okunamayan, "DEPO_OKUNAMADI"), ozet(okunamayan));
  const etkinsiz = iz({ etkin: false, durumDosyasi: false, dbIzi: "YOK" });
  check("§22g karşı: etkinleşmemiş kurulumda iz kuralı işlemez", !nedenVar(etkinsiz, "LISANS_IZI_KAYIP") && !etkinsiz.belirsizlik.ucIzYok, ozet(etkinsiz));
}

function parmakIziBolumu(): void {
  console.log("\n§23 — parmak izi v2 merdiveni (§3.1-6): kural kiradan; eşiğin altı 14 g UYARI → 30 g EK_SÜRE → KISITLI, eşik tutunca kapanır");
  const fp = (kural: LicenseStateInput["parmakIziKurali"], sonuc: LicenseStateInput["parmakIziEslesme"], gun: number, kiraSaat = 10 * 24): LicenseState =>
    durum({ ...v2({ pGun: 200, kiraSaat }), girdi: { izler: SAGLAM, parmakIziKurali: kural, parmakIziEslesme: sonuc, parmakIziUyusmazMs: gun * DAY_MS } });
  const [a, b, c] = [fp("standart", "ESLESMEDI", 0), fp("standart", "ESLESMEDI", 14), fp("standart", "ESLESMEDI", 44)];
  check(
    "§23a ⭐ v2 (standart) eşiğin altı: 0 g UYARI → 14 g EK_SÜRE 30 → 44 g KISITLI (internet yok); merdiven sürüyor",
    a.hesaplananKademe === "UYARI" && b.hesaplananKademe === "EK_SURE" && b.ekSureKalanGun === 30 && c.hesaplananKademe === "KISITLI" && a.parmakIziMerdiveni.uyusmaz,
    [a, b, c].map(ozet).join(" | "),
  );
  const online = fp("zayif", "ESLESMEDI", 60, 2);
  check("§23b internet VAR iken satıcı karar verene dek EK_SÜRE(0); zayıf kural da merdivenli", online.hesaplananKademe === "EK_SURE" && online.ekSureKalanGun === 0, ozet(online));
  const kapandi = fp("standart", "ESLESTI", 40);
  check("§23c ⭐ eşik yeniden TUTTU → merdiven KAPANIR (birikim sıfır, bulgu yok, GEÇERLİ)", kapandi.parmakIziMerdiveni.eslesti && kapandi.parmakIziMerdiveni.birikenMs === 0 && kapandi.gecerlilik === "GECERLI" && kapandi.hesaplananKademe === "NORMAL", ozet(kapandi));
  const v1 = fp("v1", "ESLESMEDI", 90);
  check("§23d ⭐ v1 kira (kural yok): ESKİ karar — uyuşmazlık yalnız UYARI, merdiven YOK (v1 belgeyle sıfır fark)", v1.hesaplananKademe === "UYARI" && !v1.parmakIziMerdiveni.uyusmaz, ozet(v1));
  const v2olc = fp("zayif", "OLCULEMEDI", 0);
  const v1olc = fp("v1", "OLCULEMEDI", 0);
  check("§23e v2'de parmak izi ölçülemedisi belirsizlik birikimine girer, v1'de girmez", v2olc.belirsizlik.suruyor && !v1olc.belirsizlik.suruyor, `${ozet(v2olc)} | ${ozet(v1olc)}`);
}

function tavanBolumu(): void {
  console.log("\n§24 — modül tavanı (§3.1-2): HAK doğrulanabildikçe; yoksa son bilinen; ham yalnız tavan bilinmiyorsa; üretim çekirdek; bağımlılık tavanda");
  const olc = durum({ ...v2({ pGun: 200 }), saat: { duvarMs: SIMDI + 90 * DAY_MS }, girdi: { izler: SAGLAM } });
  check("§24a ⭐ ÖLÇÜLEMEDİ (saat) + HAK ✓ → HAK tavanı SÜRER (iplik kapalı), üretim açık", olc.gecerlilik === "OLCULEMEDI" && !isModuleLicensed(olc, "iplik.enabled") && isModuleLicensed(olc, "production.enabled"), ozet(olc));
  const pin = { hakId: f.hakId, surum: 1, sinif: "DEMO" as const, kokTuru: "kok" as const, moduller: ["production.enabled", "iplik.enabled", "ticaret.enabled"] };
  const geri = durum({ girdi: { sonHak: pin, sonBilinenTavan: pin.moduller, sonKiraZorlamasi: true } });
  check("§24b ⭐ HAK geri alınmış (pin ters) → diskteki HAK değil SON BİLİNEN tavan (pin modülleri)", nedenVar(geri, "KIRA_GERI_ALINDI") && isModuleLicensed(geri, "iplik.enabled") && !isModuleLicensed(geri, "finance.enabled"), ozet(geri));
  const ham = durum({ hak: "BOZUK", girdi: { sonBilinenTavan: null } });
  check("§24c karşı: HAK bozuk ve hiç tavan bilinmiyor → ham (iplik açık)", isModuleLicensed(ham, "iplik.enabled"), ozet(ham));
  const bag = durum({ hak: { moduller: ["iplik.enabled"] } });
  const tam = durum({ hak: { moduller: ["iplik.enabled", "ticaret.enabled"] } });
  check("§24d ⭐ bağımlılık TAVANDA: iplik lisansta ama ön koşulu ticaret değil → iplik KAPALI; ikisi birlikte → açık", !isModuleLicensed(bag, "iplik.enabled") && isModuleLicensed(tam, "iplik.enabled"), `${ozet(bag)} | ${ozet(tam)}`);
  const k2 = durum({ hak: { moduller: ["iplik.enabled", "ticaret.enabled"] }, kira: { yaptirim: { kademe: "K2", mesaj: null, kisitlamaTarihi: null, donmusModuller: ["ticaret.enabled", "production.enabled"], guncellemeDonuk: false } } });
  check("§24e ⭐ K2 ticareti dondurdu → bağımlı iplik de kapalı; K2 üretimi dondursa da üretim AÇIK (çekirdek)", !isModuleLicensed(k2, "iplik.enabled") && isModuleLicensed(k2, "production.enabled"), ozet(k2));
}

function kipBolumu(): void {
  console.log("\n§25 — kip sırası kira → durum kaydı → DB izi → derleme; HAK'taki `kipAltSiniri: zorla` her zaman alt sınır");
  const altSinir = durum({ hak: { kipAltSiniri: "zorla" }, kira: { zorlama: false } });
  check("§25a ⭐ gözlem kirası + HAK alt sınırı zorla → kip ZORLA", altSinir.kip === "zorla", ozet(altSinir));
  const pin = { hakId: f.hakId, surum: 1, sinif: "URETIM" as const, kokTuru: "kok" as const, kipAltSiniri: "zorla" as const };
  const hakYok = durum({ hak: "BOZUK", kira: "YOK", girdi: { sonKiraZorlamasi: false, sonHak: pin } });
  check("§25b ⭐ HAK bozuk + kayıt gözlem diyor → kayıttaki HAK pininin alt sınırı ZORLA (silmek kipi gevşetmez)", hakYok.kip === "zorla", ozet(hakYok));
  const kayit = durum({ kira: "YOK", girdi: { sonKiraZorlamasi: true } });
  const derleme = durum({ kira: "YOK", girdi: { sonKiraZorlamasi: null } });
  check("§25c kira yok → kip kayıttan (zorla); kayıt da yok → derleme varsayılanı (gözlem)", kayit.kip === "zorla" && derleme.kip === "gozlem", `${ozet(kayit)} | ${ozet(derleme)}`);
  const yeniHak = durum({ hak: { surum: 2 }, kira: { zorlama: false, hakSurum: 2 }, girdi: { sonHak: pin } });
  check("§25d karşı: geçerli HAK'ta alt sınır yoksa (yeni sürüm kaldırdı) pin uygulanmaz → kiranın gözlemi", yeniHak.kip === "gozlem", ozet(yeniHak));
}

function capaBolumu(): void {
  console.log("\n§26 — kira silinince süre çapası ayakta kalan izlerden: en ERKEN olan; izler çelişirse çelişki bulgudur (silmek uzatmaz)");
  const gecmis = durum(kirasiz({ sonKiraSaat: 40 * 24, hak: { verilis: msToIso(SIMDI - 2 * DAY_MS) }, capalar: [capa({ pGun: -40, eskiGun: -40 })] }));
  check("§26a ⭐ izlerin çapası 40 gün önce bitmiş → KISITLI (taze HAK verilişi ek süre DOĞURMAZ: silmek uzatmaz)", gecmis.hesaplananKademe === "KISITLI" && nedenVar(gecmis, "ODENMIS_TARIH_DOLDU"), ozet(gecmis));
  const hakYok = durum(kirasiz({ sonKiraSaat: 40 * 24, hak: "BOZUK", capalar: [capa({ pGun: 300, eskiGun: -10 })] }));
  check("§26b ⭐ HAK doğrulanamıyor → P okunmaz, izlerin ESKİ çapası (10 gün önce) → EK_SÜRE 20 (HAK silmek P'yi uzatmaz)", hakYok.hesaplananKademe === "EK_SURE" && hakYok.ekSureKalanGun === 20 && nedenVar(hakYok, "KIRA_SURESI_DOLDU"), ozet(hakYok));
  const celiski = durum(kirasiz({ sonKiraSaat: 40 * 24, capalar: [capa({ pGun: 100, eskiGun: 0 }), capa({ pGun: -5, eskiGun: 0, kiraId: randomUUID() })] }));
  check("§26c ⭐ iki iz farklı P taşıyor → ERKEN olan (5 gün önce) geçerli: EK_SÜRE 25 + LISANS_IZI_CELISKI (ölçülemedi, birikime girer)", celiski.hesaplananKademe === "EK_SURE" && celiski.ekSureKalanGun === 25 && nedenVar(celiski, "LISANS_IZI_CELISKI") && celiski.belirsizlik.suruyor, ozet(celiski));
  const ayniKira = durum({ ...v2({ pGun: 200 }), girdi: { izler: SAGLAM, sonCapalar: [capa({ pGun: 100, eskiGun: 0, kiraId: randomUUID() })] } });
  check("§26d karşı: kira varken BAŞKA kiraya ait (eskimiş) iz kopyası çapayı etkilemez ve çelişki sayılmaz", ayniKira.hesaplananKademe === "NORMAL" && !nedenVar(ayniKira, "LISANS_IZI_CELISKI"), ozet(ayniKira));
  const yok = durum({ kira: "YOK", hak: { verilis: msToIso(SIMDI - 100 * DAY_MS) }, girdi: { sonKiraZorlamasi: true } });
  check("§26e karşı: izler çapa hatırlamıyorsa (eski kayıt) bugünkü kural — kirasız HAK verilişi → KISITLI", yok.hesaplananKademe === "KISITLI" && nedenVar(yok, "KIRASIZ_EK_SURE"), ozet(yok));
  const k7 = durum({ kira: "YOK", hak: { verilis: msToIso(SIMDI - 100 * DAY_MS) }, girdi: { sonKiraZorlamasi: true, ekSureCapasiMs: SIMDI - DAY_MS, belirsizlikMs: 15 * DAY_MS, izler: { ...SAGLAM, durumDosyasi: true, dbIziKurulu: false } } });
  check("§26f ⭐ kayıtta K7 tespit anı varsa HAK verilişi çapası UYGULANMAZ: merdiven (15 g) → EK_SÜRE 29, KISITLI değil", k7.hesaplananKademe === "EK_SURE" && k7.ekSureKalanGun === 29 && !nedenVar(k7, "KIRASIZ_EK_SURE"), ozet(k7));
}

function gozlemSifirFarkBolumu(): void {
  console.log("\n§27 — GÖZLEM kipinde G12'nin HER dalı yalnız hesaplanır: uygulanan etki bugünkü davranış (sıfır fark)");
  const gozlem: Partial<LicenseStateInput> = { sonKiraZorlamasi: false };
  const vakalar: Array<[string, LicenseState]> = [
    ["Z4 birikim 44 g", durum(kirasiz({ sonKiraSaat: 240, girdi: { ...gozlem, belirsizlikMs: 44 * DAY_MS } }))],
    ["Z8 üç iz yok", durum({ kira: "YOK", girdi: { ...gozlem, izler: { ...SAGLAM, durumDosyasi: false, dbIzi: "YOK", dbIziKurulu: false } } })],
    ["Z9 anahtar okunamaz", durum({ ...v2({ pGun: -31, kiraSaat: 2 }), kira: { ...(v2({ pGun: -31, kiraSaat: 2 }).kira as Partial<LeaseDoc>), zorlama: false }, girdi: { imzaYok: true, depoOkunamadi: ["kurulum-anahtari.json"] } })],
    ["parmak izi 44 g", durum({ ...v2({ pGun: 200, kiraSaat: 240 }), kira: { ...(v2({ pGun: 200, kiraSaat: 240 }).kira as Partial<LeaseDoc>), zorlama: false }, girdi: { parmakIziKurali: "standart", parmakIziEslesme: "ESLESMEDI", parmakIziUyusmazMs: 44 * DAY_MS } })],
    ["ölçülemedi + HAK tavanı", durum({ kira: { zorlama: false }, saat: { duvarMs: SIMDI + 90 * DAY_MS } })],
    ["iz çelişkisi", durum(kirasiz({ sonKiraSaat: 240, capalar: [capa({ pGun: 100, eskiGun: 0 }), capa({ pGun: -5, eskiGun: 0, kiraId: randomUUID() })], girdi: gozlem }))],
  ];
  const sapma = vakalar.filter(([, d]) => d.kip !== "gozlem" || d.uygulananKademe !== "NORMAL" || d.uygulanan !== OBSERVE_EFFECT || !isModuleLicensed(d, "iplik.enabled"));
  const hesaplandi = vakalar.filter(([, d]) => d.hesaplananKademe !== "NORMAL");
  check(
    `§27a ⭐ ${vakalar.length} G12 dalında gözlem kipi: uygulanan NORMAL + OBSERVE_EFFECT, HAK dışı modül açık`,
    sapma.length === 0,
    sapma.map(([ad, d]) => `${ad}: ${ozet(d)}`).join(" | "),
  );
  check(`§27b aynı dallar HESAPLANIR (raporlanır): ${hesaplandi.length}/${vakalar.length} hesaplanan kademe NORMAL değil`, hesaplandi.length === vakalar.length, vakalar.map(([ad, d]) => `${ad}=${d.hesaplananKademe}`).join(", "));
}

function iptalBolumu(): void {
  console.log("\n§28 — iptal belgesi (G4): kira/pin bir sıra istiyor, elde o sırada belge yoksa IPTAL_BELGESI_KAYIP (ölçülemedi, birikime girer)");
  const iptal = (sira: number | null, okunamadi = false): Partial<LicenseStateInput> => ({ iptal: { sira, okunamadi } });
  const eski = durum({ kira: { iptalSira: 3 } });
  check("§28a alan verilmezse (eski girdi) iptal kuralı İŞLEMEZ: kira sıra istese de bulgu yok", !nedenVar(eski, "IPTAL_BELGESI_KAYIP") && eski.hesaplananKademe === "NORMAL", ozet(eski));
  const kira = durum({ kira: { iptalSira: 3 }, girdi: iptal(null) });
  check(
    "§28b ⭐ kira sıra 3 istiyor, elde belge yok → IPTAL_BELGESI_KAYIP (KIRA) · ÖLÇÜLEMEDİ · UYARI · belirsizlik sürüyor",
    nedenVar(kira, "IPTAL_BELGESI_KAYIP") && nedenAyrinti(kira, "IPTAL_BELGESI_KAYIP") === "KIRA" && kira.gecerlilik === "OLCULEMEDI" && kira.hesaplananKademe === "UYARI" && kira.belirsizlik.suruyor,
    ozet(kira),
  );
  const dusuk = durum({ kira: { iptalSira: 3 }, girdi: iptal(2) });
  check("§28c ⭐ elde DÜŞÜK sıralı belge (2 < 3) → yine kayıp (KIRA)", nedenAyrinti(dusuk, "IPTAL_BELGESI_KAYIP") === "KIRA", ozet(dusuk));
  const tamam = durum({ kira: { iptalSira: 3 }, girdi: iptal(3) });
  check("§28d karşı: elde gereken sırada belge → bulgu yok, NORMAL", !nedenVar(tamam, "IPTAL_BELGESI_KAYIP") && tamam.hesaplananKademe === "NORMAL", ozet(tamam));
  const pin = durum({ girdi: { ...iptal(3), iptalPini: 5 } });
  check("§28e ⭐ kira sıra istemese de durum kaydı pini (5) > eldeki (3) → kayıp (PIN): silmek pini geri almaz", nedenAyrinti(pin, "IPTAL_BELGESI_KAYIP") === "PIN", ozet(pin));
  const okunamadi = durum({ girdi: { ...iptal(null, true), iptalPini: 2 } });
  check("§28f kopya okunamadı + pin 2 → kayıp (OKUNAMADI)", nedenAyrinti(okunamadi, "IPTAL_BELGESI_KAYIP") === "OKUNAMADI", ozet(okunamadi));
  const gerekmez = durum({ girdi: { ...iptal(null, true), iptalPini: null } });
  check("§28g karşı: ne pin ne kira sıra istiyor → belge yokluğu (okunamasa da) bulgu DEĞİL", !nedenVar(gerekmez, "IPTAL_BELGESI_KAYIP") && gerekmez.hesaplananKademe === "NORMAL", ozet(gerekmez));
  const gozlem = durum({ kira: { iptalSira: 3, zorlama: false }, girdi: iptal(null) });
  check(
    "§28h ⭐ gözlem kipinde yalnız hesaplanır: uygulanan NORMAL + OBSERVE_EFFECT (sıfır fark), kira yaşar",
    nedenVar(gozlem, "IPTAL_BELGESI_KAYIP") && gozlem.uygulananKademe === "NORMAL" && gozlem.uygulanan === OBSERVE_EFFECT && gozlem.baglanti.sonAlisverisMs !== null,
    ozet(gozlem),
  );
  check(
    "§28i pin yardımcısı: en büyük pozitif tam sayı; null/0/undefined/kesirli yok sayılır, hiçbiri yoksa null",
    revocationPin(2, null, 5, undefined) === 5 && revocationPin(null, undefined, 0) === null && revocationPin(1.5) === null && revocationPin() === null,
  );
  check("§28j kod kataloğunda ve geçerlilik etkisi ÖLÇÜLEMEDİ", (REASON_CODES as readonly string[]).includes("IPTAL_BELGESI_KAYIP") && REASON_VALIDITY.IPTAL_BELGESI_KAYIP === "OLCULEMEDI");
}

// ── L2-9: kabulde saat sürekliliği (§29) — taşınmış kira tahmini geri çekemez, duvar tabana girmez ─────────
function saatSurekliligiBolumu(): void {
  console.log("\n§29 — kabulde saat sürekliliği (saf): taban = max(kira sunucu saati, kabul anındaki ölçülmüş tahmin); duvar tabana girmez");
  const ucGunOnce = msToIso(SIMDI - 3 * DAY_MS);
  const tasinmis: Senaryo = { kira: { sunucuSaati: ucGunOnce, verilis: ucGunOnce } };
  const eski = durum({ ...tasinmis, saat: { monotonik: { kiraId: KIRA_ID, gecenMs: 0 } } });
  const eskiNull = durum({ ...tasinmis, saat: { monotonik: { kiraId: KIRA_ID, gecenMs: 0, tabanMs: null } } });
  check(
    "§29a ⭐ eski kayıt (taban YOK): 3 gün önceki sunucu saatli kira az önce kabul → bugünkü sonuç SAAT_İLERİ(DUVAR), güvenilir = sunucu saati; taban null ile BAYT-EŞİT",
    eski.saat.finding === "SAAT_ILERI" && eski.saat.findingSource === "DUVAR" && eski.saat.trustedMs === SIMDI - 3 * DAY_MS && JSON.stringify(eski) === JSON.stringify(eskiNull),
    ozet(eski),
  );
  const tabanli = durum({ ...tasinmis, saat: { monotonik: { kiraId: KIRA_ID, gecenMs: 0, tabanMs: SIMDI } } });
  check("§29b ⭐ aynı kira, taban = kabul anındaki tahmin → bulgu yok, güvenilir = duvar", tabanli.saat.finding === null && tabanli.saat.trustedMs === SIMDI && tabanli.saat.estimateMs === SIMDI, ozet(tabanli));
  const geride = durum({ saat: { monotonik: { kiraId: KIRA_ID, gecenMs: SAAT, tabanMs: SIMDI - 10 * DAY_MS } } });
  check("§29c sunucu saatinin GERİSİNDEKİ taban yok sayılır (max): tahmin geri çekilmez", JSON.stringify(geride.saat) === JSON.stringify(durum().saat), `${geride.saat.estimateMs} vs ${durum().saat.estimateMs}`);
  const olcum = (wallMs: number, mono: number, credit = 0): ReturnType<typeof evaluateClock> =>
    evaluateClock({ wallMs, highWaterMs: 0, leaseServerTimeMs: SIMDI - 31 * DAY_MS, monotonicElapsedMs: mono, pollIntervalMs: 5 * 60_000, downtimeCreditMs: credit });
  const surekli = olcum(SIMDI, 31 * DAY_MS);
  const t = leaseClockAnchor(surekli, { leaseServerTimeMs: SIMDI - 3 * DAY_MS, wallMs: SIMDI });
  const taze = leaseClockAnchor(surekli, { leaseServerTimeMs: SIMDI - 5 * 60_000, wallMs: SIMDI });
  const ileriTaze = leaseClockAnchor(surekli, { leaseServerTimeMs: SIMDI + 60_000, wallMs: SIMDI });
  check(
    "§29d çapa: ölçülemedi → taban yok · taşınmış (3 g) → taban = tahmin · saat payı içinde (5 dk) ya da ileride → taban yok (alan yazılmaz)",
    JSON.stringify(leaseClockAnchor({ estimateMs: null, creditMs: 0 }, { leaseServerTimeMs: SIMDI - 3 * DAY_MS, wallMs: SIMDI })) === JSON.stringify({ baseMs: null, creditMs: 0 }) &&
      t.baseMs === SIMDI && t.creditMs === 0 && taze.baseMs === null && taze.creditMs === 0 && ileriTaze.baseMs === null && ileriTaze.creditMs === 0,
    JSON.stringify({ t, taze, ileriTaze }),
  );
  const ileri = olcum(SIMDI + 2 * DAY_MS, 31 * DAY_MS);
  const ia = leaseClockAnchor(ileri, { leaseServerTimeMs: SIMDI - 16 * 60_000, wallMs: SIMDI + 2 * DAY_MS });
  const sonra = evaluateClock({ wallMs: SIMDI + 2 * DAY_MS, highWaterMs: 0, leaseServerTimeMs: SIMDI - 16 * 60_000, baseMs: ia.baseMs, monotonicElapsedMs: 0, pollIntervalMs: 5 * 60_000, downtimeCreditMs: ia.creditMs });
  check(
    "§29e ⭐ kabul anında duvar 2 gün ileri (SAAT_İLERİ): taban duvar DEĞİL tahmin, kredi yok → kabulden sonra SAAT_İLERİ sürer, güvenilir = tahmin",
    ileri.finding === "SAAT_ILERI" && ia.baseMs === SIMDI && ia.creditMs === 0 && sonra.finding === "SAAT_ILERI" && sonra.trustedMs === SIMDI,
    `${JSON.stringify(ia)} → ${sonra.finding} ${sonra.trustedMs - SIMDI}`,
  );
  const kapali = olcum(SIMDI, 29 * DAY_MS, 2 * DAY_MS);
  const ka = leaseClockAnchor(kapali, { leaseServerTimeMs: SIMDI - 2 * DAY_MS - SAAT, wallMs: SIMDI });
  const kaSonra = evaluateClock({ wallMs: SIMDI, highWaterMs: 0, leaseServerTimeMs: SIMDI - 2 * DAY_MS - SAAT, baseMs: ka.baseMs, monotonicElapsedMs: 0, pollIntervalMs: 5 * 60_000, downtimeCreditMs: ka.creditMs });
  const asan = leaseClockAnchor(olcum(SIMDI + 5 * DAY_MS, 29 * DAY_MS, 2 * DAY_MS), { leaseServerTimeMs: SIMDI - 2 * DAY_MS - SAAT, wallMs: SIMDI + 5 * DAY_MS });
  check(
    "§29f ⭐ 2 gün kapalı (kredili) + kapanmadan önce üretilmiş kira: duvarın kredili kısmı devreder (2 g) → bulgu yok; krediyi aşan duvar devretmez (yalnız 2 g, sürünme yok)",
    kapali.finding === null && ka.baseMs === SIMDI - 2 * DAY_MS && ka.creditMs === 2 * DAY_MS && kaSonra.finding === null && kaSonra.trustedMs === SIMDI && asan.creditMs === 2 * DAY_MS,
    `${JSON.stringify(ka)} → ${kaSonra.finding} · aşan ${JSON.stringify(asan)}`,
  );
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
zTablosuBolumuA();
zTablosuBolumuB();
belirsizlikBolumu();
izKaybiBolumu();
parmakIziBolumu();
tavanBolumu();
kipBolumu();
capaBolumu();
gozlemSifirFarkBolumu();
iptalBolumu();
saatSurekliligiBolumu();
safBolumu();
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
