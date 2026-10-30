/**
 * SaveIQ – Minimalist Financial Tracker
 * Frontend interactions, reactive analytics, financial planning & API bridges
 */

// ==========================================
// STATE MANAGEMENT & CONFIGURATION
// ==========================================
const AppState = {
  goals: [],
  filteredGoals: [],
  currentFilter: "all",
  searchQuery: "",
  sortBy: "deadline",
  stats: {
    totalGoals: 0,
    totalTarget: 0,
    totalSaved: 0,
    totalRemaining: 0,
    overallProgress: 0,
    activeGoals: 0,
    completedGoals: 0,
    overdueGoals: 0,
    disciplineScore: 100
  },
  currentGoalForDeposit: null,
  currentGoalForAI: null,
  aiProvider: localStorage.getItem("saveiq_ai_provider") || "groq",
  groqApiKey: localStorage.getItem("saveiq_groq_key") || "",
  openaiApiKey: localStorage.getItem("saveiq_openai_key") || "",
  theme: localStorage.getItem("saveiq_theme") || "light",
  backendMode: "auto"
};

// Clean category labels
const PURPOSE_LABELS = {
  "Emergency Fund": "Emergency",
  "Tech & Gadgets": "Technology",
  "Vacation & Travel": "Travel",
  "Vehicle & Transport": "Vehicle",
  "Home & Real Estate": "Housing",
  "Education & Career": "Education",
  "Investment & Wealth": "Investments",
  "Shopping & Luxury": "Lifestyle",
  "Health & Wellness": "Health",
  "General Savings": "General"
};

// ==========================================
// THEME MANAGEMENT (Light by Default)
// ==========================================
function initTheme() {
  const current = localStorage.getItem("saveiq_theme") || "light";
  AppState.theme = current;
  document.documentElement.setAttribute("data-theme", current);
  updateThemeIcon(current);
}

function toggleTheme() {
  const next = AppState.theme === "light" ? "dark" : "light";
  AppState.theme = next;
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("saveiq_theme", next);
  updateThemeIcon(next);
  showToast(`Switched to ${next} theme`, "info");
}

function updateThemeIcon(theme) {
  const sunIcon = document.getElementById("themeIconSun");
  const moonIcon = document.getElementById("themeIconMoon");
  if (sunIcon && moonIcon) {
    if (theme === "dark") {
      sunIcon.style.display = "block";
      moonIcon.style.display = "none";
    } else {
      sunIcon.style.display = "none";
      moonIcon.style.display = "block";
    }
  }
}

