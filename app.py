import asyncio
import hashlib
import json
import logging
import os
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Literal
from uuid import uuid4

import httpx
import psycopg
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from ai_service import (
    MODEL, OPS_PROMPT_VERSION, PROMPT_VERSION, assess_document,
    assess_ops_review, assess_readiness,
)
from requirements_engine import check_requirements, decide_readiness, requirement_spec


logger = logging.getLogger(__name__)
DATABASE_URL = os.environ["DATABASE_URL"]
INTERNAL_TOKEN = os.environ["INTERNAL_TOKEN"]
N8N_WEBHOOK_TOKEN = os.environ["N8N_WEBHOOK_TOKEN"]
N8N_WEBHOOK_URL = os.environ["N8N_WEBHOOK_URL"]

CAMPAIGN_FIELDS = (
    "profile_type", "category", "title", "story", "goal_amount", "beneficiary",
    "beneficiary_relationship", "fund_usage", "fund_delivery", "travel_purpose",
    "destination",
)


def db():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def initialize_database():
    statements = Path(__file__).with_name("schema.sql").read_text().split(";")
    with db() as conn:
        for statement in statements:
            if statement.strip():
                conn.execute(statement)


def campaign_or_404(conn, campaign_id: str, lock: bool = False) -> dict:
    suffix = " FOR UPDATE" if lock else ""
    row = conn.execute(
        "SELECT * FROM campaigns WHERE id = %s" + suffix, (campaign_id,)
    ).fetchone()
    if not row:
        raise HTTPException(404, "Campaign not found")
    return row


def documents_for(conn, campaign_id: str) -> list[dict]:
    return conn.execute(
        "SELECT * FROM campaign_documents WHERE campaign_id = %s ORDER BY created_at, id",
        (campaign_id,),
    ).fetchall()


def automation_events_for(conn, campaign_id: str) -> list[dict]:
    return conn.execute(
        "SELECT id, step, status, detail, created_at FROM campaign_automation_events "
        "WHERE campaign_id = %s ORDER BY created_at, id", (campaign_id,),
    ).fetchall()


def record_automation_event(conn, campaign_id: str, step: str,
                            status: str = "complete", detail: str = ""):
    conn.execute(
        "INSERT INTO campaign_automation_events (id, campaign_id, step, status, detail) "
        "VALUES (%s,%s,%s,%s,%s)",
        (str(uuid4()), campaign_id, step, status, detail),
    )


def complete_automation_step(conn, campaign_id: str, step: str, detail: str):
    row = conn.execute(
        "SELECT id FROM campaign_automation_events WHERE campaign_id = %s "
        "AND step = %s AND status = 'running' ORDER BY created_at DESC LIMIT 1",
        (campaign_id, step),
    ).fetchone()
    if row:
        conn.execute(
            "UPDATE campaign_automation_events SET status = 'complete', detail = %s "
            "WHERE id = %s", (detail, row["id"]),
        )
    else:
        record_automation_event(conn, campaign_id, step, "complete", detail)


def require_internal(x_internal_token: str | None = Header(default=None)):
    if not x_internal_token or not secrets.compare_digest(x_internal_token, INTERNAL_TOKEN):
        raise HTTPException(401, "Invalid internal token")


class CampaignInput(BaseModel):
    profile_type: Literal["self", "behalf_of_other", "organization"]
    category: Literal[
        "medical", "education", "rent", "travel", "business_product",
        "refugee_asylum", "vehicle", "other",
    ]
    title: str = ""
    story: str = ""
    goal_amount: Decimal = Field(default=Decimal(0), ge=0)
    beneficiary: str = ""
    beneficiary_relationship: str = ""
    fund_usage: str = ""
    fund_delivery: str = ""
    travel_purpose: str = ""
    destination: str = ""


class CampaignUpdate(BaseModel):
    profile_type: Literal["self", "behalf_of_other", "organization"] | None = None
    category: Literal[
        "medical", "education", "rent", "travel", "business_product",
        "refugee_asylum", "vehicle", "other",
    ] | None = None
    title: str | None = None
    story: str | None = None
    goal_amount: Decimal | None = Field(default=None, ge=0)
    beneficiary: str | None = None
    beneficiary_relationship: str | None = None
    fund_usage: str | None = None
    fund_delivery: str | None = None
    travel_purpose: str | None = None
    destination: str | None = None


class DocumentInput(BaseModel):
    document_type: str = Field(min_length=1, max_length=100)
    filename: str = Field(min_length=1, max_length=255)
    extracted_text: str = Field(default="", max_length=100_000)


class ProcessingInput(BaseModel):
    event_id: str
    campaign_version: int = Field(gt=0)


