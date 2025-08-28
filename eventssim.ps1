# Simulation configuration
# Accept days and restartsPerDay as runtime parameters so the script can be run without editing.
param(
    [Parameter(Position=0, HelpMessage = 'Number of simulated days')]
    [int]$days = 120,

    [Parameter(Position=1, HelpMessage = 'Restart windows per day')]
    [int]$restartsPerDay = 4
    ,
    [Parameter(Position=3, HelpMessage = 'When true use DayZ/Enfusion-style expanded-list selection (freq*100). When false use summed-weight selection.')]
    [object]$useDayZSelection = $true
    ,
    [Parameter(Position=2, HelpMessage = 'Optional CSV output path (per-day breakdown). If not rooted, treated relative to the script folder)')]
    [string]$csvPath = ''
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
$eventMin = 1200 # 20 minutes
$eventMax = 1800 # 30 minutes

# Output CSV removed; this run will only print stats

# Load events from external JSON file so the script doesn't need editing to change events
$eventsFile = Join-Path -Path (Split-Path -Path $MyInvocation.MyCommand.Path -Parent) -ChildPath 'events.json'
if (-Not (Test-Path $eventsFile)) {
    Write-Error "Events file not found: $eventsFile`nCreate an events.json in the script folder with an array of { Name, Chance } objects."
    exit 2
}

try {
    $events = Get-Content -Path $eventsFile -Raw | ConvertFrom-Json
} catch {
    Write-Error "Failed to read or parse events file: $eventsFile - $($_.Exception.Message)"
    exit 3
}

# Ensure events is an array of objects with Name and Chance
if (-not $events -or $events.Count -eq 0) {
    Write-Error "No events found in $eventsFile"
    exit 4
}

# Stats trackers
$eventCounts = @{}
$eventCountsPerDay = @{}
foreach ($evt in $events) {
    $eventCounts[$evt.Name] = 0
    $eventCountsPerDay[$evt.Name] = @()
}

# Collect per-day records for CSV export (Day, Event, Count)
$dailyRecords = @()

function Get-RandomEventName($events, [bool]$useDayZ = $true) {
    if (-not $events -or $events.Count -eq 0) { return $null }

    if ($useDayZ) {
        # DayZ-like selection: expand each event into the list freq*100 times
        # then pick a random element from the expanded list.
        $possible = New-Object System.Collections.ArrayList
        foreach ($e in $events) {
            $repeat = [int]($e.Chance * 100)
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
                $eventName = Get-RandomEventName $events $useDayZSelection
                $eventCounts[$eventName]++
                $dailyCounts[$eventName]++
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