// ==========================================
// BACKEND BRIDGE & DATA PROVIDER
// ==========================================
const BackendBridge = {
  isGAS: function() {
    return typeof google !== "undefined" && google.script && google.script.run;
  },

  isFastAPIAvailable: false,

  detectMode: async function() {
    if (this.isGAS()) {
      AppState.backendMode = "gas";
      return "gas";
    }
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const cfg = await res.json();
        AppState.backendMode = "fastapi";
        this.isFastAPIAvailable = true;
        if (cfg.groqApiKey) {
          AppState.groqApiKey = cfg.groqApiKey;
          localStorage.setItem("saveiq_groq_key", cfg.groqApiKey);
          const groqInput = document.getElementById("groqApiKeyInput");
          if (groqInput) groqInput.value = cfg.groqApiKey;
        }
        const modeEl = document.getElementById("activeBackendModeLabel");
        if (modeEl) {
          modeEl.textContent = "CONNECTED (Local Server)";
          modeEl.style.color = "#10b981";
        }
        return "fastapi";
      }
    } catch (e) {}

    try {
      const res2 = await fetch("/api/goals");
      if (res2.ok) {
        AppState.backendMode = "fastapi";
        this.isFastAPIAvailable = true;
        const modeEl = document.getElementById("activeBackendModeLabel");
        if (modeEl) {
          modeEl.textContent = "CONNECTED (Local Server)";
          modeEl.style.color = "#10b981";
        }
        return "fastapi";
      }
    } catch (err) {}

    AppState.backendMode = "local";
    return "local";
  },

  fetchGoals: function() {
    return new Promise((resolve, reject) => {
      if (AppState.backendMode === "gas") {
        google.script.run
          .withSuccessHandler(res => resolve(res.goals || []))
          .withFailureHandler(err => reject(err))
          .getAllGoals();
      } else if (AppState.backendMode === "fastapi") {
        fetch("/api/goals")
          .then(res => res.json())
          .then(data => resolve(data.goals || []))
          .catch(err => reject(err));
      } else {
        const local = localStorage.getItem("saveiq_goals");
        let list = local ? JSON.parse(local) : getDemoGoals();
        resolve(list.map(calculateClientMetrics));
      }
    });
  },

  createGoal: function(goalData) {
    return new Promise((resolve, reject) => {
      if (AppState.backendMode === "gas") {
        google.script.run
          .withSuccessHandler(res => resolve(res))
          .withFailureHandler(err => reject(err))
          .createGoal(goalData);
      } else if (AppState.backendMode === "fastapi") {
        fetch("/api/goals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(goalData)
        })
          .then(res => res.json())
          .then(data => resolve(data))
          .catch(err => reject(err));
      } else {
        const local = localStorage.getItem("saveiq_goals");
        let list = local ? JSON.parse(local) : getDemoGoals();
        const newGoal = {
          id: "GID-" + Math.random().toString(36).substr(2, 8).toUpperCase(),
          goalName: goalData.goalName,
          targetAmount: goalData.targetAmount,
          savedAmount: goalData.initialSavings || 0,
          deadline: goalData.deadline,
          purpose: goalData.purpose,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          email: goalData.email,
          alertSent: "No"
        };
        list.unshift(newGoal);
        localStorage.setItem("saveiq_goals", JSON.stringify(list));
        resolve({ success: true, goal: calculateClientMetrics(newGoal) });
      }
    });
  },

  updateGoal: function(id, updateData) {
    return new Promise(async (resolve, reject) => {
      if (AppState.backendMode === "fastapi") {
        try {
          const res = await fetch(`/api/goals/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updateData)
          });
          const data = await res.json();
          resolve(data);
        } catch (err) {
          reject(err);
        }
      } else {
        const local = localStorage.getItem("saveiq_goals");
        let list = local ? JSON.parse(local) : getDemoGoals();
        const idx = list.findIndex(g => g.id === id);
        if (idx !== -1) {
          list[idx] = { ...list[idx], ...updateData };
          localStorage.setItem("saveiq_goals", JSON.stringify(list));
          resolve({ success: true, goal: calculateClientMetrics(list[idx]) });
        } else {
          resolve({ success: false, message: "Goal not found" });
        }
      }
    });
  },

  addDeposit: function(goalId, amount) {
    return new Promise((resolve, reject) => {
      if (AppState.backendMode === "gas") {
        google.script.run
          .withSuccessHandler(res => resolve(res))
          .withFailureHandler(err => reject(err))
          .updateSavings(goalId, amount);
      } else if (AppState.backendMode === "fastapi") {
        fetch(`/api/goals/${goalId}/savings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: amount })
        })
          .then(res => res.json())
          .then(data => resolve(data))
          .catch(err => reject(err));
      } else {
        const local = localStorage.getItem("saveiq_goals");
        let list = local ? JSON.parse(local) : getDemoGoals();
        const goal = list.find(g => g.id === goalId);
        if (goal) {
          goal.savedAmount = (parseFloat(goal.savedAmount) || 0) + parseFloat(amount);
          if (goal.savedAmount >= goal.targetAmount) {
            goal.alertSent = "Completed";
          }
          localStorage.setItem("saveiq_goals", JSON.stringify(list));
          resolve({ success: true, goal: calculateClientMetrics(goal) });
        } else {
          reject(new Error("Goal not found"));
        }
      }
    });
  },

  deleteGoal: function(goalId) {
    return new Promise((resolve, reject) => {
      if (AppState.backendMode === "gas") {
        google.script.run
          .withSuccessHandler(res => resolve(res))
          .withFailureHandler(err => reject(err))
          .deleteGoal(goalId);
      } else if (AppState.backendMode === "fastapi") {
        fetch(`/api/goals/${goalId}`, { method: "DELETE" })
          .then(res => res.json())
          .then(data => resolve(data))
          .catch(err => reject(err));
      } else {
        const local = localStorage.getItem("saveiq_goals");
        let list = local ? JSON.parse(local) : getDemoGoals();
        list = list.filter(g => g.id !== goalId);
        localStorage.setItem("saveiq_goals", JSON.stringify(list));
        resolve({ success: true });
      }
    });
  },

  requestAIInsights: async function(goal) {
    if (AppState.backendMode === "gas") {
      return new Promise((resolve, reject) => {
        google.script.run
          .withSuccessHandler(res => resolve(res))
          .withFailureHandler(err => reject(err))
          .getAIInsights(goal.id);
      });
    }

    if (AppState.backendMode === "fastapi") {
      const activeKey = AppState.aiProvider === "openai" ? AppState.openaiApiKey : AppState.groqApiKey;
      const res = await fetch("/api/ai/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal_id: goal.id,
          provider: AppState.aiProvider,
          api_key: activeKey
        })
      });
      return await res.json();
    }

    const isOAI = AppState.aiProvider === "openai";
    const apiKey = isOAI ? AppState.openaiApiKey : AppState.groqApiKey;
    if (!apiKey) {
      return {
        success: true,
        isFallback: true,
        source: "Financial Planning Engine",
        recommendation: generateClientHeuristic(goal)
      };
    }

    try {
      const prompt = `SAVINGS GOAL ANALYSIS:
- Goal: ${goal.goalName} (${goal.purpose})
- Target: $${goal.targetAmount.toFixed(2)}
- Current Balance: $${goal.savedAmount.toFixed(2)} (${goal.progressPercent}%)
- Remaining: $${goal.remainingAmount.toFixed(2)}
- Target Date: ${goal.deadline} (${goal.daysLeft} days)
- Status: ${goal.status}
- Pacing: $${goal.dailyRequired.toFixed(2)}/day ($${goal.weeklyRequired.toFixed(2)}/week)

Provide a sharp, practical financial plan in clean markdown with:
1. Trajectory & Pacing Review
2. Milestone Schedule (Weekly contributions)
3. 3 Expense-Reduction Tactics relevant to ${goal.purpose}
4. Behavioral Automation Suggestion`;

      const endpoint = isOAI 
        ? "https://api.openai.com/v1/chat/completions" 
        : "https://api.groq.com/openai/v1/chat/completions";
      const groqModels = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "qwen/qwen3.8-27b"];

      let response = null;
      let usedModel = isOAI ? "gpt-4o-mini" : groqModels[0];

      if (isOAI) {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + apiKey
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: "You are an executive personal finance advisor. Deliver concise, high-value, practical financial recommendations without conversational filler." },
              { role: "user", content: prompt }
            ],
            temperature: 0.6,
            max_tokens: 900
          })
        });
      } else {
        for (const m of groqModels) {
          try {
            const res = await fetch(endpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + apiKey
              },
              body: JSON.stringify({
                model: m,
                messages: [
                  { role: "system", content: "You are an executive personal finance advisor. Deliver concise, high-value, practical financial recommendations without conversational filler." },
                  { role: "user", content: prompt }
                ],
                temperature: 0.6,
                max_tokens: 900
              })
            });
            if (res.ok) {
              response = res;
              usedModel = m;
              break;
            }
          } catch (e) {}
        }
      }

      if (!response || !response.ok) throw new Error("AI provider error");

      const json = await response.json();
      return {
        success: true,
        isFallback: false,
        source: isOAI ? "OpenAI (GPT-4o-mini)" : `Groq Cloud (${usedModel})`,
        recommendation: json.choices[0].message.content,
        goal: goal
      };
    } catch (err) {
      return {
        success: true,
        isFallback: true,
        source: "Financial Planning Engine",
        recommendation: generateClientHeuristic(goal)
      };
    }
  },

  triggerAudit: function() {
    return new Promise((resolve, reject) => {
      if (AppState.backendMode === "gas") {
        google.script.run
          .withSuccessHandler(res => resolve(res))
          .withFailureHandler(err => reject(err))
          .runDailyAudit();
      } else if (AppState.backendMode === "fastapi") {
        fetch("/api/audit/trigger", { method: "POST" })
          .then(res => res.json())
          .then(data => resolve(data))
          .catch(err => reject(err));
      } else {
        const goals = AppState.goals;
        const alerted = goals.filter(g => g.status !== "Completed" && (g.daysLeft <= 7 || g.status === "Overdue"));
        resolve({
          success: true,
          processed: goals.length,
          alertsSent: alerted.length,
          logs: alerted.map(g => `Simulation alert for ${g.email || 'user'} regarding '${g.goalName}'`)
        });
      }
    });
  }
};

