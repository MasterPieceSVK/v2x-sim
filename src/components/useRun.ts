import { useEffect, useRef, useState } from "react";
import { Recorder, type SimConfig } from "@/sim";

const STEPS_PER_CHUNK = 400; // simulation steps computed per slice before yielding to the UI

/**
 * Computes a whole run for `config` in small slices (the page stays responsive) and re-renders as
 * it progresses. `config === null` means no run. `onDone` fires once when the run is complete.
 */
export function useRun(config: SimConfig | null, onDone?: (rec: Recorder) => void): Recorder | null {
  const [rec, setRec] = useState<Recorder | null>(null);
  const [, setVersion] = useState(0);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    if (!config) return;
    const r = new Recorder(config);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const work = () => {
      if (cancelled) return;
      const done = r.advance(STEPS_PER_CHUNK);
      setRec(r);
      setVersion((v) => v + 1);
      if (done) onDoneRef.current?.(r);
      else timer = setTimeout(work, 0);
    };
    timer = setTimeout(work, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config]);

  return config ? rec : null;
}
