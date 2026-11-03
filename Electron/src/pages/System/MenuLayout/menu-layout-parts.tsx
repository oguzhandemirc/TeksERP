// Menü Düzeni ekranının parçaları (K19): grup satırları ve hazır set önizleme diyaloğu.
import { Eye, EyeOff, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { MenuPresetScreen } from "@/services/menuLayoutService";
import type { ScreenGroup } from "./menu-layout-tree";
import type { MenuPreset } from "./useMenuLayoutDraft";

interface GroupProps {
  group: ScreenGroup;
  hidden: ReadonlySet<string>;
  unhideable: ReadonlyMap<string, string>;
  advancedOn: boolean;
  advancedSet: ReadonlySet<string>;
  onToggle: (key: string) => void;
}

export function MenuGroupSection({ group, hidden, unhideable, advancedOn, advancedSet, onToggle }: GroupProps) {
  return (
    <section data-testid={`menu-group-${group.id}`}>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{group.title}</h2>
      <ul className="divide-y rounded-lg border">
        {group.screens.map((s) => {
          const lockReason = unhideable.get(s.key);
          const isHidden = hidden.has(s.key);
          return (
            <li key={`${s.app}:${s.key}`} className="flex items-center gap-3 px-3 py-2 text-sm" data-testid={`menu-row-${s.key}`}>
              <span className={isHidden ? "flex-1 text-muted-foreground line-through" : "flex-1"}>{s.title}</span>
              {advancedOn && advancedSet.has(s.key) && <span className="text-xs text-muted-foreground">Gelişmiş grubunda</span>}
              {lockReason ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground" title={lockReason}>
                  <Lock className="h-3.5 w-3.5" /> Gizlenemez — {lockReason}
                </span>
              ) : (
                <Button size="sm" variant={isHidden ? "outline" : "ghost"} onClick={() => onToggle(s.key)} aria-pressed={isHidden} data-testid={`menu-toggle-${s.key}`}>
                  {isHidden ? <><EyeOff className="mr-1 h-3.5 w-3.5" /> Gizli</> : <><Eye className="mr-1 h-3.5 w-3.5" /> Görünür</>}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface PresetProps {
  preset: MenuPreset | null;
  preview: MenuPresetScreen[];
  onCancel: () => void;
  onConfirm: () => void;
}

export function PresetPreviewDialog({ preset, preview, onCancel, onConfirm }: PresetProps) {
  return (
    <Dialog open={preset !== null} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>“{preset?.label}” seti uygulansın mı?</DialogTitle>
          <DialogDescription>
            Aşağıdaki ekranlar menüden gizlenecek (mevcut gizlenenler korunur). Veri silinmez, yetki değişmez; Kaydet'e
            basana kadar hiçbir şey yazılmaz.
          </DialogDescription>
        </DialogHeader>
        {preview.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="menu-preset-empty">Bu setteki ekranların hepsi zaten gizli.</p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-auto text-sm" data-testid="menu-preset-preview">
            {preview.map((s) => (
              <li key={s.key} className="rounded border px-2 py-1">
                <span className="font-medium">{s.title}</span>
                <span className="ml-1 text-xs text-muted-foreground">({s.app === "mobile" ? "tablet" : "panel"})</span>
                <div className="text-xs text-muted-foreground">{s.reason}</div>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Vazgeç</Button>
          <Button onClick={onConfirm} disabled={preview.length === 0} data-testid="menu-preset-confirm">
            Onayla ({preview.length} ekran)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
