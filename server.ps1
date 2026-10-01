# SaveIQ Localhost Server (PowerShell & .NET Native HttpListener)
param(
    [int]$Port = 8000,
    [string]$Root = "e:\Skill"
)

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://127.0.0.1:$Port/")

try {
    $listener.Start()
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "  SaveIQ Local Server is Running on:" -ForegroundColor Green
    Write-Host "  -> http://localhost:$Port" -ForegroundColor Yellow
    Write-Host "  -> http://127.0.0.1:$Port" -ForegroundColor Yellow
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "Serving files from: $Root" -ForegroundColor Gray
} catch {
    Write-Host "Error starting HTTP Listener: $_" -ForegroundColor Red
    exit 1
}

$dataFile = Join-Path $Root "saveiq_local_db.json"

function Get-StoredGoals {
    if (Test-Path $dataFile) {
        try {
            $content = Get-Content -Path $dataFile -Raw -Encoding UTF8
            return ($content | ConvertFrom-Json)
        } catch {
            return @()
        }
    }
    # Initial Demo Goals
    $d1 = (Get-Date).AddDays(45).ToString("yyyy-MM-dd")
    $d2 = (Get-Date).AddDays(5).ToString("yyyy-MM-dd")
    $d3 = (Get-Date).AddDays(-3).ToString("yyyy-MM-dd")
    $c1 = (Get-Date).AddDays(-20).ToString("yyyy-MM-dd HH:mm:ss")
    $c2 = (Get-Date).AddDays(-30).ToString("yyyy-MM-dd HH:mm:ss")
    $c3 = (Get-Date).AddDays(-40).ToString("yyyy-MM-dd HH:mm:ss")

    $defaultGoals = @(
        [PSCustomObject]@{
            id = "GID-DEMO01"
            goalName = "M3 MacBook Pro Setup"
            targetAmount = 2400
            savedAmount = 1800
            deadline = $d1
            purpose = "Tech & Gadgets"
            createdAt = $c1
            email = "user@saveiq.internal"
            alertSent = "No"
        },
        [PSCustomObject]@{
            id = "GID-DEMO02"
            goalName = "Emergency Reserve Fund"
            targetAmount = 5000
            savedAmount = 3250
            deadline = $d2
            purpose = "Emergency Fund"
            createdAt = $c2
            email = "user@saveiq.internal"
            alertSent = "No"
        },
        [PSCustomObject]@{
            id = "GID-DEMO03"
            goalName = "Car Maintenance & Tires"
            targetAmount = 800
            savedAmount = 450
            deadline = $d3
            purpose = "Vehicle & Transport"
            createdAt = $c3
            email = "user@saveiq.internal"
            alertSent = "No"
        }
    )
    $defaultGoals | ConvertTo-Json -Depth 5 | Set-Content -Path $dataFile -Encoding UTF8
    return $defaultGoals
}

function Save-StoredGoals($goals) {
    $goals | ConvertTo-Json -Depth 5 | Set-Content -Path $dataFile -Encoding UTF8
}

