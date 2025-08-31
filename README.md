# eventssim.ps1 — compact DayZ-style event simulator

A small PowerShell tool that models event selection during server restart windows and prints per-event averages (avg/min/max) per day and per restart-window.

Idea is to be able to simulate a weather over a period of time to get an understanding of how changes impact the weather system. Whilst mathmatically simple to calculate the average, seeing an actual simulation helps understanding the min/max of events over a period of time. 

Key points (short)
- Script: `./eventssim.ps1` (run from repo root).
- Events are loaded from `events.json`


Quick examples

*Note: if pwsh command fails, use powershell instead*

```powershell
# default (simulation) - used to simulate 1 week, useful to visualise what a week of weather would look like.
pwsh -NoProfile -File .\eventssim.ps1

# analytic-only (fast) using DayZ-style buckets - used when you want to know the raw average of events per day.
pwsh -NoProfile -File .\eventssim.ps1 -analyticOnly

# use summed-weight algorithm - if you want to use the more expensive and slower calculation. In practice shouldn't change the results.
pwsh -NoProfile -File .\eventssim.ps1 -useDayZSelection $false

# run and save per-day CSV - output the daily breakdown to a csv file so you can see each indvidual day.
pwsh -NoProfile -File .\eventssim.ps1 -csvPath events_per_day.csv
```

Parameters
- `-days <int>` — number of simulated days (default 7)
- `-restartsPerDay <int>` — restart windows per day (default 4)
- `-useDayZSelection <bool>` — when true (default) use DayZ-style expanded-list selection (ceil(Chance*100)); when false use efficient summed-weight selection. 
- `-analyticOnly` — print analytic expectations (based on Ceil(Chance*100) buckets) and exit
- `-csvPath <path>` — optional CSV path to write a wide per-day breakdown

events.json formats

1) Object with timing metadata.

```json
{
	"EventMin": 1200,
	"EventMax": 1800,
	"Events": [
		{ "Name": "Aurora", "Chance": 0.85 },
		{ "Name": "Blizzard", "Chance": 0.10 }
	]
}
```

If `EventMin`/`EventMax` are present they override the script defaults (seconds between events). The script accepts either format.

How selection works (short)
- DayZ-style: each event contributes `ceil(Chance*100)` buckets to a temporary list; selection is a uniform pick from that list. This mirrors the DayZ snippet.
- Summed-weight: compute total Chance and pick by accumulated fractional weights (no quantization). This is more efficient and preserves fractional weights exactly.

When to use which (both should produce near identical results)
- Use DayZ-style (`-useDayZSelection`) when you want an implementation that behaves like the Enfusion code (including ceil quantization).
- Use summed-weight (`-useDayZSelection $false`) for faster runs or when weights require fractional precision.

Analytic expectations
- The script can print analytic expectations (events/window and events/day) with `-analyticOnly`.
- The analytic calculation uses the DayZ ceil-bucket logic to form base probabilities, but it also accounts for the rule that the same event cannot occur immediately twice: the script computes the stationary distribution of the "no self-transition" Markov chain and uses that for expected counts. This can differ from the simple bucket ratios shown elsewhere.

Notes
- Display is sorted by event name for readability; internal candidate expansion follows the order in `events.json` (unless you sort it in the file).
- The script includes a safeguard to parse boolean-like arguments and supports both JSON formats described above.
 - The simulation prevents the same event running back-to-back: when a selection equals the previous event the script re-draws to avoid immediate repeats.

License
- Use as you like. No warranty.

Web UI (React + TypeScript)

There is a minimal web UI in this repo to run analytic calculations in the browser.

Setup:

```powershell
# install deps
npm install

# dev server
npm run dev
```

Open the dev server URL printed by Vite (usually http://localhost:5173).