class ReviewActionInput(BaseModel):
    action: Literal["continue_review", "request_more_information", "escalate"]
    note: str = Field(default="", max_length=1000)


def readiness_hash(campaign: dict, documents: list[dict]) -> str:
    source = {key: campaign.get(key) for key in CAMPAIGN_FIELDS}
    source["model"] = MODEL if os.getenv("GEMINI_API_KEY") else "unconfigured"
    return hashlib.sha256(
        json.dumps(source, sort_keys=True, default=str).encode()
    ).hexdigest()


async def get_or_create_readiness(campaign_id: str) -> dict:
    with db() as conn:
        campaign = campaign_or_404(conn, campaign_id)
        documents = documents_for(conn, campaign_id)
        input_hash = readiness_hash(campaign, documents)
        cached = conn.execute(
            "SELECT * FROM readiness_analyses WHERE campaign_id = %s "
            "AND input_hash = %s AND prompt_version = %s",
            (campaign_id, input_hash, PROMPT_VERSION),
        ).fetchone()
        if cached and not (
            os.getenv("GEMINI_API_KEY")
            and cached["semantic_result"].get("status") == "unavailable"
        ):
            return {
                "campaign_id": campaign_id,
                "campaign_version": campaign["version"],
                "requirements": cached["requirements_result"],
                "semantic": cached["semantic_result"],
                "readiness_state": cached["overall_state"],
                "cached": True,
            }

    requirements = check_requirements(campaign, documents)
    try:
        semantic = await assess_readiness(campaign)
    except Exception as exc:
        logger.warning("Semantic readiness unavailable: %s", type(exc).__name__)
        semantic = {"status": "unavailable", "issues": []}
    state = decide_readiness(requirements, semantic)

    with db() as conn:
        current = campaign_or_404(conn, campaign_id, lock=True)
        current_docs = documents_for(conn, campaign_id)
        if readiness_hash(current, current_docs) != input_hash:
            raise HTTPException(409, "Campaign changed during readiness check; retry")
        conn.execute(
            "INSERT INTO readiness_analyses "
            "(id, campaign_id, campaign_version, input_hash, requirements_result, "
            "semantic_result, overall_state, model, prompt_version) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) "
            "ON CONFLICT (campaign_id, input_hash, prompt_version) DO UPDATE SET "
            "semantic_result = EXCLUDED.semantic_result, overall_state = EXCLUDED.overall_state, "
            "model = EXCLUDED.model, created_at = now() "
            "WHERE readiness_analyses.semantic_result->>'status' = 'unavailable'",
            (
                str(uuid4()), campaign_id, current["version"], input_hash,
                Jsonb(requirements), Jsonb(semantic), state,
                MODEL if semantic["status"] == "complete" else None,
                PROMPT_VERSION,
            ),
        )
        row = conn.execute(
            "SELECT * FROM readiness_analyses WHERE campaign_id = %s "
            "AND input_hash = %s AND prompt_version = %s",
            (campaign_id, input_hash, PROMPT_VERSION),
        ).fetchone()
    return {
        "campaign_id": campaign_id,
        "campaign_version": current["version"],
        "requirements": row["requirements_result"],
        "semantic": row["semantic_result"],
        "readiness_state": row["overall_state"],
        "cached": False,
    }


def ops_review_hash(campaign: dict, documents: list[dict], semantic: dict) -> str:
    source = {key: campaign.get(key) for key in CAMPAIGN_FIELDS}
    source["semantic"] = semantic
    source["documents"] = [
        {
            "id": doc["id"], "document_type": doc["document_type"],
            "filename": doc["filename"], "extracted_text": doc["extracted_text"],
            "analysis": doc["analysis"],
        }
        for doc in documents
    ]
    source["model"] = MODEL if os.getenv("GEMINI_API_KEY") else "unconfigured"
    return hashlib.sha256(json.dumps(source, sort_keys=True, default=str).encode()).hexdigest()


def latest_readiness(conn, campaign_id: str) -> dict:
    row = conn.execute(
        "SELECT semantic_result FROM readiness_analyses WHERE campaign_id = %s "
        "AND prompt_version = %s ORDER BY created_at DESC LIMIT 1",
        (campaign_id, PROMPT_VERSION),
    ).fetchone()
    return row["semantic_result"] if row else {"status": "unavailable", "issues": []}


