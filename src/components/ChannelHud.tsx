"use client";

import { airtime, packetLayout } from "@/sim";
import { Term } from "./Term";
import { useStoredState } from "./useStoredState";
import { firstPacketAtOrAfter, type View } from "./view";
import s from "./Overlay.module.css";
import { Chevron } from "./Chevron";

/**
 * The radio channel as a pipe of fixed capacity (the last 100 ms of airtime), shown on the map.
 * Folded: one line with a mini pipe. Unfolded: what fills the pipe and why.
 */
export function ChannelHud({ view, compact = false }: { view: View; compact?: boolean }) {
  // Half-width compare panes remember their own (folded by default) state.
  const [open, setOpen] = useStoredState(compact ? "v2x-hud-channel-open-compact" : "v2x-hud-channel-open", false);
  const ch = view.config.channel;
  const windowMs = ch.cbrWindowMs;
  const camAir = airtime(packetLayout("CAM", ch.security).frame, ch.dataRateMbps).ms;
  const slots = Math.floor(windowMs / camAir);

  let cams = 0;
  let denms = 0;
  let camMs = 0;
  let denmMs = 0;
  for (let i = firstPacketAtOrAfter(view.packets, view.t - windowMs / 1000); i < view.packets.length && view.packets[i].t <= view.t; i++) {
    const p = view.packets[i];
    if (p.msg.type === "CAM") {
      cams++;
      camMs += p.airtimeMs;
    } else {
      denms++;
      denmMs += p.airtimeMs;
    }
  }
  const othersShare = view.metrics.cbrOthers;
  const ownShare = (camMs + denmMs) / windowMs;
  const demand = ownShare + othersShare;
  const busy = Math.min(1, demand);
  const overflow = Math.max(0, demand - 1);
  const tone = busy < 0.3 ? "var(--ok)" : busy < 0.6 ? "var(--warn)" : "var(--danger)";
  const pct = (x: number) => `${Math.min(100, Math.max(0, x * 100))}%`;

  // stations × rate × airtime, from the last second
  const lastSecond = Math.min(1, Math.max(view.t, 0.1));
  let recent = 0;
  for (let i = firstPacketAtOrAfter(view.packets, view.t - lastSecond); i < view.packets.length && view.packets[i].t <= view.t; i++) recent++;
  const cars = view.vehicles.filter((v) => v.active).length;
  const stations = cars + ch.backgroundStations;
  const rate = cars ? recent / lastSecond / cars : 0;
  const quietEtsi = view.config.cam.kind === "etsi" && demand < 0.6;

  const pipe = (big: boolean) => (
    <span className={big ? s.pipeBig : s.pipeMini}>
      <span className={s.own} style={{ width: pct(camMs / windowMs) }} />
      <span className={s.denm} style={{ width: pct(denmMs / windowMs) }} />
      <span className={s.others} style={{ width: pct(Math.min(othersShare, 1 - ownShare)) }} />
    </span>
  );

  if (!open) {
    return (
      <button className={`${s.hud} ${s.hudFolded}`} onClick={() => setOpen(true)} title="Radio channel: click for details">
        <span className={s.hudLabel}>Channel</span>
        {pipe(false)}
        <b style={{ color: tone }}>{(busy * 100).toFixed(0)} %</b>
        {overflow > 0 && <span className={s.full}>FULL</span>}
        <Chevron dir="up" className={s.chev} />
      </button>
    );
  }

  return (
    <div className={`${s.hud} ${s.hudOpen}`}>
      <div className={s.hudHead}>
        <span className={s.hudLabel}>
          Radio channel · last {windowMs} ms <Term k="pipe">(?)</Term>
        </span>
        <button className={s.iconBtn} onClick={() => setOpen(false)} title="Fold">
          <Chevron dir="down" />
        </button>
      </div>
      <div className={s.hudBig}>
        <b style={{ color: tone }}>
          {(busy * 100).toFixed(0)} % <Term k="cbr">busy</Term>
        </b>
        <span>room for {slots} CAMs</span>
      </div>
      {pipe(true)}
      {overflow > 0 && <div className={s.overflow}>+{(overflow * 100).toFixed(0)} % more than fits → messages collide</div>}
      <ul className={s.legend}>
        <li>
          <i className={s.own} /> our cars: {cams + denms} msgs · {(camMs + denmMs).toFixed(1)} ms
        </li>
        <li>
          <i className={s.others} /> {ch.backgroundStations} <Term k="others">other stations</Term> · {(othersShare * windowMs).toFixed(1)} ms
        </li>
        <li>
          <i className={s.free} /> free · {(Math.max(0, 1 - demand) * windowMs).toFixed(1)} ms
        </li>
      </ul>
      <div className={s.calc}>
        {stations} stations × {rate.toFixed(1)} msg/s × {camAir.toFixed(3)} ms = <b>{(((stations * rate * camAir) / 1000) * 100).toFixed(0)} %</b>
      </div>
      {quietEtsi && (
        <div className={s.note}>
          <Term k="etsiQuiet">Why so quiet in ETSI mode?</Term>
        </div>
      )}
    </div>
  );
}
