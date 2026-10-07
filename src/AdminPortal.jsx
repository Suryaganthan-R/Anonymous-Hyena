import { useEffect, useState } from 'react'
import ProfileDialog from './ProfileDialog'
import { requestJson } from './api'

const staffRoles = new Set(['manager', 'admin', 'superadmin'])
const adminRoles = new Set(['admin', 'superadmin'])
const reviewFilters = ['pending', 'approved', 'rejected', 'all']

function TimedNotice({ message }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(false), 5000)
    return () => window.clearTimeout(timeout)
  }, [message])

  return visible ? <div className="admin-notice" role="status">{message}</div> : null
}

function AdminSubmission({ submission, onReview, onToggleHidden, onToggleFeatured, isAdmin, onDelete }) {
  const [note, setNote] = useState(submission.reviewNote || '')
  const [saving, setSaving] = useState(false)

  const review = async (status) => {
    setSaving(true)
    try {
      await onReview(submission.id, status, note)
    } finally {
      setSaving(false)
    }
  }

  return (
    <article className="admin-submission">
      <div className="admin-submission-main">
        <div className="admin-card-heading">
          <div><span className="mini-label">{submission.category}</span><h3>{submission.name}</h3></div>
          <span className={`review-status status-${submission.hidden ? 'hidden' : submission.status}`}>{submission.hidden ? 'hidden' : submission.status}</span>
        </div>
        <p>{submission.description || 'No additional summary provided.'}</p>
        <div className="admin-project-meta"><span>Submitted by {submission.submitterName}</span><span>GitHub: {submission.submitterGithub || submission.repoOwner}</span><span>{new Date(submission.createdAt).toLocaleDateString()}</span></div>
        <a className="text-link" href={submission.repoUrl} target="_blank" rel="noreferrer">Open repository ↗</a>
      </div>
      {submission.status === 'pending' ? (
        <div className="review-controls">
          <label className="form-field">Review note<textarea rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional note for the submitter" /></label>
          <div className="dialog-actions"><button type="button" className="secondary-button" disabled={saving} onClick={() => review('rejected')}>Reject</button><button type="button" className="primary-button" disabled={saving} onClick={() => review('approved')}>{saving ? 'Saving…' : 'Approve'}</button></div>
        </div>
      ) : submission.status === 'approved' ? (
        <div className="approved-project-actions">
          {submission.reviewNote && <p className="review-note">Review note: {submission.reviewNote}</p>}
          <div className="dialog-actions">
            <button type="button" className="secondary-button" onClick={() => onToggleHidden(submission)}>{submission.hidden ? 'Restore project' : 'Hide project'}</button>
            {isAdmin && <button type="button" className="secondary-button" onClick={() => onToggleFeatured(submission)}>{submission.featured ? 'Remove from showcase' : 'Add to showcase'}</button>}
            <button type="button" className="danger-button" onClick={() => onDelete(submission)}>Delete project</button>
          </div>
        </div>
      ) : submission.reviewNote ? <p className="review-note">Review note: {submission.reviewNote}</p> : null}
    </article>
  )
}