async def get_or_create_ops_review(campaign_id: str) -> dict:
    with db() as conn:
        campaign = campaign_or_404(conn, campaign_id)
        if campaign["status"] not in (
            "initial_review", "ready_for_review", "ready_for_review_with_notes", "submitted"
        ):
            raise HTTPException(409, "Reviewer analysis requires a submitted campaign")
        documents = documents_for(conn, campaign_id)
        semantic = latest_readiness(conn, campaign_id)
        input_hash = ops_review_hash(campaign, documents, semantic)
        cached = conn.execute(
            "SELECT result FROM ops_review_analyses WHERE campaign_id = %s "
            "AND input_hash = %s AND prompt_version = %s",
            (campaign_id, input_hash, OPS_PROMPT_VERSION),
        ).fetchone()
        if cached and not (
            os.getenv("GEMINI_API_KEY") and cached["result"].get("status") == "unavailable"
        ):
            return cached["result"]

    requirements = check_requirements(campaign, documents)
    try:
        result = await assess_ops_review(campaign, requirements, semantic, documents)
    except Exception as exc:
        logger.warning("Detailed reviewer analysis unavailable: %s", type(exc).__name__)
        result = {"status": "unavailable"}
    with db() as conn:
        current = campaign_or_404(conn, campaign_id, lock=True)
        current_docs = documents_for(conn, campaign_id)
        if ops_review_hash(current, current_docs, latest_readiness(conn, campaign_id)) != input_hash:
            raise HTTPException(409, "Campaign material changed during reviewer analysis; retry")
        conn.execute(
            "INSERT INTO ops_review_analyses "
            "(id, campaign_id, input_hash, prompt_version, result) VALUES (%s,%s,%s,%s,%s) "
            "ON CONFLICT (campaign_id, input_hash, prompt_version) DO UPDATE SET "
            "result = EXCLUDED.result, created_at = now() "
            "WHERE ops_review_analyses.result->>'status' = 'unavailable'",
            (str(uuid4()), campaign_id, input_hash, OPS_PROMPT_VERSION, Jsonb(result)),
        )
        saved = conn.execute(
            "SELECT result FROM ops_review_analyses WHERE campaign_id = %s "
            "AND input_hash = %s AND prompt_version = %s",
            (campaign_id, input_hash, OPS_PROMPT_VERSION),
        ).fetchone()
    return saved["result"]


async def dispatch_one_event() -> bool:
    with db() as conn:
        conn.execute(
            "UPDATE submission_events e SET delivered_at = NULL, next_attempt_at = now() "
            "WHERE e.delivered_at < now() - interval '10 minutes' "
            "AND NOT EXISTS (SELECT 1 FROM processing_jobs j WHERE j.event_id = e.event_id "
            "AND (j.status = 'complete' OR (j.status = 'processing' "
            "AND j.lease_until > now())))"
        )
        event = conn.execute(
            "SELECT * FROM submission_events WHERE delivered_at IS NULL "
            "AND next_attempt_at <= now() ORDER BY created_at "
            "LIMIT 1 FOR UPDATE SKIP LOCKED"
        ).fetchone()
        if not event:
            return False
        conn.execute(
            "UPDATE submission_events SET attempts = attempts + 1, "
            "next_attempt_at = now() + interval '30 seconds' WHERE event_id = %s",
            (event["event_id"],),
        )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                N8N_WEBHOOK_URL,
                headers={"X-Workflow-Token": N8N_WEBHOOK_TOKEN},
                json=event["payload"],
            )
            response.raise_for_status()
            if response.status_code != 202:
                raise RuntimeError(f"Unexpected n8n status: {response.status_code}")
    except Exception as exc:
        logger.warning("n8n event delivery failed: %s", type(exc).__name__)
        with db() as conn:
            conn.execute(
                "UPDATE submission_events SET last_error = %s WHERE event_id = %s",
                (str(exc)[:500], event["event_id"]),
            )
        return True
    with db() as conn:
        conn.execute(
            "UPDATE submission_events SET delivered_at = now(), last_error = NULL "
            "WHERE event_id = %s",
            (event["event_id"],),
        )
    return True


async def delivery_loop():
    while True:
        try:
            if not await dispatch_one_event():
                await asyncio.sleep(5)
        except asyncio.CancelledError:
            raise
        except Exception:
            await asyncio.sleep(5)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    initialize_database()
    sender = asyncio.create_task(delivery_loop())
    try:
        yield
    finally:
        sender.cancel()
        try:
            await sender
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Campaign Readiness API", lifespan=lifespan)


@app.get("/requirements")
def get_requirements(profile_type: str, category: str):
    return requirement_spec(profile_type, category)


@app.get("/health")
def health():
    with db() as conn:
        conn.execute("SELECT 1")
    return {"ok": True}


@app.post("/campaigns", status_code=201)
def create_campaign(payload: CampaignInput):
    campaign_id = str(uuid4())
    values = payload.model_dump()
    with db() as conn:
        conn.execute(
            "INSERT INTO campaigns "
            "(id, profile_type, category, title, story, goal_amount, beneficiary, "
            "beneficiary_relationship, fund_usage, fund_delivery, travel_purpose, destination) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (campaign_id, *(values[key] for key in CAMPAIGN_FIELDS)),
        )
    return {"id": campaign_id, "status": "draft", "version": 1}


