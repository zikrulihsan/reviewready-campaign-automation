import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, CircleAlert, Clock3, FileText, Heart, Landmark, Plus, Users } from 'lucide-react'
import './fundraiser.css'
import './correction-guidance.css'

const stages = ['Who is it for?', 'Campaign details', 'Your story', 'Submit campaign']
const categories = { medical: 'Medical', education: 'Education', rent: 'Housing / rent', travel: 'Travel', business_product: 'Business / product', refugee_asylum: 'Refugee / asylum', vehicle: 'Vehicle', other: 'Other' }
const documents = { organizer_id: 'Organizer ID', beneficiary_id: 'Beneficiary ID', recent_bank_statement: 'Recent bank statement', organization_registration: 'Organization registration', medical_supporting_evidence: 'Medical evidence', signed_rental_agreement: 'Signed rental agreement', accommodation_invoice: 'Accommodation invoice', flight_invoice: 'Flight invoice', vehicle_quote_or_purchase_agreement: 'Vehicle quote or purchase agreement', student_id: 'Student ID', acceptance_letter: 'Acceptance letter' }
const blank = { profile_type: 'self', category: 'medical', title: '', story: '', goal_amount: '', beneficiary: '', beneficiary_relationship: '', fund_usage: '', fund_delivery: '', travel_purpose: '', destination: '', expedited_requested: false, urgency_reason: '', urgency_deadline: '' }
const documentName = value => documents[value] || value.replaceAll('_', ' ')
const readyStatuses = ['submitted', 'ready_for_review', 'ready_for_review_with_notes']
const approvedStatuses = ['awaiting_identity', 'identity_review']

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Something went wrong. Please try again.')
  return data
}

function Input({ label, value, onChange, placeholder, type = 'text', multiline = false, hint }) {
  const fieldId = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return <label className="fund-field" htmlFor={fieldId}><span>{label}</span>{hint && <small>{hint}</small>}{multiline ? <textarea id={fieldId} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} rows="5" /> : <input id={fieldId} type={type} min={type === 'number' ? '0' : undefined} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />}</label>
}

function Select({ label, value, onChange, options }) {
  const fieldId = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return <label className="fund-field" htmlFor={fieldId}><span>{label}</span><select id={fieldId} value={value} onChange={e => onChange(e.target.value)}>{Object.entries(options).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
}

const stepLabels = {
  submission_received: 'Campaign received',
  initial_ai_review: 'Submission check',
  clarification_requested: 'Details requested',
  creator_override: 'Campaigner chose to submit as it is',
  detailed_reviewer_analysis: 'Review notes prepared',
  review_packet_ready: 'Added to review queue',
  mock_notification_prepared: 'Email preview prepared',
  automation_failed: 'Preparation paused',
  automation_retry: 'Preparation restarted',
}

function AutomationTimeline({ items }) {
  const newestFirst = [...items].sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || String(b.id).localeCompare(String(a.id)))
  return <div className="automation-timeline">{newestFirst.map(item => <div className={'automation-step ' + item.status} key={item.id}>{item.status === 'running' ? <Clock3 size={17} /> : item.status === 'action_required' ? <CircleAlert size={17} /> : <CheckCircle2 size={17} />}<span><strong>{stepLabels[item.step] || item.step}</strong><small>{item.detail}</small><time dateTime={item.created_at}>{item.created_at ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.created_at)) : ''}</time></span></div>)}</div>
}