function AdminPortal({ user, loading, onSignIn, onSignOut, onUserUpdated }) {
  const [tab, setTab] = useState('submissions')
  const [filter, setFilter] = useState('pending')
  const [submissions, setSubmissions] = useState([])
  const [users, setUsers] = useState([])
  const [invites, setInvites] = useState([])
  const [newUserName, setNewUserName] = useState('')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserRole, setNewUserRole] = useState('user')
  const [addUserOpen, setAddUserOpen] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)

  useEffect(() => {
    if (!staffRoles.has(user?.role)) return
    requestJson('/api/admin/submissions')
      .then((result) => setSubmissions(result.submissions))
      .catch((cause) => setError(cause.message))
  }, [user?.role])

  useEffect(() => {
    if (tab !== 'users' || !adminRoles.has(user?.role)) return
    requestJson('/api/admin/users')
      .then((result) => {
        setUsers(result.users)
        setInvites(result.invites)
      })
      .catch((cause) => setError(cause.message))
  }, [tab, user?.role])

  const reviewSubmission = async (id, status, reviewNote) => {
    setError('')
    setNotice('')
    try {
      const result = await requestJson('/api/admin/submissions', {
        method: 'PATCH',
        body: JSON.stringify({ id, status, reviewNote }),
      })
      setSubmissions((current) => current.map((item) => item.id === id ? result.submission : item))
      setNotice(`Project ${status}.`)
    } catch (cause) {
      setError(cause.message)
      throw cause
    }
  }

  const toggleHidden = async (submission) => {
    setError('')
    setNotice('')
    try {
      const result = await requestJson('/api/admin/submissions/visibility', {
        method: 'PATCH',
        body: JSON.stringify({ id: submission.id, hidden: !submission.hidden }),
      })
      setSubmissions((current) => current.map((item) => item.id === submission.id ? result.submission : item))
      setNotice(result.submission.hidden ? 'Project hidden from the public site.' : 'Project restored to the public site.')
    } catch (cause) {
      setError(cause.message)
    }
  }

  const toggleFeatured = async (submission) => {
    setError('')
    setNotice('')
    try {
      const result = await requestJson('/api/admin/submissions/showcase', {
        method: 'PATCH',
        body: JSON.stringify({ id: submission.id, featured: !submission.featured }),
      })
      setSubmissions((current) => current.map((item) => item.id === submission.id ? result.submission : item))
      setNotice(result.submission.featured ? 'Project added to Showcase.' : 'Project removed from Showcase.')
    } catch (cause) {
      setError(cause.message)
    }
  }

  const deleteSubmission = async (submission) => {
    if (!window.confirm(`Permanently delete ${submission.name}? This cannot be undone.`)) return
    setError('')
    setNotice('')
    try {
      await requestJson(`/api/admin/submissions?id=${encodeURIComponent(submission.id)}`, { method: 'DELETE' })
      setSubmissions((current) => current.filter((item) => item.id !== submission.id))
      setNotice('Project deleted.')
    } catch (cause) {
      setError(cause.message)
    }
  }

  const changeRole = async (targetId, role) => {
    setError('')
    setNotice('')
    try {
      const result = await requestJson('/api/admin/users/role', {
        method: 'PATCH',
        body: JSON.stringify({ id: targetId, role }),
      })
      setUsers((current) => current.map((item) => item.id === targetId ? result.user : item))
      setNotice('User role updated.')
      if (targetId === user.id) onUserUpdated(result.user)
    } catch (cause) {
      setError(cause.message)
    }
  }

  const addUser = async (event) => {
    event.preventDefault()
    setError('')
    setNotice('')
    try {
      const result = await requestJson('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ name: newUserName, email: newUserEmail, role: newUserRole }),
      })
      setInvites((current) => [result.invite, ...current])
      setNewUserName('')
      setNewUserEmail('')
      setNewUserRole('user')
      setAddUserOpen(false)
      setNotice(`Added ${result.invite.email}. They can activate access by signing in with that Google account.`)
    } catch (cause) {
      setError(cause.message)
    }
  }

  const deleteUser = async (target) => {
    if (!window.confirm(`Delete ${target.name || target.email}? Their submissions and notifications will also be deleted.`)) return
    setError('')
    setNotice('')
    try {
      await requestJson(`/api/admin/users?id=${encodeURIComponent(target.id)}`, { method: 'DELETE' })
      setUsers((current) => current.filter((item) => item.id !== target.id))
      setNotice(`Deleted ${target.email}.`)
    } catch (cause) {
      setError(cause.message)
    }
  }

  const cancelInvite = async (invite) => {
    if (!window.confirm(`Cancel the invitation for ${invite.email}?`)) return
    setError('')
    setNotice('')
    try {
      await requestJson(`/api/admin/invites?id=${encodeURIComponent(invite.id)}`, { method: 'DELETE' })
      setInvites((current) => current.filter((item) => item.id !== invite.id))
      setNotice(`Cancelled invitation for ${invite.email}.`)
    } catch (cause) {
      setError(cause.message)
    }
  }

  const visibleSubmissions = submissions.filter((submission) => filter === 'all' || submission.status === filter)

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <a className="brand-wrap admin-brand" href="/" aria-label="Anonymous Hyena home">
          <div className="brand-mark" aria-hidden="true"><span className="mark-core" /></div>
          <div className="brand-copy"><span className="brand-name">ANONYMOUS HYENA</span><span className="brand-tag">Staff workspace</span></div>
        </a>
        <div className="admin-top-actions">
          <a className="text-link" href="/">Public site</a>
          {user && <button type="button" className="ghost-button" onClick={() => setProfileOpen(true)}>Profile</button>}
          {user && <button type="button" className="ghost-button" onClick={onSignOut}>Sign out</button>}
        </div>
      </header>

      {loading ? <main className="admin-loading">Checking account…</main> : !user ? (
        <main className="admin-gate">
          <span className="section-kicker">RESTRICTED WORKSPACE</span>
          <h1>Staff sign in</h1>
          <p>Use your authorized Google account to review project submissions or manage the community.</p>
          <button type="button" className="primary-button" onClick={onSignIn}>Continue with Google</button>
        </main>
      ) : !staffRoles.has(user.role) ? (
        <main className="admin-gate">
          <span className="section-kicker">ACCESS RESTRICTED</span>
          <h1>Staff access only</h1>
          <p>This Google account does not have a staff role.</p>
          <a className="secondary-button" href="/">Return to Anonymous Hyena</a>
        </main>
      ) : (
        <main className="admin-content">
          <div className="admin-heading"><div><span className="section-kicker">{user.role.toUpperCase()}</span><h1>Staff workspace</h1></div><span className="admin-identity">{user.name} · {user.email}</span></div>
          <nav className="admin-tabs" aria-label="Staff sections">
            <button type="button" className={tab === 'submissions' ? 'is-active' : ''} onClick={() => setTab('submissions')}>Project review</button>
            {adminRoles.has(user.role) && <button type="button" className={tab === 'users' ? 'is-active' : ''} onClick={() => setTab('users')}>User directory</button>}
          </nav>
          {error && <div className="admin-alert" role="alert">{error}</div>}
          {notice && <TimedNotice key={notice} message={notice} />}
          {tab === 'submissions' ? (
            <section className="admin-section">
              <div className="admin-section-heading"><div><span className="mini-label">MODERATION</span><h2>Project submissions</h2></div><span className="result-pill">{submissions.filter((item) => item.status === 'pending').length} pending</span></div>
              <div className="admin-filters" aria-label="Filter submissions">
                {reviewFilters.map((value) => <button key={value} type="button" className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{value}</button>)}
              </div>
              <div className="admin-list">{visibleSubmissions.length ? visibleSubmissions.map((submission) => <AdminSubmission key={submission.id} submission={submission} onReview={reviewSubmission} onToggleHidden={toggleHidden} onToggleFeatured={toggleFeatured} isAdmin={adminRoles.has(user.role)} onDelete={deleteSubmission} />) : <div className="empty-state-card">No {filter === 'all' ? '' : `${filter} `}submissions.</div>}</div>
            </section>
          ) : (
            <section className="admin-section">
              <div className="admin-section-heading"><div><span className="mini-label">ACCESS CONTROL</span><h2>User directory</h2></div><div className="directory-heading-actions"><span className="result-pill">{users.length} users · {invites.length} pending</span><button type="button" className="primary-button" onClick={() => setAddUserOpen(true)}>Add user</button></div></div>
              {invites.length > 0 && <div className="admin-user-list">
                <h3 className="directory-subheading">Pending invitations</h3>
                {invites.map((invite) => <article className="admin-user-row" key={invite.id}>
                  <div className="admin-user-identity"><strong>{invite.name}</strong><span>{invite.email}</span><span>Added by {invite.invitedBy} · {new Date(invite.createdAt).toLocaleDateString()}</span></div>
                  <div className="directory-row-actions"><span className="review-status status-pending">{invite.role}</span><button type="button" className="danger-button" onClick={() => cancelInvite(invite)}>Delete invite</button></div>
                </article>)}
              </div>}
              <div className="admin-user-list">
                {users.map((listedUser) => <article className="admin-user-row" key={listedUser.id}>
                  <div className="admin-user-identity"><strong>{listedUser.name}</strong><span>{listedUser.email}</span>{listedUser.github && <span>GitHub · {listedUser.github.login}</span>}</div>
                  <div className="directory-row-actions">
                    <label className="form-field role-field">Role<select value={listedUser.role} disabled={listedUser.role === 'superadmin' || listedUser.id === user.id} onChange={(event) => changeRole(listedUser.id, event.target.value)}><option value="user">User</option><option value="manager">Manager</option><option value="admin">Admin</option>{listedUser.role === 'superadmin' && <option value="superadmin">Superadmin</option>}</select></label>
                    {listedUser.role !== 'superadmin' && listedUser.id !== user.id && <button type="button" className="danger-button" onClick={() => deleteUser(listedUser)}>Delete user</button>}
                  </div>
                </article>)}
              </div>
            </section>
          )}
        </main>
      )}
      {addUserOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setAddUserOpen(false)}>
        <section className="workflow-dialog add-user-dialog" role="dialog" aria-modal="true" aria-labelledby="add-user-title">
          <div className="dialog-heading"><div><span className="section-kicker">ACCESS CONTROL</span><h2 id="add-user-title">Add user</h2></div><button type="button" className="icon-button" onClick={() => setAddUserOpen(false)} aria-label="Close add user">×</button></div>
          <form className="workflow-form" onSubmit={addUser}>
            <label className="form-field">Name<input maxLength={80} value={newUserName} onChange={(event) => setNewUserName(event.target.value)} placeholder="Optional display name" /></label>
            <label className="form-field">Google email<input type="email" required maxLength={254} value={newUserEmail} onChange={(event) => setNewUserEmail(event.target.value)} placeholder="person@example.com" /></label>
            <label className="form-field">Role<select value={newUserRole} onChange={(event) => setNewUserRole(event.target.value)}><option value="user">User</option><option value="manager">Manager</option><option value="admin">Admin</option></select></label>
            <div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setAddUserOpen(false)}>Cancel</button><button type="submit" className="primary-button">Add user</button></div>
          </form>
        </section>
      </div>}
      {profileOpen && user && <ProfileDialog user={user} onClose={() => setProfileOpen(false)} onSaved={onUserUpdated} />}
    </div>
  )
}

export default AdminPortal
