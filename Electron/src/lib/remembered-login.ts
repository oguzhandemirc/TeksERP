/**
 * GİRİŞTE SON KULLANICI — cihazda tutulan "en son giren hesap" kaydı (ayar `auth.rememberLastUser`).
 *
 * YALNIZ kullanıcı adı + görünen ad saklanır: parola, token, izin, kimlik no ASLA. Depo
 * `secureStore` (Electron: şifreli electron-store; web: localStorage). Kayıt SUNUCU başına
 * anahtarlanır — masaüstü başka fabrikanın sunucusuna bağlanınca o kullanıcı görünmez.
 * Bozuk/okunamayan kayıt "yok" sayılır; depo hatası girişi asla durdurmaz.
 */
import { secureStore } from "@/lib/secure-store";
import { getActiveApiBaseUrl } from "@/lib/api-config";

export interface RememberedLogin {
  username: string;
  displayName: string | null;
}

export const REMEMBERED_LOGIN_STORE_KEY = "login.rememberedUser";
/** Sunucu başına tek kayıt; tavan, bağlanılmış sunucu sayısının kaydı şişirmemesi için. */
const MAX_SERVERS = 10;

type RememberedMap = Record<string, RememberedLogin>;

function serverKey(): string {
  try {
    return getActiveApiBaseUrl() || "default";
  } catch {
    return "default";
  }
}

function isEntry(v: unknown): v is RememberedLogin {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.username === "string" &&
    o.username.trim().length > 0 &&
    (o.displayName === null || typeof o.displayName === "string")
  );
}

async function readMap(): Promise<RememberedMap> {
  try {
    const raw = await secureStore.get(REMEMBERED_LOGIN_STORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: RememberedMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isEntry(v)) out[k] = { username: v.username, displayName: v.displayName };
    }
    return out;
  } catch {
    return {};
  }
}

async function writeMap(map: RememberedMap): Promise<void> {
  try {
    if (Object.keys(map).length === 0) await secureStore.delete(REMEMBERED_LOGIN_STORE_KEY);
    else await secureStore.set(REMEMBERED_LOGIN_STORE_KEY, JSON.stringify(map));
  } catch {
    /* depo yazılamadı — hatırlama yalnız kolaylıktır, giriş etkilenmez */
  }
}

/** Bu sunucu için hatırlanan hesap (yoksa null). */
export async function readRememberedLogin(): Promise<RememberedLogin | null> {
  return (await readMap())[serverKey()] ?? null;
}

/** Bu sunucunun kaydını yazar — yalnız iki ad alanı, başka hiçbir şey. */
export async function writeRememberedLogin(entry: RememberedLogin): Promise<void> {
  const username = entry.username.trim();
  if (!username) return;
  const displayName = entry.displayName?.trim() || null;
  const key = serverKey();
  const map = await readMap();
  delete map[key];
  const kept = Object.entries(map).slice(-(MAX_SERVERS - 1));
  await writeMap({ ...Object.fromEntries(kept), [key]: { username, displayName } });
}

/** Bu sunucunun kaydını siler ("Bu hesabı unut" ya da ayar kapalı). */
export async function forgetRememberedLogin(): Promise<void> {
  const key = serverKey();
  const map = await readMap();
  if (!(key in map)) return;
  delete map[key];
  await writeMap(map);
}
