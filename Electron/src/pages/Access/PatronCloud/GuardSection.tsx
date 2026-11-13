// Fabrika seddi (G1): "buluttan yazma" anahtarı + gelen kutusu / rapor tavanları ve şu anki pencere sayaçları.
// Yazım ayar şifresi kapısından geçer; tavan dolunca ya da anahtar kapalıyken kayıtlar bulutta bekler (kayıp yok).
import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { SectionCard } from "@/components/ui/section-card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { apiErrorText } from "@/lib/api-error";
import { SettingsPasswordCancelled } from "@/lib/settings-password";
import { patronCloudService, type PatronCloudGuardSettings, type PatronCloudStatus } from "./service";

type LimitKey = "saatlikTavan" | "gunlukTavan" | "raporSaatlikTavan";
const LIMIT_FIELDS: ReadonlyArray<{ key: LimitKey; label: string; max: number }> = [
  { key: "saatlikTavan", label: "Saatlik kayıt tavanı", max: 10_000 },
  { key: "gunlukTavan", label: "Günlük kayıt tavanı", max: 10_000 },
  { key: "raporSaatlikTavan", label: "Saatlik rapor tavanı", max: 1_000 },
];

function toDraft(a: PatronCloudGuardSettings): Record<LimitKey, string> {
  return { saatlikTavan: String(a.saatlikTavan), gunlukTavan: String(a.gunlukTavan), raporSaatlikTavan: String(a.raporSaatlikTavan) };
}

export function GuardSection({ s, onSaved }: { s: PatronCloudStatus; onSaved: () => void }) {
  const { ayarlar, gelenKutusu, rapor } = s.sed;
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(() => toDraft(ayarlar));
  useEffect(() => setDraft(toDraft(ayarlar)), [ayarlar]);

  const changed = LIMIT_FIELDS.filter((f) => draft[f.key].trim() !== String(ayarlar[f.key]));

  const save = async (input: Partial<PatronCloudGuardSettings>) => {
    setBusy(true);
    try {
      const r = await patronCloudService.updateGuard(input);
      toast.success(r.message ?? "Kaydedildi.");
      onSaved();
    } catch (err) {
      if (!(err instanceof SettingsPasswordCancelled)) toast.error(apiErrorText(err, "Ayar kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const saveLimits = () => {
    const input: Partial<PatronCloudGuardSettings> = {};
    for (const f of changed) input[f.key] = Number(draft[f.key].trim());
    void save(input);
  };

  return (
    <SectionCard
      title="Buluttan yazma"
      description="Kapalıyken ya da tavan dolunca yeni sipariş ve cari kayıtları bulutta bekler; raporlar ve eşitleme sürer."
      action={
        <Switch
          checked={ayarlar.gelenKutusuAcik}
          disabled={busy}
          aria-label="Buluttan yazma"
          onCheckedChange={(v) => void save({ gelenKutusuAcik: v })}
        />
      }
    >
      <div className="space-y-3">
        {!ayarlar.gelenKutusuAcik && (
          <Callout tone="warning" icon={ShieldAlert} title="Buluttan yazma durduruldu">
            Patron uygulamasından gelen kayıtlar fabrikaya alınmıyor.
          </Callout>
        )}
        {ayarlar.gelenKutusuAcik && gelenKutusu.dolu && (
          <Callout tone="warning" icon={ShieldAlert} title="Tavan doldu">
            {gelenKutusu.dolu === "GUNLUK" ? "Son 24 saatin" : "Son 60 dakikanın"} tavanı doldu; yeni kayıtlar pencere açılınca alınır.
          </Callout>
        )}
        <dl className="grid grid-cols-3 gap-3 text-sm" data-testid="guard-counters">
          <Counter label="Son 60 dakika" value={gelenKutusu.saatlik.sayi} max={gelenKutusu.saatlik.tavan} />
          <Counter label="Son 24 saat" value={gelenKutusu.gunluk.sayi} max={gelenKutusu.gunluk.tavan} />
          <Counter label="Rapor, son 60 dakika" value={rapor.sonSaat} max={rapor.tavan} />
        </dl>
        <div className="flex flex-wrap items-end gap-3">
          {LIMIT_FIELDS.map((f) => (
            <div key={f.key} className="w-40 space-y-1">
              <Label htmlFor={`guard-${f.key}`} className="text-xs">
                {f.label}
              </Label>
              <Input
                id={`guard-${f.key}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={f.max}
                value={draft[f.key]}
                disabled={busy}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              />
            </div>
          ))}
          <Button onClick={saveLimits} disabled={busy || changed.length === 0}>
            Tavanları kaydet
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

function Counter({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={value >= max ? "font-semibold text-warning" : "font-semibold"}>
        {value} / {max}
      </dd>
    </div>
  );
}