@app.get("/campaigns")
def list_campaigns():
    with db() as conn:
        return conn.execute(
            "SELECT id, title, category, status, readiness_state, goal_amount, "
            "version, created_at, updated_at FROM campaigns ORDER BY updated_at DESC"
        ).fetchall()


@app.get("/campaigns/{campaign_id}")
def get_campaign(campaign_id: str):
    with db() as conn:
        campaign = campaign_or_404(conn, campaign_id)
        documents = documents_for(conn, campaign_id)
        automation = automation_events_for(conn, campaign_id)
    return {"campaign": campaign, "documents": documents, "automation": automation}


@app.patch("/campaigns/{campaign_id}")
def update_campaign(campaign_id: str, payload: CampaignUpdate):
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No fields to update")
    if any(value is None for value in updates.values()):
        raise HTTPException(422, "Use empty strings to clear text fields")
    from psycopg import sql

    assignments = sql.SQL(", ").join(
        sql.SQL("{} = %s").format(sql.Identifier(key)) for key in updates
    )
    with db() as conn:
        campaign = campaign_or_404(conn, campaign_id, lock=True)
        if campaign["status"] not in ("draft", "action_required"):
            raise HTTPException(409, "This campaign cannot be edited while it is processing or in review")
        conn.execute(
            sql.SQL("UPDATE campaigns SET {}, status = 'draft', readiness_state = NULL, "
                    "submitted_with_warning = FALSE, creator_override_at = NULL, "
                    "version = version + 1, updated_at = now() "
                    "WHERE id = %s").format(assignments),
            (*updates.values(), campaign_id),
        )
    return {"id": campaign_id, "version": campaign["version"] + 1}


@app.post("/campaigns/{campaign_id}/documents", status_code=201)
async def add_document(campaign_id: str, payload: DocumentInput, background: BackgroundTasks):
    document_id = str(uuid4())
    with db() as conn:
        campaign = campaign_or_404(conn, campaign_id, lock=True)
        conn.execute(
            "INSERT INTO campaign_documents "
            "(id, campaign_id, document_type, filename, extracted_text) "
            "VALUES (%s,%s,%s,%s,%s)",
            (document_id, campaign_id, payload.document_type, payload.filename,
             payload.extracted_text),
        )
        if campaign["status"] == "draft":
            conn.execute(
                "UPDATE campaigns SET version = version + 1, updated_at = now() WHERE id = %s",
                (campaign_id,),
            )
    if campaign["status"] in ("submitted", "ready_for_review", "ready_for_review_with_notes"):
        try:
            analysis = {"status": "complete", **await assess_document(campaign, {
                "document_type": payload.document_type,
                "filename": payload.filename,
                "extracted_text": payload.extracted_text,
            })}
        except Exception as exc:
            logger.warning("Post-submission document analysis unavailable: %s", type(exc).__name__)
            analysis = {
                "status": "unavailable",
                "document_type": payload.document_type,
                "stated_subject": "",
                "relevance_to_campaign": "unknown",
                "finding": "Document analysis is unavailable; human review can continue.",
            }
        with db() as conn:
            conn.execute(
                "UPDATE campaign_documents SET analysis = %s, analyzed_at = now() "
                "WHERE id = %s",
                (Jsonb(analysis), document_id),
            )
        background.add_task(get_or_create_ops_review, campaign_id)
    return {
        "id": document_id,
        "campaign_version": campaign["version"] + (campaign["status"] == "draft"),
    }


@app.post("/campaigns/{campaign_id}/check-readiness")
async def check_readiness(campaign_id: str):
    with db() as conn:
        campaign = campaign_or_404(conn, campaign_id)
        if campaign["status"] != "draft":
            raise HTTPException(409, "Readiness check is for drafts only")
        requirements = check_requirements(campaign, documents_for(conn, campaign_id))
        if not requirements["submission_complete"]:
            return {
                "campaign_id": campaign_id,
                "campaign_version": campaign["version"],
                "requirements": requirements,
                "semantic": {"status": "skipped", "issues": []},
                "readiness_state": "NEEDS_IMPROVEMENT",
                "validation_failed": True,
            }
    return await get_or_create_readiness(campaign_id)


