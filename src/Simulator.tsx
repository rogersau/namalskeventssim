import React, { useEffect, useRef, useState } from 'react'

type EventDef = { Name: string; Chance: number }

function ceilBuckets(events: EventDef[]) {
  return events.map(e => Math.ceil(e.Chance * 100))
}

function baseProbsFromBuckets(buckets: number[]) {
  const sum = buckets.reduce((s, v) => s + v, 0)
  if (sum === 0) return buckets.map(() => 1 / buckets.length)
  return buckets.map(b => b / sum)
}

function stationaryNoRepeat(baseProbs: number[]) {
  const n = baseProbs.length
  if (n <= 1) return baseProbs
  let stationary = baseProbs.slice()
  const tol = 1e-12
  for (let iter = 0; iter < 10000; iter++) {
    const next = new Array(n).fill(0)
    for (let j = 0; j < n; j++) {
      const pj = baseProbs[j]
      const den = 1 - pj
      if (den <= 0) continue
      for (let i = 0; i < n; i++) {
        if (i === j) continue
        const trans = baseProbs[i] / den
        next[i] += stationary[j] * trans
      }
    }
    const sumNext = next.reduce((s, v) => s + v, 0)
    if (sumNext === 0) break
    for (let i = 0; i < n; i++) next[i] /= sumNext
    let maxdiff = 0
    for (let i = 0; i < n; i++) maxdiff = Math.max(maxdiff, Math.abs(next[i] - stationary[i]))
    stationary = next
    if (maxdiff < tol) break
  }
  return stationary
}

