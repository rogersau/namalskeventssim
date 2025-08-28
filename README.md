# eventssim.ps1 — DayZ-style event selection simulator

A compact PowerShell simulator that models weighted event selection across repeated server restart windows. It prints per-day statistics (average, min, max) for each event.

Where to find
- The script lives in the repository root as `./eventssim.ps1`. Run the command from the repo root (no absolute paths required).
- Events are now read from `events.json` in the repository root. Edit that file to change event names or Chance weights instead of editing the script.

Quick run
Open PowerShell in the repository root and run:

```powershell
pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\eventssim.ps1
```

Command-line parameters
You can provide the number of days to simulate and the restarts-per-day at runtime. Examples:

```powershell
# use positional parameters: days then restartsPerDay
pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\eventssim.ps1 120 4

# use named parameters
pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\eventssim.ps1 -days 120 -restartsPerDay 4
```

How the day is modeled
- `restartsPerDay` — number of restart windows per day (default 4)
- `windowSeconds` — seconds in one restart window is computed from `restartsPerDay` so the effective simulated day is always 24 hours (windowSeconds = floor(24*60*60 / restartsPerDay)).

Key configuration (top of `eventssim.ps1`)
- `$days` — number of simulated days (default 120)
- `$restartsPerDay` — restart windows per day (default 4)
- `$windowSeconds` — seconds per window (default 21600)
- `$eventMin` / `$eventMax` — min/max seconds between events inside a window
- `$events` — array of event entries with `Name` and `Chance` weight

Output
- The script prints a console table with Avg/Day, Avg/Window, Min/Day and Max/Day per event. 

Notes & customization
- Weighted selection uses summed weights (no quantization).

## Comparison with DayZ (Enfusion) implementation

Practical difference
- For typical weights (e.g. 0.1–1.0) the two approaches produce nearly identical behaviour: both select events roughly proportional to their configured weights. In practice you'll see very similar average counts per day.

Detailed differences
- Algorithm
	- PowerShell: sums all Chance weights, picks a random number in [0,total), then accumulates weights until the random value falls into a bucket (no quantization).
	- Enfusion (DayZ) snippet: builds a temporary array by repeating each event type `freq * 100` times and selects a random element from that array (discrete bucketing).
- Quantization
	- Enfusion's multiply-by-100 is an integer approximation that quantizes fractional weights to 1/100 increments; PowerShell preserves fractional weights exactly.
- Memory & CPU
	- The Enfusion approach allocates and fills a temporary array each call (cost proportional to sum(freq*100)). This can be heavier when called frequently or with many event types.
	- The summed-weight method is lighter (only a sum and a single pass to accumulate) and uses constant extra memory.
- Performance
	- Both are O(n) in the number of event types for the selection step, but Enfusion adds the extra inner loop to expand buckets which increases work and allocations.
- Edge cases where differences matter
	- If weights include very small fractions (<0.01) or very large differences, the Enfusion quantization and repeated-array cost can introduce noticeable differences.
	- For small lists and typical weights the difference is negligible.

Enfusion-style example (provided):

```c
typename GetRandomEvent()
{
		if (m_PossibleEventTypes.Count() == 0) return typename;
    
		array<typename> possible_types = {};
		foreach (typename type, float freq: m_PossibleEventTypes) {
				for (int i = 0; i < freq * 100; i++) {
						possible_types.Insert(type);
				}
		}
            
		return possible_types.GetRandomElement();
}
```

License
- Use as you like. No warranty.
