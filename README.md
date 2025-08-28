# eventssim.ps1 — compact DayZ-style event simulator

A small PowerShell tool that models event selection during server restart windows and prints per-event averages (avg/min/max) per day and per restart-window.

Key points (short)
- Script: `./eventssim.ps1` (run from repo root).
- Events are loaded from `events.json` (two supported formats — see below).
- New options: `-useDayZSelection` (DayZ-style bucket expansion) and `-analyticOnly` (print analytic expectations and exit).

Quick examples
```powershell
# default (simulation)
pwsh -NoProfile -File .\eventssim.ps1

# analytic-only (fast) using DayZ-style buckets
pwsh -NoProfile -File .\eventssim.ps1 -analyticOnly

# use summed-weight algorithm
pwsh -NoProfile -File .\eventssim.ps1 -useDayZSelection $false

# run and save per-day CSV
pwsh -NoProfile -File .\eventssim.ps1 -csvPath events_per_day.csv
```

Parameters
- `-days <int>` — number of simulated days (default 120)
- `-restartsPerDay <int>` — restart windows per day (default 4)
- `-useDayZSelection <bool>` — when true (default) use DayZ-style expanded-list selection (ceil(Chance*100)); when false use efficient summed-weight selection
- `-analyticOnly` — print analytic expectations (based on Ceil(Chance*100) buckets) and exit
- `-csvPath <path>` — optional CSV path to write a wide per-day breakdown

events.json formats
1) Simple array (original):

```json
[
	{ "Name": "Aurora", "Chance": 0.85 },
	{ "Name": "Blizzard", "Chance": 0.10 }
]
```

2) Object with timing metadata (new):

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

When to use which
- Use DayZ-style (`-useDayZSelection`) when you want an implementation that behaves like the Enfusion code (including ceil quantization).
- Use summed-weight (`-useDayZSelection $false`) for faster runs or when weights require fractional precision.

Analytic expectations
- The script can print analytic expectations (events/window and events/day) using the DayZ ceil-bucket probabilities with `-analyticOnly`. This is fast and matches the simulator's bucketed probabilities.

Notes
- Display is sorted by event name for readability; internal candidate expansion follows the order in `events.json` (unless you sort it in the file).
- The script includes a safeguard to parse boolean-like arguments and supports both JSON formats described above.

License
- Use as you like. No warranty.
