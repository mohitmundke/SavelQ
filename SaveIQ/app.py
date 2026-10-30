"""
SaveIQ – AI Savings Goal Tracker
FastAPI Backend & Microservices Architecture

Architectural Components (as defined in System Architecture):
- Web Frontend (HTML, CSS, JavaScript)
- FastAPI Backend (Python)
- Database: PostgreSQL / Supabase with SQLite offline fallback
- AI Engine: Groq API (Llama-3.3-70B) & OpenAI (GPT-4o-mini)
- PDF Generation Service: ReportLab Financial Statement Engine
- Financial Dashboard & Goal Tracking (JSON Response)
"""

import os
import io
import json
import sqlite3
import datetime
from typing import Optional, List, Tuple, Any
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse, FileResponse
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# Load Environment Variables from .env
load_dotenv()

# ==============================================================================
# AI ENGINE CONFIGURATION (Groq Cloud & OpenAI)
# ==============================================================================
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

GROQ_MODEL = "llama-3.3-70b-versatile"
OPENAI_MODEL = "gpt-4o-mini"

groq_client = None
if GROQ_API_KEY:
    try:
        from groq import Groq
        groq_client = Groq(api_key=GROQ_API_KEY)
    except Exception as e:
        print(f"[SaveIQ AI] Groq init notice: {e}")

openai_client = None
if OPENAI_API_KEY:
    try:
        from openai import OpenAI
        openai_client = OpenAI(api_key=OPENAI_API_KEY)
    except Exception as e:
        print(f"[SaveIQ AI] OpenAI init notice: {e}")

# ==============================================================================
# DATABASE SERVICE (PostgreSQL / Supabase with SQLite fallback)
# ==============================================================================
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
DB_PATH = os.path.join(os.path.dirname(__file__), "saveiq.db")

def get_db_connection() -> Tuple[Any, str]:
    """Returns database connection and engine type ('postgres' or 'sqlite')."""
    if DATABASE_URL and ("postgres" in DATABASE_URL or "postgresql" in DATABASE_URL):
        try:
            import psycopg2
            conn = psycopg2.connect(DATABASE_URL)
            return conn, "postgres"
        except Exception as e:
            print(f"[SaveIQ DB] Supabase/PostgreSQL connection failed ({e}). Reverting to SQLite.")
    
    conn = sqlite3.connect(DB_PATH)
    return conn, "sqlite"

def execute_db(sql: str, params: tuple = (), fetch: str = "none", commit: bool = False):
    """Executes a query agnostic to SQLite or PostgreSQL."""
    conn, engine = get_db_connection()
    cursor = conn.cursor()
    if engine == "postgres":
        sql = sql.replace("?", "%s")
    
    cursor.execute(sql, params)
    data = None
    if fetch == "all":
        data = cursor.fetchall()
    elif fetch == "one":
        data = cursor.fetchone()
    
    if commit:
        conn.commit()
    conn.close()
    return data

def init_db():
    """Initializes tables in either PostgreSQL / Supabase or SQLite."""
    conn, engine = get_db_connection()
    cursor = conn.cursor()
    if engine == "postgres":
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS goals (
                id VARCHAR(64) PRIMARY KEY,
                goal_name TEXT NOT NULL,
                target_amount DOUBLE PRECISION NOT NULL DEFAULT 0.0,
                saved_amount DOUBLE PRECISION NOT NULL DEFAULT 0.0,
                deadline VARCHAR(32) NOT NULL,
                purpose VARCHAR(64) NOT NULL,
                created_at VARCHAR(32) NOT NULL,
                email VARCHAR(255),
                alert_sent VARCHAR(64) DEFAULT 'No'
            );
        """)
    else:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS goals (
                id TEXT PRIMARY KEY,
                goal_name TEXT NOT NULL,
                target_amount REAL NOT NULL,
                saved_amount REAL NOT NULL DEFAULT 0,
                deadline TEXT NOT NULL,
                purpose TEXT NOT NULL,
                created_at TEXT NOT NULL,
                email TEXT,
                alert_sent TEXT DEFAULT 'No'
            );
        """)
    conn.commit()
    conn.close()

