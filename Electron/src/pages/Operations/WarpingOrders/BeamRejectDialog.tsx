// =============================================================================
// DEVERECİYE GERİ GÖNDER — kusurlu sarım reddi → `POST /api/warping-beam-rejections` (devere ek C2)
// =============================================================================
// Sarım(lar) · sebep (katalog `WARP_BEAM_REJECT`) · kip (yeniden sarılsın / iptal) · fotoğraf · not · tarih. "Önizle"
// (yazmaz): etkilenen her sarım, deverecinin bakiyesine dönecek iplik, fatura uyarısı, engeller. Girdi önizlemeden
// sonra değişirse "Gönder" kapanır. Başarıda ret belgesi açılır (basım). Token mantıksal deneme başına.
// =============================================================================
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ClipboardList, Eye, ListChecks } from "lucide-react";
import { FieldGrid, FormCard, WideFormColumns, WideFormDialog } from "@/components/forms/WideFormDialog";
import { FormField } from "@/components/forms/FormField";
import { DateTimeInput } from "@/components/forms/DateTimeInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useAttemptToken } from "@/lib/attemptToken";
import { fromFactoryDateTimeInput } from "@/lib/factory-time";
import { toastServerSuccess } from "@/lib/serverNotes";
import { reasonPresetService } from "@/pages/ReasonPresets/service";
import { readFileBase64 } from "@/pages/Quality/Certificates/service";
import { BeamChecklist, ModeRadios, PhotoPicker, ReasonRadios, RejectPreviewView, type PickedPhoto } from "./RejectParts";
import { buildRejectBody, MAX_REJECT_PHOTOS, photoProblem, type RejectBeamOption, type RejectDraft } from "./rejection-model";
import { warpingRejectionService } from "./rejection-service";
import { WARPING_ORDERS_QUERY_KEY } from "./service";
import type { WarpingOrder } from "./types";
import type { WarpingBeamRejection, WarpingBeamRejectionFields, WarpingBeamRejectionPreview } from "./rejection-types";

const toIso = (v: string) => fromFactoryDateTimeInput(v)?.toISOString() ?? null;

function useReasons() {
  const q = useQuery({ queryKey: ["reason-presets", "WARP_BEAM_REJECT"], queryFn: () => reasonPresetService.list(false) });
  return (q.data ?? []).filter((r) => r.kind === "WARP_BEAM_REJECT" && r.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
}

function usePhotos() {
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const add = (files: File[]) => {
    const bad = files.map(photoProblem).find(Boolean) ?? null;
    const ok = files.filter((f) => !photoProblem(f));
    const room = MAX_REJECT_PHOTOS - photos.length;
    setError(bad ?? (ok.length > room ? `En çok ${MAX_REJECT_PHOTOS} fotoğraf eklenir.` : null));
    setPhotos([...photos, ...ok.slice(0, room).map((file) => ({ key: `${file.name}|${file.size}|${file.lastModified}`, file }))]);
  };
  return { photos, error, add, remove: (key: string) => setPhotos(photos.filter((p) => p.key !== key)) };
}

function PreviewCard({ error, data, stale }: { error: string | null; data: WarpingBeamRejectionPreview | null; stale: boolean }) {
  return (
    <FormCard title="Önizleme" icon={Eye}>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!data && <p className="text-sm text-muted-foreground">{stale ? "Girdi değişti — göndermeden önce yeniden önizleyin." : "Sarım ve sebep seçip “Önizle”ye basın: dönecek iplik ve engeller burada görünür."}</p>}
      {data && <RejectPreviewView p={data} />}
    </FormCard>
  );
}

interface Props { order: WarpingOrder; options: RejectBeamOption[]; initialBeamId: string; onClose: () => void; onCreated: (doc: WarpingBeamRejection) => void }

