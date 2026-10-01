/**
 * SaveIQ – AI Savings Goal Tracker
 * Backend Logic, Database Manager, AI Integration & Automated Triggers
 * 
 * Environment: Google Apps Script (V8 Engine)
 * Database: Google Sheets (Sheet: "Goals")
 * AI Engine: Groq Cloud API (Model: llama-3.3-70b-versatile)
 * Notifications: GmailApp
 */

// ==========================================
// CONFIGURATION & CONSTANTS
// ==========================================
const CONFIG = {
  SHEET_NAME: "Goals",
  GROQ_API_URL: "https://api.groq.com/openai/v1/chat/completions",
  GROQ_MODEL: "llama-3.3-70b-versatile",
  // Groq API Key: Read from Script Properties first; fallback to empty for user configuration
  DEFAULT_GROQ_API_KEY: "",
  HEADERS: [
    "ID",
    "Goal Name",
    "Target Amount",
    "Saved Amount",
    "Deadline",
    "Purpose",
    "Created At",
    "Email",
    "Alert Sent"
  ],
  ALERT_THRESHOLD_DAYS: 7 // Trigger alerts when deadline is within 7 days
};

/**
 * Retrieves the Groq API key from Script Properties or default constant.
 * To set key in GAS: Project Settings -> Script Properties -> Add "GROQ_API_KEY"
 * @return {string}
 */
function getGroqApiKey() {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty("GROQ_API_KEY");
  return key || CONFIG.DEFAULT_GROQ_API_KEY;
}

/**
 * Allows setting the Groq API key programmatically from the settings UI.
 * @param {string} apiKey
 * @return {object}
 */
function setGroqApiKey(apiKey) {
  if (!apiKey || apiKey.trim() === "") {
    return { success: false, message: "API key cannot be empty." };
  }
  PropertiesService.getScriptProperties().setProperty("GROQ_API_KEY", apiKey.trim());
  return { success: true, message: "Groq API Key saved successfully in Script Properties." };
}

// ==========================================
// WEB APP ROUTING (GET / POST)
// ==========================================

/**
 * Serves the SaveIQ Web Application UI.
 * @param {object} e HTTP Event object
 * @return {HtmlOutput}
 */
