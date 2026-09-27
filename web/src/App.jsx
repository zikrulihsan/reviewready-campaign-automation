import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom'
import FundraiserWizard from './FundraiserWizard.jsx'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, CircleAlert, ClipboardList, FileCheck2, FilePlus2, FileText, FolderOpen, LayoutDashboard, Plus, RefreshCw, Search, ShieldCheck } from 'lucide-react'

const categories = { medical: 'Medical', education: 'Education', rent: 'Housing / rent', travel: 'Travel', business_product: 'Business / product', refugee_asylum: 'Refugee / asylum', vehicle: 'Vehicle', other: 'Other' }
const profiles = { self: 'Myself', behalf_of_other: 'Someone else', organization: 'Organization' }
const docLabels = { organizer_id: 'Campaign creator ID', beneficiary_id: 'Beneficiary ID', recent_bank_statement: 'Recent bank statement', organization_registration: 'Organization registration', medical_supporting_evidence: 'Medical supporting evidence', signed_rental_agreement: 'Signed rental agreement', accommodation_invoice: 'Accommodation invoice', flight_invoice: 'Flight invoice', vehicle_quote_or_purchase_agreement: 'Vehicle quote / purchase agreement', student_id: 'Student ID', acceptance_letter: 'Acceptance letter' }
const fieldLabels = { profile_type: 'Creator profile', category: 'Campaign category', title: 'Campaign title', story: 'Campaign story', beneficiary: 'Beneficiary', beneficiary_relationship: 'Relationship to beneficiary', fund_usage: 'Use of funds', fund_delivery: 'How funds will be delivered', goal_amount: 'Funding goal', travel_purpose: 'Purpose of travel', destination: 'Destination' }
const reviewerSourceLabels = {
  'campaign.profile_type': 'Creator profile', 'campaign.category': 'Campaign category',
  'campaign.title': 'Campaign title', 'campaign.story': 'Campaign story',
  'campaign.goal_amount': 'Funding goal', 'campaign.beneficiary': 'Beneficiary',
  'campaign.beneficiary_relationship': 'Relationship to beneficiary',
  'campaign.fund_usage': 'Use of funds', 'campaign.fund_delivery': 'How funds will be delivered',
  'campaign.travel_purpose': 'Purpose of travel', 'campaign.destination': 'Destination',
  'pre_submit_readiness.issues': 'Earlier clarity notes',
  'campaign_field_checks.missing_fields': 'Missing campaign details',
  'campaign_field_checks.invalid_fields': 'Details needing correction',
}
function reviewerText(value) {
  return String(value ?? '').trim().replace(/\b(?:campaign|pre_submit_readiness|campaign_field_checks)\.[a-z_]+(?:\.[a-z_]+)?\b/g, path =>
    reviewerSourceLabels[path] || path.split('.').slice(1).join(' ').replaceAll('_', ' '))
}
function providedFact(value, campaign) {
  const path = String(value ?? '').trim()
  if (!path.startsWith('campaign.') || !reviewerSourceLabels[path]) return reviewerText(value)
  const key = path.slice('campaign.'.length)
  const raw = campaign?.[key]
  if (raw == null || String(raw).trim() === '') return ''
  const formatted = key === 'goal_amount' ? money(raw) : key === 'profile_type' ? profiles[raw] || raw : key === 'category' ? categories[raw] || raw : String(raw).trim()
  return `${reviewerSourceLabels[path]}: ${formatted.length > 160 ? formatted.slice(0, 157) + '…' : formatted}`
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'The request failed. Please try again.')
  return body
}
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value || 0))
const date = value => value ? new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : '—'
const deadlineDate = value => value ? date(String(value).slice(0, 10) + 'T12:00:00') : '—'
const shortId = id => id ? '#' + id.slice(0, 8).toUpperCase() : ''
const docName = name => docLabels[name] || name?.replaceAll('_', ' ') || 'Document'
const displayTitle = title => title === 'Demo lengkap: Perlengkapan belajar' ? 'Complete demo: Learning supplies' : title || 'Untitled campaign'

