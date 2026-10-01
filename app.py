"""
SaveIQ – AI Savings Goal Tracker
FastAPI Backend & Microservices Architecture

Features:
- RESTful API for Savings Goals CRUD & Financial Analytics
- Groq Cloud AI Integration (Llama-3.3-70b-versatile)
- Automated Financial Audit & Deadline Alert Simulation
- High-Fidelity PDF Financial Report Generation (ReportLab)
- CORS & Static Web Asset Serving for Standalone Running
"""

import os
import io
import json
import sqlite3
import datetime
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# Load Environment Variables from .env
load_dotenv()

# Initialize Groq Client
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
MODEL_NAME = "llama-3.3-70b-versatile"

groq_client = None
if GROQ_API_KEY:
    try:
        from groq import Groq
        groq_client = Groq(api_key=GROQ_API_KEY)
    except ImportError:
        print("[SaveIQ] groq package not installed. Using heuristic/fallback AI engine.")

# Database Initialization (SQLite)
DB_PATH = os.path.join(os.path.dirname(__file__), "saveiq.db")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
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
        )
    """)
    conn.commit()
    conn.close()

init_db()

# Pydantic Schemas
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

# Helper Functions for Financial Logic
def calculate_goal_metrics(row):
    gid, name, target, saved, deadline_str, purpose, created_at, email, alert_sent = row
    target = max(float(target), 0.0)
    saved = max(float(saved), 0.0)
    remaining = max(round(target - saved, 2), 0.0)

    progress = round((saved / target) * 100, 1) if target > 0 else 0.0
    progress = min(progress, 100.0)

    # Deadline & Days Left
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

# Initialize FastAPI Application
app = FastAPI(
    title="SaveIQ – AI Savings Goal Tracker API",
    description="High-performance backend for personal savings management, Groq AI recommendations, and PDF reporting.",
    version="1.0.0"
)

# Enable CORS for frontend cross-origin requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Routes
@app.get("/api/goals")
def get_goals():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM goals ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()

    goals = [calculate_goal_metrics(row) for row in rows]
    return {"success": True, "goals": goals}

@app.post("/api/goals")
def create_goal(goal: GoalCreate):
    import uuid
    gid = "GID-" + str(uuid.uuid4())[:8].upper()
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO goals (id, goal_name, target_amount, saved_amount, deadline, purpose, created_at, email, alert_sent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (gid, goal.goalName, goal.targetAmount, goal.initialSavings, goal.deadline, goal.purpose, now_str, goal.email, "No"))
    conn.commit()
    cursor.execute("SELECT * FROM goals WHERE id = ?", (gid,))
    row = cursor.fetchone()
    conn.close()

    return {"success": True, "goal": calculate_goal_metrics(row)}

@app.post("/api/goals/{goal_id}/savings")
def update_savings(goal_id: str, deposit: SavingsDeposit):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM goals WHERE id = ?", (goal_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Goal not found")

    new_saved = row[3] + deposit.amount
    alert_sent = "Completed" if new_saved >= row[2] else row[8]

    cursor.execute("UPDATE goals SET saved_amount = ?, alert_sent = ? WHERE id = ?", (new_saved, alert_sent, goal_id))
    conn.commit()
    cursor.execute("SELECT * FROM goals WHERE id = ?", (goal_id,))
    updated_row = cursor.fetchone()
    conn.close()

    return {
        "success": True,
        "message": f"Deposited ${deposit.amount:.2f} successfully!",
        "goal": calculate_goal_metrics(updated_row)
    }

@app.delete("/api/goals/{goal_id}")
def delete_goal(goal_id: str):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM goals WHERE id = ?", (goal_id,))
    conn.commit()
    conn.close()
    return {"success": True, "message": "Goal deleted successfully"}

@app.get("/api/dashboard/stats")
def get_dashboard_stats():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM goals")
    rows = cursor.fetchall()
    conn.close()

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

@app.post("/api/ai/insights")
def get_ai_insights(req: AIRequest):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM goals WHERE id = ?", (req.goal_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Goal not found")

    goal = calculate_goal_metrics(row)

    # If Groq client is configured and available
    if groq_client:
        try:
            prompt = f"""
SAVINGS GOAL PROFILE:
- Goal Name: {goal['goalName']}
- Purpose/Category: {goal['purpose']}
- Target Amount: ${goal['targetAmount']:.2f}
- Saved Amount: ${goal['savedAmount']:.2f} ({goal['progressPercent']}%)
- Remaining Amount: ${goal['remainingAmount']:.2f}
- Deadline: {goal['deadline']} ({goal['daysLeft']} days left)
- Status: {goal['status']}
- Required Daily: ${goal['dailyRequired']:.2f}/day
- Required Weekly: ${goal['weeklyRequired']:.2f}/week

