# Simulation configuration
# Accept days and restartsPerDay as runtime parameters so the script can be run without editing.
param(
    [Parameter(Position=0, HelpMessage = 'Number of simulated days')]
    [int]$days = 7,

    [Parameter(Position=1, HelpMessage = 'Restart windows per day')]
    [int]$restartsPerDay = 4
    ,
    [Parameter(Position=3, HelpMessage = 'When true use DayZ/Enfusion-style expanded-list selection (freq*100). When false use summed-weight selection.')]
    [object]$useDayZSelection = $true
    ,
    [Parameter(Position=2, HelpMessage = 'Optional CSV output path (per-day breakdown). If not rooted, treated relative to the script folder)')]
    [string]$csvPath = ''
    ,
    [Parameter(Position=5, HelpMessage = 'When set print analytic expectations only (fast)')]
    [switch]$analyticOnly = $false
)

# Basic validation
if ($days -lt 1) {
    Write-Error "Invalid value for days: $days. Must be >= 1."
    exit 2
}
if ($restartsPerDay -lt 1) {
    Write-Error "Invalid value for restartsPerDay: $restartsPerDay. Must be >= 1."
    exit 2
}

# Normalize $useDayZSelection to boolean (allow strings like 'true'/'false' or 1/0)
try {
    if ($useDayZSelection -is [string]) {
        $useDayZSelection = [System.Convert]::ToBoolean($useDayZSelection)
    } elseif ($useDayZSelection -is [int]) {
        $useDayZSelection = [bool]$useDayZSelection
    } else {
        $useDayZSelection = [bool]$useDayZSelection
    }
} catch {
    Write-Error "Invalid value for useDayZSelection: $useDayZSelection. Use true/false."
    exit 2
}

# Time window per restart (seconds)
# Compute window seconds from restartsPerDay so the effective simulated day is 24 hours.
# windowSeconds = (24 hours in seconds) / restartsPerDay
$windowSeconds = [math]::Floor((24 * 60 * 60) / $restartsPerDay)

# Event timing bounds (seconds)
$eventMin = 1800 # 20 minutes
$eventMax = 2100 # 30 minutes

# Output CSV removed; this run will only print stats

# Load events from external JSON file so the script doesn't need editing to change events
$eventsFile = Join-Path -Path (Split-Path -Path $MyInvocation.MyCommand.Path -Parent) -ChildPath 'events.json'
if (-Not (Test-Path $eventsFile)) {
    Write-Error "Events file not found: $eventsFile`nCreate an events.json in the script folder with an array of { Name, Chance } objects."
    exit 2
}

try {
    $eventsJson = Get-Content -Path $eventsFile -Raw | ConvertFrom-Json
} catch {
    Write-Error "Failed to read or parse events file: $eventsFile - $($_.Exception.Message)"
    exit 3
}

# Support two possible JSON formats:
# 1) An array of event objects: [ { Name, Chance }, ... ]
# 2) An object with metadata and an Events array: { EventMin: <sec>, EventMax: <sec>, Events: [ { Name, Chance }, ... ] }
if ($eventsJson -is [System.Array]) {
    $events = $eventsJson
} elseif ($null -ne $eventsJson.Events) {
    $events = $eventsJson.Events
    # override event timing if provided in the JSON (values are seconds)
    if ($null -ne $eventsJson.EventMin) { $eventMin = [int]$eventsJson.EventMin }
    if ($null -ne $eventsJson.EventMax) { $eventMax = [int]$eventsJson.EventMax }
} else {
    # Single event object (not likely) - wrap in array if it looks like an event
    if ($null -ne $eventsJson.Name -and $null -ne $eventsJson.Chance) {
        $events = @($eventsJson)
    } else {
        Write-Error "Unsupported events.json structure. Expected array or object with 'Events' array."
        exit 3
    }
}

# Ensure events is an array of objects with Name and Chance
if (-not $events -or $events.Count -eq 0) {
    Write-Error "No events found in $eventsFile"
    exit 4
}

# --- Analytic expectation calculation (DayZ-style bucketed selection) ---
# Uses same windowSeconds/eventMin/eventMax as the simulation so numbers match script behavior.
$meanDelay = ($eventMin + $eventMax) / 2.0
$eventsPerWindow = if ($meanDelay -gt 0) { $windowSeconds / $meanDelay } else { 0 }
$eventsPerDay = $eventsPerWindow * $restartsPerDay

# Build bucket counts (ceil(Chance * 100)) to mirror DayZ expansion
$analyticBuckets = $events | ForEach-Object {
    [PSCustomObject]@{
        Name = $_.Name
        Chance = [double]$_.Chance
        Bucket = [int][math]::Ceiling([double]$_.Chance * 100)
    }
}

