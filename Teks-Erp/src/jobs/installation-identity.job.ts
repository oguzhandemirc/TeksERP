// =============================================================================
// Kurulum kimliği — boot-time üretim (2026-08-26)
// =============================================================================
// NEDEN VAR: istemciler (Electron paneli, ileride tabletler) sunucuyu ağda
// KENDİLERİ bulacak. Bulmak yetmez — bulduğunun DOĞRU sunucu olduğunu da
// söyleyebilmeli. Aksi halde ağa "ben TeksERP sunucusuyum" diyen ikinci bir
// makine (unutulmuş bir demo kurulumu ya da kötü niyetli biri) tabletleri
// kendine çekebilir ve operatör farkı anlamaz.
//
// Çözüm: her kurulumun bir kez üretilen, bir daha DEĞİŞMEYEN opak kimliği olur.
// Cihaz ilk başarılı girişten sonra bunu saklar; sonraki keşifte kimlik tutmazsa
// sessizce bağlanmaz, sorar.
//
// ⚠️ BU BİR SIR DEĞİLDİR. Aynı LAN'daki herkes `/api/discovery/identity` ile
// okuyabilir ve okuması gerekir (uç bilerek kimliksizdir — istemci daha giriş
// yapmamışken sunucuyu tanımak zorunda). İşi kimlik DOĞRULAMAK değil, FARKLI BİR
// KURULUMU TESPİT etmek. Gerçek yetki kontrolü JWT'dir; bunu bir güvenlik sınırı
// sanıp üstüne yetki inşa etme.
//
// ⚠️ `systemSettingService.set()` KULLANILAMAZ — o `userId` zorunlu kılar
// (`system-setting.service.ts`), burada kullanıcı yok (boot). Doğrudan Prisma'ya
// yazılır; `updatedById` şemada nullable.
//
// BEST-EFFORT: `permission-catalog.job.ts` deseninin birebir aynısı — gecikmeli
// başlar, sınırlı sayıda yeniden dener, TÜKENSE BİLE SUNUCUYU DÜŞÜRMEZ. Kimlik
// yazılamazsa keşif yine çalışır (uç `installationId: null` döner), yalnız
// "farklı kurulum" tespiti devre dışı kalır — özelliğin kaybı, sunucunun değil.
// =============================================================================

import { randomUUID } from "crypto";
import prisma from "../lib/prisma";
import { SETTING_KEYS } from "../services/system-setting.service";
import { AuditService } from "../services/audit.service";

// permission-catalog.job.ts ile aynı politika: mutlu yolda ~3sn, DB geç gelirse
// 3 + 4x15 = ~63sn'lik pencere.
const STARTUP_DELAY_MS = 3 * 1000;
const RETRY_DELAY_MS = 15 * 1000;
const MAX_ATTEMPTS = 5;

export interface InstallationIdentity {
    /** uuid v4 — kurulum başına sabit. */
    installationId: string;
    /** Kimliğin ilk üretildiği an (ISO). "Bu kurulum ne zaman doğdu" sorusu. */
    createdAt: string;
}

let started = false;
/** Senkron okuma için bellek kopyası — keşif ucu DB'ye DOKUNMAZ (bkz. discovery.service). */
let cached: InstallationIdentity | null = null;
/** `whenIdentityReady` bekleyenleri. Kimlik geldiğinde hepsi çözülür. */
let waiters: Array<(id: InstallationIdentity | null) => void> = [];

/** UUID v4 şekli — DB'den okunan değerin gerçekten kimlik olduğunu doğrular. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Ham JSON değerini kimliğe çözer; şekli bozuksa null (yeniden üretilecek). */
function parseStored(value: unknown): InstallationIdentity | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    const id = v.installationId;
    if (typeof id !== "string" || !UUID_V4.test(id)) return null;
    const createdAt = typeof v.createdAt === "string" ? v.createdAt : new Date().toISOString();
    return { installationId: id, createdAt };
}

function publish(identity: InstallationIdentity | null): void {
    if (identity) cached = identity;
    const pending = waiters;
    waiters = [];
    for (const w of pending) w(identity);
}

/**
 * Kimliği okur; yoksa BİR KEZ üretir. Var olan kimliği ASLA yeniden üretmez.
 *
 * Yarış güvenliği: iki process aynı anda boot ederse ikisi de `create` dener,
 * ikincisi `P2002` (key @id çakışması) alır ve o zaman birincinin yazdığını okur.
 * (`permission-catalog.job.ts`'in `skipDuplicates`'inin bu tablodaki karşılığı —
 * `SystemSetting.key` primary key olduğu için `createMany` gerekmiyor.)
 */
