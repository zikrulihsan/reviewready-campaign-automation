import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom'
import FundraiserWizard from './FundraiserWizard.jsx'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, CircleAlert, ClipboardList, FileCheck2, FilePlus2, FileText, FolderOpen, LayoutDashboard, Plus, RefreshCw, Search, ShieldCheck } from 'lucide-react'

const categories = { medical: 'Medical', education: 'Education', rent: 'Housing / rent', travel: 'Travel', business_product: 'Business / product', refugee_asylum: 'Refugee / asylum', vehicle: 'Vehicle', other: 'Other' }
const profiles = { self: 'Myself', behalf_of_other: 'Someone else', organization: 'Organization' }
const docLabels = { organizer_id: 'Campaign creator ID', beneficiary_id: 'Beneficiary ID', recent_bank_statement: 'Recent bank statement', organization_registration: 'Organization registration', medical_supporting_evidence: 'Medical supporting evidence', signed_rental_agreement: 'Signed rental agreement', accommodation_invoice: 'Accommodation invoice', flight_invoice: 'Flight invoice', vehicle_quote_or_purchase_agreement: 'Vehicle quote / purchase agreement', student_id: 'Student ID', acceptance_letter: 'Acceptance letter' }
const fieldLabels = { title: 'Campaign title', story: 'Campaign story', beneficiary: 'Beneficiary', beneficiary_relationship: 'Relationship to beneficiary', fund_usage: 'Use of funds', fund_delivery: 'How funds will be delivered', goal_amount: 'Funding goal', travel_purpose: 'Purpose of travel', destination: 'Destination' }

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
  const labels = { initial_review: 'Preparing', automation_failed: 'Preparation paused', action_required: 'Update requested', ready_for_review: 'In queue', ready_for_review_with_notes: 'In queue · notes', submitted: 'In queue', READY_FOR_REVIEW: 'In queue', READY_WITH_NOTES: 'In queue · notes', HIGH_FRICTION: 'Needs clarification', NEEDS_IMPROVEMENT: 'Needs clarification' }
  const label = state === 'automation_failed' ? labels[state] : packet === 'pending' ? 'Preparing details' : labels[state] || 'Draft'
  const tone = packet === 'pending' || state === 'initial_review' || state === 'automation_failed' || state === 'NEEDS_IMPROVEMENT' || state === 'action_required' || state === 'READY_WITH_NOTES' || state === 'ready_for_review_with_notes' ? 'amber' : state === 'HIGH_FRICTION' ? 'red' : state === 'READY_FOR_REVIEW' || state === 'ready_for_review' || state === 'submitted' ? 'green' : 'slate'
  return <span className={'badge ' + tone}><span className="badge-dot" />{label}</span>
}
function Notice({ children, tone = 'info' }) { return <div className={'notice ' + tone}><CircleAlert size={18} /><div>{children}</div></div> }
function Empty({ icon: Icon = FolderOpen, title, text, action }) { return <div className="empty"><span className="empty-icon"><Icon size={26} /></span><h3>{title}</h3><p>{text}</p>{action}</div> }
function Loading() { return <div className="loading"><span className="spinner" /> Loading data…</div> }

function OpsFindings({ findings, emptyText }) {
  if (!findings?.length) return <p className="muted">{emptyText}</p>
  return <div className="ops-findings">{findings.map((finding, index) => <article className="ops-finding" key={index}><div className="ops-finding-head"><strong>{finding.topic}</strong><span className={'ops-priority ' + finding.priority}>{finding.priority} priority</span></div><p>{finding.observation}</p><small><b>Evidence:</b> {finding.evidence}</small><small><b>Ask:</b> {finding.reviewer_question}</small></article>)}</div>
}

