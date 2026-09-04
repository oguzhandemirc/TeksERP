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

/** Sürüm main process'ten gelir (`window.api.appInfo.version`) ve bir kez okunur.
 *  Web build'inde `window.api` yoktur → sürüm YOK ve bu doğrudur: web paneli
 *  backend paketiyle BİRLİKTE deploy edilir, ayrı bir sürüm ekseni taşımaz. */
let versionCache: string | null = null;
let versionPromise: Promise<void> | null = null;

function ensureVersion(): void {
  if (versionCache !== null || versionPromise !== null) return;
  const p = window.api?.appInfo?.version?.();
  if (!p) return;
  versionPromise = p
    .then((v) => {
      if (typeof v === "string" && v) versionCache = v;
    })
    .catch(() => {
      /* künye best-effort — okunamazsa satır sürümsüz görünür */
    });
}

/**
 * İstek başlıklarına künyeyi yazar. Hiçbir hatası isteği düşürmez.
 *
 * İlk birkaç istek sürümsüz gidebilir (main process okuması asenkron) — sunucu
 * defteri sürümü "yeni değer geldiğinde" günceller, yani ilk dolu değerde
 * satır düzelir ve bir daha null'a düşmez.
 */
export async function applyClientInfoHeaders(
  set: (name: string, value: string) => void,
): Promise<void> {
  try {
    ensureVersion();
    set(CLIENT_INFO_HEADERS.kind, CLIENT_KIND);
    if (versionCache) set(CLIENT_INFO_HEADERS.version, versionCache);
    const instanceId = await getOrCreateDeviceId();
    if (instanceId) set(CLIENT_INFO_HEADERS.instance, instanceId);
  } catch {
    /* künye başlıkları hiçbir koşulda isteği engellemez */
  }
}