function doGet(e) {
  // If API action is requested via GET query parameter
  if (e && e.parameter && e.parameter.action) {
    return handleApiRequest(e.parameter.action, e.parameter);
  }

  // Ensure sheet and headers are initialized
  initializeDatabase();

  const template = HtmlService.createTemplateFromFile("Index");
  return template.evaluate()
    .setTitle("SaveIQ – AI Savings Goal Tracker")
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Handles POST requests for webhook or external API integration.
 * @param {object} e HTTP Event object
 * @return {TextOutput} JSON response
 */
function doPost(e) {
  try {
    const postData = JSON.parse(e.postData.contents);
    const action = postData.action;
    const payload = postData.payload || {};

    let result;
    switch (action) {
      case "getGoals":
        result = getAllGoals();
        break;
      case "getStats":
        result = getDashboardStats();
        break;
      case "addGoal":
        result = addGoal(payload);
        break;
      case "updateSavings":
        result = updateSavings(payload.id, payload.amount);
        break;
      case "deleteGoal":
        result = deleteGoal(payload.id);
        break;
      case "getAIInsights":
        result = getAIInsights(payload.id);
        break;
      case "runAudit":
        result = dailyAuditTrigger();
        break;
      default:
        result = { success: false, message: "Unknown action: " + action };
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Helper to include partial HTML files (e.g. CSS, JS) in templates.
 * @param {string} filename
 * @return {string}
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Handles simple GET API requests for headless integrations.
 */
function handleApiRequest(action, params) {
  let data;
  switch (action) {
    case "getGoals":
      data = getAllGoals();
      break;
    case "getStats":
      data = getDashboardStats();
      break;
    default:
      data = { error: "Invalid action" };
  }
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==========================================
// DATABASE & SPREADSHEET MANAGER
// ==========================================

/**
 * Retrieves or creates the active Goals sheet.
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheet() {
  let ss;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (err) {
    ss = null;
  }

  // Fallback: check if spreadsheet ID is stored in Script Properties
  if (!ss) {
    const sheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
    if (sheetId) {
      ss = SpreadsheetApp.openById(sheetId);
    } else {
      // Create a brand new spreadsheet and store its ID
      ss = SpreadsheetApp.create("SaveIQ – AI Savings Goal Tracker Database");
      PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", ss.getId());
    }
  }

  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    // Remove default Sheet1 if newly created
    const defaultSheet = ss.getSheetByName("Sheet1");
    if (defaultSheet && ss.getSheets().length > 1) {
      ss.deleteSheet(defaultSheet);
    }
  }
  return sheet;
}

/**
 * Initializes the database sheet with headers and formatting.
 * @return {boolean}
 */
function initializeDatabase() {
  const sheet = getSheet();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(CONFIG.HEADERS);
    // Format Header Row
    const headerRange = sheet.getRange(1, 1, 1, CONFIG.HEADERS.length);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#0F172A");
    headerRange.setFontColor("#38BDF8");
    sheet.setFrozenRows(1);
  }
  return true;
}

// ==========================================
// CORE GOAL MANAGEMENT (CRUD)
// ==========================================

/**
 * Creates a new savings goal in Google Sheets.
 * @param {object} goalData { goalName, targetAmount, initialSavings, deadline, email, purpose }
 * @return {object} Result object with created goal or error
 */
function addGoal(goalData) {
  try {
    initializeDatabase();
    const sheet = getSheet();

    // Validation
    if (!goalData.goalName || !goalData.targetAmount || !goalData.deadline) {
      return { success: false, message: "Missing required fields: Goal Name, Target Amount, and Deadline are mandatory." };
    }

    const id = "GID-" + Utilities.getUuid().slice(0, 8).toUpperCase();
    const goalName = String(goalData.goalName).trim();
    const targetAmount = parseFloat(goalData.targetAmount) || 0;
    const initialSavings = parseFloat(goalData.initialSavings) || 0;
    const deadline = String(goalData.deadline); // Format: YYYY-MM-DD
    const purpose = String(goalData.purpose || "General Savings").trim();
    const createdAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT", "yyyy-MM-dd HH:mm:ss");
    const email = String(goalData.email || Session.getActiveUser().getEmail() || "").trim();
    const alertSent = "No";

    sheet.appendRow([
      id,
      goalName,
      targetAmount,
      initialSavings,
      deadline,
      purpose,
      createdAt,
      email,
      alertSent
    ]);

    const createdGoal = calculateGoalMetrics({
      id: id,
      goalName: goalName,
      targetAmount: targetAmount,
      savedAmount: initialSavings,
      deadline: deadline,
      purpose: purpose,
      createdAt: createdAt,
      email: email,
      alertSent: alertSent
    });

    return {
      success: true,
      message: "Savings goal created successfully!",
      goal: createdGoal
    };
  } catch (err) {
    return { success: false, message: "Failed to create goal: " + err.toString() };
  }
}

/**
 * Fetches all stored savings goals from Google Sheets.
 * Calculates financial metrics and real-time status.
 * @return {object} { success: boolean, goals: Array<object> }
 */
function getAllGoals() {
  try {
    initializeDatabase();
    const sheet = getSheet();
    const lastRow = sheet.getLastRow();

    if (lastRow <= 1) {
      return { success: true, goals: [] };
    }

    const data = sheet.getRange(2, 1, lastRow - 1, CONFIG.HEADERS.length).getValues();
    const goals = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue; // Skip empty rows

      const rawGoal = {
        id: String(row[0]),
        goalName: String(row[1]),
        targetAmount: parseFloat(row[2]) || 0,
        savedAmount: parseFloat(row[3]) || 0,
        deadline: formatDeadlineString(row[4]),
        purpose: String(row[5]),
        createdAt: String(row[6]),
        email: String(row[7]),
        alertSent: String(row[8])
      };

      goals.push(calculateGoalMetrics(rawGoal));
    }

    return { success: true, goals: goals };
  } catch (err) {
    return { success: false, message: "Failed to retrieve goals: " + err.toString(), goals: [] };
  }
}

/**
 * Updates savings by adding a contribution amount to a goal.
 * @param {string} id Goal ID
 * @param {number} contributionAmount Amount added
 * @return {object} Result object with updated goal
 */
function updateSavings(id, contributionAmount) {
  try {
    const amountToAdd = parseFloat(contributionAmount);
    if (isNaN(amountToAdd) || amountToAdd <= 0) {
      return { success: false, message: "Contribution amount must be greater than zero." };
    }

    const sheet = getSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { success: false, message: "No goals found in database." };
    }

    const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    let targetRow = -1;
    let currentSaved = 0;
    let targetAmount = 0;

    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]) === String(id)) {
        targetRow = i + 2; // Accounting for 1-based index & header row
        targetAmount = parseFloat(data[i][2]) || 0;
        currentSaved = parseFloat(data[i][3]) || 0;
        break;
      }
    }

    if (targetRow === -1) {
      return { success: false, message: "Goal with ID " + id + " not found." };
    }

    const newSaved = currentSaved + amountToAdd;
    sheet.getRange(targetRow, 4).setValue(newSaved);

    // If goal completed, update alert sent status
    if (newSaved >= targetAmount) {
      sheet.getRange(targetRow, 9).setValue("Completed");
    }

    const allGoalsRes = getAllGoals();
    const updatedGoal = allGoalsRes.goals.find(function(g) { return g.id === id; });

    return {
      success: true,
      message: "Deposited $" + amountToAdd.toFixed(2) + " successfully!",
      newSaved: newSaved,
      goal: updatedGoal
    };
  } catch (err) {
    return { success: false, message: "Failed to update savings: " + err.toString() };
  }
}