function Badge({ state, packet }) {
  const labels = { initial_review: 'Preparing', automation_failed: 'Preparation paused', action_required: 'Update requested', ready_for_review: 'In queue', ready_for_review_with_notes: 'In queue · notes', submitted: 'In queue', awaiting_identity: 'Awaiting ID', identity_review: 'Verification', live: 'Live', READY_FOR_REVIEW: 'In queue', READY_WITH_NOTES: 'In queue · notes', HIGH_FRICTION: 'Needs clarification', NEEDS_IMPROVEMENT: 'Needs clarification' }
  const label = state === 'automation_failed' ? labels[state] : packet === 'pending' ? 'Preparing details' : labels[state] || 'Draft'
  const tone = packet === 'pending' || state === 'initial_review' || state === 'automation_failed' || state === 'NEEDS_IMPROVEMENT' || state === 'action_required' || state === 'awaiting_identity' || state === 'identity_review' || state === 'READY_WITH_NOTES' || state === 'ready_for_review_with_notes' ? 'amber' : state === 'HIGH_FRICTION' ? 'red' : state === 'READY_FOR_REVIEW' || state === 'ready_for_review' || state === 'submitted' || state === 'live' ? 'green' : 'slate'
  return <span className={'badge ' + tone}><span className="badge-dot" />{label}</span>
}
function Notice({ children, tone = 'info' }) { return <div className={'notice ' + tone}><CircleAlert size={18} /><div>{children}</div></div> }
function Empty({ icon: Icon = FolderOpen, title, text, action }) { return <div className="empty"><span className="empty-icon"><Icon size={26} /></span><h3>{title}</h3><p>{text}</p>{action}</div> }
function Loading() { return <div className="loading"><span className="spinner" /> Loading data…</div> }

function OpsFindings({ findings, emptyText }) {
  if (!findings?.length) return <p className="muted">{emptyText}</p>
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  const categoryLabels = { missing_detail: 'Missing detail', ambiguity: 'Unclear detail', contradiction: 'Details differ', document_alignment: 'Document alignment' }
  return <div className="ops-findings">{[...findings].sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3)).map((finding, index) => <article className="ops-finding" key={index}><div className="ops-finding-head"><strong>{reviewerText(finding.topic)}</strong><span className={'ops-priority ' + finding.priority}>{({ high: 'Check first', medium: 'Check', low: 'For context' })[finding.priority] || 'Check'}</span></div>{finding.category && <small className="ops-category">{categoryLabels[finding.category] || 'Information gap'}</small>}<p>{reviewerText(finding.observation)}</p>{finding.evidence && <div className="ops-evidence"><b>{finding.category === 'missing_detail' ? 'What is missing' : 'From the submission'}</b><span>{reviewerText(finding.evidence)}</span></div>}{finding.reviewer_question && <div className="ops-question"><b>Question to consider</b><span>{reviewerText(finding.reviewer_question)}</span></div>}</article>)}</div>
}

