// Tanıtılan belge tipini düzenle (S1b, Gönderen Şablonları): ad + kimlik yazıları (sürümlü PUT; araya giren kayıt 409).
// Alan yerleri fotoğraf üstünde değişir → "Şablonu güncelle" bir gelen belgenin detayından açılır.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatFactory } from "@/lib/factory-time";
import { INCOMING_DOCUMENT_QUERY_KEY } from "../service";
import { getUserTemplate, updateUserTemplate, USER_TEMPLATES_QUERY_KEY } from "./service";
import { FIELD_OPTIONS, templateKeywords } from "./teachDraft";
import type { TemplateJson, UserTemplateDetail } from "./types";

const FIELD_LABEL: Record<string, string> = Object.fromEntries(FIELD_OPTIONS.map((f) => [f.key, f.label]));

/** Şablondaki alanların okunur özeti: "Parti No, Metre, … · top tablosu · tekrar eden bölüm". */
export function templateSummary(t: TemplateJson): string {
  const fields = (Array.isArray(t.fields) ? t.fields : []).map((f) => FIELD_LABEL[(f as { key?: string }).key ?? ""] ?? (f as { key?: string }).key).filter(Boolean);
  const parts = [fields.join(", ") || "alan yok"];
  if (Array.isArray(t.tables) && t.tables.length) parts.push("top tablosu");
  if (t.sections) parts.push("tekrar eden bölüm");
  return parts.join(" · ");
}

/** Düzenlenen şablon gövdesi: yalnız kimlik yazıları değişir; geri kalan aynen gider (sunucu mühürler). */
export function withKeywords(t: TemplateJson, keywords: string[]): TemplateJson {
  const rest = Object.fromEntries(Object.entries(t).filter(([k]) => k !== "id" && k !== "version"));
  return { ...rest, identifiers: { ...(t.identifiers as object), keywords } };
}

function EditBody({ detail, onDone }: { detail: UserTemplateDetail; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(detail.name);
  const [keywords, setKeywords] = useState(templateKeywords(detail.template));
  const [draft, setDraft] = useState("");
  const save = useMutation({
    mutationFn: () => updateUserTemplate(detail.code, { expectedVersion: detail.version, name: name.trim(), template: withKeywords(detail.template, keywords) }),
    onSuccess: (v) => {
      toast.success(`"${v.name}" güncellendi (sürüm ${v.version}).`);
      void qc.invalidateQueries({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY] });
      onDone();
    },
  });
  const add = () => {
    const t = draft.trim();
    if (t.length >= 2 && !keywords.includes(t)) setKeywords([...keywords, t]);
    setDraft("");
  };
  return (
    <>
      <div className="space-y-3 text-sm">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Ad</span>
          <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-testid="user-template-name" />
        </label>
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Kimlik yazıları</span>
          <ul className="space-y-1" data-testid="user-template-keywords">
            {keywords.map((k) => (
              <li key={k} className="flex items-center justify-between rounded border px-2 py-1">
                <span>{k}</span>
                <Button type="button" size="icon" variant="ghost" className="h-6 w-6" aria-label={`${k} kimlik yazısını çıkar`} onClick={() => setKeywords(keywords.filter((x) => x !== k))}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input value={draft} maxLength={60} placeholder="Yeni kimlik yazısı" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
            <Button type="button" variant="outline" onClick={add}>Ekle</Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Alanlar: {templateSummary(detail.template)}. Alan yerlerini değiştirmek için bir gelen belgenin detayında "Şablonu güncelle".</p>
        <div className="text-xs text-muted-foreground" data-testid="user-template-versions">
          Sürümler: {detail.versions.map((v) => `${v.version} (${formatFactory(v.createdAt, "dd.MM.yyyy HH:mm")})`).join(" · ")}
        </div>
      </div>
      <DialogFooter>
        <Button onClick={() => save.mutate()} disabled={save.isPending || name.trim().length < 2 || keywords.length === 0} data-testid="user-template-save">
          {save.isPending ? "Kaydediliyor…" : "Kaydet (yeni sürüm)"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function UserTemplateEditButton({ code, name }: { code: string; name: string }) {
  const [open, setOpen] = useState(false);
  const detail = useQuery({ queryKey: [...USER_TEMPLATES_QUERY_KEY, code, "duzenle"], queryFn: () => getUserTemplate(code), enabled: open, staleTime: 0 });
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid={`user-template-edit-${code}`}>
        <Pencil className="mr-1 h-3.5 w-3.5" /> Düzenle
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Belge tipini düzenle — {name}</DialogTitle>
            <DialogDescription>Kayıt yeni sürüm açar; daha önce okunan belgeler okundukları sürümde kalır.</DialogDescription>
          </DialogHeader>
          {detail.data ? <EditBody key={detail.data.version} detail={detail.data} onDone={() => setOpen(false)} /> : <p className="text-sm text-muted-foreground">{detail.isError ? "Yüklenemedi." : "Yükleniyor…"}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
