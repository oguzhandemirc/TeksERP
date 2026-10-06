// Lisans GÖRÜNÜMÜ: herkese açık durum özeti, yönetici ayrıntısı, proxy okuması ve indirme
// belirteci. Salt-okunur; belge içeriğinden yalnız ekranın gereksindiği alanlar çıkar.
// Yanıt tipleri panel (1d) ve tablet (1e) sözleşmesidir: docs/design/LISANS-PROTOKOLU.md §14.
import { APP_VERSION } from "../lib/app-version";
import { effectiveProxy, maskProxyUrl, nodeSupportsProxyEnv, type ProxySource } from "../lib/http-egress";
import {
  msToIso,
  parseJws,
  type DownloadProduct,
  type EntitlementDoc,
  type LeaseDoc,
  type LicenseClass,
  type LicenseMode,
  type MatchResult,
  type SanctionLevel,
  type StateTier,
  type Validity,
} from "../lib/license/protocol";
import { getLicenseStore, type PendingTransfer, type StoreProblem } from "../lib/license/store";
import {
  getDoorbellStatus,
  getDownloadTokens,
  getLicenseConfig,
  getLicenseDbFacts,
  getLicenseSnapshot,
  getPollStatus,
  peekObservationCounters,
  requestDownloadTokenRefresh,
  type LicenseSnapshot,
} from "../lib/license/runtime";
import type { Banner, LicenseEffect, PaidThrough, StateReason } from "../lib/license/state";
import { licenseError } from "./helpers/license-wire.helper";
import { fingerprintSection } from "./helpers/license-fingerprint-view.helper";
import type { FactorReport } from "../lib/license/fingerprint";
import { integritySection } from "./helpers/license-integrity-view.helper";
import { chainSection, type LicenseChainView } from "./helpers/license-chain-view.helper";
import type { IntegrityStatus } from "../lib/license/state-rules";
import { bannerFields } from "../lib/license/process-banners";

// ── Durum özeti (herkes) ────────────────────────────────────────────────────────
export interface LicenseStatusSummary {
  readonly ayrinti: true;
  readonly kip: LicenseMode;
  /** UYGULANAN kademe — gözlemde daima NORMAL (sıfır fark). */
  readonly kademe: StateTier;
  /** Tek bant (eski istemci): en şiddetli = `bantlar[0]`. */
  readonly bant: Banner | null;
  /** Tüm bantlar (şiddete göre azalan; lisans + `PROCESS_INFO_BANNERS`); yeni panel tek alanda sırayla döndürür. */
  readonly bantlar: readonly Banner[];
  /** Yalnız uygulanan kademe EK_SURE iken dolu. */
  readonly ekSureKalanGun: number | null;
  /** Yalnız zorlamada (K3 geri sayımı) dolu. */
  readonly kisitlamaKalanGun: number | null;
  readonly guncellemeIzni: boolean;
  readonly sinif: LicenseClass | null;
  readonly lisansNo: string | null;
  readonly lisansSahibi: { readonly musteri: string; readonly tesis: string } | null;
  readonly surum: string;
}
export type LicenseStatusResponse = LicenseStatusSummary | { readonly ayrinti: false };

/** Kimliksiz çağırana ayrıntı YOK: kademe/gün/modül sinyali sızmaz. */
export function getLicenseStatus(authenticated: boolean): LicenseStatusResponse {
  if (!authenticated) return { ayrinti: false };
  const snap = getLicenseSnapshot();
  const s = snap.state;
  const ent = snap.entitlement?.document ?? null;
  return {
    ayrinti: true,
    kip: s.kip,
    kademe: s.uygulananKademe,
    ...bannerFields(s.uygulanan.bantlar),
    ekSureKalanGun: s.uygulananKademe === "EK_SURE" ? s.ekSureKalanGun : null,
    kisitlamaKalanGun: s.kip === "zorla" ? s.kisitlamaKalanGun : null,
    guncellemeIzni: s.uygulanan.guncellemeIzni,
    sinif: ent?.sinif ?? null,
    lisansNo: ent?.lisansNo ?? null,
    lisansSahibi: ent ? { musteri: ent.musteri.ad, tesis: ent.tesis.ad } : null,
    surum: APP_VERSION,
  };
}

/**
 * Giriş öncesi K5 sinyali (`GET /api/auth/login-methods` → `lisansDurduruldu`) — kimliksize
 * verilen TEK lisans bilgisi: yalnız zorlama kipinde ve UYGULANAN kademe DURDURULMUŞ iken true,
 * gözlemde daima false. Motor hazır değilse ya da durum okunamazsa false (fabrikayı durdurmaz).
 */
export function isSuspendedBeforeLogin(): boolean {
  try {
    const snap = getLicenseSnapshot();
    return snap.durumHazir && snap.state.kip === "zorla" && snap.state.uygulananKademe === "DURDURULMUS";
  } catch {
    return false;
  }
}

