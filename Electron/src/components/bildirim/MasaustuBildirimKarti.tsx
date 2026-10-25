// =============================================================================
// Kullanıcı Tercihleri → "Masaüstü bildirimleri" (N3) — hangi türler arka plandayken OS bildirimi versin.
// =============================================================================
// Kişisel tercih sunucuda (`notification_preferences`, MASAUSTU kanalı — N4-MOTOR); seçim `/katalog`
// hücrelerinden okunur, `PUT /tercihler`e yazılır. N3 anahtarı (`masaustuTurler`) bir sürüm birleşimle okunur.
// Tezgah alarmı (ALARM sınıfı) kendi kanalından bildirir, burada seçilmez. Bayrak kapalıyken yalnız açıklama.
// =============================================================================
import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Callout } from "@/components/ui/callout";
import { usePreferences } from "@/providers/PreferencesProvider";
import { NOTIFICATION_QUERY_KEY, useNotificationCatalog, useNotificationInboxFlag } from "@/lib/bildirim/hooks";
import { desktopKinds, desktopPreferenceBody } from "@/lib/bildirim/masaustu-tercih";
import { bildirimService } from "@/services/bildirimService";
import { bildirimBridge } from "@/lib/bildirim/masaustu";
import type { NotificationCatalogKind, NotificationPreferenceCell } from "@/lib/bildirim/types";
import { NOTIFICATION_GROUP_ORDER } from "@/pages/Notifications/group-order";
import { useTabsStore } from "@/store/tabs";
import { NOTIFICATION_SETTINGS_PATH, useNotificationSettingsAvailable } from "./BildirimTercihKarti";

function groupKinds(kinds: readonly NotificationCatalogKind[]) {
  const bildirim = kinds.filter((k) => k.sinif === "BILDIRIM");
  return NOTIFICATION_GROUP_ORDER.map((g) => ({
    grup: g,
    turler: bildirim.filter((k) => k.grup === g),
  })).filter((x) => x.turler.length > 0);
}

