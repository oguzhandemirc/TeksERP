// =============================================================================
// İPLİK SEVKİ — "Boş levent gövdeleri" kartı (devere ek B4; backend B2 `beamBodyIds`)
// =============================================================================
// Yalnız `devere.beamBodyMode≠OFF` iken çizilir (OFF = bugünkü form, gövde alanı yok). İsteğe bağlı: hiç seçilmezse
// sevk gövdesiz gider. Seçim: QR/no okut (Enter → `/resolve`) ya da listeden seç (modal, yalnız "Depoda boş").
// Uygunluk kararı sunucuda (sevk 409 BEAM_BODY_STATE); burada yalnız açıkça uygun olmayanı eklemeden söyleriz.
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cylinder, ListChecks, ScanLine, X } from "lucide-react";
import { toast } from "sonner";
import { MultiSelectCheckboxList } from "@/components/forms/MultiSelectCheckboxList";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDevereBeamBodyMode } from "@/hooks/usePricingEnabled";
import { dimsText, ownerText } from "@/pages/BeamBodies/model";
import { BEAM_BODIES_QUERY_KEY, beamBodyService, listBeamBodiesForPicker } from "@/pages/BeamBodies/service";
import type { BeamBody } from "@/pages/BeamBodies/types";

/** Backend `BEAM_BODY_DISPATCH_MAX`. */
export const DISPATCH_BEAM_BODY_MAX = 50;

/** Kartın bağlama göre metni — varsayılan iplik sevki; içeride sarım (SAR) kendi metnini verir. */
export interface BeamBodyCardCopy {
  hint: string;
  empty: string;
  notEmptyStock: string;
  overMax: (max: number) => string;
  pickDescription: (max: number) => string;
}

const DISPATCH_COPY: BeamBodyCardCopy = {
  hint: "· isteğe bağlı — iplikle birlikte devereciye giden boş gövdeler; irsaliyeye basılır",
  empty: "Gövde seçilmedi — sevk gövdesiz gider.",
  notEmptyStock: "yalnız depoda boş gövde iplikle gönderilir.",
  overMax: (max) => `Bir sevkte en çok ${max} gövde.`,
  pickDescription: (max) => `İplikle birlikte devereciye gidecek gövdeleri işaretleyin (en çok ${max}).`,
};

export function DispatchBeamBodies({ value, onChange, max = DISPATCH_BEAM_BODY_MAX, copy = DISPATCH_COPY }: { value: BeamBody[]; onChange: (v: BeamBody[]) => void; max?: number; copy?: BeamBodyCardCopy }) {
  const mode = useDevereBeamBodyMode();
  const [code, setCode] = useState("");
  const [picking, setPicking] = useState(false);
  if (mode === "OFF") return null;

  const add = (b: BeamBody) => {
    if (value.some((x) => x.id === b.id)) return;
    if (!b.isActive || b.status !== "EMPTY_STOCK") {
      toast.error(`${b.bodyNo} şu an “${b.statusLabel}” — ${copy.notEmptyStock}`);
      return;
    }
    if (value.length >= max) {
      toast.error(copy.overMax(max));
      return;
    }
    onChange([...value, b]);
  };
  const scan = async () => {
    const c = code.trim();
    if (!c) return;
    try {
      add(await beamBodyService.resolve(c));
      setCode("");
    } catch {
      // 404 BEAM_BODY_NOT_FOUND: sunucunun cümlesini genel bildirim bastı.
    }
  };

  return (
    <section className="rounded-xl border border-card-border bg-card shadow-card" aria-label="Boş levent gövdeleri">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Cylinder className="h-4 w-4 text-primary" />
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Boş levent gövdeleri</h3>
        <span className="hidden text-xs text-muted-foreground sm:inline">{copy.hint}</span>
      </header>
      <div className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-80">
            <ScanLine className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Gövde no okut"
              className="pl-8 font-mono"
              placeholder="QR okut ya da no yaz, Enter"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void scan();
                }
              }}
            />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setPicking(true)}>
            <ListChecks className="mr-1 h-4 w-4" /> Listeden seç
          </Button>
        </div>
        {value.length === 0 ? (
          <p className="text-xs text-muted-foreground">{copy.empty}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5" aria-label="Seçili gövdeler">
            {value.map((b) => (
              <li key={b.id} className="flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pl-2 pr-1 text-sm">
                <span className="font-mono">{b.bodyNo}</span>
                <span className="text-xs text-muted-foreground">{b.owner.kind === "OURS" ? "" : `· ${b.owner.customer?.name ?? b.owner.label}`}</span>
                <button type="button" className="rounded p-0.5 hover:bg-muted" aria-label={`${b.bodyNo} çıkar`} onClick={() => onChange(value.filter((x) => x.id !== b.id))}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {picking && <PickDialog selected={value} max={max} description={copy.pickDescription(max)} onClose={() => setPicking(false)} onPick={(bs) => onChange(bs.slice(0, max))} />}
    </section>
  );
}

function PickDialog({ selected, max, description, onClose, onPick }: { selected: BeamBody[]; max: number; description: string; onClose: () => void; onPick: (b: BeamBody[]) => void }) {
  const q = useQuery({ queryKey: [BEAM_BODIES_QUERY_KEY, "dispatch-picker"], queryFn: () => listBeamBodiesForPicker({ status: "EMPTY_STOCK", active: "active" }), staleTime: 0 });
  const [ids, setIds] = useState<string[]>(selected.map((b) => b.id));
  const list = q.data ?? [];
  const items = list.map((b) => ({ id: b.id, label: b.bodyNo, hint: `${ownerText(b.owner)} · ${dimsText(b)}`, group: b.place.warehouse?.name ?? "Depo belirtilmemiş" }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Depoda boş gövdeler</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <MultiSelectCheckboxList items={items} value={ids} onChange={setIds} columns={3} placeholder="Gövde no ara…" emptyHint={q.isLoading ? "Yükleniyor…" : "Depoda boş gövde yok."} />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Vazgeç</Button>
          <Button
            type="button"
            disabled={ids.length > max}
            onClick={() => {
              const byId = new Map([...selected, ...list].map((b) => [b.id, b]));
              onPick(ids.map((id) => byId.get(id)).filter((b): b is BeamBody => Boolean(b)));
              onClose();
            }}
          >
            Seç ({ids.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
