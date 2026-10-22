// Oturum bağlamı: belirteç (gizli depo) + tesis durumu (`GET /oturum`) + izinler. Çevrimdışıyken son
// oturum görüntüsü önbellekten gelir ve YAZMA kapalıdır. 401 → belirteç silinir, giriş ekranı.
// Çok tesis: tek bulut kimliği birden çok fabrikaya erişir; geçiş yeni belirteç + yeni kapsam alır, diğer tesisin
// önbelleği (ayrık kapsam) durur; çıkış ve yeni giriş bütün önbelleği siler.
// Tazelik (K1): öne gelince ve değişim akışında fabrika damgası değişince `refresh()`; "Son eşitleme" = fabrika
// veri anı (`esitleme.ufuk`, paketin ufku), bulutun alım anı değil. Belirteç yenileme ucu sunucuda yok — dokunulmaz.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, createClient, errorMessage } from "../api/client";
import { createApi, type Api } from "../api/endpoints";
import type { FacilityChoice, FacilityStatus, LoginResponse } from "../api/wire";
import { apiBaseUrl } from "../lib/config";
import { clearCache, createCache, openingCacheHygiene, type Cache } from "./cache";
import { createFeedFetcher, useChangeFeed, type FeedMode } from "./changes";
import { useForeground } from "./useForeground";
import { legacyPlainStore, plainStore, secretStore } from "./store";
import { applyServerFactoryTimezone } from "../lib/factory-time";

const TOKEN_KEY = "patron.belirtec";
const SCOPE_KEY = "patron.kapsam";
/** Son seçilen tesis — yalnız kimlik (veri değil); girişte ipucu olarak gider, çıkışta kalır. */
export const LAST_FACILITY_KEY = "patron.sonTesis";
export const SWITCH_DENIED = "TESIS_GECISI_YOK";

export type Phase = "yukleniyor" | "giris" | "hazir";

export interface SessionValue {
  readonly phase: Phase;
  readonly api: Api;
  readonly cache: Cache | null;
  readonly facility: FacilityStatus | null;
  /** Etkin tesis (kapsamdan); oturumsuzken null. */
  readonly facilityId: string | null;
  /** Erişilebilen tesisler; eski sunucu listeyi vermezse yalnız etkin tesis. */
  readonly facilities: readonly FacilityChoice[];
  /** Son tesis geçişinin Türkçe hata iletisi (başarılı geçiş ya da yeni girişte silinir). */
  readonly switchError: string | null;
  readonly permissions: readonly string[];
  readonly offline: boolean;
  readonly offlineSince: string | null;
  /** Fabrika veri anı: son kabul edilen paketin ufku (`esitleme.ufuk`); eşitleme yoksa null. */
  readonly factoryStamp: string | null;
  /** Değişim akışı kipi: uzun yoklama · eski sunucu 60 sn yoklama · kapalı (arka plan / oturumsuz). */
  readonly feedMode: FeedMode;
  readonly configured: boolean;
  markOnline(online: boolean, savedAt?: string): void;
  login(b: { eposta: string; parola: string; totp: string }): Promise<void>;
  logout(): Promise<void>;
  /** `GET /oturum` yeniden okunur (uçuştayken ikinci çağrı aynı sözü alır); oturumsuzken null. */
  refresh(): Promise<FacilityStatus | null>;
  /** Başka tesise geç; reddedilirse `false` ve `switchError` dolar, etkin tesis değişmez. */
  switchFacility(tesisId: string): Promise<boolean>;
}

const Ctx = createContext<SessionValue | null>(null);

/**
 * Tesisin saat dilimi DÖNEMLERİ (ANLIK `tesis` → `tabanDilim` + `donemler`): her an kendi dönemindeki dilimle
 * basılır (geçmiş kayıtlar kaymaz), telefonun diliminden değil. Eski fabrika paketi yalnız `saatDilimi` taşır →
 * tek dilim. Best-effort — projeksiyon henüz yoksa varsayılan dilim kalır.
 */
