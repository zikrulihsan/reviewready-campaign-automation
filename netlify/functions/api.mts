import { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { z, ZodError } from 'zod'
import { json, q, sql } from './lib/db.mts'
import { assessDocument, assessOpsReview, assessReadiness, MODEL, OPS_PROMPT_VERSION, PROMPT_VERSION, stableHash } from './lib/gemini.mts'
import { checkRequirements, creatorFeedbackPolicy, decideReadiness, decideSubmissionRoute, requirementSpec, scoreReadiness } from './lib/requirements.mts'

const app = new Hono()
const campaignFields = ['profile_type', 'category', 'title', 'story', 'goal_amount', 'beneficiary', 'beneficiary_relationship', 'fund_usage', 'fund_delivery', 'travel_purpose', 'destination'] as const
const profiles = ['self', 'behalf_of_other', 'organization'] as const
const categories = ['medical', 'education', 'rent', 'travel', 'business_product', 'refugee_asylum', 'vehicle', 'other'] as const
const campaignInput = z.object({
  profile_type: z.enum(profiles), category: z.enum(categories), title: z.string().default(''), story: z.string().default(''),
  goal_amount: z.coerce.number().min(0).default(0), beneficiary: z.string().default(''), beneficiary_relationship: z.string().default(''),
  fund_usage: z.string().default(''), fund_delivery: z.string().default(''), travel_purpose: z.string().default(''), destination: z.string().default(''),
  expedited_requested: z.boolean().default(false), urgency_reason: z.string().max(500).default(''),
  urgency_deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value).nullable().default(null),
})
const campaignUpdate = campaignInput.partial()
const urgencyInput = campaignInput.pick({ expedited_requested: true, urgency_reason: true, urgency_deadline: true }).partial()
const priorityInput = z.object({ priority_status: z.enum(['standard', 'confirmed']), note: z.string().max(1000).default('') })
const documentTypes = ['organizer_id', 'beneficiary_id', 'recent_bank_statement', 'organization_registration', 'medical_supporting_evidence', 'signed_rental_agreement', 'accommodation_invoice', 'flight_invoice', 'vehicle_quote_or_purchase_agreement', 'student_id', 'acceptance_letter'] as const
const documentInput = z.object({ document_type: z.enum(documentTypes), filename: z.string().min(1).max(255), extracted_text: z.string().max(10000).default(''), mime_type: z.enum(['application/pdf', 'image/png', 'image/jpeg']), content_base64: z.string().min(1).max(2800000) })
const documentReviewInput = z.object({ status: z.enum(['accepted', 'rejected']), note: z.string().max(1000).default('') })
const verificationInput = z.object({ check: z.enum(['identity', 'beneficiary', 'funds_path', 'sanctions', 'guidelines']), checked: z.boolean() })
const processingInput = z.object({ event_id: z.string().min(1).max(128), campaign_version: z.number().int().positive() })
const reviewActionInput = z.object({ action: z.enum(['continue_review', 'request_more_information', 'escalate', 'approve_content', 'publish']), note: z.string().max(1000).default('') })
const mockEmailInput = z.object({ notification_kind: z.enum(['needs_clarification', 'ready_for_review']), recipient: z.literal('zikrulihsanmd@gmail.com'), subject: z.string().min(1).max(255), body: z.string().min(1).max(5000) }).extend(processingInput.shape)
const uuid = () => crypto.randomUUID()
const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }) }
const jsonBody = async (c: any) => {
  try { return await c.req.json() } catch { fail(400, 'Invalid JSON body') }
}
const optionalJsonBody = async (c: any) => {
  const body = await c.req.text()
  if (!body.trim()) return {}
  try { return JSON.parse(body) } catch { fail(400, 'Invalid JSON body') }
}
const requireInternal = (c: any) => {
  const token = process.env.INTERNAL_TOKEN
  const incoming = c.req.header('X-Internal-Token') || ''
  if (!token || incoming.length !== token.length || !timingSafeEqual(incoming, token)) fail(401, 'Invalid internal token')
}
function timingSafeEqual(a: string, b: string) {
  let diff = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ (b.charCodeAt(i % (b.length || 1)) || 0)
  return diff === 0
}
async function campaignOr404(id: string, tx: any = q) {
  const rows = await tx`SELECT * FROM reviewready.campaigns WHERE id = ${id}`
  if (!rows.length) fail(404, 'Campaign not found')
  return rows[0]
}
async function documentsFor(id: string, tx: any = q) {
  return await tx`SELECT id,campaign_id,document_type,filename,extracted_text,mime_type,file_size,review_status,reviewer_note,reviewed_at,analysis,analyzed_at,created_at FROM reviewready.campaign_documents WHERE campaign_id = ${id} ORDER BY created_at, id`
}
function newestDocumentsByType(docs: any[]) {
  const latest = new Map<string, any>()
  for (const doc of docs) latest.set(doc.document_type, doc)
  return [...latest.values()]
}
async function automationFor(id: string, tx: any = q) {
  return await tx`SELECT id, step, status, detail, created_at FROM reviewready.campaign_automation_events WHERE campaign_id = ${id} ORDER BY created_at DESC, id DESC`
}
async function recordAutomation(tx: any, campaignId: string, step: string, status = 'complete', detail = '') {
  await tx`INSERT INTO reviewready.campaign_automation_events (id,campaign_id,step,status,detail) VALUES (${uuid()},${campaignId},${step},${status},${detail})`
}
async function completeAutomation(tx: any, campaignId: string, step: string, detail: string) {
  const found = await tx`SELECT id FROM reviewready.campaign_automation_events WHERE campaign_id=${campaignId} AND step=${step} AND status='running' ORDER BY created_at DESC LIMIT 1`
  if (found.length) await tx`UPDATE reviewready.campaign_automation_events SET status='complete', detail=${detail} WHERE id=${found[0].id}`
  else await recordAutomation(tx, campaignId, step, 'complete', detail)
}
async function rateLimit(c: any, action: string, limit: number, windowSeconds = 3600) {
  const clientIp = c.req.header('x-nf-client-connection-ip') || 'local-demo'
  const ipHash = createHash('sha256').update(clientIp).digest('hex')
  const key = `${action}:${ipHash}`
  const rows = await q`INSERT INTO reviewready.public_request_limits (request_key,window_started_at,request_count)
    VALUES (${key},now(),1)
    ON CONFLICT (request_key) DO UPDATE SET
      request_count=CASE WHEN reviewready.public_request_limits.window_started_at < now()-make_interval(secs=>${windowSeconds}) THEN 1 ELSE reviewready.public_request_limits.request_count+1 END,
      window_started_at=CASE WHEN reviewready.public_request_limits.window_started_at < now()-make_interval(secs=>${windowSeconds}) THEN now() ELSE reviewready.public_request_limits.window_started_at END
    RETURNING request_count`
  if (rows[0].request_count > limit) fail(429, 'This demo has reached its short-term request limit. Please try again later.')
}
function readinessHash(campaign: any) {
  return stableHash({ ...Object.fromEntries(campaignFields.map((key) => [key, campaign[key]])), model: process.env.GEMINI_API_KEY ? MODEL : 'unconfigured' })
}
function opsHash(campaign: any, docs: any[], semantic: any) {
  return stableHash({ ...Object.fromEntries(campaignFields.map((key) => [key, key === 'goal_amount' ? String(campaign[key]) : campaign[key]])), semantic, documents: docs.map((doc: any) => ({ id: doc.id, document_type: doc.document_type, filename: doc.filename, extracted_text: doc.extracted_text, analysis: doc.analysis })), model: process.env.GEMINI_API_KEY ? MODEL : 'unconfigured' })
}
async function latestReadiness(campaignId: string) {
  const rows = await q`SELECT semantic_result FROM reviewready.readiness_analyses WHERE campaign_id=${campaignId} AND prompt_version=${PROMPT_VERSION} ORDER BY created_at DESC LIMIT 1`
  return rows[0]?.semantic_result || { status: 'unavailable', issues: [] }
}
async function getOrCreateReadiness(campaignId: string) {
  const campaign = await campaignOr404(campaignId)
  const docs = await documentsFor(campaignId)
  const inputHash = readinessHash(campaign)
  const cached = await q`SELECT * FROM reviewready.readiness_analyses WHERE campaign_id=${campaignId} AND input_hash=${inputHash} AND prompt_version=${PROMPT_VERSION}`
  if (cached.length && !(process.env.GEMINI_API_KEY && cached[0].semantic_result.status === 'unavailable')) {
    const requirements = checkRequirements(campaign, docs)
    return { campaign_id: campaignId, campaign_version: campaign.version, requirements, semantic: cached[0].semantic_result, readiness_state: decideReadiness(requirements, cached[0].semantic_result), assessment: scoreReadiness(requirements, cached[0].semantic_result), cached: true }
  }
  const requirements = checkRequirements(campaign, docs)
  let semantic: any
  try { semantic = await assessReadiness(campaign) } catch { semantic = { status: 'unavailable', issues: [] } }
  const state = decideReadiness(requirements, semantic)
  const current = await campaignOr404(campaignId)
  if (readinessHash(current) !== inputHash) fail(409, 'Campaign changed during readiness check; retry')
  await q`INSERT INTO reviewready.readiness_analyses (id,campaign_id,campaign_version,input_hash,requirements_result,semantic_result,overall_state,model,prompt_version)
    VALUES (${uuid()},${campaignId},${current.version},${inputHash},${json(requirements)},${json(semantic)},${state},${semantic.status === 'complete' ? MODEL : null},${PROMPT_VERSION})
    ON CONFLICT (campaign_id,input_hash,prompt_version) DO UPDATE SET semantic_result=EXCLUDED.semantic_result,overall_state=EXCLUDED.overall_state,model=EXCLUDED.model,created_at=now()
    WHERE reviewready.readiness_analyses.semantic_result->>'status'='unavailable'`
  const saved = await q`SELECT * FROM reviewready.readiness_analyses WHERE campaign_id=${campaignId} AND input_hash=${inputHash} AND prompt_version=${PROMPT_VERSION}`
  return { campaign_id: campaignId, campaign_version: current.version, requirements: saved[0].requirements_result, semantic: saved[0].semantic_result, readiness_state: saved[0].overall_state, assessment: scoreReadiness(saved[0].requirements_result, saved[0].semantic_result), cached: false }
}
async function getOrCreateOpsReview(campaignId: string) {
  const campaign = await campaignOr404(campaignId)
  if (!['initial_review', 'action_required', 'ready_for_review', 'ready_for_review_with_notes', 'submitted', 'awaiting_identity', 'identity_review', 'live'].includes(campaign.status)) fail(409, 'Reviewer analysis requires a submitted campaign')
  const docs = await documentsFor(campaignId)
  const semantic = await latestReadiness(campaignId)
  const inputHash = opsHash(campaign, docs, semantic)
  const cached = await q`SELECT result FROM reviewready.ops_review_analyses WHERE campaign_id=${campaignId} AND input_hash=${inputHash} AND prompt_version=${OPS_PROMPT_VERSION}`
  if (cached.length && !(process.env.GEMINI_API_KEY && cached[0].result.status === 'unavailable')) return cached[0].result
  const requirements = checkRequirements(campaign, docs)
  let result: any
  try { result = await assessOpsReview(campaign, requirements, semantic, docs) } catch { result = { status: 'unavailable' } }
  const current = await campaignOr404(campaignId)
  if (opsHash(current, await documentsFor(campaignId), await latestReadiness(campaignId)) !== inputHash) fail(409, 'Campaign material changed during reviewer analysis; retry')
  await q`INSERT INTO reviewready.ops_review_analyses (id,campaign_id,input_hash,prompt_version,result) VALUES (${uuid()},${campaignId},${inputHash},${OPS_PROMPT_VERSION},${json(result)})
    ON CONFLICT (campaign_id,input_hash,prompt_version) DO UPDATE SET result=EXCLUDED.result,created_at=now()
    WHERE reviewready.ops_review_analyses.result->>'status'='unavailable'`
  const saved = await q`SELECT result FROM reviewready.ops_review_analyses WHERE campaign_id=${campaignId} AND input_hash=${inputHash} AND prompt_version=${OPS_PROMPT_VERSION}`
  return saved[0].result
}
async function verifiedJob(campaignId: string, payload: any) {
  const event = await q`SELECT * FROM reviewready.submission_events WHERE event_id=${payload.event_id} AND campaign_id=${campaignId} AND campaign_version=${payload.campaign_version}`
  if (!event.length) fail(409, 'Event does not match campaign/version')
  const campaign = await campaignOr404(campaignId)
  if (!['initial_review', 'action_required', 'ready_for_review', 'ready_for_review_with_notes', 'submitted', 'automation_failed'].includes(campaign.status) || campaign.version !== payload.campaign_version) fail(409, 'Campaign version is not submitted')
  const job = await q`SELECT * FROM reviewready.processing_jobs WHERE event_id=${payload.event_id}`
  if (!job.length || !['processing', 'complete', 'failed'].includes(job[0].status)) fail(409, 'Processing job has not been claimed')
  return campaign
}

