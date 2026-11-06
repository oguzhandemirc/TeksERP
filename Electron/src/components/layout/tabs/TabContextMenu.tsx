import { Fragment, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useTabsStore } from "@/store/tabs";
import { CLOSE_ALL_SHORTCUT, CLOSE_TAB_SHORTCUT, idsToClose, type CloseScope } from "./tab-close";
import { closeTabsWithUndo } from "./close-with-undo";

// Sıra ve ayırıcılar VS Code/Chrome/JetBrains kalıbı: tekli · kapsamlı · tümü.
const ITEMS: { scope: CloseScope; label: string; shortcut?: string; separatorBefore?: boolean }[] = [
  { scope: "self", label: "Kapat", shortcut: CLOSE_TAB_SHORTCUT },
  { scope: "others", label: "Diğerlerini kapat", separatorBefore: true },
  { scope: "right", label: "Sağdakileri kapat" },
  { scope: "left", label: "Soldakileri kapat" },
  { scope: "all", label: "Tümünü kapat", shortcut: CLOSE_ALL_SHORTCUT, separatorBefore: true },
];

/** Sekme çipine sağ tık menüsü; kapsamı boş kalan seçenek pasif (aynı `idsToClose` ölçer). */
export function TabContextMenu({ tabId, children }: { tabId: string; children: ReactNode }) {
  const tabs = useTabsStore((s) => s.tabs);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {ITEMS.map(({ scope, label, shortcut, separatorBefore }) => (
          <Fragment key={scope}>
            {separatorBefore && <ContextMenuSeparator />}
            <ContextMenuItem
              disabled={idsToClose(tabs, tabId, scope).length === 0}
              onSelect={() => closeTabsWithUndo(scope, tabId)}
            >
              {label}
              {shortcut && <ContextMenuShortcut className="pl-4 tracking-normal">{shortcut}</ContextMenuShortcut>}
            </ContextMenuItem>
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