export async function ensureInstallationIdentity(): Promise<InstallationIdentity> {
    const key = SETTING_KEYS.SYSTEM_INSTALLATION_ID;

    const existing = await prisma.systemSetting.findUnique({ where: { key } });
    if (existing) {
        const parsed = parseStored(existing.value);
        if (parsed) {
            publish(parsed);
            return parsed;
        }
        // Değer var ama şekli bozuk (elle düzenleme / yarım yazım). Yenisini üret
        // ve İZ BIRAK — istemciler bunu "farklı kurulum" olarak görecek ve
        // kullanıcıya soracak; sebebi hiçbir yerde yazmıyorsa o soru gizemli kalır.
        const regenerated = await writeFresh(key);
        console.warn(
            `[installation-identity] kayıtlı değer BOZUKTU, yeni kimlik üretildi: ${regenerated.installationId}. ` +
            "İstemciler bunu farklı bir kurulum sanıp onay soracak.",
        );
        void AuditService.logEvent({
            category: "SYSTEM",
            action: "INSTALLATION_ID_REGENERATED",
            tableName: "system_settings",
            payload: { old: existing.value, new: regenerated.installationId },
        });
        publish(regenerated);
        return regenerated;
    }

    try {
        const created = await writeFresh(key);
        console.log(`[installation-identity] kurulum kimliği üretildi: ${created.installationId}`);
        void AuditService.logEvent({
            category: "SYSTEM",
            action: "INSTALLATION_ID_CREATED",
            tableName: "system_settings",
            payload: { installationId: created.installationId },
        });
        publish(created);
        return created;
    } catch (err) {
        // Yarış: başka bir process bizden önce yazdı. Onunkini oku — kendi
        // ürettiğimizi ZORLA yazmak, iki process'in kimliği birbirine ezdirmesi olurdu.
        if ((err as { code?: string }).code === "P2002") {
            const row = await prisma.systemSetting.findUnique({ where: { key } });
            const parsed = row ? parseStored(row.value) : null;
            if (parsed) {
                publish(parsed);
                return parsed;
            }
        }
        throw err;
    }
}

async function writeFresh(key: string): Promise<InstallationIdentity> {
    const identity: InstallationIdentity = {
        installationId: randomUUID(),
        createdAt: new Date().toISOString(),
    };
    await prisma.systemSetting.upsert({
        where: { key },
        create: {
            key,
            value: identity as unknown as object,
            description: "Bu kurulumun kalıcı kimliği (servis keşfi). Elle DEĞİŞTİRMEYİN.",
        },
        update: { value: identity as unknown as object },
    });
    return identity;
}

/**
 * Bellekteki kimlik — SENKRON, DB'ye dokunmaz. Kimlik ucu bunu kullanır
 * (bkz. `services/discovery.service.ts`: uç DB'siz olmak ZORUNDA, çünkü
 * Postgres düştüğünde bile istemci "sunucu yok" yerine "sunucu var" diyebilmeli).
 * Henüz üretilmediyse null.
 */
export function getCachedInstallationIdentity(): InstallationIdentity | null {
    return cached;
}

/**
 * Kimlik hazır olana kadar bekler (en fazla `capMs`). Süre dolarsa null döner —
 * ÇAĞIRAN BUNU TOLERE ETMEK ZORUNDA. mDNS ilanı bunu kullanır: kimlik geç
 * gelirse ilan kimliksiz yapılır, sonra tazelenir; ilanı hiç yapmamak daha kötü.
 */
export function whenIdentityReady(capMs: number): Promise<InstallationIdentity | null> {
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve) => {
        let done = false;
        const finish = (id: InstallationIdentity | null): void => {
            if (done) return;
            done = true;
            resolve(id);
        };
        waiters.push(finish);
        setTimeout(() => finish(cached), capMs).unref();
    });
}

/**
 * Açılışta BİR KEZ koşar. Hata sunucuyu düşürmez; sınırlı sayıda yeniden dener,
 * tükenirse gürültülü loglar ve bekleyenleri null ile çözer (sonsuza dek asılı
 * kalan bir `whenIdentityReady` mDNS ilanını hiç başlatmazdı).
 */
export function startInstallationIdentity(): void {
    if (started) return;
    started = true;

    const attempt = (n: number): void => {
        void ensureInstallationIdentity().catch((err) => {
            if (n < MAX_ATTEMPTS) {
                console.warn(
                    `[installation-identity] deneme ${n}/${MAX_ATTEMPTS} başarısız (DB hazır olmayabilir), ` +
                    `${RETRY_DELAY_MS / 1000}sn sonra tekrar denenecek:`,
                    err instanceof Error ? err.message : err,
                );
                setTimeout(() => attempt(n + 1), RETRY_DELAY_MS).unref();
                return;
            }
            console.error(
                `[installation-identity] KİMLİK ÜRETİLEMEDİ (${MAX_ATTEMPTS} deneme). ` +
                "Servis keşfi çalışmaya devam eder ama istemciler sunucunun kimliğini " +
                "doğrulayamaz (farklı kurulum tespiti devre dışı).",
                err,
            );
            publish(null);
        });
    };

    setTimeout(() => attempt(1), STARTUP_DELAY_MS).unref();
}

/** Test-only: modül durumunu sıfırlar. */
export function __resetInstallationIdentityForTests(): void {
    started = false;
    cached = null;
    waiters = [];
}
