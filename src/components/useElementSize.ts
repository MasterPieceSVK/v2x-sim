import { useEffect, useState, type RefObject } from "react";

/** Re-render whenever the element's size changes (canvases must redraw at their new size). */
export function useElementSize(ref: RefObject<HTMLElement | null>): [number, number] {
  const [size, setSize] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (s[0] === width && s[1] === height ? s : [width, height]));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
