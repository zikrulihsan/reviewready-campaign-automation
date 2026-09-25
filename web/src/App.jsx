import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom'
import FundraiserWizard from './FundraiserWizard.jsx'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, CircleAlert, ClipboardList, FileCheck2, FilePlus2, FileText, FolderOpen, LayoutDashboard, Plus, RefreshCw, Search, ShieldCheck, Sparkles } from 'lucide-react'

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
const shortId = id => id ? '#' + id.slice(0, 8).toUpperCase() : ''
const docName = name => docLabels[name] || name?.replaceAll('_', ' ') || 'Document'
const displayTitle = title => title === 'Demo lengkap: Perlengkapan belajar' ? 'Complete demo: Learning supplies' : title || 'Untitled campaign'

function Badge({ state, packet }) {
  const labels = { initial_review: 'Automated review', action_required: 'Action needed', ready_for_review: 'Ready for review', ready_for_review_with_notes: 'Ready with notes', submitted: 'Ready for review', READY_FOR_REVIEW: 'Ready for review', READY_WITH_NOTES: 'Ready with notes', HIGH_FRICTION: 'Needs clarification', NEEDS_IMPROVEMENT: 'Needs clarification' }
  const label = packet === 'pending' ? 'Packet processing' : labels[state] || 'Draft'
  const tone = packet === 'pending' || state === 'initial_review' || state === 'NEEDS_IMPROVEMENT' || state === 'action_required' || state === 'READY_WITH_NOTES' || state === 'ready_for_review_with_notes' ? 'amber' : state === 'HIGH_FRICTION' ? 'red' : state === 'READY_FOR_REVIEW' || state === 'ready_for_review' || state === 'submitted' ? 'green' : 'slate'
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
    <section className="panel review-panel"><div className="panel-heading"><div><div className="eyebrow">02 / REVIEWER AI</div><h2>Campaign review</h2><p>A deeper look at the purpose, people, plan, and consistency.</p></div></div>
      {!available ? <div className="ops-empty"><p>{review?.status === 'unavailable' ? 'The detailed AI review is unavailable right now. You can continue manually or try again.' : 'The detailed AI review has not run for this version of the campaign yet.'}</p><button className="button secondary" disabled={busy} onClick={onRun}>{busy ? 'Reviewing…' : 'Run detailed AI review'}</button></div> : <><p className="ops-summary">{review.campaign_summary}</p><OpsFindings findings={review.campaign_findings} emptyText="No additional campaign concerns were identified. Review the original information before deciding next steps." /></>}
    </section>
    <section className="panel review-panel"><div className="panel-heading"><div><div className="eyebrow">03 / REVIEWER AI</div><h2>Information completeness</h2><p>What is provided and what may need follow-up.</p></div></div>
      {!available ? <p className="muted">Run the detailed AI review to see the completeness analysis.</p> : <><p className="ops-summary">{review.completeness_summary}</p>{review.provided_information?.length > 0 && <div className="ops-provided"><strong>Already provided</strong><ul>{review.provided_information.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}<h3 className="ops-subheading">Possible follow-up</h3><OpsFindings findings={review.completeness_findings} emptyText="No additional information gaps were identified." /></>}
    </section>
  </>
}

function Shell({ role, children }) {
  const creator = role === 'creator'
  return <div className="app-shell">
    <aside className="sidebar">
      <Link className="brand" to={creator ? '/creator' : '/reviewer'}><span className="brand-mark"><Sparkles size={20} strokeWidth={2.5} /></span><span>reviewready<small>CAMPAIGN WORKSPACE</small></span></Link>
      <div className="workspace-tag"><span className={'role-mark ' + role}>{creator ? <FilePlus2 size={17} /> : <ShieldCheck size={17} />}</span><div><strong>{creator ? 'Campaign creator' : 'Review team'}</strong><small>{creator ? 'Submission workspace' : 'Review workspace'}</small></div></div>
      <p className="nav-caption">MAIN MENU</p>
      <nav className="side-nav" aria-label="Main navigation">
        <NavLink to={creator ? '/creator' : '/reviewer'} end><LayoutDashboard size={18} /> Overview</NavLink>
        {creator ? <NavLink to="/creator/new"><Plus size={18} /> New campaign</NavLink> : <NavLink to="/reviewer/queue"><ClipboardList size={18} /> Review queue</NavLink>}
      </nav>
      <div className="sidebar-bottom"><div className="local-indicator"><span /> Local system running</div><p>A local simulation for preparing and reviewing campaigns.</p><Link to={creator ? '/reviewer' : '/creator'} className="switch-role">{creator ? 'Switch to reviewer' : 'Switch to creator'} <ArrowRight size={15} /></Link></div>
    </aside>
    <div className="content-shell">
      <header className="topbar"><span className="breadcrumb">Workspace <ChevronRight size={15} /> <strong>{creator ? 'Campaign creator' : 'Reviewer'}</strong></span><div className="topbar-right"><Link className="top-switch" to={creator ? '/reviewer' : '/creator'}>{creator ? 'Reviewer workspace' : 'Creator workspace'} <ArrowRight size={14} /></Link><span className="simulation-pill">LOCAL SIMULATION</span><span className="avatar">{creator ? 'PC' : 'RV'}</span></div></header>
      <main className="main-content">{children}</main>
    </div>
  </div>
}

function CreatorHome() {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api('/campaigns').then(setItems).catch(e => setError(e.message)) }, [])
  const draft = items?.filter(item => item.status === 'draft') || []
  const sent = items?.filter(item => ['submitted', 'ready_for_review', 'ready_for_review_with_notes'].includes(item.status)) || []
  return <Shell role="creator">
    <div className="page-heading"><div><div className="eyebrow">CAMPAIGN CREATOR</div><h1>Your campaigns</h1><p>Prepare your story and submit it into the automated review flow.</p></div><Link className="button primary" to="/creator/new"><Plus size={18} /> Create campaign</Link></div>
    <div className="metric-grid"><div className="metric"><span>Total campaigns</span><strong>{items?.length ?? '—'}</strong><small>All submissions in this simulation</small></div><div className="metric"><span>Active drafts</span><strong>{items ? draft.length : '—'}</strong><small>Ready to continue</small></div><div className="metric"><span>Submitted</span><strong>{items ? sent.length : '—'}</strong><small>In the reviewer queue</small></div></div>
    <div className="section-head"><div><h2>Campaign list</h2><p>Continue a draft or check a submission.</p></div></div>
    {error && <Notice tone="error">{error}</Notice>}
    {!items && !error ? <Loading /> : items?.length ? <div className="table-card"><div className="table-scroll"><table><thead><tr><th>CAMPAIGN</th><th>CATEGORY</th><th>GOAL</th><th>STATUS</th><th>UPDATED</th><th /></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><Link className="table-title" to={'/creator/campaign/' + item.id}>{displayTitle(item.title)}</Link><small>{shortId(item.id)}</small></td><td>{categories[item.category]}</td><td>{money(item.goal_amount)}</td><td><Badge state={item.status} /></td><td>{date(item.updated_at)}</td><td><Link className="row-arrow" to={'/creator/campaign/' + item.id} aria-label="Open campaign"><ChevronRight size={19} /></Link></td></tr>)}</tbody></table></div></div> : <Empty title="No campaigns yet" text="Create your first campaign to try the preparation and review flow." action={<Link className="button primary" to="/creator/new"><Plus size={17} /> Create campaign</Link>} />}
    <div className="info-strip"><Sparkles size={19} /><span>After submission, automation checks clarity and routes the campaign. A human reviewer makes the final decision.</span></div>
  </Shell>
}

