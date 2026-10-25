import { useMemo, useState } from "react";
import type { Component, Editor } from "grapesjs";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { dataFieldHtml, DOCUMENT_BLOCK_CSS } from "../binding/blockHtml";
import { buildContractTree, isFieldLocked, type TreeNode } from "../binding/contract";
import { defaultColumns, itemTableHtml } from "../binding/itemTable";
import type { DesignerDraft } from "../useDesignerDraft";
import { FieldNodeRow } from "./FieldNodeRow";

/** Düğümün kanvasa bıraktığı HTML: kök alan → Veri alanı, tablo → Kalem tablosu; kolon bırakılmaz. */
export function nodeHtml(node: TreeNode, draft: Pick<DesignerDraft, "contract" | "internalFields">): string | null {
  if (node.kind === "field" && node.field) return dataFieldHtml(node.path, node.field);
  if (node.kind === "table" && draft.contract) {
    const t = draft.contract.tablolar.find((x) => x.anahtar === node.tableKey);
    return t ? `${itemTableHtml(t, defaultColumns(t, draft.internalFields))}<style>${DOCUMENT_BLOCK_CSS}</style>` : null;
  }
  return null;
}

function insertTarget(editor: Editor): Component {
  const sel = editor.getSelected();
  const wrapper = editor.getWrapper()!;
  if (!sel || sel.is("wrapper")) return wrapper;
  return sel.get("droppable") === false || sel.is("textnode") ? (sel.parent() ?? wrapper) : sel;
}

/**
 * Veri bağlama ağacı (`GET /contracts/:docType`): etiket · tür · birim · örnek değer.
 * Düğüm kanvasa sürüklenir (Veri alanı/Kalem tablosu bloğu üretir) ya da "+" ile seçili öğeye eklenir.
 */
export function DataTreePanel({ editor, draft }: { editor: Editor | null; draft: DesignerDraft }) {
  const tree = useMemo(() => (draft.contract ? buildContractTree(draft.contract) : []), [draft.contract]);
  const [open, setOpen] = useState<Record<string, boolean>>({ belge: true });
  if (draft.contractError) return <div className="p-3"><Callout tone="danger" title="Sözleşme yüklenemedi">Belge türünün veri sözleşmesi alınamadı; bağlantıyı denetleyip sayfayı yenileyin.</Callout></div>;
  if (!draft.contract) return <p className="p-3 text-xs text-muted-foreground">Veri sözleşmesi yükleniyor…</p>;

  const drag = (html: string) => (e: React.DragEvent) => {
    if (!editor) return;
    const block = new editor.Blocks.Block({ id: "veri-agaci", label: "", content: html } as never);
    editor.Blocks.startDrag(block, e.nativeEvent);
  };
  const add = (html: string) => {
    if (!editor) return;
    const [c] = insertTarget(editor).append(html);
    if (c) editor.select(c);
    draft.touch();
  };
  const renderNode = (n: TreeNode, depth: number) => {
    const html = nodeHtml(n, draft);
    const locked = isFieldLocked(n.field, draft.internalFields);
    return (
      <div key={n.id} className="group flex items-center">
        <div className="min-w-0 flex-1">
          <FieldNodeRow label={n.label} path={n.path} field={n.field} locked={locked} depth={depth} draggable={!!html && !locked} onDragStart={html ? drag(html) : undefined} onDragEnd={() => editor?.Blocks.endDrag()} />
        </div>
        {html && !locked && (
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 opacity-60 group-hover:opacity-100" aria-label={`${n.label} ekle`} onClick={() => add(html)}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  };
  const renderGroup = (n: TreeNode, depth: number): React.ReactNode => {
    const isOpen = open[n.id] ?? false;
    const html = nodeHtml(n, draft);
    return (
      <div key={n.id}>
        <div className="group flex items-center">
          <button type="button" draggable={!!html} onDragStart={html ? drag(html) : undefined} onDragEnd={() => editor?.Blocks.endDrag()} onClick={() => setOpen((o) => ({ ...o, [n.id]: !isOpen }))} className="flex flex-1 items-center gap-1 rounded px-1 py-1 text-left text-xs font-semibold hover:bg-muted" style={{ paddingLeft: `${4 + depth * 12}px` }} aria-expanded={isOpen}>
            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {n.label}
            {n.kind === "table" && <span className="ml-1 font-mono text-[10px] font-normal text-muted-foreground">[]</span>}
          </button>
          {html && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 opacity-60 group-hover:opacity-100" aria-label={`${n.label} tablosunu ekle`} onClick={() => add(html)}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        {isOpen && n.children?.map((c) => (c.children ? renderGroup(c, depth + 1) : renderNode(c, depth + 1)))}
      </div>
    );
  };

  return (
    <div className="space-y-1 p-2" data-testid="veri-agaci">
      <p className="px-1 pb-1 text-[11px] text-muted-foreground">Alanı kanvasa sürükleyin ya da “+” ile seçili öğeye ekleyin. Tablo kolonları kalem tablosunun Özellikler panelinden açılır.</p>
      {tree.map((n) => renderGroup(n, 0))}
    </div>
  );
}