app.onError((err, c) => {
  const status = (err as any).status || (err instanceof ZodError ? 422 : 500)
  if (status >= 500) console.error('API request failed:', err.name, (err as any).code || '')
  return c.json({ detail: status === 500 ? 'The request failed. Please try again.' : err.message }, status as any)
})
app.get('/health', async (c) => { await q`SELECT 1`; return c.json({ ok: true }) })
app.get('/requirements', (c) => c.json(requirementSpec(c.req.query('profile_type') || '', c.req.query('category') || '')))
app.get('/public/campaigns/:slug', async (c) => {
  const rows = await q`SELECT id,public_slug,title,story,category,goal_amount,beneficiary,beneficiary_relationship,fund_usage,fund_delivery,published_at FROM reviewready.campaigns WHERE public_slug=${c.req.param('slug')} AND status='live'`
  if (!rows.length) fail(404, 'This campaign is not live')
  return c.json(rows[0])
})

app.post('/campaigns', async (c) => {
  await rateLimit(c, 'create-campaign', 30)
  const payload = campaignInput.parse(await jsonBody(c)); const id = uuid()
  await q`INSERT INTO reviewready.campaigns (id,profile_type,category,title,story,goal_amount,beneficiary,beneficiary_relationship,fund_usage,fund_delivery,travel_purpose,destination,expedited_requested,urgency_reason,urgency_deadline)
    VALUES (${id},${payload.profile_type},${payload.category},${payload.title},${payload.story},${payload.goal_amount},${payload.beneficiary},${payload.beneficiary_relationship},${payload.fund_usage},${payload.fund_delivery},${payload.travel_purpose},${payload.destination},${payload.expedited_requested},${payload.urgency_reason},${payload.urgency_deadline})`
  return c.json({ id, status: 'draft', version: 1 }, 201)
})
app.get('/campaigns', async (c) => c.json(await q`SELECT id,title,category,status,readiness_state,goal_amount,version,created_at,updated_at FROM reviewready.campaigns ORDER BY updated_at DESC`))
app.get('/campaigns/:id', async (c) => {
  const campaign = await campaignOr404(c.req.param('id')); const stale = campaign.status === 'initial_review' && Date.now() - new Date(campaign.updated_at).getTime() > 5 * 60 * 1000; const { verification_checks, ...safe } = campaign; const visibleCampaign = stale ? { ...safe, status: 'automation_failed' } : safe; return c.json({ campaign: visibleCampaign, documents: await documentsFor(campaign.id), automation: await automationFor(campaign.id), feedback: await q`SELECT id,action,note,created_at FROM reviewready.review_actions WHERE campaign_id=${campaign.id} AND action='request_more_information' ORDER BY created_at DESC LIMIT 1` })
})
app.patch('/campaigns/:id', async (c) => {
  const id = c.req.param('id'); const updates = campaignUpdate.parse(await jsonBody(c)); const entries = Object.entries(updates)
  if (!entries.length) fail(400, 'No fields to update')
  const allowed = new Set(Object.keys(campaignInput.shape))
  for (const [key, value] of entries) if (!allowed.has(key) || value === undefined || (value === null && key !== 'urgency_deadline')) fail(422, 'Use empty strings to clear text fields')
  const result = await sql.begin(async (tx) => {
    const rows = await tx`SELECT * FROM reviewready.campaigns WHERE id=${id} FOR UPDATE`
    if (!rows.length) fail(404, 'Campaign not found')
    const campaign = rows[0]
    if (!['draft', 'action_required'].includes(campaign.status)) fail(409, 'This campaign cannot be edited while it is processing or in review')
    const assignments = entries.map(([key], index) => `${key} = $${index + 1}`).join(', ')
    const values = entries.map(([, value]) => value)
    const updated = await tx.unsafe(`UPDATE reviewready.campaigns SET ${assignments}, status='draft', readiness_state=NULL, submitted_with_warning=FALSE, creator_override_at=NULL, review_score=NULL, review_level=NULL, review_breakdown=NULL, review_recommendation=NULL, review_routing_reason=NULL, priority_status='standard', version=version+1, updated_at=now() WHERE id=$${values.length + 1} RETURNING version`, [...values, id])
    return updated[0]
  })
  return c.json({ id, version: result.version })
})
app.post('/campaigns/:id/documents', async (c) => {
  const id = c.req.param('id'); const payload = documentInput.parse(await jsonBody(c)); const documentId = uuid()
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload.content_base64)) fail(422, 'Invalid file encoding')
  const bytes = Buffer.from(payload.content_base64, 'base64')
  if (!bytes.length || bytes.length > 2 * 1024 * 1024 || bytes.toString('base64') !== payload.content_base64) fail(422, 'File must be 2 MB or smaller')
  const signature = payload.mime_type === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-' : payload.mime_type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (!signature) fail(422, 'File content does not match its PDF or image type')
  const sensitive = ['organizer_id', 'beneficiary_id', 'recent_bank_statement'].includes(payload.document_type)
  const excerpt = sensitive ? '' : payload.extracted_text.trim()
  const result = await sql.begin(async (tx) => {
    const rows = await tx`SELECT * FROM reviewready.campaigns WHERE id=${id} FOR UPDATE`
    if (!rows.length) fail(404, 'Campaign not found')
    const campaign = rows[0]
    if (!['draft', 'action_required', 'submitted', 'ready_for_review', 'ready_for_review_with_notes', 'awaiting_identity', 'identity_review'].includes(campaign.status)) fail(409, 'Documents cannot be changed at this stage')
    const docs = await tx`SELECT id FROM reviewready.campaign_documents WHERE campaign_id=${id}`
    if (docs.length >= 12) fail(422, 'This campaign has reached its document limit')
    await tx`INSERT INTO reviewready.campaign_documents (id,campaign_id,document_type,filename,extracted_text,mime_type,file_size,content_base64) VALUES (${documentId},${id},${payload.document_type},${payload.filename},${excerpt},${payload.mime_type},${bytes.length},${payload.content_base64})`
    if (['draft', 'action_required'].includes(campaign.status)) await tx`UPDATE reviewready.campaigns SET version=version+1,updated_at=now() WHERE id=${id}`
    if (['awaiting_identity', 'identity_review'].includes(campaign.status)) await tx`UPDATE reviewready.campaigns SET status='identity_review',verification_checks='{}'::jsonb,updated_at=now() WHERE id=${id}`
    return { campaign, version: campaign.version + (['draft', 'action_required'].includes(campaign.status) ? 1 : 0) }
  })
  if (!sensitive && ['submitted', 'ready_for_review', 'ready_for_review_with_notes'].includes(result.campaign.status)) {
    let analysis: any
    try { analysis = { status: 'complete', ...await assessDocument(result.campaign, { ...payload, extracted_text: excerpt, content_base64: undefined }) } } catch { analysis = { status: 'unavailable', document_type: payload.document_type, stated_subject: '', relevance_to_campaign: 'unknown', finding: 'Document analysis is unavailable; the review can continue.' } }
    await q`UPDATE reviewready.campaign_documents SET analysis=${json(analysis)},analyzed_at=now() WHERE id=${documentId}`
  } else if (sensitive) {
    await q`UPDATE reviewready.campaign_documents SET analysis=${json({ status: 'manual_review_required' })},analyzed_at=now() WHERE id=${documentId}`
  }
  return c.json({ id: documentId, campaign_version: result.version }, 201)
})
app.post('/campaigns/:id/check-readiness', async (c) => {
  await rateLimit(c, 'readiness-check', 10)
  const id = c.req.param('id'); const campaign = await campaignOr404(id)
  if (campaign.status !== 'draft') fail(409, 'Readiness check is for drafts only')
  const requirements = checkRequirements(campaign, await documentsFor(id))
  return c.json(await getOrCreateReadiness(id))
})
async function submit(id: string, forceReview: boolean, urgency: z.infer<typeof urgencyInput> = {}) {
  return await sql.begin(async (tx) => {
    const rows = await tx`SELECT * FROM reviewready.campaigns WHERE id=${id} FOR UPDATE`
    if (!rows.length) fail(404, 'Campaign not found')
    const campaign = rows[0]
    if (!forceReview && campaign.status === 'initial_review') {
      const events = await tx`SELECT event_id FROM reviewready.submission_events WHERE campaign_id=${id} ORDER BY created_at DESC LIMIT 1`
      return { status: 'initial_review', event_id: events[0]?.event_id }
    }
    if (forceReview && campaign.status !== 'action_required') fail(409, 'Submit as it is is available after automated suggestions')
    if (!forceReview && !['draft', 'action_required'].includes(campaign.status)) fail(409, 'Campaign has already moved to human review')
    const docs = await documentsFor(id, tx)
    const requirements = checkRequirements(campaign, docs)
    const eventId = `evt_${uuid().replaceAll('-', '')}`
    const expedited = urgency.expedited_requested ?? campaign.expedited_requested
    const reason = expedited ? (urgency.urgency_reason ?? campaign.urgency_reason) : ''
    const deadline = expedited ? (urgency.urgency_deadline ?? campaign.urgency_deadline) : null
    await tx`UPDATE reviewready.campaigns SET status='initial_review',submitted_with_warning=${forceReview},creator_override_at=${forceReview ? new Date() : null},readiness_state=NULL,review_score=NULL,review_level=NULL,review_breakdown=NULL,review_recommendation=NULL,review_routing_reason=NULL,expedited_requested=${expedited},urgency_reason=${reason},urgency_deadline=${deadline},priority_status=${expedited ? 'requested' : 'standard'},creator_submission_count=creator_submission_count+${forceReview ? 0 : 1},last_submitted_at=now(),updated_at=now() WHERE id=${id}`
    const payload = { type: 'CAMPAIGN_SUBMITTED', event_id: eventId, campaign_id: id, campaign_version: campaign.version, force_review: forceReview }
    await tx`INSERT INTO reviewready.submission_events (event_id,campaign_id,campaign_version,payload) VALUES (${eventId},${id},${campaign.version},${json(payload)})`
    await tx`INSERT INTO reviewready.review_packets (campaign_id,campaign_version,status,packet) VALUES (${id},${campaign.version},'pending',NULL) ON CONFLICT (campaign_id) DO UPDATE SET campaign_version=EXCLUDED.campaign_version,status='pending',packet=NULL,updated_at=now()`
    if (forceReview) await recordAutomation(tx, id, 'creator_override', 'complete', 'Creator read the clarification notes and continued without changes.')
    else {
      await recordAutomation(tx, id, 'submission_received', 'complete', 'Campaign received. Submission checks have started.')
      await recordAutomation(tx, id, 'initial_ai_review', 'running', 'Checking campaign clarity and consistency.')
    }
    return { status: 'initial_review', event_id: eventId, submitted_with_readiness_warning: false, readiness_state: null }
  })
}
app.post('/campaigns/:id/submit', async (c) => { await rateLimit(c, 'campaign-submit', 6); return c.json(await submit(c.req.param('id'), false, urgencyInput.parse(await optionalJsonBody(c)))) })
app.post('/campaigns/:id/submit-as-is', async (c) => { await rateLimit(c, 'campaign-submit', 6); return c.json(await submit(c.req.param('id'), true, urgencyInput.parse(await optionalJsonBody(c)))) })
app.get('/campaigns/:id/readiness', async (c) => {
  const id = c.req.param('id'); const campaign = await campaignOr404(id); const docs = await documentsFor(id)
  const rows = await q`SELECT * FROM reviewready.readiness_analyses WHERE campaign_id=${id} ORDER BY created_at DESC LIMIT 1`
  if (!rows.length) fail(404, 'No readiness analysis yet')
  const analysis = rows[0]
  if (campaign.status === 'draft' && analysis.input_hash !== readinessHash(campaign)) fail(409, 'Readiness analysis is stale; run check-readiness')
  const semantic = analysis.semantic_result; const requirements = checkRequirements(campaign, docs)
  const assessment = scoreReadiness(requirements, semantic); const feedback = creatorFeedbackPolicy(campaign, requirements, semantic, assessment)
  return c.json({ readiness_state: campaign.readiness_state || analysis.overall_state, requirements, semantic_status: semantic.status, recommendation: campaign.review_recommendation || assessment.recommendation, assessment, feedback_mode: feedback.mode, feedback_reason: feedback.reason, improvement_suggestions: feedback.suggestions, document_feedback: docs.some((doc: any) => doc.analysis?.relevance_to_campaign === 'low') ? 'Some supporting material does not appear to align with the stated purpose. Please review the material you added.' : null, clarification_rounds: campaign.clarification_rounds, creator_submission_count: campaign.creator_submission_count, maximum_creator_returns: 1 })
})