@app.post("/campaigns/{campaign_id}/submit")
async def submit_campaign(campaign_id: str, background: BackgroundTasks):
    with db() as conn:
        campaign = campaign_or_404(conn, campaign_id, lock=True)
        if campaign["status"] == "initial_review":
            event = conn.execute(
                "SELECT event_id FROM submission_events WHERE campaign_id = %s "
                "ORDER BY created_at DESC LIMIT 1", (campaign_id,)
            ).fetchone()
            return {"status": "initial_review", "event_id": event["event_id"]}
        if campaign["status"] not in ("draft", "action_required"):
            raise HTTPException(409, "Campaign has already moved to human review")
        requirements = check_requirements(campaign, documents_for(conn, campaign_id))
        if not requirements["submission_complete"]:
            raise HTTPException(422, "Complete the required campaign fields and fix invalid values before submitting")
        event_id = "evt_" + uuid4().hex
        conn.execute(
            "UPDATE campaigns SET status = 'initial_review', submitted_with_warning = FALSE, "
            "creator_override_at = NULL, readiness_state = NULL, updated_at = now() "
            "WHERE id = %s", (campaign_id,),
        )
        event_payload = {
            "type": "CAMPAIGN_SUBMITTED",
            "event_id": event_id,
            "campaign_id": campaign_id,
            "campaign_version": campaign["version"],
            "force_review": False,
        }
        conn.execute(
            "INSERT INTO submission_events "
            "(event_id, campaign_id, campaign_version, payload) VALUES (%s,%s,%s,%s)",
            (event_id, campaign_id, campaign["version"], Jsonb(event_payload)),
        )
        conn.execute(
            "INSERT INTO review_packets (campaign_id, campaign_version, status, packet) "
            "VALUES (%s,%s,'pending',NULL) ON CONFLICT (campaign_id) DO UPDATE SET "
            "campaign_version = EXCLUDED.campaign_version, status = 'pending', "
            "packet = NULL, updated_at = now()",
            (campaign_id, campaign["version"]),
        )
        record_automation_event(
            conn, campaign_id, "submission_received", "complete",
            "Campaign received. Automated initial review has started.",
        )
        record_automation_event(
            conn, campaign_id, "initial_ai_review", "running",
            "Checking campaign clarity and consistency.",
        )
    background.add_task(dispatch_one_event)
    return {
        "status": "initial_review",
        "event_id": event_id,
        "submitted_with_readiness_warning": False,
        "readiness_state": None,
    }


@app.post("/campaigns/{campaign_id}/submit-as-is")
async def submit_campaign_as_is(campaign_id: str, background: BackgroundTasks):
    with db() as conn:
        campaign = campaign_or_404(conn, campaign_id, lock=True)
        if campaign["status"] != "action_required":
            raise HTTPException(409, "Submit as it is is available after automated suggestions")
        event_id = "evt_" + uuid4().hex
        conn.execute(
            "UPDATE campaigns SET status = 'initial_review', submitted_with_warning = TRUE, "
            "creator_override_at = now(), updated_at = now() WHERE id = %s", (campaign_id,),
        )
        event_payload = {
            "type": "CAMPAIGN_SUBMITTED",
            "event_id": event_id,
            "campaign_id": campaign_id,
            "campaign_version": campaign["version"],
            "force_review": True,
        }
        conn.execute(
            "INSERT INTO submission_events "
            "(event_id, campaign_id, campaign_version, payload) VALUES (%s,%s,%s,%s)",
            (event_id, campaign_id, campaign["version"], Jsonb(event_payload)),
        )
        conn.execute(
            "UPDATE review_packets SET status = 'pending', packet = NULL, updated_at = now() "
            "WHERE campaign_id = %s", (campaign_id,),
        )
        record_automation_event(
            conn, campaign_id, "creator_override", "complete",
            "Creator reviewed the automated suggestions and submitted without changes.",
        )
    background.add_task(dispatch_one_event)
    return {"status": "initial_review", "event_id": event_id}


@app.get("/campaigns/{campaign_id}/readiness")
def creator_readiness(campaign_id: str):
    with db() as conn:
        campaign = campaign_or_404(conn, campaign_id)
        documents = documents_for(conn, campaign_id)
        analysis = conn.execute(
            "SELECT * FROM readiness_analyses WHERE campaign_id = %s "
            "ORDER BY created_at DESC LIMIT 1", (campaign_id,),
        ).fetchone()
    if not analysis:
        raise HTTPException(404, "No readiness analysis yet")
    if campaign["status"] == "draft" and analysis["input_hash"] != readiness_hash(campaign, documents):
        raise HTTPException(409, "Readiness analysis is stale; run check-readiness")
    mismatch = any(
        (doc["analysis"] or {}).get("relevance_to_campaign") == "low"
        for doc in documents
    )
    return {
        "readiness_state": campaign["readiness_state"] or analysis["overall_state"],
        "requirements": (
            check_requirements(campaign, documents)
            if campaign["status"] != "draft" else analysis["requirements_result"]
        ),
        "semantic_status": analysis["semantic_result"].get("status"),
        "improvement_suggestions": [
            issue.get("feedback", "")
            for issue in analysis["semantic_result"].get("issues", [])
            if issue.get("feedback")
        ],
        "document_feedback": (
            "Some supporting material does not appear to align with the stated "
            "purpose. Please review the material you added."
            if mismatch else None
        ),
    }


