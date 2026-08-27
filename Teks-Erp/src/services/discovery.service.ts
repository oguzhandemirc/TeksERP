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

import os from "os";
import prisma from "../lib/prisma";
import { APP_VERSION } from "../lib/app-version";
import { SETTING_KEYS, DEFAULT_COMPANY_NAME } from "./system-setting.service";
import { getCachedInstallationIdentity } from "../jobs/installation-identity.job";

/** Keşif sözleşmesinin sürümü. İstemci buna bakıp dallanır (ikinci bir 404 probu atmadan). */
export const DISCOVERY_VERSION = 1;

/** TXT kaydına ve JSON yüküne giren firma adı üst sınırı (mDNS TXT bütçesi). */
const COMPANY_NAME_MAX = 63;

export interface DiscoveryIdentityPayload {
    product: "TeksERP";
    discoveryVersion: number;
    /** Kurulum kimliği. null = boot'ta DB hazır değildi; istemci bunu UYUŞMAZLIK SAYMAZ. */
    installationId: string | null;
    /** Sunucu bilgisayarının ağdaki adı — "hangi kutu" sorusunun cevabı. */
    serverName: string;
    /** Firmanın adı — çok adaylı seçicide ANA ayırt edici alan. */
    companyName: string;
    version: string;
    protocol: "http";
    apiPort: number;
    apiBasePath: "/api";
    time: string;
}

/** Bellekteki firma adı. `refreshDiscoveryCache` tazeler; DB'ye ASLA istek anında gidilmez. */
let cachedCompanyName = DEFAULT_COMPANY_NAME;
let cachedPort = Number(process.env.PORT) || 4000;

/**
 * Kimlik yükünü kurar. SENKRON ve DB'siz — bu iki özellik sözleşmenin parçasıdır,
 * bekçi (`scripts/test_discovery_identity.ts`) ikisini de ölçer. Buraya `await`
 * ekleyen bir değişiklik yukarıdaki 1. kuralı sessizce iptal eder.
 */
export function buildDiscoveryIdentity(): DiscoveryIdentityPayload {
    const identity = getCachedInstallationIdentity();
    return {
        product: "TeksERP",
        discoveryVersion: DISCOVERY_VERSION,
        installationId: identity?.installationId ?? null,
        serverName: os.hostname(),
        companyName: cachedCompanyName,
        version: APP_VERSION,
        protocol: "http",
        apiPort: cachedPort,
        apiBasePath: "/api",
        time: new Date().toISOString(),
    };
}

/**
 * Firma adını DB'den tazeler. Boot'ta ve periyodik olarak çağrılır — istek
 * yolunda ASLA. Hata yutulur: keşif, firma adı bayat diye durmaz.
 */
export async function refreshDiscoveryCache(port?: number): Promise<void> {
    if (typeof port === "number" && Number.isFinite(port)) cachedPort = port;
    try {
        const row = await prisma.systemSetting.findUnique({
            where: { key: SETTING_KEYS.COMPANY_NAME },
        });
        const raw = row?.value;
        if (typeof raw === "string" && raw.trim()) {
            cachedCompanyName = raw.trim().slice(0, COMPANY_NAME_MAX);
        }
    } catch {
        /* best-effort — varsayılan/önceki ad kalır */
    }
}

/** Test-only: bellek durumunu sıfırlar. */
export function __resetDiscoveryCacheForTests(): void {
    cachedCompanyName = DEFAULT_COMPANY_NAME;
    cachedPort = Number(process.env.PORT) || 4000;
}