/**
 * Deletes a financial goal from Google Sheets.
 * @param {string} id Goal ID
 * @return {object}
 */
function deleteGoal(id) {
  try {
    const sheet = getSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { success: false, message: "No goals available to delete." };
    }

    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    let targetRow = -1;

    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(id)) {
        targetRow = i + 2;
        break;
      }
    }

    if (targetRow === -1) {
      return { success: false, message: "Goal not found." };
    }

    sheet.deleteRow(targetRow);
    return { success: true, message: "Goal deleted successfully." };
  } catch (err) {
    return { success: false, message: "Failed to delete goal: " + err.toString() };
  }
}

// ==========================================
// FINANCIAL ANALYSIS & METRICS LOGIC
// ==========================================

/**
 * Calculates financial intelligence metrics for a single goal:
 * Completion %, Remaining Amount, Days Left, Goal Status, Daily/Weekly Requirement
 * @param {object} goal
 * @return {object}
 */
function calculateGoalMetrics(goal) {
  const target = Math.max(goal.targetAmount, 0);
  const saved = Math.max(goal.savedAmount, 0);
  const remaining = Math.max(target - saved, 0);

  // Completion Percentage
  const progressPercent = target > 0 ? Math.min(Math.round((saved / target) * 1000) / 10, 100) : 0;

  // Deadline & Days Left Calculation
  const deadlineDate = new Date(goal.deadline);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  deadlineDate.setHours(0, 0, 0, 0);

  const diffTime = deadlineDate.getTime() - today.getTime();
  const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  // Determine Goal Status
  let status = "Active";
  if (saved >= target) {
    status = "Completed";
  } else if (daysLeft < 0) {
    status = "Overdue";
  } else {
    status = "Active";
  }

  // Feasibility & Savings Requirements
  let dailyRequired = 0;
  let weeklyRequired = 0;
  if (status === "Active" && daysLeft > 0 && remaining > 0) {
    dailyRequired = Math.round((remaining / daysLeft) * 100) / 100;
    weeklyRequired = Math.round((remaining / (daysLeft / 7)) * 100) / 100;
  }

  return {
    id: goal.id,
    goalName: goal.goalName,
    targetAmount: target,
    savedAmount: saved,
    remainingAmount: remaining,
    progressPercent: progressPercent,
    deadline: goal.deadline,
    daysLeft: daysLeft,
    status: status,
    purpose: goal.purpose,
    createdAt: goal.createdAt,
    email: goal.email,
    alertSent: goal.alertSent,
    dailyRequired: dailyRequired,
    weeklyRequired: weeklyRequired
  };
}