function OpsReviewSections({ review, campaign, needsUpdate, onRun, busy }) {
  const available = review?.status === 'complete'
  const findingCount = (review?.campaign_findings?.length || 0) + (review?.completeness_findings?.length || 0)
  const provided = [...new Set((review?.provided_information || []).filter(item => !/pre_submit_readiness\.issues/i.test(item)).map(item => providedFact(item, campaign)).filter(Boolean))]
  return <>
    <section className="panel review-panel"><div className="panel-heading"><div><div className="eyebrow">AI REVIEW BRIEF</div><h2>Points to check</h2><p>AI notes are a starting point. Compare each point with the campaign and documents before deciding.</p></div>{available && needsUpdate && <button className="button secondary" disabled={busy} onClick={onRun}>{busy ? 'Updating…' : 'Prepare clearer notes'}</button>}</div>
      {!available ? <div className="ops-empty"><p>{review?.status === 'unavailable' ? 'Notes are unavailable right now. You can continue or try again.' : 'Notes have not been prepared for this version yet.'}</p><button className="button secondary" disabled={busy} onClick={onRun}>{busy ? 'Reviewing…' : 'Prepare notes'}</button></div> : <><div className="ops-brief-count">{findingCount ? `${findingCount} ${findingCount === 1 ? 'point' : 'points'} to check` : 'No material follow-up identified by AI'}</div><p className="ops-summary">{reviewerText(review.campaign_summary)}</p><OpsFindings findings={review.campaign_findings} emptyText="No specific concerns were identified here. Read the campaign details before deciding." /></>}
    </section>
    <section className="panel review-panel"><div className="panel-heading"><div><div className="eyebrow">FOLLOW-UP</div><h2>Information gaps</h2><p>Focus on details that would help you make a decision.</p></div></div>
      {!available ? <p className="muted">Prepare notes to see possible information gaps.</p> : <><p className="ops-summary">{reviewerText(review.completeness_summary)}</p><OpsFindings findings={review.completeness_findings} emptyText="No additional information gaps were identified." />{provided.length > 0 && <details className="ops-provided"><summary>Information already supplied <span>{provided.length} items</span></summary><ul>{provided.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}</>}
    </section>
  </>
}

function Shell({ role, children }) {
  const creator = role === 'creator'
  return <div className={'app-shell ' + role + '-shell'}>
    <aside className="sidebar">
      <Link className="brand" to={creator ? '/creator' : '/reviewer'}><span className="brand-mark"><Check size={20} strokeWidth={2.5} /></span><span>reviewready<small>CAMPAIGN WORKSPACE</small></span></Link>
      <div className="workspace-tag"><span className={'role-mark ' + role}>{creator ? <FilePlus2 size={17} /> : <ShieldCheck size={17} />}</span><div><strong>{creator ? 'Campaign creator' : 'Review team'}</strong><small>{creator ? 'Submission workspace' : 'Review workspace'}</small></div></div>
      <p className="nav-caption">MAIN MENU</p>
      <nav className="side-nav" aria-label="Main navigation">
        <NavLink to={creator ? '/creator' : '/reviewer'} end><LayoutDashboard size={18} /> Overview</NavLink>
        {creator ? <NavLink to="/creator/new"><Plus size={18} /> New campaign</NavLink> : <NavLink to="/reviewer/queue"><ClipboardList size={18} /> Review queue</NavLink>}
      </nav>
      <div className="sidebar-bottom"><div className="local-indicator"><span /> Demo workspace</div><p>A demonstration workspace for preparing and reviewing campaigns.</p><Link to={creator ? '/reviewer' : '/creator'} className="switch-role">{creator ? 'Switch to reviewer' : 'Switch to creator'} <ArrowRight size={15} /></Link></div>
    </aside>
    <div className="content-shell">
      <header className="topbar"><span className="breadcrumb">Workspace <ChevronRight size={15} /> <strong>{creator ? 'Campaign creator' : 'Reviewer'}</strong></span><div className="topbar-right"><Link className="top-switch" to={creator ? '/reviewer' : '/creator'}>{creator ? 'Reviewer workspace' : 'Creator workspace'} <ArrowRight size={14} /></Link><span className="simulation-pill">DEMO WORKSPACE</span><span className="avatar">{creator ? 'PC' : 'RV'}</span></div></header>
      <main className="main-content">{children}</main>
    </div>
  </div>
}

function CreatorHome() {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api('/campaigns').then(setItems).catch(e => setError(e.message)) }, [])
  const draft = items?.filter(item => item.status === 'draft') || []
  const sent = items?.filter(item => ['submitted', 'initial_review', 'automation_failed', 'ready_for_review', 'ready_for_review_with_notes', 'awaiting_identity', 'identity_review', 'live'].includes(item.status)) || []
  return <Shell role="creator">
    <div className="page-heading"><div><div className="eyebrow">CAMPAIGN CREATOR</div><h1>Your campaigns</h1><p>Prepare your story and send it to the review queue.</p></div><Link className="button primary" to="/creator/new"><Plus size={18} /> Create campaign</Link></div>
    <div className="metric-grid"><div className="metric"><span>Total campaigns</span><strong>{items?.length ?? '—'}</strong><small>All submissions in this simulation</small></div><div className="metric"><span>Active drafts</span><strong>{items ? draft.length : '—'}</strong><small>Ready to continue</small></div><div className="metric"><span>Submitted</span><strong>{items ? sent.length : '—'}</strong><small>In the reviewer queue</small></div></div>
    <div className="section-head"><div><h2>Campaign list</h2><p>Continue a draft or check a submission.</p></div></div>
    {error && <Notice tone="error">{error}</Notice>}
    {!items && !error ? <Loading /> : items?.length ? <div className="table-card"><div className="table-scroll"><table><thead><tr><th>CAMPAIGN</th><th>CATEGORY</th><th>GOAL</th><th>STATUS</th><th>UPDATED</th><th /></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><Link className="table-title" to={'/creator/campaign/' + item.id}>{displayTitle(item.title)}</Link><small>{shortId(item.id)}</small></td><td>{categories[item.category]}</td><td>{money(item.goal_amount)}</td><td><Badge state={item.status} /></td><td>{date(item.updated_at)}</td><td><Link className="row-arrow" to={'/creator/campaign/' + item.id} aria-label="Open campaign"><ChevronRight size={19} /></Link></td></tr>)}</tbody></table></div></div> : <Empty title="No campaigns yet" text="Create your first campaign to try the preparation and review flow." action={<Link className="button primary" to="/creator/new"><Plus size={17} /> Create campaign</Link>} />}
    <div className="info-strip"><FileCheck2 size={19} /><span>After submission, unclear details may be returned once. The next submission enters the queue with any remaining notes.</span></div>
  </Shell>
}

