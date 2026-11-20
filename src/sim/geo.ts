// Conversions between the simulator's local metric frame and CAM field units.
// Local frame: x east, y north, metres; heading in radians, counter-clockwise from +x.
// CAM: latitude/longitude in 0.1 microdegree, heading in 0.1 degree clockwise from north.
import type { Vec2 } from "./types";

const ORIGIN = { lat: 48.1486, lon: 17.1077 }; // Bratislava
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

export function toCamPosition(p: Vec2): { latitude: number; longitude: number } {
  return {
    latitude: Math.round((ORIGIN.lat + p.y / M_PER_DEG_LAT) * 1e7),
    longitude: Math.round((ORIGIN.lon + p.x / M_PER_DEG_LON) * 1e7),
  };
}

export function fromCamPosition(c: { latitude: number; longitude: number }): Vec2 {
  return {
    x: (c.longitude / 1e7 - ORIGIN.lon) * M_PER_DEG_LON,
    y: (c.latitude / 1e7 - ORIGIN.lat) * M_PER_DEG_LAT,
  };
}

export function toCamHeading(rad: number): number {
  const deg = 90 - (rad * 180) / Math.PI;
  return Math.round((((deg % 360) + 360) % 360) * 10);
}

export function fromCamHeading(h: number): number {
  return ((90 - h / 10) * Math.PI) / 180;
}
