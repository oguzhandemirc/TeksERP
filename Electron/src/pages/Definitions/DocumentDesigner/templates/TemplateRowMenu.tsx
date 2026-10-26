import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Copy, MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { documentTemplateService, type DocumentTemplateRow } from "@/services/documentTemplateService";
import { ArchiveDialog, DeleteDialog } from "./ArchiveDeleteDialogs";
import type { TemplateAccess } from "./useTemplateAccess";

interface Props {
  template: DocumentTemplateRow;
  access: TemplateAccess;
  onCopy: () => void;
}

/** Satırın seyrek eylemleri. İzin yoksa öğe gizlenmez: pasif + gerekçe (plan §4 salt-okunur yüzey). */
export function TemplateRowMenu({ template, access, onCopy }: Props) {
  const block = access.designBlock;
  const qc = useQueryClient();
  const [archiveOf, setArchiveOf] = useState<DocumentTemplateRow | null>(null);
  const [deleteOf, setDeleteOf] = useState<DocumentTemplateRow | null>(null);
  const unarchive = useMutation({
    mutationFn: () => documentTemplateService.unarchive(template.id),
    onSuccess: () => {
      toast.success("Şablon arşivden çıkarıldı.");
      void qc.invalidateQueries({ queryKey: ["document-templates"] });
    },
  });
  const active = template.status === "ACTIVE";
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={`${template.name} — diğer eylemler`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!!block} title={block ?? undefined} onSelect={onCopy}>
            <Copy className="mr-2 h-4 w-4" /> Kopyala
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {active ? (
            <DropdownMenuItem disabled={!!block} title={block ?? undefined} onSelect={() => setArchiveOf(template)}>
              <Archive className="mr-2 h-4 w-4" /> Arşivle
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={!!block || unarchive.isPending} title={block ?? undefined} onSelect={() => unarchive.mutate()}>
              <ArchiveRestore className="mr-2 h-4 w-4" /> Arşivden çıkar
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={!!block} title={block ?? undefined} className="text-destructive" onSelect={() => setDeleteOf(template)}>
            <Trash2 className="mr-2 h-4 w-4" /> Sil
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ArchiveDialog template={archiveOf} onClose={() => setArchiveOf(null)} />
      <DeleteDialog template={deleteOf} onClose={() => setDeleteOf(null)} />
    </>
  );
}