// ==========================================
// CLIENT METRICS & HELPERS
// ==========================================
function calculateClientMetrics(g) {
  const target = Math.max(parseFloat(g.targetAmount) || 0, 0);
  const saved = Math.max(parseFloat(g.savedAmount) || 0, 0);
  const remaining = Math.max(Math.round((target - saved) * 100) / 100, 0);
  const progress = target > 0 ? Math.min(Math.round((saved / target) * 1000) / 10, 100) : 0;

  let daysLeft = 30;
  try {
    const deadlineDate = new Date(g.deadline);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    deadlineDate.setHours(0, 0, 0, 0);
    daysLeft = Math.ceil((deadlineDate - today) / (1000 * 60 * 60 * 24));
  } catch (e) {}

  let status = "Active";
  if (saved >= target) status = "Completed";
  else if (daysLeft < 0) status = "Overdue";

  let daily = 0;
  let weekly = 0;
  if (status === "Active" && daysLeft > 0 && remaining > 0) {
    daily = Math.round((remaining / daysLeft) * 100) / 100;
    weekly = Math.round((remaining / (daysLeft / 7)) * 100) / 100;
  }

  return {
    ...g,
    targetAmount: target,
    savedAmount: saved,
    remainingAmount: remaining,
    progressPercent: progress,
    daysLeft: daysLeft,
    status: status,
    dailyRequired: daily,
    weeklyRequired: weekly
  };
}

function getDemoGoals() {
  const now = new Date();
  const formatOffset = (days) => {
    const d = new Date(now.getTime() + days * 86400000);
    return d.toISOString().slice(0, 10);
  };

  return [
    {
      id: "GID-DEMO01",
      goalName: "Emergency Reserve Fund (6 Months)",
      targetAmount: 12000,
      savedAmount: 9600,
      deadline: formatOffset(62),
      purpose: "Emergency Fund",
      createdAt: "2026-06-15 10:00:00",
      email: "user@saveiq.internal",
      alertSent: "No"
    },
    {
      id: "GID-DEMO02",
      goalName: "M3 Max MacBook Pro & Studio Display",
      targetAmount: 3500,
      savedAmount: 2800,
      deadline: formatOffset(46),
      purpose: "Tech & Gadgets",
      createdAt: "2026-08-01 14:20:00",
      email: "user@saveiq.internal",
      alertSent: "No"
    },
    {
      id: "GID-DEMO03",
      goalName: "Kyoto & Tokyo Autumn Vacation",
      targetAmount: 4200,
      savedAmount: 3800,
      deadline: formatOffset(21),
      purpose: "Vacation & Travel",
      createdAt: "2026-05-10 11:30:00",
      email: "user@saveiq.internal",
      alertSent: "No"
    },
    {
      id: "GID-DEMO04",
      goalName: "First Home Down Payment",
      targetAmount: 45000,
      savedAmount: 27500,
      deadline: formatOffset(305),
      purpose: "Home & Real Estate",
      createdAt: "2026-01-10 09:00:00",
      email: "user@saveiq.internal",
      alertSent: "No"
    },
    {
      id: "GID-DEMO05",
      goalName: "Index Fund & Dividend Portfolio",
      targetAmount: 8000,
      savedAmount: 8000,
      deadline: formatOffset(-15),
      purpose: "Investment & Wealth",
      createdAt: "2026-03-01 08:00:00",
      email: "user@saveiq.internal",
      alertSent: "No"
    },
    {
      id: "GID-DEMO06",
      goalName: "Car Major Service & All-Terrain Tires",
      targetAmount: 1200,
      savedAmount: 750,
      deadline: formatOffset(9),
      purpose: "Vehicle & Transport",
      createdAt: "2026-09-01 16:45:00",
      email: "user@saveiq.internal",
      alertSent: "No"
    },
    {
      id: "GID-DEMO07",
      goalName: "Executive AI & Cloud Architecture Masterclass",
      targetAmount: 1500,
      savedAmount: 1500,
      deadline: formatOffset(-30),
      purpose: "Education & Career",
      createdAt: "2026-07-01 12:00:00",
      email: "user@saveiq.internal",
      alertSent: "No"
    },
    {
      id: "GID-DEMO08",
      goalName: "Home Gym & Wellness Upgrade",
      targetAmount: 2200,
      savedAmount: 650,
      deadline: formatOffset(120),
      purpose: "Health & Wellness",
      createdAt: "2026-10-01 15:10:00",
      email: "user@saveiq.internal",
      alertSent: "No"
    }
  ];
}

function generateClientHeuristic(goal) {
  return `### Velocity & Pacing Assessment
- **Funded:** $${goal.savedAmount.toLocaleString()} of $${goal.targetAmount.toLocaleString()} (${goal.progressPercent}%)
- **Outstanding Balance:** $${goal.remainingAmount.toLocaleString()}
- **Timeline Horizon:** ${goal.deadline} (${goal.daysLeft} days remaining)

### Structured Contribution Milestones
- **Daily Pace:** **$${goal.dailyRequired.toFixed(2)} / day**
- **Weekly Milestone:** **$${goal.weeklyRequired.toFixed(2)} / week**

### High-Impact Expense Levers (${goal.purpose})
1. **Automated Payday Sweep:** Transfer $${goal.weeklyRequired.toFixed(2)} on every compensation date before discretionary budgeting.
2. **Subscription Audit:** Audit bank recurring debits and pause one unused digital subscription.
3. **The 48-Hour Delay:** Hold off on discretionary purchases exceeding $50 for 48 hours; deposit unspent funds immediately.

### Behavioral Discipline Protocol
Keep target savings segregated in a dedicated high-yield account with withdrawal friction to eliminate spontaneous liquidations.`;
}