function ReviewerHome() {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api('/ops/reviews').then(setItems).catch(e => setError(e.message)) }, [])
  const ready = items?.filter(x => x.packet_status === 'ready') || []
  const pending = items?.filter(x => x.packet_status !== 'ready') || []
  return <Shell role="reviewer"><div className="page-heading"><div><div className="eyebrow">REVIEW TEAM</div><h1>Review workspace</h1><p>Monitor submissions and inspect supporting information.</p></div><Link className="button primary" to="/reviewer/queue">Open queue <ArrowRight size={18} /></Link></div>
    <div className="metric-grid"><div className="metric"><span>Incoming submissions</span><strong>{items?.length ?? '—'}</strong><small>Total submitted campaigns</small></div><div className="metric"><span>Packets ready</span><strong>{items ? ready.length : '—'}</strong><small>Full summaries available</small></div><div className="metric"><span>Processing</span><strong>{items ? pending.length : '—'}</strong><small>Waiting for n8n</small></div></div>
    <div className="section-head"><div><h2>Recent submissions</h2><p>Choose a campaign to see its review details.</p></div><Link to="/reviewer/queue" className="text-link">View all <ArrowRight size={16} /></Link></div>
    {error && <Notice tone="error">{error}</Notice>}{!items && !error ? <Loading /> : items?.length ? <ReviewTable items={items.slice(0,5)} /> : <Empty icon={ClipboardList} title="The queue is empty" text="Campaigns appear here after a creator submits them." action={<Link className="button secondary" to="/creator">Open creator workspace <ArrowRight size={16} /></Link>} />}
    <div className="info-strip"><ShieldCheck size={19} /><span>A human reviewer makes the decision. Automated readiness is supporting information only.</span></div>
  </Shell>
}
function ReviewTable({ items }) { return <div className="table-card"><div className="table-scroll"><table><thead><tr><th>CAMPAIGN</th><th>CATEGORY</th><th>ROUTING</th><th>PACKET</th><th /></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><Link className="table-title" to={'/reviewer/campaign/' + item.id}>{displayTitle(item.title)}</Link><small>{shortId(item.id)}</small></td><td>{categories[item.category]}</td><td><Badge state={item.status} /></td><td><Badge packet={item.packet_status === 'ready' ? undefined : 'pending'} state={item.status === 'ready_for_review_with_notes' ? 'READY_WITH_NOTES' : 'READY_FOR_REVIEW'} /></td><td><Link className="row-arrow" to={'/reviewer/campaign/' + item.id} aria-label="Open review"><ChevronRight size={19} /></Link></td></tr>)}</tbody></table></div></div> }
function ReviewQueue() {
  const [items, setItems] = useState(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')
  async function refresh() { try { setItems(await api('/ops/reviews')); setError('') } catch (e) { setError(e.message) } }
  useEffect(() => { refresh() }, [])
  const filtered = (items || []).filter(item => (filter === 'all' || (filter === 'ready' ? item.packet_status === 'ready' : item.packet_status !== 'ready')) && displayTitle(item.title).toLowerCase().includes(query.toLowerCase()))
  return <Shell role="reviewer"><div className="page-heading"><div><div className="eyebrow">REVIEW QUEUE</div><h1>Incoming submissions</h1><p>Browse submitted campaigns for review.</p></div><button className="button secondary" onClick={refresh}><RefreshCw size={17} /> Refresh</button></div>
    <div className="toolbar"><div className="search"><Search size={18} /><input aria-label="Search campaigns" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search campaign titles…" /></div><div className="filter-tabs">{[['all','All'],['ready','Packets ready'],['pending','Processing']].map(([key,label]) => <button className={filter === key ? 'active' : ''} key={key} onClick={() => setFilter(key)}>{label}</button>)}</div></div>
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
  async function runOpsReview() {
    setAiBusy(true); setError(''); setActionMessage('')
    try {
      await api('/ops/reviews/' + encodeURIComponent(id) + '/refresh-ai', { method: 'POST' })
      await refresh()
      setActionMessage('Detailed AI review updated. Please check its findings yourself.')
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
  async function refresh() { setRefreshing(true); try { setData(await api('/ops/reviews/' + encodeURIComponent(id))); setError('') } catch(e) { setError(e.message) } finally { setRefreshing(false) } }
  useEffect(() => { refresh() }, [id])
  const campaign = data?.campaign || {}
  const packet = data?.packet
  const req = packet?.requirements || {}
  const sem = packet?.semantic || {}
  const ops = packet?.ops_review || { status: 'not_run' }
  const missing = [...(req.missing_fields || []).map(x => 'Field: ' + (fieldLabels[x] || x)), ...(req.invalid_fields || []).map(x => x)]
  return <Shell role="reviewer"><Link className="back-link" to="/reviewer/queue"><ArrowLeft size={16} /> Back to queue</Link>
    {error && <Notice tone="error">{error}</Notice>}{!data && !error ? <Loading /> : data && <><div className="page-heading editor-heading"><div><div className="eyebrow">REVIEW PACKET · {shortId(id)}</div><h1>{displayTitle(campaign.title)}</h1><p>Submitted for human review · {categories[campaign.category]}</p></div><button className="button secondary" onClick={refresh} disabled={refreshing}><RefreshCw size={17} /> {refreshing ? 'Loading…' : 'Refresh'}</button></div>
      <div className="review-summary"><div><span>Funding goal</span><strong>{money(campaign.goal_amount)}</strong></div><div><span>Creator profile</span><strong>{profiles[campaign.profile_type]}</strong></div><div><span>Routing status</span><Badge state={campaign.status} /></div><div><span>Packet status</span><Badge packet={data.status === 'ready' ? undefined : 'pending'} state={campaign.status === 'ready_for_review_with_notes' ? 'READY_WITH_NOTES' : 'READY_FOR_REVIEW'} /></div></div>
      {campaign.submitted_with_warning && <Notice><strong>Creator override:</strong>&nbsp; The creator reviewed the automated suggestions and submitted without changes. Treat the notes as context for human review.</Notice>}{actionMessage && <Notice tone="success">{actionMessage}</Notice>}
      {packet?.ops_attention && <Notice tone="error">Some supporting documents may not match the campaign purpose. Review them manually.</Notice>}
      {data.status !== 'ready' && <Notice>n8n is preparing the review packet. You can inspect the campaign information below now.</Notice>}
      <div className="review-layout"><div className="review-main">
        <section className="panel review-panel"><div className="panel-heading"><div><div className="eyebrow">01 / INFORMATION</div><h2>Campaign overview</h2></div></div><div className="detail-block"><span>Campaign story</span><p>{campaign.story || 'Not provided'}</p></div><div className="detail-pair"><div><span>Beneficiary</span><strong>{campaign.beneficiary || '—'}</strong></div><div><span>Relationship</span><strong>{campaign.beneficiary_relationship || '—'}</strong></div></div><div className="detail-block"><span>Use of funds</span><p>{campaign.fund_usage || 'Not provided'}</p></div><div className="detail-block"><span>How funds will be delivered</span><p>{campaign.fund_delivery || 'Not provided'}</p></div>{campaign.category === 'travel' && <div className="detail-pair"><div><span>Purpose of travel</span><strong>{campaign.travel_purpose || '—'}</strong></div><div><span>Destination</span><strong>{campaign.destination || '—'}</strong></div></div>}</section>
        <OpsReviewSections review={ops} onRun={runOpsReview} busy={aiBusy} />
        <section className="panel review-panel"><div className="panel-heading"><div><div className="eyebrow">04 / EVIDENCE</div><h2>Supporting documents</h2><p>{data.documents?.length || 0} documents added</p></div></div>{data.documents?.length ? <div className="document-review-list">{data.documents.map(doc => <div className="document-review" key={doc.id}><span className="doc-icon"><FileText size={20} /></span><div><strong>{doc.filename}</strong><small>{docName(doc.document_type)}</small>{doc.analysis?.finding && <p>{doc.analysis.finding}</p>}{doc.extracted_text && <details><summary>View sample text</summary><p>{doc.extracted_text}</p></details>}</div></div>)}</div> : <p className="muted">No supporting documents.</p>}</section>
      </div><aside className="review-side"><div className="context-card"><div className="eyebrow">REVIEW SUMMARY</div><h3>Required campaign fields</h3>{!packet ? <p className="muted">The automated summary appears after n8n finishes processing.</p> : missing.length ? <div className="side-list">{missing.map((item,i) => <div key={i}><CircleAlert size={16} />{item}</div>)}</div> : <div className="side-success"><CheckCircle2 size={18} /> Required campaign fields complete</div>}</div><div className="context-card"><div className="eyebrow">PRE-SUBMIT READINESS</div><h3>Earlier clarity notes</h3>{!packet ? <p className="muted">Waiting for the packet.</p> : sem.status === 'unavailable' ? <p className="muted">AI analysis is unavailable. Continue with manual review.</p> : sem.issues?.length ? <div className="side-list">{sem.issues.map((issue,i) => <div key={i}><CircleAlert size={16} />{issue.feedback || issue.evidence || issue.type}</div>)}</div> : <p className="muted">No major clarity issues found.</p>}</div><div className="context-card"><div className="eyebrow">HUMAN REVIEW</div><h3>Next action</h3><div className="review-action-options">{[["continue_review", "Continue review"], ["request_more_information", "Request more information"], ["escalate", "Escalate"]].map(([value, label]) => <button key={value} className={action === value ? "selected" : ""} onClick={() => setAction(value)}>{label}</button>)}</div>{action && <><label className="review-action-note"><span>Internal note {action === "continue_review" ? "(optional)" : "*"}</span><textarea value={actionNote} onChange={e => setActionNote(e.target.value)} placeholder="What should the reviewer do next?" rows="3" /></label><button className="button primary" disabled={actionBusy || (action !== "continue_review" && !actionNote.trim())} onClick={recordAction}>{actionBusy ? "Saving…" : "Record action"}</button></>}{data.actions?.length > 0 && <div className="review-action-history"><strong>Recent actions</strong>{data.actions.map(item => <div key={item.id}><b>{({ continue_review: "Continue review", request_more_information: "Information requested", escalate: "Escalated" })[item.action]}</b><small>{date(item.created_at)}</small>{item.note && <p>{item.note}</p>}</div>)}</div>}<p className="muted">These are internal workflow actions. No message is sent to the creator.</p></div></aside></div></>}
  </Shell>
}

export default function App() { return <Routes><Route path="/" element={<Navigate to="/creator" replace />} /><Route path="/creator" element={<CreatorHome />} /><Route path="/creator/new" element={<FundraiserWizard />} /><Route path="/creator/campaign/:id" element={<FundraiserWizard />} /><Route path="/reviewer" element={<ReviewerHome />} /><Route path="/reviewer/queue" element={<ReviewQueue />} /><Route path="/reviewer/campaign/:id" element={<ReviewDetail />} /><Route path="*" element={<Navigate to="/creator" replace />} /></Routes> }
