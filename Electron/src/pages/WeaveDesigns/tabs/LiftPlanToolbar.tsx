// Armür editörü araç çubuğu (dobby editörleri gibi gruplu): araç · geri al · seçim işlemleri · hazır örgü ·
// atkı/çerçeve ekle-sil. Seçim yoksa seçim işlemleri ve şablon bütün ızgaraya uygulanır (geri alınabilir).
import { useState, type ComponentType, type ReactNode } from "react";
import {
  BetweenHorizontalStart, BetweenVerticalStart, ClipboardPaste, Contrast, Copy, Columns3, Eraser, FlipHorizontal2, FlipVertical2,
  MoveDown, MoveLeft, MoveRight, MoveUp, Pencil, Redo2, Rows3, Scissors, SquareDashedMousePointer, Stamp, Undo2, ListX, Grid2x2X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoPopover } from "@/components/ui/info-popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WeaveSegmented } from "@/components/weave/WeaveViewControls";
import type { WeaveDirection } from "@/components/weave/weave-direction";
import { WEAVE_TEMPLATES, type WeaveTemplateId } from "../lift-plan-edit";
import type { EditorAction, Tool } from "./lift-editor-reducer";

const HELP = "Fareyle basılı tutup sürükleyerek boyayın: boş kareden başlarsanız doldurur, dolu kareden başlarsanız siler. "
  + "Shift basılıyken sürüklemek (ya da Seç aracı) bir alan seçer; kopyala, yapıştır, tekrarla, ayna, kaydır, temizle ve hazır örgü "
  + "seçili alana, seçim yoksa bütün ızgaraya uygulanır. Klavye: oklar imleci taşır, Boşluk kareyi çevirir, Shift+ok seçer, "
  + "Ctrl+Z geri al, Ctrl+Y yinele, Ctrl+C/X/V kopyala/kes/yapıştır, Ctrl+A tümünü seç, Delete seçimi temizler, Esc seçimi kaldırır. "
  + "Hazır örgü döner çerçeveleri atlar.";

interface Props {
  dispatch: (a: EditorAction) => void;
  tool: Tool;
  canUndo: boolean;
  canRedo: boolean;
  hasSel: boolean;
  hasClip: boolean;
  direction: WeaveDirection;
}