def verified_job(conn, campaign_id: str, payload: ProcessingInput) -> dict:
    event = conn.execute(
        "SELECT * FROM submission_events WHERE event_id = %s AND campaign_id = %s "
        "AND campaign_version = %s",
        (payload.event_id, campaign_id, payload.campaign_version),
    ).fetchone()
    if not event:
        raise HTTPException(409, "Event does not match campaign/version")
    campaign = campaign_or_404(conn, campaign_id)
    if campaign["status"] not in (
        "initial_review", "action_required", "ready_for_review",
        "ready_for_review_with_notes", "submitted",
    ) or campaign["version"] != payload.campaign_version:
        raise HTTPException(409, "Campaign version is not submitted")
    job = conn.execute(
        "SELECT * FROM processing_jobs WHERE event_id = %s", (payload.event_id,)
    ).fetchone()
    if not job or job["status"] not in ("processing", "complete"):
        raise HTTPException(409, "Processing job has not been claimed")
    return campaign


@app.post("/internal/campaigns/{campaign_id}/claim-processing", dependencies=[Depends(require_internal)])
def claim_processing(campaign_id: str, payload: ProcessingInput):
    with db() as conn:
        campaign = campaign_or_404(conn, campaign_id, lock=True)
        event = conn.execute(
            "SELECT * FROM submission_events WHERE event_id = %s AND campaign_id = %s "
            "AND campaign_version = %s",
            (payload.event_id, campaign_id, payload.campaign_version),
        ).fetchone()
        if not event or campaign["status"] != "initial_review" or campaign["version"] != payload.campaign_version:
            raise HTTPException(409, "Event does not match submitted campaign")
        job = conn.execute(
            "SELECT * FROM processing_jobs WHERE event_id = %s FOR UPDATE",
            (payload.event_id,),
        ).fetchone()
        if job and (job["status"] == "complete" or
                    (job["lease_until"] and job["lease_until"] > datetime.now(timezone.utc))):
            return {"should_process": False, "needs_document_analysis": False}
        if job:
            conn.execute(
                "UPDATE processing_jobs SET status = 'processing', "
                "lease_until = now() + interval '5 minutes', attempts = attempts + 1, "
                "updated_at = now() WHERE event_id = %s", (payload.event_id,),
            )
        else:
            conn.execute(
                "INSERT INTO processing_jobs (event_id, status, lease_until) "
                "VALUES (%s, 'processing', now() + interval '5 minutes')",
                (payload.event_id,),
            )
        pending = conn.execute(
            "SELECT 1 FROM campaign_documents WHERE campaign_id = %s "
            "AND analyzed_at IS NULL LIMIT 1", (campaign_id,),
        ).fetchone()
    return {"should_process": True, "needs_document_analysis": bool(pending)}


@app.post("/internal/campaigns/{campaign_id}/analyze-documents", dependencies=[Depends(require_internal)])
async def analyze_documents(campaign_id: str, payload: ProcessingInput):
    with db() as conn:
        campaign = verified_job(conn, campaign_id, payload)
        pending = conn.execute(
            "SELECT * FROM campaign_documents WHERE campaign_id = %s "
            "AND analyzed_at IS NULL ORDER BY created_at, id", (campaign_id,),
        ).fetchall()
    count = 0
    for document in pending:
        try:
            result = {"status": "complete", **await assess_document(campaign, document)}
        except Exception as exc:
            logger.warning("Document analysis unavailable: %s", type(exc).__name__)
            result = {
                "status": "unavailable",
                "document_type": document["document_type"],
                "stated_subject": "",
                "relevance_to_campaign": "unknown",
                "finding": "Document analysis is unavailable; human review can continue.",
            }
        with db() as conn:
            conn.execute(
                "UPDATE campaign_documents SET analysis = %s, analyzed_at = now() "
                "WHERE id = %s AND analyzed_at IS NULL",
                (Jsonb(result), document["id"]),
            )
        count += 1
    return {"analyzed_documents": count}