// ==========================================
// TRANSACTION HISTORY MANAGEMENT
// ==========================================
function getTransactions(goalId) {
  try {
    const all = JSON.parse(localStorage.getItem("saveiq_tx_log") || "{}");
    if (all[goalId] && all[goalId].length > 0) return all[goalId];
    
    // Provide realistic demo deposit logs for pre-seeded goals
    const goal = (AppState.goals || []).find(g => g.id === goalId);
    if (goal && goal.savedAmount > 0) {
      const part1 = Math.round(goal.savedAmount * 0.35);
      const part2 = Math.round(goal.savedAmount * 0.45);
      const part3 = goal.savedAmount - (part1 + part2);
      return [
        { date: "Oct 24, 2026, 10:15 AM", amount: part3 > 0 ? part3 : part2, note: "Bi-weekly automated paycheck sweep" },
        { date: "Oct 10, 2026, 09:30 AM", amount: part1, note: "Milestone allocation transfer" },
        { date: "Sep 25, 2026, 02:45 PM", amount: part2, note: "Initial goal creation & kickoff deposit" }
      ];
    }
    return [];
  } catch (e) {
    return [];
  }
}

function recordTransaction(goalId, amount, note) {
  try {
    const all = JSON.parse(localStorage.getItem("saveiq_tx_log") || "{}");
    if (!all[goalId]) all[goalId] = [];
    all[goalId].unshift({
      date: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      amount: amount,
      note: note || "Contribution deposit"
    });
    localStorage.setItem("saveiq_tx_log", JSON.stringify(all));
  } catch (e) {}
}

