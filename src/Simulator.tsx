import React, { useRef, useState } from "react";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
type EventDef = { Name: string; Chance: number };

function ceilBuckets(events: EventDef[]) {
  return events.map((e) => Math.ceil(e.Chance * 100));
}

function baseProbsFromBuckets(buckets: number[]) {
  const sum = buckets.reduce((s, v) => s + v, 0);
  if (sum === 0) return buckets.map(() => 1 / buckets.length);
  return buckets.map((b) => b / sum);
}

function stationaryNoRepeat(baseProbs: number[]) {
  const n = baseProbs.length;
  if (n <= 1) return baseProbs;
  let stationary = baseProbs.slice();
  const tol = 1e-12;
  for (let iter = 0; iter < 10000; iter++) {
    const next = new Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      const pj = baseProbs[j];
      const den = 1 - pj;
      if (den <= 0) continue;
      for (let i = 0; i < n; i++) {
        if (i === j) continue;
        const trans = baseProbs[i] / den;
        next[i] += stationary[j] * trans;
      }
    }
    const sumNext = next.reduce((s, v) => s + v, 0);
    if (sumNext === 0) break;
    for (let i = 0; i < n; i++) next[i] /= sumNext;
    let maxdiff = 0;
    for (let i = 0; i < n; i++)
      maxdiff = Math.max(maxdiff, Math.abs(next[i] - stationary[i]));
    stationary = next;
    if (maxdiff < tol) break;
  }
  return stationary;
}

