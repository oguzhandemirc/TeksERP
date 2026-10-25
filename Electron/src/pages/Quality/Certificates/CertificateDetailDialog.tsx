// Sertifika ayrıntısı — belgeler (yükle / indir / kaldır), düzenle, yenile, iptal. Etkin olmayan sertifika
// (iptal/yenilenmiş) salt okunur; geçmiş "ne oldu" olarak kalır.
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Trash2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { apiErrorText } from "@/lib/api-error";
import { fmtCalendarDay, fmtFactoryDateTime } from "@/lib/factory-time";
import { certificateService, readFileBase64, type CertificateDetail } from "./service";
import { HOLDER_LABEL, MAX_FILE_BYTES, fileSizeText } from "./certificateRules";
import { ExpiryPill } from "./CertificateList";

interface Props { certificateId: string; soonDays: number; onClose: () => void; onEdit: (c: CertificateDetail) => void; onRenew: (c: CertificateDetail) => void; onRevoke: (id: string) => void }

export function CertificateDetailDialog({ certificateId, soonDays, onClose, onEdit, onRenew, onRevoke }: Props) {
  const { hasPermission } = useRoleAccess();
  const canWrite = hasPermission("certificate:write");
  const detail = useQuery({ queryKey: ["certificates", "detail", certificateId], queryFn: () => certificateService.get(certificateId) });
  const c = detail.data;
  const editable = Boolean(c?.active && canWrite);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {c ? <>{c.standard} <span className="font-mono text-sm text-muted-foreground">{c.certificateNo}</span> <ExpiryPill row={c} soonDays={soonDays} /></> : "Sertifika"}
          </DialogTitle>
          <DialogDescription>{c ? (c.holder === "OWN" ? HOLDER_LABEL.OWN : `İş ortağı: ${c.partner?.name ?? "—"}`) : "Yükleniyor…"}</DialogDescription>
        </DialogHeader>
        {detail.isError ? <p className="text-sm text-destructive">{apiErrorText(detail.error, "Sertifika okunamadı.")}</p> : c && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              <Field k="Veren kuruluş" v={c.issuer ?? "—"} />
              <Field k="Veriliş" v={fmtCalendarDay(c.issuedOn)} />
              <Field k="Bitiş" v={fmtCalendarDay(c.expiresOn)} />
              <Field k="Kaydeden" v={c.createdBy?.fullName ?? "—"} />
              {c.renews && <Field k="Yerine geçtiği" v={`${c.renews.certificateNo} (bitiş ${fmtCalendarDay(c.renews.expiresOn)})`} />}
              {c.renewedBy && <Field k="Yenileyen" v={`${c.renewedBy.certificateNo} (bitiş ${fmtCalendarDay(c.renewedBy.expiresOn)})`} />}
              {c.revokedAt && <Field k="İptal" v={`${fmtFactoryDateTime(c.revokedAt)} · ${c.revokedBy?.fullName ?? "—"} — ${c.revokeReason ?? ""}`} />}
            </dl>
            {c.scope && <p className="whitespace-pre-wrap"><span className="text-muted-foreground">Kapsam: </span>{c.scope}</p>}
            {c.note && <p className="whitespace-pre-wrap"><span className="text-muted-foreground">Not: </span>{c.note}</p>}

            <FilesSection cert={c} editable={editable} />
          </div>
        )}
        <DialogFooter className="flex-wrap gap-2">
          {c && editable && (
            <>
              <Button variant="destructive" onClick={() => onRevoke(c.id)}>İptal et…</Button>
              <Button variant="outline" onClick={() => onEdit(c)}>Düzenle</Button>
              <Button onClick={() => onRenew(c)}>Yenile…</Button>
            </>
          )}
          <Button variant="outline" onClick={onClose}>Kapat</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return <div><dt className="text-xs text-muted-foreground">{k}</dt><dd>{v}</dd></div>;
}

function FilesSection({ cert, editable }: { cert: CertificateDetail; editable: boolean }) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["certificates"] });
  const upload = useMutation({
    mutationFn: async (file: File) => certificateService.uploadFile(cert.id, file.name, await readFileBase64(file)),
    onSuccess: (r) => { refresh(); toast.success(r.duplicate ? "Bu belge zaten ekli — yeniden eklenmedi." : `${r.file.fileName} eklendi.`); },
  });
  const remove = useMutation({ mutationFn: (fileId: string) => certificateService.deleteFile(cert.id, fileId), onSuccess: refresh });
  const pick = (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    // Boyut erken söylenir; tür denetimi sunucuda sihirli bayttan (uzantıya/beyana güvenilmez).
    if (file.size > MAX_FILE_BYTES) { setFileError("Dosya 5 MB sınırını aşıyor; küçültüp yeniden yükleyin."); return; }
    upload.mutate(file);
  };
  const download = async (fileId: string, name: string) => {
    try {
      const url = URL.createObjectURL(await certificateService.downloadFile(cert.id, fileId));
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error(apiErrorText(e, "Belge indirilemedi.")); }
  };
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">Belgeler</h3>
        {editable && (
          <>
            <input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" aria-label="Belge dosyası"
              onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
            <Button size="sm" variant="outline" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
              <Upload className="mr-1 h-4 w-4" />{upload.isPending ? "Yükleniyor…" : "Belge ekle"}
            </Button>
          </>
        )}
      </div>
      {fileError && <p className="text-xs text-destructive">{fileError}</p>}
      <div className="rounded-md border">
        {cert.files.length === 0 ? <p className="p-3 text-muted-foreground">Ekli belge yok. PDF, JPEG ya da PNG (en çok 5 MB) eklenebilir.</p> : cert.files.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 last:border-0">
            <div className="min-w-0">
              <p className="truncate">{f.fileName}</p>
              <p className="text-xs text-muted-foreground">{fileSizeText(f.sizeBytes)} · {fmtFactoryDateTime(f.createdAt)} · {f.uploadedBy?.fullName ?? "—"}</p>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" aria-label={`${f.fileName} indir`} onClick={() => void download(f.id, f.fileName)}><Download className="h-4 w-4" /></Button>
              {editable && <Button size="sm" variant="ghost" aria-label={`${f.fileName} kaldır`} disabled={remove.isPending} onClick={() => remove.mutate(f.id)}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