export default function FundraiserWizard() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [campaignId, setCampaignId] = useState(id || '')
  const [campaignStatus, setCampaignStatus] = useState('draft')
  const [priorityStatus, setPriorityStatus] = useState('standard')
  const [stage, setStage] = useState(id ? 1 : 0)
  const [choice, setChoice] = useState('self')
  const [form, setForm] = useState(blank)
  const [savedPayload, setSavedPayload] = useState('')
  const [supporting, setSupporting] = useState([])
  const [automation, setAutomation] = useState([])
  const [requirements, setRequirements] = useState(null)
  const [readiness, setReadiness] = useState(null)
  const [correctionCycle, setCorrectionCycle] = useState(false)
  const [correctionGuidance, setCorrectionGuidance] = useState([])
  const [doc, setDoc] = useState({ document_type: 'organizer_id', extracted_text: '' })
  const [docFile, setDocFile] = useState(null)
  const [humanFeedback, setHumanFeedback] = useState('')
  const [feedbackSource, setFeedbackSource] = useState('')
  const [publicSlug, setPublicSlug] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(Boolean(id))

  const change = (key, value) => { setForm(current => ({ ...current, [key]: value })); setReadiness(null) }
  const isProcessing = campaignStatus === 'initial_review'
  const automationFailed = campaignStatus === 'automation_failed'
  const needsAction = campaignStatus === 'action_required'
  const isReady = readyStatuses.includes(campaignStatus)
  const isApproved = approvedStatuses.includes(campaignStatus)
  const isLive = campaignStatus === 'live'
  const locked = isProcessing || isReady || isApproved || isLive

  async function loadCampaign(currentId, showLoading = false) {
    if (showLoading) setLoading(true)
    try {
      const data = await request('/campaigns/' + encodeURIComponent(currentId))
      const loaded = Object.fromEntries(Object.keys(blank).map(key => [key, data.campaign[key] ?? '']))
      loaded.urgency_deadline = data.campaign.urgency_deadline ? String(data.campaign.urgency_deadline).slice(0, 10) : ''
      setCampaignId(currentId); setForm(loaded); setCampaignStatus(data.campaign.status); setPriorityStatus(data.campaign.priority_status || 'standard')
      setHumanFeedback(data.feedback?.[0]?.note || ''); setFeedbackSource(data.campaign.feedback_source || ''); setPublicSlug(data.campaign.public_slug || '')
      setCorrectionCycle(data.campaign.status === 'action_required' || Number(data.campaign.clarification_rounds || 0) > 0)
      setSavedPayload(JSON.stringify({ ...loaded, goal_amount: Number(loaded.goal_amount || 0), urgency_deadline: loaded.urgency_deadline || null }))
      setChoice(data.campaign.profile_type === 'organization' ? 'organization' : 'self')
      setSupporting(data.documents || []); setAutomation(data.automation || [])
      if (data.campaign.status !== 'draft' && data.campaign.status !== 'action_required') setStage(4)
      if (data.campaign.status === 'action_required') setStage(4)
      if (data.campaign.status !== 'draft') {
        const feedback = await request('/campaigns/' + encodeURIComponent(currentId) + '/readiness').catch(() => null)
        if (feedback) {
          setReadiness(feedback)
          setCorrectionGuidance(feedback.improvement_suggestions || (feedback.semantic?.issues || []).map(item => item.feedback || item.evidence).filter(Boolean))
        }
      }
      return data.campaign.status
    } finally { if (showLoading) setLoading(false) }
  }

  useEffect(() => {
    if (!id) return
    loadCampaign(id, true).catch(e => { setError(e.message); setLoading(false) })
  }, [id])

  useEffect(() => {
    request('/requirements?' + new URLSearchParams({ profile_type: form.profile_type, category: form.category })).then(setRequirements).catch(() => {})
  }, [form.profile_type, form.category])

  useEffect(() => {
    if (!campaignId || !isProcessing) return
    const timer = window.setInterval(() => loadCampaign(campaignId).catch(e => setError(e.message)), 2000)
    return () => window.clearInterval(timer)
  }, [campaignId, isProcessing])

  const suggestedDocuments = useMemo(() => {
    const present = new Set(supporting.map(item => item.document_type))
    return [...(requirements?.required_documents || []).map(type => ({ name: documentName(type), done: present.has(type) })), ...((requirements?.one_of_documents || []).length ? [{ name: 'One of: ' + requirements.one_of_documents.map(documentName).join(' / '), done: requirements.one_of_documents.some(type => present.has(type)) }] : [])]
  }, [requirements, supporting])

  async function saveDraft() {
    if (locked) return campaignId
    const payload = { ...form, profile_type: choice === 'organization' ? 'organization' : form.profile_type === 'behalf_of_other' ? 'behalf_of_other' : 'self', goal_amount: Number(form.goal_amount || 0), urgency_deadline: form.urgency_deadline || null }
    const serialized = JSON.stringify(payload)
    if (campaignId && serialized === savedPayload && campaignStatus === 'draft') return campaignId
    setBusy('save'); setError('')
    try {
      const result = await request(campaignId ? '/campaigns/' + encodeURIComponent(campaignId) : '/campaigns', { method: campaignId ? 'PATCH' : 'POST', body: serialized })
      setCampaignId(result.id); setSavedPayload(serialized); setCampaignStatus('draft')
      if (!campaignId) navigate('/creator/campaign/' + result.id, { replace: true })
      return result.id
    } finally { setBusy('') }
  }

  async function advance() {
    setError(''); setNotice('')
    try {
      if (stage === 1 || stage === 2) await saveDraft()
      setStage(current => Math.min(current + 1, 3))
    } catch (e) { setError(e.message) }
  }

  async function submit() {
    setError(''); setNotice(''); setBusy('submit')
    try {
      const currentId = await saveDraft()
      const result = await request('/campaigns/' + encodeURIComponent(currentId) + '/submit', { method: 'POST', body: JSON.stringify({ expedited_requested: form.expedited_requested, urgency_reason: form.urgency_reason, urgency_deadline: form.urgency_deadline || null }) })
      setCampaignStatus(result.status); setStage(4)
      setNotice('Campaign received. We’re checking your submission.')
      await loadCampaign(currentId)
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  async function submitAsIs() {
    setError(''); setNotice(''); setBusy('override')
    try {
      const result = await request('/campaigns/' + encodeURIComponent(campaignId) + '/submit-as-is', { method: 'POST', body: JSON.stringify({ expedited_requested: form.expedited_requested, urgency_reason: form.urgency_reason, urgency_deadline: form.urgency_deadline || null }) })
      setCampaignStatus(result.status); setNotice('Your campaign is being added to the queue with the current notes attached.')
      await loadCampaign(campaignId)
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  async function retryProcessing() {
    setError(''); setNotice(''); setBusy('retry')
    try {
      const result = await request('/campaigns/' + encodeURIComponent(campaignId) + '/retry-processing', { method: 'POST' })
      setCampaignStatus(result.status); setNotice('We’re preparing your submission again.')
      await loadCampaign(campaignId)
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  async function addDocument() {
    if (!docFile) { setError('Choose a PDF, PNG, or JPEG file first.'); return }
    if (docFile.size > 2 * 1024 * 1024) { setError('Choose a file smaller than 2 MB.'); return }
    setError(''); setNotice(''); setBusy('document')
    try {
      const content_base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Could not read the selected file')); reader.readAsDataURL(docFile) })
      await request('/campaigns/' + encodeURIComponent(campaignId) + '/documents', { method: 'POST', body: JSON.stringify({ ...doc, filename: docFile.name, mime_type: docFile.type, content_base64 }) })
      setDoc(current => ({ ...current, extracted_text: '' })); setDocFile(null)
      await loadCampaign(campaignId)
      setNotice('File added. The reviewer can open it and record a decision.')
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  if (loading) return <div className="fund-loading">Loading campaign…</div>
  const suggestions = readiness?.improvement_suggestions || (readiness?.semantic?.issues || []).map(item => item.feedback || item.evidence).filter(Boolean)
  const feedbackMode = readiness?.feedback_mode || 'targeted'
  const missingBeforeSubmit = (requirements?.required_fields || []).filter(key => key === 'goal_amount' ? Number(form.goal_amount) <= 0 : !String(form[key] || '').trim())
  const missingAfterSubmit = readiness?.requirements?.missing_fields || []
  const readyNotes = isReady && campaignStatus === 'ready_for_review_with_notes' && (missingAfterSubmit.length > 0 || suggestions.length > 0) ? <div className="fund-readiness"><strong>Notes sent to the reviewer</strong><p>{readiness?.creator_submission_count ? `Creator submission ${readiness.creator_submission_count}. ` : ''}These details may come up during review. Your campaign is already in the queue.</p>{missingAfterSubmit.length > 0 && <p>Missing: {missingAfterSubmit.map(name => documentName(name)).join(', ')}.</p>}{suggestions.map((item, index) => <div key={index}><CircleAlert size={15} />{item}</div>)}</div> : null
  const updateUrgency = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const urgencyFields = <div className="fund-urgency"><label className="fund-urgency-toggle"><span><strong>Urgent?</strong><small>Submit for an expedited review</small></span><input type="checkbox" checked={Boolean(form.expedited_requested)} onChange={e => updateUrgency('expedited_requested', e.target.checked)} /></label>{form.expedited_requested && <><p>Choose this for a time-sensitive need. A reviewer will consider the request; a faster review is not guaranteed.</p><div className="fund-grid"><Input label="Reason for urgency (optional)" value={form.urgency_reason} onChange={v => updateUrgency('urgency_reason', v.slice(0, 500))} placeholder="What makes this time-sensitive?" /><Input label="Deadline (optional)" type="date" value={form.urgency_deadline} onChange={v => updateUrgency('urgency_deadline', v)} /></div></>}</div>

  return <div className="fund-page">
    <header className="fund-topbar"><Link className="fund-logo" to="/creator"><span className="fund-logo-icon"><Check size={19} /></span><span>reviewready</span></Link><div className="fund-toplinks"><Link to="/creator">My campaigns</Link><span className="fund-demo">DEMO WORKSPACE</span><Link to="/reviewer">Reviewer <ArrowRight size={14} /></Link></div></header>
    <div className="fund-progress"><div className="fund-progress-track"><span style={{ width: `${((Math.min(stage, 3) + 1) / 4) * 100}%` }} /></div><span>{stage === 4 ? (needsAction ? 'Action needed' : isLive ? 'Live' : isApproved ? 'Identity and documents' : isReady ? 'Human review' : automationFailed ? 'Preparation paused' : 'Processing') : `Step ${stage + 1} of 4`}</span></div>
    <main className="fund-main">
      <div className="fund-intro"><span className="fund-kicker">Campaign submission</span><h1>{stage === 0 ? <>Bismillah.<br /><em>Let's get started.</em></> : stage === 4 ? (needsAction ? 'Changes requested' : isLive ? 'Your campaign is live' : isApproved ? 'Content approved' : isReady ? 'Human review' : automationFailed ? 'Preparation paused' : 'Preparing your submission') : stages[stage]}</h1><p>{stage === 0 ? 'Start with who will benefit from this campaign.' : stage === 1 ? 'Give reviewers the essential facts about this fundraiser.' : stage === 2 ? 'Explain the need, the intended use of funds, and how support will reach the beneficiary.' : stage === 3 ? 'Submit your campaign. We will check the required fields and flag unclear details before it reaches a reviewer.' : needsAction ? 'Read the feedback below, update your campaign, and submit it again.' : isLive ? 'Your published story now has a public page.' : isApproved ? 'Upload sample identity and supporting documents for the final human checks before publication.' : isReady ? 'Your campaign is in the human review queue. You can add supporting files while you wait.' : 'Your submission is being checked before it enters the queue.'}</p></div>
      {error && <div className="fund-alert error"><CircleAlert size={18} />{error}</div>}
      {notice && <div className="fund-alert success"><CheckCircle2 size={18} />{notice}</div>}

      {correctionCycle && stage >= 1 && stage <= 3 && <aside className="fund-correction-banner" aria-label="Review correction guidance">
        <div className="fund-correction-heading"><CircleAlert size={19} /><div><strong>{feedbackSource === 'reviewer' ? 'Reviewer requested changes' : 'Automated review suggested changes'}</strong><p>Update the details below, then submit again.</p></div></div>
        <details className="fund-correction-details">
          <summary>What should I correct?</summary>
          {feedbackSource === 'reviewer' && humanFeedback ? <p>{humanFeedback}</p> : correctionGuidance.length ? <ul>{correctionGuidance.map((item, index) => <li key={index}>{item}</li>)}</ul> : <ul><li>Explain clearly who needs support and why.</li><li>Make the title, category, beneficiary, story, and use of funds describe the same need.</li><li>Say how the support will reach the beneficiary.</li></ul>}
          <p>Your revised submission will return to the review queue.</p>
        </details>
      </aside>}

      {stage === 0 && <section className="fund-section"><h2>I'm raising these funds for… <b>*</b></h2><div className="fund-choice-list">{[['self', Users, 'Myself or someone else', 'Funds will support a person or family.'], ['organization', Landmark, 'My organization or cause', 'Funds will support an organization or project.']].map(([value, Icon, title, description]) => <button key={value} type="button" className={'fund-choice ' + (choice === value ? 'selected' : '')} onClick={() => { setChoice(value); change('profile_type', value) }}><span className="fund-choice-icon"><Icon size={21} /></span><span><strong>{title}</strong><small>{description}</small></span><span className="fund-radio">{choice === value && <Check size={13} />}</span></button>)}</div></section>}

      {stage === 1 && <section className="fund-section fund-form"><h2>Campaign details</h2><div className="fund-grid"><Input label="Funding goal (USD) *" type="number" value={form.goal_amount} onChange={v => change('goal_amount', v)} placeholder="4000" /><Select label="Category *" value={form.category} onChange={v => change('category', v)} options={categories} /></div><Input label="Campaign title *" value={form.title} onChange={v => change('title', v.slice(0, 100))} placeholder="Help my father get cataract surgery" hint={`${form.title.length}/100 characters`} />{choice === 'self' && <Select label="Who are you raising funds for?" value={form.profile_type === 'behalf_of_other' ? 'behalf_of_other' : 'self'} onChange={v => change('profile_type', v)} options={{ self: 'Myself', behalf_of_other: 'Someone else' }} />}<div className="fund-grid"><Input label="Beneficiary *" value={form.beneficiary} onChange={v => change('beneficiary', v)} placeholder="My father" /><Input label="Relationship to beneficiary *" value={form.beneficiary_relationship} onChange={v => change('beneficiary_relationship', v)} placeholder="Child" /></div>{form.category === 'travel' && <div className="fund-grid"><Input label="Purpose of travel *" value={form.travel_purpose} onChange={v => change('travel_purpose', v)} /><Input label="Destination *" value={form.destination} onChange={v => change('destination', v)} /></div>}<div className="fund-tip"><FileText size={18} /><span>A clear title and realistic goal help the reviewer understand the campaign.</span></div></section>}

      {stage === 2 && <section className="fund-section fund-form"><h2>Tell your story</h2><Input label="Campaign story *" multiline value={form.story} onChange={v => change('story', v)} placeholder="What happened, who needs help, and why now?" /><Input label="Use of funds *" multiline value={form.fund_usage} onChange={v => change('fund_usage', v)} placeholder="For example: $3,000 surgery, $500 medication, $500 transport." /><Input label="How funds will be delivered *" multiline value={form.fund_delivery} onChange={v => change('fund_delivery', v)} placeholder="Explain how the beneficiary will receive the support." /><div className="fund-tip"><Heart size={18} /><span>A little detail can help the review team understand your campaign.</span></div></section>}

      {stage === 3 && <section className="fund-section fund-review"><h2>Submit your campaign</h2><div className="fund-review-row"><span>Campaign</span><strong>{form.title || 'Untitled'}</strong></div><div className="fund-review-row"><span>Goal</span><strong>${Number(form.goal_amount || 0).toLocaleString('en-US')}</strong></div><div className="fund-review-row"><span>Category</span><strong>{categories[form.category]}</strong></div>{missingBeforeSubmit.length > 0 && <div className="fund-missing"><strong>Details that may delay review</strong><p>You can still submit. A reviewer may ask about: {missingBeforeSubmit.map(name => documentName(name)).join(', ')}.</p></div>}{urgencyFields}<div className="fund-check-start"><p>After submission, we check the details and clarity of your answers. If clarification could help, you can revise or continue with the current information.</p><button className="fund-next fund-submit-direct" disabled={Boolean(busy)} onClick={submit}>{busy === 'submit' ? 'Submitting…' : 'Submit campaign'} <ArrowRight size={18} /></button></div></section>}

      {stage === 4 && <section className="fund-section fund-form">
        <AutomationTimeline items={automation} />
        {automationFailed && <div className="fund-readiness"><strong>Preparation did not finish</strong><p>Your campaign is saved. Retry the preparation once.</p><button className="fund-next" disabled={Boolean(busy)} onClick={retryProcessing}>{busy === 'retry' ? 'Retrying…' : 'Retry preparation'} <ArrowRight size={18} /></button></div>}
        {needsAction && <div className="fund-readiness">
          <strong>{feedbackSource === 'reviewer' ? 'Feedback from the review team' : 'AI review suggestions'}</strong>
          {feedbackSource === 'reviewer' ? <p>{humanFeedback || 'The reviewer asked for more information.'}</p> : <><p>A few details could help the reviewer understand your request. You may update them or continue with the current information.</p>{missingAfterSubmit.length > 0 && <p>Missing details: {missingAfterSubmit.map(name => documentName(name)).join(', ')}.</p>}{suggestions.map((item, index) => <div key={index}><CircleAlert size={15} />{item}</div>)}</>}
          <div className="fund-soft-gate"><button className="fund-next" onClick={() => { setNotice(''); setStage(2) }}>Update campaign</button>{feedbackSource !== 'reviewer' && <button className="fund-outline" disabled={Boolean(busy)} onClick={submitAsIs}>{busy === 'override' ? 'Submitting…' : 'Submit as it is'} <ArrowRight size={18} /></button>}</div>
        </div>}
        {isReady && <div className="fund-submitted"><CheckCircle2 size={22} /><span><strong>In the human review queue</strong><small>Reviewers can read your story, open each uploaded document, and send specific feedback.</small></span></div>}
        {readyNotes}
        {isApproved && <div className="fund-readiness"><strong>Campaign content approved</strong><p>Before publication, add a sample personal ID and any requested supporting files. A human reviewer must accept the files and complete the verification checklist.</p></div>}
        {isLive && <div className="fund-submitted"><CheckCircle2 size={22} /><span><strong>Published</strong><small>Your campaign page is visible to anyone with its link.</small></span><Link className="fund-outline" to={'/campaign/' + publicSlug}>View live page <ArrowRight size={17} /></Link></div>}
        {(isReady || isApproved || needsAction) && <>
          <h2 className="fund-follow-heading">Documents for human review</h2>
          <p className="fund-help">Prototype only: upload synthetic PDF, PNG, or JPEG files up to 2 MB. Do not upload a real personal ID or bank statement.</p>
          <div className="fund-doc-list">{suggestedDocuments.map((item, index) => <div key={index} className={item.done ? 'complete' : ''}>{item.done ? <CheckCircle2 size={18} /> : <FileText size={18} />}<span>{item.name}</span><small>{item.done ? 'Uploaded' : 'Needed before live'}</small></div>)}</div>
          {supporting.length > 0 && <div className="fund-uploaded"><strong>Uploaded files</strong>{supporting.map(item => <div key={item.id}><span>{item.filename} · {documentName(item.document_type)}</span><small>{item.review_status === 'accepted' ? 'Accepted' : item.review_status === 'rejected' ? 'Changes requested' : 'Awaiting reviewer'}{item.reviewer_note ? ` — ${item.reviewer_note}` : ''}</small></div>)}</div>}
          <Select label="Document type" value={doc.document_type} onChange={v => setDoc(current => ({ ...current, document_type: v, extracted_text: '' }))} options={Object.fromEntries([...new Set([...(requirements?.required_documents || []), ...(requirements?.one_of_documents || []), ...Object.keys(documents)])].map(type => [type, documentName(type)]))} />
          <label className="fund-field"><span>Choose a sample file *</span><input key={docFile?.name || 'empty'} type="file" accept="application/pdf,image/png,image/jpeg" onChange={e => setDocFile(e.target.files?.[0] || null)} /></label>
          {!['organizer_id', 'beneficiary_id', 'recent_bank_statement'].includes(doc.document_type) && <Input label="Optional document excerpt for AI notes" multiline value={doc.extracted_text} onChange={v => setDoc(current => ({ ...current, extracted_text: v }))} placeholder="Optional text copied from this document" />}
          <button className="fund-outline" disabled={Boolean(busy) || !docFile} onClick={addDocument}><Plus size={17} /> {busy === 'document' ? 'Uploading…' : 'Upload file'}</button>
          {needsAction && feedbackSource === 'reviewer' && <div className="fund-soft-gate"><button className="fund-next" disabled={Boolean(busy)} onClick={submit}>{busy === 'submit' ? 'Resubmitting…' : 'Resubmit for review'} <ArrowRight size={18} /></button></div>}
        </>}
      </section>}

      <footer className="fund-actions"><button className="fund-back" disabled={stage === 0 || stage === 4} onClick={() => { setError(''); setNotice(''); setStage(current => current - 1) }}><ArrowLeft size={18} /> Back</button><div>{stage > 0 && stage < 3 && <button className="fund-save" disabled={Boolean(busy)} onClick={() => saveDraft().then(() => setNotice('Draft saved.')).catch(e => setError(e.message))}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>}{stage < 3 ? <button className="fund-next" disabled={Boolean(busy)} onClick={advance}>Next <ArrowRight size={19} /></button> : stage === 4 && <Link className="fund-next" to="/creator">My campaigns <ArrowRight size={19} /></Link>}</div></footer>
      <div className="fund-footnote">ReviewReady demo. The review team decides the next step.</div>
    </main>
  </div>
}