export default function Simulator() {
  const [events, setEvents] = useState<EventDef[]>([
    { Name: "Aurora", Chance: 0.85 },
    { Name: "Blizzard", Chance: 0.4 },
    { Name: "ExtremeCold", Chance: 0.4 },
    { Name: "SnowfallE", Chance: 0.6 },
    { Name: "EVRStorm", Chance: 0.35 },
    { Name: "HeavyFog", Chance: 0.3 },
  ]);
  const [eventMin, setEventMin] = useState(550);
  const [eventMax, setEventMax] = useState(1100);
  const [restartsPerDay, setRestartsPerDay] = useState(4);
  const [analytic, setAnalytic] = useState<any[]>([]);
  const simRunningRef = useRef(false);
  const [daysResults, setDaysResults] = useState<
    Array<{ day: number; total: number; counts: number[] }>
  >([]);
  const [maxSimDays, setMaxSimDays] = useState(0); // 0 = run until stopped
  const [msBetweenDays, setMsBetweenDays] = useState(10);

  // Default events are defined inline above; no external fetch required.

  function addRow() {
    setEvents((e) => [...e, { Name: "NewEvent", Chance: 0.1 }]);
  }
  function removeRow(i: number) {
    setEvents((e) => e.filter((_, idx) => idx !== i));
  }
  function moveUp(i: number) {
    if (i <= 0) return;
    setEvents((e) => {
      const a = [...e];
      const tmp = a[i - 1];
      a[i - 1] = a[i];
      a[i] = tmp;
      return a;
    });
  }
  function moveDown(i: number) {
    setEvents((e) => {
      const a = [...e];
      if (i >= a.length - 1) return a;
      const tmp = a[i + 1];
      a[i + 1] = a[i];
      a[i] = tmp;
      return a;
    });
  }

  function runAnalytic() {
    const buckets = ceilBuckets(events);
    const base = baseProbsFromBuckets(buckets);
    const stat = stationaryNoRepeat(base);
    const meanDelay = (eventMin + eventMax) / 2;
    const windowSeconds = Math.floor((24 * 60 * 60) / restartsPerDay);
    const eventsPerWindow = windowSeconds / meanDelay;
    const eventsPerDay = eventsPerWindow * restartsPerDay;
    const rows = events.map((ev, i) => ({
      Event: ev.Name,
      Bucket: buckets[i],
      Prob: +stat[i].toFixed(6),
      PerWindow: +(eventsPerWindow * stat[i]).toFixed(3),
      PerDay: +(eventsPerDay * stat[i]).toFixed(3),
    }));
    setAnalytic(rows);
  }

  function buildExpanded(buckets: number[]) {
    const expanded: number[] = [];
    for (let i = 0; i < buckets.length; i++) {
      const repeats = Math.max(0, buckets[i]);
      for (let r = 0; r < repeats; r++) expanded.push(i);
    }
    if (expanded.length === 0) {
      // fallback to uniform indices
      for (let i = 0; i < buckets.length; i++) expanded.push(i);
    }
    return expanded;
  }

  function pickEventIndex(expanded: number[], lastIdx: number | null) {
    if (expanded.length === 0) return 0;
    // redraw if equal to last to prevent immediate repeat
    for (let attempt = 0; attempt < 200; attempt++) {
      const r = Math.floor(Math.random() * expanded.length);
      const idx = expanded[r];
      if (lastIdx === null || idx !== lastIdx) return idx;
    }
    // give up and return whatever
    return expanded[Math.floor(Math.random() * expanded.length)];
  }

  function simulateOneDay(dayIndex: number) {
    const buckets = ceilBuckets(events);
    const expanded = buildExpanded(buckets);
    const counts = new Array(events.length).fill(0);
    const windowSeconds = Math.floor((24 * 60 * 60) / restartsPerDay);
    const meanDelay = (eventMin + eventMax) / 2;
    // simulate each restart window separately
    let lastIdx: number | null = null;
    for (let r = 0; r < restartsPerDay; r++) {
      const winStart = r * windowSeconds;
      const winEnd = winStart + windowSeconds;
      let t = winStart;
      while (true) {
        // sample a uniform delay between min and max
        const delay = eventMin + Math.random() * (eventMax - eventMin);
        t += delay;
        if (t > winEnd) break;
        const idx = pickEventIndex(expanded, lastIdx);
        counts[idx]++;
        lastIdx = idx;
      }
    }
    const total = counts.reduce((s, v) => s + v, 0);
    return { day: dayIndex, total, counts };
  }

  function startSimulation() {
    if (simRunningRef.current) return;
    simRunningRef.current = true;
    let day = daysResults.length + 1;
    function step() {
      if (!simRunningRef.current) return;
      if (maxSimDays > 0 && day > maxSimDays) {
        simRunningRef.current = false;
        return;
      }
      // run one day simulation
      const res = simulateOneDay(day);
      setDaysResults((prev) => [...prev, res]);
      day++;
      // schedule next day
      setTimeout(() => {
        // allow React to update UI between iterations
        if (simRunningRef.current) step();
      }, Math.max(0, msBetweenDays));
    }
    step();
  }

  function stopSimulation() {
    simRunningRef.current = false;
  }

  function resetSimulation() {
    // stop and clear results
    simRunningRef.current = false;
    setDaysResults([]);
  }

  const runningAverage =
    daysResults.length === 0
      ? 0
      : daysResults.reduce((s, r) => s + r.total, 0) / daysResults.length;

  return (
    <div>
      <div style={{ display: "flex", gap: 10 }}>
        <div className="overflow-hidden rounded-md border">
          <h3 className="scroll-m-20 text-2xl font-semibold tracking-tight">
            Events
          </h3>
          <Separator />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Chance</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((ev, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Input
                      value={ev.Name}
                      onChange={(e) =>
                        setEvents((s) => {
                          const a = [...s];
                          a[i] = { ...a[i], Name: e.target.value };
                          return a;
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      value={ev.Chance}
                      onChange={(e) =>
                        setEvents((s) => {
                          const a = [...s];
                          a[i] = {
                            ...a[i],
                            Chance: parseFloat(e.target.value || "0"),
                          };
                          return a;
                        })
                      }
                      style={{ width: 100 }}
                    />
                  </TableCell>
                  <TableCell style={{ whiteSpace: "nowrap" }}>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="size-8"
                      onClick={() => moveUp(i)}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="size-8"
                      onClick={() => moveDown(i)}
                    >
                      ↓
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon"
                      className="size-8"
                      onClick={() => removeRow(i)}
                    >
                      ✖
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Button onClick={addRow}>Add event</Button>
        </div>
        <div className="overflow-hidden rounded-md border">
          <h3 className="scroll-m-20 text-2xl font-semibold tracking-tight">
            Settings
          </h3>
          <Separator />
          <Label>
            Event Min (s)
            <Input
              type="number"
              value={eventMin}
              onChange={(e) => setEventMin(parseInt(e.target.value || "0"))}
            />
          </Label>
          <br />
          <Label>
            Event Max (s)
            <Input
              type="number"
              value={eventMax}
              onChange={(e) => setEventMax(parseInt(e.target.value || "0"))}
            />
          </Label>
          <br />
          <Label>
            Restarts/day
            <Input
              type="number"
              value={restartsPerDay}
              onChange={(e) =>
                setRestartsPerDay(parseInt(e.target.value || "0"))
              }
            />
          </Label>
          <br />
          <Button onClick={runAnalytic}>Calculate</Button>
        </div>
        <div className="overflow-hidden rounded-md border">
          <h3 className="scroll-m-20 text-2xl font-semibold tracking-tight">
            Calculation
          </h3>
          <Separator />
          <Table style={{ width: "100%", borderCollapse: "collapse" }}>
            <TableHeader>
              <TableRow>
                <TableHead
                  style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}
                >
                  Event
                </TableHead>
                <TableHead
                  style={{ textAlign: "right", borderBottom: "1px solid #ccc" }}
                >
                  Bucket
                </TableHead>
                <TableHead
                  style={{ textAlign: "right", borderBottom: "1px solid #ccc" }}
                >
                  Probability
                </TableHead>
                <TableHead
                  style={{ textAlign: "right", borderBottom: "1px solid #ccc" }}
                >
                  Avg Per Restart
                </TableHead>
                <TableHead
                  style={{ textAlign: "right", borderBottom: "1px solid #ccc" }}
                >
                  Avg Per Day
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analytic.map((r) => (
                <TableRow key={r.Event}>
                  <TableCell>{r.Event}</TableCell>
                  <TableCell style={{ textAlign: "right" }}>
                    {r.Bucket}
                  </TableCell>
                  <TableCell style={{ textAlign: "right" }}>
                    {(r.Prob * 100).toFixed(1) + "%"}
                  </TableCell>
                  <TableCell style={{ textAlign: "right" }}>
                    {r.PerWindow.toFixed(2)}
                  </TableCell>
                  <TableCell style={{ textAlign: "right" }}>
                    {r.PerDay.toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      <br />

      <h2 className="scroll-m-20 pb-2 text-3xl font-semibold tracking-tight first:mt-0">
        Simulation
      </h2>
      <div style={{ display: "flex", gap: 10 }}>
        <div className="overflow-hidden rounded-md border">
          <h3 className="scroll-m-20 text-2xl font-semibold tracking-tight">
            Controls
          </h3>
          <Label>
            Max days (0 = until stopped)
            <Input
              type="number"
              value={maxSimDays}
              onChange={(e) => setMaxSimDays(parseInt(e.target.value || "0"))}
            />
          </Label>
          <br />
          <Label>
            Delay between days (ms)
            <Input
              type="number"
              value={msBetweenDays}
              onChange={(e) =>
                setMsBetweenDays(parseInt(e.target.value || "0"))
              }
            />
          </Label>
          <br />
          <Button onClick={startSimulation}>Start</Button>
          <Button
            variant="secondary"
            onClick={stopSimulation}
            style={{ marginLeft: 8 }}
          >
            Stop
          </Button>
          <Button
            variant="destructive"
            onClick={resetSimulation}
            style={{ marginLeft: 8 }}
          >
            Reset
          </Button>
        </div>
        <div className="overflow-hidden rounded-md border">
          <div>
            Average Total Events: <strong>{runningAverage.toFixed(2)}</strong>{" "}
            (based on {daysResults.length} days)
          </div>
          <div style={{ marginTop: 6 }}>
            <div>Average Events per day:</div>
            <ul style={{ marginTop: 6, paddingLeft: 16 }}>
              {events.map((ev, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  {ev.Name}:{" "}
                  <strong>
                    {(daysResults.length === 0
                      ? 0
                      : daysResults.reduce(
                          (s, r) => s + (r.counts[i] || 0),
                          0
                        ) / daysResults.length
                    ).toFixed(2)}
                  </strong>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <div>
        <br />
                <div className="overflow-hidden rounded-md border">
        <h3 className="scroll-m-20 text-2xl font-semibold tracking-tight">Results</h3>
        
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              <TableHead style={{ textAlign: "right" }}>Events</TableHead>
              {events.map((ev, i) => (
                <TableCell key={i} style={{ textAlign: "right" }}>
                  {ev.Name}
                </TableCell>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {daysResults.map((r) => (
              <TableRow key={r.day}>
                <TableCell>{r.day}</TableCell>
                <TableCell style={{ textAlign: "right" }}>{r.total}</TableCell>
                {events.map((_, i) => (
                  <TableCell key={i} style={{ textAlign: "right" }}>
                    {r.counts[i] ?? 0}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </div>
    </div>
  );
}
