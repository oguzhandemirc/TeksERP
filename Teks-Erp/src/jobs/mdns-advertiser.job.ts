// =============================================================================
// mDNS / DNS-SD servis ilanı (2026-08-26)
// =============================================================================
// NEDEN VAR: yeni kurulan bir Electron paneli sunucunun IP'sini bilmiyor ve
// birinin elle yazması gerekiyordu. Sunucu kendini ağa ilan ederse istemci onu
// anında bulur — kimse adres yazmaz.
//
// ⚠️ FAIL-OPEN PAZARLIK DIŞI. Üç ayrı yol sunucuyu düşürebilirdi, üçü de kapalı:
//
//  1) MODÜL YÜKLENEMEZSE: `require` tembel ve try/catch içinde. (Aynı desen
//     Electron'daki `scanner.ipc.ts` seri port yüklemesinde kullanılıyor.)
//  2) BIND HATASI (EADDRINUSE): Windows'ta 5353 portunu Apple Bonjour Service,
//     Adobe ya da Windows'un kendi mDNS yanıtlayıcısı tutuyor olabilir. Bu hata
//     `throw` olarak DEĞİL soketin `error` OLAYI olarak gelir ve yakalanmazsa
//     süreci düşürür. ⚠️ Ölçüldü (bonjour-service 1.4.4,
//     `dist/lib/mdns-server.js:16`): errorCallback verilmezse varsayılan davranış
//     `function (err) { throw err; }`. Yani `new Bonjour(opts, cb)`'deki İKİNCİ
//     PARAMETRE bu modülün tüm fail-open sözünü tek başına taşıyor — SİLME.
//  3) İlan/durdurma sırasındaki her çağrı ayrıca try/catch içinde.
//
// Her arıza "ilan kapalı"ya iner, TEK satır uyarı loglar ve HTTP sunucusuna
// dokunmaz. mDNS'in hiç çalışmaması ölümcül değildir: istemcide alt ağ taraması
// yedeği var ve o hiçbir multicast filtresine takılmaz.
//
// ⚠️ BAYRAK env'dir (`DISCOVERY_MDNS_ENABLED`), feature-flag DEĞİL. Üç sebep:
// (a) ilan boot'ta, flag cache/DB hazır olmadan koşar; (b) bu `HOST`/`PORT` ile
// aynı sınıf bir TAŞIMA ayarı — vardiya ortasında panelden değiştirilecek bir
// tercih değil; (c) dört kapı ceremonisi (SETTING_KEYS + FeatureFlags + Zod +
// Electron paneli) bunun için israf olur ve bekçiye dört yeni yüzey açardı.
// Emsal: `backup-scheduler.ts` → `BACKUP_SCHEDULE_ENABLED`.
// =============================================================================

import os from "os";
import { APP_VERSION } from "../lib/app-version";
import { buildAdvertisedTxt, type AdvertisedTxt } from "../lib/discovery-txt";
import { whenIdentityReady } from "./installation-identity.job";
import { DISCOVERY_VERSION, buildDiscoveryIdentity } from "../services/discovery.service";

/** İlan edilen servis tipi → ağda `_teks-erp._tcp.local` olarak görünür. */
export const MDNS_SERVICE_TYPE = "teks-erp";

/** Kimlik için beklenecek üst süre. Dolarsa ilan KİMLİKSİZ yapılır, sonra tazelenir. */
const IDENTITY_WAIT_MS = 10_000;

/** `stopMdnsAdvertiser` iç kapı — goodbye paketleri bunu aşamaz. */
const STOP_CAP_MS = 1_000;

export interface MdnsState {
    active: boolean;
    reason: "ok" | "disabled" | "module-missing" | "bind-error" | "not-started";
    error: string | null;
    serviceName: string | null;
    startedAt: string | null;
}

let state: MdnsState = {
    active: false,
    reason: "not-started",
    error: null,
    serviceName: null,
    startedAt: null,
};

// Tip yalnız yapısal — paketi statik import ETMİYORUZ (tembel yükleme şartı).
interface BonjourLike {
    publish(opts: {
        name: string;
        type: string;
        port: number;
        txt?: Record<string, string>;
    }): { updateTxt?: (txt: Record<string, string>) => void };
    unpublishAll(cb?: () => void): void;
    destroy(cb?: () => void): void;
}

