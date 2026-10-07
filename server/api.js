import { randomUUID } from 'node:crypto'

const staffRoles = new Set(['manager', 'admin', 'superadmin'])
const adminRoles = new Set(['admin', 'superadmin'])
const submissionCategories = new Set(['Tool', 'Research', 'Framework', 'Other'])
const assignableRoles = new Set(['user', 'manager', 'admin'])

const send = (response, status, body, headers = {}) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  response.end(JSON.stringify(body))
}

const readJson = async (request) => {
  if (!request.headers['content-type']?.includes('application/json')) {
    const error = new Error('Send this request as JSON.')
    error.status = 415
    throw error
  }

  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 32_768) {
      const error = new Error('The request is too large.')
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}')
  } catch {
    const error = new Error('The request body must contain valid JSON.')
    error.status = 400
    throw error
  }
}

const publicProject = (project) => ({
  id: project.id,
  name: project.name,
  description: project.description || project.repositoryDescription,
  category: project.category,
  status: 'Published',
  maintainer: project.repoOwner,
  version: project.defaultBranch,
  contributors: 0,
  updated: project.pushedAt || project.createdAt,
  repoUrl: project.repoUrl,
  featured: project.featured,
})

const reviewProject = (project) => ({
  id: project.id,
  name: project.name,
  description: project.description,
  category: project.category,
  repoUrl: project.repoUrl,
  repoOwner: project.repoOwner,
  status: project.status,
  hidden: project.hidden,
  featured: project.featured,
  submitterName: project.submitterName,
  submitterGithub: project.submitterGithub,
  createdAt: project.createdAt,
  reviewedAt: project.reviewedAt,
  reviewNote: project.reviewNote,
})

const currentUser = (cookies, sessions, database) => {
  const googleId = cookies.session && sessions.get(cookies.session)
  return googleId ? database.getUser(googleId) : null
}

const denied = (response, user, roles) => {
  if (!user) {
    send(response, 401, { error: 'Sign in with Google to continue.' })
    return true
  }
  if (!roles.has(user.role)) {
    send(response, 403, { error: 'You do not have permission to do that.' })
    return true
  }
  return false
}

