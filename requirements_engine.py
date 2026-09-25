"""Illustrative MVP rules. Review against the actual policy before production use."""

from typing import Any


REQUIRED_FIELDS = (
    "title",
    "story",
    "beneficiary",
    "beneficiary_relationship",
    "fund_usage",
    "fund_delivery",
)

PROFILE_DOCUMENTS = {
    "self": ("organizer_id", "recent_bank_statement"),
    "behalf_of_other": (
        "organizer_id", "beneficiary_id", "recent_bank_statement"
    ),
    "organization": ("organization_registration", "recent_bank_statement"),
}

CATEGORY_DOCUMENTS = {
    "medical": ("medical_supporting_evidence",),
    "rent": ("signed_rental_agreement",),
    "travel": ("accommodation_invoice", "flight_invoice"),
    "vehicle": ("vehicle_quote_or_purchase_agreement",),
}

CATEGORY_FIELDS = {
    "travel": ("travel_purpose", "destination"),
}

CATEGORY_ONE_OF = {
    "education": ("student_id", "acceptance_letter"),
}


def requirement_spec(profile_type: str, category: str) -> dict:
    required_documents = set(PROFILE_DOCUMENTS.get(profile_type, ()))
    required_documents.update(CATEGORY_DOCUMENTS.get(category, ()))
    return {
        "required_fields": list(REQUIRED_FIELDS) + ["goal_amount"]
        + list(CATEGORY_FIELDS.get(category, ())),
        "required_documents": sorted(required_documents),
        "one_of_documents": list(CATEGORY_ONE_OF.get(category, ())),
    }


def check_requirements(campaign: dict[str, Any], documents: list[dict[str, Any]]) -> dict:
    missing_fields = [
        name for name in REQUIRED_FIELDS if not str(campaign.get(name) or "").strip()
    ]
    if not campaign.get("goal_amount") or float(campaign["goal_amount"]) <= 0:
        missing_fields.append("goal_amount")
    invalid_fields = []
    if len(str(campaign.get("title") or "")) > 100:
        invalid_fields.append("title_max_100")
    missing_fields += [
        name
        for name in CATEGORY_FIELDS.get(campaign.get("category"), ())
        if not str(campaign.get(name) or "").strip()
    ]

    present = {doc["document_type"] for doc in documents}
    required = set(PROFILE_DOCUMENTS.get(campaign.get("profile_type"), ()))
    required.update(CATEGORY_DOCUMENTS.get(campaign.get("category"), ()))
    missing_documents = sorted(required - present)

    one_of = CATEGORY_ONE_OF.get(campaign.get("category"))
    missing_one_of = [list(one_of)] if one_of and not present.intersection(one_of) else []

    return {
        "missing_fields": missing_fields,
        "invalid_fields": invalid_fields,
        "missing_documents": missing_documents,
        "missing_one_of_documents": missing_one_of,
        "submission_complete": not (missing_fields or invalid_fields),
        "documents_complete": not (missing_documents or missing_one_of),
        "requirements_complete": not (missing_fields or invalid_fields or missing_documents or missing_one_of),
    }


def decide_readiness(requirements: dict, semantic: dict) -> str:
    issues = semantic.get("issues", []) if semantic.get("status") == "complete" else []
    if any(item.get("severity") == "critical" for item in issues):
        return "HIGH_FRICTION"
    if not requirements.get("submission_complete", requirements["requirements_complete"]):
        return "NEEDS_IMPROVEMENT"
    if any(item.get("severity") == "medium" for item in issues):
        return "NEEDS_IMPROVEMENT"
    return "READY_FOR_REVIEW"


def score_readiness(requirements: dict, semantic: dict) -> dict:
    """Return a bounded internal score used for routing, never approval."""
    score = 100
    score -= 25 * len(requirements.get("missing_fields", []))
    score -= 15 * len(requirements.get("invalid_fields", []))

    issues = semantic.get("issues", []) if semantic.get("status") == "complete" else []
    issue_penalties = {"critical": 25, "medium": 12, "low": 4}
    score -= sum(issue_penalties.get(item.get("severity"), 0) for item in issues)

    clarity_penalties = {"medium": 2, "low": 5}
    for key in (
        "purpose_clarity", "beneficiary_clarity", "fund_usage_clarity",
        "fund_delivery_clarity", "internal_consistency",
    ):
        score -= clarity_penalties.get(semantic.get(key), 0)

    score = max(0, min(100, score))
    severities = {item.get("severity") for item in issues}
    level = (
        "needs_attention" if "critical" in severities or score < 65 else
        "reviewable" if "medium" in severities or score < 85 else
        "strong"
    )
    return {
        "score": score,
        "level": level,
        "has_critical_issue": any(item.get("severity") == "critical" for item in issues),
        "finding_count": len(issues),
    }


def decide_submission_route(
    assessment: dict, prior_clarification_rounds: int, force_review: bool = False
) -> dict:
    threshold = 85 if prior_clarification_rounds == 0 else 65
    below_threshold = (
        assessment["score"] < threshold or assessment["has_critical_issue"]
    )
    return_to_creator = (
        below_threshold and not force_review and prior_clarification_rounds < 1
    )
    forward_with_notes = force_review or (
        not return_to_creator and assessment["finding_count"] > 0
        and assessment["level"] != "strong"
    )
    routing_reason = (
        "creator_override" if force_review else
        "clarification_limit_reached"
        if forward_with_notes and prior_clarification_rounds >= 1 else
        "tolerance_applied" if forward_with_notes else None
    )
    return {
        "threshold": threshold,
        "return_to_creator": return_to_creator,
        "forward_with_notes": forward_with_notes,
        "routing_reason": routing_reason,
    }
