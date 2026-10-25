// =============================================================================
// Kullanıcı Tercihleri → "Masaüstü bildirimleri" (N3) — hangi türler arka plandayken OS bildirimi versin.
// =============================================================================
// Kişisel tercih (`UserPreference.bildirim.masaustuTurler`, kullanıcıyı takip eder); varsayılan boş =
// hiçbiri (bugünkü davranış). Liste sunucunun görme süzgecinden geçmiş katalogdur (`/katalog`); tezgah
// alarmı (ALARM sınıfı) kendi kanalından bildirir, burada seçilmez. Bayrak kapalıyken yalnız açıklama.
// =============================================================================
import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Callout } from "@/components/ui/callout";
import { usePreferences } from "@/providers/PreferencesProvider";
import { useNotificationCatalog, useNotificationInboxFlag } from "@/lib/bildirim/hooks";
import { bildirimBridge } from "@/lib/bildirim/masaustu";
import type { NotificationCatalogKind } from "@/lib/bildirim/types";
import { NOTIFICATION_GROUP_ORDER } from "@/pages/Notifications/group-order";

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

export function MasaustuBildirimKarti() {
  const { acik, yuklendi } = useNotificationInboxFlag();
  const katalog = useNotificationCatalog(acik);
  const { prefs, setPreference } = usePreferences();
  const masaustu = useMemo(() => bildirimBridge() !== null, []);
  const secili = useMemo(
    () => new Set(prefs.bildirim?.masaustuTurler ?? []),
    [prefs.bildirim?.masaustuTurler],
  );
  const kinds = useMemo(() => katalog.data?.turler ?? [], [katalog.data]);
  const gruplar = useMemo(() => groupKinds(kinds), [kinds]);
  const tumKodlar = gruplar.flatMap((g) => g.turler.map((k) => k.kod));
  const alarmVar = kinds.some((k) => k.sinif === "ALARM");
  const seciliSayi = tumKodlar.filter((k) => secili.has(k)).length;

  const yaz = (kodlar: Iterable<string>) =>
    setPreference({ bildirim: { ...(prefs.bildirim ?? {}), masaustuTurler: [...new Set(kodlar)].sort() } });
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
          pencere öndeyken kısa bir uyarı çıkar. Varsayılan: hiçbiri.
        </CardDescription>
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