export const handleApiRequest = async (request, response, cookies, sessions, database) => {
  const { method } = request
  const pathname = new URL(request.url, 'http://localhost').pathname
  const user = currentUser(cookies, sessions, database)

  if (method === 'GET' && pathname === '/auth/session') {
    return send(response, user ? 200 : 401, { user })
  }

  if (method === 'POST' && pathname === '/auth/logout') {
    sessions.delete(cookies.session)
    return send(response, 200, { ok: true }, { 'set-cookie': 'session=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/' })
  }

  if (method === 'GET' && pathname === '/api/projects') {
    return send(response, 200, { projects: database.listApprovedSubmissions().map(publicProject) })
  }

  if (method === 'GET' && pathname === '/api/notifications') {
    if (denied(response, user, new Set(['user', 'manager', 'admin', 'superadmin']))) return true
    return send(response, 200, { notifications: database.listNotifications(user.id) })
  }

  if (method === 'PATCH' && pathname === '/api/notifications') {
    if (denied(response, user, new Set(['user', 'manager', 'admin', 'superadmin']))) return true
    const body = await readJson(request)
    const notificationIds = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string').slice(0, 50) : []
    database.markNotificationsRead(user.id, notificationIds)
    return send(response, 200, { notifications: database.listNotifications(user.id) })
  }

  if (method === 'POST' && pathname === '/api/profile') {
    if (denied(response, user, new Set(['user', 'manager', 'admin', 'superadmin']))) return true
    const body = await readJson(request)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const contactEmail = typeof body.contactEmail === 'string' ? body.contactEmail.trim().toLowerCase() : ''
    const bio = typeof body.bio === 'string' ? body.bio.trim() : ''
    if (!name || name.length > 80) return send(response, 400, { error: 'Name is required and must be 80 characters or fewer.' })
    if (contactEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail) || contactEmail.length > 254)) {
      return send(response, 400, { error: 'Enter a valid contact email address.' })
    }
    if (bio.length > 500) return send(response, 400, { error: 'Bio must be 500 characters or fewer.' })
    return send(response, 200, { user: database.updateProfile(user.id, { name, contactEmail, bio }) })
  }

  if (method === 'POST' && pathname === '/api/projects') {
    if (denied(response, user, new Set(['user', 'manager', 'admin', 'superadmin']))) return true
    if (!user.github) return send(response, 409, { error: 'Connect your GitHub account before submitting a repository.' })
    const body = await readJson(request)
    if (!submissionCategories.has(body.category)) return send(response, 400, { error: 'Choose a valid project category.' })
    const description = typeof body.description === 'string' ? body.description.trim() : ''
    if (description.length > 1200) return send(response, 400, { error: 'Project summary must be 1,200 characters or fewer.' })

    let repositoryUrl
    let owner
    let repositoryName
    try {
      repositoryUrl = new URL(body.repoUrl)
      const segments = repositoryUrl.pathname.split('/').filter(Boolean)
      if (repositoryUrl.protocol !== 'https:' || repositoryUrl.hostname !== 'github.com' || segments.length !== 2) throw new Error()
      owner = decodeURIComponent(segments[0])
      repositoryName = decodeURIComponent(segments[1]).replace(/\.git$/i, '')
    } catch {
      return send(response, 400, { error: 'Enter a public GitHub repository URL, such as https://github.com/owner/project.' })
    }
    if (owner.toLowerCase() !== user.github.login.toLowerCase()) {
      return send(response, 403, { error: 'Submit a public repository owned by your connected GitHub account.' })
    }

    const githubResponse = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repositoryName)}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'anonymous-hyena' },
    })
    if (githubResponse.status === 404) return send(response, 404, { error: 'That repository could not be found or is not public.' })
    if (!githubResponse.ok) return send(response, 502, { error: 'GitHub could not verify this repository. Try again shortly.' })
    const repository = await githubResponse.json()
    if (repository.private || repository.owner?.login?.toLowerCase() !== user.github.login.toLowerCase()) {
      return send(response, 403, { error: 'Only public repositories owned by your connected GitHub account can be submitted.' })
    }

    const repoUrl = `https://github.com/${repository.owner.login}/${repository.name}`
    if (database.findActiveSubmission(repoUrl)) {
      return send(response, 409, { error: 'This repository is already published or waiting for review.' })
    }

    const submission = {
      id: randomUUID(),
      repoOwner: repository.owner.login,
      repoName: repository.name,
      repoUrl,
      description,
      repositoryDescription: repository.description || '',
      category: body.category,
      defaultBranch: repository.default_branch || 'main',
      pushedAt: repository.pushed_at || new Date().toISOString(),
      submittedBy: user.id,
    }
    database.createSubmission(submission)
    return send(response, 201, { submission: { id: submission.id, name: submission.repoName, status: 'pending' } })
  }

  if (method === 'GET' && pathname === '/api/admin/submissions') {
    if (denied(response, user, staffRoles)) return true
    return send(response, 200, { submissions: database.listSubmissions().map(reviewProject) })
  }

  if (method === 'PATCH' && pathname === '/api/admin/submissions') {
    if (denied(response, user, staffRoles)) return true
    const body = await readJson(request)
    if (typeof body.id !== 'string' || !['approved', 'rejected'].includes(body.status)) {
      return send(response, 400, { error: 'A submission ID and valid review decision are required.' })
    }
    const reviewNote = typeof body.reviewNote === 'string' ? body.reviewNote.trim().slice(0, 500) : ''
    const submission = database.reviewSubmission(body.id, user.id, body.status, reviewNote)
    if (submission && reviewNote) {
      const decision = body.status === 'approved' ? 'approved' : 'not approved'
      database.createNotification({
        userId: submission.submitterId,
        kind: 'project_review',
        message: `Your project "${submission.name}" was ${decision}. Reviewer note: ${reviewNote}`,
        submissionId: submission.id,
      })
    }
    return submission
      ? send(response, 200, { submission: reviewProject(submission) })
      : send(response, 404, { error: 'Submission not found.' })
  }

  if (method === 'PATCH' && pathname === '/api/admin/submissions/visibility') {
    if (denied(response, user, staffRoles)) return true
    const body = await readJson(request)
    if (typeof body.id !== 'string' || typeof body.hidden !== 'boolean') {
      return send(response, 400, { error: 'A project ID and hidden state are required.' })
    }
    const submission = database.setSubmissionHidden(body.id, body.hidden)
    return submission
      ? send(response, 200, { submission: reviewProject(submission) })
      : send(response, 404, { error: 'Approved project not found.' })
  }

  if (method === 'PATCH' && pathname === '/api/admin/submissions/showcase') {
    if (denied(response, user, adminRoles)) return true
    const body = await readJson(request)
    if (typeof body.id !== 'string' || typeof body.featured !== 'boolean') {
      return send(response, 400, { error: 'A project ID and featured state are required.' })
    }
    const submission = database.setSubmissionFeatured(body.id, body.featured)
    return submission
      ? send(response, 200, { submission: reviewProject(submission) })
      : send(response, 404, { error: 'Approved project not found.' })
  }

  if (method === 'DELETE' && pathname === '/api/admin/submissions') {
    if (denied(response, user, staffRoles)) return true
    const id = new URL(request.url, 'http://localhost').searchParams.get('id')
    if (!id) return send(response, 400, { error: 'A project ID is required.' })
    return database.deleteSubmission(id)
      ? send(response, 200, { ok: true })
      : send(response, 404, { error: 'Approved project not found.' })
  }

  if (method === 'GET' && pathname === '/api/admin/users') {
    if (denied(response, user, adminRoles)) return true
    return send(response, 200, { users: database.listUsers(), invites: database.listInvites() })
  }

  if (method === 'POST' && pathname === '/api/admin/users') {
    if (denied(response, user, adminRoles)) return true
    const body = await readJson(request)
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return send(response, 400, { error: 'Enter a valid email address.' })
    }
    if (email === 'mistermanuniq@gmail.com') return send(response, 403, { error: 'The superadmin account cannot be invited or replaced.' })
    if (database.findUserByEmail(email)) return send(response, 409, { error: 'This email already belongs to a user.' })
    if (typeof body.role !== 'string' || !assignableRoles.has(body.role)) {
      return send(response, 400, { error: 'Choose a user, manager, or admin role.' })
    }
    if (name.length > 80) return send(response, 400, { error: 'Name must be 80 characters or fewer.' })
    try {
      const invite = database.createInvite({ email, name: name || email.split('@')[0], role: body.role, invitedBy: user.id })
      return send(response, 201, { invite })
    } catch (cause) {
      if (String(cause.message).includes('UNIQUE')) return send(response, 409, { error: 'An invitation already exists for this email.' })
      throw cause
    }
  }

  if (method === 'DELETE' && pathname === '/api/admin/users') {
    if (denied(response, user, adminRoles)) return true
    const id = new URL(request.url, 'http://localhost').searchParams.get('id')
    if (!id) return send(response, 400, { error: 'A user ID is required.' })
    if (id === user.id) return send(response, 400, { error: 'You cannot delete your own account.' })
    const target = database.getUser(id)
    if (!target) return send(response, 404, { error: 'User not found.' })
    if (target.role === 'superadmin') return send(response, 403, { error: 'The superadmin account is protected.' })
    database.deleteUser(id)
    return send(response, 200, { ok: true })
  }

  if (method === 'DELETE' && pathname === '/api/admin/invites') {
    if (denied(response, user, adminRoles)) return true
    const id = new URL(request.url, 'http://localhost').searchParams.get('id')
    if (!id) return send(response, 400, { error: 'An invitation ID is required.' })
    return database.deleteInvite(id)
      ? send(response, 200, { ok: true })
      : send(response, 404, { error: 'Invitation not found.' })
  }

  if (method === 'PATCH' && pathname === '/api/admin/users/role') {
    if (denied(response, user, adminRoles)) return true
    const body = await readJson(request)
    if (typeof body.id !== 'string' || !assignableRoles.has(body.role)) {
      return send(response, 400, { error: 'Choose a valid user, manager, or admin role.' })
    }
    const target = database.getUser(body.id)
    if (!target) return send(response, 404, { error: 'User not found.' })
    if (target.role === 'superadmin') return send(response, 403, { error: 'The superadmin role is protected.' })
    if (target.id === user.id && target.role !== body.role) return send(response, 400, { error: 'You cannot change your own role.' })
    return send(response, 200, { user: database.updateRole(target.id, body.role) })
  }

  if (method === 'POST' && pathname.startsWith('/api/')) {
    return send(response, 404, { error: 'API route not found.' })
  }

  return false
}

export const handleApiError = (response, cause) => {
  if (response.headersSent) return response.end()
  const status = Number.isInteger(cause.status) ? cause.status : 500
  if (status === 500) console.error('API request failed:', cause)
  return send(response, status, { error: status === 500 ? 'The server could not complete that request.' : cause.message })
}