function Tb({ icon: Icon, label, onClick, disabled, children }: {
  icon: ComponentType<{ className?: string }>; label: string; onClick: () => void; disabled?: boolean; children?: ReactNode;
}) {
  return (
    <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2" title={label} aria-label={label} disabled={disabled} onClick={onClick}>
      <Icon className="h-4 w-4" />{children}
    </Button>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function TemplateGroup({ dispatch, hasSel }: Pick<Props, "dispatch" | "hasSel">) {
  const [tpl, setTpl] = useState<WeaveTemplateId>("plain");
  return (
    <Group label="Hazır örgü">
      <Select value={tpl} onValueChange={(v) => setTpl(v as WeaveTemplateId)}>
        <SelectTrigger className="h-8 w-40 text-xs" aria-label="Hazır örgü"><SelectValue /></SelectTrigger>
        <SelectContent>
          {WEAVE_TEMPLATES.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Tb icon={Stamp} label={hasSel ? "Seçili alana bas" : "Bütün ızgaraya bas"} onClick={() => dispatch({ type: "template", id: tpl })}>Bas</Tb>
    </Group>
  );
}

function EditGroup({ dispatch, hasSel, hasClip, direction }: Pick<Props, "dispatch" | "hasSel" | "hasClip" | "direction">) {
  const where = hasSel ? "Seçimi" : "Izgarayı";
  // Ekranda yukarı: alttan yukarı görünümde sonraki atkılar.
  const up = direction === "bottom-up" ? 1 : -1;
  return (
    <Group label={hasSel ? "Seçim" : "Seçim (yoksa tüm ızgara)"}>
      <Tb icon={Copy} label="Kopyala (Ctrl+C)" onClick={() => dispatch({ type: "copy" })} />
      <Tb icon={Scissors} label="Kes (Ctrl+X)" onClick={() => dispatch({ type: "cut" })} />
      <Tb icon={ClipboardPaste} label="Yapıştır (Ctrl+V) — seçimin köşesine ya da imlece" disabled={!hasClip} onClick={() => dispatch({ type: "paste" })} />
      <Tb icon={Rows3} label="Atkı yönünde tekrarla (ızgara sonuna dek)" onClick={() => dispatch({ type: "repeat", axis: "picks" })} />
      <Tb icon={Columns3} label="Çerçeve yönünde tekrarla (ızgara sonuna dek)" onClick={() => dispatch({ type: "repeat", axis: "frames" })} />
      <Tb icon={FlipHorizontal2} label="Yatay ayna (çerçeve sırasını ters çevir)" onClick={() => dispatch({ type: "block", op: "flipFrames" })} />
      <Tb icon={FlipVertical2} label="Dikey ayna (atkı sırasını ters çevir)" onClick={() => dispatch({ type: "block", op: "flipPicks" })} />
      <Tb icon={Contrast} label="Ters çevir (dolu ↔ boş)" onClick={() => dispatch({ type: "block", op: "invert" })} />
      <Tb icon={MoveUp} label={`${where} yukarı kaydır`} onClick={() => dispatch({ type: "shift", dr: up, dc: 0 })} />
      <Tb icon={MoveDown} label={`${where} aşağı kaydır`} onClick={() => dispatch({ type: "shift", dr: -up, dc: 0 })} />
      <Tb icon={MoveLeft} label={`${where} sola kaydır`} onClick={() => dispatch({ type: "shift", dr: 0, dc: -1 })} />
      <Tb icon={MoveRight} label={`${where} sağa kaydır`} onClick={() => dispatch({ type: "shift", dr: 0, dc: 1 })} />
      <Tb icon={Eraser} label={hasSel ? "Seçimi temizle (Delete)" : "Bütün ızgarayı temizle"} onClick={() => dispatch({ type: "block", op: "clear" })} />
    </Group>
  );
}

function StructureGroup({ dispatch }: Pick<Props, "dispatch">) {
  return (
    <Group label="Atkı · çerçeve">
      <Tb icon={BetweenHorizontalStart} label="İmleçteki/seçili atkıların sonrasına boş atkı ekle" onClick={() => dispatch({ type: "insertPicks" })}>Atkı</Tb>
      <Tb icon={ListX} label="İmleçteki/seçili atkıları sil" onClick={() => dispatch({ type: "deletePicks" })} />
      <Tb icon={BetweenVerticalStart} label="İmleçteki/seçili çerçevelerin sağına boş çerçeve ekle" onClick={() => dispatch({ type: "insertFrames" })}>Çerçeve</Tb>
      <Tb icon={Grid2x2X} label="İmleçteki/seçili çerçeveleri sil (döner işaretleri kayar)" onClick={() => dispatch({ type: "deleteFrames" })} />
    </Group>
  );
}

export function LiftPlanToolbar({ dispatch, tool, canUndo, canRedo, hasSel, hasClip, direction }: Props) {
  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-3 rounded-lg border bg-muted/30 px-3 py-2" aria-label="Armür düzenleme araçları">
      <Group label="Araç">
        <WeaveSegmented label="Araç" value={tool} onChange={(t) => dispatch({ type: "tool", tool: t })} options={[
          { value: "paint", label: <><Pencil className="h-3.5 w-3.5" />Boya</>, title: "Basılı sürükle: boya / sil" },
          { value: "select", label: <><SquareDashedMousePointer className="h-3.5 w-3.5" />Seç</>, title: "Basılı sürükle: alan seç (Boya aracında Shift ile)" },
        ]} />
        <Tb icon={Undo2} label="Geri al (Ctrl+Z)" disabled={!canUndo} onClick={() => dispatch({ type: "undo" })} />
        <Tb icon={Redo2} label="Yinele (Ctrl+Y)" disabled={!canRedo} onClick={() => dispatch({ type: "redo" })} />
      </Group>
      <EditGroup dispatch={dispatch} hasSel={hasSel} hasClip={hasClip} direction={direction} />
      <TemplateGroup dispatch={dispatch} hasSel={hasSel} />
      <StructureGroup dispatch={dispatch} />
      <InfoPopover label="Armür editörü nasıl kullanılır" desc={HELP} />
    </div>
  );
}
