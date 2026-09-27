export const REQUIRED_FIELDS = ['title', 'story', 'beneficiary', 'beneficiary_relationship', 'fund_usage', 'fund_delivery'] as const
const PROFILE_DOCUMENTS: Record<string, string[]> = {
  self: ['organizer_id', 'recent_bank_statement'],
  behalf_of_other: ['organizer_id', 'beneficiary_id', 'recent_bank_statement'],
  organization: ['organizer_id', 'organization_registration', 'recent_bank_statement'],
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
  const coreText = ['story', 'fund_usage', 'fund_delivery'].map((key) => String(campaign[key] || '').trim())
  const thinFields = coreText.filter((value) => value.split(/\s+/).filter(Boolean).length < 6).length
  const placeholders = new Set(['test', 'testing', 'asdf', 'n/a', 'na', 'none', 'help', 'need help', 'for needs', 'something', 'anything'])
  const placeholderCount = coreText.filter((value) => placeholders.has(value.toLowerCase().replace(/[.,!?]/g, '').trim())).length
  return {
    required_fields: [...REQUIRED_FIELDS, 'goal_amount', ...(CATEGORY_FIELDS[campaign.category] || [])],
    required_documents: [...required].sort(), one_of_documents: oneOf || [],
    missing_fields, invalid_fields, missing_documents, missing_one_of_documents,
    low_information: thinFields >= 2 || placeholderCount > 0,
    placeholder_count: placeholderCount,
    submission_complete: !missing_fields.length && !invalid_fields.length,
    documents_complete: !missing_documents.length && !missing_one_of_documents.length,
    requirements_complete: !missing_fields.length && !invalid_fields.length && !missing_documents.length && !missing_one_of_documents.length,
  }
}

export function decideReadiness(requirements: any, semantic: any) {
  const assessment = scoreReadiness(requirements, semantic)
  if (assessment.recommendation === 'strong_correction') return 'HIGH_FRICTION'
  if (!requirements.submission_complete || assessment.recommendation === 'targeted_clarification') return 'NEEDS_IMPROVEMENT'
  return 'READY_FOR_REVIEW'
}

export function scoreReadiness(requirements: any, semantic: any) {
  const required = requirements.required_fields || [...REQUIRED_FIELDS, 'goal_amount']
  const deficient = new Set([...(requirements.missing_fields || []), ...(requirements.invalid_fields || []).map((item: string) => item.startsWith('title_') ? 'title' : item)])
  const completeness = Math.round(30 * Math.max(0, required.length - deficient.size) / required.length)
  const issues = semantic?.status === 'complete' ? semantic.issues || [] : []
  const available = semantic?.status === 'complete'
  const factor: Record<string, number> = { high: 1, medium: 0.5, low: 0 }
  const dimensions = ['purpose_clarity', 'beneficiary_clarity', 'fund_usage_clarity', 'fund_delivery_clarity']
  const clarity = available ? Math.min(requirements.low_information ? 25 : 50, Math.round(50 * dimensions.reduce((sum, key) => sum + factor[semantic[key]], 0) / 4)) : null
  const consistency = available ? Math.round(20 * factor[semantic.internal_consistency]) : null
  const score = available ? completeness + clarity! + consistency! : null
  const has_critical_issue = issues.some((item: any) => item.severity === 'critical')
  const coreMissing = (requirements.missing_fields || []).filter((field: string) => ['story', 'beneficiary', 'fund_usage', 'fund_delivery'].includes(field))
  const lowDimensions = dimensions.filter((key) => semantic?.[key] === 'low').length
  const recommendation = !available ? 'analysis_unavailable' :
    has_critical_issue || semantic.internal_consistency === 'low' || lowDimensions >= 2 || coreMissing.length >= 2 || requirements.placeholder_count > 0 || score! < 60 ? 'strong_correction' :
    deficient.size > 0 || score! < 80 || issues.some((item: any) => item.severity === 'medium') ? 'targeted_clarification' : 'ready'
  return {
    score,
    level: recommendation === 'strong_correction' ? 'needs_attention' : recommendation === 'ready' ? 'strong' : recommendation === 'analysis_unavailable' ? 'unavailable' : 'reviewable',
    recommendation,
    breakdown: { completeness, clarity, consistency },
    has_critical_issue,
    finding_count: issues.length,
  }
}

export function decideSubmissionRoute(assessment: any, rounds: number, forceReview = false, expeditedRequested = false, creatorAttempts = 1, requirements: any = {}, hasIrrelevantDocument = false) {
  const severe = assessment.recommendation === 'strong_correction' || hasIrrelevantDocument
  const needsClarification = severe || assessment.recommendation === 'targeted_clarification'
  const return_to_creator = !expeditedRequested && rounds < 2 && (
    creatorAttempts === 1 && needsClarification && !forceReview ||
    creatorAttempts === 2 && severe
  )
  const hasNotes = hasIrrelevantDocument || (requirements.missing_fields?.length || 0) > 0 || (requirements.invalid_fields?.length || 0) > 0 || assessment.finding_count > 0 || assessment.recommendation !== 'ready'
  const forward_with_notes = !return_to_creator && (forceReview || hasNotes)
  const routing_reason = return_to_creator && creatorAttempts === 2 ? 'severe_second_clarification' :
    forceReview && !return_to_creator ? 'creator_override' : expeditedRequested ? 'expedited_request' :
    needsClarification && creatorAttempts >= 3 ? 'clarification_limit_reached' :
    assessment.recommendation === 'analysis_unavailable' ? 'analysis_unavailable' :
    forward_with_notes ? 'findings_attached' : null
  return { return_to_creator, forward_with_notes, routing_reason }
}

