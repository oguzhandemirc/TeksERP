import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, KeyRound, RotateCcw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiErrorMessage } from "@/services/apiClient";
import { safeFormat } from "@/lib/format";
import { deviceService } from "./service";
import { deviceKindLabel } from "./DeviceRow";
import {
  PROOF_LOST_QUERY_KEY, defaultProofResetSelection, proofResetNote, proofResetOutcomeText, useProofLost,
} from "./proof";
import type { ProofLostDevice, ProofResetOutcome } from "./types";

const fmt = (iso: string | null) => (iso ? safeFormat(iso, "dd.MM.yyyy HH:mm") : "—");

/** Emanet geri yükleme ekranı: Kullanıcılar → Kısa kimlikler diyaloğu (`?kisa=1` açık gelir). */
export const KEY_RESTORE_PATH = "/access/users?kisa=1";

function OutcomeRow({ outcome: o }: { outcome: ProofResetOutcome }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <span className="min-w-0 break-all font-medium">{o.name ?? o.id}</span>
      <Badge variant={o.sonuc === "SIFIRLANDI" ? "default" : "muted"}>{proofResetOutcomeText(o)}</Badge>
    </li>
  );
}

function DeviceChoiceRow({ device: d, checked, onToggle }: { device: ProofLostDevice; checked: boolean; onToggle: (v: boolean) => void }) {
  return (
    <li className="flex items-start gap-3 py-2">
      <Checkbox
        id={`proof-${d.id}`}
        checked={checked}
        onCheckedChange={(v) => onToggle(v === true)}
        aria-label={`${d.name} seç`}
        className="mt-0.5"
      />
      <label htmlFor={`proof-${d.id}`} className="min-w-0 flex-1 space-y-0.5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-all font-medium">{d.name}</span>
          <span className="text-muted-foreground">· {deviceKindLabel(d.kind)}</span>
          {d.machine && <span className="text-muted-foreground">· {d.machine.name}</span>}
          <Badge variant={d.hasHw ? "secondary" : "muted"}>{d.hasHw ? "donanım kimliği var" : "donanım kimliği yok"}</Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          Son görülme {fmt(d.lastSeenAt)} · {proofResetNote(d)}
        </div>
      </label>
    </li>
  );
}

/**
 * Seçimli toplu yeniden bağlama (D5): liste backend'in yazmayan önizlemesidir; yalnız işaretlenen
 * cihazların kanıtı sıfırlanır. Sonuç kayıt kayıt aynı diyalogda gösterilir.
 */