/**
 * Normalizes deadline strings into YYYY-MM-DD
 */
function formatDeadlineString(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone() || "GMT", "yyyy-MM-dd");
  }
  return String(val || "").slice(0, 10);
}

// ==========================================
// DASHBOARD ANALYTICS ENGINE
// ==========================================

/**
 * Calculates aggregate analytics across all goals:
 * Total Goals, Total Target, Total Saved, Overall Progress,
 * Active Goals, Completed Goals, Overdue Goals, Monthly Forecast.
 * @return {object}
 */
function getDashboardStats() {
  const result = getAllGoals();
  const goals = result.goals || [];

  let totalTarget = 0;
  let totalSaved = 0;
  let activeCount = 0;
  let completedCount = 0;
  let overdueCount = 0;

  for (let i = 0; i < goals.length; i++) {
    const g = goals[i];
    totalTarget += g.targetAmount;
    totalSaved += g.savedAmount;

    if (g.status === "Completed") {
      completedCount++;
    } else if (g.status === "Overdue") {
      overdueCount++;
    } else {
      activeCount++;
    }
  }

  const overallProgress = totalTarget > 0
    ? Math.min(Math.round((totalSaved / totalTarget) * 1000) / 10, 100)
    : 0;

  return {
    success: true,
    totalGoals: goals.length,
    totalTarget: Math.round(totalTarget * 100) / 100,
    totalSaved: Math.round(totalSaved * 100) / 100,
    totalRemaining: Math.max(Math.round((totalTarget - totalSaved) * 100) / 100, 0),
    overallProgress: overallProgress,
    activeGoals: activeCount,
    completedGoals: completedCount,
    overdueGoals: overdueCount
  };
}

// ==========================================
// GROQ AI INTEGRATION & RECOMMENDATIONS
// ==========================================

/**
 * Core AI Recommendation function.
 * Evaluates goal metrics and calls Groq Cloud (llama-3.3-70b-versatile).
 * @param {string} goalId Goal identifier
 * @return {object} AI recommendation response
 */