function ReviewerHome() {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api('/ops/reviews').then(setItems).catch(e => setError(e.message)) }, [])
  const ready = items?.filter(x => ['ready_for_review', 'ready_for_review_with_notes', 'submitted'].includes(x.status)) || []
  const pending = items?.filter(x => x.status === 'initial_review') || []
  return <Shell role="reviewer"><div className="page-heading"><div><div className="eyebrow">REVIEW TEAM</div><h1>Review workspace</h1><p>Monitor submissions and inspect supporting information.</p></div><Link className="button primary" to="/reviewer/queue">Open queue <ArrowRight size={18} /></Link></div>
    <div className="metric-grid"><div className="metric"><span>Incoming submissions</span><strong>{items?.length ?? '—'}</strong><small>Campaigns in this prototype</small></div><div className="metric"><span>Ready to review</span><strong>{items ? ready.length : '—'}</strong><small>Waiting for a human decision</small></div><div className="metric"><span>Processing</span><strong>{items ? pending.length : '—'}</strong><small>Preparing review details</small></div></div>
    <div className="section-head"><div><h2>Recent submissions</h2><p>Choose a campaign to see its review details.</p></div><Link to="/reviewer/queue" className="text-link">View all <ArrowRight size={16} /></Link></div>
    {error && <Notice tone="error">{error}</Notice>}{!items && !error ? <Loading /> : items?.length ? <ReviewTable items={items.slice(0,5)} /> : <Empty icon={ClipboardList} title="The queue is empty" text="Campaigns appear here after a creator submits them." action={<Link className="button secondary" to="/creator">Open creator workspace <ArrowRight size={16} /></Link>} />}
    <div className="info-strip"><ShieldCheck size={19} /><span>Checks and notes help reviewers focus. The review team decides the next action.</span></div>
  </Shell>
}
function ReviewTable({ items }) { return <div className="table-card"><div className="table-scroll"><table><thead><tr><th>CAMPAIGN</th><th>CATEGORY</th><th>PRIORITY</th><th>STATUS</th><th>DETAILS</th><th /></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><Link className="table-title" to={'/reviewer/campaign/' + item.id}>{displayTitle(item.title)}</Link><small>{shortId(item.id)}</small></td><td>{categories[item.category]}</td><td><span className={'priority-tag ' + item.priority_status}>{item.priority_status === 'confirmed' ? 'Confirmed' : item.priority_status === 'requested' ? 'Requested' : 'Standard'}</span>{item.urgency_deadline && <small>By {deadlineDate(item.urgency_deadline)}</small>}</td><td><Badge state={item.status} /></td><td>{item.packet_status === 'ready' ? 'Packet ready' : item.status === 'initial_review' ? 'Preparing' : 'Open details'}</td><td><Link className="row-arrow" to={'/reviewer/campaign/' + item.id} aria-label="Open review"><ChevronRight size={19} /></Link></td></tr>)}</tbody></table></div></div> }
function ReviewQueue() {
  const [items, setItems] = useState(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')
  async function refresh() { try { setItems(await api('/ops/reviews')); setError('') } catch (e) { setError(e.message) } }
  useEffect(() => { refresh() }, [])
  const filtered = (items || []).filter(item => (filter === 'all' || (filter === 'ready' ? ['ready_for_review', 'ready_for_review_with_notes', 'submitted'].includes(item.status) : filter === 'pending' ? ['initial_review', 'automation_failed'].includes(item.status) : filter === 'verification' ? ['awaiting_identity', 'identity_review'].includes(item.status) : filter === 'changes' ? item.status === 'action_required' : item.priority_status === 'requested')) && displayTitle(item.title).toLowerCase().includes(query.toLowerCase()))
  return <Shell role="reviewer"><div className="page-heading"><div><div className="eyebrow">REVIEW QUEUE</div><h1>Incoming submissions</h1><p>Browse submitted campaigns for review.</p></div><button className="button secondary" onClick={refresh}><RefreshCw size={17} /> Refresh</button></div>
    <div className="toolbar"><div className="search"><Search size={18} /><input aria-label="Search campaigns" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search campaign titles…" /></div><div className="filter-tabs">{[['all','All'],['ready','Review'],['verification','Verification'],['changes','Changes'],['pending','Processing'],['priority','Priority']].map(([key,label]) => <button className={filter === key ? 'active' : ''} key={key} onClick={() => setFilter(key)}>{label}</button>)}</div></div>
    {error && <Notice tone="error">{error}</Notice>}{!items && !error ? <Loading /> : filtered.length ? <ReviewTable items={filtered} /> : <Empty icon={ClipboardList} title="No submissions found" text={items?.length ? 'Try another search or filter.' : 'Submitted campaigns will appear here.'} />}
  </Shell>
}

function ReviewDetail() {
  const { id } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [action, setAction] = useState('')
  const [actionNote, setActionNote] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [priorityBusy, setPriorityBusy] = useState(false)
  const [documentBusy, setDocumentBusy] = useState('')
  const [checkBusy, setCheckBusy] = useState('')
  const [preview, setPreview] = useState(null)
  const [documentNotes, setDocumentNotes] = useState({})
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url) }, [preview])
  async function openDocument(documentId) {
    setDocumentBusy(documentId); setError('')
    try {
      const response = await fetch('/ops/reviews/' + encodeURIComponent(id) + '/documents/' + encodeURIComponent(documentId) + '/file')
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.detail || 'Could not open file') }
      const blob = await response.blob()
      setPreview({ url: URL.createObjectURL(blob), mime: blob.type })
    } catch (e) { setError(e.message) } finally { setDocumentBusy('') }
  }
  async function reviewDocument(documentId, status) {
    setDocumentBusy(documentId); setError('')
    try {
      const previousNote = data?.documents?.find(doc => doc.id === documentId)?.reviewer_note || ''
      await api('/ops/reviews/' + encodeURIComponent(id) + '/documents/' + encodeURIComponent(documentId) + '/review', { method: 'POST', body: JSON.stringify({ status, note: documentNotes[documentId] ?? previousNote }) })
      setActionMessage(status === 'accepted' ? 'Document accepted.' : 'Document feedback saved. Request changes to send the creator back into revision.')
      await refresh()
    } catch (e) { setError(e.message) } finally { setDocumentBusy('') }
  }
  async function setCheck(check, checked) {
    setCheckBusy(check); setError('')
    try { await api('/ops/reviews/' + encodeURIComponent(id) + '/verification', { method: 'POST', body: JSON.stringify({ check, checked }) }); await refresh() }
    catch (e) { setError(e.message) } finally { setCheckBusy('') }
  }
  async function runOpsReview() {
    setAiBusy(true); setError(''); setActionMessage('')
    try {
      await api('/ops/reviews/' + encodeURIComponent(id) + '/refresh-ai', { method: 'POST' })
      await refresh()
      setActionMessage('Campaign checks updated. Review the findings before deciding the next step.')
    } catch (e) { setError(e.message) } finally { setAiBusy(false) }
  }
  async function recordAction() {
    if (!action) return
    setActionBusy(true); setError(''); setActionMessage('')
    try {
      await api('/ops/reviews/' + encodeURIComponent(id) + '/actions', { method: 'POST', body: JSON.stringify({ action, note: actionNote }) })
      setAction(''); setActionNote(''); setActionMessage(action === 'publish' ? 'Campaign published. Its live page is ready.' : action === 'request_more_information' ? 'Feedback sent to the creator workspace.' : action === 'approve_content' ? 'Campaign content approved. Identity and document checks are next.' : 'Review action recorded.')
      await refresh()
    } catch (e) { setError(e.message) } finally { setActionBusy(false) }
  }
  async function setPriority(priority_status) {
    setPriorityBusy(true); setError(''); setActionMessage('')
    try {
      await api('/ops/reviews/' + encodeURIComponent(id) + '/priority', { method: 'POST', body: JSON.stringify({ priority_status }) })
      await refresh()
      setActionMessage(priority_status === 'confirmed' ? 'Expedited priority confirmed.' : 'Campaign placed in the standard review queue.')
    } catch (e) { setError(e.message) } finally { setPriorityBusy(false) }
  }
  async function refresh() { setRefreshing(true); try { setData(await api('/ops/reviews/' + encodeURIComponent(id))); setError('') } catch(e) { setError(e.message) } finally { setRefreshing(false) } }
  useEffect(() => { refresh() }, [id])
  const campaign = data?.campaign || {}
  const packet = data?.packet
  const req = packet?.requirements || {}
  const sem = packet?.semantic || {}
  const ops = packet?.ops_review || { status: 'not_run' }
  const assessment = packet?.internal_assessment || {}
  const levelLabel = ({ strong: 'Clear for review', reviewable: 'Some details to check', needs_attention: 'Key details to clarify', unavailable: 'AI analysis unavailable' })[assessment.level] || 'Pending'
  const missing = [...(req.missing_fields || []).map(x => 'Missing: ' + (fieldLabels[x] || reviewerText(x))), ...(req.invalid_fields || []).map(x => 'Needs correction: ' + (fieldLabels[x] || reviewerText(x)))]
  const inContentReview = ['ready_for_review', 'ready_for_review_with_notes', 'submitted'].includes(campaign.status)
  const inVerification = ['awaiting_identity', 'identity_review'].includes(campaign.status)
  const checkLabels = { identity: 'Personal ID checked against organizer', beneficiary: 'Beneficiary and relationship verified', funds_path: 'Receiving account and funds path verified', sanctions: 'Sanctions / risk screening completed', guidelines: 'Story and cause meet campaign guidelines' }
  const latestDocuments = [...new Map((data?.documents || []).map(doc => [doc.document_type, doc])).values()]
  const acceptedTypes = new Set(latestDocuments.filter(doc => doc.review_status === 'accepted' && doc.file_size > 0).map(doc => doc.document_type))
  const missingDocumentTypes = [...(req.required_documents || [])].filter(type => !acceptedTypes.has(type))
  const missingOneOf = (req.one_of_documents || []).length && !req.one_of_documents.some(type => acceptedTypes.has(type))
  return <Shell role="reviewer"><Link className="back-link" to="/reviewer/queue"><ArrowLeft size={16} /> Back to queue</Link>
    {error && <Notice tone="error">{error}{!data && <button className="button secondary" onClick={refresh} disabled={refreshing}>Try again</button>}</Notice>}{!data && !error ? <Loading /> : data && <><div className="page-heading editor-heading"><div><div className="eyebrow">SUBMISSION · {shortId(id)}</div><h1>{displayTitle(campaign.title)}</h1><p>Submitted · {categories[campaign.category]}</p></div><button className="button secondary" onClick={refresh} disabled={refreshing}><RefreshCw size={17} /> {refreshing ? 'Loading…' : 'Refresh'}</button></div>
      <div className="review-summary"><div><span>Funding goal</span><strong>{money(campaign.goal_amount)}</strong></div><div><span>Creator profile</span><strong>{profiles[campaign.profile_type]}</strong></div><div><span>Routing status</span><Badge state={campaign.status} /></div><div><span>Information readiness</span><strong>{levelLabel}</strong><small>{assessment.creator_submission_count ? `Creator submission ${assessment.creator_submission_count}` : 'Internal routing signal'}</small></div></div>
      {packet && <div className="review-assessment"><strong>Automated preparation</strong><span>Required fields: {req.missing_fields?.length ? `${req.missing_fields.length} missing` : 'provided'}</span><span>AI clarity review: {sem.status === 'complete' ? 'available' : 'unavailable'}</span><span>Read the campaign and documents before deciding.</span></div>}
      {campaign.expedited_requested && <div className="review-priority"><div><strong>Expedited review requested</strong><p>{campaign.urgency_reason || 'No reason provided.'}{campaign.urgency_deadline ? ` Deadline: ${deadlineDate(campaign.urgency_deadline)}.` : ''}</p><small>Status: {campaign.priority_status === 'confirmed' ? 'priority confirmed' : campaign.priority_status === 'requested' ? 'awaiting reviewer triage' : 'standard queue'}. Review timing is not guaranteed.</small></div>{['ready_for_review','ready_for_review_with_notes','submitted'].includes(campaign.status) && <div className="review-priority-actions"><button className="button primary" disabled={priorityBusy || campaign.priority_status === 'confirmed'} onClick={() => setPriority('confirmed')}>Confirm priority</button><button className="button secondary" disabled={priorityBusy || campaign.priority_status === 'standard'} onClick={() => setPriority('standard')}>Standard queue</button></div>}{data.priority_events?.length > 0 && <details><summary>Priority history</summary>{data.priority_events.map(event => <p key={event.id}>{date(event.created_at)} · {event.priority_status === 'confirmed' ? 'Confirmed' : 'Standard queue'}{event.note ? ` · ${event.note}` : ''}</p>)}</details>}</div>}
      {campaign.submitted_with_warning && <Notice><strong>Submitted with notes:</strong>&nbsp; Review the remaining information gaps alongside the campaign.</Notice>}{actionMessage && <Notice tone="success">{actionMessage}</Notice>}
      {packet?.ops_attention && <Notice tone="error">Some supporting documents may not match the campaign purpose. Review them manually.</Notice>}
      {campaign.status === 'automation_failed' || data.packet_status === 'failed' ? <Notice tone="error">Automated preparation paused. You can inspect the campaign now; the creator can retry preparation once.</Notice> : campaign.status === 'initial_review' && <Notice>Review details are being prepared. You can inspect the campaign information below now.</Notice>}
      <div className="review-layout"><div className="review-main">
        <section className="panel review-panel"><div className="panel-heading"><div><div className="eyebrow">01 / INFORMATION</div><h2>Campaign overview</h2></div></div><div className="detail-block"><span>Campaign story</span><p>{campaign.story || 'Not provided'}</p></div><div className="detail-pair"><div><span>Beneficiary</span><strong>{campaign.beneficiary || '—'}</strong></div><div><span>Relationship</span><strong>{campaign.beneficiary_relationship || '—'}</strong></div></div><div className="detail-block"><span>Use of funds</span><p>{campaign.fund_usage || 'Not provided'}</p></div><div className="detail-block"><span>How funds will be delivered</span><p>{campaign.fund_delivery || 'Not provided'}</p></div>{campaign.category === 'travel' && <div className="detail-pair"><div><span>Purpose of travel</span><strong>{campaign.travel_purpose || '—'}</strong></div><div><span>Destination</span><strong>{campaign.destination || '—'}</strong></div></div>}</section>
        <OpsReviewSections review={ops} campaign={campaign} needsUpdate={packet?.ops_review_needs_update} onRun={runOpsReview} busy={aiBusy} />
        <section className="panel review-panel">
          <div className="panel-heading"><div><div className="eyebrow">04 / EVIDENCE</div><h2>Document review</h2><p>Open the file, compare it with the campaign, then record a decision for each document.</p></div></div>
          {data.documents?.length ? <div className="document-review-list">{data.documents.map(doc => <article className="document-review" key={doc.id}>
            <span className="doc-icon"><FileText size={20} /></span><div className="document-review-body"><strong>{doc.filename}</strong><small>{docName(doc.document_type)} · {doc.review_status === 'accepted' ? 'Accepted' : doc.review_status === 'rejected' ? 'Changes requested' : 'Awaiting review'}</small>
              {doc.analysis?.finding && <p>AI note: {doc.analysis.finding}</p>}{doc.extracted_text && <details><summary>Creator excerpt</summary><p>{doc.extracted_text}</p></details>}
              {doc.file_size ? <button className="button secondary" disabled={documentBusy === doc.id} onClick={() => openDocument(doc.id)}>Open uploaded file</button> : <p className="muted">Earlier sample text only. Ask the creator to upload a viewable file.</p>}
              {doc.reviewer_note && <p><b>Reviewer note:</b> {doc.reviewer_note}</p>}
              {doc.file_size && (inContentReview || inVerification) && <div className="document-decision"><label>Note for creator if changes are needed<textarea rows="2" value={documentNotes[doc.id] ?? doc.reviewer_note ?? ''} onChange={e => setDocumentNotes(current => ({ ...current, [doc.id]: e.target.value }))} placeholder="Explain what is missing or unreadable" /></label><div><button className="button primary" disabled={documentBusy === doc.id} onClick={() => reviewDocument(doc.id, 'accepted')}>Accept file</button><button className="button secondary" disabled={documentBusy === doc.id || !(documentNotes[doc.id] ?? doc.reviewer_note ?? '').trim()} onClick={() => reviewDocument(doc.id, 'rejected')}>Request replacement</button></div></div>}
            </div></article>)}</div> : <p className="muted">No supporting documents yet. You can request them from the creator.</p>}
        </section>
      </div><aside className="review-side"><div className="context-card"><div className="eyebrow">REVIEW SUMMARY</div><h3>Required campaign details</h3>{!packet ? <p className="muted">The summary appears when processing is complete.</p> : missing.length ? <div className="side-list">{missing.map((item,i) => <div key={i}><CircleAlert size={16} />{item}</div>)}</div> : <div className="side-success"><CheckCircle2 size={18} /> Required campaign details complete</div>}</div><div className="context-card"><div className="eyebrow">EARLIER NOTES</div><h3>Earlier clarity notes</h3>{!packet ? <p className="muted">Preparing the notes.</p> : sem.status === 'unavailable' ? <p className="muted">Earlier notes are unavailable. Continue with the campaign information.</p> : sem.issues?.length ? <div className="side-list">{sem.issues.map((issue,i) => <div key={i}><CircleAlert size={16} />{reviewerText(issue.feedback || issue.evidence || String(issue.type || 'Clarity issue').replaceAll('_', ' '))}</div>)}</div> : <p className="muted">No major clarity issues found.</p>}</div>{inVerification && <div className="context-card"><div className="eyebrow">FINAL VERIFICATION</div><h3>Before publication</h3><p className="muted">Record checks you completed yourself. AI notes do not count as verification.</p>
        {missingDocumentTypes.length > 0 && <p>Accept required files: {missingDocumentTypes.map(docName).join(', ')}.</p>}{missingOneOf && <p>Accept one of: {req.one_of_documents.map(docName).join(' / ')}.</p>}
        {Object.entries(checkLabels).map(([key,label]) => <label className="verification-check" key={key}><input type="checkbox" checked={Boolean(campaign.verification_checks?.[key])} disabled={Boolean(checkBusy)} onChange={e => setCheck(key, e.target.checked)} /><span>{label}</span></label>)}
        <p className="muted">For this prototype, use sample identity documents and simulated external checks.</p>
      </div>}
      <div className="context-card"><div className="eyebrow">NEXT STEP</div><h3>Human decision</h3>
        {(inContentReview || inVerification) ? <div className="review-action-options">{[
          ...(inContentReview ? [['approve_content', 'Approve campaign content']] : [['publish', 'Publish live page']]),
          ['request_more_information', 'Request changes'], ['continue_review', 'Continue review'], ['escalate', 'Escalate']
        ].map(([value, label]) => <button key={value} className={action === value ? 'selected' : ''} onClick={() => setAction(value)}>{label}</button>)}</div> : <p className="muted">{campaign.status === 'live' ? 'Campaign is published.' : campaign.status === 'action_required' ? 'Waiting for the creator to revise and resubmit.' : 'Decisions become available when the campaign enters human review.'}</p>}
        {action && <><label className="review-action-note"><span>{action === 'request_more_information' ? 'Clear feedback for the creator *' : 'Decision note (optional)'}</span><textarea value={actionNote} onChange={e => setActionNote(e.target.value)} placeholder={action === 'request_more_information' ? 'What exactly should the creator change or provide?' : 'Add context for the review history'} rows="3" /></label><button className="button primary" disabled={actionBusy || (['request_more_information','escalate'].includes(action) && !actionNote.trim())} onClick={recordAction}>{actionBusy ? 'Saving…' : action === 'publish' ? 'Publish campaign' : 'Record decision'}</button></>}
        {campaign.status === 'live' && campaign.public_slug && <Link className="button primary" to={'/campaign/' + campaign.public_slug}>Open live page <ArrowRight size={16} /></Link>}
        {data.actions?.length > 0 && <div className="review-action-history"><strong>Decision history</strong>{data.actions.map(item => <div key={item.id}><b>{({ continue_review: 'Continue review', request_more_information: 'Changes requested', escalate: 'Escalated', approve_content: 'Content approved', publish: 'Published' })[item.action] || item.action}</b><small>{date(item.created_at)}</small>{item.note && <p>{item.note}</p>}</div>)}</div>}
      </div></aside></div>{preview && <div className="file-preview-backdrop" role="dialog" aria-modal="true" aria-label="Document preview"><div className="file-preview"><div><strong>Uploaded document</strong><button className="button secondary" onClick={() => setPreview(null)}>Close</button></div>{preview.mime.startsWith("image/") ? <img src={preview.url} alt="Uploaded document" /> : <iframe src={preview.url} title="Uploaded PDF document" />}</div></div>}</>}
  </Shell>
}

