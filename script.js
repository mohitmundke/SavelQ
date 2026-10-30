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
    overdueGoals: 0
  },
  currentGoalForDeposit: null,
  currentGoalForAI: null,
  aiProvider: localStorage.getItem("saveiq_ai_provider") || "groq",
  groqApiKey: localStorage.getItem("saveiq_groq_key") || "",
  openaiApiKey: localStorage.getItem("saveiq_openai_key") || "",
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
      // Standalone browser mode
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
      const model = isOAI ? "gpt-4o-mini" : "llama-3.3-70b-versatile";

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + apiKey
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: "system",
              content: "You are an executive personal finance advisor. Deliver concise, high-value, practical financial recommendations without conversational filler."
            },
            { role: "user", content: prompt }
          ],
          temperature: 0.6,
          max_tokens: 900
        })
      });

      if (!response.ok) throw new Error("Groq API error " + response.status);

      const json = await response.json();
      return {
        success: true,
        isFallback: false,
        source: "Groq Llama-3.3-70B",
        recommendation: json.choices[0].message.content
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
          .dailyAuditTrigger();
      } else if (AppState.backendMode === "fastapi") {
        fetch("/api/audit/trigger", { method: "POST" })
          .then(res => res.json())
          .then(data => resolve(data))
          .catch(err => reject(err));
      } else {
        const goals = AppState.goals;
        const alerted = goals.filter(g => (g.daysLeft <= 7 || g.status === "Overdue") && g.status !== "Completed");
        resolve({
          success: true,
          processed: goals.length,
          alertsSent: alerted.length,
          logs: alerted.map(g => `Audit verified: "${g.goalName}" (${g.daysLeft}d left)`)
        });
      }
    });
  }
};

// ==========================================
// FINANCIAL CALCULATIONS & HEURISTICS
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
  return `### Progress Summary
- **Funded:** $${goal.savedAmount.toLocaleString(undefined, {minimumFractionDigits: 2})} of $${goal.targetAmount.toLocaleString(undefined, {minimumFractionDigits: 2})} (${goal.progressPercent}%)
- **Outstanding:** $${goal.remainingAmount.toLocaleString(undefined, {minimumFractionDigits: 2})}
- **Target Deadline:** ${goal.deadline} (${goal.daysLeft >= 0 ? goal.daysLeft + ' days remaining' : Math.abs(goal.daysLeft) + ' days overdue'})

### Recommended Contribution Schedule
- **Daily Pace:** **$${goal.dailyRequired.toFixed(2)} / day**
- **Weekly Milestone:** **$${goal.weeklyRequired.toFixed(2)} / week**

### Optimization Levers (${goal.purpose})
1. **Automated Payday Allocation:** Transfer $${goal.weeklyRequired.toFixed(2)} automatically the day compensation arrives.
2. **Discretionary Buffer Sweep:** Route any unspent weekly dining or entertainment buffer directly into this target.
3. **The 48-Hour Delay:** Hold off on any unplanned impulse purchases exceeding $30 for 48 hours; transfer unspent funds if desire dissipates.`;
}

function getDemoGoals() {
  const futureDate1 = new Date();
  futureDate1.setDate(futureDate1.getDate() + 45);

  const futureDate2 = new Date();
  futureDate2.setDate(futureDate2.getDate() + 14);

  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 3);

  const demo = [
    {
      id: "GID-DEMO001",
      goalName: "MacBook Pro Setup",
      targetAmount: 2400,
      savedAmount: 1800,
      deadline: futureDate1.toISOString().slice(0, 10),
      purpose: "Tech & Gadgets",
      createdAt: "2026-08-01",
      email: "alex@example.com",
      alertSent: "No"
    },
    {
      id: "GID-DEMO002",
      goalName: "Emergency Reserve",
      targetAmount: 5000,
      savedAmount: 3250,
      deadline: futureDate2.toISOString().slice(0, 10),
      purpose: "Emergency Fund",
      createdAt: "2026-07-15",
      email: "alex@example.com",
      alertSent: "No"
    },
    {
      id: "GID-DEMO003",
      goalName: "Vehicle Maintenance",
      targetAmount: 800,
      savedAmount: 450,
      deadline: pastDate.toISOString().slice(0, 10),
      purpose: "Vehicle & Transport",
      createdAt: "2026-08-10",
      email: "alex@example.com",
      alertSent: "No"
    }
  ];
  localStorage.setItem("saveiq_goals", JSON.stringify(demo));
  return demo;
}

