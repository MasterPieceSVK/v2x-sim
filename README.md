# V2X Simulator with an ITS-G5 packet tracer

**Live:** [v2x.jaroscak.sk](https://v2x.jaroscak.sk)

This browser-based simulator shows how often connected vehicles should send their status messages, and what happens when they send them too often or too rarely.

Cars broadcast ETSI ITS-G5 messages over a shared radio channel. You can watch every message on the map, open it like in a packet tracer (layers, fields, and the actual bits), and see whether each car received it. If the cars send too rarely, they work with outdated information. If they send too often, the channel fills up and messages get lost. Both lead to collisions.

The project was built as a proof of concept for a student paper at STU FIIT (Bratislava):
*"A Browser-Based V2X Simulator with an ETSI ITS-G5 Packet Tracer: How Message Frequency Affects Collisions of Autonomous Vehicles"*, by Maximilian Jaroščák and Matej Janeba.

> **This is a teaching and research tool, not a validated network simulator.** The radio and vehicle models are simplified on purpose (see [Model and limitations](#model-and-limitations)). For results you would publish as engineering truth, use a dedicated tool such as Artery, Veins or ns-3 together with SUMO.

---

## What you can do

- **Three scenarios**
  - **Intersection**: an uncontrolled four-way crossing. Cars decide who goes first from what they *believe* about the others.
  - **Highway merge**: an on-ramp joins a busy highway. Merging cars look for a gap, and cars on the highway make room.
  - **Platoon emergency brake**: a column of cars follows closely (cooperative adaptive cruise control, CACC). The leader brakes hard and the others have to react in time.
- **CAM sending rate**: send at a fixed rate (1, 2, 5 or 10 Hz), or use the adaptive ETSI rules (EN 302 637-2), which send when a car has moved, turned or changed speed enough.
- **Channel load**: add "other stations in range" (vehicles that are not on the map but still share the radio channel) to push the channel toward overload, and watch delivery fall.
- **Packet tracer**: a timeline of every message, a list you can filter, and an inspector with the layers (PHY, MAC, GeoNetworking, BTP, security, payload), the ASN.1 fields and a binary or hex view of the bits.
- **A car's point of view**: select a car to see what it knows, where it believes the others are (dashed outlines on the map) and which messages it missed.
- **Timeline**: play, pause, scrub and jump to collisions, near-misses and emergency brakes. Each event has a "Why?" that explains its cause.
- **Compare mode**: two simulations side by side, each with its own settings, for example 2 Hz against 10 Hz on the same traffic.
- **Presets** for typical situations (a lost CAM, a stale platoon, an overloaded channel and more), and a **Results** panel with the batch experiment charts.
- **Built-in guide and glossary**: an illustrated walkthrough for people who have never heard of V2X, and a tooltip on every technical term.

The simulator is designed for desktop screens. On a phone it asks you to use a computer.

---

## Quick start

Requires Node.js 20 or newer.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000.

### Build and host

The site is a fully static export with no server code:

```bash
npm run build
```

This writes plain HTML, JS and CSS to `out/`. Upload that folder to any static host (nginx, Apache, GitHub Pages, Cloudflare Pages, Netlify and so on). Everything runs in the visitor's browser.

---

## Batch experiments

The same simulation engine runs headless from the command line. It sweeps CAM rates, traffic and channel load over many random seeds:

```bash
npm run experiment -- emergency-brake
```

```bash
npm run experiment -- intersection
```

```bash
npm run experiment -- highway-merge
```

Each run writes two files to `results/`:

- `<scenario>.csv`: one row per run.
- `<scenario>-summary.csv`: the mean and the 95 % confidence half-width for each setting.

To refresh the charts in the app's Results panel, run:

```bash
npm run results:export
```

This rebuilds `src/data/results.json` from those CSVs.

| Scenario | Duration | Seeds | Vehicles | Other stations | CAM modes |
|---|---|---|---|---|---|
| Platoon emergency brake | 120 s | 30 | 10, 20 | 0–300 | 1, 2, 5, 10 Hz, ETSI (with and without the DENM reaction) |
| Intersection | 300 s | 20 | 20, 40 | 0, 100, 200 | 1, 2, 5, 10 Hz, ETSI |
| Highway merge | 120 s | 20 | 30 | 0–300 | 1, 2, 5, 10 Hz, ETSI |

The simulation is deterministic: the same configuration and seed always give the same run, in the browser and on the command line.

---

## How it works

```
src/
  sim/                 simulation engine (plain TypeScript, no React)
    simulation.ts      vehicles, scenarios, decisions, safety checks
    radio.ts           airtime, channel busy ratio (CBR), packet delivery
    uper.ts            ASN.1 UPER encoding of CAM and DENM
    beliefs.ts         what each car believes about the others
    recorder.ts        records a whole run for instant scrubbing
    geo.ts, rng.ts     geometry and a seeded random number generator
  components/          React UI (map canvas, packet tracer, sidebar, guide, ...)
  data/results.json    experiment results shown in the Results panel
scripts/               headless experiments and the results export
```

- **The whole run is computed up front.** The engine runs at a fixed 10 ms step in small chunks, so the page stays responsive. It records the vehicles every 50 ms, each car's beliefs every 100 ms, and every packet. Scrubbing then only reads the recording, so jumping back and forth never changes the outcome.
- **Cars act only on what they have received.** Every 100 ms each car plans using its neighbour table, which is built from received messages. That is why lost or stale messages can cause crashes. Its own sensors only see a short distance.
- **The channel is shared.** Each message takes airtime on the radio channel. The time it takes depends on the packet size and the data rate, using the IEEE 802.11p timing at 6 Mbit/s on a 10 MHz channel. The share of time the channel is busy in each 100 ms is the channel busy ratio (CBR). The chance that a message arrives falls with distance and with the CBR.

### Standards used

| Area | Reference | What the simulator uses |
|---|---|---|
| CAM | ETSI EN 302 637-2 | Triggers (4 m, 4°, 0.5 m/s), interval between 100 ms and 1 s |
| DENM | ETSI EN 302 637-3 | Emergency braking warning (cause code 99, dangerous situation) |
| Encoding | ASN.1 UPER | CAM and DENM encoded field by field, shown as bits |
| Radio | IEEE 802.11p / ITS-G5 | Airtime from the preamble, OFDM symbols and data rate |
| Congestion control (DCC) | ETSI TS 102 687 | Reactive gap between messages based on the CBR (adaptive ETSI mode) |
| Security | ETSI TS 103 097 | Overhead for the full certificate or the shorter certificate digest |

### Model and limitations

These are simplified on purpose:

- **Radio**: the chance that a message arrives comes from a distance curve multiplied by (1 − CBR). There is no fading, no shadowing by buildings and no hidden-terminal effect. Collisions on the radio channel are approximated through the CBR rather than simulated one by one.
- **Other stations**: they only add load to the channel and do not appear on the map. They send the same amount of airtime as a simulated car.
- **Vehicles**: speed following uses the Intelligent Driver Model (IDM). Intersection right of way goes by arrival time. Platoons use simple CACC gains. Merging uses fixed gap rules. Real automated vehicles use far richer sensing and planning.
- **ASN.1 encoding**: the bits follow the CAM and DENM structure but are **not validated** against an official decoder.
- **Security**: only the size overhead is modelled. Nothing is signed or verified.

Treat the numbers as showing *trends* (for example, that both too few and too many messages hurt), not as figures to expect on real roads.

---

## Tech

[Next.js](https://nextjs.org) 16 (App Router, static export), React 19 and TypeScript. The map and timelines are drawn on canvas. There are no runtime dependencies besides React and Next.js.

```bash
npm run lint
```

```bash
npx tsc --noEmit
```

---

## Citing

If you use this simulator in teaching or research, please cite the paper:

```
M. Jaroščák, M. Janeba. A Browser-Based V2X Simulator with an ETSI ITS-G5 Packet Tracer:
How Message Frequency Affects Collisions of Autonomous Vehicles. STU FIIT, 2026.
```