export default function Simulator() {
  const [events, setEvents] = useState<EventDef[]>([])
  const [eventMin, setEventMin] = useState(1800)
  const [eventMax, setEventMax] = useState(2100)
  const [restartsPerDay, setRestartsPerDay] = useState(4)
  const [days, setDays] = useState(7)
  const [analytic, setAnalytic] = useState<any[]>([])
  const simRunningRef = useRef(false)
  const [daysResults, setDaysResults] = useState<Array<{ day: number; total: number; counts: number[] }>>([])
  const [maxSimDays, setMaxSimDays] = useState(0) // 0 = run until stopped
  const [msBetweenDays, setMsBetweenDays] = useState(10)

  useEffect(() => {
    fetch('/src/eventsData.json').then(r => r.json()).then((data: EventDef[]) => setEvents(data)).catch(()=>{})
  }, [])

  function addRow() {
    setEvents(e => [...e, { Name: 'NewEvent', Chance: 0.1 }])
  }
  function removeRow(i: number) {
    setEvents(e => e.filter((_, idx) => idx !== i))
  }
  function moveUp(i: number) {
    if (i <= 0) return
    setEvents(e => { const a = [...e]; const tmp = a[i-1]; a[i-1]=a[i]; a[i]=tmp; return a })
  }
  function moveDown(i: number) {
    setEvents(e => { const a = [...e]; if (i>=a.length-1) return a; const tmp = a[i+1]; a[i+1]=a[i]; a[i]=tmp; return a })
  }

  function runAnalytic() {
    const buckets = ceilBuckets(events)
    const base = baseProbsFromBuckets(buckets)
    const stat = stationaryNoRepeat(base)
    const meanDelay = (eventMin + eventMax) / 2
    const windowSeconds = Math.floor(24 * 60 * 60 / restartsPerDay)
    const eventsPerWindow = windowSeconds / meanDelay
    const eventsPerDay = eventsPerWindow * restartsPerDay
    const rows = events.map((ev, i) => ({
      Event: ev.Name,
      Bucket: buckets[i],
      Prob: +(stat[i].toFixed(6)),
      PerWindow: +((eventsPerWindow * stat[i]).toFixed(3)),
      PerDay: +((eventsPerDay * stat[i]).toFixed(3))
    }))
    setAnalytic(rows)
  }

  function buildExpanded(buckets: number[]) {
    const expanded: number[] = []
    for (let i = 0; i < buckets.length; i++) {
      const repeats = Math.max(0, buckets[i])
      for (let r = 0; r < repeats; r++) expanded.push(i)
    }
    if (expanded.length === 0) {
      // fallback to uniform indices
      for (let i = 0; i < buckets.length; i++) expanded.push(i)
    }
    return expanded
  }

  function pickEventIndex(expanded: number[], lastIdx: number | null) {
    if (expanded.length === 0) return 0
    // redraw if equal to last to prevent immediate repeat
    for (let attempt = 0; attempt < 200; attempt++) {
      const r = Math.floor(Math.random() * expanded.length)
      const idx = expanded[r]
      if (lastIdx === null || idx !== lastIdx) return idx
    }
    // give up and return whatever
    return expanded[Math.floor(Math.random() * expanded.length)]
  }

  function simulateOneDay(dayIndex: number) {
    const buckets = ceilBuckets(events)
    const expanded = buildExpanded(buckets)
    const counts = new Array(events.length).fill(0)
    const windowSeconds = Math.floor(24 * 60 * 60 / restartsPerDay)
    const meanDelay = (eventMin + eventMax) / 2
    // simulate each restart window separately
    let lastIdx: number | null = null
    for (let r = 0; r < restartsPerDay; r++) {
      const winStart = r * windowSeconds
      const winEnd = winStart + windowSeconds
      let t = winStart
      while (true) {
        // sample a uniform delay between min and max
        const delay = eventMin + Math.random() * (eventMax - eventMin)
        t += delay
        if (t > winEnd) break
        const idx = pickEventIndex(expanded, lastIdx)
        counts[idx]++
        lastIdx = idx
      }
    }
    const total = counts.reduce((s, v) => s + v, 0)
    return { day: dayIndex, total, counts }
  }

  function startSimulation() {
    if (simRunningRef.current) return
    simRunningRef.current = true
    let day = daysResults.length + 1
    function step() {
      if (!simRunningRef.current) return
      if (maxSimDays > 0 && day > maxSimDays) { simRunningRef.current = false; return }
      // run one day simulation
      const res = simulateOneDay(day)
      setDaysResults(prev => [...prev, res])
      day++
      // schedule next day
      setTimeout(() => {
        // allow React to update UI between iterations
        if (simRunningRef.current) step()
      }, Math.max(0, msBetweenDays))
    }
    step()
  }

  function stopSimulation() {
    simRunningRef.current = false
  }

  function resetSimulation() {
    // stop and clear results
    simRunningRef.current = false
    setDaysResults([])
  }

  const runningAverage = daysResults.length === 0 ? 0 : (daysResults.reduce((s, r) => s + r.total, 0) / daysResults.length)

  return (
    <div>
      <div style={{display:'flex', gap:20}}>
        <div style={{flex:1}}>
          <h3>Events</h3>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr>
                <th style={{textAlign:'left'}}>Name</th>
                <th style={{textAlign:'right'}}>Chance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev, i) => (
                <tr key={i}>
                  <td><input value={ev.Name} onChange={e=> setEvents(s=> { const a=[...s]; a[i]={...a[i], Name: e.target.value}; return a })} /></td>
                  <td><input type="number" step="0.01" value={ev.Chance} onChange={e=> setEvents(s=> { const a=[...s]; a[i]={...a[i], Chance: parseFloat(e.target.value||'0')}; return a })} style={{width:100}} /></td>
                  <td style={{whiteSpace:'nowrap'}}>
                    <button onClick={()=>moveUp(i)}>↑</button>
                    <button onClick={()=>moveDown(i)}>↓</button>
                    <button onClick={()=>removeRow(i)}>✖</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={addRow}>Add event</button>
        </div>
        <div style={{width:260}}>
          <h3>Settings</h3>
          <label>EventMin (s)<br/><input type="number" value={eventMin} onChange={e=>setEventMin(parseInt(e.target.value||'0'))} /></label><br/>
          <label>EventMax (s)<br/><input type="number" value={eventMax} onChange={e=>setEventMax(parseInt(e.target.value||'0'))} /></label><br/>
          <label>Restarts/day<br/><input type="number" value={restartsPerDay} onChange={e=>setRestartsPerDay(parseInt(e.target.value||'0'))} /></label><br/>
          <label>Days<br/><input type="number" value={days} onChange={e=>setDays(parseInt(e.target.value||'0'))} /></label><br/>
            <button onClick={runAnalytic}>Run analytic (no-repeat)</button>
            <hr />
            <h4>Monte-Carlo Simulation</h4>
            <label>Max days (0 = until stopped)<br/><input type="number" value={maxSimDays} onChange={e=>setMaxSimDays(parseInt(e.target.value||'0'))} /></label><br/>
            <label>ms between days<br/><input type="number" value={msBetweenDays} onChange={e=>setMsBetweenDays(parseInt(e.target.value||'0'))} /></label><br/>
            <button onClick={startSimulation}>Start</button>
            <button onClick={stopSimulation} style={{marginLeft:8}}>Stop</button>
            <button onClick={resetSimulation} style={{marginLeft:8}}>Reset</button>
        </div>
      </div>

      <h3>Analytic (stationary, no immediate repeat)</h3>
      <table style={{width:'100%',borderCollapse:'collapse'}}>
        <thead>
          <tr>
            <th style={{textAlign:'left',borderBottom:'1px solid #ccc'}}>Event</th>
            <th style={{textAlign:'right',borderBottom:'1px solid #ccc'}}>Bucket</th>
            <th style={{textAlign:'right',borderBottom:'1px solid #ccc'}}>Prob</th>
            <th style={{textAlign:'right',borderBottom:'1px solid #ccc'}}>PerWindow</th>
            <th style={{textAlign:'right',borderBottom:'1px solid #ccc'}}>PerDay</th>
          </tr>
        </thead>
        <tbody>
          {analytic.map(r=> (
            <tr key={r.Event}>
              <td>{r.Event}</td>
              <td style={{textAlign:'right'}}>{r.Bucket}</td>
              <td style={{textAlign:'right'}}>{r.Prob}</td>
              <td style={{textAlign:'right'}}>{r.PerWindow}</td>
              <td style={{textAlign:'right'}}>{r.PerDay}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Monte-Carlo Results</h3>
      <div style={{marginBottom:8}}>
        <div>Running average total per day: <strong>{runningAverage.toFixed(3)}</strong> (based on {daysResults.length} days)</div>
        <div style={{marginTop:6}}>Per-event running averages (per day):
          {events.map((ev, i) => (
            <span key={i} style={{marginLeft:10}}>{ev.Name}: <strong>{(daysResults.length === 0 ? 0 : (daysResults.reduce((s, r) => s + (r.counts[i]||0), 0) / daysResults.length)).toFixed(3)}</strong></span>
          ))}
        </div>
      </div>

      <table style={{width:'100%',borderCollapse:'collapse',marginTop:8}}>
        <thead>
          <tr>
            <th style={{textAlign:'left',borderBottom:'1px solid #ccc'}}>Day</th>
            <th style={{textAlign:'right',borderBottom:'1px solid #ccc'}}>Events</th>
            {events.map((ev, i) => (
              <th key={i} style={{textAlign:'right',borderBottom:'1px solid #ccc'}}>{ev.Name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {daysResults.map(r => (
            <tr key={r.day}>
              <td>{r.day}</td>
              <td style={{textAlign:'right'}}>{r.total}</td>
              {events.map((_, i) => (
                <td key={i} style={{textAlign:'right'}}>{r.counts[i] ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
