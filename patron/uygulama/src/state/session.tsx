// Oturum bağlamı: belirteç (gizli depo) + tesis durumu (`GET /oturum`) + izinler. Çevrimdışıyken son
// oturum görüntüsü önbellekten gelir ve YAZMA kapalıdır. 401 → belirteç silinir, giriş ekranı.
// Çok tesis: tek bulut kimliği birden çok fabrikaya erişir; geçiş yeni belirteç + yeni kapsam alır, diğer tesisin
// önbelleği (ayrık kapsam) durur; çıkış ve yeni giriş bütün önbelleği siler.
// Tazelik (K1): öne gelince ve değişim akışında fabrika damgası değişince `refresh()`; "Son eşitleme" = fabrika
// veri anı (`esitleme.ufuk`, paketin ufku), bulutun alım anı değil. Belirteç yenileme ucu sunucuda yok — dokunulmaz.
// İki kip (V3b): bağlantı (`api/baglanti.ts`) bulut ya da fabrika ERP'si; ekranlar yalnız `api` + `yetenek` görür.
// ERP: giriş `/auth/login` (kod istek üzerine), yetenek `/auth/me` `patronReadSets`, veri canlı (eşitleme/akış yok),
// saklı veri 7 gün. Bağlantı (kip + adres) çıkışta KALIR; veri ve belirteç silinir.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, createClient, errorMessage } from "../api/client";
import { createApi, type Api } from "../api/endpoints";
import { adresiDuzelt, baglantiOku, baglantiSil, baglantiYaz, bulutBaglantisi, erpBaglantisi, erpYokla, type Baglanti } from "../api/baglanti";
import { createErpApi, erpBen, erpGiris } from "../api/erp";
import { BULUT_YETENEK, erpYetenek, izinleriSuz, setYetenek, type Yetenek } from "../api/yetenek";
import { createBulutYazici, createErpYazici, type Yazici } from "../api/yazma";
import { createBulutRaporcu, createErpRaporcu, type Raporcu } from "../api/rapor";
import { createBulutBildirimci, createErpBildirimci, erpBildirimAcik, type Bildirimci } from "../api/bildirim";
import type { FacilityChoice, FacilityStatus, LoginResponse } from "../api/wire";
import { apiBaseUrl } from "../lib/config";
import { clearCache, createCache, ERP_CACHE_MAX_AGE_MS, openingCacheHygiene, purgeExpired, type Cache } from "./cache";
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
  /** Yazma (V4b): bulutta gelen kutusu, ERP'de fabrika uçları; işlem açıklığı `islemVar`. */
  readonly yazici: Yazici;
  /** İstek üzerine rapor (yalnız `yetenek().raporAnlik` açıkken çağrılır; bulutta ağa gitmez). */
  readonly raporcu: Raporcu;
  /** Gelen bildirim kutusu (yalnız `yetenek().bildirimKutusu` açıkken çağrılır; bulutta ağa gitmez). */
  readonly bildirimci: Bildirimci;
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
  /** Bağlanılan sunucunun sunduğu (küme + özellik); ekran kip yerine buna bakar. */
  readonly yetenek: Yetenek;
  /** Elle eklenen fabrika sunucusu adresi; bulut bağlantısında null. */
  readonly server: string | null;
  /** Adresi yoklar; TeksERP ise bağlantı kaydedilir. Tanınmazsa Türkçe ileti döner. */
  connectServer(adres: string): Promise<string | null>;
  /** Kayıtlı sunucuyu unutur (yalnız oturumsuzken); bulut bağlantısına dönülür. */
  forgetServer(): Promise<void>;
  markOnline(online: boolean, savedAt?: string): void;
  login(b: { eposta: string; parola: string; totp: string }): Promise<void>;
  logout(): Promise<void>;
  /** `GET /oturum` yeniden okunur (uçuştayken ikinci çağrı aynı sözü alır); oturumsuzken null. */
  refresh(): Promise<FacilityStatus | null>;
  /** Başka tesise geç; reddedilirse `false` ve `switchError` dolar, etkin tesis değişmez. */
  switchFacility(tesisId: string): Promise<boolean>;
}

