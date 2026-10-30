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
    $now = Get-Date
    $defaultGoals = @(
        [PSCustomObject]@{
            id = "GID-DEMO01"
            goalName = "Emergency Reserve Fund (6 Months)"
            targetAmount = 12000
            savedAmount = 9600
            deadline = $now.AddDays(62).ToString("yyyy-MM-dd")
            purpose = "Emergency Fund"
            createdAt = $now.AddDays(-120).ToString("yyyy-MM-dd HH:mm:ss")
            email = "user@saveiq.internal"
            alertSent = "No"
        },
        [PSCustomObject]@{
            id = "GID-DEMO02"
            goalName = "M3 Max MacBook Pro & Studio Display"
            targetAmount = 3500
            savedAmount = 2800
            deadline = $now.AddDays(46).ToString("yyyy-MM-dd")
            purpose = "Tech & Gadgets"
            createdAt = $now.AddDays(-75).ToString("yyyy-MM-dd HH:mm:ss")
            email = "user@saveiq.internal"
            alertSent = "No"
        },
        [PSCustomObject]@{
            id = "GID-DEMO03"
            goalName = "Kyoto & Tokyo Autumn Vacation"
            targetAmount = 4200
            savedAmount = 3800
            deadline = $now.AddDays(21).ToString("yyyy-MM-dd")
            purpose = "Vacation & Travel"
            createdAt = $now.AddDays(-160).ToString("yyyy-MM-dd HH:mm:ss")
            email = "user@saveiq.internal"
            alertSent = "No"
        },
        [PSCustomObject]@{
            id = "GID-DEMO04"
            goalName = "First Home Down Payment"
            targetAmount = 45000
            savedAmount = 27500
            deadline = $now.AddDays(305).ToString("yyyy-MM-dd")
            purpose = "Home & Real Estate"
            createdAt = $now.AddDays(-280).ToString("yyyy-MM-dd HH:mm:ss")
            email = "user@saveiq.internal"
            alertSent = "No"
        },
        [PSCustomObject]@{
            id = "GID-DEMO05"
            goalName = "Index Fund & Dividend Portfolio"
            targetAmount = 8000
            savedAmount = 8000
            deadline = $now.AddDays(-15).ToString("yyyy-MM-dd")
            purpose = "Investment & Wealth"
            createdAt = $now.AddDays(-220).ToString("yyyy-MM-dd HH:mm:ss")
            email = "user@saveiq.internal"
            alertSent = "No"
        },
        [PSCustomObject]@{
            id = "GID-DEMO06"
            goalName = "Car Major Service & All-Terrain Tires"
            targetAmount = 1200
            savedAmount = 750
            deadline = $now.AddDays(9).ToString("yyyy-MM-dd")
            purpose = "Vehicle & Transport"
            createdAt = $now.AddDays(-45).ToString("yyyy-MM-dd HH:mm:ss")
            email = "user@saveiq.internal"
            alertSent = "No"
        },
        [PSCustomObject]@{
            id = "GID-DEMO07"
            goalName = "Executive AI & Cloud Architecture Masterclass"
            targetAmount = 1500
            savedAmount = 1500
            deadline = $now.AddDays(-30).ToString("yyyy-MM-dd")
            purpose = "Education & Career"
            createdAt = $now.AddDays(-110).ToString("yyyy-MM-dd HH:mm:ss")
            email = "user@saveiq.internal"
            alertSent = "No"
        },
        [PSCustomObject]@{
            id = "GID-DEMO08"
            goalName = "Home Gym & Wellness Upgrade"
            targetAmount = 2200
            savedAmount = 650
            deadline = $now.AddDays(120).ToString("yyyy-MM-dd")
            purpose = "Health & Wellness"
            createdAt = $now.AddDays(-25).ToString("yyyy-MM-dd HH:mm:ss")
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

        # Discover Groq Key from .env
        $serverGroqKey = if ($env:GROQ_API_KEY) { $env:GROQ_API_KEY } else { "" }
        if (-not $serverGroqKey -and (Test-Path (Join-Path $Root ".env"))) {
            Get-Content (Join-Path $Root ".env") | ForEach-Object {
                if ($_ -match "^\s*GROQ_API_KEY\s*=\s*(.*)$") {
                    $serverGroqKey = $matches[1].Trim()
                }
            }
        }

        # API: Config / Heartbeat
        if (($urlPath -eq "/api/config" -or $urlPath -eq "/api/health") -and ($method -eq "GET" -or $method -eq "HEAD")) {
            $masked = if ($serverGroqKey) { $serverGroqKey.Substring(0, [Math]::Min(12, $serverGroqKey.Length)) + "..." } else { "" }
            $json = [PSCustomObject]@{
                success = $true
                backend = "fastapi"
                mode = "Localhost Service (Port $Port)"
                groqApiKey = $serverGroqKey
                maskedGroqKey = $masked
                activeModel = "openai/gpt-oss-120b"
            } | ConvertTo-Json
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentType = "application/json; charset=utf-8"
            if ($method -eq "GET") {
                $response.ContentLength64 = $buffer.Length
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
            } else {
                $response.ContentLength64 = 0
            }
            $response.Close()
            continue
        }

        # API: GET/HEAD Goals
        if ($urlPath -eq "/api/goals" -and ($method -eq "GET" -or $method -eq "HEAD")) {
            $goals = @(Get-StoredGoals) | ForEach-Object { Format-GoalMetrics $_ }
            $json = [PSCustomObject]@{ success = $true; goals = $goals } | ConvertTo-Json -Depth 5
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentType = "application/json; charset=utf-8"
            if ($method -eq "GET") {
                $response.ContentLength64 = $buffer.Length
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
            } else {
                $response.ContentLength64 = 0
            }
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

        # API: Edit Goal (PUT)
        if ($urlPath -match "^/api/goals/([^/]+)$" -and $method -eq "PUT") {
            $goalId = $matches[1]
            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $body = $reader.ReadToEnd()
            $payload = $body | ConvertFrom-Json

            $currentList = @(Get-StoredGoals)
            $found = $null
            for ($i = 0; $i -lt $currentList.Count; $i++) {
                if ($currentList[$i].id -eq $goalId) {
                    if ($payload.goalName) { $currentList[$i].goalName = [string]$payload.goalName }
                    if ($payload.targetAmount) { $currentList[$i].targetAmount = [double]$payload.targetAmount }
                    if ($payload.deadline) { $currentList[$i].deadline = [string]$payload.deadline }
                    if ($payload.purpose) { $currentList[$i].purpose = [string]$payload.purpose }
                    if ($payload.email) { $currentList[$i].email = [string]$payload.email }
                    $found = $currentList[$i]
                    break
                }
            }
            if ($found) {
                Save-StoredGoals $currentList
                $formatted = Format-GoalMetrics $found
                $json = [PSCustomObject]@{ success = $true; message = "Goal updated"; goal = $formatted } | ConvertTo-Json -Depth 5
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
        if (($urlPath -eq "/api/ai/insights" -or $urlPath -eq "/api/ai/advisor") -and $method -eq "POST") {
            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $body = $reader.ReadToEnd()
            $payload = $body | ConvertFrom-Json
            $goalId = $payload.goal_id

            $targetGoal = @(Get-StoredGoals) | Where-Object { $_.id -eq $goalId } | Select-Object -First 1
            if ($targetGoal) {
                $g = Format-GoalMetrics $targetGoal

                # Discover Groq API Key from payload, env or .env file
                $activeGroqKey = if ($payload.api_key) { $payload.api_key } else { $env:GROQ_API_KEY }
                if (-not $activeGroqKey -and (Test-Path (Join-Path $Root ".env"))) {
                    Get-Content (Join-Path $Root ".env") | ForEach-Object {
                        if ($_ -match "^\s*GROQ_API_KEY\s*=\s*(.*)$") {
                            $activeGroqKey = $matches[1].Trim()
                        }
                    }
                }

                $groqSuccess = $false
                $aiRecommendation = $null
                $aiSource = "SaveIQ Financial Planning Engine (Localhost)"

                if ($activeGroqKey) {
                    $promptText = @"
SAVINGS TARGET PROFILE:
- Goal: $($g.goalName) ($($g.purpose))
- Target: `$$($g.targetAmount)
- Current: `$$($g.savedAmount) ($($g.progressPercent)%)
- Remaining: `$$($g.remainingAmount)
- Deadline: $($g.deadline) ($($g.daysLeft) days left)
- Velocity: `$$($g.dailyRequired)/day (`$$($g.weeklyRequired)/week)

Provide an executive personal finance strategic plan in clean markdown:
### 1. Velocity & Pacing Assessment
### 2. Structured Contribution Milestones
### 3. High-Impact Expense Levers ($($g.purpose))
### 4. Behavioral Discipline Protocol
"@
                    foreach ($m in @("openai/gpt-oss-120b", "llama-3.3-70b-versatile", "qwen/qwen3.8-27b")) {
                        try {
                            $headers = @{
                                "Authorization" = "Bearer $activeGroqKey"
                                "Content-Type" = "application/json"
                            }
                            $reqObj = @{
                                model = $m
                                messages = @(
                                    @{ role = "system"; content = "You are an executive personal finance advisor. Deliver concise, high-value, practical financial recommendations without conversational filler." },
                                    @{ role = "user"; content = $promptText }
                                )
                                temperature = 0.6
                                max_tokens = 900
                            }
                            $reqJson = $reqObj | ConvertTo-Json -Depth 5
                            $res = Invoke-RestMethod -Uri "https://api.groq.com/openai/v1/chat/completions" -Method POST -Headers $headers -Body $reqJson -TimeoutSec 15
                            if ($res.choices -and $res.choices[0].message.content) {
                                $aiRecommendation = $res.choices[0].message.content
                                $aiSource = "Groq Cloud ($m)"
                                $groqSuccess = $true
                                break
                            }
                        } catch {
                            # Fall to next candidate model
                        }
                    }
                }

                if (-not $groqSuccess) {
                    $aiRecommendation = @"
### Velocity & Pacing Assessment
- **Funded:** `$$($g.savedAmount) of `$$($g.targetAmount) ($($g.progressPercent)%)
- **Outstanding:** `$$($g.remainingAmount)
- **Horizon:** $($g.daysLeft) days left until $($g.deadline)

### Structured Contribution Milestones
- **Daily Pace:** **`$$($g.dailyRequired) / day**
- **Weekly Milestone:** **`$$($g.weeklyRequired) / week**

### High-Impact Savings Tactics ($($g.purpose))
1. **Automated Payday Sweep:** Schedule an automated transfer of `$$($g.weeklyRequired) on each payday before discretionary spending occurs.
2. **Subscription Audit:** Review card debits and cancel one unused recurring subscription (`$15/mo saved).
3. **The 48-Hour Purchase Filter:** For discretionary purchases exceeding `$50, enforce a 48-hour delay; deposit the unspent amount if the urge passes.

### Behavioral Discipline Protocol
Lock savings into a dedicated high-yield account with withdrawal friction to eliminate impulsive liquidations.
"@
                }

                $json = [PSCustomObject]@{
                    success = $true
                    isFallback = (-not $groqSuccess)
                    source = $aiSource
                    recommendation = $aiRecommendation
                    goal = $g
                } | ConvertTo-Json -Depth 5
                $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
                $response.ContentType = "application/json; charset=utf-8"
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
                $response.Close()
                continue
            } else {
                $response.StatusCode = 404
                $json = [PSCustomObject]@{ success = $false; message = "Goal not found" } | ConvertTo-Json
                $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
                $response.ContentType = "application/json; charset=utf-8"
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
                $response.Close()
                continue
            }
        }

        # API: Reports PDF / Printable Statement
        if ($urlPath -eq "/api/reports/pdf" -and $method -eq "GET") {
            $goals = @(Get-StoredGoals) | ForEach-Object { Format-GoalMetrics $_ }
            $nowStr = (Get-Date).ToString("MMMM dd, yyyy at hh:mm tt")
            $rowsHtml = ""
            foreach ($g in $goals) {
                $rowsHtml += "<tr><td>$($g.goalName)</td><td>$($g.purpose)</td><td>`$$($g.targetAmount.ToString('N2'))</td><td>`$$($g.savedAmount.ToString('N2'))</td><td>$($g.progressPercent)%</td><td>$($g.deadline)</td><td>$($g.status)</td></tr>"
            }
            $statementHtml = @"
<!DOCTYPE html>
<html>
<head>
  <meta charset='utf-8'>
  <title>SaveIQ – Financial Statement</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #0f172a; }
    h1 { margin-bottom: 4px; font-size: 20px; }
    .sub { color: #64748b; font-size: 13px; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
    th { background: #0b0d13; color: #38bdf8; padding: 10px; text-align: left; }
    td { padding: 8px 10px; border-bottom: 1px solid #cbd5e1; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body onload='window.print()'>
  <h1>SaveIQ – Financial Discipline & Goals Report</h1>
  <div class='sub'>Generated on $nowStr | Localhost Service</div>
  <table>
    <thead>
      <tr><th>Goal Name</th><th>Category</th><th>Target</th><th>Saved</th><th>Progress</th><th>Deadline</th><th>Status</th></tr>
    </thead>
    <tbody>
      $rowsHtml
    </tbody>
  </table>
</body>
</html>
"@
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($statementHtml)
            $response.ContentType = "text/html; charset=utf-8"
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

            $response.ContentLength64 = $buffer.Length
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
