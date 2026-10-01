/**
 * SaveIQ – AI Savings Goal Tracker
 * Frontend Interaction, Dynamic Analytics, AI Insights & Backend Bridge
 * 
 * Features:
 * - Dual Engine: Automatically bridges with Google Apps Script (google.script.run),
 *   FastAPI backend (/api/*), or Local Browser Storage with Direct Groq API client!
 * - Real-time Financial Analytics & KPI calculation
 * - Reactive Filtering, Search, & Sorting
 * - AI Recommendation streaming & markdown rendering
 * - Confetti celebration on goal achievement
 * - PDF and CSV report export
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
    overdueGoals: 0
  },
  currentGoalForDeposit: null,
  currentGoalForAI: null,
  groqApiKey: localStorage.getItem("saveiq_groq_key") || "",
  backendMode: "auto" // 'auto', 'gas', 'fastapi', 'local'
};

// Purpose to Emoji Mapping for Visual Appeal
const PURPOSE_ICONS = {
  "Emergency Fund": "🛡️",
  "Tech & Gadgets": "💻",
  "Vacation & Travel": "✈️",
  "Vehicle & Transport": "🚗",
  "Home & Real Estate": "🏡",
  "Education & Career": "🎓",
  "Investment & Wealth": "📈",
  "Shopping & Luxury": "🛍️",
  "Health & Wellness": "❤️",
  "General Savings": "💰"
};

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
      const res = await fetch("/api/goals", { method: "HEAD" });
      if (res.ok) {
        AppState.backendMode = "fastapi";
        this.isFastAPIAvailable = true;
        return "fastapi";
      }
    } catch (e) {
      // Not running against FastAPI
    }
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
        // LocalStorage fallback
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
          .addGoal(goalData);
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
        const id = "GID-" + Math.random().toString(36).substr(2, 8).toUpperCase();
        const newGoal = {
          id: id,
          goalName: goalData.goalName,
          targetAmount: parseFloat(goalData.targetAmount) || 0,
          savedAmount: parseFloat(goalData.initialSavings) || 0,
          deadline: goalData.deadline,
          purpose: goalData.purpose || "General Savings",
          createdAt: new Date().toISOString().slice(0, 19).replace("T", " "),
          email: goalData.email || "",
          alertSent: "No"
        };
        const calculated = calculateClientMetrics(newGoal);
        const existing = JSON.parse(localStorage.getItem("saveiq_goals") || "[]");
        existing.unshift(calculated);
        localStorage.setItem("saveiq_goals", JSON.stringify(existing));
        resolve({ success: true, goal: calculated });
      }
    });
  },

  addDeposit: function(id, amount) {
    return new Promise((resolve, reject) => {
      if (AppState.backendMode === "gas") {
        google.script.run
          .withSuccessHandler(res => resolve(res))
          .withFailureHandler(err => reject(err))
          .updateSavings(id, amount);
      } else if (AppState.backendMode === "fastapi") {
        fetch(`/api/goals/${id}/savings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: amount })
        })
          .then(res => res.json())
          .then(data => resolve(data))
          .catch(err => reject(err));
      } else {
        const existing = JSON.parse(localStorage.getItem("saveiq_goals") || "[]");
        const idx = existing.findIndex(g => g.id === id);
        if (idx !== -1) {
          existing[idx].savedAmount += parseFloat(amount);
          const updated = calculateClientMetrics(existing[idx]);
          existing[idx] = updated;
          localStorage.setItem("saveiq_goals", JSON.stringify(existing));
          resolve({ success: true, goal: updated, newSaved: updated.savedAmount });
        } else {
          reject(new Error("Goal not found"));
        }
      }
    });
  },

  deleteGoal: function(id) {
    return new Promise((resolve, reject) => {
      if (AppState.backendMode === "gas") {
        google.script.run
          .withSuccessHandler(res => resolve(res))
          .withFailureHandler(err => reject(err))
          .deleteGoal(id);
      } else if (AppState.backendMode === "fastapi") {
        fetch(`/api/goals/${id}`, { method: "DELETE" })
          .then(res => res.json())
          .then(data => resolve(data))
          .catch(err => reject(err));
      } else {
        let existing = JSON.parse(localStorage.getItem("saveiq_goals") || "[]");
        existing = existing.filter(g => g.id !== id);
        localStorage.setItem("saveiq_goals", JSON.stringify(existing));
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
      const res = await fetch("/api/ai/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal_id: goal.id })
      });
      return await res.json();
    }

    // Direct Groq Cloud API in Client-Side Mode
    const apiKey = AppState.groqApiKey;
    if (!apiKey) {
      return {
        success: true,
        isFallback: true,
        source: "SaveIQ Smart Heuristic Engine (Tip: Enter Groq API Key in Settings for Llama-3.3-70B)",
        recommendation: generateClientHeuristic(goal)
      };
    }

    try {
      const prompt = `SAVINGS GOAL PROFILE:
- Goal Name: ${goal.goalName}
- Purpose: ${goal.purpose}
- Target Amount: $${goal.targetAmount}
- Saved Amount: $${goal.savedAmount} (${goal.progressPercent}%)
- Remaining Amount: $${goal.remainingAmount}
- Deadline: ${goal.deadline} (${goal.daysLeft} days left)
- Status: ${goal.status}
- Required Daily: $${goal.dailyRequired}/day
- Required Weekly: $${goal.weeklyRequired}/week

Please act as a top-tier financial strategist and provide actionable, structured advice in clean markdown.`;

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + apiKey
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            {
              role: "system",
              content: "You are SaveIQ's Senior AI Financial Advisor. Format your response with clear headings, daily savings pacing, 3 high-impact expense trimming hacks tailored to the purpose, and behavioral motivation."
            },
            { role: "user", content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 1024
        })
      });

      if (!response.ok) {
        throw new Error("Groq API returned HTTP " + response.status);
      }

      const json = await response.json();
      const content = json.choices[0].message.content;
      return {
        success: true,
        isFallback: false,
        source: "Groq Cloud (Llama-3.3-70B)",
        recommendation: content
      };
    } catch (err) {
      console.warn("Direct Groq call failed, using heuristic:", err);
      return {
        success: true,
        isFallback: true,
        source: "SaveIQ Heuristic Engine (Groq request issue)",
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
          .dailyAuditTrigger();
      } else if (AppState.backendMode === "fastapi") {
        fetch("/api/audit/trigger", { method: "POST" })
          .then(res => res.json())
          .then(data => resolve(data))
          .catch(err => reject(err));
      } else {
        // Local audit simulation
        const goals = AppState.goals;
        const alerted = goals.filter(g => (g.daysLeft <= 7 || g.status === "Overdue") && g.status !== "Completed");
        resolve({
          success: true,
          processed: goals.length,
          alertsSent: alerted.length,
          logs: alerted.map(g => `Alert queued for ${g.email || 'user'}: "${g.goalName}" (${g.daysLeft}d left)`)
        });
      }
    });
  }
};

// ==========================================
// CLIENT METRICS & HEURISTIC ENGINE
// ==========================================
function calculateClientMetrics(goal) {
  const target = Math.max(parseFloat(goal.targetAmount) || 0, 0);
  const saved = Math.max(parseFloat(goal.savedAmount) || 0, 0);
  const remaining = Math.max(target - saved, 0);
  const progressPercent = target > 0 ? Math.min(Math.round((saved / target) * 1000) / 10, 100) : 0;

  const deadline = new Date(goal.deadline);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  deadline.setHours(0, 0, 0, 0);

  const diffTime = deadline.getTime() - today.getTime();
  const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  let status = "Active";
  if (saved >= target) {
    status = "Completed";
  } else if (daysLeft < 0) {
    status = "Overdue";
  }

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
    purpose: goal.purpose || "General Savings",
    createdAt: goal.createdAt || new Date().toISOString().slice(0, 10),
    email: goal.email || "",
    alertSent: goal.alertSent || "No",
    dailyRequired: dailyRequired,
    weeklyRequired: weeklyRequired
  };
}

function generateClientHeuristic(goal) {
  return `### 📊 Financial Progress Assessment: ${goal.goalName}
- **Current Completion:** ${goal.progressPercent}% ($${goal.savedAmount.toFixed(2)} of $${goal.targetAmount.toFixed(2)})
- **Outstanding Balance:** $${goal.remainingAmount.toFixed(2)}
- **Timeline Status:** ${goal.daysLeft >= 0 ? goal.daysLeft + " days remaining" : Math.abs(goal.daysLeft) + " days overdue"}

### 💡 Pacing & Milestone Target
- **Daily Target:** Save **$${goal.dailyRequired.toFixed(2)}** each day to stay on schedule.
- **Weekly Target:** Deposit **$${goal.weeklyRequired.toFixed(2)}** per week.

### ✂️ High-Impact Savings Tactics (${goal.purpose})
1. **The 24-Hour Purchase Rule:** Delay impulse non-essential purchases for 24 hours. If you decide against it, transfer the money directly into this goal!
2. **Weekly Discretionary Trim:** Identify one subscription or dining expense to redirect into your savings target ($15–$30/week saved).
3. **Automated Payday Sweep:** Set an automatic bank recurring transfer on payday for $${goal.weeklyRequired.toFixed(2)}.

### 🚀 Motivation
*"Small daily disciplines repeated consistently lead to massive financial freedom."*`;
}

function getDemoGoals() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 45);

  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 5);

  const past = new Date();
  past.setDate(past.getDate() - 3);

  const demo = [
    {
      id: "GID-DEMO001",
      goalName: "M3 MacBook Pro Setup",
      targetAmount: 2400,
      savedAmount: 1800,
      deadline: tomorrow.toISOString().slice(0, 10),
      purpose: "Tech & Gadgets",
      createdAt: "2026-08-01",
      email: "demo@saveiq.internal",
      alertSent: "No"
    },
    {
      id: "GID-DEMO002",
      goalName: "Emergency Reserve Fund",
      targetAmount: 5000,
      savedAmount: 3250,
      deadline: nextWeek.toISOString().slice(0, 10),
      purpose: "Emergency Fund",
      createdAt: "2026-07-15",
      email: "demo@saveiq.internal",
      alertSent: "No"
    },
    {
      id: "GID-DEMO003",
      goalName: "Tokyo Cherry Blossom Trip",
      targetAmount: 3500,
      savedAmount: 3500,
      deadline: tomorrow.toISOString().slice(0, 10),
      purpose: "Vacation & Travel",
      createdAt: "2026-06-10",
      email: "demo@saveiq.internal",
      alertSent: "Completed"
    },
    {
      id: "GID-DEMO004",
      goalName: "Car Maintenance & Tires",
      targetAmount: 800,
      savedAmount: 450,
      deadline: past.toISOString().slice(0, 10),
      purpose: "Vehicle & Transport",
      createdAt: "2026-08-10",
      email: "demo@saveiq.internal",
      alertSent: "No"
    }
  ];
  localStorage.setItem("saveiq_goals", JSON.stringify(demo));
  return demo;
}

// ==========================================
// UI RENDERING & COMPONENT LOGIC
// ==========================================
async function refreshDashboard() {
  const goalsContainer = document.getElementById("goalsGrid");
  goalsContainer.innerHTML = `
    <div class="spinner-wrap" style="grid-column: 1 / -1;">
      <div class="spinner"></div>
      <p style="color: var(--text-muted); font-size: 13px;">Synchronizing financial data...</p>
    </div>
  `;

  try {
    const goals = await BackendBridge.fetchGoals();
    AppState.goals = goals;
    calculateAggregateStats();
    renderKPIs();
    applyFilterAndRender();
  } catch (err) {
    showToast("Failed to load goals: " + err.message, "error");
    goalsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3>Unable to load savings goals</h3>
        <p>${err.message}</p>
        <button class="btn btn-primary" onclick="refreshDashboard()">Retry Connection</button>
      </div>
    `;
  }
}

function calculateAggregateStats() {
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

  AppState.stats = {
    totalGoals: AppState.goals.length,
    totalTarget: totalTarget,
    totalSaved: totalSaved,
    totalRemaining: Math.max(totalTarget - totalSaved, 0),
    overallProgress: overallProgress,
    activeGoals: active,
    completedGoals: completed,
    overdueGoals: overdue
  };
}

function renderKPIs() {
  const s = AppState.stats;
  animateValue("kpiTotalTarget", s.totalTarget, "$");
  animateValue("kpiTotalSaved", s.totalSaved, "$");
  animateValue("kpiOverallProgress", s.overallProgress, "", "%");
  animateValue("kpiActiveGoals", s.activeGoals);
  animateValue("kpiCompletedGoals", s.completedGoals);
  animateValue("kpiOverdueGoals", s.overdueGoals);

  // Update remaining pill
  const remEl = document.getElementById("kpiRemainingLabel");
  if (remEl) {
    remEl.textContent = `$${s.totalRemaining.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})} left to fund`;
  }
}

function animateValue(elementId, value, prefix = "", suffix = "") {
  const el = document.getElementById(elementId);
  if (!el) return;
  const isFloat = value % 1 !== 0;
  el.textContent = `${prefix}${value.toLocaleString(undefined, {
    minimumFractionDigits: isFloat ? 1 : 0,
    maximumFractionDigits: 2
  })}${suffix}`;
}

function applyFilterAndRender() {
  let filtered = [...AppState.goals];

  // Apply Category / Status Filter
  if (AppState.currentFilter !== "all") {
    filtered = filtered.filter(g => g.status.toLowerCase() === AppState.currentFilter.toLowerCase());
  }

  // Apply Search
  if (AppState.searchQuery.trim() !== "") {
    const q = AppState.searchQuery.toLowerCase();
    filtered = filtered.filter(g =>
      g.goalName.toLowerCase().includes(q) ||
      g.purpose.toLowerCase().includes(q) ||
      (g.email && g.email.toLowerCase().includes(q))
    );
  }

  // Apply Sorting
  filtered.sort((a, b) => {
    if (AppState.sortBy === "deadline") {
      return new Date(a.deadline) - new Date(b.deadline);
    } else if (AppState.sortBy === "progress") {
      return b.progressPercent - a.progressPercent;
    } else if (AppState.sortBy === "target") {
      return b.targetAmount - a.targetAmount;
    } else if (AppState.sortBy === "saved") {
      return b.savedAmount - a.savedAmount;
    }
    return 0;
  });

  AppState.filteredGoals = filtered;
  renderGoalCards(filtered);
}

function renderGoalCards(goals) {
  const container = document.getElementById("goalsGrid");
  if (!goals || goals.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎯</div>
        <h3>No savings goals found</h3>
        <p>${AppState.searchQuery ? "No goals match your search criteria." : "You haven't added any goals yet. Start building discipline today!"}</p>
        <button class="btn btn-primary" onclick="openCreateModal()">+ Create New Goal</button>
      </div>
    `;
    return;
  }

  container.innerHTML = goals.map(g => createGoalCardHtml(g)).join("");
}

function createGoalCardHtml(g) {
  const icon = PURPOSE_ICONS[g.purpose] || "💰";
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
    deadlineLabel = "🎉 Goal Achieved!";
  } else if (isOverdue) {
    deadlineLabel = `⚠️ ${Math.abs(g.daysLeft)} days overdue`;
  } else if (g.daysLeft === 0) {
    deadlineLabel = "⏳ Due Today!";
  } else {
    deadlineLabel = `⏳ ${g.daysLeft} days left`;
  }

  return `
    <div class="goal-card" id="card-${g.id}">
      <div>
        <div class="goal-top">
          <div class="goal-meta">
            <div class="goal-emoji">${icon}</div>
            <div class="goal-title-wrap">
              <h3>${escapeHtml(g.goalName)}</h3>
              <span class="goal-category-tag">${escapeHtml(g.purpose)}</span>
            </div>
          </div>
          <span class="status-pill ${statusClass}">${statusText}</span>
        </div>

        <div class="progress-container">
          <div class="progress-info">
            <div>
              <span class="saved-label">$${g.savedAmount.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2})}</span>
              <span class="target-label">/ $${g.targetAmount.toLocaleString()}</span>
            </div>
            <span class="percentage-badge">${g.progressPercent}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill ${statusClass}" style="width: ${Math.min(g.progressPercent, 100)}%;"></div>
          </div>
        </div>

        <div class="goal-metrics-row">
          <div class="metric-item">
            <div class="lbl">Remaining</div>
            <div class="val" style="color: ${isCompleted ? '#34d399' : '#f87171'}">$${g.remainingAmount.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2})}</div>
          </div>
          <div class="metric-item">
            <div class="lbl">Deadline</div>
            <div class="val" style="color: ${isOverdue ? '#f43f5e' : 'inherit'}">${deadlineLabel}</div>
          </div>
          <div class="metric-item">
            <div class="lbl">Daily Pace</div>
            <div class="val" style="color: #38bdf8;">${g.dailyRequired > 0 ? '$' + g.dailyRequired.toFixed(2) + '/d' : (isCompleted ? 'Done' : 'N/A')}</div>
          </div>
          <div class="metric-item">
            <div class="lbl">Weekly Pace</div>
            <div class="val" style="color: #818cf8;">${g.weeklyRequired > 0 ? '$' + g.weeklyRequired.toFixed(2) + '/w' : (isCompleted ? 'Done' : 'N/A')}</div>
          </div>
        </div>
      </div>

      <div class="goal-actions">
        <button class="btn-deposit" onclick="openDepositModal('${g.id}')">
          + Add Deposit
        </button>
        <button class="btn-ai" onclick="openAIInsightsModal('${g.id}')">
          ✨ AI Insights
        </button>
        <button class="btn-delete" title="Delete Goal" onclick="confirmDeleteGoal('${g.id}', '${escapeHtml(g.goalName)}')">
          🗑️
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
// MODALS & USER ACTIONS
// ==========================================

function openCreateModal() {
  document.getElementById("createGoalForm").reset();
  // Set default deadline to 60 days ahead
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
      previewBox.innerHTML = `
        💡 <strong>Plan Velocity:</strong> To reach $${target.toLocaleString()} in ${days} days, you will need to save 
        <strong style="color: #38bdf8;">$${daily}/day</strong> or <strong style="color: #818cf8;">$${weekly}/week</strong>.
      `;
    }
  } else if (previewBox) {
    previewBox.style.display = "none";
  }
}

async function handleCreateGoalSubmit(e) {
  e.preventDefault();
  const submitBtn = document.getElementById("btnSubmitGoal");
  submitBtn.disabled = true;
  submitBtn.innerHTML = `Saving...`;

  const goalData = {
    goalName: document.getElementById("goalName").value.trim(),
    targetAmount: parseFloat(document.getElementById("goalTarget").value),
    initialSavings: parseFloat(document.getElementById("goalInitial").value) || 0,
    deadline: document.getElementById("goalDeadline").value,
    purpose: document.getElementById("goalPurpose").value,
    email: document.getElementById("goalEmail").value.trim()
  };

  try {
    const res = await BackendBridge.createGoal(goalData);
    if (res.success) {
      showToast("Goal created successfully!", "success");
      closeCreateModal();
      await refreshDashboard();
    } else {
      showToast(res.message || "Failed to create goal", "error");
    }
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `Create Savings Goal`;
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
  document.getElementById("depositModal").classList.add("active");
}

function closeDepositModal() {
  document.getElementById("depositModal").classList.remove("active");
  AppState.currentGoalForDeposit = null;
}

function setPresetDeposit(amount) {
  document.getElementById("depositAmountInput").value = amount;
}

async function handleDepositSubmit(e) {
  e.preventDefault();
  if (!AppState.currentGoalForDeposit) return;

  const amount = parseFloat(document.getElementById("depositAmountInput").value);
  if (!amount || amount <= 0) {
    showToast("Please enter a valid deposit amount", "warning");
    return;
  }

  const btn = document.getElementById("btnConfirmDeposit");
  btn.disabled = true;
  btn.innerHTML = "Processing...";

  try {
    const res = await BackendBridge.addDeposit(AppState.currentGoalForDeposit.id, amount);
    if (res.success) {
      showToast(`Deposited $${amount.toFixed(2)} to ${AppState.currentGoalForDeposit.goalName}!`, "success");
      
      // If goal reached 100%, trigger confetti!
      if (res.goal && res.goal.status === "Completed") {
        triggerConfettiCelebration();
      }

      closeDepositModal();
      await refreshDashboard();
    } else {
      showToast(res.message || "Failed to add deposit", "error");
    }
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = "Deposit Contribution";
  }
}

// Goal Deletion
async function confirmDeleteGoal(id, name) {
  if (confirm(`Are you sure you want to delete the goal "${name}"? This action cannot be undone.`)) {
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

// AI Insights Modal
async function openAIInsightsModal(goalId) {
  const goal = AppState.goals.find(g => g.id === goalId);
  if (!goal) return;
  AppState.currentGoalForAI = goal;

  document.getElementById("aiGoalTitle").textContent = goal.goalName;
  document.getElementById("aiSourceBadge").textContent = "Analyzing with Groq AI...";
  document.getElementById("aiContentBox").innerHTML = `
    <div class="spinner-wrap">
      <div class="spinner"></div>
      <p style="color: #38bdf8; font-weight: 600;">Consulting Llama-3.3-70B Financial Strategy Engine...</p>
      <p style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">Evaluating trajectory, expense-trimming hacks & velocity milestones</p>
    </div>
  `;

  document.getElementById("aiModal").classList.add("active");

  try {
    const res = await BackendBridge.requestAIInsights(goal);
    if (res.success) {
      document.getElementById("aiSourceBadge").textContent = res.source || "Groq Cloud (Llama-3.3-70B)";
      document.getElementById("aiContentBox").innerHTML = parseMarkdownToHtml(res.recommendation);
    } else {
      document.getElementById("aiContentBox").innerHTML = `<p style="color: #f87171;">Failed to generate AI insights: ${res.message}</p>`;
    }
  } catch (err) {
    document.getElementById("aiContentBox").innerHTML = `<p style="color: #f87171;">Error: ${err.message}</p>`;
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
    showToast("AI Advice copied to clipboard!", "success");
  });
}

// Simple Markdown Parser for AI Output
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

  // Wrap list items
  html = html.replace(/(<li>.*?<\/li>)/gms, "<ul>$1</ul>");
  html = html.replace(/<\/ul>\s*<ul>/g, "");
  return html;
}

// Settings Modal
function openSettingsModal() {
  document.getElementById("groqApiKeyInput").value = AppState.groqApiKey;
  document.getElementById("activeBackendModeLabel").textContent = AppState.backendMode.toUpperCase();
  document.getElementById("settingsModal").classList.add("active");
}

function closeSettingsModal() {
  document.getElementById("settingsModal").classList.remove("active");
}

function saveSettings() {
  const key = document.getElementById("groqApiKeyInput").value.trim();
  AppState.groqApiKey = key;
  localStorage.setItem("saveiq_groq_key", key);

  if (AppState.backendMode === "gas") {
    google.script.run
      .withSuccessHandler(res => {
        showToast("Key saved in Google Apps Script properties!", "success");
      })
      .setGroqApiKey(key);
  }

  showToast("Settings saved successfully!", "success");
  closeSettingsModal();
}

// Daily Audit Trigger Execution
async function runManualAudit() {
  showToast("Triggering automated financial audit...", "info");
  try {
    const res = await BackendBridge.triggerAudit();
    if (res.success) {
      showToast(`Audit complete: ${res.processed} goals scanned, ${res.alertsSent} alert(s) dispatched!`, "success");
      await refreshDashboard();
    } else {
      showToast("Audit failed: " + res.message, "error");
    }
  } catch (err) {
    showToast("Error running audit: " + err.message, "error");
  }
}

// Export to CSV
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

  showToast("CSV report downloaded successfully!", "success");
}

// Print / PDF Export
function printFinancialReport() {
  window.print();
}

// Toast Notifications
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  let icon = "ℹ️";
  if (type === "success") icon = "✅";
  else if (type === "error") icon = "❌";
  else if (type === "warning") icon = "⚠️";

  toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Confetti Micro-Interaction
function triggerConfettiCelebration() {
  const canvas = document.createElement("canvas");
  canvas.style.position = "fixed";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "9999";
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = [];
  const colors = ["#38bdf8", "#818cf8", "#34d399", "#fbbf24", "#f43f5e", "#c084fc"];

  for (let i = 0; i < 120; i++) {
    particles.push({
      x: canvas.width / 2,
      y: canvas.height / 2,
      vx: (Math.random() - 0.5) * 16,
      vy: (Math.random() - 0.7) * 16,
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      vRot: (Math.random() - 0.5) * 10,
      opacity: 1
    });
  }

  let frame = 0;
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;

    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.3; // gravity
      p.rotation += p.vRot;
      p.opacity -= 0.012;

      if (p.opacity > 0) {
        alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(p.opacity, 0);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }
    });

    frame++;
    if (alive && frame < 150) {
      requestAnimationFrame(animate);
    } else {
      canvas.remove();
    }
  }
  requestAnimationFrame(animate);
}

// ==========================================
// INITIALIZATION & EVENT LISTENERS
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
  // Setup listeners for filter buttons
  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      AppState.currentFilter = btn.dataset.filter;
      applyFilterAndRender();
    });
  });

  // Search input
  const searchInput = document.getElementById("searchGoalInput");
  if (searchInput) {
    searchInput.addEventListener("input", e => {
      AppState.searchQuery = e.target.value;
      applyFilterAndRender();
    });
  }

  // Sort selector
  const sortSelect = document.getElementById("sortGoalSelect");
  if (sortSelect) {
    sortSelect.addEventListener("change", e => {
      AppState.sortBy = e.target.value;
      applyFilterAndRender();
    });
  }

  // Live Pacing Preview in Create Form
  ["goalTarget", "goalInitial", "goalDeadline"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", calculateFormPreview);
  });

  // Form Submissions
  const createForm = document.getElementById("createGoalForm");
  if (createForm) createForm.addEventListener("submit", handleCreateGoalSubmit);

  const depositForm = document.getElementById("depositForm");
  if (depositForm) depositForm.addEventListener("submit", handleDepositSubmit);

  // Detect mode & load data
  await BackendBridge.detectMode();
  await refreshDashboard();
});