function LiveCampaign() {
  const { slug } = useParams()
  const [campaign, setCampaign] = useState(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  async function load() {
    setError(''); setLoading(true)
    try { setCampaign(await api('/public/campaigns/' + encodeURIComponent(slug))) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [slug])
  async function share() { try { await navigator.clipboard.writeText(window.location.href); setCopied(true) } catch { setError('Could not copy this link. Use your browser address bar to share it.') } }
  return <div className="live-page"><header className="live-topbar"><Link className="brand" to="/creator"><span className="brand-mark"><Check size={20} /></span><span>reviewready<small>CAMPAIGN STORIES</small></span></Link><Link to="/creator">Campaign workspace <ArrowRight size={16} /></Link></header>
    {error && !campaign ? <main className="live-container"><Notice tone="error">{error} <button className="button secondary" onClick={load} disabled={loading}>Try again</button></Notice></main> : !campaign ? <main className="live-container"><Loading /></main> : <main className="live-container">{error && <Notice tone="error">{error}</Notice>}<div className="live-hero"><div className="eyebrow">LIVE CAMPAIGN · {categories[campaign.category] || campaign.category}</div><h1>{campaign.title}</h1><p>Published {date(campaign.published_at)}</p></div><div className="live-layout"><div className="live-story"><section><h2>Our story</h2><p>{campaign.story}</p></section><section><h2>Who this helps</h2><p>{campaign.beneficiary}</p><p>{campaign.beneficiary_relationship}</p></section><section><h2>How funds will be used</h2><p>{campaign.fund_usage}</p></section><section><h2>How support will reach them</h2><p>{campaign.fund_delivery}</p></section></div><aside className="live-goal"><span>Fundraising goal</span><strong>{money(campaign.goal_amount)}</strong><p>This campaign has passed the prototype’s human review and identity checks. Donation processing is not connected in this prototype.</p><button className="button primary" onClick={share}>{copied ? 'Link copied' : 'Share this campaign'} <ArrowRight size={16} /></button></aside></div></main>}
  </div>
}

export default function App() { return <Routes><Route path="/" element={<Navigate to="/creator" replace />} /><Route path="/creator" element={<CreatorHome />} /><Route path="/creator/new" element={<FundraiserWizard />} /><Route path="/creator/campaign/:id" element={<FundraiserWizard />} /><Route path="/reviewer" element={<ReviewerHome />} /><Route path="/reviewer/queue" element={<ReviewQueue />} /><Route path="/reviewer/campaign/:id" element={<ReviewDetail />} /><Route path="/campaign/:slug" element={<LiveCampaign />} /><Route path="*" element={<Navigate to="/creator" replace />} /></Routes> }
