/** Stroked chevron icon; rotates to point in any direction (animated when it changes). */
export function Chevron({
  dir = "down",
  size = 12,
  className,
}: {
  dir?: "down" | "up" | "left" | "right";
  size?: number;
  className?: string;
}) {
  const rotate = { down: 0, up: 180, left: 90, right: -90 }[dir];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={className}
      style={{ display: "inline-block", flexShrink: 0, transform: `rotate(${rotate}deg)`, transition: "transform 0.15s ease" }}
    >
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