init_db()

# ==============================================================================
# PYDANTIC SCHEMAS
# ==============================================================================
class GoalCreate(BaseModel):
    goalName: str = Field(..., description="Name of the savings goal")
    targetAmount: float = Field(..., gt=0, description="Target savings amount in dollars")
    initialSavings: Optional[float] = Field(0.0, ge=0, description="Initial deposited amount")
    deadline: str = Field(..., description="Target completion deadline YYYY-MM-DD")
    purpose: Optional[str] = Field("General Savings", description="Category or purpose")
    email: Optional[str] = Field("", description="Alert email address")

class SavingsDeposit(BaseModel):
    amount: float = Field(..., gt=0, description="Deposit contribution amount")

class AIRequest(BaseModel):
    goal_id: str
    provider: Optional[str] = "groq" # "groq" or "openai"
    api_key: Optional[str] = ""

# ==============================================================================
# FINANCIAL REASONING & METRICS ENGINE
# ==============================================================================
def calculate_goal_metrics(row):
    gid, name, target, saved, deadline_str, purpose, created_at, email, alert_sent = row
    target = max(float(target), 0.0)
    saved = max(float(saved), 0.0)
    remaining = max(round(target - saved, 2), 0.0)

    progress = round((saved / target) * 100, 1) if target > 0 else 0.0
    progress = min(progress, 100.0)

    # Deadline & Days Left calculation
    try:
        deadline_date = datetime.datetime.strptime(deadline_str[:10], "%Y-%m-%d").date()
        today = datetime.date.today()
        days_left = (deadline_date - today).days
    except Exception:
        days_left = 30

    if saved >= target:
        status = "Completed"
    elif days_left < 0:
        status = "Overdue"
    else:
        status = "Active"

    daily_req = 0.0
    weekly_req = 0.0
    if status == "Active" and days_left > 0 and remaining > 0:
        daily_req = round(remaining / days_left, 2)
        weekly_req = round(remaining / (days_left / 7), 2)

    return {
        "id": gid,
        "goalName": name,
        "targetAmount": target,
        "savedAmount": saved,
        "remainingAmount": remaining,
        "progressPercent": progress,
        "deadline": deadline_str[:10],
        "daysLeft": days_left,
        "status": status,
        "purpose": purpose,
        "createdAt": created_at,
        "email": email or "",
        "alertSent": alert_sent or "No",
        "dailyRequired": daily_req,
        "weeklyRequired": weekly_req
    }

