"use client";

import { useMemo, useState } from "react";
import {
  SECURITY_LABEL,
  airtime,
  encodeCam,
  encodeDenm,
  packetLayout,
  type Encoded,
  type EncodedField,
  type PacketEvent,
} from "@/sim";
import { deliveredCount, type View } from "./view";
import s from "./Inspector.module.css";
import { Chevron } from "./Chevron";

interface Props {
  packet: PacketEvent | null;
  view: View;
  perspectiveCar: number | null;
  onSelectCar: (id: number) => void;
  /** Deselect the packet (✕ in the header). */
  onClose?: () => void;
}

type Tab = "summary" | "layers" | "bits";


/** Packet inspector in the spirit of Packet Tracer: plain-language summary, protocol layers, raw bits. */
export function PacketInspector({ packet, view, perspectiveCar, onSelectCar, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("summary");
  const encoded = useMemo(
    () => (packet ? (packet.msg.type === "CAM" ? encodeCam(packet.msg.body) : encodeDenm(packet.msg.body)) : null),
    [packet],
  );

  if (!packet || !encoded) {
    return (
      <div className={s.inspector}>
        <div className={s.empty}>
          <strong>No packet selected</strong>
          <p>Click a mark in the timeline or a row in the list to open a message.</p>
          <p>Tip: select a car first. The timeline then shows, for every message, whether that car received it.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={s.inspector}>
      <div className={s.tabs}>
        <span className={s.title}>
          {packet.msg.type} · car{packet.src} · {packet.t.toFixed(3)} s
        </span>
        {(["summary", "layers", "bits"] as Tab[]).map((t) => (
          <button key={t} className={t === tab ? s.tabOn : s.tab} onClick={() => setTab(t)}>
            {t === "summary" ? "Summary" : t === "layers" ? "Layers" : "Bits"}
          </button>
        ))}
        {onClose && (
          <button className={s.closeBtn} onClick={onClose} title="Deselect this packet (Esc)" aria-label="Deselect this packet">
            ✕
          </button>
        )}
      </div>
      <div className={s.body}>
        {tab === "summary" && (
          <Summary packet={packet} view={view} perspectiveCar={perspectiveCar} onSelectCar={onSelectCar} />
        )}
        {tab === "layers" && <Layers packet={packet} encoded={encoded} view={view} />}
        {tab === "bits" && <Bits encoded={encoded} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- Summary

function Summary({ packet, view, perspectiveCar, onSelectCar }: Omit<Props, "packet"> & { packet: PacketEvent }) {
  const r = packet.receivers;
  const got = deliveredCount(packet);
  const lost = Array.from(r.ids.keys())
    .filter((i) => !r.delivered[i])
    .sort((a, b) => r.dist[a] - r.dist[b]);
  const dists = Array.from(r.dist).filter((_, i) => r.delivered[i]);
  const car = (id: number) => (
    <button className={s.link} onClick={() => onSelectCar(id)}>
      car{id}
    </button>
  );

  // What the selected car made of this message.
  let perspective: React.ReactNode = null;
  if (perspectiveCar !== null && perspectiveCar !== packet.src) {
    const idx = Array.from(r.ids).indexOf(perspectiveCar);
    if (idx < 0) {
      perspective = <>{car(perspectiveCar)} was out of radio range and could not receive it.</>;
    } else if (r.delivered[idx]) {
      perspective = (
        <>
          {car(perspectiveCar)} <b className={s.ok}>received</b> it after {(packet.rxDelay * 1000).toFixed(1)} ms and
          updated its picture of car{packet.src}.
        </>
      );
    } else {
      const prev = previousReceived(view, packet, perspectiveCar);
      perspective = (
        <>
          {car(perspectiveCar)} <b className={s.bad}>lost</b> it.{" "}
          {prev
            ? `Its newest CAM from car${packet.src} stays the one from ${prev.t.toFixed(2)} s (${(packet.t - prev.t).toFixed(2)} s older).`
            : `It has no other CAM from car${packet.src} yet.`}
        </>
      );
    }
  }

  return (
    <div className={s.summary}>
      <p className={s.lead}>
        {car(packet.src)} broadcast a <b>{packet.msg.type}</b> at {packet.t.toFixed(3)} s.
      </p>
      <p className={s.says}>“{describeContent(packet)}”</p>
      <p>
        {r.ids.length} cars were within radio range ({view.config.channel.rangeM} m).{" "}
        <b className={s.ok}>{got} received it</b>
        {got > 0 && ` (${Math.min(...dists).toFixed(0)}–${Math.max(...dists).toFixed(0)} m away)`}
        {lost.length > 0 ? (
          <>
            , <b className={s.bad}>{lost.length} lost it</b>:{" "}
            {lost.map((i, k) => (
              <span key={r.ids[i]}>
                {k > 0 && ", "}
                {car(r.ids[i])} ({r.dist[i].toFixed(0)} m)
              </span>
            ))}
            .
          </>
        ) : (
          "; nobody lost it."
        )}
      </p>
      {perspective && <p className={s.perspective}>{perspective}</p>}
      <p className={s.muted}>
        On the map: green lines = received, red dashed = lost. Open <b>Layers</b> for the protocol stack or{" "}
        <b>Bits</b> for the encoded message.
      </p>
    </div>
  );
}

function describeContent(p: PacketEvent): string {
  if (p.msg.type === "DENM") {
    return "Warning: emergency brake engaged at my position (dangerous situation).";
  }
  const hf = p.msg.body.highFrequencyContainer;
  const kmh = ((hf.speed / 100) * 3.6).toFixed(0);
  const acc = hf.longitudinalAcceleration / 10;
  const dir = ["north", "east", "south", "west"][Math.round(hf.heading / 900) % 4];
  const doing = acc < -0.3 ? `braking at ${(-acc).toFixed(1)} m/s²` : acc > 0.3 ? `accelerating at ${acc.toFixed(1)} m/s²` : "at constant speed";
  return `I am a ${(hf.vehicleLength / 10).toFixed(1)} m car driving ${dir} at ${kmh} km/h, ${doing}.`;
}

function previousReceived(view: View, packet: PacketEvent, carId: number): PacketEvent | null {
  for (let i = packet.id - 1, n = 0; i >= 0 && n < 5000; i--, n++) {
    const p = view.packets[i];
    if (p.src !== packet.src || p.msg.type !== "CAM") continue;
    const idx = Array.from(p.receivers.ids).indexOf(carId);
    if (idx >= 0 && p.receivers.delivered[idx]) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------- Layers

function Layers({ packet, encoded, view }: { packet: PacketEvent; encoded: Encoded; view: View }) {
  const [open, setOpen] = useState<string>("facilities");
  const ch = view.config.channel;
  const layout = packetLayout(packet.msg.type, ch.security);
  const air = airtime(layout.frame, ch.dataRateMbps);
  const payload = encoded.bytes.length;
  const isCam = packet.msg.type === "CAM";

  const layers: { id: string; name: string; proto: string; bytes: number; color: string; rows: [string, string][] }[] = [
    {
      id: "facilities",
      name: "Facilities",
      proto: isCam ? "CAM · ETSI EN 302 637-2" : "DENM · ETSI EN 302 637-3",
      bytes: payload,
      color: "#3ccf8e",
      rows: [],
    },
    {
      id: "transport",
      name: "Transport",
      proto: "BTP-B · EN 302 636-5-1",
      bytes: layout.btp,
      color: "#4ea1ff",
      rows: [
        ["destinationPort", `${isCam ? 2001 : 2002} (${isCam ? "CAM" : "DENM"})`],
        ["destinationPortInfo", "0"],
      ],
    },
    {
      id: "network",
      name: "Network",
      proto: "GeoNetworking · EN 302 636-4-1",
      bytes: layout.gn,
      color: "#b48cff",
      rows: [
        ["headerType", "TSB / Single-Hop Broadcast"],
        ["sourcePosition", `station ${packet.src}`],
        ["remainingHopLimit", "1"],
        ["trafficClass", isCam ? "CAM (SCF off, channel offload off, TC 2)" : "DENM (TC 0, highest priority)"],
      ],
    },
    {
      id: "security",
      name: "Security",
      proto: `TS 103 097 · ${SECURITY_LABEL[ch.security]}`,
      bytes: layout.security,
      color: "#f5b942",
      rows: [
        [
          "content",
          ch.security === "none"
            ? "no signature"
            : ch.security === "digest"
              ? "ECDSA-P256 signature + 8-byte digest of the signer's certificate"
              : "ECDSA-P256 signature + the full signer certificate",
        ],
        ["note", "approximate size; signing and verification are not simulated"],
      ],
    },
    {
      id: "access",
      name: "Access",
      proto: "ITS-G5 / IEEE 802.11p, 10 MHz at 5.9 GHz (CCH) · EN 302 663",
      bytes: layout.mac,
      color: "#8a94a6",
      rows: [
        ["802.11 framing", "MAC header 24 B + LLC/SNAP 8 B + FCS 4 B = 36 B"],
        ["frame on air", `${layout.frame} B = ${layout.frame * 8} bits (+ 22 service/tail bits)`],
        [
          "OFDM symbols",
          `${air.bits} bits ÷ ${air.bitsPerSymbol} bits/symbol (${ch.dataRateMbps} Mbit/s) = ${air.symbols} symbols × 8 µs`,
        ],
        ["airtime", `40 µs preamble + ${air.symbols * 8} µs data = ${air.us} µs = ${air.ms.toFixed(3)} ms`],
        ["channel capacity", `${Math.floor(ch.cbrWindowMs / air.ms)} such frames per ${ch.cbrWindowMs} ms CBR window`],
        ["propagation + queueing delay", `${view.config.channel.delayMs} ms`],
        ["reception model", "reliable to 70 % of range, then down to 50 % at the edge; × (1 − channel busy ratio)"],
      ],
    },
  ];

  return (
    <div className={s.layers}>
      <div className={s.sizeBar} title="Share of the packet's bytes per layer">
        {layers
          .filter((l) => l.bytes > 0)
          .map((l) => (
            <span key={l.id} style={{ flexGrow: l.bytes, background: l.color }}>
              {l.bytes >= 30 ? `${l.name} ${l.bytes} B` : ""}
            </span>
          ))}
      </div>
      <p className={s.muted}>
        Frame on air {layout.frame} B, occupying the channel for {air.ms.toFixed(3)} ms. The message itself is only{" "}
        {payload} B{layout.security > payload ? "; most of the frame is the security envelope" : ""}.
      </p>
      {layers.map((l) => (
        <div key={l.id} className={s.layer} style={{ borderColor: l.color }}>
          <button className={s.layerHead} onClick={() => setOpen(open === l.id ? "" : l.id)}>
            <Chevron dir={open === l.id ? "down" : "right"} />
            <b>{l.name}</b>
            <span className={s.muted}>{l.proto}</span>
            <span className={s.bytes}>{l.bytes ? `${l.bytes} B` : ""}</span>
          </button>
          {open === l.id &&
            (l.id === "facilities" ? (
              <FieldTree fields={encoded.fields} />
            ) : (
              <dl className={s.kv}>
                {l.rows.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            ))}
        </div>
      ))}
    </div>
  );
}

function FieldTree({ fields }: { fields: EncodedField[] }) {
  const groups = groupFields(fields.filter((f) => !f.overhead));
  return (
    <div className={s.tree}>
      {groups.map(([group, fs]) => (
        <div key={group}>
          <h5 style={{ color: groupColor(group) }}>{group}</h5>
          <dl className={s.kv}>
            {fs.map((f) => (
              <div key={f.path} className={f.simulated ? undefined : s.notSimulated}>
                <dt title={f.path}>{shortPath(f.path)}</dt>
                <dd>
                  {f.value}
                  {f.meaning && <span className={s.muted}> = {f.meaning}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      <p className={s.muted}>Greyed fields are not modelled by the simulator and are sent as “unavailable”.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------- Bits

function Bits({ encoded }: { encoded: Encoded }) {
  const [hover, setHover] = useState<EncodedField | null>(null);
  const [pinned, setPinned] = useState<EncodedField | null>(null);
  const [mode, setMode] = useState<"bin" | "hex">("bin");
  const active = hover ?? pinned;

  const fieldAt = (bit: number) => encoded.fields.find((f) => bit >= f.bitStart && bit < f.bitStart + f.bitLength) ?? null;
  const bitAt = (i: number) => (encoded.bytes[i >> 3] >> (7 - (i & 7))) & 1;
  const totalBits = encoded.bytes.length * 8;
  const perRow = 4; // bytes per row

  return (
    <div className={s.bits}>
      <div className={s.bitsBar}>
        <span>
          {encoded.bitLength} bits → {encoded.bytes.length} bytes (ASN.1 UPER, last {totalBits - encoded.bitLength} bits
          padding)
        </span>
        <div className={s.toggle}>
          <button className={mode === "bin" ? s.tabOn : s.tab} onClick={() => setMode("bin")}>
            0/1
          </button>
          <button className={mode === "hex" ? s.tabOn : s.tab} onClick={() => setMode("hex")}>
            hex
          </button>
        </div>
      </div>

      <div className={s.grid} onMouseLeave={() => setHover(null)}>
        {Array.from({ length: Math.ceil(encoded.bytes.length / perRow) }, (_, row) => (
          <div key={row} className={s.gridRow}>
            <span className={s.offset}>{(row * perRow).toString(16).padStart(4, "0")}</span>
            {Array.from({ length: perRow }, (_, b) => {
              const byte = row * perRow + b;
              if (byte >= encoded.bytes.length) return null;
              if (mode === "hex") {
                const f = fieldAt(byte * 8);
                const lit = active && byte * 8 + 8 > active.bitStart && byte * 8 < active.bitStart + active.bitLength;
                return (
                  <span
                    key={b}
                    className={`${s.hexByte} ${lit ? s.lit : ""}`}
                    style={{ color: f ? groupColor(f.group) : undefined }}
                    onMouseEnter={() => setHover(f)}
                  >
                    {encoded.bytes[byte].toString(16).padStart(2, "0")}
                  </span>
                );
              }
              return (
                <span key={b} className={s.byte}>
                  {Array.from({ length: 8 }, (_, k) => {
                    const i = byte * 8 + k;
                    const f = i < encoded.bitLength ? fieldAt(i) : null;
                    const lit = active && f === active;
                    return (
                      <span
                        key={k}
                        className={`${s.bit} ${lit ? s.lit : ""} ${f?.overhead ? s.overheadBit : ""} ${!f ? s.pad : ""}`}
                        style={f ? { color: groupColor(f.group), background: lit ? undefined : tint(f.group) } : undefined}
                        onMouseEnter={() => setHover(f)}
                        onClick={() => setPinned(f)}
                      >
                        {bitAt(i)}
                      </span>
                    );
                  })}
                </span>
              );
            })}
          </div>
        ))}
      </div>

      <div className={s.fieldInfo}>
        {active ? (
          <>
            <b style={{ color: groupColor(active.group) }}>{shortPath(active.path)}</b>{" "}
            <span className={s.muted}>
              {active.group} · bits {active.bitStart}–{active.bitStart + active.bitLength - 1} ({active.bitLength} bit
              {active.bitLength > 1 ? "s" : ""})
            </span>
            <br />
            {active.overhead ? "PER encoding bits: " : "value "}
            <b>{active.value}</b>
            {active.meaning && <> = {active.meaning}</>}
            {!active.simulated && <span className={s.muted}> (not modelled, sent as unavailable)</span>}
          </>
        ) : (
          <span className={s.muted}>Hover a bit or a field to see what it encodes; click to pin.</span>
        )}
      </div>

      <div className={s.fieldList}>
        {encoded.fields.map((f) => (
          <button
            key={f.path}
            className={`${s.fieldRow} ${active === f ? s.fieldRowOn : ""} ${f.simulated ? "" : s.notSimulated}`}
            onMouseEnter={() => setHover(f)}
            onMouseLeave={() => setHover(null)}
            onClick={() => setPinned(f)}
          >
            <i style={{ background: groupColor(f.group) }} />
            <span>{shortPath(f.path)}</span>
            <span className={s.muted}>{f.bitLength} b</span>
            <span>{f.value}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- helpers

const GROUP_COLORS: Record<string, string> = {
  "ITS PDU header": "#4ea1ff",
  CAM: "#3ccf8e",
  DENM: "#3ccf8e",
  "Basic container": "#b48cff",
  "Management container": "#b48cff",
  "High-frequency container": "#f5b942",
  "Situation container": "#f5b942",
};

function groupColor(g: string): string {
  return GROUP_COLORS[g] ?? "#8a94a6";
}

function tint(g: string): string {
  return groupColor(g) + "1f";
}

function groupFields(fields: EncodedField[]): [string, EncodedField[]][] {
  const out = new Map<string, EncodedField[]>();
  for (const f of fields) {
    if (!out.has(f.group)) out.set(f.group, []);
    out.get(f.group)!.push(f);
  }
  return [...out];
}

/** Drop the message prefix and container names so field names stay readable. */
function shortPath(path: string): string {
  return path
    .replace(/^(cam|denm)\./, "")
    .replace("camParameters.basicContainer.", "")
    .replace("camParameters.highFrequencyContainer.", "")
    .replace("camParameters.", "")
    .replace(/^(management|situation)\./, "");
}