@app.post("/internal/campaigns/{campaign_id}/final-analysis", dependencies=[Depends(require_internal)])
async def final_analysis(campaign_id: str, payload: ProcessingInput):
    with db() as conn:
        verified_job(conn, campaign_id, payload)
    readiness = await get_or_create_readiness(campaign_id)
    with db() as conn:
        campaign = campaign_or_404(conn, campaign_id, lock=True)
        event = conn.execute(
            "SELECT payload FROM submission_events WHERE event_id = %s",
            (payload.event_id,),
        ).fetchone()
        force_review = bool((event["payload"] or {}).get("force_review"))
        conn.execute(
            "UPDATE campaigns SET readiness_state = %s, updated_at = now() WHERE id = %s",
            (readiness["readiness_state"], campaign_id),
        )
        if not force_review:
            complete_automation_step(
                conn, campaign_id, "initial_ai_review",
                "Automated clarity review completed.",
            )
        if readiness["readiness_state"] != "READY_FOR_REVIEW" and not force_review:
            conn.execute(
                "UPDATE campaigns SET status = 'action_required', updated_at = now() "
                "WHERE id = %s", (campaign_id,),
            )
            conn.execute(
                "UPDATE review_packets SET status = 'awaiting_creator', updated_at = now() "
                "WHERE campaign_id = %s", (campaign_id,),
            )
            conn.execute(
                "UPDATE processing_jobs SET status = 'complete', lease_until = NULL, "
                "updated_at = now() WHERE event_id = %s", (payload.event_id,),
            )
            record_automation_event(
                conn, campaign_id, "clarification_requested", "action_required",
                "Automated suggestions are ready for the creator.",
            )
            return {
                **readiness,
                "continue_to_packet": False,
                "campaign_status": "action_required",
                "ops_review_status": "not_run",
            }
        record_automation_event(
            conn, campaign_id, "detailed_reviewer_analysis", "running",
            "Preparing deeper campaign and completeness findings.",
        )
    ops_review = await get_or_create_ops_review(campaign_id)
    with db() as conn:
        complete_automation_step(
            conn, campaign_id, "detailed_reviewer_analysis",
            "Detailed campaign and completeness analysis completed.",
        )
    return {
        **readiness,
        "continue_to_packet": True,
        "campaign_status": "initial_review",
        "ops_review_status": ops_review["status"],
    }


@app.post("/internal/campaigns/{campaign_id}/build-review-packet", dependencies=[Depends(require_internal)])
def build_review_packet(campaign_id: str, payload: ProcessingInput):
    with db() as conn:
        campaign = verified_job(conn, campaign_id, payload)
        if campaign["status"] == "action_required":
            return {"packet_ready": False, "awaiting_creator": True, "cached": False}
        existing = conn.execute(
            "SELECT * FROM review_packets WHERE campaign_id = %s FOR UPDATE",
            (campaign_id,),
        ).fetchone()
        if existing and existing["status"] == "ready":
            return {"packet_ready": True, "cached": True}
        documents = documents_for(conn, campaign_id)
        if any(doc["analyzed_at"] is None for doc in documents):
            raise HTTPException(409, "Document processing is incomplete")
        input_hash = readiness_hash(campaign, documents)
        analysis = conn.execute(
            "SELECT * FROM readiness_analyses WHERE campaign_id = %s "
            "AND input_hash = %s AND prompt_version = %s",
            (campaign_id, input_hash, PROMPT_VERSION),
        ).fetchone()
        if not analysis:
            raise HTTPException(409, "Final analysis is missing")
        ops_hash = ops_review_hash(campaign, documents, latest_readiness(conn, campaign_id))
        ops_analysis = conn.execute(
            "SELECT result FROM ops_review_analyses WHERE campaign_id = %s "
            "AND input_hash = %s AND prompt_version = %s",
            (campaign_id, ops_hash, OPS_PROMPT_VERSION),
        ).fetchone()
        if not ops_analysis:
            raise HTTPException(409, "Detailed reviewer analysis is missing")
        mismatch = any(
            (doc["analysis"] or {}).get("relevance_to_campaign") == "low"
            for doc in documents
        )
        packet = {
            "campaign": {
                "id": campaign["id"],
                "title": campaign["title"],
                "profile_type": campaign["profile_type"],
                "category": campaign["category"],
                "goal_amount": str(campaign["goal_amount"]),
                "story": campaign["story"],
                "beneficiary": campaign["beneficiary"],
                "beneficiary_relationship": campaign["beneficiary_relationship"],
                "fund_usage": campaign["fund_usage"],
                "fund_delivery": campaign["fund_delivery"],
            },
            "requirements": check_requirements(campaign, documents),
            "readiness_state": analysis["overall_state"],
            "post_submission_reviewability": (
                "HIGH_FRICTION" if mismatch else analysis["overall_state"]
            ),
            "ops_attention": "POTENTIAL_MATERIAL_MISMATCH" if mismatch else None,
            "semantic": analysis["semantic_result"],
            "ops_review": ops_analysis["result"],
            "documents": [
                {
                    "id": doc["id"], "document_type": doc["document_type"],
                    "filename": doc["filename"], "analysis": doc["analysis"],
                }
                for doc in documents
            ],
            "submitted_with_warning": campaign["submitted_with_warning"],
            "creator_override": {
                "used": bool(campaign["submitted_with_warning"]),
                "at": campaign["creator_override_at"],
                "note": (
                    "Creator submitted without changes after reviewing automated suggestions."
                    if campaign["submitted_with_warning"] else None
                ),
            },
        }
        conn.execute(
            "UPDATE review_packets SET packet = %s, status = 'ready', "
            "updated_at = now() WHERE campaign_id = %s AND campaign_version = %s",
            (Jsonb(packet), campaign_id, payload.campaign_version),
        )
        conn.execute(
            "UPDATE processing_jobs SET status = 'complete', lease_until = NULL, "
            "updated_at = now() WHERE event_id = %s", (payload.event_id,),
        )
        final_status = (
            "ready_for_review_with_notes"
            if campaign["submitted_with_warning"] else "ready_for_review"
        )
        conn.execute(
            "UPDATE campaigns SET status = %s, updated_at = now() WHERE id = %s",
            (final_status, campaign_id),
        )
        record_automation_event(
            conn, campaign_id, "review_packet_ready", "complete",
            (
                "Ready for human review with automated notes."
                if campaign["submitted_with_warning"]
                else "Ready for human review."
            ),
        )
    return {"packet_ready": True, "cached": False}