# Determine base selection probabilities (from buckets; fallback to fractional Chance or uniform)
$sumBuckets = ($analyticBuckets | Measure-Object -Property Bucket -Sum).Sum
$baseProbs = @()
if ($sumBuckets -gt 0) {
    foreach ($b in $analyticBuckets) { $baseProbs += ([double]$b.Bucket / $sumBuckets) }
} else {
    $sumChance = ($analyticBuckets | Measure-Object -Property Chance -Sum).Sum
    if ($sumChance -gt 0) {
        foreach ($b in $analyticBuckets) { $baseProbs += ([double]$b.Chance / $sumChance) }
    } else {
        $n = $analyticBuckets.Count
        $unif = if ($n -gt 0) { 1.0 / $n } else { 0 }
        for ($i = 0; $i -lt $n; $i++) { $baseProbs += $unif }
    }
}

# If only one event, stationary is trivially that event
$n = $analyticBuckets.Count
if ($n -le 1) {
    $stationary = $baseProbs
} else {
    # Build transition matrix implicitly and compute stationary distribution by power iteration
    # T[j][i] = 0 if i==j else baseProbs[i] / (1 - baseProbs[j])
    $stationary = @()
    # initialize stationary with baseProbs (reasonable starting point)
    foreach ($p in $baseProbs) { $stationary += $p }

    $maxIter = 10000
    $tol = 1e-12
    for ($iter = 0; $iter -lt $maxIter; $iter++) {
        $next = New-Object 'System.Collections.Generic.List[double]'
        for ($i = 0; $i -lt $n; $i++) { $next.Add(0.0) }

        for ($j = 0; $j -lt $n; $j++) {
            $pj = $baseProbs[$j]
            $den = 1.0 - $pj
            if ($den -le 0) {
                # if baseProbs[j] == 1, all mass stays at j (degenerate); handle by leaving next unchanged
                continue
            }
            for ($i = 0; $i -lt $n; $i++) {
                if ($i -eq $j) { continue }
                $trans = $baseProbs[$i] / $den
                # next[i] += stationary[j] * trans
                $next[$i] = $next[$i] + ($stationary[$j] * $trans)
            }
        }

        # normalize next (to avoid tiny numeric drift)
        $sumNext = 0.0
        for ($i = 0; $i -lt $n; $i++) { $sumNext += $next[$i] }
        if ($sumNext -eq 0) { break }
        for ($i = 0; $i -lt $n; $i++) { $next[$i] = $next[$i] / $sumNext }

        # compute max diff
        $maxdiff = 0.0
        for ($i = 0; $i -lt $n; $i++) {
            $d = [math]::Abs($next[$i] - $stationary[$i])
            if ($d -gt $maxdiff) { $maxdiff = $d }
        }

        # update
        $stationary = @($next.ToArray())
        if ($maxdiff -lt $tol) { break }
    }
}

# Build analytic rows using stationary distribution (accounts for "no immediate repeats")
$analyticRows = @()
for ($i = 0; $i -lt $n; $i++) {
    $pStat = if ($i -lt $stationary.Count) { $stationary[$i] } else { 0 }
    $analyticRows += [PSCustomObject]@{
        Event = $analyticBuckets[$i].Name
        Bucket = $analyticBuckets[$i].Bucket
        Prob = [math]::Round($pStat, 6)
        PerWindow = [math]::Round($eventsPerWindow * $pStat, 3)
        PerDay = [math]::Round($eventsPerDay * $pStat, 3)
    }
}

# Print analytic expectations
Write-Output "Analytic expectations (DayZ-style selection, ceil(Chance*100) buckets):"
Write-Output ("WindowSeconds: {0}, MeanDelay: {1}, Events/Window: {2}, Events/Day: {3}" -f $windowSeconds, $meanDelay, [math]::Round($eventsPerWindow,3), [math]::Round($eventsPerDay,3))
$analyticRows | Sort-Object Event | Format-Table @{Label='Event';Expression={$_.Event}}, @{Label='Bucket';Expression={$_.Bucket}}, @{Label='Prob';Expression={$_.Prob}}, @{Label='PerWindow';Expression={$_.PerWindow}}, @{Label='PerDay';Expression={$_.PerDay}} -AutoSize

if ($analyticOnly) {
    exit 0
}

# --- end analytic block ---

# Stats trackers
$eventCounts = @{}
$eventCountsPerDay = @{}
foreach ($evt in $events) {
    $eventCounts[$evt.Name] = 0
    $eventCountsPerDay[$evt.Name] = @()
}

# Collect per-day records for CSV export (Day, Event, Count)
$dailyRecords = @()

# Track last event to avoid immediate repeats (matches DayZ behavior)
$lastEventName = $null

