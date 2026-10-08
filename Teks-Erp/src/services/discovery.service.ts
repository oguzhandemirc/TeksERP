// =============================================================================
// Servis keşfi — sunucu kimliği (2026-08-26)
// =============================================================================
// İstemciler (Electron paneli; ileride tabletler) sunucuyu ağda kendileri bulur.
// Bulduktan sonra "bu gerçekten benim sunucum mu" sorusunu soracakları yer burası.
//
// ÜÇ TASARIM KURALI — üçü de load-bearing:
//
// 1) UÇ DB'YE DOKUNMAZ. Yük tamamen bellekten kurulur. Sebep iki katlı:
//    (a) backend'de rate limiter YOK ve alt ağ taraması yapan istemciler bu ucu
//        sık çağıracak — her çağrının bir sorgu açması kabul edilemez;
//    (b) Postgres düştüğünde bile keşif ÇALIŞMALI ki istemci "sunucu yok" yerine
//        "sunucu var, veritabanı kapalı" diyebilsin. `/health`in `SELECT 1`i
//        tam olarak bu ayrımı yapamaz.
//
// 2) `/health`E EKLENMEZ. O ucun alan kümesi DONDURULMUŞ (app.ts) ve dört
//    tüketicisi var (deploy/kur.ps1 Saglik, public/status.js, useServerClock,
//    Electron ApiEndpointDialog). Kimlik ne canlılık ne operasyonel iç durumdur —
//    üçüncü bir sınıf: kimliksiz keşif için tasarlanmış, minimal, DB'siz.
//
// 3) ALAN SEÇİMİ "sunucuya erişimi olmayan birine ne söyler" testinden geçer.
//    Buradaki her alan zaten aynı LAN'da açık (hostname NetBIOS/mDNS ile, firma
//    adı login ekranında, sürüm /health'te). LAN adres listesi, db durumu, havuz/
//    disk metrikleri, yedek dosya adları, presence sayıları BURAYA GİRMEZ —
//    onlar `buildRichHealth`in işi ve orası `admin:settings` arkasında.
// =============================================================================

import { APP_VERSION } from "../lib/app-version";
import { currentLicenseeName } from "../lib/license/licensee-name";
import { DEFAULT_COMPANY_NAME } from "../constants/company";
import { getCachedInstallationIdentity } from "../jobs/installation-identity.job";
import { getLanTlsAdvert, type LanTlsAdvert } from "../lib/lan-tls/listener";
import type { ForwardedView } from "../lib/forwarded-view";
import { SERVER_NAME_ENV, parseServerName, resolveServerName } from "../lib/server-name";
import { uyari } from "../lib/logger";

/** Keşif sözleşmesinin sürümü. İstemci buna bakıp dallanır (ikinci bir 404 probu atmadan). */
export const DISCOVERY_VERSION = 1;

/** TXT kaydına ve JSON yüküne giren firma adı üst sınırı (mDNS TXT bütçesi). */
const COMPANY_NAME_MAX = 63;

export interface DiscoveryIdentityPayload {
    product: "TeksERP";
    discoveryVersion: number;
    /** Kurulum kimliği. null = boot'ta DB hazır değildi; istemci bunu UYUŞMAZLIK SAYMAZ. */
    installationId: string | null;
    /** Sunucunun görünen adı — kurulumda verilen ad (TEKSERP_SUNUCU_ADI), yoksa makine adı. Yalnız görüntü; kimlik `installationId`. */
    serverName: string;
    /** Firmanın adı — çok adaylı seçicide ANA ayırt edici alan. Kaynak lisans (HAK `musteri.ad`), `company.name` DEĞİL. */
    companyName: string;
    /** Kurulum lisanslı mı; false iken `companyName` nötr ürün adıdır. */
    etkin: boolean;
    version: string;
    /** İstemcinin gördüğü şema: güvenilen vekil arkasında vekilin şeması, aksi halde "http". */
    protocol: "http" | "https";
    /** İstemcinin gördüğü port: güvenilen vekil arkasında vekilin portu, aksi halde API dinleme portu. */
    apiPort: number;
    apiBasePath: "/api";
    /** Fabrika ağı HTTPS dinleyicisi (LAN_TLS_MODE dual/required); null = yalnız HTTP ya da istek vekilden geldi
     *  (vekilin sertifikası bu parmak izi değildir, LAN portu vekilin adresinde yoktur). Parmak izi güven kaynağı DEĞİL. */
    tls: LanTlsAdvert | null;
    time: string;
}

let cachedPort = Number(process.env.PORT) || 4000;

/**
 * Kimlik yükünü kurar. SENKRON ve DB'siz — bu iki özellik sözleşmenin parçasıdır,
 * bekçi (`scripts/test_discovery_identity.ts`) ikisini de ölçer. Buraya `await`
 * ekleyen bir değişiklik yukarıdaki 1. kuralı sessizce iptal eder.
 */
export function buildDiscoveryIdentity(via: ForwardedView | null = null): DiscoveryIdentityPayload {
    const identity = getCachedInstallationIdentity();
    // Lisans adı bellekteki doğrulanmış HAK'tan okunur (DB'siz); HAK sonradan gelirse restart beklemez.
    const licensee = currentLicenseeName();
    return {
        product: "TeksERP",
        discoveryVersion: DISCOVERY_VERSION,
        installationId: identity?.installationId ?? null,
        serverName: resolveServerName(),
        companyName: (licensee ?? DEFAULT_COMPANY_NAME).slice(0, COMPANY_NAME_MAX),
        etkin: licensee !== null,
        version: APP_VERSION,
        protocol: via?.protocol ?? "http",
        apiPort: via?.port ?? cachedPort,
        apiBasePath: "/api",
        tls: via ? null : getLanTlsAdvert(),
        time: new Date().toISOString(),
    };
}

/** Portu belleğe alır. Boot'ta çağrılır — istek yolunda ASLA. Firma adı artık lisanstan, DB'den okunmaz. */
export function refreshDiscoveryCache(port?: number): void {
    if (typeof port === "number" && Number.isFinite(port)) cachedPort = port;
    const rawName = process.env[SERVER_NAME_ENV];
    if (rawName !== undefined && rawName.trim() !== "" && parseServerName(rawName) === null) {
        uyari("discovery", `${SERVER_NAME_ENV} geçersiz (en çok 63 karakter; harf, rakam, boşluk, . _ -) — makine adı kullanılıyor.`);
    }
}

/** Test-only: bellek durumunu sıfırlar. */
export function __resetDiscoveryCacheForTests(): void {
    cachedPort = Number(process.env.PORT) || 4000;
}