let instance: BonjourLike | null = null;
let published: { updateTxt?: (txt: Record<string, string>) => void } | null = null;

/** Durum kopyası — `buildRichHealth` bunu basar (operasyonel iç durum ORAYA ait). */
export function getMdnsState(): MdnsState {
    return { ...state };
}

function setState(patch: Partial<MdnsState>): void {
    state = { ...state, ...patch };
}

/** Varsayılan yükleyici — tembel `require`. Test DI ile bunu değiştirir. */
function defaultLoader(): unknown {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("bonjour-service");
}

export interface StartMdnsOptions {
    /** TEST İÇİN: gerçek soket açmadan yükleme hatasını/başarısını sınamak. */
    loader?: () => unknown;
    port?: number;
    identityWaitMs?: number;
}

/**
 * İlanı başlatır. ASLA reject etmez ve ASLA throw etmez — en kötü ihtimalle
 * `active:false` bir durum döner.
 */
export async function startMdnsAdvertiser(opts: StartMdnsOptions = {}): Promise<MdnsState> {
    if (process.env.DISCOVERY_MDNS_ENABLED === "false") {
        setState({ active: false, reason: "disabled", error: null });
        console.log("[mdns] servis ilanı KAPALI (DISCOVERY_MDNS_ENABLED=false)");
        return getMdnsState();
    }
    if (state.active) return getMdnsState();

    const port = opts.port ?? (Number(process.env.PORT) || 4000);

    // --- 1) Modülü tembel yükle -------------------------------------------
    let BonjourCtor: new (o: unknown, cb: (err: unknown) => void) => BonjourLike;
    try {
        const mod = (opts.loader ?? defaultLoader)() as
            | { Bonjour?: unknown; default?: unknown }
            | unknown;
        const candidate =
            (mod as { Bonjour?: unknown })?.Bonjour ??
            (mod as { default?: unknown })?.default ??
            mod;
        if (typeof candidate !== "function") throw new Error("Bonjour sınıfı bulunamadı");
        BonjourCtor = candidate as typeof BonjourCtor;
    } catch (err) {
        setState({
            active: false,
            reason: "module-missing",
            error: err instanceof Error ? err.message : String(err),
        });
        console.warn("[mdns] servis ilanı yüklenemedi, keşif yalnız tarama ile çalışacak:", state.error);
        return getMdnsState();
    }

    // --- 2) Kimliği bekle (kaçırsa da ilan yapılır) ------------------------
    const identity = await whenIdentityReady(opts.identityWaitMs ?? IDENTITY_WAIT_MS);

    // --- 3) İlanı kur ------------------------------------------------------
    // ⚠️ İLAN ADI BENZERSİZ OLMAK ZORUNDA. mDNS'te aynı adla iki servis
    // yayınlanırsa İKİNCİSİ SESSİZCE KAYBOLUR (ölçüldü 2026-08-26: aynı makinede
    // 4000 ve 4100 portlarında iki sunucu koşarken `dns-sd -B` yalnız birini
    // gösterdi). Üretimde makine başına tek sunucu var, ama varsayılan-dışı
    // porttaki bir ikinci örnek (test/geçiş kurulumu) böyle görünmez olurdu.
    // Varsayılan portta ad temiz kalır; ancak farklı portta port eklenir.
    const serviceName =
        port === 4000 ? `TeksERP ${os.hostname()}` : `TeksERP ${os.hostname()}:${port}`;
    try {
        // ⚠️ İKİNCİ PARAMETRE LOAD-BEARING — yukarıdaki 2. maddeyi oku.
        instance = new BonjourCtor({}, (err: unknown) => {
            setState({
                active: false,
                reason: "bind-error",
                error: err instanceof Error ? err.message : String(err),
            });
            console.warn(
                "[mdns] servis ilanı durdu (port 5353 başka bir uygulamada olabilir — " +
                "Windows'ta Apple Bonjour Service / Adobe). Keşif yalnız tarama ile çalışacak:",
                state.error,
            );
        });

        const txt = makeTxt(identity?.installationId ?? null);
        published = instance.publish({
            name: serviceName,
            type: MDNS_SERVICE_TYPE,
            port,
            txt: txt as unknown as Record<string, string>,
        });

        setState({
            active: true,
            reason: "ok",
            error: null,
            serviceName,
            startedAt: new Date().toISOString(),
        });
        console.log(`[mdns] servis ilan edildi: ${serviceName} → _${MDNS_SERVICE_TYPE}._tcp:${port}`);

        // Kimlik geç geldiyse TXT'yi bir kez tazele — ilanı yeniden kurmaya değmez.
        if (!identity) void refreshTxtWhenIdentityArrives();
    } catch (err) {
        setState({
            active: false,
            reason: "bind-error",
            error: err instanceof Error ? err.message : String(err),
        });
        console.warn("[mdns] servis ilanı kurulamadı, keşif yalnız tarama ile çalışacak:", state.error);
    }

    return getMdnsState();
}

