import { useState } from 'react'
import { requestJson } from './api'

function ContributionDialog({ user, onClose, onSignIn, onConnectGithub }) {
  const [repoUrl, setRepoUrl] = useState('')
  const [category, setCategory] = useState('Tool')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)

  const submitProject = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await requestJson('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ repoUrl, category, description }),
      })
      setSubmitted(true)
    } catch (cause) {
      setError(cause.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="workflow-dialog" role="dialog" aria-modal="true" aria-labelledby="contribution-title">
        <div className="dialog-heading">
          <div><span className="section-kicker">COMMUNITY SUBMISSION</span><h2 id="contribution-title">Share a project</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close submission form">×</button>
        </div>
        {submitted ? (
          <div className="dialog-success"><span className="status-pill live">RECEIVED</span><h3>Sent for review</h3><p>Your repository is in the review queue. It will appear in project discovery after a manager approves it.</p><button type="button" className="primary-button" onClick={onClose}>Done</button></div>
        ) : !user ? (
          <div className="dialog-gate"><p>Sign in with Google to submit a project, then connect the GitHub account that owns the public repository.</p><button type="button" className="primary-button" onClick={onSignIn}>Sign in with Google</button></div>
        ) : !user.github ? (
          <div className="dialog-gate"><p>Connect your GitHub account first. Submissions must be public repositories owned by that account.</p><button type="button" className="primary-button" onClick={onConnectGithub}>Connect GitHub</button></div>
        ) : (
          <form className="workflow-form" onSubmit={submitProject}>
            <p className="form-context">Submitting as <strong>{user.github.login}</strong>. Public repositories are checked against your connected GitHub account.</p>
            <label className="form-field">GitHub repository URL<input type="url" required value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} placeholder="https://github.com/your-account/project" /></label>
            <label className="form-field">Project type<select value={category} onChange={(event) => setCategory(event.target.value)}><option>Tool</option><option>Research</option><option>Framework</option><option>Other</option></select></label>
            <label className="form-field">What should people know?<textarea maxLength={1200} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe what it does, who it helps, or how it is used." /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Submitting…' : 'Submit for review'}</button></div>
          </form>
        )}
      </section>
    </div>
  )
}

export default ContributionDialog