// ── Ayrıntı (license:view) ──────────────────────────────────────────────────────
export interface LicenseDetail {
  /** İmza hazır (yoklama, etkinleştirme, istek): depo + kurulum anahtarı + DB olguları. */
  readonly hazir: boolean;
  /** Durum hazır: belgeler doğrulanıyor, kapı ve tavan işliyor (anahtar okunamasa da — G12 §3.1-1). */
  readonly durumHazir: boolean;
  /**
   * `kurulumId` LİSANS kimliğidir (LICENSE_DIR; etkinleşmemişte null); `veritabaniKimligi` DB'nin
   * `system.installationId`si — yalnız bilgi (DB kopyası taşır, lisans kimliği değildir; D14).
   */
  readonly kurulum: {
    kurulumId: string | null;
    veritabaniKimligi: string | null;
    anahtarKimligi: string | null;
    etkin: boolean;
    ilkAcilis: string | null;
  };
  readonly depo: {
    dizin: string | null;
    sorun: StoreProblem | null;
    bozukAnahtarKenaraAlindi: boolean;
    durumKaydi: { gecerli: boolean; sira: number | null };
  };
  readonly durum: {
    gecerlilik: Validity;
    nedenler: readonly StateReason[];
    kip: LicenseMode;
    hesaplananKademe: StateTier;
    uygulananKademe: StateTier;
    hesaplanan: LicenseEffect;
    uygulanan: LicenseEffect;
    ekSureKalanGun: number | null;
    kisitlamaKalanGun: number | null;
    devredildi: boolean;
    yaptirimKademesi: SanctionLevel | null;
    saat: { guvenilir: string; kaynak: string; bulgu: string | null; bulguKaynagi: string | null };
    /** v2 süre çapası (ödenmiş tarih P; `tarih` null = süresiz). `null` = belgeler P taşımıyor, eski çapa işler. */
    odenmisTarih: { tarih: string | null; kaynak: PaidThrough["kaynak"]; sozlesmeSonu: boolean } | null;
    /** Son başarılı kira alışverişi (imzalı kiradan) ve "internet var" kararı (son 24 saat). */
    baglanti: { sonAlisveris: string | null; internetVar: boolean };
  };
  readonly hak: (Omit<EntitlementDoc, "v" | "kurulumId" | "bayiSertifikasi" | "bayiId" | "imzaciSertifikasi" | "kipAltSiniri"> & { bayiId: string | null }) | null;
  readonly kira: Pick<
    LeaseDoc,
    | "kiraId" | "verilis" | "bitis" | "sunucuSaati" | "ekSureGun" | "zorlama" | "gecerlilikBitis" | "yaptirim" | "yoklamaAraligiDk" | "devredildi" | "kanal"
    | "odenmisTarih"
  > | null;
  readonly parmakIzi: {
    olculdu: string | null;
    olculen: Readonly<Record<"f1" | "f2" | "f3" | "f4" | "f5", boolean>> | null;
    karar: MatchResult | null;
    eslesen: number | null;
    olculebilen: number | null;
    uyusmayan: readonly string[];
    /** Etken başına okuma raporu (K8: çok yollu okuma + 24 sa önbellek) — değer/özet YOK; ölçüm yoksa null. */
    okuma: Readonly<Record<"f1" | "f2" | "f3" | "f4" | "f5", FactorReport>> | null;
    /** Kabul edilen kümede değeri olup 24 saattir hiçbir yoldan okunamayan etkenler. */
    kayip: readonly string[];
    onbellekBozuk: boolean;
  };
  readonly yoklama: {
    saticiYapilandirildi: boolean;
    saticiAdresi: string | null;
    sonDeneme: string | null;
    sonBasari: string | null;
    sonBasarisizlik: string | null;
    sonHataKodu: string | null;
    sonrakiDeneme: string | null;
    zil: { bagli: boolean; sonBaglanti: string | null; sonZil: string | null; sonKalpAtisi: string | null; sonHataKodu: string | null };
  };
  readonly tasima: PendingTransfer | null;
  readonly gozlem: { reddedilecekIstek: number; reddedilecekModul: number };
  readonly proxy: LicenseProxySettings;
  /** Lisans çekirdeği + imzalı paket bütünlüğü (dosya adı taşımaz; yalnız sayılar). */
  readonly butunluk: {
    cekirdek: "native" | "ts" | "yok";
    cekirdekNeden: string | null;
    zorunlu: boolean;
    durum: IntegrityStatus;
    kod: string | null;
    denetlendi: string | null;
    paketId: string | null;
    paketSurumu: string | null;
    derlemeTarihi: string | null;
    anahtar: string | null;
    sayilar: { dosya: number; eksik: number; degisik: number; fazla: number; okunamayan: number } | null;
    ilkUyusmazlik: string | null;
    /** Zincirli (`pkt-*`) listenin PAKET sertifikası; `paket-*` listede null. */
    sertifika: { kid: string; sertifikaId: string; bitis: string; iptal: boolean } | null;
    /** Kararı değiştirmeyen uyarı kodu (ör. `BUTUNLUK_SERTIFIKA_IPTAL`). */
    uyari: string | null;
  };
  /** G4 güven zinciri: HAK imzacısı (+ ara sertifikası), kiranın ALT'ı, iptal belgesinin hâli. */
  readonly zincir: LicenseChainView;
}