@app.get("/ops/reviews")
def list_reviews():
    with db() as conn:
        rows = conn.execute(
            "SELECT c.id, c.title, c.category, c.status, c.readiness_state, "
            "c.submitted_with_warning, c.creator_override_at, r.status AS packet_status "
            "FROM campaigns c JOIN review_packets r ON r.campaign_id = c.id "
            "WHERE c.status IN ('submitted', 'ready_for_review', "
            "'ready_for_review_with_notes') ORDER BY c.updated_at DESC"
        ).fetchall()
    return rows


@app.get("/ops/reviews/{campaign_id}")
def get_review(campaign_id: str):
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM review_packets WHERE campaign_id = %s", (campaign_id,)
        ).fetchone()
        campaign = campaign_or_404(conn, campaign_id)
        documents = documents_for(conn, campaign_id)
        actions = conn.execute(
            "SELECT id, action, note, created_at FROM review_actions "
            "WHERE campaign_id = %s ORDER BY created_at DESC, id DESC",
            (campaign_id,),
        ).fetchall()
        ops_hash = ops_review_hash(
            campaign, documents, latest_readiness(conn, campaign_id)
        )
        ops_analysis = conn.execute(
            "SELECT result FROM ops_review_analyses WHERE campaign_id = %s "
            "AND input_hash = %s AND prompt_version = %s",
            (campaign_id, ops_hash, OPS_PROMPT_VERSION),
        ).fetchone()
    if not row:
        raise HTTPException(404, "Review packet not found")
    packet = dict(row["packet"]) if row["packet"] else None
    if packet:
        packet["ops_review"] = (
            ops_analysis["result"] if ops_analysis else {"status": "not_run"}
        )
        packet["requirements"] = check_requirements(campaign, documents)
        packet["documents"] = [
            {
                "id": doc["id"], "document_type": doc["document_type"],
                "filename": doc["filename"], "analysis": doc["analysis"],
            }
            for doc in documents
        ]
        packet["ops_attention"] = (
            "POTENTIAL_MATERIAL_MISMATCH"
            if any((doc["analysis"] or {}).get("relevance_to_campaign") == "low"
                   for doc in documents) else None
        )
        packet["post_submission_reviewability"] = (
            "HIGH_FRICTION" if packet["ops_attention"] else packet["readiness_state"]
        )
    return {**row, "packet": packet, "campaign": campaign,
            "documents": documents, "actions": actions}


@app.post("/ops/reviews/{campaign_id}/refresh-ai")
async def refresh_ops_review(campaign_id: str):
    await get_or_create_readiness(campaign_id)
    return await get_or_create_ops_review(campaign_id)


@app.post("/ops/reviews/{campaign_id}/actions", status_code=201)
def record_review_action(campaign_id: str, payload: ReviewActionInput):
    note = payload.note.strip()
    if payload.action != "continue_review" and not note:
        raise HTTPException(422, "Add a note explaining the request or escalation")
    action_id = str(uuid4())
    with db() as conn:
        campaign = campaign_or_404(conn, campaign_id)
        if campaign["status"] not in (
            "submitted", "ready_for_review", "ready_for_review_with_notes"
        ):
            raise HTTPException(409, "Campaign is not in review")
        conn.execute(
            "INSERT INTO review_actions (id, campaign_id, action, note) "
            "VALUES (%s,%s,%s,%s)",
            (action_id, campaign_id, payload.action, note),
        )
    return {"id": action_id, "action": payload.action, "note": note}
