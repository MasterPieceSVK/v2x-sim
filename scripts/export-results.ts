// Turns results/<scenario>-summary.csv into src/data/results.json for the in-app Results tab.
// Usage: npm run results:export   (after npm run experiment -- <scenario>)
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const scenarios = ["emergency-brake", "intersection", "highway-merge"];
const out: Record<string, unknown[]> = {};
for (const sc of scenarios) {
  const path = `results/${sc}-summary.csv`;
  if (!existsSync(path)) continue;
  const [head, ...lines] = readFileSync(path, "utf8").trim().split("\n");
  const cols = head.split(",");
  out[sc] = lines.map((line) => {
    const cells = line.split(",");
    const get = (c: string) => cells[cols.indexOf(c)];
    const metrics: Record<string, [number, number]> = {};
    for (const c of cols) {
      if (!c.endsWith("_mean")) continue;
      const name = c.slice(0, -5);
      metrics[name] = [Number(get(c)), Number(get(`${name}_ci95`))];
    }
    return {
      cam: get("cam_mode"),
      vehicles: Number(get("vehicles")),
      others: Number(get("background_stations")),
      denm: get("denm_reaction") === "true",
      runs: Number(get("runs")),
      metrics,
    };
  });
}
writeFileSync("src/data/results.json", JSON.stringify(out));
console.log(`Wrote src/data/results.json (${Object.entries(out).map(([k, v]) => `${k}: ${v.length} settings`).join(", ")})`);