function isoOrNull(ms: number | null): string | null {
  return ms === null ? null : msToIso(ms);
}

function stateSection(snap: LicenseSnapshot): LicenseDetail["durum"] {
  const s = snap.state;
  return {
    gecerlilik: s.gecerlilik,
    nedenler: s.nedenler,
    kip: s.kip,
    hesaplananKademe: s.hesaplananKademe,
    uygulananKademe: s.uygulananKademe,
    hesaplanan: s.hesaplanan,
    uygulanan: s.uygulanan,
    ekSureKalanGun: s.ekSureKalanGun,
    kisitlamaKalanGun: s.kisitlamaKalanGun,
    devredildi: s.devredildi,
    yaptirimKademesi: s.yaptirimKademesi,
    saat: { guvenilir: msToIso(s.saat.trustedMs), kaynak: s.saat.source, bulgu: s.saat.finding, bulguKaynagi: s.saat.findingSource },
    odenmisTarih: s.odenmisTarih && { tarih: isoOrNull(s.odenmisTarih.tarihMs), kaynak: s.odenmisTarih.kaynak, sozlesmeSonu: s.odenmisTarih.sozlesmeSonu },
    baglanti: { sonAlisveris: isoOrNull(s.baglanti.sonAlisverisMs), internetVar: s.baglanti.internetVar },
  };
}

function documentSections(snap: LicenseSnapshot): Pick<LicenseDetail, "hak" | "kira"> {
  const ent = snap.entitlement?.document ?? null;
  const l = snap.lease?.document ?? null;
  return {
    hak: ent
      ? {
          hakId: ent.hakId, surum: ent.surum, lisansNo: ent.lisansNo, musteri: ent.musteri, tesis: ent.tesis, sinif: ent.sinif,
          moduller: ent.moduller, kalici: ent.kalici, bakimBitis: ent.bakimBitis, verilis: ent.verilis, bayiId: ent.bayiId ?? null,
          // Ham beyan (v1 HAK taşımaz → alan yok); hesaplanan P `durum.odenmisTarih`te.
          ...(ent.cevrimdisiUfukGun === undefined ? {} : { cevrimdisiUfukGun: ent.cevrimdisiUfukGun }),
        }
      : null,
    kira: l
      ? {
          kiraId: l.kiraId, verilis: l.verilis, bitis: l.bitis, sunucuSaati: l.sunucuSaati, ekSureGun: l.ekSureGun, zorlama: l.zorlama,
          gecerlilikBitis: l.gecerlilikBitis, yaptirim: l.yaptirim, yoklamaAraligiDk: l.yoklamaAraligiDk, devredildi: l.devredildi, kanal: l.kanal,
          ...(l.odenmisTarih === undefined ? {} : { odenmisTarih: l.odenmisTarih }),
        }
      : null,
  };
}

function pollingSection(): LicenseDetail["yoklama"] {
  const poll = getPollStatus();
  const bell = getDoorbellStatus();
  const vendorUrl = getLicenseConfig().vendorUrl;
  return {
    saticiYapilandirildi: vendorUrl !== null,
    saticiAdresi: vendorUrl ? new URL(vendorUrl).host : null,
    sonDeneme: isoOrNull(poll.lastAttemptAt),
    sonBasari: isoOrNull(poll.lastSuccessAt),
    sonBasarisizlik: isoOrNull(poll.lastFailureAt),
    sonHataKodu: poll.lastFailureCode,
    sonrakiDeneme: isoOrNull(poll.nextAttemptAt),
    zil: {
      bagli: bell.connected,
      sonBaglanti: isoOrNull(bell.lastConnectedAt),
      sonZil: isoOrNull(bell.lastEventAt),
      sonKalpAtisi: isoOrNull(bell.lastHeartbeatAt),
      sonHataKodu: bell.lastErrorCode,
    },
  };
}

