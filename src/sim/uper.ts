// ASN.1 Unaligned PER (UPER) encoder for the CAM and DENM fields this simulator uses.
// Follows the structure of ETSI EN 302 637-2 (CAM v1.4.1), EN 302 637-3 (DENM v1.3.1) and the
// Common Data Dictionary TS 102 894-2 (v1.3.1). Fields the simulator does not model are encoded
// with their "unavailable" value. Written for teaching/visualisation; not validated against a
// certified codec.
import type { Cam, Denm } from "./types";

export interface EncodedField {
  path: string; // e.g. "cam.camParameters.highFrequencyContainer.speed.speedValue"
  name: string; // last path segment
  group: string; // container it belongs to (for colouring)
  bitStart: number;
  bitLength: number;
  value: number | string;
  meaning?: string;
  /** false = not modelled by the simulator, encoded as "unavailable" or a fixed default. */
  simulated: boolean;
  /** PER overhead (extension bit, optional-field bitmap, CHOICE index) rather than data. */
  overhead?: boolean;
}

export interface Encoded {
  bytes: Uint8Array;
  bitLength: number;
  fields: EncodedField[];
}

class BitWriter {
  private bits: number[] = [];
  readonly fields: EncodedField[] = [];
  private group = "";

  setGroup(g: string) {
    this.group = g;
  }

  /** Constrained whole number in [lo, hi]: offset from lo in ceil(log2(range)) bits. */
  int(path: string, value: number, lo: number, hi: number, opts: { meaning?: string; simulated?: boolean } = {}) {
    const v = Math.max(lo, Math.min(hi, Math.round(value)));
    const width = Math.ceil(Math.log2(hi - lo + 1));
    this.push(path, v - lo, width, v, opts.meaning, opts.simulated ?? true, false);
  }

  /** ENUMERATED with n root values (no extension marker). */
  enumerated(path: string, index: number, n: number, label: string, simulated = true) {
    this.push(path, index, Math.ceil(Math.log2(n)), index, label, simulated, false);
  }

  /** PER preamble bits: extension marker, optional-field presence bitmap, CHOICE index. */
  overhead(path: string, value: number, width: number, meaning: string) {
    this.push(path, value, width, value.toString(2).padStart(width, "0"), meaning, true, true);
  }

  private push(
    path: string,
    raw: number,
    width: number,
    value: number | string,
    meaning: string | undefined,
    simulated: boolean,
    overhead: boolean,
  ) {
    const start = this.bits.length;
    for (let i = width - 1; i >= 0; i--) this.bits.push(Math.floor(raw / 2 ** i) % 2);
    const name = path.split(".").pop()!;
    this.fields.push({ path, name, group: this.group, bitStart: start, bitLength: width, value, meaning, simulated, overhead });
  }

  finish(): Encoded {
    const bytes = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((b, i) => {
      if (b) bytes[i >> 3] |= 0x80 >> (i & 7);
    });
    return { bytes, bitLength: this.bits.length, fields: this.fields };
  }
}

function header(w: BitWriter, prefix: string, h: { protocolVersion: number; messageId: number; stationId: number }) {
  w.setGroup("ITS PDU header");
  w.int(`${prefix}.header.protocolVersion`, h.protocolVersion, 0, 255);
  w.int(`${prefix}.header.messageID`, h.messageId, 0, 255, { meaning: h.messageId === 2 ? "cam" : "denm" });
  w.int(`${prefix}.header.stationID`, h.stationId, 0, 4294967295);
}

function referencePosition(w: BitWriter, p: string, pos: { latitude: number; longitude: number }) {
  w.int(`${p}.latitude`, pos.latitude, -900000000, 900000001, { meaning: `${(pos.latitude / 1e7).toFixed(7)}°` });
  w.int(`${p}.longitude`, pos.longitude, -1800000000, 1800000001, { meaning: `${(pos.longitude / 1e7).toFixed(7)}°` });
  const u = { simulated: false, meaning: "unavailable" };
  w.int(`${p}.positionConfidenceEllipse.semiMajorConfidence`, 4095, 0, 4095, u);
  w.int(`${p}.positionConfidenceEllipse.semiMinorConfidence`, 4095, 0, 4095, u);
  w.int(`${p}.positionConfidenceEllipse.semiMajorOrientation`, 3601, 0, 3601, u);
  w.int(`${p}.altitude.altitudeValue`, 800001, -100000, 800001, u);
  w.enumerated(`${p}.altitude.altitudeConfidence`, 15, 16, "unavailable", false);
}

