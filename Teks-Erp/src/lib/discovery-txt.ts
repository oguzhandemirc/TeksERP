// =============================================================================
// mDNS ilanının TXT kaydı — saf kurucu (2026-08-26)
// =============================================================================
// TXT, istemcinin sunucuyu HTTP'ye hiç gitmeden ön-eleyebilmesi içindir: ağda
// iki TeksERP varsa hangisinin hangi firma olduğunu buradan görür ve yalnız
// makul adaya prob atar.
//
// ⚠️ BOYUT SINIRI GERÇEK: DNS TXT kaydı sınırsız değildir ve tek bir UDP
// paketine sığması beklenir. Uzun bir firma adı (fabrika panelden 120 karaktere
// kadar yazabilir) ilanı bozabilir. Bu yüzden kurucu KIRPAR — asla throw etmez:
// ilanın hiç yapılmaması, firma adının kısalmasından çok daha kötü.
//
// Alan adları KISA (v/iid/name/co/ver/path) çünkü TXT bütçesi anahtar adlarını
// da sayar; JSON kimlik ucundaki uzun adlarla bilinçli olarak ayrışır.
// =============================================================================

export interface AdvertisedTxt {
    /** Keşif sözleşme sürümü (metin — TXT değerleri metindir). */
    v: string;
    /** Kurulum kimliği. Kimlik henüz üretilmediyse alan HİÇ konmaz (boş string değil). */
    iid?: string;
    /** Sunucu bilgisayarının adı. */
    name: string;
    /** Firma adı. */
    co: string;
    /** Uygulama sürümü. */
    ver: string;
    /** API taban yolu. */
    path: string;
}

/** Tek UDP paketinde rahat taşınan güvenli üst sınır. */
export const TXT_BUDGET_BYTES = 400;

/** TXT kaydının kodlanmış yaklaşık boyutu (anahtar=değer çiftleri + uzunluk baytları). */
export function encodedTxtLength(txt: AdvertisedTxt): number {
    return Object.entries(txt).reduce((sum, [k, val]) => {
        if (val === undefined) return sum;
        // Her çift: 1 uzunluk baytı + "anahtar=değer" (UTF-8).
        return sum + 1 + Buffer.byteLength(`${k}=${String(val)}`, "utf8");
    }, 0);
}

export interface BuildTxtInput {
    discoveryVersion: number;
    installationId: string | null;
    serverName: string;
    companyName: string;
    version: string;
    apiBasePath: string;
}

/**
 * TXT kaydını kurar ve bütçeye SIĞDIRIR. Sığdırma sırası bilinçli: önce firma
 * adı kısalır (kozmetik), sunucu adı ve kimlik en sona bırakılır (ayırt edici).
 * Hiçbir girdi throw ettirmez.
 */
export function buildAdvertisedTxt(input: BuildTxtInput): AdvertisedTxt {
    const txt: AdvertisedTxt = {
        v: String(input.discoveryVersion),
        name: input.serverName,
        co: input.companyName,
        ver: input.version,
        path: input.apiBasePath,
    };
    // Kimlik yoksa alanı HİÇ koyma. Boş string koymak, istemci tarafında
    // "kimlik var ama boş" ile "kimlik yok" ayrımını kaybettirirdi.
    if (input.installationId) txt.iid = input.installationId;

    // Bütçeyi aşarsa firma adını kırp (en uzun ve en az kritik alan).
    while (encodedTxtLength(txt) > TXT_BUDGET_BYTES && txt.co.length > 8) {
        txt.co = txt.co.slice(0, Math.max(8, txt.co.length - 16));
    }
    // Hâlâ aşıyorsa sunucu adını da kırp (aşırı uzun hostname).
    while (encodedTxtLength(txt) > TXT_BUDGET_BYTES && txt.name.length > 8) {
        txt.name = txt.name.slice(0, Math.max(8, txt.name.length - 16));
    }
    return txt;
}