function Get-RandomEventName($events, [bool]$useDayZ = $true) {
    if (-not $events -or $events.Count -eq 0) { return $null }

    if ($useDayZ) {
        # DayZ-like selection: expand each event into the list freq*100 times
        # then pick a random element from the expanded list.
        $possible = New-Object System.Collections.ArrayList
        foreach ($e in $events) {
        $repeat = [math]::Ceiling($e.Chance * 100)
            for ($i = 0; $i -lt $repeat; $i++) { [void]$possible.Add($e.Name) }
        }

        if ($possible.Count -eq 0) { return $events[0].Name }
        return $possible[(Get-Random -Minimum 0 -Maximum $possible.Count)]
    } else {
        # Summed-weight accumulator selection (preserves fractional weights)
        $total = ($events | Measure-Object -Property Chance -Sum).Sum
        if ($total -le 0) { return $events[0].Name }
        $r = Get-Random -Minimum 0 -Maximum $total
        $acc = 0
        foreach ($e in $events) {
            $acc += $e.Chance
            if ($r -lt $acc) { return $e.Name }
        }
        return $events[-1].Name
    }
}

for ($day = 1; $day -le $days; $day++) {
    # initialize per-day counters
    $dailyCounts = @{}
    foreach ($evt in $events) { $dailyCounts[$evt.Name] = 0 }

    for ($restart = 1; $restart -le $restartsPerDay; $restart++) {
        $currentTime = 0
        while ($currentTime -lt $windowSeconds) {
            $eventDelay = Get-Random -Minimum $eventMin -Maximum ($eventMax + 1)
            $currentTime += $eventDelay
            if ($currentTime -lt $windowSeconds) {
                # pick an event and ensure it's not the same as the last one
                $eventName = Get-RandomEventName $events $useDayZSelection
                if ($eventName -ne $null -and $events.Count -gt 1) {
                    # re-draw if same as previous selection
                    $tries = 0
                    while ($eventName -eq $lastEventName -and $tries -lt 100) {
                        $eventName = Get-RandomEventName $events $useDayZSelection
                        $tries++
                    }
                }
                if ($eventName -ne $null) {
                    $eventCounts[$eventName]++
                    $dailyCounts[$eventName]++
                    $lastEventName = $eventName
                }
            }
        }
    }

    # record daily counts for statistics
    foreach ($evt in $events) {
        $eventCountsPerDay[$evt.Name] += $dailyCounts[$evt.Name]
    }

    # append per-day records (ignore restarts because dailyCounts aggregates across restarts)
    foreach ($evt in $events) {
        $dailyRecords += [PSCustomObject]@{
            Day = $day
            Event = $evt.Name
            Count = $dailyCounts[$evt.Name]
        }
    }
}

# Display simple stats per 24-hour period and per-restart-window
Write-Output "Simulation complete."
Write-Output ""
Write-Output "Event stats per 24-hour period (and per restart window):"

$results = @()
foreach ($eventType in $eventCounts.Keys | Sort-Object) {
    $dailyList = $eventCountsPerDay[$eventType]
    if (-not $dailyList -or $dailyList.Count -eq 0) {
        $average = 0; $min = 0; $max = 0
    } else {
        $average = [math]::Round(($dailyList | Measure-Object -Average).Average, 2)
        $min = ($dailyList | Measure-Object -Minimum).Minimum
        $max = ($dailyList | Measure-Object -Maximum).Maximum
    }

    # Average per restart window (day average divided by number of restarts per day)
    $avgPerWindow = if ($restartsPerDay -gt 0) { [math]::Round($average / $restartsPerDay, 2) } else { 0 }

    $results += [PSCustomObject]@{
        Event = $eventType
        AvgPerDay = $average
        AvgPerWindow = $avgPerWindow
        MinPerDay = $min
        MaxPerDay = $max
    }
}

# Print a readable table to console
$results | Sort-Object Event | Format-Table @{Label='Event';Expression={$_.Event}}, @{Label='Avg/Day';Expression={$_.AvgPerDay}}, @{Label='Avg/Window';Expression={$_.AvgPerWindow}}, @{Label='Min/Day';Expression={$_.MinPerDay}}, @{Label='Max/Day';Expression={$_.MaxPerDay}} -AutoSize

# If csvPath provided, export a wide per-day CSV (columns: Day, <EventNames...>)
if ($csvPath -ne '') {
    # If not rooted, treat path relative to script folder
    if (-not [System.IO.Path]::IsPathRooted($csvPath)) {
        $csvPath = Join-Path -Path (Split-Path -Path $MyInvocation.MyCommand.Path -Parent) -ChildPath $csvPath
    }
    try {
        $wideRecords = @()
        for ($i = 0; $i -lt $days; $i++) {
            $row = @{ Day = ($i + 1) }
            foreach ($evt in $events) {
                $counts = $eventCountsPerDay[$evt.Name]
                $countForDay = if ($counts -and $counts.Count -gt $i) { $counts[$i] } else { 0 }
                $row[$evt.Name] = $countForDay
            }
            $wideRecords += New-Object PSObject -Property $row
        }

        # Preserve column order: Day then event names in the same order as in events.json
        $properties = @('Day') + ($events | ForEach-Object { $_.Name })
        $wideRecords | Select-Object $properties | Export-Csv -Path $csvPath -NoTypeInformation -Force
        Write-Output "CSV written to $csvPath"
    } catch {
        Write-Error "Failed to write CSV: $($_.Exception.Message)"
        exit 5
    }
}