function getAIInsights(goalId) {
  try {
    const goalsRes = getAllGoals();
    const goal = goalsRes.goals.find(function(g) { return g.id === goalId; });

    if (!goal) {
      return { success: false, message: "Goal not found." };
    }

    const apiKey = getGroqApiKey();
    if (!apiKey) {
      // Provide a high-quality heuristic recommendation if API key is not yet configured
      return {
        success: true,
        isFallback: true,
        source: "Heuristic Financial Engine (Configure Groq API Key for Llama-3.3-70B AI)",
        recommendation: generateHeuristicRecommendation(goal)
      };
    }

    // Structured Prompt Construction
    const systemPrompt = "You are SaveIQ's Senior AI Financial Advisor and Behavioral Economist. " +
      "Analyze the user's savings goal with precision, realism, and motivational discipline. " +
      "Provide a clear, beautifully structured markdown analysis with: " +
      "1. Feasibility & Velocity Assessment (Low/Medium/High viability based on days left vs required daily rate). " +
      "2. Actionable Milestone Breakdown (Weekly & Daily milestones). " +
      "3. 3 Custom Expense-Trimming & Micro-Saving Hacks tailored specifically to their purpose (" + goal.purpose + "). " +
      "4. Behavioral Nudge & Psychological Savings Strategy (e.g. 24-hour rule, visual commitment device). " +
      "Keep the tone encouraging, crisp, professional, and practical.";

    const userPrompt = 
      "SAVINGS GOAL PROFILE:\n" +
      "- Goal Name: " + goal.goalName + "\n" +
      "- Category/Purpose: " + goal.purpose + "\n" +
      "- Target Amount: $" + goal.targetAmount.toFixed(2) + "\n" +
      "- Currently Saved: $" + goal.savedAmount.toFixed(2) + " (" + goal.progressPercent + "%)\n" +
      "- Remaining Amount: $" + goal.remainingAmount.toFixed(2) + "\n" +
      "- Deadline: " + goal.deadline + "\n" +
      "- Days Left: " + goal.daysLeft + " days\n" +
      "- Current Status: " + goal.status + "\n" +
      "- Required Daily Contribution: $" + goal.dailyRequired.toFixed(2) + "/day\n" +
      "- Required Weekly Contribution: $" + goal.weeklyRequired.toFixed(2) + "/week\n\n" +
      "Please provide tailored, tactical financial advice to ensure this goal is accomplished successfully.";

    const payload = {
      model: CONFIG.GROQ_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 1024
    };

    const options = {
      method: "post",
      contentType: "application/json",
      headers: {
        "Authorization": "Bearer " + apiKey
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(CONFIG.GROQ_API_URL, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode !== 200) {
      Logger.log("Groq API Error: " + responseBody);
      return {
        success: true,
        isFallback: true,
        source: "Heuristic Financial Engine (Groq API response " + responseCode + ")",
        recommendation: generateHeuristicRecommendation(goal)
      };
    }

    const json = JSON.parse(responseBody);
    const aiText = json.choices && json.choices[0] && json.choices[0].message
      ? json.choices[0].message.content
      : "No recommendation content returned by AI.";

    return {
      success: true,
      isFallback: false,
      source: "Groq Cloud (Llama-3.3-70B)",
      recommendation: aiText,
      goal: goal
    };

  } catch (err) {
    Logger.log("Error in getAIInsights: " + err.toString());
    return {
      success: false,
      message: "AI Insight generation encountered an error: " + err.toString()
    };
  }
}

/**
 * Intelligent algorithmic fallback when Groq API key is not configured or network fails.
 */
function generateHeuristicRecommendation(goal) {
  let feasibility = "High";
  if (goal.daysLeft <= 7 && goal.progressPercent < 50) feasibility = "Urgent Action Required";
  else if (goal.daysLeft <= 14 && goal.progressPercent < 70) feasibility = "Moderate Pace Adjustment Needed";

  let advice = "### 📊 Goal Progress Analysis: " + goal.goalName + "\n\n";
  advice += "- **Current Progress:** " + goal.progressPercent + "% ($" + goal.savedAmount.toFixed(2) + " of $" + goal.targetAmount.toFixed(2) + ")\n";
  advice += "- **Remaining Balance:** $" + goal.remainingAmount.toFixed(2) + "\n";
  advice += "- **Feasibility Status:** " + feasibility + "\n\n";

  if (goal.status === "Completed") {
    advice += "🎉 **Congratulations!** You have fully achieved this savings goal. Consider rolling any ongoing surplus into an emergency reserve or investment vehicle.\n";
    return advice;
  }

  if (goal.status === "Overdue") {
    advice += "⚠️ **Deadline Passed:** Your deadline expired " + Math.abs(goal.daysLeft) + " days ago. Don't be discouraged! Consider resetting your deadline by 30 days and committing to a small, sustainable weekly deposit of $" + (goal.remainingAmount / 4).toFixed(2) + ".\n\n";
    return advice;
  }

  advice += "### 💡 Tactical Savings Schedule\n";
  advice += "- **Daily Target:** Commit to saving **$" + goal.dailyRequired.toFixed(2) + "** each day.\n";
  advice += "- **Weekly Milestone:** Deposit **$" + goal.weeklyRequired.toFixed(2) + "** every week to stay exactly on target.\n\n";

  advice += "### ✂️ Targeted Expense-Trimming Strategies (" + goal.purpose + ")\n";
  advice += "1. **The 48-Hour Micro-Pause:** Before making any non-essential purchase over $25, wait 48 hours. If the impulse fades, immediately transfer that amount to *" + goal.goalName + "*.\n";
  advice += "2. **Subscription Audit:** Review recurring bank debits and cancel one unused streaming or app subscription ($10-$20/mo recovered).\n";
  advice += "3. **Automate on Payday:** Schedule an automatic transfer of $" + goal.weeklyRequired.toFixed(2) + " immediately when your income clears your account.\n\n";

  advice += "### 🚀 Behavioral Motivation\n";
  advice += "*\"Discipline is choosing between what you want now and what you want most.\"* Keep visual track of your progress on your SaveIQ dashboard!";

  return advice;
}

// ==========================================
// AUTOMATED MONITORING & EMAIL NOTIFICATIONS
// ==========================================

/**
 * Automated Daily Audit Trigger function.
 * Scans all goals in Google Sheets, detects approaching deadlines,
 * validates alert eligibility, and sends email reminders via GmailApp.
 * 
 * Scheduled to run daily via Time-Driven Trigger.
 * @return {object} Audit summary statistics
 */
function dailyAuditTrigger() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return { success: true, processed: 0, alertsSent: 0, message: "No goals to audit." };
  }

  const allGoalsRes = getAllGoals();
  const goals = allGoalsRes.goals || [];
  let alertsSentCount = 0;
  const auditLogs = [];

  const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT", "yyyy-MM-dd");

  for (let i = 0; i < goals.length; i++) {
    const goal = goals[i];
    const rowIndex = i + 2;

    // Condition 1: Goal must be incomplete
    if (goal.status === "Completed") continue;

    // Condition 2: Must have a valid recipient email
    if (!goal.email || goal.email.indexOf("@") === -1) continue;

    // Condition 3: Approaching deadline (within ALERT_THRESHOLD_DAYS) or Overdue
    const isApproaching = goal.daysLeft >= 0 && goal.daysLeft <= CONFIG.ALERT_THRESHOLD_DAYS;
    const isOverdue = goal.status === "Overdue";

    // Condition 4: Avoid duplicate spamming on the same calendar day
    const alreadyAlertedToday = String(goal.alertSent).indexOf(todayStr) !== -1;

    if ((isApproaching || isOverdue) && !alreadyAlertedToday) {
      try {
        sendDeadlineAlertEmail(goal);
        alertsSentCount++;

        // Update Alert Sent column with current timestamp
        sheet.getRange(rowIndex, 9).setValue("Sent on " + todayStr);
        auditLogs.push("Alert sent to " + goal.email + " for goal: " + goal.goalName);
      } catch (emailErr) {
        Logger.log("Failed to send alert for goal " + goal.id + ": " + emailErr.toString());
      }
    }
  }

  Logger.log("Daily Audit Completed. Goals scanned: " + goals.length + ", Alerts sent: " + alertsSentCount);
  return {
    success: true,
    processed: goals.length,
    alertsSent: alertsSentCount,
    logs: auditLogs
  };
}