function openHistoryModal(goalId) {
  const goal = AppState.goals.find(g => g.id === goalId);
  if (!goal) return;

  document.getElementById("historyGoalTitle").textContent = `${goal.goalName} – Deposit History`;
  const historyList = getTransactions(goalId);
  const container = document.getElementById("historyListContainer");

  if (historyList.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 28px 16px; color: var(--text-muted); font-size: 13px;">
        No individual deposits logged yet for this goal.<br>
        Current balance: <strong style="color: var(--text-primary);">$${goal.savedAmount.toLocaleString()}</strong>
      </div>
    `;
  } else {
    container.innerHTML = `
      <table class="history-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Note</th>
            <th style="text-align: right;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${historyList.map(tx => `
            <tr>
              <td>${escapeHtml(tx.date)}</td>
              <td>${escapeHtml(tx.note)}</td>
              <td class="amount" style="text-align: right;">+$${tx.amount.toFixed(2)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  document.getElementById("historyModal").classList.add("active");
}

function closeHistoryModal() {
  document.getElementById("historyModal").classList.remove("active");
}

// ==========================================
// INTERACTIVE SAVINGS SIMULATOR
// ==========================================
function openSimulatorModal(targetGoalId = null) {
  const select = document.getElementById("simGoalSelect");
  if (select) {
    select.innerHTML = '<option value="custom">-- Custom Savings Target --</option>' + 
      AppState.goals.map(g => `<option value="${g.id}">${escapeHtml(g.goalName)} ($${g.savedAmount}/$${g.targetAmount})</option>`).join("");
    if (targetGoalId) {
      select.value = targetGoalId;
    }
  }
  syncSimulatorTarget();
  document.getElementById("simulatorModal").classList.add("active");
}

function closeSimulatorModal() {
  document.getElementById("simulatorModal").classList.remove("active");
}

function syncSimulatorTarget() {
  const select = document.getElementById("simGoalSelect");
  const goalId = select.value;
  let target = 2500;
  let saved = 0;

  if (goalId !== "custom") {
    const goal = AppState.goals.find(g => g.id === goalId);
    if (goal) {
      target = goal.targetAmount;
      saved = goal.savedAmount;
    }
  }

  document.getElementById("simTargetInput").value = target;
  document.getElementById("simSavedInput").value = saved;
  runSimulation();
}

function runSimulation() {
  const target = parseFloat(document.getElementById("simTargetInput").value) || 0;
  const saved = parseFloat(document.getElementById("simSavedInput").value) || 0;
  const weeklyDeposit = parseFloat(document.getElementById("simWeeklySlider").value) || 50;

  document.getElementById("simWeeklyLabel").textContent = `$${weeklyDeposit}/week`;

  const remaining = Math.max(target - saved, 0);
  const weeksNeeded = weeklyDeposit > 0 ? Math.ceil(remaining / weeklyDeposit) : 0;
  const daysNeeded = weeksNeeded * 7;

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + daysNeeded);

  setText("simWeeksVal", `${weeksNeeded} wks`);
  setText("simDateVal", targetDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
  setText("simDailyPaceVal", `$${(weeklyDeposit / 7).toFixed(2)}/day`);

  const accelerationText = document.getElementById("simAccelerationTip");
  if (accelerationText) {
    const fasterWeekly = weeklyDeposit + 25;
    const fasterWeeks = Math.ceil(remaining / fasterWeekly);
    const weeksSaved = weeksNeeded - fasterWeeks;
    if (weeksSaved > 0 && remaining > 0) {
      accelerationText.innerHTML = `💡 Adding <strong>+$25/week</strong> reaches this goal <strong>${weeksSaved} week${weeksSaved > 1 ? 's' : ''} (${weeksSaved * 7} days) sooner</strong>!`;
    } else {
      accelerationText.textContent = remaining === 0 ? "🎉 Target already fully funded!" : "Consistent contributions compound quickly!";
    }
  }
}

// ==========================================
// GOAL EDITING MODAL
// ==========================================
function openEditModal(goalId) {
  const goal = AppState.goals.find(g => g.id === goalId);
  if (!goal) return;

  document.getElementById("editGoalId").value = goal.id;
  document.getElementById("editGoalName").value = goal.goalName;
  document.getElementById("editGoalTarget").value = goal.targetAmount;
  document.getElementById("editGoalDeadline").value = goal.deadline;
  document.getElementById("editGoalPurpose").value = goal.purpose;
  document.getElementById("editGoalEmail").value = goal.email || "";

  document.getElementById("editGoalModal").classList.add("active");
}

function closeEditModal() {
  document.getElementById("editGoalModal").classList.remove("active");
}

async function handleEditGoalSubmit(e) {
  e.preventDefault();
  const id = document.getElementById("editGoalId").value;
  const name = document.getElementById("editGoalName").value.trim();
  const target = parseFloat(document.getElementById("editGoalTarget").value);
  const deadline = document.getElementById("editGoalDeadline").value;
  const purpose = document.getElementById("editGoalPurpose").value;
  const email = document.getElementById("editGoalEmail").value.trim();

  try {
    const res = await BackendBridge.updateGoal(id, {
      goalName: name,
      targetAmount: target,
      deadline: deadline,
      purpose: purpose,
      email: email
    });
    if (res.success) {
      showToast("Goal details updated", "success");
      closeEditModal();
      await refreshDashboard();
    } else {
      showToast("Failed to update goal: " + res.message, "error");
    }
  } catch (err) {
    showToast("Error updating: " + err.message, "error");
  }
}

// ==========================================
// DASHBOARD RENDERING & ANALYTICS
// ==========================================
async function refreshDashboard() {
  try {
    const rawGoals = await BackendBridge.fetchGoals();
    AppState.goals = rawGoals.map(calculateClientMetrics);
    computeStats();
    renderKPIs();
    applyFilterAndRender();
  } catch (err) {
    showToast("Failed to load goals: " + err.message, "error");
  }
}

function computeStats() {
  let totalTarget = 0;
  let totalSaved = 0;
  let active = 0;
  let completed = 0;
  let overdue = 0;

  AppState.goals.forEach(g => {
    totalTarget += g.targetAmount;
    totalSaved += g.savedAmount;
    if (g.status === "Completed") completed++;
    else if (g.status === "Overdue") overdue++;
    else active++;
  });

  const overallProgress = totalTarget > 0 ? Math.min(Math.round((totalSaved / totalTarget) * 1000) / 10, 100) : 0;
  const totalCount = AppState.goals.length;
  const disciplineScore = totalCount > 0 ? Math.max(Math.round(((totalCount - overdue) / totalCount) * 100), 0) : 100;

  AppState.stats = {
    totalGoals: totalCount,
    totalTarget: totalTarget,
    totalSaved: totalSaved,
    totalRemaining: Math.max(totalTarget - totalSaved, 0),
    overallProgress: overallProgress,
    activeGoals: active,
    completedGoals: completed,
    overdueGoals: overdue,
    disciplineScore: disciplineScore
  };
}

function renderKPIs() {
  const s = AppState.stats;
  setText("kpiTotalTarget", `$${s.totalTarget.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2})}`);
  setText("kpiTotalSaved", `$${s.totalSaved.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2})}`);
  setText("kpiOverallProgress", `${s.overallProgress}%`);
  setText("kpiActiveGoals", `${s.activeGoals} active`);
  setText("kpiCompletedGoals", `${s.completedGoals} completed`);
  setText("kpiOverdueGoals", `${s.overdueGoals} overdue`);
  setText("kpiRemainingLabel", `$${s.totalRemaining.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2})} remaining`);

  setText("kpiDisciplineScore", `${s.disciplineScore}%`);
  const subEl = document.getElementById("kpiDisciplineSub");
  if (subEl) {
    subEl.textContent = s.disciplineScore >= 80 ? "High discipline" : (s.disciplineScore >= 50 ? "Moderate pacing" : "Attention needed");
    subEl.style.color = s.disciplineScore >= 80 ? "var(--accent-emerald)" : (s.disciplineScore >= 50 ? "var(--accent-amber)" : "var(--accent-rose)");
  }

  const fillEl = document.getElementById("kpiOverviewProgressFill");
  if (fillEl) {
    fillEl.style.width = `${Math.min(s.overallProgress, 100)}%`;
  }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function applyFilterAndRender() {
  let filtered = [...AppState.goals];

  if (AppState.currentFilter === "active") filtered = filtered.filter(g => g.status === "Active");
  else if (AppState.currentFilter === "completed") filtered = filtered.filter(g => g.status === "Completed");
  else if (AppState.currentFilter === "overdue") filtered = filtered.filter(g => g.status === "Overdue");

  if (AppState.searchQuery) {
    const q = AppState.searchQuery.toLowerCase();
    filtered = filtered.filter(g =>
      g.goalName.toLowerCase().includes(q) ||
      g.purpose.toLowerCase().includes(q)
    );
  }

  if (AppState.sortBy === "deadline") {
    filtered.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  } else if (AppState.sortBy === "progress") {
    filtered.sort((a, b) => b.progressPercent - a.progressPercent);
  } else if (AppState.sortBy === "target") {
    filtered.sort((a, b) => b.targetAmount - a.targetAmount);
  } else if (AppState.sortBy === "name") {
    filtered.sort((a, b) => a.goalName.localeCompare(b.goalName));
  }

  AppState.filteredGoals = filtered;
  renderGoalCards(filtered);
}

function renderGoalCards(goals) {
  const container = document.getElementById("goalsGrid");
  if (!goals || goals.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No goals found</h3>
        <p>${AppState.searchQuery ? "No goals match your search term." : "Start building financial discipline by creating your first savings goal."}</p>
        <button class="btn btn-primary" onclick="openCreateModal()">Create Goal</button>
      </div>
    `;
    return;
  }

  container.innerHTML = goals.map(g => createGoalCardHtml(g)).join("");
}

function createGoalCardHtml(g) {
  const categoryLabel = PURPOSE_LABELS[g.purpose] || g.purpose;
  const isCompleted = g.status === "Completed";
  const isOverdue = g.status === "Overdue";

  let statusClass = "active";
  let statusText = "Active";
  if (isCompleted) {
    statusClass = "completed";
    statusText = "Completed";
  } else if (isOverdue) {
    statusClass = "overdue";
    statusText = "Overdue";
  }

  let deadlineLabel = "";
  if (isCompleted) {
    deadlineLabel = "Completed";
  } else if (isOverdue) {
    deadlineLabel = `${Math.abs(g.daysLeft)}d overdue`;
  } else if (g.daysLeft === 0) {
    deadlineLabel = "Due today";
  } else {
    deadlineLabel = `${g.daysLeft}d left`;
  }

  const paceLabel = isCompleted
    ? "Goal funded"
    : (g.dailyRequired > 0 ? `$${g.dailyRequired.toFixed(2)}/day` : "Target achieved");

  return `
    <div class="goal-card" id="card-${g.id}">
      <div>
        <div class="goal-top">
          <div class="goal-title-wrap">
            <h3>${escapeHtml(g.goalName)}</h3>
            <span class="goal-category-tag">${escapeHtml(categoryLabel)}</span>
          </div>
          <span class="status-pill ${statusClass}">${statusText}</span>
        </div>

        <div class="card-amounts">
          <div>
            <span class="card-amount-saved">$${g.savedAmount.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2})}</span>
            <span class="card-amount-target">/ $${g.targetAmount.toLocaleString()}</span>
          </div>
          <span class="card-progress-percent">${g.progressPercent}%</span>
        </div>

        <div class="card-progress-track">
          <div class="card-progress-fill ${statusClass}" style="width: ${Math.min(g.progressPercent, 100)}%;"></div>
        </div>

        <!-- Milestone Markers -->
        <div class="card-milestones">
          <span class="milestone-dot ${g.progressPercent >= 25 ? 'achieved' : ''}">
            <span class="milestone-circle"></span> 25%
          </span>
          <span class="milestone-dot ${g.progressPercent >= 50 ? 'achieved' : ''}">
            <span class="milestone-circle"></span> 50%
          </span>
          <span class="milestone-dot ${g.progressPercent >= 75 ? 'achieved' : ''}">
            <span class="milestone-circle"></span> 75%
          </span>
          <span class="milestone-dot ${g.progressPercent >= 100 ? 'achieved' : ''}">
            <span class="milestone-circle"></span> 100%
          </span>
        </div>

        <div class="card-meta-row">
          <span class="card-meta-item">Timeline: <strong>${deadlineLabel}</strong></span>
          <span class="card-meta-item pace">Pace: <strong>${paceLabel}</strong></span>
        </div>

        <!-- Quick Micro-Save Chips -->
        ${!isCompleted ? `
        <div class="card-quick-saves">
          <span class="card-quick-label">Quick Save:</span>
          <button class="btn-quick-chip" onclick="quickDeposit('${g.id}', 10)">+$10</button>
          <button class="btn-quick-chip" onclick="quickDeposit('${g.id}', 25)">+$25</button>
          <button class="btn-quick-chip" onclick="quickDeposit('${g.id}', 50)">+$50</button>
          <button class="btn-quick-chip" onclick="quickDeposit('${g.id}', 100)">+$100</button>
        </div>` : ''}
      </div>

      <div class="card-actions">
        <button class="btn-card-action primary" onclick="openDepositModal('${g.id}')">
          + Deposit
        </button>
        <button class="btn-card-action" onclick="openAIInsightsModal('${g.id}')">
          Strategy
        </button>
        <button class="btn-card-icon-action" title="Simulate / Project Plan" onclick="openSimulatorModal('${g.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"></rect><line x1="8" y1="6" x2="16" y2="6"></line><line x1="16" y1="14" x2="16" y2="18"></line><path d="M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01"></path></svg>
        </button>
        <button class="btn-card-icon-action" title="Deposit History" onclick="openHistoryModal('${g.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        </button>
        <button class="btn-card-icon-action" title="Edit Goal" onclick="openEditModal('${g.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
        <button class="btn-card-icon-action btn-card-delete" title="Delete Goal" onclick="confirmDeleteGoal('${g.id}', '${escapeHtml(g.goalName)}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ==========================================
// MODAL CONTROLLERS & ACTIONS
// ==========================================
function openCreateModal() {
  document.getElementById("createGoalForm").reset();
  const defaultDate = new Date();
  defaultDate.setDate(defaultDate.getDate() + 60);
  document.getElementById("goalDeadline").value = defaultDate.toISOString().slice(0, 10);
  document.getElementById("createGoalModal").classList.add("active");
  calculateFormPreview();
}

function closeCreateModal() {
  document.getElementById("createGoalModal").classList.remove("active");
}

function calculateFormPreview() {
  const target = parseFloat(document.getElementById("goalTarget").value) || 0;
  const initial = parseFloat(document.getElementById("goalInitial").value) || 0;
  const deadlineVal = document.getElementById("goalDeadline").value;
  const previewBox = document.getElementById("formPacingPreview");

  if (!deadlineVal || target <= 0) {
    if (previewBox) previewBox.style.display = "none";
    return;
  }

  const remaining = Math.max(target - initial, 0);
  const deadline = new Date(deadlineVal);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  deadline.setHours(0, 0, 0, 0);

  const days = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
  if (days > 0 && remaining > 0) {
    const daily = (remaining / days).toFixed(2);
    const weekly = (remaining / (days / 7)).toFixed(2);
    if (previewBox) {
      previewBox.style.display = "block";
      previewBox.innerHTML = `Pacing target: <strong>$${daily}/day</strong> · <strong>$${weekly}/week</strong> over ${days} days`;
    }
  } else if (previewBox) {
    previewBox.style.display = "none";
  }
}

async function handleCreateGoalSubmit(e) {
  e.preventDefault();
  const submitBtn = document.getElementById("btnSubmitGoal");
  submitBtn.disabled = true;
  submitBtn.innerHTML = `Creating...`;

  const initialAmount = parseFloat(document.getElementById("goalInitial").value) || 0;
  const goalData = {
    goalName: document.getElementById("goalName").value.trim(),
    targetAmount: parseFloat(document.getElementById("goalTarget").value),
    initialSavings: initialAmount,
    deadline: document.getElementById("goalDeadline").value,
    purpose: document.getElementById("goalPurpose").value,
    email: document.getElementById("goalEmail").value.trim()
  };

  try {
    const res = await BackendBridge.createGoal(goalData);
    if (res.success) {
      if (initialAmount > 0 && res.goal) {
        recordTransaction(res.goal.id, initialAmount, "Initial deposit");
      }
      showToast("Goal created", "success");
      closeCreateModal();
      await refreshDashboard();
    } else {
      showToast(res.message || "Failed to create goal", "error");
    }
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `Create Goal`;
  }
}

// Deposit Modal
function openDepositModal(goalId) {
  const goal = AppState.goals.find(g => g.id === goalId);
  if (!goal) return;
  AppState.currentGoalForDeposit = goal;

  document.getElementById("depositGoalName").textContent = goal.goalName;
  document.getElementById("depositGoalRemaining").textContent = "$" + goal.remainingAmount.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2});
  document.getElementById("depositAmountInput").value = "";
  const noteInput = document.getElementById("depositNoteInput");
  if (noteInput) noteInput.value = "";

  // Dynamic Full Balance chip
  const remainingChip = document.getElementById("chipRemainingBalance");
  if (remainingChip) {
    remainingChip.textContent = `Full ($${goal.remainingAmount.toFixed(0)})`;
    remainingChip.onclick = () => setPresetDeposit(goal.remainingAmount);
  }

  document.getElementById("depositModal").classList.add("active");
}

function closeDepositModal() {
  document.getElementById("depositModal").classList.remove("active");
  AppState.currentGoalForDeposit = null;
}

function setPresetDeposit(amount) {
  document.getElementById("depositAmountInput").value = amount;
}

async function quickDeposit(goalId, amount) {
  const goal = AppState.goals.find(g => g.id === goalId);
  if (!goal) return;

  try {
    const res = await BackendBridge.addDeposit(goalId, amount);
    if (res.success) {
      recordTransaction(goalId, amount, "Quick save micro-deposit");
      showToast(`+$${amount} saved to ${goal.goalName}!`, "success");
      await refreshDashboard();
    } else {
      showToast("Deposit failed: " + res.message, "error");
    }
  } catch (err) {
    showToast("Error: " + err.message, "error");
  }
}

async function handleDepositSubmit(e) {
  e.preventDefault();
  if (!AppState.currentGoalForDeposit) return;

  const amount = parseFloat(document.getElementById("depositAmountInput").value);
  if (!amount || amount <= 0) {
    showToast("Enter a valid deposit amount", "warning");
    return;
  }

  const noteInput = document.getElementById("depositNoteInput");
  const note = noteInput ? noteInput.value.trim() : "Contribution deposit";

  const btn = document.getElementById("btnConfirmDeposit");
  btn.disabled = true;
  btn.innerHTML = "Processing...";

  try {
    const res = await BackendBridge.addDeposit(AppState.currentGoalForDeposit.id, amount);
    if (res.success) {
      recordTransaction(AppState.currentGoalForDeposit.id, amount, note);
      showToast(`Deposited $${amount.toFixed(2)} to ${AppState.currentGoalForDeposit.goalName}`, "success");
      closeDepositModal();
      await refreshDashboard();
    } else {
      showToast(res.message || "Failed to add deposit", "error");
    }
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = "Confirm Deposit";
  }
}

// Goal Deletion
async function confirmDeleteGoal(id, name) {
  if (confirm(`Delete the goal "${name}"?`)) {
    try {
      const res = await BackendBridge.deleteGoal(id);
      if (res.success) {
        showToast("Goal removed", "success");
        await refreshDashboard();
      } else {
        showToast(res.message || "Failed to delete goal", "error");
      }
    } catch (err) {
      showToast("Error deleting: " + err.message, "error");
    }
  }
}

// AI Strategy Modal
async function openAIInsightsModal(goalId) {
  const goal = AppState.goals.find(g => g.id === goalId);
  if (!goal) return;
  AppState.currentGoalForAI = goal;

  document.getElementById("aiGoalTitle").textContent = goal.goalName;
  document.getElementById("aiSourceBadge").textContent = "Analyzing...";
  document.getElementById("aiContentBox").innerHTML = `
    <div class="spinner-wrap">
      <div class="spinner"></div>
      <p style="color: var(--text-secondary); font-size: 13px;">Formulating savings plan...</p>
    </div>
  `;

  document.getElementById("aiModal").classList.add("active");

  try {
    const res = await BackendBridge.requestAIInsights(goal);
    if (res.success) {
      document.getElementById("aiSourceBadge").textContent = res.source || "Strategy Engine";
      document.getElementById("aiContentBox").innerHTML = parseMarkdownToHtml(res.recommendation);
    } else {
      document.getElementById("aiContentBox").innerHTML = `<p style="color: var(--accent-rose);">Failed to generate insights: ${res.message}</p>`;
    }
  } catch (err) {
    document.getElementById("aiContentBox").innerHTML = `<p style="color: var(--accent-rose);">Error: ${err.message}</p>`;
  }
}

function closeAIModal() {
  document.getElementById("aiModal").classList.remove("active");
  AppState.currentGoalForAI = null;
}

function copyAIAdvice() {
  const box = document.getElementById("aiContentBox");
  if (!box) return;
  navigator.clipboard.writeText(box.innerText).then(() => {
    showToast("Plan copied to clipboard", "success");
  });
}

function parseMarkdownToHtml(md) {
  if (!md) return "";
  let html = md
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/gim, "<em>$1</em>")
    .replace(/\n\n/gim, "<p></p>")
    .replace(/^\- (.*$)/gim, "<li>$1</li>")
    .replace(/^\d+\. (.*$)/gim, "<li>$1</li>");

  html = html.replace(/(<li>.*?<\/li>)/gms, "<ul>$1</ul>");
  html = html.replace(/<\/ul>\s*<ul>/g, "");
  return html;
}

