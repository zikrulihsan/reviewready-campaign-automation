export const REQUIRED_FIELDS = ['title', 'story', 'beneficiary', 'beneficiary_relationship', 'fund_usage', 'fund_delivery'] as const
const PROFILE_DOCUMENTS: Record<string, string[]> = {
  self: ['organizer_id', 'recent_bank_statement'],
  behalf_of_other: ['organizer_id', 'beneficiary_id', 'recent_bank_statement'],
  organization: ['organization_registration', 'recent_bank_statement'],
}
const CATEGORY_DOCUMENTS: Record<string, string[]> = {
  medical: ['medical_supporting_evidence'],
  rent: ['signed_rental_agreement'],
  travel: ['accommodation_invoice', 'flight_invoice'],
  vehicle: ['vehicle_quote_or_purchase_agreement'],
}
const CATEGORY_FIELDS: Record<string, string[]> = { travel: ['travel_purpose', 'destination'] }
const CATEGORY_ONE_OF: Record<string, string[]> = { education: ['student_id', 'acceptance_letter'] }

export function requirementSpec(profileType: string, category: string) {
  return {
    required_fields: [...REQUIRED_FIELDS, 'goal_amount', ...(CATEGORY_FIELDS[category] || [])],
    required_documents: [...new Set([...(PROFILE_DOCUMENTS[profileType] || []), ...(CATEGORY_DOCUMENTS[category] || [])])].sort(),
    one_of_documents: CATEGORY_ONE_OF[category] || [],
  }
}

export function checkRequirements(campaign: any, documents: any[]) {
  const missing_fields = REQUIRED_FIELDS.filter((name) => !String(campaign[name] || '').trim()) as string[]
  if (!campaign.goal_amount || Number(campaign.goal_amount) <= 0) missing_fields.push('goal_amount')
  const invalid_fields: string[] = []
  if (String(campaign.title || '').length > 100) invalid_fields.push('title_max_100')
  for (const name of CATEGORY_FIELDS[campaign.category] || []) if (!String(campaign[name] || '').trim()) missing_fields.push(name)
  const present = new Set(documents.map((doc) => doc.document_type))
  const required = new Set([...(PROFILE_DOCUMENTS[campaign.profile_type] || []), ...(CATEGORY_DOCUMENTS[campaign.category] || [])])
  const missing_documents = [...required].filter((name) => !present.has(name)).sort()
  const oneOf = CATEGORY_ONE_OF[campaign.category]
  const missing_one_of_documents = oneOf && !oneOf.some((name) => present.has(name)) ? [oneOf] : []
  return {
    missing_fields, invalid_fields, missing_documents, missing_one_of_documents,
    submission_complete: !missing_fields.length && !invalid_fields.length,
    documents_complete: !missing_documents.length && !missing_one_of_documents.length,
    requirements_complete: !missing_fields.length && !invalid_fields.length && !missing_documents.length && !missing_one_of_documents.length,
  }
}

export function decideReadiness(requirements: any, semantic: any) {
  const issues = semantic?.status === 'complete' ? semantic.issues || [] : []
  if (issues.some((item: any) => item.severity === 'critical')) return 'HIGH_FRICTION'
  if (!requirements.submission_complete) return 'NEEDS_IMPROVEMENT'
  if (issues.some((item: any) => item.severity === 'medium')) return 'NEEDS_IMPROVEMENT'
  return 'READY_FOR_REVIEW'
}

export function scoreReadiness(requirements: any, semantic: any) {
  let score = 100 - 25 * (requirements.missing_fields?.length || 0) - 15 * (requirements.invalid_fields?.length || 0)
  const issues = semantic?.status === 'complete' ? semantic.issues || [] : []
  const issuePenalties: Record<string, number> = { critical: 25, medium: 12, low: 4 }
  score -= issues.reduce((sum: number, item: any) => sum + (issuePenalties[item.severity] || 0), 0)
  const clarityPenalties: Record<string, number> = { medium: 2, low: 5 }
  for (const key of ['purpose_clarity', 'beneficiary_clarity', 'fund_usage_clarity', 'fund_delivery_clarity', 'internal_consistency']) score -= clarityPenalties[semantic?.[key]] || 0
  score = Math.max(0, Math.min(100, score))
  const severities = new Set(issues.map((item: any) => item.severity))
  const has_critical_issue = severities.has('critical')
  return {
    score,
    level: has_critical_issue || score < 65 ? 'needs_attention' : severities.has('medium') || score < 85 ? 'reviewable' : 'strong',
    has_critical_issue,
    finding_count: issues.length,
  }
}

export function decideSubmissionRoute(assessment: any, rounds: number, forceReview = false) {
  const threshold = rounds === 0 ? 85 : 65
  const below = assessment.score < threshold || assessment.has_critical_issue
  const return_to_creator = below && !forceReview && rounds < 1
  const forward_with_notes = forceReview || (!return_to_creator && assessment.finding_count > 0 && assessment.level !== 'strong')
  const routing_reason = forceReview ? 'creator_override' : forward_with_notes && rounds >= 1 ? 'clarification_limit_reached' : forward_with_notes ? 'tolerance_applied' : null
  return { threshold, return_to_creator, forward_with_notes, routing_reason }
}

export function creatorFeedbackPolicy(campaign: any, requirements: any, semantic: any, assessment: any) {
  const fields = { story: String(campaign.story || '').trim(), fund_usage: String(campaign.fund_usage || '').trim(), fund_delivery: String(campaign.fund_delivery || '').trim() }
  const thin = Object.entries(fields).filter(([, value]) => value.split(/\s+/).filter(Boolean).length < 6).map(([key]) => key)
  const combined = Object.values(fields).join(' ').split(/\s+/).filter(Boolean).length
  const placeholders = new Set(['test', 'testing', 'asdf', 'n/a', 'na', 'none', 'help', 'need help', 'for needs', 'something', 'anything'])
  const placeholderCount = Object.values(fields).filter((value) => placeholders.has(value.toLowerCase().replace(/[.,!?]/g, '').trim())).length
  const lowInfo = combined < 24 || thin.length >= 2 || placeholderCount > 0
  const issues = semantic?.status === 'complete' ? semantic.issues || [] : []
  if (!issues.length) return { mode: 'none', reason: 'no_creator_feedback_needed', suggestions: [] }
  const useGeneral = lowInfo || assessment.score < 65 || assessment.has_critical_issue || assessment.finding_count >= 3
  if (!useGeneral) return { mode: 'targeted', reason: 'limited_specific_gaps', suggestions: issues.map((item: any) => String(item.feedback || '').trim()).filter(Boolean).slice(0, 2) }
  const suggestions: string[] = []
  if (thin.includes('story') || ['low', 'medium'].includes(semantic.purpose_clarity) || ['low', 'medium'].includes(semantic.beneficiary_clarity)) suggestions.push('Describe what happened, who needs support, and why help is needed now.')
  if (thin.includes('fund_usage') || thin.includes('fund_delivery') || ['low', 'medium'].includes(semantic.fund_usage_clarity) || ['low', 'medium'].includes(semantic.fund_delivery_clarity)) suggestions.push('Add a simple breakdown of what the funds will pay for and how the support will reach the beneficiary.')
  if (['low', 'medium'].includes(semantic.internal_consistency)) suggestions.push('Check that the title, category, story, and beneficiary describe the same need.')
  if (!suggestions.length) suggestions.push('Add the main facts a reviewer needs: who needs help, what happened, and what the funds will cover.')
  return { mode: 'general', reason: 'submission_needs_foundational_detail', suggestions: suggestions.slice(0, 2) }
}