export function encodeCam(c: Cam): Encoded {
  const w = new BitWriter();
  header(w, "cam", c.header);

  w.setGroup("CAM");
  w.int("cam.generationDeltaTime", c.generationDeltaTime, 0, 65535, { meaning: "ms, mod 65 536" });
  w.overhead("cam.camParameters.preamble", 0b000, 3, "no extensions · no low-frequency · no special-vehicle container");

  const bc = "cam.camParameters.basicContainer";
  w.setGroup("Basic container");
  w.overhead(`${bc}.extension`, 0, 1, "no extensions");
  w.int(`${bc}.stationType`, c.basicContainer.stationType, 0, 255, { meaning: "passengerCar" });
  referencePosition(w, `${bc}.referencePosition`, c.basicContainer.referencePosition);

  const hf = c.highFrequencyContainer;
  const p = "cam.camParameters.highFrequencyContainer";
  w.setGroup("High-frequency container");
  w.overhead(`${p}.choice`, 0b00, 2, "no extension · basicVehicleContainerHighFrequency");
  w.overhead(`${p}.optionals`, 0, 7, "no optional fields present");
  w.int(`${p}.heading.headingValue`, hf.heading, 0, 3601, { meaning: `${(hf.heading / 10).toFixed(1)}°` });
  w.int(`${p}.heading.headingConfidence`, 127, 1, 127, { simulated: false, meaning: "unavailable" });
  w.int(`${p}.speed.speedValue`, hf.speed, 0, 16383, { meaning: `${(hf.speed / 100).toFixed(2)} m/s` });
  w.int(`${p}.speed.speedConfidence`, 127, 1, 127, { simulated: false, meaning: "unavailable" });
  w.enumerated(`${p}.driveDirection`, 0, 3, "forward");
  w.int(`${p}.vehicleLength.vehicleLengthValue`, hf.vehicleLength, 1, 1023, { meaning: `${(hf.vehicleLength / 10).toFixed(1)} m` });
  w.enumerated(`${p}.vehicleLength.vehicleLengthConfidenceIndication`, 4, 5, "unavailable", false);
  w.int(`${p}.vehicleWidth`, hf.vehicleWidth, 1, 62, { meaning: `${(hf.vehicleWidth / 10).toFixed(1)} m` });
  w.int(`${p}.longitudinalAcceleration.longitudinalAccelerationValue`, hf.longitudinalAcceleration, -160, 161, {
    meaning: `${(hf.longitudinalAcceleration / 10).toFixed(1)} m/s²`,
  });
  w.int(`${p}.longitudinalAcceleration.longitudinalAccelerationConfidence`, 102, 0, 102, { simulated: false, meaning: "unavailable" });
  w.int(`${p}.curvature.curvatureValue`, 1023, -1023, 1023, { simulated: false, meaning: "unavailable" });
  w.enumerated(`${p}.curvature.curvatureConfidence`, 7, 8, "unavailable", false);
  w.overhead(`${p}.curvatureCalculationMode.extension`, 0, 1, "no extension");
  w.enumerated(`${p}.curvatureCalculationMode`, 2, 3, "unavailable", false);
  w.int(`${p}.yawRate.yawRateValue`, 32767, -32766, 32767, { simulated: false, meaning: "unavailable" });
  w.overhead(`${p}.yawRate.yawRateConfidence.extension`, 0, 1, "no extension");
  w.enumerated(`${p}.yawRate.yawRateConfidence`, 8, 9, "unavailable", false);
  return w.finish();
}

export function encodeDenm(d: Denm): Encoded {
  const w = new BitWriter();
  header(w, "denm", d.header);

  w.setGroup("DENM");
  w.overhead("denm.preamble", 0b100, 3, "situation present · no location · no à-la-carte");

  const m = "denm.management";
  w.setGroup("Management container");
  w.overhead(`${m}.preamble`, 0b000000, 6, "no extensions · no optional fields");
  w.int(`${m}.actionID.originatingStationID`, d.header.stationId, 0, 4294967295);
  w.int(`${m}.actionID.sequenceNumber`, 0, 0, 65535, { simulated: false });
  w.int(`${m}.detectionTime`, d.management.detectionTime, 0, 4398046511103, { meaning: "ms (simulation clock; real DENMs count from 2004)" });
  w.int(`${m}.referenceTime`, d.management.detectionTime, 0, 4398046511103, { meaning: "ms (simulation clock; real DENMs count from 2004)" });
  referencePosition(w, `${m}.eventPosition`, d.management.eventPosition);
  w.int(`${m}.stationType`, 5, 0, 255, { meaning: "passengerCar" });

  const s = "denm.situation";
  w.setGroup("Situation container");
  w.overhead(`${s}.preamble`, 0b000, 3, "no extensions · no linked cause · no event history");
  w.int(`${s}.informationQuality`, 0, 0, 7, { simulated: false, meaning: "unavailable" });
  w.int(`${s}.eventType.causeCode`, d.situation.causeCode, 0, 255, { meaning: "dangerousSituation" });
  w.int(`${s}.eventType.subCauseCode`, d.situation.subCauseCode, 0, 255, { meaning: "emergencyElectronicBrakeEngaged" });
  return w.finish();
}