export function getLicenseDetail(): LicenseDetail {
  const store = getLicenseStore();
  const snap = getLicenseSnapshot();
  const facts = getLicenseDbFacts();
  return {
    hazir: snap.imzaHazir,
    durumHazir: snap.durumHazir,
    kurulum: {
      kurulumId: snap.licenseId,
      veritabaniKimligi: facts.installationId,
      anahtarKimligi: store?.key?.kid ?? null,
      etkin: snap.activated,
      ilkAcilis: isoOrNull(facts.firstOpenMs),
    },
    depo: {
      dizin: store?.dir ?? null,
      // Var olan ama okunamayan dosya da depo sorunudur (durum ÖLÇÜLEMEDİ sayar).
      sorun: store?.problem ?? (store?.unreadable.length ? "OKUNAMADI" : null),
      bozukAnahtarKenaraAlindi: Boolean(store?.setAsideKeyFile),
      durumKaydi: { gecerli: snap.durumKaydi.gecerli, sira: snap.durumKaydi.sira },
    },
    durum: stateSection(snap),
    ...documentSections(snap),
    parmakIzi: fingerprintSection(snap),
    yoklama: pollingSection(),
    tasima: store?.transfer ?? null,
    gozlem: peekObservationCounters(),
    proxy: getProxySettings(),
    butunluk: integritySection(snap),
    zincir: chainSection(snap),
  };
}

// ── İndirme belirteci (onaylı cihaz ya da kimlikli kullanıcı) ───────────────────
export interface LicenseDownloadToken {
  readonly yolOneki: string;
  readonly belirtec: string;
  readonly gecerlilikSonu: string | null;
}

/** Bu kadar süresi kalan belirteç yine verilir ama yoklama dürtülür (bir sonraki kiranın belirteci gelsin). */
export const DOWNLOAD_TOKEN_REFRESH_MARGIN_MS = 15 * 60 * 1000;

export type DownloadTokenDecision =
  | { readonly kind: "frozen" }
  | { readonly kind: "none"; readonly nudge: true }
  | { readonly kind: "ok"; readonly token: LicenseDownloadToken; readonly nudge: boolean };

/**
 * SAF karar: güncelleme donuksa (K1) hiç belirteç yok; önekteki saklı belirteç yoksa, süresi okunamıyorsa ya
 * da dolmuşsa verilmez ve yoklama dürtülür; dolmaya yakınsa verilir ve yoklama dürtülür.
 */
export function decideDownloadToken(g: {
  readonly updatesAllowed: boolean;
  readonly prefix: string | null;
  readonly tokens: ReadonlyArray<{ yolOneki: string; belirtec: string }>;
  readonly nowMs: number;
}): DownloadTokenDecision {
  if (!g.updatesAllowed) return { kind: "frozen" };
  const token = g.prefix ? g.tokens.find((t) => t.yolOneki === g.prefix) : undefined;
  if (!token) return { kind: "none", nudge: true };
  const payload = parseJws(token.belirtec);
  const exp = payload.ok && typeof payload.value.payload.exp === "string" ? payload.value.payload.exp : null;
  const expMs = exp === null ? Number.NaN : Date.parse(exp);
  if (!Number.isFinite(expMs) || expMs <= g.nowMs) return { kind: "none", nudge: true };
  return { kind: "ok", token: { yolOneki: token.yolOneki, belirtec: token.belirtec, gecerlilikSonu: exp }, nudge: expMs - g.nowMs < DOWNLOAD_TOKEN_REFRESH_MARGIN_MS };
}

export function getDownloadToken(g: { urun: DownloadProduct; kanal?: string | null }): LicenseDownloadToken {
  const snap = getLicenseSnapshot();
  const kanal = g.kanal ?? snap.lease?.document.kanal.kod ?? null;
  const d = decideDownloadToken({
    updatesAllowed: snap.state.uygulanan.guncellemeIzni,
    prefix: kanal ? `/${kanal}/${g.urun}/` : null,
    tokens: getDownloadTokens(),
    nowMs: Date.now(),
  });
  if (d.kind === "frozen") throw licenseError(403, "LICENSE_UPDATES_FROZEN", "Bu kurulum için güncelleme dondurulmuş.");
  if (d.nudge) requestDownloadTokenRefresh();
  if (d.kind === "none") {
    throw licenseError(404, "LICENSE_DOWNLOAD_TOKEN_UNAVAILABLE", "İndirme belirteci yok (kurulum etkin değil ya da yoklama bekleniyor).");
  }
  return d.token;
}

// ── Proxy okuması ───────────────────────────────────────────────────────────────
export interface LicenseProxySettings {
  readonly kaynak: ProxySource;
  /** Kimlik bilgisi maskeli (`http://***@sunucu:port`). */
  readonly adres: string | null;
  readonly atla: string | null;
  /** Bu Node sürümü yerleşik proxy desteği taşıyor mu (22.21+ / 24.5+). */
  readonly destekleniyor: boolean;
}

export function getProxySettings(): LicenseProxySettings {
  const p = effectiveProxy();
  return { kaynak: p.kaynak, adres: maskProxyUrl(p.adres), atla: p.atla, destekleniyor: nodeSupportsProxyEnv() };
}
