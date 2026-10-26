// Tek tür satırı (plan §6.4): ad + "Neden alırsınız" · uygulama içi üç durum · masaüstü · tablet sesi · kapsam.
// Kilitli satırda yalnız "Anlık" vardır; kilit bilgisi METİNLE verilir (renk tek başına anlam taşımaz).
import { Lock, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { lockReason, scopeLabel, sourceLabel, type InAppMode, type KindDraft } from "@/lib/bildirim/tercih-taslak";
import type { NotificationCatalogKind } from "@/lib/bildirim/types";

const MODES: Array<{ mod: InAppMode; etiket: string }> = [
  { mod: "ANLIK", etiket: "Anlık" },
  { mod: "OZET", etiket: "Özet" },
  { mod: "KAPALI", etiket: "Kapalı" },
];

function ModeSegment({ k, ad, onMode }: { k: KindDraft; ad: string; onMode: (m: InAppMode) => void }) {
  const secenekler = k.kilit ? MODES.slice(0, 1) : MODES.filter((m) => m.mod !== "OZET" || k.ozetVar);
  return (
    <div role="radiogroup" aria-label={`${ad} — uygulama içi`} className="inline-flex rounded-md border border-border bg-muted/40 p-0.5">
      {secenekler.map((m) => {
        const secili = k.mod === m.mod || (k.kilit && m.mod === "ANLIK");
        return (
          <button
            key={m.mod}
            type="button"
            role="radio"
            aria-checked={secili}
            disabled={k.kilit}
            onClick={() => onMode(m.mod)}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed",
              secili ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m.etiket}
          </button>
        );
      })}
      {k.kilit && <span className="self-center px-1.5 text-[11px] text-muted-foreground">(kilitli)</span>}
    </div>
  );
}

function ChannelSwitch({ etiket, deger, pasif, onChange, ad }: { etiket: string; deger: boolean | undefined; pasif: boolean; onChange: (v: boolean) => void; ad: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {etiket}
      {deger === undefined ? (
        <span aria-label={`${ad} — ${etiket} kanalı yok`}>–</span>
      ) : (
        <Switch checked={deger} disabled={pasif} onCheckedChange={onChange} aria-label={`${ad} — ${etiket}`} />
      )}
    </span>
  );
}

export function KindRow(p: {
  k: KindDraft;
  katalog: NotificationCatalogKind;
  onMode: (m: InAppMode) => void;
  onChannel: (ch: "MASAUSTU" | "TABLET_SES", v: boolean) => void;
  onScope: () => void;
}) {
  const { k, katalog, onMode, onChannel, onScope } = p;
  const hasScope = !!katalog.kapsam && Object.keys(katalog.kapsam).length > 0;
  const sideOff = k.mod === "KAPALI" && !k.kilit;
  return (
    <li className="space-y-2 border-b border-border/60 py-3 last:border-b-0" data-testid={`tur-${k.kod}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            {k.kilit && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
            {katalog.ad}
            {k.kilit && <span className="sr-only">(kilitli)</span>}
          </p>
          <p className="text-xs text-muted-foreground">Neden alırsınız: {sourceLabel(k.kaynak)}</p>
        </div>
        {k.kilit && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline">
                  Neden kilitli? <Info className="h-3.5 w-3.5" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{lockReason(k, katalog)}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          Uygulama içi <ModeSegment k={k} ad={katalog.ad} onMode={onMode} />
        </span>
        <ChannelSwitch etiket="Masaüstü" ad={katalog.ad} deger={k.kanal.MASAUSTU} pasif={sideOff} onChange={(v) => onChannel("MASAUSTU", v)} />
        <ChannelSwitch etiket="Tablet sesi" ad={katalog.ad} deger={k.kanal.TABLET_SES} pasif={sideOff} onChange={(v) => onChannel("TABLET_SES", v)} />
        {hasScope && !k.kilit && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            Kapsam
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onScope} aria-label={`${katalog.ad} — kapsam: ${scopeLabel(k.kapsam)}`}>
              {scopeLabel(k.kapsam)}
            </Button>
          </span>
        )}
      </div>
      {sideOff && (k.kanal.MASAUSTU !== undefined || k.kanal.TABLET_SES !== undefined) && (
        <p className="text-[11px] text-muted-foreground">Uygulama içi kapalıyken masaüstü ve tablet sesi de gönderilmez.</p>
      )}
    </li>
  );
}