export function BeamRejectDialog({ order, options, initialBeamId, onClose, onCreated }: Props) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const reasons = useReasons();
  const photoRequired = useFeatureFlags().data?.data?.devereRejectPhotoRequired === true;
  const ph = usePhotos();
  const [d, setD] = useState<RejectDraft>({ beamIds: [initialBeamId], reasonCode: "", reasonText: "", notes: "", expectRework: true, rejectedAt: "" });
  const set = <K extends keyof RejectDraft>(k: K, v: RejectDraft[K]) => setD({ ...d, [k]: v });
  const reason = reasons.find((r) => r.code === d.reasonCode);
  const built = buildRejectBody(order.id, d, reason?.requiresText ?? false, toIso);
  const key = built.ok ? JSON.stringify([built.body, ph.photos.length]) : null;
  const [preview, setPreview] = useState<{ key: string; data: WarpingBeamRejectionPreview } | null>(null);
  const pv = useMutation({
    mutationFn: (v: { b: WarpingBeamRejectionFields; key: string; photoCount: number }) => warpingRejectionService.preview({ ...v.b, photoCount: v.photoCount }),
    onSuccess: (data, v) => setPreview({ key: v.key, data }),
  });
  const save = useMutation({
    mutationFn: async (b: WarpingBeamRejectionFields) => {
      const photos = await Promise.all(ph.photos.map(async (p) => ({ fileName: p.file.name, contentBase64: await readFileBase64(p.file) })));
      return warpingRejectionService.create({ ...b, clientToken: attempt.token(), photos });
    },
    onSuccess: (res) => {
      attempt.onSuccess();
      toastServerSuccess(res, "Ret belgesi açıldı.");
      void qc.invalidateQueries({ queryKey: [WARPING_ORDERS_QUERY_KEY] });
      onCreated(res.data);
    },
    onError: (e) => attempt.onFailure(e),
  });
  const fresh = preview !== null && preview.key === key;
  const canSend = fresh && preview.data.rejectable && built.ok && !(photoRequired && ph.photos.length === 0) && !save.isPending;
  const main = (
    <>
      <FormCard title="Sarımlar" icon={ListChecks} note="aynı siparişten, depoda hazır">
        <BeamChecklist options={options} selected={d.beamIds} onChange={(ids) => set("beamIds", ids)} />
      </FormCard>
      <FormCard title="Sebep ve karar" icon={ClipboardList}>
        <div className="space-y-4">
          <ReasonRadios options={reasons} value={d.reasonCode} onChange={(c) => set("reasonCode", c)} />
          <FormField label="Açıklama" htmlFor="brj-text" required={reason?.requiresText} hint={reason?.requiresText ? "Bu sebepte en az 3 karakter." : "İsteğe bağlı; belgeye sebep yerine basılır."}>
            <Input id="brj-text" maxLength={300} value={d.reasonText} onChange={(e) => set("reasonText", e.target.value)} />
          </FormField>
          <FormField label="Sonra ne olacak?" info="Her iki kipte de reddedilen sarımın ipliği deverecinin bakiyesine geri yazılır; reddedilen sarım devere faturasına girmez.">
            <ModeRadios value={d.expectRework} onChange={(v) => set("expectRework", v)} />
          </FormField>
        </div>
      </FormCard>
      <FormCard title="Fotoğraf ve not" icon={Camera}>
        <div className="space-y-4">
          <PhotoPicker photos={ph.photos} onAdd={ph.add} onRemove={ph.remove} required={photoRequired} />
          {ph.error && <p className="text-sm text-destructive">{ph.error}</p>}
          <FieldGrid cols={2}>
            <FormField label="Ret tarihi" htmlFor="brj-date" hint="Boş bırakılırsa şimdi."><DateTimeInput id="brj-date" value={d.rejectedAt} onChange={(v) => set("rejectedAt", v)} /></FormField>
            <FormField label="Not" htmlFor="brj-notes"><Textarea id="brj-notes" rows={2} maxLength={500} value={d.notes} onChange={(e) => set("notes", e.target.value)} /></FormField>
          </FieldGrid>
        </div>
      </FormCard>
    </>
  );
  const side = <PreviewCard error={built.ok ? null : built.error} data={fresh ? preview.data : null} stale={preview !== null} />;
  return (
    <WideFormDialog open onOpenChange={(o) => !o && onClose()} title={`${order.orderNo} — devereciye geri gönder`}
      description={`Kusurlu sarımı ${order.subcontractor.name} deverecisine iade eder; numaralı ret belgesi basılır.`}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button variant="outline" disabled={!built.ok || pv.isPending} onClick={() => built.ok && key && pv.mutate({ b: built.body, key, photoCount: ph.photos.length })}>{pv.isPending ? "Önizleniyor…" : "Önizle"}</Button>
          <Button variant="destructive" disabled={!canSend} onClick={() => built.ok && save.mutate(built.body)}>{save.isPending ? "Gönderiliyor…" : "Gönder ve belge bas"}</Button>
        </>
      )}>
      <WideFormColumns main={main} side={side} sideWidth="half" />
    </WideFormDialog>
  );
}
