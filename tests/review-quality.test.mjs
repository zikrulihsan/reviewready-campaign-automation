import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

async function loadPureModule(name) {
  const source = readFileSync(resolve('netlify/functions/lib', name), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

const { checkRequirements, creatorFeedbackPolicy, scoreReadiness, decideSubmissionRoute } = await loadPureModule('requirements.mts')
const { prepareReviewerBrief } = await loadPureModule('review-quality.mts')

const campaign = { story: 'A family needs help with several essential expenses after a house fire.', fund_usage: 'The funds will cover temporary accommodation and replacement school supplies.', fund_delivery: 'The organizer will pay the landlord and school suppliers directly.' }
const requirements = { required_fields: ['title', 'story', 'beneficiary', 'fund_usage', 'fund_delivery', 'goal_amount'], missing_fields: [], invalid_fields: [], low_information: false, placeholder_count: 0 }
const semantic = (issues = []) => ({ status: 'complete', purpose_clarity: 'high', beneficiary_clarity: 'high', fund_usage_clarity: 'high', fund_delivery_clarity: 'high', internal_consistency: 'high', issues })
const tip = (type, severity, feedback) => ({ type, severity, evidence: 'Submitted campaign text', feedback })

test('one material issue yields one specific creator tip', () => {
  const result = creatorFeedbackPolicy(campaign, requirements, semantic([tip('goal', 'medium', 'Explain how the $5,000 goal relates to the listed costs.')]), {})
  assert.deepEqual(result.suggestions, ['Explain how the $5,000 goal relates to the listed costs.'])
  assert.equal(result.items[0].category, 'goal')
})

test('more than two urgent, distinct issues all reach the creator, strongest first', () => {
  const result = creatorFeedbackPolicy(campaign, requirements, semantic([
    tip('fund_usage', 'medium', 'Add estimated amounts for accommodation and supplies.'),
    tip('consistency', 'critical', 'The title says rent, while the story asks for school supplies; clarify the request.'),
    tip('beneficiary', 'medium', 'Name who will receive the support.'),
    tip('purpose', 'low', 'Polish the introduction.'),
  ]), {})
  assert.equal(result.items.length, 3)
  assert.equal(result.items[0].category, 'consistency')
  assert.ok(result.suggestions.every(text => !text.includes('Polish')))
})

test('missing required detail is not repeated by an AI issue about the same detail', () => {
  const result = creatorFeedbackPolicy({ ...campaign, story: '' }, { ...requirements, missing_fields: ['story'] }, semantic([tip('purpose', 'critical', 'Add a story.'), tip('goal', 'medium', 'Explain the funding goal.')]), {})
  assert.equal(result.items.filter(item => item.category === 'story').length, 1)
  assert.equal(result.suggestions.length, 2)
  assert.ok(!result.suggestions.includes('Add a story.'))
})

test('low priority polish alone produces no urgent tips', () => {
  const result = creatorFeedbackPolicy(campaign, requirements, semantic([tip('purpose', 'low', 'Rewrite the opening.')]), {})
  assert.deepEqual(result.suggestions, [])
  assert.equal(result.mode, 'none')
})

test('routing that requests clarification still yields a tip when model omits issues', () => {
  const result = creatorFeedbackPolicy(campaign, requirements, { ...semantic(), purpose_clarity: 'medium' }, { recommendation: 'targeted_clarification' })
  assert.deepEqual(result.items.map(item => item.category), ['purpose'])
})

test('concise but complete facts are not penalized solely for word count', () => {
  const facts = { profile_type: 'self', category: 'general', title: 'Rent support', story: 'I need rent after losing work this month.', goal_amount: 800, beneficiary: 'My family', beneficiary_relationship: 'Self', fund_usage: 'One month rent paid to my landlord.', fund_delivery: 'I will pay the landlord directly.' }
  const checked = checkRequirements(facts, [])
  assert.equal(checked.low_information, false)
  assert.equal(scoreReadiness(checked, semantic()).score, 100)
})

test('thin submission gets focused tips even when AI analysis is unavailable', () => {
  const result = creatorFeedbackPolicy({ story: 'Help me', fund_usage: 'Needs', fund_delivery: 'Later' }, { ...requirements, low_information: true }, { status: 'unavailable', issues: [] }, {})
  assert.deepEqual(result.items.map(item => item.category), ['purpose', 'fund_usage', 'fund_delivery'])
})

test('unavailable AI has no numeric quality score and can enter human review', () => {
  const assessment = scoreReadiness(requirements, { status: 'unavailable', issues: [] })
  assert.equal(assessment.score, null)
  assert.equal(assessment.level, 'unavailable')
  assert.equal(decideSubmissionRoute(assessment, 0, false, false, 1, requirements).return_to_creator, false)
})

const finding = (overrides = {}) => ({ category: 'ambiguity', topic: 'Funds path', priority: 'medium', observation: 'The receiving account is unclear.', evidence: 'Funds will be sent.', reviewer_question: 'Who would receive the funds?', ...overrides })

test('reviewer brief keeps classified, actionable findings and removes duplicate or empty ones', () => {
  const result = prepareReviewerBrief({ campaign_findings: [finding(), finding(), finding({ topic: '', observation: 'Other point' })], completeness_findings: [finding({ category: 'missing_detail', topic: 'Cost estimate', observation: 'No amounts are listed.', evidence: 'No cost breakdown provided.', reviewer_question: 'Could the creator add estimated amounts?' })], provided_information: [' Goal: $5,000 ', 'Goal: $5,000'] })
  assert.equal(result.campaign_findings.length, 1)
  assert.equal(result.completeness_findings.length, 1)
  assert.equal(result.completeness_findings[0].category, 'missing_detail')
  assert.deepEqual(result.provided_information, ['Goal: $5,000'])
})

test('reviewer findings appear under the section matching their category', () => {
  const result = prepareReviewerBrief({ campaign_findings: [finding({ category: 'missing_detail' })], completeness_findings: [finding({ category: 'contradiction', topic: 'Goal mismatch' })], provided_information: [] })
  assert.equal(result.campaign_findings[0].category, 'contradiction')
  assert.equal(result.completeness_findings[0].category, 'missing_detail')
})
