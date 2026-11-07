import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import { usePreferences } from "@/providers/PreferencesProvider";
import type { AppPreferences } from "@/types/preferences";
import {
  encodeForStore,
  isDeepLink,
  isPersistedKey,
  persistedSubset,
  restoredSubset,
  storedQuery,
  switchTableUrl,
  withStoredEntry,
  type TableFilterPersistConfig,
} from "@/components/data-table/filter-row/filter-persist";

/** Ağ yazımı Provider'da ayrıca debounce'lu; bu, hızlı ardışık kutu değişimlerini tek önbellek yazımına indirir. */
const WRITE_DEBOUNCE_MS = 400;
/** URL geri yükleme yansımazsa liste sonsuza dek beklemesin. */
const APPLY_TIMEOUT_MS = 1500;

type Phase = "wait" | "apply" | "done";

interface Args {
  tableKey: string;
  config: TableFilterPersistConfig | undefined;
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
}

/**
 * Liste filtre kaydı (kullanıcı başına, tablo başına; sunucuda `prefs.tableFilters`).
 * - URL'de kaydedilen anahtar YOKSA tercih yüklenince kayıt TEK KEZ URL'ye yazılır; o ana dek
 *   `ready=false` → liste istek atmaz (ilk açılışta çift istek yok).
 * - URL'de kaydedilen anahtar, arama ya da odak VARSA (derin bağlantı) kayıt uygulanmaz ve kullanıcı değiştirene dek yazılmaz.
 * - Kayıt yoksa `config.defaultDate` uygulanır (derin bağlantıda uygulanmaz).
 * - Arama metni, sayfa/cursor kaydedilmez. Config yoksa kanca etkisizdir (`ready=true`).
 * - `tableKey` değişirse (sayfa içi sekme): eski + yeni tablonun kayıtlı anahtarları URL'den çıkar,
 *   yeni tablonun kaydı yazılır; o ana dek `ready=false`. Sekme geçişi derin bağlantı değildir.
 */
