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
  const coreText = ['story', 'fund_usage', 'fund_delivery'].map((key) => String(campaign[key] || '').trim())
  const thinFields = coreText.filter((value) => value.split(/\s+/).filter(Boolean).length < 6).length
  const wordCount = coreText.join(' ').split(/\s+/).filter(Boolean).length
  const placeholders = new Set(['test', 'testing', 'asdf', 'n/a', 'na', 'none', 'help', 'need help', 'for needs', 'something', 'anything'])
  const placeholderCount = coreText.filter((value) => placeholders.has(value.toLowerCase().replace(/[.,!?]/g, '').trim())).length
  return {
    required_fields: [...REQUIRED_FIELDS, 'goal_amount', ...(CATEGORY_FIELDS[campaign.category] || [])],
    missing_fields, invalid_fields, missing_documents, missing_one_of_documents,
    low_information: wordCount < 24 || thinFields >= 2 || placeholderCount > 0,
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

export function decideSubmissionRoute(assessment: any, rounds: number, forceReview = false, expeditedRequested = false, creatorAttempts = 1, requirements: any = {}) {
  const needsClarification = ['strong_correction', 'targeted_clarification'].includes(assessment.recommendation)
  const return_to_creator = needsClarification && !forceReview && !expeditedRequested && rounds < 1 && creatorAttempts < 2
  const hasNotes = (requirements.missing_fields?.length || 0) > 0 || (requirements.invalid_fields?.length || 0) > 0 || assessment.finding_count > 0 || assessment.recommendation !== 'ready'
  const forward_with_notes = !return_to_creator && (forceReview || hasNotes)
  const routing_reason = forceReview ? 'creator_override' : expeditedRequested ? 'expedited_request' :
    needsClarification && rounds >= 1 ? 'clarification_limit_reached' :
    assessment.recommendation === 'analysis_unavailable' ? 'analysis_unavailable' :
    forward_with_notes ? 'findings_attached' : null
  return { return_to_creator, forward_with_notes, routing_reason }
}

export function creatorFeedbackPolicy(campaign: any, requirements: any, semantic: any, assessment: any) {
  const fields = { story: String(campaign.story || '').trim(), fund_usage: String(campaign.fund_usage || '').trim(), fund_delivery: String(campaign.fund_delivery || '').trim() }
  const thin = Object.entries(fields).filter(([, value]) => value.split(/\s+/).filter(Boolean).length < 6).map(([key]) => key)
  const combined = Object.values(fields).join(' ').split(/\s+/).filter(Boolean).length
  const placeholders = new Set(['test', 'testing', 'asdf', 'n/a', 'na', 'none', 'help', 'need help', 'for needs', 'something', 'anything'])
  const placeholderCount = Object.values(fields).filter((value) => placeholders.has(value.toLowerCase().replace(/[.,!?]/g, '').trim())).length
  const lowInfo = combined < 24 || thin.length >= 2 || placeholderCount > 0
  const issues = semantic?.status === 'complete' ? semantic.issues || [] : []
  const fieldLabels: Record<string, string> = { title: 'campaign title', story: 'campaign story', goal_amount: 'funding goal', beneficiary: 'beneficiary', beneficiary_relationship: 'relationship to the beneficiary', fund_usage: 'use of funds', fund_delivery: 'how funds will be delivered', travel_purpose: 'purpose of travel', destination: 'destination' }
  const missingSuggestions = (requirements.missing_fields || []).map((field: string) => `Add the ${fieldLabels[field] || field.replaceAll('_', ' ')} so a reviewer can understand the request.`)
  const invalidSuggestions = (requirements.invalid_fields || []).map((field: string) => field === 'title_max_100' ? 'Shorten the campaign title to 100 characters or fewer.' : `Review the ${field.replaceAll('_', ' ')} value.`)
  const dimensionSuggestions: string[] = []
  if (['low', 'medium'].includes(semantic?.purpose_clarity) || ['low', 'medium'].includes(semantic?.beneficiary_clarity)) dimensionSuggestions.push('Explain what happened, who needs support, and why help is needed now.')
  if (['low', 'medium'].includes(semantic?.fund_usage_clarity) || ['low', 'medium'].includes(semantic?.fund_delivery_clarity)) dimensionSuggestions.push('Explain what the funds will pay for and how support will reach the beneficiary.')
  if (['low', 'medium'].includes(semantic?.internal_consistency)) dimensionSuggestions.push('Check that the title, category, story, and beneficiary describe the same need.')
  if (!issues.length && !missingSuggestions.length && !invalidSuggestions.length && !dimensionSuggestions.length && !lowInfo) return { mode: 'none', reason: 'no_creator_feedback_needed', suggestions: [] }
  const useGeneral = lowInfo || assessment.recommendation === 'strong_correction' || assessment.finding_count >= 3
  if (!useGeneral) return { mode: 'targeted', reason: 'limited_specific_gaps', suggestions: [...new Set([...missingSuggestions, ...invalidSuggestions, ...dimensionSuggestions, ...issues.map((item: any) => String(item.feedback || '').trim()).filter(Boolean)])].slice(0, 2) }
  const suggestions: string[] = []
  if (thin.includes('story') || ['low', 'medium'].includes(semantic.purpose_clarity) || ['low', 'medium'].includes(semantic.beneficiary_clarity)) suggestions.push('Describe what happened, who needs support, and why help is needed now.')
  if (thin.includes('fund_usage') || thin.includes('fund_delivery') || ['low', 'medium'].includes(semantic.fund_usage_clarity) || ['low', 'medium'].includes(semantic.fund_delivery_clarity)) suggestions.push('Add a simple breakdown of what the funds will pay for and how the support will reach the beneficiary.')
  if (['low', 'medium'].includes(semantic.internal_consistency)) suggestions.push('Check that the title, category, story, and beneficiary describe the same need.')
  if (!suggestions.length) suggestions.push('Add the main facts a reviewer needs: who needs help, what happened, and what the funds will cover.')
  return { mode: 'general', reason: 'submission_needs_foundational_detail', suggestions: [...new Set([...missingSuggestions, ...invalidSuggestions, ...suggestions, ...dimensionSuggestions])].slice(0, 2) }
}
