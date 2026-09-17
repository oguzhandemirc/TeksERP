/**
 * BU KURULUMUN KÜNYESİ — her isteğe eklenen `X-Client-*` başlıkları.
 *
 * Backend bunları yalnız Sistem → Bağlı İstemciler ekranı için toplar
 * (`Teks-Erp/src/lib/client-registry.ts`, süreç belleğinde).
 *
 * ⚠️ BİLGİLENDİRMEDİR, KİMLİK KANITI DEĞİL. Hiçbir sunucu kapısı bu başlıklara
 * bakmaz ve bakmamalıdır — bir istemci hepsini tek satır curl ile uydurabilir.
 *
 * ⚠️ `x-device-id` DEĞİL. Masaüstü panel o başlığı BİLEREK göndermez
 * (`services/apiClient.ts`): `devicePairingRequired` açıkken cihaz middleware'i
 * panelin tüm isteklerini 401 `DEVICE_INACTIVE` ile keserdi ve ayarı açan admin
 * kendi paneline giremezdi. Künye başlığı o kapıdan tamamen bağımsız.
 *
 * ⚠️ KİMLİK İÇİN İKİNCİ BİR DEĞER ÜRETİLMEZ: `lib/deviceId.ts`teki kalıcı
 * makine kimliği kullanılır. Panel onu `POST /api/devices/announce` ile ZATEN
 * bildiriyor, yani sunucuda bir `Device` satırı var — ekrandaki makine ADI
 * oradan (yöneticinin verdiği etiketten) çözülür, başlıktan değil.
 */
import { getOrCreateDeviceId } from "@/lib/deviceId";
import { IS_ELECTRON } from "@/lib/runtime-env";

export const CLIENT_INFO_HEADERS = {
  kind: "X-Client-Kind",
  version: "X-Client-Version",
  instance: "X-Client-Instance",
} as const;

/** Aynı kaynak koddan doğan iki hedef AYRI istemcilerdir (backend politikası da
 *  ikisini ayrı eksen sayar — `client-version-policy.ts`). */
export const CLIENT_KIND = IS_ELECTRON ? "electron" : "web";

/** Web build'inde sürüm derleme anında gömülür (`vite.config.web.ts` `define`, renderer `package.json`):
 *  web paneli backend paketiyle birlikte dağıtılır, başlıktaki değer Electron ile AYNI eksendir (panel sürümü). */
const WEB_VERSION: string | null = typeof __APP_VERSION__ === "string" && __APP_VERSION__ ? __APP_VERSION__ : null;

/** Sürümsüz istek için üst sınır: login İLK istektir, `Session.clientVersion` damgası ilk istekte dolsun;
 *  süre dolarsa istek başlıksız gider (sunucu sonraki istekte doldurur), asla düşmez. */
export const VERSION_WAIT_MS = 300;

/** Electron'da sürüm main process'ten gelir (`window.api.appInfo.version`) ve bir kez okunur. */
let versionCache: string | null = IS_ELECTRON ? null : WEB_VERSION;
let versionPromise: Promise<void> | null = null;

function ensureVersion(): Promise<void> | null {
  if (versionCache !== null) return null;
  if (versionPromise !== null) return versionPromise;
  const p = window.api?.appInfo?.version?.();
  if (!p) return null;
  versionPromise = p
    .then((v) => {
      if (typeof v === "string" && v) versionCache = v;
    })
    .catch(() => {
      /* künye best-effort — okunamazsa satır sürümsüz görünür */
    });
  return versionPromise;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * İstek başlıklarına künyeyi yazar. Hiçbir hatası isteği düşürmez.
 *
 * Sürüm henüz okunmadıysa en çok `VERSION_WAIT_MS` beklenir; dolmazsa istek sürümsüz gider —
 * sunucu defteri sürümü "yeni değer geldiğinde" günceller, ilk dolu değerde satır düzelir.
 */
export async function applyClientInfoHeaders(
  set: (name: string, value: string) => void,
): Promise<void> {
  try {
    const pending = ensureVersion();
    if (pending) await Promise.race([pending, sleep(VERSION_WAIT_MS)]);
    set(CLIENT_INFO_HEADERS.kind, CLIENT_KIND);
    if (versionCache) set(CLIENT_INFO_HEADERS.version, versionCache);
    const instanceId = await getOrCreateDeviceId();
    if (instanceId) set(CLIENT_INFO_HEADERS.instance, instanceId);
  } catch {
    /* künye başlıkları hiçbir koşulda isteği engellemez */
  }
}
