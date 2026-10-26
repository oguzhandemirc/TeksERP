// Kapsam modalı (plan §5.2): yalnız katalogda BEYANLI süzgeçler; yalnız daraltır. Doğrulama sunucuda (400 → tost).
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ESIK_LABEL } from "@/lib/bildirim/tercih-taslak";
import { TERIM } from "@/lib/terim";
import type { NotificationCatalogKind, NotificationScopeValue } from "@/lib/bildirim/types";

export function ScopeDialog(p: {
  katalog: NotificationCatalogKind | null;
  deger: NotificationScopeValue | null;
  onKapat: () => void;
  onUygula: (s: NotificationScopeValue | null) => void;
}) {
  const { katalog, deger, onKapat, onUygula } = p;
  const [taslak, setTaslak] = useState<NotificationScopeValue>({});
  useEffect(() => setTaslak(deger ?? {}), [deger, katalog]);
  const decl = katalog?.kapsam ?? {};
  const uygula = () => {
    const out: NotificationScopeValue = {};
    if (decl.yalnizTakip && taslak.yalnizTakip) out.yalnizTakip = true;
    if (decl.istasyonlar && taslak.istasyonlar) out.istasyonlar = taslak.istasyonlar;
    const esik = Object.fromEntries(Object.entries(taslak.esik ?? {}).filter(([k, v]) => decl.esik?.[k] && Number.isFinite(v)));
    if (Object.keys(esik).length) out.esik = esik;
    onUygula(Object.keys(out).length ? out : null);
  };
  return (
    <Dialog open={!!katalog} onOpenChange={(o) => !o && onKapat()}>
      <DialogContent className="w-[min(32rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Kapsam — {katalog?.ad}</DialogTitle>
          <DialogDescription>Yalnız seçtiğiniz kayıtlar için bildirim alırsınız; boş bırakırsanız hepsi gelir.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {decl.yalnizTakip && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={!!taslak.yalnizTakip} onCheckedChange={(v) => setTaslak((t) => ({ ...t, yalnizTakip: v === true || undefined }))} />
              <span>
                Yalnız takip ettiğim kayıtlar
                <span className="block text-xs text-muted-foreground">Oluşturduğunuz ya da "Takip et" dediğiniz sipariş, {TERIM.terbiyeIsEmri.cogulKucuk} ve {TERIM.dokumaIsEmri.cogulKucuk}.</span>
              </span>
            </label>
          )}
          {decl.istasyonlar && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={!!taslak.istasyonlar}
                onCheckedChange={(v) => setTaslak((t) => ({ ...t, istasyonlar: v === true ? "BENIM" : undefined }))}
              />
              <span>
                Yalnız istasyonlarım
                <span className="block text-xs text-muted-foreground">Şu an çalıştığınız istasyonlar ve sorumlusu olduğunuz salonlar.</span>
              </span>
            </label>
          )}
          {Object.keys(decl.esik ?? {}).map((anahtar) => (
            <label key={anahtar} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-[8rem]">{ESIK_LABEL[anahtar] ?? anahtar}</span>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                className="h-8 w-24"
                aria-label={ESIK_LABEL[anahtar] ?? anahtar}
                value={taslak.esik?.[anahtar] ?? ""}
                onChange={(e) => {
                  const n = e.target.value === "" ? undefined : Number(e.target.value);
                  setTaslak((t) => {
                    const esik = { ...(t.esik ?? {}) };
                    if (n === undefined) delete esik[anahtar];
                    else esik[anahtar] = n;
                    return { ...t, esik };
                  });
                }}
              />
              <span className="text-xs text-muted-foreground">gün (boş = fabrika ayarı)</span>
            </label>
          ))}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onUygula(null)}>Tümünü al</Button>
          <Button onClick={uygula}>Uygula</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
