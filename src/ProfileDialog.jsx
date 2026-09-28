import { useState } from 'react'
import { requestJson } from './api'

function ProfileDialog({ user, onClose, onSaved }) {
  const [name, setName] = useState(user.name || '')
  const [contactEmail, setContactEmail] = useState(user.contactEmail || '')
  const [bio, setBio] = useState(user.bio || '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const saveProfile = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const result = await requestJson('/api/profile', {
        method: 'POST',
        body: JSON.stringify({ name, contactEmail, bio }),
      })
      onSaved(result.user)
      onClose()
    } catch (cause) {
      setError(cause.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="workflow-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <div className="dialog-heading">
          <div><span className="section-kicker">ACCOUNT</span><h2 id="profile-title">Edit profile</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close profile">×</button>
        </div>
        <form className="workflow-form" onSubmit={saveProfile}>
          <label className="form-field">Display name<input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="form-field">Google sign-in email<input type="email" value={user.email} readOnly /></label>
          <label className="form-field">Contact email<input type="email" maxLength={254} value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="name@example.com" /></label>
          <label className="form-field">About you<textarea maxLength={500} rows={4} value={bio} onChange={(event) => setBio(event.target.value)} placeholder="A short profile for your project submissions" /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button></div>
        </form>
      </section>
    </div>
  )
}

export default ProfileDialog