// Settings Modal
function openSettingsModal() {
  const provEl = document.getElementById("aiProviderSelect");
  if (provEl) provEl.value = AppState.aiProvider || "groq";

  const groqInput = document.getElementById("groqApiKeyInput");
  const storedGroq = AppState.groqApiKey || localStorage.getItem("saveiq_groq_key") || "";
  if (groqInput) groqInput.value = storedGroq;

  const openaiInput = document.getElementById("openaiApiKeyInput");
  const storedOpenAI = AppState.openaiApiKey || localStorage.getItem("saveiq_openai_key") || "";
  if (openaiInput) openaiInput.value = storedOpenAI;

  const modeEl = document.getElementById("activeBackendModeLabel");
  if (modeEl) {
    if (AppState.backendMode === "fastapi" || BackendBridge.isFastAPIAvailable) {
      modeEl.textContent = "CONNECTED (Local Server)";
      modeEl.style.color = "#10b981";
    } else if (AppState.backendMode === "gas") {
      modeEl.textContent = "CONNECTED (Google Apps Script)";
      modeEl.style.color = "#10b981";
    } else {
      modeEl.textContent = "STANDALONE / CLIENT (Offline Mode)";
      modeEl.style.color = "#f59e0b";
    }
  }

  // Actively fetch /api/config if Groq API key is not yet set
  fetch("/api/config")
    .then(r => r.json())
    .then(cfg => {
      if (cfg && cfg.groqApiKey) {
        AppState.groqApiKey = cfg.groqApiKey;
        localStorage.setItem("saveiq_groq_key", cfg.groqApiKey);
        if (groqInput && (!groqInput.value || groqInput.value.length === 0)) {
          groqInput.value = cfg.groqApiKey;
        }
      }
      if (modeEl) {
        modeEl.textContent = "CONNECTED (Local Server)";
        modeEl.style.color = "#10b981";
      }
    })
    .catch(() => {});

  document.getElementById("settingsModal").classList.add("active");
}

