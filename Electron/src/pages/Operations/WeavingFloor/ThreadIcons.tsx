// Kopuş simgeleri — lucide'de "yatay iplik koptu / dikey iplik koptu" ayrımı yok;
// atkı YATAY, çözgü DİKEY çizilir ki iki sebep yazısız ayrılsın.

interface IconProps {
  className?: string;
  strokeWidth?: number;
}

function Frame({ className, strokeWidth = 2, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function WeftBreakIcon(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="M6 4v16M18 4v16" opacity={0.35} />
      <path d="M2 12h7.5l1.5-2.5M22 12h-7.5L13 14.5" />
    </Frame>
  );
}

export function WarpBreakIcon(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="M4 6h16M4 18h16" opacity={0.35} />
      <path d="M12 2v7.5l-2.5 1.5M12 22v-7.5l2.5-1.5" />
    </Frame>
  );
}

export function SelvageBreakIcon(props: IconProps) {
  return (
    <Frame {...props}>
      <path d="M8 3v18" opacity={0.35} />
      <path d="M8 12h4M22 12h-5l-1.5 2.5" />
      <path d="M4 3v18" />
    </Frame>
  );
}
