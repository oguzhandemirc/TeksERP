import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import {
  documentProfileService,
  type DocumentProfileRow,
} from "@/services/documentProfileService";
import type { DocumentsConfig } from "@/services/documentConfig";

// =============================================================================
// Belge şablon PROFİLİ çubuğu — hedef seçimi (Genel Ayarlar | profiller) +
// profil oluştur/pasifleştir. Profil = genel ayarın üzerine binen override paketi;
// müşteri/fason kartına atanır (Müşteriler / Fason Firmalar formundan).
// =============================================================================

export const PROFILES_QUERY_KEY = ["document-profiles"];

export function ProfileBar({
  selectedId,
  onSelect,
}: {
  /** null = Genel Ayarlar. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const qc = useQueryClient();
  const listQ = useQuery({
    queryKey: PROFILES_QUERY_KEY,
    queryFn: () => documentProfileService.list(),
  });
  const profiles = listQ.data?.data ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  const deactivateMut = useMutation({
    mutationFn: (id: string) => documentProfileService.deactivate(id),
    onSuccess: () => {
      toast.success("Profil pasifleştirildi — atanmış kartlar genel ayara döner.");
      onSelect(null);
      void qc.invalidateQueries({ queryKey: PROFILES_QUERY_KEY });
    },
  });

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-card p-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Düzenlenen:
      </span>
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`rounded-md border px-3 py-1 text-xs font-medium ${
          selectedId === null
            ? "border-primary bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted/70"
        }`}
      >
        Genel Ayarlar
      </button>
      {profiles.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSelect(p.id)}
          title={p.description ?? undefined}
          className={`rounded-md border px-3 py-1 text-xs font-medium ${
            selectedId === p.id
              ? "border-primary bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted/70"
          }`}
        >
          {p.name}
          {p._count ? (
            <span className="ml-1 text-[10px] text-muted-foreground">
              ({p._count.customers + p._count.subcontractors})
            </span>
          ) : null}
        </button>
      ))}
      <Button type="button" size="sm" variant="outline" className="h-7 gap-1"
        onClick={() => setCreateOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Profil
      </Button>
      {selected && (
        <Button type="button" size="sm" variant="ghost"
          className="h-7 gap-1 text-destructive hover:text-destructive"
          onClick={() => setConfirmDeactivate(true)}>
          <Trash2 className="h-3.5 w-3.5" /> Pasifleştir
        </Button>
      )}
      <span className="ml-auto text-[11px] text-muted-foreground">
        Profil, genel ayarın üzerine biner; müşteri/fason kartından atanır.
      </span>

      <CreateProfileDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        profiles={profiles}
        onCreated={(id) => {
          onSelect(id);
          void qc.invalidateQueries({ queryKey: PROFILES_QUERY_KEY });
        }}
      />
      <ConfirmDialog
        open={confirmDeactivate}
        onOpenChange={setConfirmDeactivate}
        title="Profili pasifleştir"
        description={`"${selected?.name ?? ""}" profili pasifleşecek: ${
          selected?._count
            ? `${selected._count.customers} müşteri + ${selected._count.subcontractors} fason firma ataması genel ayara döner.`
            : "atanmış kartlar genel ayara döner."
        } Kayıt silinmez, tekrar aktifleştirilebilir.`}
        confirmLabel="Pasifleştir"
        cancelLabel="Vazgeç"
        destructive
        onConfirm={() => {
          setConfirmDeactivate(false);
          if (selected) deactivateMut.mutate(selected.id);
        }}
      />
    </div>
  );
}

const SCRATCH = "__scratch__";

function CreateProfileDialog({
  open,
  onOpenChange,
  profiles,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Referans alınabilecek mevcut profiller (config'i kopyalanır). */
  profiles: DocumentProfileRow[];
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // Başlangıç noktası: sıfırdan (boş) VEYA başka bir profilin config'i kopyalanır.
  const [refId, setRefId] = useState<string>(SCRATCH);
  const mut = useMutation({
    mutationFn: async () => {
      let config: DocumentsConfig = {};
      if (refId !== SCRATCH) {
        // Referans profilin AYARLARINI kopyala (üstünde değişiklik yapılacak).
        const ref = await documentProfileService.get(refId);
        config = (ref.data?.config ?? {}) as DocumentsConfig;
      }
      return documentProfileService.create({
        name: name.trim(),
        description: description.trim() || null,
        config,
      });
    },
    onSuccess: (res) => {
      toast.success("Profil oluşturuldu.");
      setName("");
      setDescription("");
      setRefId(SCRATCH);
      onOpenChange(false);
      const id = (res.data as { id?: string } | null)?.id;
      if (id) onCreated(id);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Yeni Belge Şablon Profili</DialogTitle>
          <DialogDescription>
            {refId === SCRATCH
              ? "Sıfırdan başlar — boş bırakılan alanlar genel ayardan gelir."
              : "Seçilen profilin ayarları kopyalanarak başlar; üzerinde değişiklik yaparsın."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Başlangıç noktası</label>
            <Select value={refId} onValueChange={setRefId}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SCRATCH}>Sıfırdan (boş)</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    Referans: {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor="profile-name" className="text-xs font-medium">Ad (zorunlu)</label>
            <input
              id="profile-name"
              value={name}
              maxLength={80}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              placeholder="Örn. İhracat, Fiyatsız, X Müşterisi"
              className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label htmlFor="profile-desc" className="text-xs font-medium">Açıklama</label>
            <input
              id="profile-desc"
              value={description}
              maxLength={300}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button
            type="button"
            disabled={!name.trim() || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? "Oluşturuluyor…" : "Oluştur"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
