// =============================================================================
// HURDA (SCRAPPED, önizlemeli, sebep ZORUNLU) ve GERİ AL (LIFO durum olayı · tüketim) diyalogları
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { warpBeamService } from "../service";
import { formatM, type WarpBeam } from "../types";
import { BeamDialogShell, ReasonCodeSelect, ReasonField } from "./BeamDialogShell";
import { STATUS_EVENT_LABEL, undoCandidates } from "./beam-undo";
import { useBeamReasons } from "./useBeamReasons";

interface ScrapProps {
  target: WarpBeam;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (reasonCode: string, reason: string | null) => void;
}

export function ScrapDialog({ target, isPending, onClose, onConfirm }: ScrapProps) {
  const [reasonCode, setReasonCode] = useState("");
  const [reason, setReason] = useState("");
  const presets = useBeamReasons("WARP_BEAM_SCRAP");
  const preview = useQuery({ queryKey: ["warp-beams", "scrap-preview", target.id], queryFn: () => warpBeamService.scrapPreview(target.id) });
  const p = preview.data?.data;
  return (
    <BeamDialogShell
      title={`${target.beamNo} hurdaya ayrılsın mı?`}
      description="Gerçek fire kararı: kalan metre fire yazılır, levent SON durumuna geçer (tezgahtaysa yuva boşalır). Defter satırı silinmez; geri alınabilir (LIFO)."
      confirmLabel="Hurdaya Ayır"
      destructive
      ok={reasonCode !== "" && !!p}
      isPending={isPending}
      onClose={onClose}
      onConfirm={() => onConfirm(reasonCode, reason.trim() || null)}
    >
      {preview.isError ? (
        <p className="text-destructive text-sm">Önizleme alınamadı — bu bir “etkisi yok” cevabı DEĞİLDİR.</p>
      ) : p ? (
        <ul className="space-y-1 text-sm">
          <li>Fire yazılacak kalan: <strong>{formatM(p.remainingM)}</strong></li>
          <li>Tezgah: {p.currentMachine ? `${p.currentMachine.name} · yuva ${p.currentPosition}` : "bağlı değil"}{p.openRunsOnMachine > 0 ? ` · makinede ${p.openRunsOnMachine} açık koşum (son leventse reddedilir)` : ""}</li>
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">Önizleme yükleniyor…</p>
      )}
      <ReasonCodeSelect label="Hurda sebebi (katalog) *" value={reasonCode} onChange={setReasonCode} presets={presets} />
      <ReasonField id="wb-scrap-reason" value={reason} onChange={setReason} />
    </BeamDialogShell>
  );
}

interface UndoProps {
  target: WarpBeam;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (pick: { kind: "status" | "consumed"; eventId: string }, reason: string) => void;
}

const fmtTs = (iso: string) => new Date(iso).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });

export function UndoDialog({ target, isPending, onClose, onConfirm }: UndoProps) {
  const [pick, setPick] = useState("");
  const [reason, setReason] = useState("");
  const detail = useQuery({ queryKey: ["warp-beams", "detail", target.id, "undo"], queryFn: () => warpBeamService.getById(target.id) });
  const c = detail.data ? undoCandidates(detail.data.data.events) : null;
  const options = c ? [...(c.lifo ? [{ id: c.lifo.id, kind: "status" as const, label: `${STATUS_EVENT_LABEL[c.lifo.kind] ?? c.lifo.kind} · ${fmtTs(c.lifo.createdAt)}${c.lifo.lengthM != null ? ` · ${formatM(c.lifo.lengthM)}` : ""} (son durum olayı)` }] : []), ...c.consumed.map((e) => ({ id: e.id, kind: "consumed" as const, label: `Tüketim ${formatM(e.lengthM)} · ${fmtTs(e.createdAt)}` }))] : [];
  const chosen = options.find((o) => o.id === pick) ?? null;
  const ok = chosen != null && reason.trim().length >= 3;
  return (
    <BeamDialogShell
      title={`${target.beamNo} — kaydı geri al`}
      description="Geri alma ileri kaydı silmez; ters satır yazar. Durum olayları yalnız en yeniden başlayarak (LIFO), tüketimler tek tek geri alınır."
      confirmLabel="Geri Al"
      destructive
      ok={ok}
      isPending={isPending}
      onClose={onClose}
      onConfirm={() => chosen && onConfirm({ kind: chosen.kind, eventId: chosen.id }, reason.trim())}
    >
      {detail.isError ? (
        <p className="text-destructive text-sm">Olay defteri okunamadı.</p>
      ) : !c ? (
        <p className="text-muted-foreground text-sm">Olay defteri yükleniyor…</p>
      ) : options.length === 0 ? (
        <p className="text-muted-foreground text-sm">Bu uçtan geri alınabilecek kayıt yok{c.blockedBy ? ` — son durum olayı ${STATUS_EVENT_LABEL[c.blockedBy] ?? c.blockedBy}, kendi ekranından geri alınır` : ""}.</p>
      ) : (
        <div className="space-y-1">
          <Label>Geri alınacak kayıt</Label>
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger>
              <SelectValue placeholder="Kayıt seç" />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <ReasonField id="wb-undo-reason" value={reason} onChange={setReason} label="Gerekçe *" required />
    </BeamDialogShell>
  );
}
