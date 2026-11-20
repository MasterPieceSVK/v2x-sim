// How big a V2X packet is and how long it occupies the radio channel.
// ITS-G5 access layer (ETSI EN 302 663) = IEEE 802.11p OFDM on a 10 MHz channel at 5.9 GHz:
//   - one OFDM symbol lasts 8 µs; preamble (32 µs) + SIGNAL field (8 µs) = 40 µs before the data
//   - data rate R Mbit/s carries R × 8 data bits per symbol (6 Mbit/s → 48 bits)
//   - DATA = 16 service bits + frame bits + 6 tail bits, padded to whole symbols
// Only time on air counts towards the channel busy ratio (CBR), as measured by real radios.
import { encodeCam, encodeDenm } from "./uper";
import type { Cam, Denm } from "./types";

export type SecurityMode = "certificate" | "digest" | "none";

export const DATA_RATES_MBPS = [3, 4.5, 6, 9, 12, 18, 24, 27];

export const SECURITY_BYTES: Record<SecurityMode, number> = {
  // TS 103 097 signed message: header info + ECDSA-P256 signature, signer = full certificate (~215 B)
  // or an 8-byte certificate digest (~100 B). Approximations; real sizes vary by a few bytes.
  certificate: 215,
  digest: 100,
  none: 0,
};

export const SECURITY_LABEL: Record<SecurityMode, string> = {
  certificate: "signed, full certificate",
  digest: "signed, certificate digest",
  none: "unsigned",
};

export const BTP_BYTES = 4; // BTP-B header
export const GN_BYTES = 40; // GeoNetworking basic (4) + common (8) + single-hop broadcast (28)
export const MAC_BYTES = 36; // 802.11 MAC header (24) + LLC/SNAP (8) + FCS (4)

const PREAMBLE_US = 40;
const SYMBOL_US = 8;
const SERVICE_TAIL_BITS = 16 + 6;

export interface PacketLayout {
  payload: number; // facilities message (UPER)
  security: number;
  gn: number;
  btp: number;
  mac: number;
  /** Everything handed to the radio, without the MAC framing. */
  packet: number;
  /** Bytes in the 802.11 frame. */
  frame: number;
}

export interface Airtime {
  bits: number;
  bitsPerSymbol: number;
  symbols: number;
  us: number;
  ms: number;
}

let camPayload: number | null = null;
let denmPayload: number | null = null;

/** UPER size of the facilities message (constant for our fields; computed once from the encoder). */
function payloadBytes(type: "CAM" | "DENM"): number {
  if (type === "CAM") {
    camPayload ??= encodeCam(dummyCam()).bytes.length;
    return camPayload;
  }
  denmPayload ??= encodeDenm(dummyDenm()).bytes.length;
  return denmPayload;
}

export function packetLayout(type: "CAM" | "DENM", security: SecurityMode): PacketLayout {
  const payload = payloadBytes(type);
  const sec = SECURITY_BYTES[security];
  const packet = payload + sec + GN_BYTES + BTP_BYTES;
  return { payload, security: sec, gn: GN_BYTES, btp: BTP_BYTES, mac: MAC_BYTES, packet, frame: packet + MAC_BYTES };
}

export function airtime(frameBytes: number, rateMbps: number): Airtime {
  const bits = SERVICE_TAIL_BITS + frameBytes * 8;
  const bitsPerSymbol = rateMbps * SYMBOL_US;
  const symbols = Math.ceil(bits / bitsPerSymbol);
  const us = PREAMBLE_US + symbols * SYMBOL_US;
  return { bits, bitsPerSymbol, symbols, us, ms: us / 1000 };
}

function dummyCam(): Cam {
  return {
    header: { protocolVersion: 2, messageId: 2, stationId: 1 },
    generationDeltaTime: 0,
    basicContainer: { stationType: 5, referencePosition: { latitude: 0, longitude: 0 } },
    highFrequencyContainer: {
      heading: 0,
      speed: 0,
      driveDirection: "forward",
      vehicleLength: 45,
      vehicleWidth: 18,
      longitudinalAcceleration: 0,
    },
  };
}

function dummyDenm(): Denm {
  return {
    header: { protocolVersion: 2, messageId: 1, stationId: 1 },
    management: { detectionTime: 0, eventPosition: { latitude: 0, longitude: 0 } },
    situation: { causeCode: 99, subCauseCode: 1 },
  };
}
