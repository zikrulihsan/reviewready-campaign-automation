export function prepareReviewerBrief(review: any) {
  const seen = new Set<string>()
  const cleanFindings = (findings: any[]) => (findings || []).flatMap((finding: any) => {
    const fields = ['topic', 'observation', 'evidence', 'reviewer_question'] as const
    const cleaned = Object.fromEntries(fields.map(field => [field, String(finding[field] || '').trim()]))
    if (fields.some(field => !cleaned[field])) return []
    const key = `${cleaned.topic} ${cleaned.observation}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    if (seen.has(key)) return []
    seen.add(key)
    return [{ ...finding, ...cleaned }]
  })
  const findings = cleanFindings([...(review.campaign_findings || []), ...(review.completeness_findings || [])])
  return {
    ...review,
    campaign_findings: findings.filter((finding: any) => finding.category !== 'missing_detail'),
    completeness_findings: findings.filter((finding: any) => finding.category === 'missing_detail'),
    provided_information: [...new Set((review.provided_information || []).map((value: any) => String(value).trim()).filter(Boolean))],
  }
}

export function prepareReadinessAssessment(campaign: any, assessment: any) {
  if (!/^TEST ONLY\b/i.test(String(campaign.title || ''))) return assessment
  return {
    ...assessment,
    issues: (assessment.issues || []).filter((issue: any) => !/TEST ONLY|test or demo|fictional presentation example|real campaign/i.test(String(issue.feedback || ''))),
  }
}