// ==========================================
// UI RENDERING & DATA BINDING
// ==========================================
async function refreshDashboard() {
  const goalsContainer = document.getElementById("goalsGrid");
  goalsContainer.innerHTML = `
    <div class="spinner-wrap" style="grid-column: 1 / -1;">
      <div class="spinner"></div>
      <p style="color: var(--text-muted); font-size: 13px;">Loading portfolio...</p>
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
        <h3>Unable to load savings goals</h3>
        <p>${err.message}</p>
        <button class="btn btn-secondary" onclick="refreshDashboard()">Retry</button>
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
  setText("kpiTotalTarget", `$${s.totalTarget.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2})}`);
  setText("kpiTotalSaved", `$${s.totalSaved.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2})}`);
  setText("kpiOverallProgress", `${s.overallProgress}%`);
  setText("kpiActiveGoals", `${s.activeGoals} active`);
  setText("kpiCompletedGoals", `${s.completedGoals} completed`);
  setText("kpiOverdueGoals", `${s.overdueGoals} overdue`);
  setText("kpiRemainingLabel", `$${s.totalRemaining.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2})} remaining`);

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

  if (AppState.currentFilter !== "all") {
    filtered = filtered.filter(g => g.status.toLowerCase() === AppState.currentFilter.toLowerCase());
  }

  if (AppState.searchQuery.trim() !== "") {
    const q = AppState.searchQuery.toLowerCase();
    filtered = filtered.filter(g =>
      g.goalName.toLowerCase().includes(q) ||
      g.purpose.toLowerCase().includes(q)
    );
  }

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

        <div class="card-meta-row">
          <span class="card-meta-item">Timeline: <strong>${deadlineLabel}</strong></span>
          <span class="card-meta-item pace">Pace: <strong>${paceLabel}</strong></span>
        </div>
      </div>

      <div class="card-actions">
        <button class="btn-card-action primary" onclick="openDepositModal('${g.id}')">
          + Deposit
        </button>
        <button class="btn-card-action" onclick="openAIInsightsModal('${g.id}')">
          Strategy
        </button>
        <button class="btn-card-delete" title="Delete Goal" onclick="confirmDeleteGoal('${g.id}', '${escapeHtml(g.goalName)}')">
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

async function handleDepositSubmit(e) {
  e.preventDefault();
  if (!AppState.currentGoalForDeposit) return;

  const amount = parseFloat(document.getElementById("depositAmountInput").value);
  if (!amount || amount <= 0) {
    showToast("Enter a valid deposit amount", "warning");
    return;
  }

  const btn = document.getElementById("btnConfirmDeposit");
  btn.disabled = true;
  btn.innerHTML = "Processing...";

  try {
    const res = await BackendBridge.addDeposit(AppState.currentGoalForDeposit.id, amount);
    if (res.success) {
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
  if (groqInput) groqInput.value = AppState.groqApiKey || "";

  const openaiInput = document.getElementById("openaiApiKeyInput");
  if (openaiInput) openaiInput.value = AppState.openaiApiKey || "";

  const modeEl = document.getElementById("activeBackendModeLabel");
  if (modeEl) modeEl.textContent = AppState.backendMode.toUpperCase();

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

  // Forms
  const createForm = document.getElementById("createGoalForm");
  if (createForm) createForm.addEventListener("submit", handleCreateGoalSubmit);

  const depositForm = document.getElementById("depositForm");
  if (depositForm) depositForm.addEventListener("submit", handleDepositSubmit);

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