/**
 * Constructs and delivers a rich HTML notification email via GmailApp.
 * @param {object} goal Goal object with computed metrics
 */
function sendDeadlineAlertEmail(goal) {
  const recipient = goal.email;
  const isOverdue = goal.status === "Overdue";
  const subject = isOverdue
    ? "⚠️ SaveIQ Alert: Savings Goal \"" + goal.goalName + "\" is Overdue"
    : "⏰ SaveIQ Reminder: \"" + goal.goalName + "\" Deadline Approaching (" + goal.daysLeft + " Days Left)";

  const headline = isOverdue
    ? "Your savings deadline has passed, but it's never too late to finish!"
    : "You're getting closer to your target date. Let's finish strong!";

  const dailySavingsText = goal.daysLeft > 0
    ? "$" + goal.dailyRequired.toFixed(2) + " per day"
    : "N/A (Reset deadline or make a catch-up deposit)";

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; margin: 0; padding: 24px; color: #f8fafc; }
        .card { max-width: 580px; margin: 0 auto; background: #1e293b; border-radius: 16px; border: 1px solid #334155; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
        .header { background: linear-gradient(135deg, #0284c7 0%, #6366f1 100%); padding: 32px 24px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px; }
        .header p { margin: 8px 0 0 0; color: #e0f2fe; font-size: 14px; }
        .content { padding: 28px 24px; }
        .status-badge { display: inline-block; padding: 6px 14px; border-radius: 9999px; font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 16px; ${isOverdue ? 'background: rgba(239, 68, 68, 0.2); color: #f87171;' : 'background: rgba(245, 158, 11, 0.2); color: #fbbf24;'} }
        .metric-grid { display: table; width: 100%; margin: 20px 0; border-collapse: separate; border-spacing: 10px; }
        .metric-cell { display: table-cell; width: 50%; background: #0f172a; padding: 14px; border-radius: 10px; border: 1px solid #334155; text-align: center; }
        .metric-val { font-size: 20px; font-weight: 700; color: #38bdf8; margin-top: 4px; }
        .metric-lbl { font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 600; }
        .progress-bar-bg { background: #334155; border-radius: 9999px; height: 12px; overflow: hidden; margin: 16px 0 8px 0; }
        .progress-bar-fill { height: 100%; background: linear-gradient(90deg, #38bdf8, #818cf8); width: ${goal.progressPercent}%; border-radius: 9999px; }
        .footer { background: #0f172a; padding: 20px 24px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #1e293b; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>SaveIQ Financial Intelligence</h1>
          <p>${headline}</p>
        </div>
        <div class="content">
          <div class="status-badge">${isOverdue ? '⚠️ OVERDUE DEADLINE' : '⏳ DEADLINE APPROACHING'}</div>
          <h2 style="margin: 0 0 8px 0; font-size: 20px; color: #ffffff;">Goal: ${goal.goalName}</h2>
          <p style="margin: 0; color: #94a3b8; font-size: 14px;">Category: <strong>${goal.purpose}</strong></p>

          <div class="progress-bar-bg">
            <div class="progress-bar-fill"></div>
          </div>
          <p style="text-align: right; margin: 0; font-size: 13px; font-weight: 700; color: #38bdf8;">${goal.progressPercent}% Achieved</p>

          <div class="metric-grid">
            <div class="metric-cell">
              <div class="metric-lbl">Target Amount</div>
              <div class="metric-val">$${goal.targetAmount.toFixed(2)}</div>
            </div>
            <div class="metric-cell">
              <div class="metric-lbl">Saved So Far</div>
              <div class="metric-val" style="color: #34d399;">$${goal.savedAmount.toFixed(2)}</div>
            </div>
          </div>

          <div class="metric-grid">
            <div class="metric-cell">
              <div class="metric-lbl">Remaining Balance</div>
              <div class="metric-val" style="color: #f87171;">$${goal.remainingAmount.toFixed(2)}</div>
            </div>
            <div class="metric-cell">
              <div class="metric-lbl">Days Left</div>
              <div class="metric-val" style="${isOverdue ? 'color: #ef4444;' : 'color: #fbbf24;'}">${isOverdue ? Math.abs(goal.daysLeft) + 'd Overdue' : goal.daysLeft + ' Days'}</div>
            </div>
          </div>

          <div style="background: rgba(56, 189, 248, 0.08); border-left: 4px solid #38bdf8; padding: 14px; border-radius: 8px; margin-top: 16px;">
            <p style="margin: 0; font-size: 13px; color: #cbd5e1; line-height: 1.5;">
              <strong>💡 Action Plan:</strong> To hit your deadline on <strong>${goal.deadline}</strong>, deposit <strong>${dailySavingsText}</strong> starting today.
            </p>
          </div>
        </div>
        <div class="footer">
          <p style="margin: 0;">Sent automatically by SaveIQ Automated Audit Trigger • Google Apps Script & Gmail Services</p>
        </div>
      </div>
    </body>
    </html>
  `;

  GmailApp.sendEmail(recipient, subject, "Please view this email in an HTML-compatible client.", {
    htmlBody: htmlBody,
    name: "SaveIQ Savings Tracker"
  });
}

/**
 * Programmatically sets up a daily time-driven trigger to run dailyAuditTrigger
 * between 8:00 AM and 9:00 AM.
 * @return {object}
 */
function setupDailyTrigger() {
  try {
    deleteDailyTrigger(); // Clean up existing triggers to prevent duplicates

    ScriptApp.newTrigger("dailyAuditTrigger")
      .timeBased()
      .everyDays(1)
      .atHour(8)
      .create();

    return {
      success: true,
      message: "Daily audit trigger successfully scheduled to run every morning at 8:00 AM."
    };
  } catch (err) {
    return {
      success: false,
      message: "Failed to schedule trigger: " + err.toString()
    };
  }
}

/**
 * Cleans up existing daily audit triggers.
 * @return {object}
 */
function deleteDailyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let count = 0;
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "dailyAuditTrigger") {
      ScriptApp.deleteTrigger(triggers[i]);
      count++;
    }
  }
  return { success: true, message: "Removed " + count + " existing trigger(s)." };
}

// ==========================================
// VALIDATION & INTEGRATION TEST SUITE
// ==========================================

/**
 * Comprehensive End-to-End Validation Test
 * Tests Goal Creation, Data Consistency, Calculations, Savings Update, AI Fallback, and Cleanup.
 * Run directly from the Google Apps Script IDE editor.
 * @return {object} Detailed test results
 */
function testCompleteWorkflow() {
  const results = [];
  let testGoalId = null;

  try {
    // 1. Initialize DB
    initializeDatabase();
    results.push({ test: "Initialize Database", status: "PASSED" });

    // 2. Add Test Goal
    const testGoalData = {
      goalName: "Unit Test Laptop Fund",
      targetAmount: 1200,
      initialSavings: 300,
      deadline: "2026-12-31",
      purpose: "Tech & Equipment",
      email: Session.getActiveUser().getEmail() || "test@example.com"
    };

    const addRes = addGoal(testGoalData);
    if (!addRes.success || !addRes.goal) throw new Error("addGoal failed: " + addRes.message);
    testGoalId = addRes.goal.id;
    results.push({ test: "Goal Creation", status: "PASSED", goalId: testGoalId });

    // 3. Verify Calculations
    const goal = addRes.goal;
    const expectedRemaining = 900;
    const expectedProgress = 25.0;
    if (goal.remainingAmount !== expectedRemaining || goal.progressPercent !== expectedProgress) {
      throw new Error("Calculation mismatch: expected $900 remaining and 25%, got $" + goal.remainingAmount + " and " + goal.progressPercent + "%");
    }
    results.push({ test: "Financial Calculations Accuracy", status: "PASSED" });

    // 4. Update Savings
    const updateRes = updateSavings(testGoalId, 200);
    if (!updateRes.success || updateRes.newSaved !== 500) {
      throw new Error("updateSavings failed: expected 500, got " + updateRes.newSaved);
    }
    results.push({ test: "Deposit / Savings Update", status: "PASSED" });

    // 5. Test Dashboard Stats
    const stats = getDashboardStats();
    if (stats.totalGoals < 1 || stats.totalSaved < 500) {
      throw new Error("getDashboardStats returned inconsistent data");
    }
    results.push({ test: "Dashboard Analytics Aggregation", status: "PASSED" });

    // 6. Test AI Insights (Heuristic or Groq)
    const aiRes = getAIInsights(testGoalId);
    if (!aiRes.success || !aiRes.recommendation) {
      throw new Error("AI Insights returned invalid response");
    }
    results.push({ test: "AI Insights Generation", status: "PASSED", source: aiRes.source });

    // 7. Cleanup Test Goal
    const delRes = deleteGoal(testGoalId);
    if (!delRes.success) throw new Error("deleteGoal cleanup failed");
    results.push({ test: "Goal Cleanup Deletion", status: "PASSED" });

    return {
      success: true,
      allTestsPassed: true,
      results: results
    };
  } catch (err) {
    // Attempt cleanup if goal was created
    if (testGoalId) {
      try { deleteGoal(testGoalId); } catch(e) {}
    }
    return {
      success: false,
      allTestsPassed: false,
      error: err.toString(),
      results: results
    };
  }
}