# ==============================================================================
# FASTAPI APPLICATION & MIDDLEWARE
# ==============================================================================
app = FastAPI(
    title="SaveIQ – AI Savings Goal Tracker API",
    description="Microservices backend implementing AI Engine (OpenAI/Groq), Database (Postgres/SQLite), and PDF Reporting (ReportLab).",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==============================================================================
# API ENDPOINTS: GOALS CRUD
# ==============================================================================
@app.get("/api/goals")
def get_goals():
    rows = execute_db("SELECT * FROM goals ORDER BY created_at DESC", fetch="all")
    goals = [calculate_goal_metrics(r) for r in (rows or [])]
    return {"success": True, "goals": goals}

@app.post("/api/goals")
def create_goal(goal: GoalCreate):
    import uuid
    gid = "GID-" + str(uuid.uuid4())[:8].upper()
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    execute_db("""
        INSERT INTO goals (id, goal_name, target_amount, saved_amount, deadline, purpose, created_at, email, alert_sent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (gid, goal.goalName, goal.targetAmount, goal.initialSavings, goal.deadline, goal.purpose, now_str, goal.email, "No"), commit=True)

    row = execute_db("SELECT * FROM goals WHERE id = ?", (gid,), fetch="one")
    return {"success": True, "goal": calculate_goal_metrics(row)}

@app.post("/api/goals/{goal_id}/savings")
def update_savings(goal_id: str, deposit: SavingsDeposit):
    row = execute_db("SELECT * FROM goals WHERE id = ?", (goal_id,), fetch="one")
    if not row:
        raise HTTPException(status_code=404, detail="Goal not found")

    new_saved = row[3] + deposit.amount
    alert_sent = "Completed" if new_saved >= row[2] else row[8]

    execute_db("UPDATE goals SET saved_amount = ?, alert_sent = ? WHERE id = ?", (new_saved, alert_sent, goal_id), commit=True)
    updated_row = execute_db("SELECT * FROM goals WHERE id = ?", (goal_id,), fetch="one")

    return {
        "success": True,
        "message": f"Deposited ${deposit.amount:.2f} successfully!",
        "goal": calculate_goal_metrics(updated_row)
    }

@app.delete("/api/goals/{goal_id}")
def delete_goal(goal_id: str):
    execute_db("DELETE FROM goals WHERE id = ?", (goal_id,), commit=True)
    return {"success": True, "message": "Goal deleted successfully"}

# ==============================================================================
# API ENDPOINTS: FINANCIAL DASHBOARD ANALYTICS (JSON RESPONSE)
# ==============================================================================
@app.get("/api/dashboard/stats")
def get_dashboard_stats():
    rows = execute_db("SELECT * FROM goals", fetch="all") or []
    goals = [calculate_goal_metrics(r) for r in rows]

    total_target = sum(g["targetAmount"] for g in goals)
    total_saved = sum(g["savedAmount"] for g in goals)
    total_remaining = max(round(total_target - total_saved, 2), 0.0)
    overall_progress = round((total_saved / total_target) * 100, 1) if total_target > 0 else 0.0

    active = sum(1 for g in goals if g["status"] == "Active")
    completed = sum(1 for g in goals if g["status"] == "Completed")
    overdue = sum(1 for g in goals if g["status"] == "Overdue")

    return {
        "success": True,
        "totalGoals": len(goals),
        "totalTarget": round(total_target, 2),
        "totalSaved": round(total_saved, 2),
        "totalRemaining": total_remaining,
        "overallProgress": min(overall_progress, 100.0),
        "activeGoals": active,
        "completedGoals": completed,
        "overdueGoals": overdue
    }

# ==============================================================================
# API ENDPOINTS: AI ENGINE (OpenAI & Groq API Integration)
# ==============================================================================
@app.post("/api/ai/insights")
def get_ai_insights(req: AIRequest):
    row = execute_db("SELECT * FROM goals WHERE id = ?", (req.goal_id,), fetch="one")
    if not row:
        raise HTTPException(status_code=404, detail="Goal not found")

    goal = calculate_goal_metrics(row)

    prompt = f"""
SAVINGS TARGET PROFILE:
- Goal Name: {goal['goalName']} ({goal['purpose']})
- Target Capital: ${goal['targetAmount']:,.2f}
- Current Capital: ${goal['savedAmount']:,.2f} ({goal['progressPercent']}%)
- Remaining Capital: ${goal['remainingAmount']:,.2f}
- Deadline: {goal['deadline']} ({goal['daysLeft']} days remaining)
- Status: {goal['status']}
- Required Velocity: ${goal['dailyRequired']:.2f}/day (${goal['weeklyRequired']:.2f}/week)

Deliver an executive personal finance strategic plan in clean markdown:
### 1. Velocity & Pacing Assessment
Evaluate feasibility based on the timeline and remaining capital.

### 2. Structured Contribution Milestones
Recommended weekly deposit cadence with an automated transfer schedule.

### 3. High-Impact Expense Levers ({goal['purpose']})
Three concrete lifestyle or budgetary levers to immediately accelerate this goal.

### 4. Behavioral Discipline Protocol
Specific friction tactic or automation rule to prevent milestone deviation.
"""

    # Check for client-provided API key or environment keys
    active_key = req.api_key or ""
    provider = (req.provider or "groq").lower()

    # Route 1: OpenAI Engine
    if provider == "openai" or active_key.startswith("sk-") or (not GROQ_API_KEY and OPENAI_API_KEY):
        try:
            from openai import OpenAI
            client = OpenAI(api_key=active_key if active_key.startswith("sk-") else OPENAI_API_KEY)
            res = client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=[
                    {"role": "system", "content": "You are a senior quantitative financial planner. Provide concise, high-value, realistic savings strategies without generic platitudes."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.6,
                max_tokens=900
            )
            return {
                "success": True,
                "isFallback": False,
                "source": f"OpenAI ({OPENAI_MODEL})",
                "recommendation": res.choices[0].message.content,
                "goal": goal
            }
        except Exception as e:
            print(f"[OpenAI Engine Error] {e}")

    # Route 2: Groq Cloud Engine (Llama-3.3-70B)
    if provider == "groq" or active_key.startswith("gsk_") or GROQ_API_KEY:
        try:
            from groq import Groq
            client = Groq(api_key=active_key if active_key.startswith("gsk_") else GROQ_API_KEY)
            res = client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[
                    {"role": "system", "content": "You are an executive personal finance advisor. Deliver concise, high-value, practical financial recommendations without conversational filler."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.6,
                max_tokens=900
            )
            return {
                "success": True,
                "isFallback": False,
                "source": f"Groq Cloud ({GROQ_MODEL})",
                "recommendation": res.choices[0].message.content,
                "goal": goal
            }
        except Exception as e:
            print(f"[Groq Engine Error] {e}")

    # Route 3: Deterministic Financial Heuristic Fallback
    heuristic = f"""### Velocity & Pacing Assessment
- **Funded:** ${goal['savedAmount']:,.2f} of ${goal['targetAmount']:,.2f} ({goal['progressPercent']}%)
- **Outstanding:** ${goal['remainingAmount']:,.2f}
- **Horizon:** {goal['deadline']} ({goal['daysLeft']} days remaining)

### Structured Contribution Milestones
- **Daily Pace:** **${goal['dailyRequired']:.2f} / day**
- **Weekly Milestone:** **${goal['weeklyRequired']:.2f} / week**

### High-Impact Expense Levers ({goal['purpose']})
1. **Automated Payday Sweep:** Schedule an automated transfer of ${goal['weeklyRequired']:.2f} on each payday before discretionary spending occurs.
2. **Subscription Audit:** Cancel recurring low-usage digital subscriptions and redirect monthly savings into this goal balance.
3. **The 48-Hour Purchase Filter:** For discretionary purchases exceeding $50, enforce a 48-hour delay; deposit the unspent amount if the urge passes.

### Behavioral Discipline Protocol
Lock savings into a dedicated high-yield account with withdrawal friction to eliminate impulsive liquidations."""

    return {
        "success": True,
        "isFallback": True,
        "source": "SaveIQ Financial Planning Engine",
        "recommendation": heuristic,
        "goal": goal
    }

# ==============================================================================
# API ENDPOINTS: PDF GENERATION SERVICE (ReportLab)
# ==============================================================================
@app.get("/api/reports/pdf")
def generate_pdf_report():
    """Generates an executive PDF financial statement using ReportLab."""
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib import colors

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter, rightMargin=36, leftMargin=36, topMargin=36, bottomMargin=36)
        elements = []
        styles = getSampleStyleSheet()

        title_style = ParagraphStyle(
            'TitleStyle',
            parent=styles['Heading1'],
            fontSize=20,
            textColor=colors.HexColor('#0f172a'),
            spaceAfter=6
        )

        sub_style = ParagraphStyle(
            'SubStyle',
            parent=styles['Normal'],
            fontSize=10,
            textColor=colors.HexColor('#64748b'),
            spaceAfter=14
        )

        elements.append(Paragraph("SaveIQ – Portfolio & Savings Goal Audit Statement", title_style))
        elements.append(Paragraph(f"Generated on {datetime.datetime.now().strftime('%B %d, %Y at %I:%M %p')} | Source: SaveIQ Microservices", sub_style))

        # Goals Table
        rows = execute_db("SELECT * FROM goals", fetch="all") or []
        goals = [calculate_goal_metrics(r) for r in rows]

        table_data = [["Goal Name", "Category", "Target ($)", "Saved ($)", "Progress", "Deadline", "Status"]]
        for g in goals:
            table_data.append([
                g['goalName'],
                g['purpose'],
                f"${g['targetAmount']:,.2f}",
                f"${g['savedAmount']:,.2f}",
                f"{g['progressPercent']}%",
                g['deadline'],
                g['status']
            ])

        t = Table(table_data, colWidths=[130, 85, 65, 65, 55, 70, 70])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0b0d13')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#38bdf8')),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
            ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f8fafc')),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#cbd5e1')),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
        ]))

        elements.append(t)
        doc.build(elements)
        buffer.seek(0)

        return StreamingResponse(
            buffer,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=SaveIQ_Statement_{datetime.date.today()}.pdf"}
        )
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"PDF generation service error: {str(e)}"})

# ==============================================================================
# API ENDPOINTS: AUDIT & ALERT SERVICE
# ==============================================================================
@app.post("/api/audit/trigger")
def run_audit():
    rows = execute_db("SELECT * FROM goals", fetch="all") or []
    today_str = datetime.date.today().strftime("%Y-%m-%d")
    alerted = []

    for r in rows:
        g = calculate_goal_metrics(r)
        if g["status"] != "Completed" and g["email"]:
            is_approaching = 0 <= g["daysLeft"] <= 7
            is_overdue = g["status"] == "Overdue"
            already_alerted = today_str in str(g["alertSent"])

            if (is_approaching or is_overdue) and not already_alerted:
                execute_db("UPDATE goals SET alert_sent = ? WHERE id = ?", (f"Sent on {today_str}", g["id"]), commit=True)
                alerted.append(f"Alert recorded for {g['email']} regarding '{g['goalName']}' ({g['daysLeft']}d left)")

    return {
        "success": True,
        "processed": len(rows),
        "alertsSent": len(alerted),
        "logs": alerted
    }

# ==============================================================================
# STATIC WEB ASSET & UI SERVING
# ==============================================================================
static_dir = os.path.dirname(__file__)

@app.get("/styles.css")
def serve_styles():
    css_path = os.path.join(static_dir, "styles.css")
    if os.path.exists(css_path):
        return FileResponse(css_path, media_type="text/css")
    raise HTTPException(status_code=404, detail="styles.css not found")

@app.get("/script.js")
def serve_script():
    js_path = os.path.join(static_dir, "script.js")
    if os.path.exists(js_path):
        return FileResponse(js_path, media_type="application/javascript")
    raise HTTPException(status_code=404, detail="script.js not found")

@app.get("/assets/{path:path}")
def serve_assets(path: str):
    asset_path = os.path.join(static_dir, "assets", path)
    if os.path.exists(asset_path):
        return FileResponse(asset_path)
    raise HTTPException(status_code=404, detail="Asset not found")

@app.get("/", response_class=HTMLResponse)
@app.get("/index.html", response_class=HTMLResponse)
@app.get("/Index.html", response_class=HTMLResponse)
def serve_index():
    for name in ["index.html", "Index.html"]:
        index_path = os.path.join(static_dir, name)
        if os.path.exists(index_path):
            with open(index_path, "r", encoding="utf-8") as f:
                return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>SaveIQ Backend Running</h1>")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
