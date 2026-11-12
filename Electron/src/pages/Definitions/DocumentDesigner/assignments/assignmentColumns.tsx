// Atamalar — profil × şablon tablosunun sütunları (ortak DataTable). Seçili belge türüne göre kurulur.
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DocumentTemplateRow, ProfileCatalogRow, TemplateAssignments } from "@/services/documentTemplateService";
import type { AssignTarget } from "./AssignDialog";
import { affectedNames, hasConfigOverride, profileTemplateOf } from "./assignmentModel";

export interface AssignmentColumnsOpts {
  a: TemplateAssignments | undefined;
  docType: string;
  def: { id: string; name: string } | null;
  candidates: DocumentTemplateRow[];
  block: string | null | undefined;
  onAssign: (t: AssignTarget) => void;
}

const affectedText = (p: ProfileCatalogRow) => {
  const aff = affectedNames(p);
  return `${aff.customers.length} müşteri · ${aff.subcontractors.length} fasoncu`;
};

export function assignmentColumns({ a, docType, def, candidates, block, onAssign }: AssignmentColumnsOpts): ColumnDef<ProfileCatalogRow>[] {
  const fallback = `Varsayılan (${def?.name ?? "Sistem"})`;
  return [
    {
      id: "profile",
      header: "Profil",
      enableHiding: false,
      meta: { label: "Profil", exportValue: (p) => `${p.name}${p.isActive ? "" : " (pasif)"}` },
      accessorFn: (p) => p.name,
      cell: ({ row: { original: p } }) => (
        <span className="font-medium">
          {p.name}
          {!p.isActive && <span className="ml-1 text-xs text-muted-foreground">(pasif)</span>}
          {hasConfigOverride(p, docType) && <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-amber-600" aria-label="Profilin belge ayarı ezmesi var" />}
        </span>
      ),
    },
    { id: "affected", header: "Etkilenen", meta: { label: "Etkilenen" }, accessorFn: affectedText, cell: ({ row }) => <span className="text-xs">{affectedText(row.original)}</span> },
    {
      id: "template",
      header: "Atanan şablon",
      meta: { label: "Atanan şablon", exportValue: (p) => profileTemplateOf(a, p.id, docType)?.name ?? fallback },
      accessorFn: (p) => profileTemplateOf(a, p.id, docType)?.name ?? fallback,
      cell: ({ row: { original: p } }) => {
        const cur = profileTemplateOf(a, p.id, docType);
        return cur ? cur.name : <span className="text-muted-foreground">{fallback}</span>;
      },
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      meta: { label: "İşlem", align: "right" },
      cell: ({ row: { original: p } }) => (
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!block} title={block ?? undefined}
          onClick={() => onAssign({ docType, profile: p, current: profileTemplateOf(a, p.id, docType), candidates, shielded: [] })}>Ata</Button>
      ),
    },
  ];
}