function makeTxt(installationId: string | null): AdvertisedTxt {
    // Firma adı TXT'ye GİRER: çok adaylı seçicide ana ayırt edici alan odur ve
    // istemcinin HTTP probu atmadan ön eleme yapabilmesi bütün noktası. Kaynak
    // `buildDiscoveryIdentity` — kimlik ucuyla TEK kaynaktan beslenir, yoksa
    // "mDNS bir firma adı söylüyor, HTTP başka birini" ayrışması doğar.
    // DB geç gelirse varsayılan firma adı basılır (boş string ASLA).
    const live = buildDiscoveryIdentity();
    return buildAdvertisedTxt({
        discoveryVersion: DISCOVERY_VERSION,
        installationId,
        serverName: os.hostname(),
        companyName: live.companyName,
        version: APP_VERSION,
        apiBasePath: "/api",
    });
}

/** Kimlik geç gelirse TXT'yi bir kez günceller. Hata yutulur. */
async function refreshTxtWhenIdentityArrives(): Promise<void> {
    try {
        const late = await whenIdentityReady(60_000);
        if (!late || !published?.updateTxt) return;
        published.updateTxt(makeTxt(late.installationId) as unknown as Record<string, string>);
    } catch {
        /* best-effort */
    }
}

/**
 * İlanı kaldırır ve "goodbye" (TTL=0) paketlerini yollar ki istemciler ölü
 * kaydı 120 sn taşımasın.
 *
 * ⚠️ ASLA reject etmez ve en fazla `STOP_CAP_MS` sürer. Kapanış yolunda
 * (`server.ts` gracefulShutdown) 5 sn'lik zorla-çıkış sayacı işliyor; burada
 * asılı kalmak fabrikayı kapanamayan bir süreçle bırakırdı.
 *
 * ⚠️ Windows'ta bu yola giden TEK kapı `server.ts`'teki `process.on("message")`
 * dinleyicisidir (pm2 gerçek sinyal göndermez). Hard-kill / elektrik kesintisinde
 * goodbye gitmez — bu yüzden istemci tarafında HTTP doğrulaması pazarlık dışı:
 * keşif sonucuna tek başına ASLA güvenilmez.
 */
export async function stopMdnsAdvertiser(): Promise<void> {
    const inst = instance;
    instance = null;
    published = null;
    if (!inst) {
        setState({ active: false });
        return;
    }
    await new Promise<void>((resolve) => {
        let done = false;
        const finish = (): void => {
            if (done) return;
            done = true;
            resolve();
        };
        setTimeout(finish, STOP_CAP_MS).unref();
        try {
            inst.unpublishAll(() => {
                try {
                    inst.destroy(finish);
                } catch {
                    finish();
                }
            });
        } catch {
            finish();
        }
    });
    setState({ active: false, reason: "not-started", serviceName: null, startedAt: null });
}

/** Test-only. */
export function __resetMdnsStateForTests(): void {
    instance = null;
    published = null;
    state = {
        active: false,
        reason: "not-started",
        error: null,
        serviceName: null,
        startedAt: null,
    };
}
