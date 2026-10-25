import { Copy, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { DocumentTemplateRow } from "@/services/documentTemplateService";
import type { TemplateAccess } from "./useTemplateAccess";

interface Props {
  template: DocumentTemplateRow;
  access: TemplateAccess;
  onCopy: () => void;
}

/** Satırın seyrek eylemleri. İzin yoksa öğe gizlenmez: pasif + gerekçe (plan §4 salt-okunur yüzey). */
export function TemplateRowMenu({ template, access, onCopy }: Props) {
  const block = access.designBlock;
  return (
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