app.post('/internal/campaigns/:id/claim-processing', async (c) => {
  requireInternal(c); const payload = processingInput.parse(await jsonBody(c)); const id = c.req.param('id')
  const result = await sql.begin(async (tx) => {
    const rows = await tx`SELECT * FROM reviewready.campaigns WHERE id=${id} FOR UPDATE`
    if (!rows.length) fail(404, 'Campaign not found')
    const campaign = rows[0]
    const events = await tx`SELECT * FROM reviewready.submission_events WHERE event_id=${payload.event_id} AND campaign_id=${id} AND campaign_version=${payload.campaign_version}`
    if (!events.length || campaign.status !== 'initial_review' || campaign.version !== payload.campaign_version) fail(409, 'Event does not match submitted campaign')
    const jobs = await tx`SELECT * FROM reviewready.processing_jobs WHERE event_id=${payload.event_id} FOR UPDATE`
    if (jobs.length && (jobs[0].status === 'complete' || jobs[0].status === 'processing' && jobs[0].lease_until && new Date(jobs[0].lease_until) > new Date())) return { should_process: false, needs_document_analysis: false }
    if (jobs.length) await tx`UPDATE reviewready.processing_jobs SET status='processing',lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now() WHERE event_id=${payload.event_id}`
    else await tx`INSERT INTO reviewready.processing_jobs (event_id,status,lease_until) VALUES (${payload.event_id},'processing',now()+interval '5 minutes')`
    const pending = await tx`SELECT 1 FROM reviewready.campaign_documents WHERE campaign_id=${id} AND analyzed_at IS NULL LIMIT 1`
    return { should_process: true, needs_document_analysis: Boolean(pending.length) }
  })
  return c.json(result)
})
app.post('/internal/campaigns/:id/analyze-documents', async (c) => {
  requireInternal(c); const payload = processingInput.parse(await jsonBody(c)); const id = c.req.param('id'); const campaign = await verifiedJob(id, payload)
  const pending = await q`SELECT id,document_type,filename,extracted_text FROM reviewready.campaign_documents WHERE campaign_id=${id} AND analyzed_at IS NULL ORDER BY created_at,id LIMIT 12`
  for (const doc of pending) {
    let analysis: any
    if (['organizer_id', 'beneficiary_id', 'recent_bank_statement'].includes(doc.document_type)) analysis = { status: 'manual_review_required' }
    else try { analysis = { status: 'complete', ...await assessDocument(campaign, doc) } } catch { analysis = { status: 'unavailable', document_type: doc.document_type, stated_subject: '', relevance_to_campaign: 'unknown', finding: 'Document analysis is unavailable; the review can continue.' } }
    await q`UPDATE reviewready.campaign_documents SET analysis=${json(analysis)},analyzed_at=now() WHERE id=${doc.id} AND analyzed_at IS NULL`
  }
  return c.json({ analyzed_documents: pending.length })
})
app.post('/internal/campaigns/:id/final-analysis', async (c) => {
  requireInternal(c); const payload = processingInput.parse(await jsonBody(c)); const id = c.req.param('id'); await verifiedJob(id, payload)
  const readiness = await getOrCreateReadiness(id)
  const result = await sql.begin(async (tx) => {
    const rows = await tx`SELECT * FROM reviewready.campaigns WHERE id=${id} FOR UPDATE`; const campaign = rows[0]
    const eventRows = await tx`SELECT payload FROM reviewready.submission_events WHERE event_id=${payload.event_id}`; const forceReview = Boolean(eventRows[0]?.payload?.force_review)
    if (campaign.status === 'action_required') return { ...readiness, continue_to_packet: false, campaign_status: 'action_required', ops_review_status: 'not_run', assessment: readiness.assessment, clarification_round: campaign.clarification_rounds }
    const rounds = campaign.clarification_rounds; const route = decideSubmissionRoute(readiness.assessment, rounds, forceReview, campaign.expedited_requested, campaign.creator_submission_count, readiness.requirements)
    await tx`UPDATE reviewready.campaigns SET readiness_state=${readiness.readiness_state},review_score=${readiness.assessment.score},review_level=${readiness.assessment.level},review_breakdown=${tx.json(readiness.assessment.breakdown)},review_recommendation=${readiness.assessment.recommendation},submitted_with_warning=${route.forward_with_notes},review_routing_reason=${route.routing_reason},updated_at=now() WHERE id=${id}`
    if (!forceReview) await completeAutomation(tx, id, 'initial_ai_review', 'Submission check completed.')
    if (route.return_to_creator) {
      await tx`UPDATE reviewready.campaigns SET status='action_required',clarification_rounds=clarification_rounds+1,updated_at=now() WHERE id=${id}`
      await tx`UPDATE reviewready.review_packets SET status='awaiting_creator',updated_at=now() WHERE campaign_id=${id}`
      await tx`UPDATE reviewready.processing_jobs SET status='complete',lease_until=NULL,updated_at=now() WHERE event_id=${payload.event_id}`
      await recordAutomation(tx, id, 'clarification_requested', 'action_required', 'A few details may need clarification before the submission is queued.')
      return { ...readiness, continue_to_packet: false, campaign_status: 'action_required', ops_review_status: 'not_run', assessment: readiness.assessment, clarification_round: rounds + 1 }
    }
    await recordAutomation(tx, id, 'detailed_reviewer_analysis', 'running', 'Preparing deeper campaign and completeness findings.')
    return { ...readiness, continue_to_packet: true, campaign_status: 'initial_review', assessment: readiness.assessment, clarification_round: rounds, forwarded_with_notes: route.forward_with_notes }
  })
  return c.json(result)
})
app.post('/internal/campaigns/:id/reviewer-analysis', async (c) => {
  requireInternal(c); const payload = processingInput.parse(await jsonBody(c)); const id = c.req.param('id'); const campaign = await verifiedJob(id, payload)
  const result = await getOrCreateOpsReview(id)
  await completeAutomation(sql, id, 'detailed_reviewer_analysis', 'Detailed campaign and completeness analysis completed.')
  return c.json({ ops_review_status: result.status, result, campaign_status: campaign.status })
})
app.post('/internal/campaigns/:id/build-review-packet', async (c) => {
  requireInternal(c); const payload = processingInput.parse(await jsonBody(c)); const id = c.req.param('id')
  const outcome = await sql.begin(async (tx) => {
    const events = await tx`SELECT 1 FROM reviewready.submission_events WHERE event_id=${payload.event_id} AND campaign_id=${id} AND campaign_version=${payload.campaign_version}`
    if (!events.length) fail(409, 'Event does not match campaign/version')
    const campaigns = await tx`SELECT * FROM reviewready.campaigns WHERE id=${id} FOR UPDATE`
    if (!campaigns.length) fail(404, 'Campaign not found')
    const campaign = campaigns[0]
    if (campaign.version !== payload.campaign_version) fail(409, 'Campaign version is not submitted')
    const jobs = await tx`SELECT * FROM reviewready.processing_jobs WHERE event_id=${payload.event_id}`
    if (!jobs.length || !['processing', 'complete'].includes(jobs[0].status)) fail(409, 'Processing job has not been claimed')
    if (campaign.status === 'action_required') return { packet_ready: false, awaiting_creator: true, cached: false }
    const existing = await tx`SELECT * FROM reviewready.review_packets WHERE campaign_id=${id} FOR UPDATE`
    if (existing[0]?.status === 'ready') return { packet_ready: true, cached: true }
    const docs = await documentsFor(id, tx)
    if (docs.some((doc: any) => !doc.analyzed_at)) fail(409, 'Document processing is incomplete')
    const readinessRows = await tx`SELECT * FROM reviewready.readiness_analyses WHERE campaign_id=${id} AND input_hash=${readinessHash(campaign)} AND prompt_version=${PROMPT_VERSION}`
    if (!readinessRows.length) fail(409, 'Final analysis is missing')
    // Reuse the readiness row already fetched in this transaction. Calling
    // latestReadiness() here uses the global pool; with max: 1, the transaction
    // holds the only connection and that nested query waits forever.
    const semantic = readinessRows[0].semantic_result; const hash = opsHash(campaign, docs, semantic)
    const opsRows = await tx`SELECT result FROM reviewready.ops_review_analyses WHERE campaign_id=${id} AND input_hash=${hash} AND prompt_version=${OPS_PROMPT_VERSION}`
    if (!opsRows.length) fail(409, 'Detailed reviewer analysis is missing')
    const mismatch = docs.some((doc: any) => doc.analysis?.relevance_to_campaign === 'low')
    const packet = {
      campaign: { id: campaign.id, title: campaign.title, profile_type: campaign.profile_type, category: campaign.category, goal_amount: String(campaign.goal_amount), story: campaign.story, beneficiary: campaign.beneficiary, beneficiary_relationship: campaign.beneficiary_relationship, fund_usage: campaign.fund_usage, fund_delivery: campaign.fund_delivery },
      requirements: checkRequirements(campaign, docs), readiness_state: campaign.readiness_state || readinessRows[0].overall_state,
      post_submission_reviewability: mismatch ? 'HIGH_FRICTION' : (campaign.readiness_state || readinessRows[0].overall_state), ops_attention: mismatch ? 'POTENTIAL_MATERIAL_MISMATCH' : null,
      semantic: readinessRows[0].semantic_result, internal_assessment: { score: campaign.review_score, level: campaign.review_level, recommendation: campaign.review_recommendation, breakdown: campaign.review_breakdown, creator_submission_count: campaign.creator_submission_count, clarification_rounds: campaign.clarification_rounds, routing_reason: campaign.review_routing_reason },
      expedited_review: { requested: campaign.expedited_requested, reason: campaign.urgency_reason, deadline: campaign.urgency_deadline, priority_status: campaign.priority_status },
      ops_review: opsRows[0].result, documents: docs.map((doc: any) => ({ id: doc.id, document_type: doc.document_type, filename: doc.filename, analysis: doc.analysis })), submitted_with_warning: campaign.submitted_with_warning,
      creator_override: { used: Boolean(campaign.creator_override_at), at: campaign.creator_override_at, note: campaign.creator_override_at ? 'Creator chose to continue with the current information.' : null },
    }
    await tx`UPDATE reviewready.review_packets SET packet=${tx.json(packet)},status='ready',updated_at=now() WHERE campaign_id=${id} AND campaign_version=${payload.campaign_version}`
    await tx`UPDATE reviewready.processing_jobs SET status='complete',lease_until=NULL,updated_at=now() WHERE event_id=${payload.event_id}`
    const status = campaign.submitted_with_warning ? 'ready_for_review_with_notes' : 'ready_for_review'
    await tx`UPDATE reviewready.campaigns SET status=${status},updated_at=now() WHERE id=${id}`
    await recordAutomation(tx, id, 'review_packet_ready', 'complete', campaign.submitted_with_warning ? 'Submission queued with clarification notes.' : 'Submission queued for review.')
    return { packet_ready: true, cached: false, campaign_status: status }
  })
  return c.json(outcome)
})
app.post('/internal/campaigns/:id/mock-email', async (c) => {
  requireInternal(c); const id = c.req.param('id'); const payload = mockEmailInput.parse(await jsonBody(c)); await verifiedJob(id, payload)
  await q`INSERT INTO reviewready.mock_email_notifications (id,event_id,campaign_id,notification_kind,recipient,subject,body,delivery_status)
    VALUES (${uuid()},${payload.event_id},${id},${payload.notification_kind},${payload.recipient},${payload.subject},${payload.body},'mock_sent')
    ON CONFLICT (event_id,notification_kind) DO NOTHING`
  await recordAutomation(sql, id, 'mock_notification_prepared', 'complete', `Demo email prepared for ${payload.recipient}. No email was sent.`)
  return c.json({ notification_prepared: true, delivery_status: 'mock_sent' })
})
app.post('/internal/campaigns/:id/fail-processing', async (c) => {
  requireInternal(c); const body = await jsonBody(c); const payload = processingInput.parse(body); const id = c.req.param('id'); await verifiedJob(id, payload)
  const note = z.object({ reason: z.string().max(300).default('Automated preparation could not be completed.') }).parse(body)
  await q`UPDATE reviewready.processing_jobs SET status='failed',lease_until=NULL,updated_at=now() WHERE event_id=${payload.event_id}`
  await q`UPDATE reviewready.campaigns SET status='automation_failed',updated_at=now() WHERE id=${id} AND status='initial_review'`
  await recordAutomation(sql, id, 'automation_failed', 'action_required', note.reason)
  return c.json({ status: 'automation_failed', campaign_id: id })
})
app.post('/campaigns/:id/retry-processing', async (c) => {
  const id = c.req.param('id')
  const result = await sql.begin(async (tx) => {
    const rows = await tx`SELECT * FROM reviewready.campaigns WHERE id=${id} FOR UPDATE`
    if (!rows.length) fail(404, 'Campaign not found')
    const campaign = rows[0]
    const stale = campaign.status === 'initial_review' && Date.now() - new Date(campaign.updated_at).getTime() > 5 * 60 * 1000
    if (campaign.status !== 'automation_failed' && !stale) fail(409, 'Retry is available when automated preparation has failed or timed out')
    if (campaign.retry_attempts >= 1) fail(409, 'The demo allows one retry per submission')
    const previous = await tx`SELECT event_id FROM reviewready.submission_events WHERE campaign_id=${id} ORDER BY created_at DESC LIMIT 1`
    if (!previous.length) fail(409, 'No submission event to retry')
    await tx`UPDATE reviewready.campaigns SET status='initial_review',retry_attempts=retry_attempts+1,updated_at=now() WHERE id=${id}`
    const eventId = `evt_${uuid().replaceAll('-', '')}`
    const payload = { type: 'CAMPAIGN_SUBMITTED', event_id: eventId, campaign_id: id, campaign_version: campaign.version, force_review: Boolean(campaign.creator_override_at), retry: true }
    await tx`INSERT INTO reviewready.submission_events (event_id,campaign_id,campaign_version,payload) VALUES (${eventId},${id},${campaign.version},${tx.json(payload)})`
    await tx`UPDATE reviewready.review_packets SET status='pending',packet=NULL,updated_at=now() WHERE campaign_id=${id}`
    await recordAutomation(tx, id, 'automation_retry', 'running', 'Retrying campaign preparation once.')
    return { status: 'initial_review', event_id: eventId }
  })
  return c.json(result)
})