/** ERP bağlantısı var ama sunucu henüz kümelerini söylemedi: hiçbir küme açık değil (fail-closed). */
const ERP_KAPALI = erpYetenek([]);

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
  /** Kayıtlı ERP bağlantısı; undefined = depo henüz okunmadı. */
  const [erp, setErp] = useState<Baglanti | null | undefined>(undefined);
  const [erpCaps, setErpCaps] = useState<Yetenek | null>(null);
  const [facilitySavedAt, setFacilitySavedAt] = useState<string | null>(null);
  const bag: Baglanti | null = erp ?? (base ? bulutBaglantisi(base) : null);
  const isErp = bag?.kip === "erp";
  const caps: Yetenek = isErp ? (erpCaps ?? ERP_KAPALI) : BULUT_YETENEK;
  // Görünürlük yardımcıları (`lib/access.ts`) etkin yeteneği okur; render içinde, çocuklardan önce kurulur.
  setYetenek(caps);
  const capsRef = useRef(caps);
  capsRef.current = caps;

  const reset = useCallback(async () => {
    token.current = null;
    await secretStore.remove(TOKEN_KEY).catch(() => undefined);
    await secretStore.remove(SCOPE_KEY).catch(() => undefined);
    await clearCache(plainStore);
    setFacility(null);
    setScope(null);
    setChoices([]);
    setSwitchError(null);
    setErpCaps(null);
    setFacilitySavedAt(null);
    setPhase("giris");
  }, []);

  const bagKey = bag ? `${bag.kip}|${bag.tabanAdres}` : "";
  const client = useMemo(
    () =>
      bag?.kip === "erp"
        ? createClient({ baseUrl: bag.tabanAdres, fetchImpl: bag.tasima, getToken: () => token.current, onUnauthorized: () => { if (token.current) void reset(); } })
        : createClient({ baseUrl: base ?? "http://yapilandirilmamis.invalid", getToken: () => token.current, onUnauthorized: () => { if (token.current) void reset(); } }),
    // Bağlantı kimliği `bagKey` (nesne her render yeniden kurulur).
    [bagKey, base, reset],
  );
  const api = useMemo(() => (isErp ? createErpApi(client, () => capsRef.current) : createApi(client)), [client, isErp]);
  const yazici = useMemo(() => (isErp ? createErpYazici(client) : createBulutYazici(api)), [client, isErp, api]);
  const raporcu = useMemo(() => (isErp ? createErpRaporcu(client) : createBulutRaporcu()), [client, isErp]);
  const bildirimci = useMemo(() => (isErp ? createErpBildirimci(client) : createBulutBildirimci()), [client, isErp]);
  const makeCache = useCallback((s: string) => createCache(plainStore, s, undefined, isErp ? ERP_CACHE_MAX_AGE_MS : undefined), [isErp]);
  const cache = useMemo(() => (scope ? makeCache(scope) : null), [scope, makeCache]);

  const markOnline = useCallback((online: boolean, savedAt?: string) => {
    setOffline(!online);
    setOfflineSince(online ? null : (savedAt ?? null));
  }, []);

  const loadFacility = useCallback(
    async (c: Cache) => {
      const r = await c.load("oturum", () => api.session());
      await loadFacilityTimezone(c, api);
      setFacility(r.data);
      setFacilitySavedAt(r.savedAt);
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

  // Kayıtlı bağlantı bir kez okunur; okunana kadar açılış bekler.
  useEffect(() => {
    let alive = true;
    void baglantiOku(secretStore).then((v) => {
      if (alive) setErp(v ? erpBaglantisi(v.tabanAdres) : null);
    });
    return () => {
      alive = false;
    };
  }, []);

  const applyCaps = useCallback((sets: unknown, perms: unknown, reportApi: unknown, inbox: boolean, reportExport: unknown) => {
    const y = erpYetenek(sets, perms, reportApi, inbox, reportExport);
    capsRef.current = y;
    setYetenek(y);
    setErpCaps(y);
  }, []);

  /** ERP gelen kutusu açık mı (`/bildirim/ozet`, saklı kopyalı; 404/kapalı/hata → kapalı). */
  const bildirimAcik = useCallback(
    (c: Cache) => erpBildirimAcik(async () => (await c.load("bildirim-ozet", () => bildirimci.ozet())).data),
    [bildirimci],
  );

  /** ERP: kullanıcı + sunulan kümeler (`/auth/me`, saklı kopyalı — çevrimdışı açılışta da yetenek bilinir). */
  const loadErpCaps = useCallback(
    async (c: Cache) => {
      const me = (await c.load("ben", () => erpBen(client))).data;
      applyCaps(me.patronReadSets, me.permissions, me.patronReportApi, await bildirimAcik(c), me.patronReportExport);
      return me;
    },
    [client, applyCaps, bildirimAcik],
  );

  const booted = useRef(false);
  useEffect(() => {
    if (erp === undefined || booted.current) return;
    booted.current = true;
    let alive = true;
    void (async () => {
      const [t, s] = await Promise.all([secretStore.get(TOKEN_KEY).catch(() => null), secretStore.get(SCOPE_KEY).catch(() => null)]);
      if (!alive) return;
      await openingCacheHygiene({ plain: plainStore, legacy: legacyPlainStore, hasSession: Boolean(t && s) });
      if (isErp) await purgeExpired(plainStore, ERP_CACHE_MAX_AGE_MS);
      if (!alive) return;
      if (!t || !s) return setPhase("giris");
      token.current = t;
      setScope(s);
      try {
        const c = makeCache(s);
        if (isErp) await loadErpCaps(c);
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
  }, [erp, isErp, makeCache, loadErpCaps, loadFacility, loadChoices]);

  /** ERP girişi: belirteç → `/auth/me` (yetenek) → `/patron/v1/oturum`. Parola ve kod yalnız istekte kalır. */
  const loginErp = useCallback(
    async (b: { eposta: string; parola: string; totp: string }, adres: string) => {
      const r = await erpGiris(client, { kullanici: b.eposta, parola: b.parola, kod: b.totp });
      await clearCache(plainStore);
      setSwitchError(null);
      token.current = r.token;
      try {
        const me = await erpBen(client);
        const s = `erp|${adres}|${me.userId}`;
        const c = makeCache(s);
        await c.load("ben", () => Promise.resolve(me));
        applyCaps(me.patronReadSets, me.permissions, me.patronReportApi, false, me.patronReportExport);
        await secretStore.set(TOKEN_KEY, r.token).catch(() => undefined);
        await secretStore.set(SCOPE_KEY, s).catch(() => undefined);
        setScope(s);
        await loadFacility(c);
        // Gelen kutusu açıklığı oturum kurulduktan sonra (hata girişi bozmaz; kapalı kalır).
        applyCaps(me.patronReadSets, me.permissions, me.patronReportApi, await bildirimAcik(c), me.patronReportExport);
      } catch (err) {
        // Yarım giriş kalmaz: belirteç düşer, sonraki deneme baştan.
        await reset();
        throw err;
      }
      setChoices([]);
      setPhase("hazir");
    },
    [client, makeCache, applyCaps, bildirimAcik, loadFacility, reset],
  );

  const login = useCallback(
    async (b: { eposta: string; parola: string; totp: string }) => {
      if (bag?.kip === "erp") return loginErp(b, bag.tabanAdres);
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
    [api, adopt, platform, bag, loginErp],
  );

  const connectServer = useCallback(async (girdi: string): Promise<string | null> => {
    const adres = adresiDuzelt(girdi);
    if (!adres) return "Geçerli bir https adresi yazın";
    const r = await erpYokla(adres);
    if (!r.tamam) return r.ileti;
    await baglantiYaz(secretStore, r.baglanti);
    setErpCaps(null);
    setErp(r.baglanti);
    return null;
  }, []);

  const forgetServer = useCallback(async () => {
    if (token.current) return;
    await baglantiSil(secretStore);
    await clearCache(plainStore);
    setErpCaps(null);
    setErp(null);
  }, []);

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
    () => (base && !isErp ? createFeedFetcher({ baseUrl: base, getToken: () => token.current, onUnauthorized: () => { if (token.current) void reset(); } }) : null),
    [base, reset, isErp],
  );
  const feedMode = useChangeFeed({
    enabled: phase === "hazir" && caps.tazele,
    fetchChanges: feedFetch,
    resetKey: scope,
    onStamp: (stamp) => {
      if (stamp !== live.current.stamp) void live.current.refresh().catch(() => undefined);
    },
  });

  const rawPerms = facility?.hesap.izinler;
  const permissions = useMemo(() => (rawPerms ? (caps === BULUT_YETENEK ? rawPerms : izinleriSuz(rawPerms, caps)) : []), [rawPerms, caps]);

  const value: SessionValue = {
    phase,
    api,
    yazici,
    raporcu,
    bildirimci,
    cache,
    facility,
    facilityId,
    facilities: choices.length > 0 ? choices : facility ? [{ id: facility.tesis.id, ad: facility.tesis.ad ?? "TeksERP Yönetim", hizmet: facility.hizmet?.asama ?? "ACIK" }] : [],
    switchError,
    permissions,
    offline,
    offlineSince,
    factoryStamp: caps.canli ? (facility ? facilitySavedAt : null) : (facility?.esitleme?.ufuk ?? null),
    feedMode,
    configured: bag !== null,
    yetenek: caps,
    server: isErp && bag ? bag.tabanAdres : null,
    connectServer,
    forgetServer,
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
