import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, CircleAlert, Clock3, FileText, Heart, Landmark, Plus, Users } from 'lucide-react'
import './fundraiser.css'

const stages = ['Who is it for?', 'Campaign details', 'Your story', 'Submit campaign']
const categories = { medical: 'Medical', education: 'Education', rent: 'Housing / rent', travel: 'Travel', business_product: 'Business / product', refugee_asylum: 'Refugee / asylum', vehicle: 'Vehicle', other: 'Other' }
const documents = { organizer_id: 'Organizer ID', beneficiary_id: 'Beneficiary ID', recent_bank_statement: 'Recent bank statement', organization_registration: 'Organization registration', medical_supporting_evidence: 'Medical evidence', signed_rental_agreement: 'Signed rental agreement', accommodation_invoice: 'Accommodation invoice', flight_invoice: 'Flight invoice', vehicle_quote_or_purchase_agreement: 'Vehicle quote or purchase agreement', student_id: 'Student ID', acceptance_letter: 'Acceptance letter' }
const blank = { profile_type: 'self', category: 'medical', title: '', story: '', goal_amount: '', beneficiary: '', beneficiary_relationship: '', fund_usage: '', fund_delivery: '', travel_purpose: '', destination: '' }
const documentName = value => documents[value] || value.replaceAll('_', ' ')
const readyStatuses = ['submitted', 'ready_for_review', 'ready_for_review_with_notes']

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
  initial_ai_review: 'Clarity check',
  clarification_requested: 'Suggestions sent to campaigner',
  creator_override: 'Campaigner chose to submit as it is',
  detailed_reviewer_analysis: 'Detailed reviewer analysis',
  review_packet_ready: 'Review packet ready',
}

function AutomationTimeline({ items }) {
  return <div className="automation-timeline">{items.map(item => <div className={'automation-step ' + item.status} key={item.id}>{item.status === 'running' ? <Clock3 size={17} /> : item.status === 'action_required' ? <CircleAlert size={17} /> : <CheckCircle2 size={17} />}<span><strong>{stepLabels[item.step] || item.step}</strong><small>{item.detail}</small></span></div>)}</div>
}