function KindPicker(p: {
  gruplar: ReturnType<typeof groupKinds>;
  secili: ReadonlySet<string>;
  seciliSayi: number;
  tumKodlar: string[];
  yaz: (kodlar: Iterable<string>) => void;
  degistir: (kod: string, on: boolean) => void;
}) {
  const { gruplar, secili, seciliSayi, tumKodlar, yaz, degistir } = p;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" data-testid="masaustu-secili-sayi">
          {seciliSayi === 0 ? "Hiçbir tür seçili değil" : `${seciliSayi} tür seçili`}
        </p>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => yaz([...secili, ...tumKodlar])}
          >
            Tümünü seç
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={seciliSayi === 0}
            onClick={() => yaz([...secili].filter((k) => !tumKodlar.includes(k)))}
          >
            Hiçbiri
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {gruplar.map((g) => (
          <fieldset key={g.grup} className="min-w-0 space-y-1">
            <legend className="pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {g.grup}
            </legend>
            {g.turler.map((k) => {
              const id = `masaustu-${k.kod}`;
              return (
                <label
                  key={k.kod}
                  htmlFor={id}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/60"
                >
                  <Checkbox
                    id={id}
                    className="mt-0.5"
                    checked={secili.has(k.kod)}
                    onCheckedChange={(v) => degistir(k.kod, v === true)}
                  />
                  <span className="min-w-0 break-words">{k.ad}</span>
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
    </>
  );
}

/** Seçim yazıcısı — F4 sunucusunda `PUT /tercihler` (tam gövde), eski sunucuda N3 anahtarı. */
function useDesktopWriter(hucreler: NotificationPreferenceCell[] | undefined, legacy: string[] | undefined, tumKodlar: string[]) {
  const { prefs, setPreference } = usePreferences();
  const qc = useQueryClient();
  return (kodlar: Iterable<string>) => {
    const yeni = new Set(kodlar);
    void (async () => {
      try {
        if (hucreler) {
          const { satirlar } = await bildirimService.tercihler();
          await bildirimService.tercihleriYaz(desktopPreferenceBody(satirlar, hucreler, tumKodlar, yeni));
        }
        // N3 anahtarı bir sürüm okunur: yalnız yeni kümede kalanlar tutulur (kapatılan tür geri gelmesin).
        if (!hucreler || (legacy && legacy.length > 0)) {
          const kept = hucreler ? (legacy ?? []).filter((k) => yeni.has(k)) : [...yeni].sort();
          setPreference({ bildirim: { ...(prefs.bildirim ?? {}), masaustuTurler: kept } });
        }
        await qc.invalidateQueries({ queryKey: [...NOTIFICATION_QUERY_KEY, "katalog"] });
      } catch {
        toast.error("Masaüstü bildirim tercihi kaydedilemedi.");
      }
    })();
  };
}

export function MasaustuBildirimKarti() {
  const { acik, yuklendi } = useNotificationInboxFlag();
  const katalog = useNotificationCatalog(acik);
  const { prefs } = usePreferences();
  const masaustu = useMemo(() => bildirimBridge() !== null, []);
  const tumTercihler = useNotificationSettingsAvailable();
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const legacy = prefs.bildirim?.masaustuTurler;
  const hucreler = katalog.data?.hucreler;
  const secili = useMemo(() => new Set(desktopKinds(hucreler, legacy)), [hucreler, legacy]);
  const kinds = useMemo(() => katalog.data?.turler ?? [], [katalog.data]);
  const gruplar = useMemo(() => groupKinds(kinds), [kinds]);
  const tumKodlar = gruplar.flatMap((g) => g.turler.map((k) => k.kod));
  const alarmVar = kinds.some((k) => k.sinif === "ALARM");
  const seciliSayi = tumKodlar.filter((k) => secili.has(k)).length;

  const yaz = useDesktopWriter(hucreler, legacy, tumKodlar);
  const degistir = (kod: string, on: boolean) => {
    const yeni = new Set(secili);
    if (on) yeni.add(kod);
    else yeni.delete(kod);
    yaz(yeni);
  };

  return (
    <Card data-testid="masaustu-bildirim-karti">
      <CardHeader>
        <CardTitle className="text-base">Masaüstü bildirimleri</CardTitle>
        <CardDescription>
          Seçtiğin bildirim türleri, uygulama arka plandayken işletim sistemi bildirimi olarak da gelir;
          pencere öndeyken kısa bir uyarı çıkar. Başlangıçta önerilen türler seçilidir.
        </CardDescription>
        {tumTercihler && (
          <Button variant="link" size="sm" className="h-auto justify-start p-0 text-xs" onClick={() => navigateActive(NOTIFICATION_SETTINGS_PATH)}>
            Tüm bildirim tercihleri (uygulama içi, tablet sesi, sessiz saat) →
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!yuklendi ? null : !acik ? (
          <p className="text-sm text-muted-foreground">Bildirimler kapalı — Genel Ayarlar'dan açılır.</p>
        ) : (
          <>
            {!masaustu && (
              <Callout tone="muted">
                Masaüstü bildirimi yalnız masaüstü uygulamasında çıkar; web panelinde seçimin kaydedilir ama
                bildirim gösterilmez.
              </Callout>
            )}
            {katalog.isLoading ? (
              <p className="text-sm text-muted-foreground">Türler yükleniyor…</p>
            ) : katalog.isError ? (
              <p className="text-sm text-destructive">Bildirim türleri okunamadı.</p>
            ) : gruplar.length === 0 ? (
              <p className="text-sm text-muted-foreground">Görebileceğin bildirim türü yok.</p>
            ) : (
              <KindPicker
                gruplar={gruplar}
                secili={secili}
                seciliSayi={seciliSayi}
                tumKodlar={tumKodlar}
                yaz={yaz}
                degistir={degistir}
              />
            )}
            {alarmVar && (
              <p className="text-xs text-muted-foreground">
                Tezgah alarmı kendi masaüstü bildirimini her zaman verir; açık alarm varken görev çubuğu
                simgesi yanıp söner.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