app.get('/ops/reviews', async (c) => c.json(await q`SELECT c.id,c.title,c.category,CASE WHEN c.status='initial_review' AND c.updated_at < now()-interval '5 minutes' THEN 'automation_failed' ELSE c.status END AS status,c.readiness_state,c.submitted_with_warning,c.creator_override_at,c.expedited_requested,c.urgency_deadline,c.priority_status,c.last_submitted_at,r.status AS packet_status FROM reviewready.campaigns c LEFT JOIN reviewready.review_packets r ON r.campaign_id=c.id WHERE c.status IN ('initial_review','automation_failed','submitted','ready_for_review','ready_for_review_with_notes','awaiting_identity','identity_review','action_required','live') ORDER BY CASE WHEN c.priority_status='confirmed' THEN 0 ELSE 1 END, CASE WHEN c.priority_status='confirmed' THEN c.urgency_deadline END ASC NULLS LAST, c.last_submitted_at ASC NULLS LAST, c.created_at ASC`))
app.get('/ops/reviews/:id', async (c) => {
  const id = c.req.param('id')
  // One database round trip keeps the reviewer page within the Function timeout
  // even when the Supabase pooler has a slow first connection.
  const rows = await q`SELECT
    to_jsonb(c) || jsonb_build_object('goal_amount', c.goal_amount::text) AS campaign,
    (SELECT to_jsonb(r) FROM reviewready.review_packets r WHERE r.campaign_id=c.id) AS packet_row,
    COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at,d.id) FROM (
      SELECT id,campaign_id,document_type,filename,extracted_text,mime_type,file_size,review_status,reviewer_note,reviewed_at,analysis,analyzed_at,created_at
      FROM reviewready.campaign_documents WHERE campaign_id=c.id
    ) d),'[]'::jsonb) AS documents,
    COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC,a.id DESC) FROM (
      SELECT id,action,note,created_at FROM reviewready.review_actions WHERE campaign_id=c.id
    ) a),'[]'::jsonb) AS actions,
    COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC,p.id DESC) FROM (
      SELECT id,priority_status,note,created_at FROM reviewready.priority_events WHERE campaign_id=c.id
    ) p),'[]'::jsonb) AS priority_events,
    COALESCE((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC) FROM (
      SELECT id,event_id,notification_kind,recipient,subject,body,delivery_status,created_at FROM reviewready.mock_email_notifications WHERE campaign_id=c.id
    ) n),'[]'::jsonb) AS notifications,
    (SELECT semantic_result FROM reviewready.readiness_analyses WHERE campaign_id=c.id AND prompt_version=${PROMPT_VERSION} ORDER BY created_at DESC LIMIT 1) AS semantic,
    COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.created_at DESC) FROM (
      SELECT input_hash,result,created_at FROM reviewready.ops_review_analyses WHERE campaign_id=c.id AND prompt_version=${OPS_PROMPT_VERSION} ORDER BY created_at DESC LIMIT 20
    ) o),'[]'::jsonb) AS ops_rows
  FROM reviewready.campaigns c WHERE c.id=${id}`
  if (!rows.length) fail(404, 'Campaign not found')
  const { campaign, packet_row: packetRow, documents: docs, actions, priority_events: priorityEvents, notifications, semantic: rawSemantic, ops_rows: opsRows } = rows[0]
  if (!packetRow) return c.json({ campaign, packet: null, packet_status: campaign.status === 'automation_failed' ? 'failed' : 'pending', documents: docs, actions, priority_events: priorityEvents, notifications })
  let packet = packetRow.packet
  if (packet) {
    const semantic = rawSemantic || { status: 'unavailable', issues: [] }
    const hash = opsHash(campaign, docs, semantic)
    const ops = opsRows.find((row: any) => row.input_hash === hash)
    const requirements = checkRequirements(campaign, docs)
    const assess = scoreReadiness(requirements, semantic)
    packet = { ...packet, ops_review: ops?.result || { status: 'not_run' }, requirements, internal_assessment: { score: campaign.review_score ?? assess.score, level: campaign.review_level || assess.level, recommendation: campaign.review_recommendation || assess.recommendation, breakdown: campaign.review_breakdown || assess.breakdown, creator_submission_count: campaign.creator_submission_count, clarification_rounds: campaign.clarification_rounds, routing_reason: campaign.review_routing_reason }, expedited_review: { requested: campaign.expedited_requested, reason: campaign.urgency_reason, deadline: campaign.urgency_deadline, priority_status: campaign.priority_status }, documents: docs.map((doc: any) => ({ id: doc.id, document_type: doc.document_type, filename: doc.filename, analysis: doc.analysis })), ops_attention: docs.some((doc: any) => doc.analysis?.relevance_to_campaign === 'low') ? 'POTENTIAL_MATERIAL_MISMATCH' : null }
    packet.post_submission_reviewability = packet.ops_attention ? 'HIGH_FRICTION' : packet.readiness_state
  }
  return c.json({ ...packetRow, packet, campaign, documents: docs, actions, priority_events: priorityEvents, notifications })
})
app.post('/ops/reviews/:id/priority', async (c) => {
  const id = c.req.param('id'); const payload = priorityInput.parse(await jsonBody(c))
  const result = await sql.begin(async (tx) => {
    const rows = await tx`SELECT * FROM reviewready.campaigns WHERE id=${id} FOR UPDATE`
    if (!rows.length) fail(404, 'Campaign not found')
    const campaign = rows[0]
    if (!campaign.expedited_requested) fail(409, 'This campaign did not request expedited review')
    if (!['submitted', 'ready_for_review', 'ready_for_review_with_notes'].includes(campaign.status)) fail(409, 'Priority can be triaged when the campaign enters review')
    if (campaign.priority_status === payload.priority_status) return { priority_status: campaign.priority_status, unchanged: true }
    await tx`UPDATE reviewready.campaigns SET priority_status=${payload.priority_status},updated_at=now() WHERE id=${id}`
    await tx`INSERT INTO reviewready.priority_events (id,campaign_id,priority_status,note) VALUES (${uuid()},${id},${payload.priority_status},${payload.note.trim()})`
    return { priority_status: payload.priority_status, unchanged: false }
  })
  return c.json(result)
})
app.post('/ops/reviews/:id/refresh-ai', async (c) => {
  await rateLimit(c, 'review-refresh', 10)
  const id = c.req.param('id'); await getOrCreateReadiness(id); return c.json(await getOrCreateOpsReview(id))
})
app.get('/ops/reviews/:id/documents/:documentId/file', async (c) => {
  const rows = await q`SELECT filename,mime_type,content_base64 FROM reviewready.campaign_documents WHERE id=${c.req.param('documentId')} AND campaign_id=${c.req.param('id')}`
  if (!rows.length || !rows[0].content_base64) fail(404, 'Uploaded file not found')
  const doc = rows[0]
  return new Response(Buffer.from(doc.content_base64, 'base64'), { headers: { 'Content-Type': doc.mime_type, 'Content-Disposition': `inline; filename="review-document"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
})
app.post('/ops/reviews/:id/documents/:documentId/review', async (c) => {
  const payload = documentReviewInput.parse(await jsonBody(c)); const note = payload.note.trim()
  if (payload.status === 'rejected' && !note) fail(422, 'Explain what the creator needs to replace or clarify')
  const id = c.req.param('id'); const documentId = c.req.param('documentId')
  const result = await sql.begin(async (tx) => {
    const rows = await tx`SELECT * FROM reviewready.campaigns WHERE id=${id} FOR UPDATE`
    if (!rows.length) fail(404, 'Campaign not found')
    const campaign = rows[0]
    if (!['ready_for_review', 'ready_for_review_with_notes', 'submitted', 'awaiting_identity', 'identity_review'].includes(campaign.status)) fail(409, 'Document review is unavailable at this stage')
    const docs = await tx`UPDATE reviewready.campaign_documents SET review_status=${payload.status},reviewer_note=${note},reviewed_at=now() WHERE id=${documentId} AND campaign_id=${id} RETURNING id,document_type,review_status,reviewer_note`
    if (!docs.length) fail(404, 'Document not found')
    if (docs[0].document_type === 'organizer_id' && payload.status === 'rejected' && ['awaiting_identity', 'identity_review'].includes(campaign.status)) await tx`UPDATE reviewready.campaigns SET status='awaiting_identity',verification_checks=verification_checks - 'identity',updated_at=now() WHERE id=${id}`
    return docs[0]
  })
  return c.json(result)
})
app.post('/ops/reviews/:id/verification', async (c) => {
  const payload = verificationInput.parse(await jsonBody(c)); const id = c.req.param('id')
  const result = await sql.begin(async (tx) => {
    const rows = await tx`SELECT * FROM reviewready.campaigns WHERE id=${id} FOR UPDATE`
    if (!rows.length) fail(404, 'Campaign not found')
    const campaign = rows[0]
    if (!['awaiting_identity', 'identity_review'].includes(campaign.status)) fail(409, 'Approve campaign content before verification')
    if (payload.check === 'identity' && payload.checked) {
      const latest = newestDocumentsByType(await documentsFor(id, tx)).find((doc: any) => doc.document_type === 'organizer_id')
      if (!latest || latest.review_status !== 'accepted' || !latest.file_size) fail(409, 'Accept the latest uploaded personal ID before confirming identity')
    }
    const checks = { ...(campaign.verification_checks || {}), [payload.check]: payload.checked }
    await tx`UPDATE reviewready.campaigns SET verification_checks=${tx.json(checks)},updated_at=now() WHERE id=${id}`
    return checks
  })
  return c.json({ verification_checks: result })
})
app.post('/ops/reviews/:id/actions', async (c) => {
  const id = c.req.param('id'); const payload = reviewActionInput.parse(await jsonBody(c)); const note = payload.note.trim()
  if (['request_more_information', 'escalate'].includes(payload.action) && !note) fail(422, 'Add a note explaining the request or escalation')
  const result = await sql.begin(async (tx) => {
    const rows = await tx`SELECT * FROM reviewready.campaigns WHERE id=${id} FOR UPDATE`
    if (!rows.length) fail(404, 'Campaign not found')
    const campaign = rows[0]
    if (payload.action === 'publish') {
      if (!['awaiting_identity', 'identity_review'].includes(campaign.status)) fail(409, 'Approve campaign content before publishing')
      const docs = newestDocumentsByType(await documentsFor(id, tx))
      const accepted = docs.filter((doc: any) => doc.review_status === 'accepted' && doc.file_size > 0)
      const requirements = checkRequirements(campaign, accepted)
      if (!requirements.requirements_complete || !accepted.some((doc: any) => doc.document_type === 'organizer_id')) fail(409, 'Required fields and accepted uploaded documents are incomplete')
      const checks = campaign.verification_checks || {}
      if (!['identity', 'beneficiary', 'funds_path', 'sanctions', 'guidelines'].every(key => checks[key] === true)) fail(409, 'Complete every manual verification check before publishing')
      const slug = `${String(campaign.title || 'campaign').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'campaign'}-${id.slice(0, 8)}`
      await tx`UPDATE reviewready.campaigns SET status='live',public_slug=${slug},published_at=now(),updated_at=now() WHERE id=${id}`
      await tx`INSERT INTO reviewready.review_actions (id,campaign_id,action,note) VALUES (${uuid()},${id},'publish',${note})`
      return { status: 'live', public_slug: slug }
    }
    if (!['submitted', 'ready_for_review', 'ready_for_review_with_notes', 'awaiting_identity', 'identity_review'].includes(campaign.status)) fail(409, 'Campaign is not in human review')
    if (payload.action === 'approve_content') {
      if (!['submitted', 'ready_for_review', 'ready_for_review_with_notes'].includes(campaign.status)) fail(409, 'Content has already been approved')
      if (!checkRequirements(campaign, await documentsFor(id, tx)).submission_complete) fail(409, 'Required campaign fields are incomplete')
      await tx`UPDATE reviewready.campaigns SET status='awaiting_identity',content_approved_at=now(),updated_at=now() WHERE id=${id}`
    } else if (payload.action === 'request_more_information') {
      await tx`UPDATE reviewready.campaigns SET status='action_required',feedback_source='reviewer',clarification_rounds=clarification_rounds+1,content_approved_at=NULL,verification_checks='{}'::jsonb,updated_at=now() WHERE id=${id}`
      await tx`UPDATE reviewready.review_packets SET status='awaiting_creator',updated_at=now() WHERE campaign_id=${id}`
    }
    const actionId = uuid()
    await tx`INSERT INTO reviewready.review_actions (id,campaign_id,action,note) VALUES (${actionId},${id},${payload.action},${note})`
    return { id: actionId, action: payload.action, note, status: payload.action === 'approve_content' ? 'awaiting_identity' : payload.action === 'request_more_information' ? 'action_required' : campaign.status }
  })
  return c.json(result, 201)
})

export default async (request: Request) => {
  const url = new URL(request.url)
  const prefix = '/.netlify/functions/api'
  if (url.pathname.startsWith(prefix)) url.pathname = url.pathname.slice(prefix.length) || '/'
  return app.fetch(new Request(url, request))
}
