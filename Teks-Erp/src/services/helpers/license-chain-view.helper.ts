// Lisans ayrıntısının `zincir` bölümü (G4): HAK imzacısı (+ ara ise gömülü sertifikası), kiranın ALT sertifikası ve iptal
// belgesinin hâli. Salt-okunur; karar vermez — belgeler zaten çekirdekte doğrulanmıştır, burada yalnız ekrana taşınır.
import { CertificateSchema, parseJws, type EntitlementSignerKind, type LicenseClass } from "../../lib/license/protocol";
import type { LicenseSnapshot } from "../../lib/license/runtime";

export interface SignerCertificateView {
  readonly sertifikaId: string;
  readonly siniflar: readonly LicenseClass[];
  readonly baslangic: string;
  readonly bitis: string;
}

export interface LicenseChainView {
  readonly hakImzacisi: {
    readonly kind: EntitlementSignerKind;
    readonly kid: string;
    readonly rootKid: string;
    /** Yalnız ARA imzacıda: gömülü HAK sertifikasının künyesi. */
    readonly sertifika: SignerCertificateView | null;
  } | null;
  readonly kiraAlt: { readonly kid: string; readonly baslangic: string; readonly bitis: string } | null;
  readonly iptal: {
    readonly sira: number | null;
    readonly verilis: string | null;
    readonly kayitSayisi: number | null;
    /** Durum kaydı kopyalarının iptal pini (görülen en yüksek sıra). */
    readonly pin: number | null;
    /** GUNCEL: elde belge var ve gereken sırada · KAYIP: gereken sıradan düşük/yok · YOK: belge yok, gerekmiyor. */
    readonly durum: "GUNCEL" | "KAYIP" | "YOK";
  };
}

function embeddedCertificate(token: string | undefined): SignerCertificateView | null {
  if (!token) return null;
  const p = parseJws(token);
  const c = p.ok ? CertificateSchema.safeParse(p.value.payload) : null;
  if (!c?.success) return null;
  return { sertifikaId: c.data.sertifikaId, siniflar: c.data.siniflar, baslangic: c.data.baslangic, bitis: c.data.bitis };
}

export function chainSection(snap: LicenseSnapshot): LicenseChainView {
  const e = snap.entitlement;
  const alt = snap.lease?.subCertificate.document ?? null;
  const belge = snap.iptal.belge?.view.document ?? null;
  const kayip = snap.state.nedenler.some((n) => n.kod === "IPTAL_BELGESI_KAYIP");
  return {
    hakImzacisi: e
      ? {
          kind: e.signer.kind,
          kid: e.signer.kid,
          rootKid: e.signer.rootKid,
          sertifika: e.signer.kind === "ARA" ? embeddedCertificate(e.document.imzaciSertifikasi) : null,
        }
      : null,
    kiraAlt: alt ? { kid: alt.kid, baslangic: alt.baslangic, bitis: alt.bitis } : null,
    iptal: {
      sira: belge?.sira ?? null,
      verilis: belge?.verilis ?? null,
      kayitSayisi: belge ? belge.iptaller.length : null,
      pin: snap.iptal.pin,
      durum: kayip ? "KAYIP" : belge ? "GUNCEL" : "YOK",
    },
  };
}