export function creatorFeedbackPolicy(campaign: any, requirements: any, semantic: any, assessment: any) {
  type Tip = { category: string; urgency: 'high' | 'medium'; text: string; evidence?: string }
  const tips: Tip[] = []
  const seen = new Set<string>()
  const add = (tip: Tip) => {
    const normalized = tip.text.toLowerCase().replace(/\s+/g, ' ').trim()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    tips.push(tip)
  }
  const fieldLabels: Record<string, string> = { title: 'campaign title', story: 'campaign story', goal_amount: 'funding goal', beneficiary: 'beneficiary', beneficiary_relationship: 'relationship to the beneficiary', fund_usage: 'use of funds', fund_delivery: 'how funds will be delivered', travel_purpose: 'purpose of travel', destination: 'destination' }
  const missing = new Set<string>(requirements.missing_fields || [])
  for (const field of missing) add({ category: field, urgency: 'high', text: `Add the ${fieldLabels[field] || field.replaceAll('_', ' ')} so the reviewer can understand the request.` })
  for (const field of requirements.invalid_fields || []) add({ category: field, urgency: 'high', text: field === 'title_max_100' ? 'Shorten the campaign title to 100 characters or fewer.' : `Correct the ${field.replaceAll('_', ' ')} value.` })

  const issues = semantic?.status === 'complete' ? semantic.issues || [] : []
  const covered = new Set<string>()
  const missingForType: Record<string, string[]> = { purpose: ['story'], beneficiary: ['beneficiary', 'beneficiary_relationship'], fund_usage: ['fund_usage'], fund_delivery: ['fund_delivery'], goal: ['goal_amount'], consistency: [] }
  for (const issue of issues) {
    if (!['critical', 'medium'].includes(issue.severity)) continue
    const category = String(issue.type || 'other')
    if ((missingForType[category] || []).some(field => missing.has(field))) continue
    const feedback = String(issue.feedback || '').trim()
    if (!feedback) continue
    covered.add(category)
    add({ category, urgency: issue.severity === 'critical' ? 'high' : 'medium', text: feedback, evidence: String(issue.evidence || '').trim() })
  }

  if (requirements.low_information) {
    const thinFields: Array<[string, string]> = [
      ['story', 'Add what happened, who needs support, and why help is needed now to the campaign story.'],
      ['fund_usage', 'Add the main costs the funds would cover, even if amounts are estimates.'],
      ['fund_delivery', 'Explain who will receive the funds and how they will be passed on.'],
    ]
    for (const [field, text] of thinFields) {
      const words = String(campaign[field] || '').trim().split(/\s+/).filter(Boolean)
      if (words.length >= 6 || missing.has(field) || covered.has(field === 'story' ? 'purpose' : field)) continue
      add({ category: field === 'story' ? 'purpose' : field, urgency: 'medium', text })
    }
  }

  // A model can return low clarity without a usable issue. Supply one focused fallback
  // for that dimension, while avoiding extra generic advice beside a specific finding.
  const dimensions: Array<[string, string, string]> = [
    ['purpose', 'purpose_clarity', 'Describe what happened and why support is needed now.'],
    ['beneficiary', 'beneficiary_clarity', 'Explain who will benefit and your relationship to them.'],
    ['fund_usage', 'fund_usage_clarity', 'Explain what the requested funds will pay for.'],
    ['fund_delivery', 'fund_delivery_clarity', 'Explain how the funds will reach the beneficiary.'],
    ['consistency', 'internal_consistency', 'Clarify any difference between the title, category, story, and beneficiary.'],
  ]
  for (const [category, dimension, text] of dimensions) {
    if (semantic?.status !== 'complete' || semantic[dimension] !== 'low' || covered.has(category) || (missingForType[category] || []).some(field => missing.has(field))) continue
    add({ category, urgency: 'medium', text })
  }
  if (!tips.length && ['targeted_clarification', 'strong_correction'].includes(assessment?.recommendation)) {
    for (const [category, dimension, text] of dimensions) {
      if (semantic?.[dimension] === 'medium') add({ category, urgency: 'medium', text })
    }
  }
  tips.sort((a, b) => (a.urgency === 'high' ? 0 : 1) - (b.urgency === 'high' ? 0 : 1))
  return { mode: tips.length ? 'targeted' : 'none', reason: tips.length ? 'material_gaps' : 'no_urgent_feedback_needed', suggestions: tips.map(tip => tip.text), items: tips }
}