function closeSettingsModal() {
  document.getElementById("settingsModal").classList.remove("active");
}

function saveSettings() {
  const provEl = document.getElementById("aiProviderSelect");
  if (provEl) {
    AppState.aiProvider = provEl.value;
    localStorage.setItem("saveiq_ai_provider", provEl.value);
  }

  const groqInput = document.getElementById("groqApiKeyInput");
  if (groqInput) {
    const key = groqInput.value.trim();
    AppState.groqApiKey = key;
    localStorage.setItem("saveiq_groq_key", key);
    if (AppState.backendMode === "gas") {
      google.script.run
        .withSuccessHandler(() => showToast("Groq key saved in Script properties", "success"))
        .setGroqApiKey(key);
    }
  }

  const openaiInput = document.getElementById("openaiApiKeyInput");
  if (openaiInput) {
    const oKey = openaiInput.value.trim();
    AppState.openaiApiKey = oKey;
    localStorage.setItem("saveiq_openai_key", oKey);
  }

  showToast("Preferences saved", "success");
  closeSettingsModal();
}

async function runManualAudit() {
  showToast("Running audit check...", "info");
  try {
    const res = await BackendBridge.triggerAudit();
    if (res.success) {
      showToast(`Audit complete (${res.processed} goals reviewed)`, "success");
      await refreshDashboard();
    } else {
      showToast("Audit failed: " + res.message, "error");
    }
  } catch (err) {
    showToast("Error running audit: " + err.message, "error");
  }
}

