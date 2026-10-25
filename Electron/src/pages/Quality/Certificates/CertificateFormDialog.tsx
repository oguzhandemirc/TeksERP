// Sertifika formu — yeni / düzenle / yenile. İş ortağı seçici MODAL (cari listesi); standart serbest metin,
// sunucunun önerdiği liste datalist'te. clientToken mantıksal deneme başına; yalnız belirsiz hatada yapışır.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { useAttemptToken } from "@/lib/attemptToken";
import { certificateService, type CertificateDetail, type CertificateFields, type CertificateHolder } from "./service";

export type CertificateFormMode = { kind: "create" } | { kind: "edit"; cert: CertificateDetail } | { kind: "renew"; cert: CertificateDetail };
interface Props { mode: CertificateFormMode; onOpenChange: (v: boolean) => void; onSaved: (id: string) => void }

const TITLE = { create: "Yeni sertifika", edit: "Sertifikayı düzenle", renew: "Sertifikayı yenile" } as const;
const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : "");

export function CertificateFormDialog({ mode, onOpenChange, onSaved }: Props) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const src = mode.kind === "create" ? null : mode.cert;
  const renewing = mode.kind === "renew";
  const [holder, setHolder] = useState<CertificateHolder>(src?.holder ?? "OWN");
  const [partnerId, setPartnerId] = useState<string | null>(src?.partnerId ?? null);
  const [standard, setStandard] = useState(src?.standard ?? "");
  const [certificateNo, setCertificateNo] = useState(renewing ? "" : src?.certificateNo ?? "");
  const [issuer, setIssuer] = useState(src?.issuer ?? "");
  const [scope, setScope] = useState(src?.scope ?? "");
  const [issuedOn, setIssuedOn] = useState(renewing ? "" : day(src?.issuedOn));
  const [expiresOn, setExpiresOn] = useState(renewing ? "" : day(src?.expiresOn));
  const [note, setNote] = useState(renewing ? "" : src?.note ?? "");
  const standards = useQuery({ queryKey: ["certificates", "standards"], queryFn: certificateService.standards, staleTime: 5 * 60_000 });

  const save = useMutation({
    mutationFn: () => {
      const body: CertificateFields = {
        holder, partnerId: holder === "PARTNER" ? partnerId : null, standard: standard.trim(), certificateNo: certificateNo.trim(),
        issuer: issuer.trim() || null, scope: scope.trim() || null, issuedOn: issuedOn || null, expiresOn, note: note.trim() || null,
      };
      if (mode.kind === "edit") return certificateService.update(mode.cert.id, body);
      if (mode.kind === "renew") return certificateService.renew(mode.cert.id, { ...body, clientToken: attempt.token() });
      return certificateService.create({ ...body, clientToken: attempt.token() });
    },
    onSuccess: (c) => {
      attempt.onSuccess();
      void qc.invalidateQueries({ queryKey: ["certificates"] });
      toast.success(renewing ? `${c.certificateNo} ile yenilendi; eski sertifika etkisiz.` : `${c.certificateNo} kaydedildi.`);
      onOpenChange(false);
      onSaved(c.id);
    },
    onError: (e) => attempt.onFailure(e),
  });

  const partnerMissing = holder === "PARTNER" && !partnerId;
  const datesBad = Boolean(issuedOn && expiresOn && issuedOn > expiresOn);
  const ready = standard.trim() && certificateNo.trim() && expiresOn && !partnerMissing && !datesBad && !save.isPending;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{TITLE[mode.kind]}</DialogTitle>
          <DialogDescription>
            {renewing
              ? `Yeni belge ${src!.certificateNo} yerine geçer; eski sertifika silinmez, “Yenilendi” olarak saklanır.`
              : "Bitiş tarihi yaklaşınca Bildirimler'de uyarı açılır; belge (PDF/JPEG/PNG) kayıttan sonra eklenir."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <HolderFields holder={holder} onHolder={setHolder} partnerId={partnerId} onPartner={setPartnerId} locked={renewing} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cert-standard">Standart</Label>
              <Input id="cert-standard" list="cert-standard-list" maxLength={64} placeholder="Ör. OEKO-TEX Standard 100" value={standard} onChange={(e) => setStandard(e.target.value)} />
              <datalist id="cert-standard-list">{(standards.data ?? []).map((s) => <option key={s} value={s} />)}</datalist>
            </div>
            <div className="space-y-1"><Label htmlFor="cert-no">Sertifika numarası</Label><Input id="cert-no" maxLength={80} value={certificateNo} onChange={(e) => setCertificateNo(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="cert-issuer">Veren kuruluş</Label><Input id="cert-issuer" maxLength={120} placeholder="Ör. Hohenstein" value={issuer} onChange={(e) => setIssuer(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="cert-issued">Veriliş tarihi</Label><DatePickerInput id="cert-issued" value={issuedOn} onChange={setIssuedOn} /></div>
            <div className="space-y-1">
              <Label htmlFor="cert-expires">Bitiş tarihi</Label>
              <DatePickerInput id="cert-expires" value={expiresOn} onChange={setExpiresOn} invalid={datesBad} />
              {datesBad && <p className="text-xs text-destructive">Bitiş, veriliş tarihinden önce olamaz.</p>}
            </div>
          </div>
          <div className="space-y-1"><Label htmlFor="cert-scope">Kapsam</Label><Textarea id="cert-scope" maxLength={500} placeholder="Ör. pamuklu dokuma kumaşlar, ürün sınıfı I" value={scope} onChange={(e) => setScope(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="cert-note">Not</Label><Textarea id="cert-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button disabled={!ready} onClick={() => save.mutate()}>{save.isPending ? "Kaydediliyor…" : renewing ? "Yenile" : "Kaydet"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HolderFields({ holder, onHolder, partnerId, onPartner, locked }: {
  holder: CertificateHolder; onHolder: (h: CertificateHolder) => void; partnerId: string | null; onPartner: (v: string | null) => void; locked: boolean;
}) {
  return (
    <>
      <div className="space-y-1">
        <Label>Sertifika sahibi</Label>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Sertifika sahibi">
          {(["OWN", "PARTNER"] as const).map((h) => (
            <Button key={h} type="button" role="radio" aria-checked={holder === h} variant={holder === h ? "default" : "outline"} size="sm"
              disabled={locked} onClick={() => onHolder(h)}>
              {h === "OWN" ? "Fabrikanın kendi sertifikası" : "İş ortağının (tedarikçi / fasoncu) sertifikası"}
            </Button>
          ))}
        </div>
      </div>
      {holder === "PARTNER" && (
        <div className="space-y-1">
          <Label>İş ortağı</Label>
          <CustomerPickerField variant="cari" value={partnerId} onChange={onPartner} disabled={locked} />
          {!partnerId && <p className="text-xs text-muted-foreground">İş ortağını listeden seçin.</p>}
        </div>
      )}
    </>
  );
}