export default function FundraiserWizard() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [campaignId, setCampaignId] = useState(id || '')
  const [campaignStatus, setCampaignStatus] = useState('draft')
  const [stage, setStage] = useState(id ? 1 : 0)
  const [choice, setChoice] = useState('self')
  const [form, setForm] = useState(blank)
  const [savedPayload, setSavedPayload] = useState('')
  const [supporting, setSupporting] = useState([])
  const [automation, setAutomation] = useState([])
  const [requirements, setRequirements] = useState(null)
  const [readiness, setReadiness] = useState(null)
  const [doc, setDoc] = useState({ document_type: 'organizer_id', filename: '', extracted_text: '' })
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(Boolean(id))

  const change = (key, value) => { setForm(current => ({ ...current, [key]: value })); setReadiness(null) }
  const isProcessing = campaignStatus === 'initial_review'
  const needsAction = campaignStatus === 'action_required'
  const isReady = readyStatuses.includes(campaignStatus)
  const locked = isProcessing || isReady

  async function loadCampaign(currentId, showLoading = false) {
    if (showLoading) setLoading(true)
    try {
      const data = await request('/campaigns/' + encodeURIComponent(currentId))
      const loaded = Object.fromEntries(Object.keys(blank).map(key => [key, data.campaign[key] ?? '']))
      setCampaignId(currentId); setForm(loaded); setCampaignStatus(data.campaign.status)
      setSavedPayload(JSON.stringify({ ...loaded, goal_amount: Number(loaded.goal_amount || 0) }))
      setChoice(data.campaign.profile_type === 'organization' ? 'organization' : 'self')
      setSupporting(data.documents || []); setAutomation(data.automation || [])
      if (data.campaign.status !== 'draft') setStage(4)
      if (data.campaign.status !== 'draft') {
        const feedback = await request('/campaigns/' + encodeURIComponent(currentId) + '/readiness').catch(() => null)
        if (feedback) setReadiness(feedback)
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
    const payload = { ...form, profile_type: choice === 'organization' ? 'organization' : form.profile_type === 'behalf_of_other' ? 'behalf_of_other' : 'self', goal_amount: Number(form.goal_amount || 0) }
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
      const result = await request('/campaigns/' + encodeURIComponent(currentId) + '/submit', { method: 'POST' })
      setCampaignStatus(result.status); setStage(4)
      setNotice('Campaign received. The automated initial review has started.')
      await loadCampaign(currentId)
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  async function submitAsIs() {
    setError(''); setNotice(''); setBusy('override')
    try {
      const result = await request('/campaigns/' + encodeURIComponent(campaignId) + '/submit-as-is', { method: 'POST' })
      setCampaignStatus(result.status); setNotice('Your campaign is being prepared for human review with the automated notes attached.')
      await loadCampaign(campaignId)
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  async function addDocument() {
    if (!doc.filename.trim()) { setError('Enter a filename first.'); return }
    setError(''); setNotice(''); setBusy('document')
    try {
      const result = await request('/campaigns/' + encodeURIComponent(campaignId) + '/documents', { method: 'POST', body: JSON.stringify(doc) })
      setSupporting(current => [...current, { ...doc, id: result.id }])
      setDoc(current => ({ ...current, filename: '', extracted_text: '' }))
      setNotice('Supporting material added for the reviewer.')
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  if (loading) return <div className="fund-loading">Loading campaign…</div>
  const suggestions = readiness?.improvement_suggestions || (readiness?.semantic?.issues || []).map(item => item.feedback || item.evidence).filter(Boolean)

  return <div className="fund-page">
    <header className="fund-topbar"><Link className="fund-logo" to="/creator"><span className="fund-logo-icon"><Check size={19} /></span><span>reviewready</span></Link><div className="fund-toplinks"><Link to="/creator">My campaigns</Link><span className="fund-demo">LOCAL DEMO</span><Link to="/reviewer">Reviewer <ArrowRight size={14} /></Link></div></header>
    <div className="fund-progress"><div className="fund-progress-track"><span style={{ width: `${((Math.min(stage, 3) + 1) / 4) * 100}%` }} /></div><span>{stage === 4 ? (needsAction ? 'Action needed' : isReady ? 'Ready for review' : 'Processing') : `Step ${stage + 1} of 4`}</span></div>
    <main className="fund-main">
      <div className="fund-intro"><span className="fund-kicker">Campaign submission</span><h1>{stage === 0 ? <>Bismillah.<br /><em>Let's get started.</em></> : stage === 4 ? (needsAction ? 'A few details may help' : isReady ? 'Ready for human review' : 'We’re reviewing your campaign') : stages[stage]}</h1><p>{stage === 0 ? 'Start with who will benefit from this campaign.' : stage === 1 ? 'Give reviewers the essential facts about this fundraiser.' : stage === 2 ? 'Explain the need, the intended use of funds, and how support will reach the beneficiary.' : stage === 3 ? 'Submit your campaign. We will check the required fields and flag unclear details before it reaches a reviewer.' : needsAction ? 'A few details may need clarification. You can revise the campaign or send it to the review team as it is.' : isReady ? 'Your campaign and its review packet are now available to the human review team.' : 'Your submission is being checked and prepared for the review team.'}</p></div>
      {error && <div className="fund-alert error"><CircleAlert size={18} />{error}</div>}
      {notice && <div className="fund-alert success"><CheckCircle2 size={18} />{notice}</div>}

      {stage === 0 && <section className="fund-section"><h2>I'm raising these funds for… <b>*</b></h2><div className="fund-choice-list">{[['self', Users, 'Myself or someone else', 'Funds will support a person or family.'], ['organization', Landmark, 'My organization or cause', 'Funds will support an organization or project.']].map(([value, Icon, title, description]) => <button key={value} type="button" className={'fund-choice ' + (choice === value ? 'selected' : '')} onClick={() => { setChoice(value); change('profile_type', value) }}><span className="fund-choice-icon"><Icon size={21} /></span><span><strong>{title}</strong><small>{description}</small></span><span className="fund-radio">{choice === value && <Check size={13} />}</span></button>)}</div></section>}

      {stage === 1 && <section className="fund-section fund-form"><h2>Campaign details</h2><div className="fund-grid"><Input label="Funding goal (USD) *" type="number" value={form.goal_amount} onChange={v => change('goal_amount', v)} placeholder="4000" /><Select label="Category *" value={form.category} onChange={v => change('category', v)} options={categories} /></div><Input label="Campaign title *" value={form.title} onChange={v => change('title', v.slice(0, 100))} placeholder="Help my father get cataract surgery" hint={`${form.title.length}/100 characters`} />{choice === 'self' && <Select label="Who are you raising funds for?" value={form.profile_type === 'behalf_of_other' ? 'behalf_of_other' : 'self'} onChange={v => change('profile_type', v)} options={{ self: 'Myself', behalf_of_other: 'Someone else' }} />}<div className="fund-grid"><Input label="Beneficiary *" value={form.beneficiary} onChange={v => change('beneficiary', v)} placeholder="My father" /><Input label="Relationship to beneficiary *" value={form.beneficiary_relationship} onChange={v => change('beneficiary_relationship', v)} placeholder="Child" /></div>{form.category === 'travel' && <div className="fund-grid"><Input label="Purpose of travel *" value={form.travel_purpose} onChange={v => change('travel_purpose', v)} /><Input label="Destination *" value={form.destination} onChange={v => change('destination', v)} /></div>}<div className="fund-tip"><FileText size={18} /><span>A clear title and realistic goal help the reviewer understand the campaign.</span></div></section>}

      {stage === 2 && <section className="fund-section fund-form"><h2>Tell your story</h2><Input label="Campaign story *" multiline value={form.story} onChange={v => change('story', v)} placeholder="What happened, who needs help, and why now?" /><Input label="Use of funds *" multiline value={form.fund_usage} onChange={v => change('fund_usage', v)} placeholder="For example: $3,000 surgery, $500 medication, $500 transport." /><Input label="How funds will be delivered *" multiline value={form.fund_delivery} onChange={v => change('fund_delivery', v)} placeholder="Explain how the beneficiary will receive the support." /><div className="fund-tip"><Heart size={18} /><span>A little detail can help the review team understand your campaign.</span></div></section>}

      {stage === 3 && <section className="fund-section fund-review"><h2>Submit your campaign</h2><div className="fund-review-row"><span>Campaign</span><strong>{form.title || 'Untitled'}</strong></div><div className="fund-review-row"><span>Goal</span><strong>${Number(form.goal_amount || 0).toLocaleString('en-US')}</strong></div><div className="fund-review-row"><span>Category</span><strong>{categories[form.category]}</strong></div><div className="fund-check-start"><p>After submission, we check the required fields and the clarity of your answers. Clear submissions go to the review team. If anything needs context, you can revise it or continue as submitted.</p><button className="fund-next fund-submit-direct" disabled={Boolean(busy)} onClick={submit}>{busy === 'submit' ? 'Submitting…' : 'Submit campaign'} <ArrowRight size={18} /></button></div></section>}

      {stage === 4 && <section className="fund-section fund-form"><AutomationTimeline items={automation} />{needsAction && <div className="fund-readiness"><strong>Details to review</strong><p>These suggestions may not always apply. You can update the campaign or send it to human review as it is.</p>{suggestions.length ? suggestions.map((item, index) => <div key={index}><CircleAlert size={15} />{item}</div>) : <div><CircleAlert size={15} />The clarity check suggested another look, but no specific feedback was returned.</div>}<div className="fund-soft-gate"><button className="fund-outline" onClick={() => { setNotice(''); setStage(2) }}>Update campaign</button><button className="fund-next" disabled={Boolean(busy)} onClick={submitAsIs}>{busy === 'override' ? 'Submitting…' : 'Submit as it is'} <ArrowRight size={18} /></button></div></div>}{isReady && <div className="fund-submitted"><CheckCircle2 size={22} /><span><strong>{campaignStatus === 'ready_for_review_with_notes' ? 'Ready for review — with notes' : 'Ready for human review'}</strong><small>{campaignStatus === 'ready_for_review_with_notes' ? 'The reviewer can see that you continued after reading the clarity notes.' : 'The review packet is ready for the review team.'}</small></span></div>}{isReady && <><h2 className="fund-follow-heading">Optional supporting material</h2><p className="fund-help">A reviewer may ask for more information. This demo accepts a filename and sample excerpt.</p><div className="fund-doc-list">{suggestedDocuments.map((item, index) => <div key={index} className={item.done ? 'complete' : ''}>{item.done ? <CheckCircle2 size={18} /> : <FileText size={18} />}<span>{item.name}</span><small>{item.done ? 'Added' : 'May be requested'}</small></div>)}</div><div className="fund-grid"><Select label="Document type" value={doc.document_type} onChange={v => setDoc(current => ({ ...current, document_type: v }))} options={Object.fromEntries([...new Set([...(requirements?.required_documents || []), ...(requirements?.one_of_documents || []), ...Object.keys(documents)])].map(type => [type, documentName(type)]))} /><Input label="Filename" value={doc.filename} onChange={v => setDoc(current => ({ ...current, filename: v }))} placeholder="supporting-document.pdf" /></div><Input label="Document text" multiline value={doc.extracted_text} onChange={v => setDoc(current => ({ ...current, extracted_text: v }))} placeholder="Paste a short sample excerpt…" /><button className="fund-outline" disabled={Boolean(busy)} onClick={addDocument}><Plus size={17} /> {busy === 'document' ? 'Adding…' : 'Add material'}</button></>}</section>}

      <footer className="fund-actions"><button className="fund-back" disabled={stage === 0 || stage === 4} onClick={() => { setError(''); setNotice(''); setStage(current => current - 1) }}><ArrowLeft size={18} /> Back</button><div>{stage > 0 && stage < 3 && <button className="fund-save" disabled={Boolean(busy)} onClick={() => saveDraft().then(() => setNotice('Draft saved.')).catch(e => setError(e.message))}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>}{stage < 3 ? <button className="fund-next" disabled={Boolean(busy)} onClick={advance}>Next <ArrowRight size={19} /></button> : stage === 4 && <Link className="fund-next" to="/creator">My campaigns <ArrowRight size={19} /></Link>}</div></footer>
      <div className="fund-footnote">A local ReviewReady simulation. Human reviewers make the final decision.</div>
    </main>
  </div>
}