async function loadFacilityTimezone(c: Cache, api: Api): Promise<void> {
  try {
    const r = await c.load("anlik:tesis", () => api.snapshot("tesis"));
    const veri = r.data.veri as { saatDilimi?: unknown; tabanDilim?: unknown; donemler?: unknown } | null;
    const donemler = Array.isArray(veri?.donemler)
      ? (veri.donemler as Array<{ gecerliBaslangic?: unknown; saatDilimi?: unknown } | null>).map((d) => ({
          validFrom: d?.gecerliBaslangic,
          timeZone: d?.saatDilimi,
        }))
      : undefined;
    applyServerFactoryTimezone({ factoryTimezone: veri?.saatDilimi, factoryTimezoneBase: veri?.tabanDilim, factoryTimezonePeriods: donemler });
  } catch {
    // Dilim okunamadı: son geçerli (ya da varsayılan) dilimle devam.
  }
}

export function SessionProvider({ children, platform = "mobil" }: { children: ReactNode; platform?: "mobil" | "web" }) {
  const token = useRef<string | null>(null);
  const [phase, setPhase] = useState<Phase>("yukleniyor");
  const [facility, setFacility] = useState<FacilityStatus | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [choices, setChoices] = useState<readonly FacilityChoice[]>([]);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const switching = useRef(false);
  const [offline, setOffline] = useState(false);
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  const base = apiBaseUrl();

  const reset = useCallback(async () => {
    token.current = null;
    await secretStore.remove(TOKEN_KEY).catch(() => undefined);
    await secretStore.remove(SCOPE_KEY).catch(() => undefined);
    await clearCache(plainStore);
    setFacility(null);
    setScope(null);
    setChoices([]);
    setSwitchError(null);
    setPhase("giris");
  }, []);

  const api = useMemo(
    () => createApi(createClient({ baseUrl: base ?? "http://yapilandirilmamis.invalid", getToken: () => token.current, onUnauthorized: () => { if (token.current) void reset(); } })),
    [base, reset],
  );
  const cache = useMemo(() => (scope ? createCache(plainStore, scope) : null), [scope]);

  const markOnline = useCallback((online: boolean, savedAt?: string) => {
    setOffline(!online);
    setOfflineSince(online ? null : (savedAt ?? null));
  }, []);

  const loadFacility = useCallback(
    async (c: Cache) => {
      const r = await c.load("oturum", () => api.session());
      await loadFacilityTimezone(c, api);
      setFacility(r.data);
      markOnline(!r.offline, r.savedAt);
      return r.data;
    },
    [api, markOnline],
  );

  /** Tesis listesi: yanıtta geldiyse o; yoksa `GET /oturum/tesisler` (eski sunucu → boş = tek tesis). */
  const loadChoices = useCallback(
    async (c: Cache, given?: readonly FacilityChoice[]) => {
      if (given) return setChoices(given);
      try {
        setChoices((await c.load("tesisler", () => api.facilities())).data);
      } catch {
        setChoices([]);
      }
    },
    [api],
  );

  /** Giriş ve geçiş yanıtını benimser: belirteç + kapsam gizli depoya, tesis + liste yüklenir. */
  const adopt = useCallback(
    async (r: LoginResponse) => {
      token.current = r.belirtec;
      const s = `${r.tesisId}:${r.hesap.id}`;
      await secretStore.set(TOKEN_KEY, r.belirtec).catch(() => undefined);
      await secretStore.set(SCOPE_KEY, s).catch(() => undefined);
      await plainStore.set(LAST_FACILITY_KEY, r.tesisId).catch(() => undefined);
      setScope(s);
      const c = createCache(plainStore, s);
      await loadFacility(c);
      await loadChoices(c, r.tesisler);
    },
    [loadFacility, loadChoices],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [t, s] = await Promise.all([secretStore.get(TOKEN_KEY).catch(() => null), secretStore.get(SCOPE_KEY).catch(() => null)]);
      if (!alive) return;
      await openingCacheHygiene({ plain: plainStore, legacy: legacyPlainStore, hasSession: Boolean(t && s) });
      if (!alive) return;
      if (!t || !s) return setPhase("giris");
      token.current = t;
      setScope(s);
      try {
        const c = createCache(plainStore, s);
        await loadFacility(c);
        await loadChoices(c);
        if (alive) setPhase("hazir");
      } catch (err) {
        if (!alive) return;
        if (err instanceof ApiError && err.kind === "OTURUM") return; // reset zaten koştu
        setPhase("giris");
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadFacility, loadChoices]);

  const login = useCallback(
    async (b: { eposta: string; parola: string; totp: string }) => {
      const hint = await plainStore.get(LAST_FACILITY_KEY).catch(() => null);
      const plain = { ...b, istemci: platform };
      // Eski sunucu gövdeyi sıkı doğrular (bilinmeyen `tesisId` → 400, TOTP'ye gelmeden): ipucusuz bir kez daha.
      const r = hint
        ? await api.login({ ...plain, tesisId: hint }).catch((err: unknown) => {
            if (err instanceof ApiError && err.kind === "GECERSIZ") return api.login(plain);
            throw err;
          })
        : await api.login(plain);
      // Yeni giriş başka kimlik olabilir: bütün önbellek (her tesisin) silinir.
      await clearCache(plainStore);
      setSwitchError(null);
      await adopt(r);
      setPhase("hazir");
    },
    [api, adopt, platform],
  );

  const logout = useCallback(async () => {
    // Tek kimlik, tek oturum hissi: bütün tesislerdeki oturumlar kapanır.
    await api.logout({ hepsi: true }).catch(() => undefined);
    await reset();
  }, [api, reset]);

  const facilityId = scope ? (scope.split(":")[0] ?? null) : null;

  const switchFacility = useCallback(
    async (tesisId: string) => {
      if (tesisId === facilityId) return true;
      if (switching.current) return false;
      switching.current = true;
      setSwitchError(null);
      try {
        const r = await api.switchFacility(tesisId);
        await adopt(r);
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.kind === "OTURUM") return false; // reset zaten koştu
        if (err instanceof ApiError && err.status === 403 && err.code === SWITCH_DENIED) {
          if (cache) await loadChoices(cache);
          setSwitchError("Bu fabrikaya geçiş yetkiniz yok; fabrika listesi yenilendi.");
        } else {
          setSwitchError(errorMessage(err));
        }
        return false;
      } finally {
        switching.current = false;
      }
    },
    [api, adopt, cache, facilityId, loadChoices],
  );

  const inflight = useRef<Promise<FacilityStatus | null> | null>(null);
  const refresh = useCallback((): Promise<FacilityStatus | null> => {
    if (!cache) return Promise.resolve(null);
    if (inflight.current) return inflight.current;
    const p = loadFacility(cache).finally(() => {
      inflight.current = null;
    });
    inflight.current = p;
    return p;
  }, [cache, loadFacility]);

  const live = useRef({ phase, refresh, stamp: facility?.esitleme?.ufuk ?? null });
  live.current = { phase, refresh, stamp: facility?.esitleme?.ufuk ?? null };

  // Öne gelince oturum (damga, hizmet aşaması, izinler) tazelenir; ekranlar kendi kancalarında tazelenir.
  useForeground(() => {
    if (live.current.phase === "hazir") void live.current.refresh().catch(() => undefined);
  });

  const feedFetch = useMemo(
    () => (base ? createFeedFetcher({ baseUrl: base, getToken: () => token.current, onUnauthorized: () => { if (token.current) void reset(); } }) : null),
    [base, reset],
  );
  const feedMode = useChangeFeed({
    enabled: phase === "hazir",
    fetchChanges: feedFetch,
    resetKey: scope,
    onStamp: (stamp) => {
      if (stamp !== live.current.stamp) void live.current.refresh().catch(() => undefined);
    },
  });

  const value: SessionValue = {
    phase,
    api,
    cache,
    facility,
    facilityId,
    facilities: choices.length > 0 ? choices : facility ? [{ id: facility.tesis.id, ad: facility.tesis.ad ?? "TeksERP Yönetim", hizmet: facility.hizmet?.asama ?? "ACIK" }] : [],
    switchError,
    permissions: facility?.hesap.izinler ?? [],
    offline,
    offlineSince,
    factoryStamp: facility?.esitleme?.ufuk ?? null,
    feedMode,
    configured: base !== null,
    markOnline,
    login,
    logout,
    refresh,
    switchFacility,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("SessionProvider eksik");
  return v;
}