export function ProofResetDialog({
  devices,
  open,
  onClose,
}: {
  devices: readonly ProofLostDevice[];
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ProofResetOutcome[] | null>(null);
  // Yalnız AÇILIŞTA sıfırla: başarı sonrası liste tazelenince sonuç ekranı silinip kalan cihazlar
  // seçili halde yeniden önizlemeye düşmesin (ikinci tık istenmeden onları da sıfırlardı).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setSelected(defaultProofResetSelection(devices));
      setResult(null);
    }
    wasOpen.current = open;
  }, [open, devices]);
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const reset = useMutation({
    mutationFn: () => deviceService.proofReset([...selected]),
    onSuccess: (r) => {
      setResult(r.sonuclar);
      const n = r.sonuclar.filter((s) => s.sonuc === "SIFIRLANDI").length;
      toast.success(`${n} cihaz yeniden bağlanmaya hazırlandı`);
      void qc.invalidateQueries({ queryKey: [PROOF_LOST_QUERY_KEY] });
      void qc.invalidateQueries({ queryKey: ["admin-devices"] });
    },
    onError: (e) => {
      // eslint-disable-next-line yerel/mutation-onerror-toast -- istek suppressErrorToast taşır; tek toast burası
      toast.error(apiErrorMessage(e, "Yeniden bağlama yapılamadı"));
      void qc.invalidateQueries({ queryKey: [PROOF_LOST_QUERY_KEY] });
    },
  });
  const n = selected.size;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>{result ? "Yeniden bağlama sonucu" : "Toplu yeniden bağlama önizlemesi"}</DialogTitle>
          <DialogDescription>
            {result
              ? "Tablet bir sonraki açılışında aynı donanımla gelirse yeni anahtarını kendiliğinden alır."
              : "Seçtiğiniz cihazların eski kimlik anahtarı silinir. Tablet açılınca aynı donanımla gelirse yeni anahtar alır; başka bir donanımla gelirse onay bekleyene düşer."}
          </DialogDescription>
        </DialogHeader>

        <ul className="-mx-1 min-h-0 flex-1 divide-y overflow-y-auto px-1" aria-label="Kanıtı doğrulanamayan cihazlar">
          {result
            ? result.map((o) => <OutcomeRow key={o.id} outcome={o} />)
            : devices.map((d) => (
              <DeviceChoiceRow key={d.id} device={d} checked={selected.has(d.id)} onToggle={(v) => toggle(d.id, v)} />
            ))}
        </ul>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {result ? (
            <Button onClick={onClose}>Kapat</Button>
          ) : (
            <div className="flex flex-wrap justify-end gap-2 self-end">
              <Button variant="outline" onClick={onClose}>
                Vazgeç
              </Button>
              <Button onClick={() => reset.mutate()} disabled={n === 0 || reset.isPending}>
                <RotateCcw className="mr-1 h-4 w-4" />
                Seçilen {n} cihazı yeniden bağla
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Cihazlar sayfası bandı (D5): anahtar halkası kaybı ve kanıtı doğrulanamayan cihazlar. İlk öneri
 * emaneti geri yüklemektir (PIN/kart düzelir; yalnız cihaz tuzundaki kid dönmez); ikinci yol seçimli toplu yeniden bağlama.
 */
export function ProofLostPanel({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const navigate = useNavigate();
  const query = useProofLost();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expanded, setExpanded] = useState(initiallyOpen);
  useEffect(() => { if (initiallyOpen) setExpanded(true); }, [initiallyOpen]);
  const data = query.data;
  if (!data) return null;
  const { halkaKaybi, cihazlar, bekleyenler } = data;
  if (!halkaKaybi && cihazlar.length === 0 && bekleyenler.length === 0) return null;

  return (
    <section
      aria-label="Anahtar kaybı"
      className="rounded-md border border-red-300 bg-red-50/70 p-4 dark:border-red-900 dark:bg-red-950/30"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-red-900 dark:text-red-200">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          {cihazlar.length > 0
            ? `Anahtar kaybı: ${cihazlar.length} cihazın kimliği doğrulanamıyor`
            : "Anahtar kaybı: yeniden bağlanmayı bekleyen cihazlar var"}
        </div>
        <Button size="sm" variant="outline" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? "Gizle" : "İncele"}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {halkaKaybi
          ? `Sunucunun kimlik anahtarı ${fmt(halkaKaybi.tespit)} tarihinde kaybolmuş ve yenisi üretilmiş. `
          : ""}
        Bu cihazlar eski anahtarla tanınıyordu; cihaz doğrulaması zorunluysa giriş yapamazlar.
        {halkaKaybi && halkaKaybi.etkilenen.pin + halkaKaybi.etkilenen.kart + halkaKaybi.etkilenen.totp > 0
          ? ` Ayrıca ${halkaKaybi.etkilenen.pin} hızlı PIN, ${halkaKaybi.etkilenen.kart} kart ve ${halkaKaybi.etkilenen.totp} iki adımlı doğrulama etkileniyor.`
          : ""}
      </p>
      {expanded && (
        <div className="mt-3 space-y-3">
          <ol className="space-y-2 text-sm">
            <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background/70 p-3">
              <div className="min-w-0">
                <div className="font-medium">1. Önerilen: yedekten anahtarı geri yükleyin</div>
                <div className="text-xs text-muted-foreground">
                  Yedek parolasıyla eski anahtar geri konunca PIN'ler ve kartlar kendiliğinden düzelir. Yalnız cihaz kanıtında kullanılan anahtarlar yedekten dönmez; o cihazlar yine yeniden bağlama ister.
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => navigate(KEY_RESTORE_PATH)}>
                <KeyRound className="mr-1 h-4 w-4" />
                Anahtarı geri yükle
              </Button>
            </li>
            {cihazlar.length > 0 && (
              <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background/70 p-3">
                <div className="min-w-0">
                  <div className="font-medium">2. Yedek yoksa: cihazları yeniden bağlayın</div>
                  <div className="text-xs text-muted-foreground">
                    Seçtiğiniz cihazlar açılınca aynı donanımla yeni anahtar alır.
                  </div>
                </div>
                <Button size="sm" onClick={() => setDialogOpen(true)}>
                  <RotateCcw className="mr-1 h-4 w-4" />
                  Toplu yeniden bağla
                </Button>
              </li>
            )}
          </ol>
          {bekleyenler.length > 0 && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <span className="min-w-0">
                Tabletin açılmasını bekleyen {bekleyenler.length} cihaz: {bekleyenler.map((d) => d.name).join(", ")}
              </span>
            </div>
          )}
        </div>
      )}
      <ProofResetDialog devices={cihazlar} open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </section>
  );
}