function exportGoalsCSV() {
  if (AppState.goals.length === 0) {
    showToast("No goals to export", "warning");
    return;
  }

  const headers = ["ID", "Goal Name", "Category", "Target ($)", "Saved ($)", "Remaining ($)", "Progress (%)", "Deadline", "Days Left", "Status", "Email"];
  const rows = AppState.goals.map(g => [
    g.id,
    `"${g.goalName.replace(/"/g, '""')}"`,
    `"${g.purpose}"`,
    g.targetAmount,
    g.savedAmount,
    g.remainingAmount,
    g.progressPercent,
    g.deadline,
    g.daysLeft,
    g.status,
    g.email || ""
  ]);

  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `SaveIQ_Report_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast("CSV downloaded", "success");
}

function downloadPDFReport() {
  if (AppState.backendMode === "fastapi") {
    showToast("Generating PDF report via ReportLab service...", "info");
    const link = document.createElement("a");
    link.href = "/api/reports/pdf";
    link.download = `SaveIQ_Statement_${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } else {
    showToast("Opening statement print dialog...", "info");
    window.print();
  }
}

function printFinancialReport() {
  downloadPDFReport();
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    toast.style.transition = "all 0.2s ease";
    setTimeout(() => toast.remove(), 200);
  }, 3200);
}

// ==========================================
// INITIALIZATION & EVENT LISTENERS
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
  initTheme();

  // Filter tabs
  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      AppState.currentFilter = btn.dataset.filter;
      applyFilterAndRender();
    });
  });

  // Search
  const searchInput = document.getElementById("searchGoalInput");
  if (searchInput) {
    searchInput.addEventListener("input", e => {
      AppState.searchQuery = e.target.value;
      applyFilterAndRender();
    });
  }

  // Sort
  const sortSelect = document.getElementById("sortGoalSelect");
  if (sortSelect) {
    sortSelect.addEventListener("change", e => {
      AppState.sortBy = e.target.value;
      applyFilterAndRender();
    });
  }

  // Form preview
  ["goalTarget", "goalInitial", "goalDeadline"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", calculateFormPreview);
  });

  // Simulator inputs
  const simSlider = document.getElementById("simWeeklySlider");
  if (simSlider) simSlider.addEventListener("input", runSimulation);

  const simTarget = document.getElementById("simTargetInput");
  if (simTarget) simTarget.addEventListener("input", runSimulation);

  const simSaved = document.getElementById("simSavedInput");
  if (simSaved) simSaved.addEventListener("input", runSimulation);

  const simSelect = document.getElementById("simGoalSelect");
  if (simSelect) simSelect.addEventListener("change", syncSimulatorTarget);

  // Forms
  const createForm = document.getElementById("createGoalForm");
  if (createForm) createForm.addEventListener("submit", handleCreateGoalSubmit);

  const depositForm = document.getElementById("depositForm");
  if (depositForm) depositForm.addEventListener("submit", handleDepositSubmit);

  const editForm = document.getElementById("editGoalForm");
  if (editForm) editForm.addEventListener("submit", handleEditGoalSubmit);

  // Keyboard shortcut: Escape to close open modal
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-overlay.active").forEach(m => m.classList.remove("active"));
    }
  });

  // Click backdrop outside modal content to close
  document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", e => {
      if (e.target === overlay) {
        overlay.classList.remove("active");
      }
    });
  });

  await BackendBridge.detectMode();
  await refreshDashboard();
});