function Format-GoalMetrics($g) {
    $target = [Math]::Max([double]$g.targetAmount, 0.0)
    $saved = [Math]::Max([double]$g.savedAmount, 0.0)
    $remaining = [Math]::Max([Math]::Round($target - $saved, 2), 0.0)
    $progress = if ($target -gt 0) { [Math]::Min([Math]::Round(($saved / $target) * 100, 1), 100.0) } else { 0.0 }
    
    $daysLeft = 30
    try {
        $d = [datetime]::ParseExact($g.deadline.Substring(0, 10), "yyyy-MM-dd", $null)
        $today = (Get-Date).Date
        $daysLeft = ($d - $today).Days
    } catch {}

    $status = "Active"
    if ($saved -ge $target) { $status = "Completed" }
    elseif ($daysLeft -lt 0) { $status = "Overdue" }

    $daily = 0.0
    $weekly = 0.0
    if ($status -eq "Active" -and $daysLeft -gt 0 -and $remaining -gt 0) {
        $daily = [Math]::Round($remaining / $daysLeft, 2)
        $weekly = [Math]::Round($remaining / ($daysLeft / 7), 2)
    }

    return [PSCustomObject]@{
        id = $g.id
        goalName = $g.goalName
        targetAmount = $target
        savedAmount = $saved
        remainingAmount = $remaining
        progressPercent = $progress
        deadline = $g.deadline
        daysLeft = $daysLeft
        status = $status
        purpose = $g.purpose
        createdAt = $g.createdAt
        email = $g.email
        alertSent = $g.alertSent
        dailyRequired = $daily
        weeklyRequired = $weekly
    }
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $response.AddHeader("Access-Control-Allow-Origin", "*")
        $response.AddHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        $response.AddHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 200
            $response.Close()
            continue
        }

        $urlPath = $request.Url.AbsolutePath
        $method = $request.HttpMethod

        # API: GET Goals
        if ($urlPath -eq "/api/goals" -and $method -eq "GET") {
            $goals = @(Get-StoredGoals) | ForEach-Object { Format-GoalMetrics $_ }
            $json = [PSCustomObject]@{ success = $true; goals = $goals } | ConvertTo-Json -Depth 5
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentType = "application/json; charset=utf-8"
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.Close()
            continue
        }

        # API: Create Goal
        if ($urlPath -eq "/api/goals" -and $method -eq "POST") {
            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $body = $reader.ReadToEnd()
            $payload = $body | ConvertFrom-Json

            $newId = "GID-" + [System.Guid]::NewGuid().ToString().Substring(0, 8).ToUpper()
            $newGoal = [PSCustomObject]@{
                id = $newId
                goalName = [string]$payload.goalName
                targetAmount = [double]$payload.targetAmount
                savedAmount = [double]$payload.initialSavings
                deadline = [string]$payload.deadline
                purpose = [string]$payload.purpose
                createdAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                email = [string]$payload.email
                alertSent = "No"
            }

            $currentList = @(Get-StoredGoals)
            $currentList = @($newGoal) + $currentList
            Save-StoredGoals $currentList

            $formatted = Format-GoalMetrics $newGoal
            $json = [PSCustomObject]@{ success = $true; goal = $formatted } | ConvertTo-Json -Depth 5
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentType = "application/json; charset=utf-8"
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.Close()
            continue
        }

        # API: Update Savings
        if ($urlPath -match "^/api/goals/([^/]+)/savings$" -and $method -eq "POST") {
            $goalId = $matches[1]
            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $body = $reader.ReadToEnd()
            $payload = $body | ConvertFrom-Json
            $amount = [double]$payload.amount

            $currentList = @(Get-StoredGoals)
            $found = $null
            for ($i = 0; $i -lt $currentList.Count; $i++) {
                if ($currentList[$i].id -eq $goalId) {
                    $currentList[$i].savedAmount = [double]$currentList[$i].savedAmount + $amount
                    if ($currentList[$i].savedAmount -ge $currentList[$i].targetAmount) {
                        $currentList[$i].alertSent = "Completed"
                    }
                    $found = $currentList[$i]
                    break
                }
            }
            if ($found) {
                Save-StoredGoals $currentList
                $formatted = Format-GoalMetrics $found
                $json = [PSCustomObject]@{ success = $true; message = "Deposited successfully"; goal = $formatted } | ConvertTo-Json -Depth 5
            } else {
                $response.StatusCode = 404
                $json = [PSCustomObject]@{ success = $false; message = "Goal not found" } | ConvertTo-Json
            }
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentType = "application/json; charset=utf-8"
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.Close()
            continue
        }

        # API: Delete Goal
        if ($urlPath -match "^/api/goals/([^/]+)$" -and $method -eq "DELETE") {
            $goalId = $matches[1]
            $currentList = @(Get-StoredGoals) | Where-Object { $_.id -ne $goalId }
            Save-StoredGoals $currentList
            $json = [PSCustomObject]@{ success = $true; message = "Goal deleted" } | ConvertTo-Json
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentType = "application/json; charset=utf-8"
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.Close()
            continue
        }

        # API: Dashboard Stats
        if ($urlPath -eq "/api/dashboard/stats" -and $method -eq "GET") {
            $goals = @(Get-StoredGoals) | ForEach-Object { Format-GoalMetrics $_ }
            $totTarget = 0.0
            $totSaved = 0.0
            $active = 0
            $completed = 0
            $overdue = 0
            foreach ($g in $goals) {
                $totTarget += $g.targetAmount
                $totSaved += $g.savedAmount
                if ($g.status -eq "Completed") { $completed++ }
                elseif ($g.status -eq "Overdue") { $overdue++ }
                else { $active++ }
            }
            $prog = if ($totTarget -gt 0) { [Math]::Min([Math]::Round(($totSaved / $totTarget) * 100, 1), 100.0) } else { 0.0 }
            $rem = [Math]::Max([Math]::Round($totTarget - $totSaved, 2), 0.0)

            $json = [PSCustomObject]@{
                success = $true
                totalGoals = $goals.Count
                totalTarget = [Math]::Round($totTarget, 2)
                totalSaved = [Math]::Round($totSaved, 2)
                totalRemaining = $rem
                overallProgress = $prog
                activeGoals = $active
                completedGoals = $completed
                overdueGoals = $overdue
            } | ConvertTo-Json
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentType = "application/json; charset=utf-8"
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.Close()
            continue
        }

        # API: AI Insights
        if ($urlPath -eq "/api/ai/insights" -and $method -eq "POST") {
            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $body = $reader.ReadToEnd()
            $payload = $body | ConvertFrom-Json
            $goalId = $payload.goal_id

            $targetGoal = @(Get-StoredGoals) | Where-Object { $_.id -eq $goalId } | Select-Object -First 1
            if ($targetGoal) {
                $g = Format-GoalMetrics $targetGoal
                $advice = @"
### 📊 Financial Progress Assessment: $($g.goalName)
- **Current Completion:** $($g.progressPercent)% (`$$($g.savedAmount) of `$$($g.targetAmount))
- **Remaining Balance:** `$$($g.remainingAmount)
- **Timeline:** $($g.daysLeft) days left until $($g.deadline)

### 💡 Recommended Savings Schedule
- **Daily Target:** Commit to saving **`$$($g.dailyRequired)** each day.
- **Weekly Milestone:** Deposit **`$$($g.weeklyRequired)** every week to hit your goal on schedule.

### ✂️ High-Impact Savings Tactics ($($g.purpose))
1. **The 48-Hour Micro-Pause:** Before making any discretionary purchase over `$25, wait 48 hours. If the impulse fades, deposit it here!
2. **Subscription Audit:** Review card debits and cancel one unused streaming or app subscription (`$15/mo saved).
3. **Automate on Payday:** Schedule an automatic transfer of `$$($g.weeklyRequired) right when your income clears.

### 🚀 Behavioral Motivation
*"Discipline is choosing between what you want now and what you want most."* Keep visual track on SaveIQ!
"@
                $json = [PSCustomObject]@{
                    success = $true
                    isFallback = $false
                    source = "SaveIQ Financial Intelligence (Localhost Engine)"
                    recommendation = $advice
                    goal = $g
                } | ConvertTo-Json
            } else {
                $response.StatusCode = 404
                $json = [PSCustomObject]@{ success = $false; message = "Goal not found" } | ConvertTo-Json
            }
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentType = "application/json; charset=utf-8"
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.Close()
            continue
        }

        # API: Audit Trigger
        if ($urlPath -eq "/api/audit/trigger" -and $method -eq "POST") {
            $goals = @(Get-StoredGoals) | ForEach-Object { Format-GoalMetrics $_ }
            $alerted = @()
            foreach ($g in $goals) {
                if ($g.status -ne "Completed" -and ($g.daysLeft -le 7 -or $g.status -eq "Overdue")) {
                    $alerted += "Alert queued for " + $g.email + " regarding '" + $g.goalName + "' (" + $g.daysLeft + "d left)"
                }
            }
            $json = [PSCustomObject]@{
                success = $true
                processed = $goals.Count
                alertsSent = $alerted.Count
                logs = $alerted
            } | ConvertTo-Json
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentType = "application/json; charset=utf-8"
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.Close()
            continue
        }

        # Static File Serving
        $localRel = if ($urlPath -eq "/" -or $urlPath -eq "") { "Index.html" } else { $urlPath.TrimStart('/') }
        $filePath = Join-Path $Root $localRel

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mime = switch ($ext) {
                ".html" { "text/html; charset=utf-8" }
                ".css"  { "text/css; charset=utf-8" }
                ".js"   { "application/javascript; charset=utf-8" }
                ".json" { "application/json; charset=utf-8" }
                ".svg"  { "image/svg+xml" }
                default { "application/octet-stream" }
            }
            $response.ContentType = $mime
            
            if ($ext -eq ".html") {
                $rawHtml = [System.IO.File]::ReadAllText($filePath, [System.Text.Encoding]::UTF8)
                $cleanHtml = $rawHtml.Replace("<?!= include('styles'); ?>", "").Replace("<?!= include('script'); ?>", "")
                $buffer = [System.Text.Encoding]::UTF8.GetBytes($cleanHtml)
            } else {
                $buffer = [System.IO.File]::ReadAllBytes($filePath)
            }

            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.Close()
        } else {
            $response.StatusCode = 404
            $errBytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
            $response.Close()
        }
    } catch {
        # Continue loop on error
    }
}
