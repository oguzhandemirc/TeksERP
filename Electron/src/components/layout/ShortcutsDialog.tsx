import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const SHORTCUTS: { keys: string[]; desc: string }[] = [
  { keys: ["⌘", "K"], desc: "Komut paleti" },
  { keys: ["/"], desc: "Arama" },
  { keys: ["G", "D"], desc: "Anasayfa" },
  { keys: ["G", "O"], desc: "Operasyon" },
  { keys: ["G", "T"], desc: "Tanımlar" },
  { keys: ["G", "R"], desc: "Raporlar" },
  { keys: ["?"], desc: "Bu pencere" },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Klavye Kısayolları</DialogTitle>
        </DialogHeader>
        <ul className="space-y-1">
          {SHORTCUTS.map((s) => (
            <li
              key={s.desc}
              className="flex items-center justify-between gap-4 rounded-md px-2 py-1.5 text-sm odd:bg-muted/40"
            >
              <span className="text-muted-foreground">{s.desc}</span>
              <span className="flex items-center gap-1">
                {s.keys.map((k, i) => (
                  <kbd
                    key={`${s.desc}-${i}`}
                    className="min-w-[1.5rem] rounded border border-border/70 bg-muted px-1.5 py-0.5 text-center text-xs font-medium"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
