// Hafif konfeti — paketsiz, Web Animations API ile. Pozitif milestone'larda
// (yeni iş emri, sipariş tamamlama) ölçülü bir kutlama. prefers-reduced-motion
// açıksa hiçbir şey yapmaz.

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#0ea5e9", "#ec4899", "#a855f7", "#ef4444"];

export function fireConfetti(count = 90): void {
  if (typeof document === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const container = document.createElement("div");
  container.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden;";
  document.body.appendChild(container);

  const originX = window.innerWidth / 2;
  const originY = window.innerHeight * 0.32;
  const fall = window.innerHeight;
  let remaining = count;
  const done = () => {
    remaining -= 1;
    if (remaining <= 0) container.remove();
  };

  for (let i = 0; i < count; i++) {
    const piece = document.createElement("div");
    const w = 6 + Math.random() * 8;
    const h = w * (0.4 + Math.random() * 0.9);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    piece.style.cssText =
      `position:absolute;left:${originX}px;top:${originY}px;width:${w}px;height:${h}px;` +
      `background:${color};border-radius:${Math.random() > 0.5 ? "50%" : "2px"};will-change:transform,opacity;`;
    container.appendChild(piece);

    const angle = Math.random() * Math.PI * 2;
    const velocity = 120 + Math.random() * 280;
    const dx = Math.cos(angle) * velocity;
    const dy = Math.sin(angle) * velocity - (140 + Math.random() * 200); // yukarı patlama
    const rot = Math.random() * 720 - 360;

    const anim = piece.animate(
      [
        { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
        {
          transform: `translate(${dx}px, ${dy}px) rotate(${rot / 2}deg)`,
          opacity: 1,
          offset: 0.32,
        },
        {
          transform: `translate(${dx * 1.15}px, ${dy + fall}px) rotate(${rot}deg)`,
          opacity: 0,
        },
      ],
      {
        duration: 1700 + Math.random() * 1100,
        easing: "cubic-bezier(0.2, 0.65, 0.35, 1)",
        fill: "forwards",
      },
    );
    anim.onfinish = done;
    anim.oncancel = done;
  }

  // Güvenlik: animasyonlar bir şekilde bitmezse 4sn sonra temizle.
  setTimeout(() => container.remove(), 4000);
}