function OpsReviewSections({ review, onRun, busy }) {
  const available = review?.status === 'complete'
  return <>
    <section className="panel review-panel"><div className="panel-heading"><div><div className="eyebrow">CAMPAIGN NOTES</div><h2>Points to consider</h2><p>Purpose, beneficiary, use of funds, delivery plan, and internal consistency.</p></div></div>
      {!available ? <div className="ops-empty"><p>{review?.status === 'unavailable' ? 'Notes are unavailable right now. You can continue or try again.' : 'Notes have not been prepared for this version yet.'}</p><button className="button secondary" disabled={busy} onClick={onRun}>{busy ? 'Reviewing…' : 'Prepare notes'}</button></div> : <><p className="ops-summary">{review.campaign_summary}</p><OpsFindings findings={review.campaign_findings} emptyText="No additional campaign concerns were identified. Review the original information before deciding next steps." /></>}
    </section>
    <section className="panel review-panel"><div className="panel-heading"><div><div className="eyebrow">FOLLOW-UP</div><h2>Information completeness</h2><p>What is provided and what may need follow-up.</p></div></div>
      {!available ? <p className="muted">Prepare notes to see possible information gaps.</p> : <><p className="ops-summary">{review.completeness_summary}</p>{review.provided_information?.length > 0 && <div className="ops-provided"><strong>Already provided</strong><ul>{review.provided_information.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}<h3 className="ops-subheading">Possible follow-up</h3><OpsFindings findings={review.completeness_findings} emptyText="No additional information gaps were identified." /></>}
    </section>
  </>
}

function Shell({ role, children }) {
  const creator = role === 'creator'
  return <div className="app-shell">
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
  const sent = items?.filter(item => ['submitted', 'initial_review', 'automation_failed', 'ready_for_review', 'ready_for_review_with_notes'].includes(item.status)) || []
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
  const ready = items?.filter(x => x.packet_status === 'ready') || []
  const pending = items?.filter(x => x.packet_status !== 'ready') || []
  return <Shell role="reviewer"><div className="page-heading"><div><div className="eyebrow">REVIEW TEAM</div><h1>Review workspace</h1><p>Monitor submissions and inspect supporting information.</p></div><Link className="button primary" to="/reviewer/queue">Open queue <ArrowRight size={18} /></Link></div>
    <div className="metric-grid"><div className="metric"><span>Incoming submissions</span><strong>{items?.length ?? '—'}</strong><small>Total submitted campaigns</small></div><div className="metric"><span>Ready to review</span><strong>{items ? ready.length : '—'}</strong><small>Review information available</small></div><div className="metric"><span>Processing</span><strong>{items ? pending.length : '—'}</strong><small>Preparing review details</small></div></div>
    <div className="section-head"><div><h2>Recent submissions</h2><p>Choose a campaign to see its review details.</p></div><Link to="/reviewer/queue" className="text-link">View all <ArrowRight size={16} /></Link></div>
    {error && <Notice tone="error">{error}</Notice>}{!items && !error ? <Loading /> : items?.length ? <ReviewTable items={items.slice(0,5)} /> : <Empty icon={ClipboardList} title="The queue is empty" text="Campaigns appear here after a creator submits them." action={<Link className="button secondary" to="/creator">Open creator workspace <ArrowRight size={16} /></Link>} />}
    <div className="info-strip"><ShieldCheck size={19} /><span>Checks and notes help reviewers focus. The review team decides the next action.</span></div>
  </Shell>
}
function ReviewTable({ items }) { return <div className="table-card"><div className="table-scroll"><table><thead><tr><th>CAMPAIGN</th><th>CATEGORY</th><th>PRIORITY</th><th>ROUTING</th><th>DETAILS</th><th /></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><Link className="table-title" to={'/reviewer/campaign/' + item.id}>{displayTitle(item.title)}</Link><small>{shortId(item.id)}</small></td><td>{categories[item.category]}</td><td><span className={'priority-tag ' + item.priority_status}>{item.priority_status === 'confirmed' ? 'Confirmed' : item.priority_status === 'requested' ? 'Requested' : 'Standard'}</span>{item.urgency_deadline && <small>By {deadlineDate(item.urgency_deadline)}</small>}</td><td><Badge state={item.status} /></td><td><Badge packet={item.packet_status === 'ready' ? undefined : 'pending'} state={item.status === 'ready_for_review_with_notes' ? 'READY_WITH_NOTES' : 'READY_FOR_REVIEW'} /></td><td><Link className="row-arrow" to={'/reviewer/campaign/' + item.id} aria-label="Open review"><ChevronRight size={19} /></Link></td></tr>)}</tbody></table></div></div> }
function ReviewQueue() {
  const [items, setItems] = useState(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')
  async function refresh() { try { setItems(await api('/ops/reviews')); setError('') } catch (e) { setError(e.message) } }
  useEffect(() => { refresh() }, [])
  const filtered = (items || []).filter(item => (filter === 'all' || (filter === 'ready' ? item.packet_status === 'ready' : filter === 'pending' ? item.packet_status !== 'ready' : item.priority_status === 'requested')) && displayTitle(item.title).toLowerCase().includes(query.toLowerCase()))
  return <Shell role="reviewer"><div className="page-heading"><div><div className="eyebrow">REVIEW QUEUE</div><h1>Incoming submissions</h1><p>Browse submitted campaigns for review.</p></div><button className="button secondary" onClick={refresh}><RefreshCw size={17} /> Refresh</button></div>
    <div className="toolbar"><div className="search"><Search size={18} /><input aria-label="Search campaigns" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search campaign titles…" /></div><div className="filter-tabs">{[['all','All'],['ready','Ready'],['pending','Processing'],['priority','Priority requests']].map(([key,label]) => <button className={filter === key ? 'active' : ''} key={key} onClick={() => setFilter(key)}>{label}</button>)}</div></div>
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
      setAction(''); setActionNote(''); setActionMessage('Review action recorded.')
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
  const levelLabel = ({ strong: 'Strong', reviewable: 'Reviewable', needs_attention: 'Needs attention', unavailable: 'Analysis unavailable' })[assessment.level] || 'Pending'
  const missing = [...(req.missing_fields || []).map(x => 'Field: ' + (fieldLabels[x] || x)), ...(req.invalid_fields || []).map(x => x)]
  return <Shell role="reviewer"><Link className="back-link" to="/reviewer/queue"><ArrowLeft size={16} /> Back to queue</Link>
    {error && <Notice tone="error">{error}</Notice>}{!data && !error ? <Loading /> : data && <><div className="page-heading editor-heading"><div><div className="eyebrow">SUBMISSION · {shortId(id)}</div><h1>{displayTitle(campaign.title)}</h1><p>Submitted · {categories[campaign.category]}</p></div><button className="button secondary" onClick={refresh} disabled={refreshing}><RefreshCw size={17} /> {refreshing ? 'Loading…' : 'Refresh'}</button></div>
      <div className="review-summary"><div><span>Funding goal</span><strong>{money(campaign.goal_amount)}</strong></div><div><span>Creator profile</span><strong>{profiles[campaign.profile_type]}</strong></div><div><span>Routing status</span><Badge state={campaign.status} /></div><div><span>Submission quality</span><strong>{assessment.score != null ? `${assessment.score}/100 · ${levelLabel}` : levelLabel}</strong><small>{assessment.creator_submission_count ? `Creator submission ${assessment.creator_submission_count}` : 'Internal routing assessment'}</small></div></div>
      {packet && <div className="review-assessment"><strong>Reviewability breakdown</strong><span>Completeness {assessment.breakdown?.completeness ?? '—'}/30</span><span>Clarity {assessment.breakdown?.clarity ?? '—'}/50</span><span>Consistency {assessment.breakdown?.consistency ?? '—'}/20</span><span>Recommendation: {String(assessment.recommendation || 'pending').replaceAll('_', ' ')}</span></div>}
      {campaign.expedited_requested && <div className="review-priority"><div><strong>Expedited review requested</strong><p>{campaign.urgency_reason || 'No reason provided.'}{campaign.urgency_deadline ? ` Deadline: ${deadlineDate(campaign.urgency_deadline)}.` : ''}</p><small>Status: {campaign.priority_status === 'confirmed' ? 'priority confirmed' : campaign.priority_status === 'requested' ? 'awaiting reviewer triage' : 'standard queue'}. Review timing is not guaranteed.</small></div>{['ready_for_review','ready_for_review_with_notes','submitted'].includes(campaign.status) && <div className="review-priority-actions"><button className="button primary" disabled={priorityBusy || campaign.priority_status === 'confirmed'} onClick={() => setPriority('confirmed')}>Confirm priority</button><button className="button secondary" disabled={priorityBusy || campaign.priority_status === 'standard'} onClick={() => setPriority('standard')}>Standard queue</button></div>}{data.priority_events?.length > 0 && <details><summary>Priority history</summary>{data.priority_events.map(event => <p key={event.id}>{date(event.created_at)} · {event.priority_status === 'confirmed' ? 'Confirmed' : 'Standard queue'}{event.note ? ` · ${event.note}` : ''}</p>)}</details>}</div>}
      {campaign.submitted_with_warning && <Notice><strong>Submitted with notes:</strong>&nbsp; Review the remaining information gaps alongside the campaign.</Notice>}{actionMessage && <Notice tone="success">{actionMessage}</Notice>}
      {packet?.ops_attention && <Notice tone="error">Some supporting documents may not match the campaign purpose. Review them manually.</Notice>}
      {campaign.status === 'automation_failed' || data.packet_status === 'failed' ? <Notice tone="error">Automated preparation paused. You can inspect the campaign now; the creator can retry preparation once.</Notice> : data.status !== 'ready' && <Notice>Review details are being prepared. You can inspect the campaign information below now.</Notice>}
      <div className="review-layout"><div className="review-main">
        <section className="panel review-panel"><div className="panel-heading"><div><div className="eyebrow">01 / INFORMATION</div><h2>Campaign overview</h2></div></div><div className="detail-block"><span>Campaign story</span><p>{campaign.story || 'Not provided'}</p></div><div className="detail-pair"><div><span>Beneficiary</span><strong>{campaign.beneficiary || '—'}</strong></div><div><span>Relationship</span><strong>{campaign.beneficiary_relationship || '—'}</strong></div></div><div className="detail-block"><span>Use of funds</span><p>{campaign.fund_usage || 'Not provided'}</p></div><div className="detail-block"><span>How funds will be delivered</span><p>{campaign.fund_delivery || 'Not provided'}</p></div>{campaign.category === 'travel' && <div className="detail-pair"><div><span>Purpose of travel</span><strong>{campaign.travel_purpose || '—'}</strong></div><div><span>Destination</span><strong>{campaign.destination || '—'}</strong></div></div>}</section>
        <OpsReviewSections review={ops} onRun={runOpsReview} busy={aiBusy} />
        <section className="panel review-panel"><div className="panel-heading"><div><div className="eyebrow">04 / EVIDENCE</div><h2>Supporting documents</h2><p>{data.documents?.length || 0} documents added</p></div></div>{data.documents?.length ? <div className="document-review-list">{data.documents.map(doc => <div className="document-review" key={doc.id}><span className="doc-icon"><FileText size={20} /></span><div><strong>{doc.filename}</strong><small>{docName(doc.document_type)}</small>{doc.analysis?.finding && <p>{doc.analysis.finding}</p>}{doc.extracted_text && <details><summary>View sample text</summary><p>{doc.extracted_text}</p></details>}</div></div>)}</div> : <p className="muted">No supporting documents.</p>}</section>
      </div><aside className="review-side"><div className="context-card"><div className="eyebrow">REVIEW SUMMARY</div><h3>Required campaign fields</h3>{!packet ? <p className="muted">The summary appears when processing is complete.</p> : missing.length ? <div className="side-list">{missing.map((item,i) => <div key={i}><CircleAlert size={16} />{item}</div>)}</div> : <div className="side-success"><CheckCircle2 size={18} /> Required campaign fields complete</div>}</div><div className="context-card"><div className="eyebrow">EARLIER NOTES</div><h3>Earlier clarity notes</h3>{!packet ? <p className="muted">Preparing the notes.</p> : sem.status === 'unavailable' ? <p className="muted">Earlier notes are unavailable. Continue with the campaign information.</p> : sem.issues?.length ? <div className="side-list">{sem.issues.map((issue,i) => <div key={i}><CircleAlert size={16} />{issue.feedback || issue.evidence || issue.type}</div>)}</div> : <p className="muted">No major clarity issues found.</p>}</div><div className="context-card"><div className="eyebrow">NEXT STEP</div><h3>Next action</h3>{['ready_for_review','ready_for_review_with_notes','submitted'].includes(campaign.status) ? <div className="review-action-options">{[["continue_review", "Continue review"], ["request_more_information", "Request more information"], ["escalate", "Escalate"]].map(([value, label]) => <button key={value} className={action === value ? "selected" : ""} onClick={() => setAction(value)}>{label}</button>)}</div> : <p className="muted">You can record a review action after preparation finishes.</p>}{action && <><label className="review-action-note"><span>Internal note {action === "continue_review" ? "(optional)" : "*"}</span><textarea value={actionNote} onChange={e => setActionNote(e.target.value)} placeholder="What should the reviewer do next?" rows="3" /></label><button className="button primary" disabled={actionBusy || (action !== "continue_review" && !actionNote.trim())} onClick={recordAction}>{actionBusy ? "Saving…" : "Record action"}</button></>}{data.notifications?.length > 0 && <div className="review-action-history"><strong>Demo email prepared</strong>{data.notifications.map(item => <div key={item.id}><b>{item.subject}</b><small>To: {item.recipient} · {item.delivery_status}</small><p>{item.body}</p></div>)}</div>}{data.actions?.length > 0 && <div className="review-action-history"><strong>Recent actions</strong>{data.actions.map(item => <div key={item.id}><b>{({ continue_review: "Continue review", request_more_information: "Information requested", escalate: "Escalated" })[item.action]}</b><small>{date(item.created_at)}</small>{item.note && <p>{item.note}</p>}</div>)}</div>}<p className="muted">Email items shown here are mock notifications. No email is sent.</p></div></aside></div></>}
  </Shell>
}

export default function App() { return <Routes><Route path="/" element={<Navigate to="/creator" replace />} /><Route path="/creator" element={<CreatorHome />} /><Route path="/creator/new" element={<FundraiserWizard />} /><Route path="/creator/campaign/:id" element={<FundraiserWizard />} /><Route path="/reviewer" element={<ReviewerHome />} /><Route path="/reviewer/queue" element={<ReviewQueue />} /><Route path="/reviewer/campaign/:id" element={<ReviewDetail />} /><Route path="*" element={<Navigate to="/creator" replace />} /></Routes> }