Provide tactical, high-impact financial guidance formatted in crisp markdown with:
1. Feasibility Assessment
2. Pacing & Milestones (Daily & Weekly breakdown)
3. 3 Expense-Trimming Hacks customized for '{goal['purpose']}'
4. Behavioral Psychology Tip for Financial Discipline
"""
            chat_completion = groq_client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": "You are SaveIQ's Senior AI Financial Advisor and Behavioral Economist. Deliver actionable, encouraging, and structured financial intelligence."
                    },
                    {"role": "user", "content": prompt}
                ],
                model=MODEL_NAME,
                temperature=0.7,
                max_tokens=1024
            )
            ai_content = chat_completion.choices[0].message.content
            return {
                "success": True,
                "isFallback": False,
                "source": "Groq Cloud (Llama-3.3-70B)",
                "recommendation": ai_content,
                "goal": goal
            }
        except Exception as e:
            print("[Groq API Error]", e)

    # Heuristic Fallback
    heuristic = f"""### 📊 Financial Progress Assessment: {goal['goalName']}
- **Current Completion:** {goal['progressPercent']}% (${goal['savedAmount']:.2f} of ${goal['targetAmount']:.2f})
- **Remaining Balance:** ${goal['remainingAmount']:.2f}
- **Days Left:** {goal['daysLeft']} days

### 💡 Pacing & Milestone Target
- **Daily Target:** Commit to saving **${goal['dailyRequired']:.2f}** per day.
- **Weekly Milestone:** Deposit **${goal['weeklyRequired']:.2f}** every week.

### ✂️ Tailored Expense-Trimming Strategies ({goal['purpose']})
1. **The 48-Hour Micro-Pause:** Before purchasing discretionary items over $25, pause for 48 hours. If the urge passes, deposit the difference here!
2. **Automated Payday Sweep:** Schedule an automated bank transfer of ${goal['weeklyRequired']:.2f} on payday before discretionary spending occurs.
3. **Audit Recurring Subscriptions:** Review card debits and cancel one unused digital subscription.

### 🚀 Behavioral Motivation
*"Discipline is the bridge between goals and accomplishment."* Stay consistent on SaveIQ!"""

    return {
        "success": True,
        "isFallback": True,
        "source": "SaveIQ Financial Heuristic Engine (Configure GROQ_API_KEY in .env for Llama-3.3-70B)",
        "recommendation": heuristic,
        "goal": goal
    }

@app.post("/api/audit/trigger")
def run_audit():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM goals")
    rows = cursor.fetchall()

    today_str = datetime.date.today().strftime("%Y-%m-%d")
    alerted = []

    for r in rows:
        g = calculate_goal_metrics(r)
        if g["status"] != "Completed" and g["email"]:
            is_approaching = 0 <= g["daysLeft"] <= 7
            is_overdue = g["status"] == "Overdue"
            already_alerted = today_str in str(g["alertSent"])

            if (is_approaching or is_overdue) and not already_alerted:
                # In production with SMTP, send email here
                cursor.execute("UPDATE goals SET alert_sent = ? WHERE id = ?", (f"Sent on {today_str}", g["id"]))
                alerted.append(f"Alert queued for {g['email']} regarding '{g['goalName']}' ({g['daysLeft']}d left)")

    conn.commit()
    conn.close()

    return {
        "success": True,
        "processed": len(rows),
        "alertsSent": len(alerted),
        "logs": alerted
    }

@app.get("/api/reports/pdf")
def generate_pdf_report():
    """Generates a downloadable PDF report matching the architecture diagram."""
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
            fontSize=22,
            textColor=colors.HexColor('#0284c7'),
            spaceAfter=14
        )

        elements.append(Paragraph("SaveIQ – Financial Discipline & Goals Report", title_style))
        elements.append(Paragraph(f"Generated on {datetime.datetime.now().strftime('%B %d, %Y at %I:%M %p')}", styles['Normal']))
        elements.append(Spacer(1, 16))

        # Fetch Goals
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM goals")
        rows = cursor.fetchall()
        conn.close()
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

        t = Table(table_data, colWidths=[120, 90, 65, 65, 55, 75, 65])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0f172a')),
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
            headers={"Content-Disposition": f"attachment; filename=SaveIQ_Report_{datetime.date.today()}.pdf"}
        )
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"PDF generation service error: {str(e)}"})

# Serve Static Assets & Main HTML UI
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
                content = f.read()
                return HTMLResponse(content=content)
    return HTMLResponse(content="<h1>SaveIQ Backend Running</h1>")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
