# Simulation configuration
$days = 120
$restartsPerDay = 4

# Time window per restart (seconds)
$windowSeconds = 21600 # 6 hours

# Event timing bounds (seconds)
$eventMin = 1200 # 20 minutes
$eventMax = 1800 # 30 minutes

# Output CSV removed; this run will only print stats

# Standard events and their relative weights (chance)
$events = @(
    @{ Name = "Aurora";      Chance = 0.85 },
    @{ Name = "Blizzard";    Chance = 0.10 },
    @{ Name = "ExtremeCold"; Chance = 0.20 },
    @{ Name = "SnowfallE";   Chance = 0.40 },
    @{ Name = "EVRStorm";    Chance = 0.30 },
    @{ Name = "HeavyFog";    Chance = 0.10 }
)

# Stats trackers
$eventCounts = @{}
$eventCountsPerDay = @{}
foreach ($evt in $events) {
    $eventCounts[$evt.Name] = 0
    $eventCountsPerDay[$evt.Name] = @()
}

function Get-RandomEventName($events) {
    # Weighted random selection based on Chance values (safer and faster)
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
                $eventName = Get-RandomEventName $events
                $eventCounts[$eventName]++
                $dailyCounts[$eventName]++
            }
        }
    }

    # record daily counts for statistics
    foreach ($evt in $events) {
        $eventCountsPerDay[$evt.Name] += $dailyCounts[$evt.Name]
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
