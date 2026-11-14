// Bildirim tercihleri sayfasının ÜST şeridi: hazır + kişisel profil çipleri, etkin profil ("Özel" = hiçbiri birebir değil),
// "Profili kaydet". Çip tek tıkla UYGULAMA kanalına uygular (sunucu tek tx); taslak kirliyse önce onay sorulur.
// Kişisel çipin menüsü: şu anki seçimle güncelle · yeniden adlandır · sil (onaylı; seçim değişmez).
import { useState } from "react";
import { Check, MoreHorizontal, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { activeLabel, profileChips, type ProfileChip } from "./profile-strip-model";
import { ProfileNameDialog } from "./ProfileNameDialog";
import { useProfileStrip } from "./useProfileStrip";

type Confirm = { kind: "uygula"; chip: ProfileChip } | { kind: "sil"; chip: ProfileChip };

export function ProfileStrip({ enabled, kirli }: { enabled: boolean; kirli: boolean }) {
  const s = useProfileStrip("UYGULAMA", enabled);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [nameFor, setNameFor] = useState<{ chip: ProfileChip | null } | null>(null);
  if (!s.view || s.unsupported) return null;
  const view = s.view;
  const chips = profileChips(view);
  const busy = s.apply.isPending || s.create.isPending || s.update.isPending || s.remove.isPending;
  const pick = (c: ProfileChip) => (kirli ? setConfirm({ kind: "uygula", chip: c }) : s.apply.mutate(c));

  return (
    <section aria-label="Bildirim profilleri" className="space-y-2 rounded-lg border border-border bg-card p-3" data-testid="profil-seridi">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="text-muted-foreground">Profil: </span>
          <span className="font-medium" data-testid="etkin-profil">{activeLabel(view)}</span>
          {activeLabel(view) === "Özel" && <span className="text-xs text-muted-foreground"> — seçiminiz hiçbir profille birebir aynı değil</span>}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={busy || kirli}
          title={kirli ? "Önce değişiklikleri kaydedin; profil kayıtlı seçimden oluşur." : undefined}
          onClick={() => {
            s.renewAttempt();
            setNameFor({ chip: null });
          }}
        >
          <Save className="h-4 w-4" /> Profili kaydet
        </Button>
      </div>
      <div role="group" aria-label="Profil seç" className="flex flex-wrap gap-1.5">
        {chips.map((c) => {
          const on = view.etkin.includes(c.key);
          return (
            <span key={c.key} className={cn("inline-flex items-center rounded-full border text-xs", on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground")}>
              <button
                type="button"
                aria-pressed={on}
                title={c.ipucu}
                disabled={busy}
                onClick={() => pick(c)}
                className={cn("inline-flex items-center gap-1 rounded-full px-3 py-1 font-medium hover:text-foreground disabled:cursor-not-allowed", c.kisisel && "pr-1.5")}
                data-testid={`profil-${c.key}`}
              >
                {on && <Check className="h-3.5 w-3.5" aria-hidden />}
                {c.ad}
              </button>
              {c.kisisel && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" disabled={busy} aria-label={`${c.ad} — profil işlemleri`} className="mr-1 rounded-full p-0.5 hover:bg-muted">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem disabled={kirli} onSelect={() => s.update.mutate({ id: c.id!, seciminiGuncelle: true })}>Şu anki seçimle güncelle</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setNameFor({ chip: c })}>Yeniden adlandır</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onSelect={() => setConfirm({ kind: "sil", chip: c })}>Sil…</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </span>
          );
        })}
      </div>
      <ProfileNameDialog
        open={nameFor !== null}
        mevcutAd={nameFor?.chip?.ad ?? null}
        pending={s.create.isPending || s.update.isPending}
        onClose={() => setNameFor(null)}
        onSubmit={(ad) => {
          const chip = nameFor?.chip;
          const done = { onSuccess: () => setNameFor(null) };
          if (chip) s.update.mutate({ id: chip.id!, ad }, done);
          else s.create.mutate(ad, done);
        }}
      />
      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm?.kind === "sil" ? "Profil silinsin mi?" : "Profil uygulansın mı?"}</DialogTitle>
            <DialogDescription>
              {confirm?.kind === "sil"
                ? `“${confirm.chip.ad}” profili silinir. Bildirim seçiminiz değişmez.`
                : `Kaydedilmemiş değişiklikleriniz kaybolur ve “${confirm?.chip.ad ?? ""}” profili uygulanır.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Vazgeç</Button>
            <Button
              variant={confirm?.kind === "sil" ? "destructive" : "default"}
              onClick={() => {
                if (confirm?.kind === "sil") s.remove.mutate(confirm.chip.id!);
                else if (confirm) s.apply.mutate(confirm.chip);
                setConfirm(null);
              }}
            >
              {confirm?.kind === "sil" ? "Sil" : "Uygula"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