export function usePersistedTableFilters({ tableKey, config, searchParams, setSearchParams }: Args) {
  const { prefs, setPreference, ready: prefsReadyRaw } = usePreferences();
  const prefsReady = prefsReadyRaw ?? true;
  const on = Boolean(config);
  // Sayfa config'i her çizimde yeni nesne verse de etkiler yeniden koşmasın.
  const cfgKey = JSON.stringify(config ?? {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cfg = useMemo<TableFilterPersistConfig>(() => config ?? {}, [cfgKey]);

  const initialRef = useRef<string | null>(null);
  if (initialRef.current === null) initialRef.current = on ? persistedSubset(searchParams, cfg).toString() : "";
  const deepLinkRef = useRef<boolean | null>(null);
  if (deepLinkRef.current === null) deepLinkRef.current = on && isDeepLink(searchParams, cfg);
  const deepLink = deepLinkRef.current;
  const [phase, setPhase] = useState<Phase>(!on || deepLink ? "done" : "wait");
  const targetRef = useRef("");
  const suppressWriteRef = useRef(deepLink);
  /** Geri yüklenen süzgeç ilk istekte 4xx verirse (eskimiş değer/sıralama) sıfırlanır. */
  const restoredRef = useRef(false);
  /** Kendi URL yazımımız çizilene dek (router geçişi) yazar eski URL'yi geri kaydetmesin. */
  const awaitUrlRef = useRef<string | null>(null);
  const spRef = useRef(searchParams);
  spRef.current = searchParams;
  const switching = useTableKeySwitch({ tableKey, config, cfg, prefsReady, tableFilters: prefs.tableFilters, phase, setPhase, spRef, setSearchParams, refs: { targetRef, suppressWriteRef, restoredRef, awaitUrlRef } });

  const current = on ? persistedSubset(searchParams, cfg).toString() : "";

  // Geri yükleme: tercih gelince TEK KEZ.
  useEffect(() => {
    if (phase !== "wait" || !prefsReady || switching) return;
    // Kayıt yoksa ya da okunamıyorsa sayfanın varsayılanı (ör. son 30 gün); kayıtlı "Tümü" boş döner.
    const restored = restoredSubset(prefs.tableFilters?.[tableKey], cfg);
    if (restored.toString() === "") {
      setPhase("done");
      return;
    }
    const next = new URLSearchParams(spRef.current);
    for (const k of [...next.keys()]) if (isPersistedKey(k, cfg)) next.delete(k);
    restored.forEach((v, k) => next.append(k, v));
    targetRef.current = persistedSubset(next, cfg).toString();
    restoredRef.current = true;
    setSearchParams(next, { replace: true });
    setPhase("apply");
  }, [phase, prefsReady, switching, prefs.tableFilters, tableKey, cfg, setSearchParams]);

  const applied = phase === "apply" && current === targetRef.current;
  useEffect(() => {
    if (phase !== "apply") return;
    if (applied) {
      setPhase("done");
      return;
    }
    const h = setTimeout(() => setPhase("done"), APPLY_TIMEOUT_MS);
    return () => clearTimeout(h);
  }, [phase, applied]);

  const ready = !switching && (phase === "done" || applied);

  // Yazma: son kullanılan süzgeç + sıralama (debounce'lu). Tercih yüklenmeden ASLA yazılmaz —
  // boş önbellek + yama kullanıcının bütün tercihlerini ezerdi.
  useEffect(() => {
    if (!on || !ready || !prefsReady) return;
    if (awaitUrlRef.current !== null) {
      if (current !== awaitUrlRef.current) return;
      awaitUrlRef.current = null;
    }
    if (suppressWriteRef.current) {
      if (current === initialRef.current) return;
      suppressWriteRef.current = false;
    }
    const encoded = encodeForStore(new URLSearchParams(current), cfg);
    if (encoded === storedQuery(prefs.tableFilters, tableKey)) return;
    const h = setTimeout(() => {
      setPreference((cur) => ({ tableFilters: withStoredEntry(cur.tableFilters, tableKey, encoded) }));
    }, WRITE_DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [on, ready, prefsReady, current, cfg, prefs.tableFilters, tableKey, setPreference]);

  /** Liste sonucu: geri yüklenen süzgeç reddedildiyse (4xx) URL'den ve kayıttan sil. */
  const reportListResult = (isSuccess: boolean, error: unknown) => {
    if (!restoredRef.current) return;
    if (isSuccess) {
      restoredRef.current = false;
      return;
    }
    const status = (error as { response?: { status?: number } } | null)?.response?.status;
    if (!status || status < 400 || status >= 500 || status === 401) return;
    restoredRef.current = false;
    const next = new URLSearchParams(spRef.current);
    for (const k of [...next.keys()]) if (isPersistedKey(k, cfg)) next.delete(k);
    awaitUrlRef.current = persistedSubset(next, cfg).toString();
    setSearchParams(next, { replace: true });
    setPreference((cur) => ({ tableFilters: withStoredEntry(cur.tableFilters, tableKey, "") }));
  };

  return { ready, reportListResult };
}

interface SwitchArgs {
  tableKey: string;
  config: TableFilterPersistConfig | undefined;
  cfg: TableFilterPersistConfig;
  prefsReady: boolean;
  tableFilters: AppPreferences["tableFilters"];
  phase: Phase;
  setPhase: (p: Phase) => void;
  spRef: MutableRefObject<URLSearchParams>;
  setSearchParams: SetURLSearchParams;
  refs: {
    targetRef: MutableRefObject<string>;
    suppressWriteRef: MutableRefObject<boolean>;
    restoredRef: MutableRefObject<boolean>;
    awaitUrlRef: MutableRefObject<string | null>;
  };
}

/**
 * Sayfa içi sekme geçişi (tablo anahtarı değişti): eski sekmenin süzgeci yeni sekmeye taşınmaz,
 * yeni sekmenin kaydı gelir. Geçiş bitene dek `true` döner (liste istek atmaz, kayıt yazılmaz).
 */
function useTableKeySwitch(a: SwitchArgs): boolean {
  const { tableKey, config, cfg, prefsReady, phase, setPhase, refs } = a;
  const [activeKey, setActiveKey] = useState(tableKey);
  const switching = activeKey !== tableKey;
  /** Son yerleşik config — geçişte eski tablonun anahtarlarını URL'den silmek için. */
  const prevConfigRef = useRef(config);
  useEffect(() => {
    if (!switching) return;
    // İlk geri yükleme henüz olmadıysa onu yeni anahtarla yapsın.
    if (phase === "wait") return setActiveKey(tableKey);
    if (config && !prefsReady) return;
    const raw = config ? a.tableFilters?.[tableKey] : undefined;
    const { next, restored } = switchTableUrl(a.spRef.current, prevConfigRef.current, config && cfg, raw);
    refs.suppressWriteRef.current = false;
    refs.awaitUrlRef.current = null;
    refs.restoredRef.current = restored;
    refs.targetRef.current = config ? persistedSubset(next, cfg).toString() : "";
    if (next.toString() !== a.spRef.current.toString()) a.setSearchParams(next, { replace: true });
    setActiveKey(tableKey);
    setPhase(config ? "apply" : "done");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız anahtar değişimi ve tercih hazırlığı tetikler
  }, [switching, tableKey, prefsReady]);
  // Geçiş beklerken eski tablonun config'i korunur (yukarıdaki etki onu okur).
  useEffect(() => {
    if (!switching) prevConfigRef.current = config;
  });
  return switching;
}
