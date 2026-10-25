// Sessiz saat · gün özeti saati · ses (plan §5.4). Saatler FABRİKA DİLİMİNDE girilir ve gösterilir
// (sunucu "SS:DD"yi fabrika saatiyle yorumlar); bilgisayarın yerel saati karışmaz.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { fmtFactoryTime, getFactoryTimezone } from "@/lib/factory-time";
import type { NotificationUserSettings } from "@/lib/bildirim/types";

const QUIET_CHANNELS: Array<{ kanal: NotificationUserSettings["sessizKanallar"][number]; etiket: string }> = [
  { kanal: "MASAUSTU", etiket: "Masaüstü" },
  { kanal: "TABLET_SES", etiket: "Tablet sesi" },
  { kanal: "PATRON_PUSH", etiket: "Patron uygulaması" },
];

/** Bilgi satırı: hangi dilimde ve fabrikada şu an saat kaç (yerel saat değil). */
export function factoryClockNote(simdi: Date = new Date()): string {
  return `Saatler fabrika saatiyle (${getFactoryTimezone()}); fabrikada şu an ${fmtFactoryTime(simdi)}.`;
}

export function QuietHoursCard({ deger, onChange }: { deger: NotificationUserSettings; onChange: (a: NotificationUserSettings) => void }) {
  const quietOn = deger.sessizBaslangic !== null;
  const set = (p: Partial<NotificationUserSettings>) => onChange({ ...deger, ...p });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sessiz saat ve gün özeti</CardTitle>
        <CardDescription data-testid="fabrika-saati-notu">{factoryClockNote()}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <Switch
              checked={quietOn}
              aria-label="Sessiz saat"
              onCheckedChange={(v) => set(v ? { sessizBaslangic: "22:00", sessizBitis: "07:00" } : { sessizBaslangic: null, sessizBitis: null })}
            />
            Sessiz saat
          </label>
          {quietOn && (
            <span className="inline-flex items-center gap-1.5 text-sm">
              <Input type="time" aria-label="Sessiz saat başlangıcı" className="h-8 w-28" value={deger.sessizBaslangic ?? ""} onChange={(e) => set({ sessizBaslangic: e.target.value || "00:00" })} />
              –
              <Input type="time" aria-label="Sessiz saat bitişi" className="h-8 w-28" value={deger.sessizBitis ?? ""} onChange={(e) => set({ sessizBitis: e.target.value || "00:00" })} />
            </span>
          )}
        </div>
        {quietOn && (
          <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <legend className="mb-1 text-xs text-muted-foreground">Susturulan kanallar (uygulama içi satır her zaman yazılır)</legend>
            {QUIET_CHANNELS.map((c) => (
              <label key={c.kanal} className="inline-flex items-center gap-1.5 text-sm">
                <Checkbox
                  checked={deger.sessizKanallar.includes(c.kanal)}
                  onCheckedChange={(v) =>
                    set({ sessizKanallar: v === true ? [...deger.sessizKanallar, c.kanal] : deger.sessizKanallar.filter((x) => x !== c.kanal) })
                  }
                />
                {c.etiket}
              </label>
            ))}
          </fieldset>
        )}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <label className="inline-flex items-center gap-2 text-sm">
            Gün özeti saati
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={23}
              placeholder="—"
              aria-label="Gün özeti saati (0–23)"
              className="h-8 w-20"
              value={deger.ozetSaati ?? ""}
              onChange={(e) => set({ ozetSaati: e.target.value === "" ? null : Math.min(23, Math.max(0, Math.trunc(Number(e.target.value)))) })}
            />
            <span className="text-xs text-muted-foreground">{deger.ozetSaati === null ? "fabrika gününün ilk açılışı" : `${String(deger.ozetSaati).padStart(2, "0")}:00'dan sonra`}</span>
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <Switch checked={deger.ses} aria-label="Bildirim sesi" onCheckedChange={(v) => set({ ses: v })} />
            Ses
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
