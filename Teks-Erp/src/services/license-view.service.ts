// Lisans GÖRÜNÜMÜ: herkese açık durum özeti, yönetici ayrıntısı, proxy okuması ve indirme
// belirteci. Salt-okunur; belge içeriğinden yalnız ekranın gereksindiği alanlar çıkar.
// Yanıt tipleri panel (1d) ve tablet (1e) sözleşmesidir: docs/design/LISANS-PROTOKOLU.md §14.
import { APP_VERSION } from "../lib/app-version";
import { effectiveProxy, maskProxyUrl, nodeSupportsProxyEnv, type ProxySource } from "../lib/http-egress";
import {
  msToIso,
  parseJws,
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
  getMeasuredFingerprint,
  getPollStatus,
  peekObservationCounters,
  type LicenseSnapshot,
} from "../lib/license/runtime";
import type { Banner, LicenseEffect, StateReason } from "../lib/license/state";
import { licenseError } from "./helpers/license-wire.helper";

// ── Durum özeti (herkes) ────────────────────────────────────────────────────────
export interface LicenseStatusSummary {
  readonly ayrinti: true;
  readonly kip: LicenseMode;
  /** UYGULANAN kademe — gözlemde daima NORMAL (sıfır fark). */
  readonly kademe: StateTier;
  readonly bant: Banner | null;
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
    bant: s.uygulanan.bant,
    ekSureKalanGun: s.uygulananKademe === "EK_SURE" ? s.ekSureKalanGun : null,
    kisitlamaKalanGun: s.kip === "zorla" ? s.kisitlamaKalanGun : null,
    guncellemeIzni: s.uygulanan.guncellemeIzni,
    sinif: ent?.sinif ?? null,
    lisansNo: ent?.lisansNo ?? null,
    lisansSahibi: ent ? { musteri: ent.musteri.ad, tesis: ent.tesis.ad } : null,
    surum: APP_VERSION,
  };
}

// ── Ayrıntı (license:view) ──────────────────────────────────────────────────────
export interface LicenseDetail {
  readonly hazir: boolean;
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
  };
  readonly hak: (Omit<EntitlementDoc, "v" | "kurulumId" | "bayiSertifikasi" | "bayiId"> & { bayiId: string | null }) | null;
  readonly kira: Pick<
    LeaseDoc,
    "kiraId" | "verilis" | "bitis" | "sunucuSaati" | "ekSureGun" | "zorlama" | "gecerlilikBitis" | "yaptirim" | "yoklamaAraligiDk" | "devredildi" | "kanal"
  > | null;
  readonly parmakIzi: {
    olculdu: string | null;
    olculen: Readonly<Record<"f1" | "f2" | "f3" | "f4" | "f5", boolean>> | null;
    karar: MatchResult | null;
    eslesen: number | null;
    olculebilen: number | null;
    uyusmayan: readonly string[];
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
        }
      : null,
    kira: l
      ? {
          kiraId: l.kiraId, verilis: l.verilis, bitis: l.bitis, sunucuSaati: l.sunucuSaati, ekSureGun: l.ekSureGun, zorlama: l.zorlama,
          gecerlilikBitis: l.gecerlilikBitis, yaptirim: l.yaptirim, yoklamaAraligiDk: l.yoklamaAraligiDk, devredildi: l.devredildi, kanal: l.kanal,
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
  const fp = getMeasuredFingerprint();
  const d = snap.fingerprintDecision;
  return {
    hazir: snap.hazir,
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
    parmakIzi: {
      olculdu: fp?.measuredAt ?? null,
      olculen: fp?.measured ?? null,
      karar: d?.result ?? null,
      eslesen: d?.matched ?? null,
      olculebilen: d?.measurable ?? null,
      uyusmayan: d?.mismatched ?? [],
    },
    yoklama: pollingSection(),
    tasima: store?.transfer ?? null,
    gozlem: peekObservationCounters(),
    proxy: getProxySettings(),
  };
}

// ── İndirme belirteci (onaylı cihaz ya da kimlikli kullanıcı) ───────────────────
export interface LicenseDownloadToken {
  readonly yolOneki: string;
  readonly belirtec: string;
  readonly gecerlilikSonu: string | null;
}

export function getDownloadToken(g: { urun: "electron" | "mobil"; kanal?: string | null }): LicenseDownloadToken {
  const snap = getLicenseSnapshot();
  if (!snap.state.uygulanan.guncellemeIzni) {
    throw licenseError(403, "LICENSE_UPDATES_FROZEN", "Bu kurulum için güncelleme dondurulmuş.");
  }
  const kanal = g.kanal ?? snap.lease?.document.kanal.kod ?? null;
  const prefix = kanal ? `/${kanal}/${g.urun}/` : null;
  const token = prefix ? getDownloadTokens().find((t) => t.yolOneki === prefix) : undefined;
  if (!token) throw licenseError(404, "LICENSE_DOWNLOAD_TOKEN_UNAVAILABLE", "İndirme belirteci yok (kurulum etkin değil ya da yoklama bekleniyor).");
  const payload = parseJws(token.belirtec);
  const exp = payload.ok && typeof payload.value.payload.exp === "string" ? payload.value.payload.exp : null;
  return { yolOneki: token.yolOneki, belirtec: token.belirtec, gecerlilikSonu: exp };
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
