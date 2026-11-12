// Sertifika listesi — tablo sütunları (ortak DataTable) + kalan süre hapı. "Yakında" eşiği sunucu özetinden gelir.
import type { ColumnDef } from "@tanstack/react-table";
import { Paperclip } from "lucide-react";
import { fmtCalendarDay } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import type { CertificateRow } from "./service";
import { HOLDER_LABEL, TONE_CLASS, expiryBadge } from "./certificateRules";

export function ExpiryPill({ row, soonDays }: { row: Parameters<typeof expiryBadge>[0]; soonDays: number }) {
  const b = expiryBadge(row, soonDays);
  return <span data-tone={b.tone} className={cn("inline-flex whitespace-nowrap rounded-badge border px-2 py-0.5 text-xs font-medium", TONE_CLASS[b.tone])}>{b.text}</span>;
}

const holderText = (r: CertificateRow) => (r.holder === "OWN" ? HOLDER_LABEL.OWN : r.partner?.name ?? HOLDER_LABEL.PARTNER);

const BASE: ColumnDef<CertificateRow>[] = [
  { id: "standard", header: "Standart", meta: { label: "Standart" }, accessorFn: (r) => r.standard, cell: ({ row }) => <span className="font-medium">{row.original.standard}</span> },
  { id: "certificateNo", header: "Sertifika No", meta: { label: "Sertifika No" }, accessorFn: (r) => r.certificateNo, cell: ({ row }) => <span className="font-mono text-xs">{row.original.certificateNo}</span> },
  { id: "holder", header: "Sahip", meta: { label: "Sahip" }, accessorFn: holderText },
  { id: "issuer", header: "Veren kuruluş", meta: { label: "Veren kuruluş" }, accessorFn: (r) => r.issuer ?? "—", cell: ({ row }) => <span className="text-muted-foreground">{row.original.issuer ?? "—"}</span> },
  { id: "expiresOn", header: "Bitiş", meta: { label: "Bitiş", exportValue: (r) => fmtCalendarDay(r.expiresOn) }, accessorFn: (r) => r.expiresOn, cell: ({ row }) => <span className="tabular-nums">{fmtCalendarDay(row.original.expiresOn)}</span> },
];

const FILES: ColumnDef<CertificateRow> = {
  id: "files",
  header: "Belge",
  meta: { label: "Belge" },
  accessorFn: (r) => r.fileCount,
  cell: ({ row: { original: r } }) => (
    <span className="text-xs text-muted-foreground">
      {r.fileCount > 0 ? <span className="inline-flex items-center gap-1"><Paperclip className="h-3.5 w-3.5" />{r.fileCount}</span> : "—"}
    </span>
  ),
};

export function certificateColumns(soonDays: number): ColumnDef<CertificateRow>[] {
  return [
    ...BASE,
    { id: "remaining", header: "Kalan", meta: { label: "Kalan", exportValue: (r) => expiryBadge(r, soonDays).text }, cell: ({ row }) => <ExpiryPill row={row.original} soonDays={soonDays} /> },
    FILES,
  ];
}
