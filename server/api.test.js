import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { AppDatabase } from './database.js'
import { handleApiRequest } from './api.js'

let database
const originalGithubOrg = process.env.GITHUB_ORG
const originalGithubOrgToken = process.env.GITHUB_ORG_TOKEN
const originalFetch = globalThis.fetch
const sessions = new Map([
  ['super-session', 'super-id'],
  ['admin-session', 'admin-id'],
  ['manager-session', 'manager-id'],
  ['user-session', 'user-id'],
])

const addUser = (sub, email, name) => database.upsertGoogleUser({ sub, email, email_verified: true, name, picture: '' })

const callApi = async ({ method = 'GET', path, session, body }) => {
  const response = {
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(content = '') {
      this.body = content
    },
  }
  const request = {
    method,
    url: path,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body))
    },
  }
  await handleApiRequest(request, response, session ? { session } : {}, sessions, database)
  return { status: response.status, body: JSON.parse(response.body || '{}') }
}

beforeEach(() => {
  database = new AppDatabase(':memory:')
  addUser('super-id', 'mistermanuniq@gmail.com', 'Superadmin')
  addUser('admin-id', 'admin@example.com', 'Admin')
  addUser('manager-id', 'manager@example.com', 'Manager')
  addUser('user-id', 'user@example.com', 'User')
  database.updateRole('admin-id', 'admin')
  database.updateRole('manager-id', 'manager')
})

afterEach(() => database.close())

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalGithubOrg === undefined) delete process.env.GITHUB_ORG
  else process.env.GITHUB_ORG = originalGithubOrg
  if (originalGithubOrgToken === undefined) delete process.env.GITHUB_ORG_TOKEN
  else process.env.GITHUB_ORG_TOKEN = originalGithubOrgToken
})

const createApprovedProject = (id = 'organization-project') => {
  database.createSubmission({
    id, repoOwner: 'user', repoName: 'scanner', repoUrl: 'https://github.com/user/scanner',
    description: 'A security scanner', repositoryDescription: '', category: 'Tool', defaultBranch: 'main',
    pushedAt: new Date().toISOString(), submittedBy: 'user-id',
  })
  database.reviewSubmission(id, 'manager-id', 'approved', '')
}

test('manager can review submissions but cannot access the user directory', async () => {
  const project = {
    id: 'project-1', repoOwner: 'user', repoName: 'scanner', repoUrl: 'https://github.com/user/scanner',
    description: 'A security tool', repositoryDescription: '', category: 'Tool', defaultBranch: 'main',
    pushedAt: new Date().toISOString(), submittedBy: 'user-id',
  }
  database.linkGithub('user-id', { id: 100, login: 'user', name: 'User', avatar_url: '' })
  database.createSubmission(project)

  const queue = await callApi({ path: '/api/admin/submissions', session: 'manager-session' })
  assert.equal(queue.status, 200)
  assert.equal(queue.body.submissions[0].status, 'pending')

  const users = await callApi({ path: '/api/admin/users', session: 'manager-session' })
  assert.equal(users.status, 403)

  const decision = await callApi({
    method: 'PATCH', path: '/api/admin/submissions', session: 'manager-session',
    body: { id: 'project-1', status: 'approved', reviewNote: '' },
  })
  assert.equal(decision.status, 200)
  assert.equal(decision.body.submission.status, 'approved')

  const noNoteNotifications = await callApi({ path: '/api/notifications', session: 'user-session' })
  assert.equal(noNoteNotifications.body.notifications.length, 0)

  const publicProjects = await callApi({ path: '/api/projects' })
  assert.equal(publicProjects.status, 200)
  assert.equal(publicProjects.body.projects.length, 1)
  assert.equal('submitterEmail' in publicProjects.body.projects[0], false)
})

test('regular users cannot access staff APIs and anonymous users cannot edit profiles', async () => {
  const userQueue = await callApi({ path: '/api/admin/submissions', session: 'user-session' })
  const anonymousUsers = await callApi({ path: '/api/admin/users' })
  const anonymousProfile = await callApi({ method: 'POST', path: '/api/profile', body: { name: 'Changed' } })
  assert.equal(userQueue.status, 403)
  assert.equal(anonymousUsers.status, 401)
  assert.equal(anonymousProfile.status, 401)
})

test('admins can assign staff roles but cannot change their own or the superadmin role', async () => {
  const promote = await callApi({
    method: 'PATCH', path: '/api/admin/users/role', session: 'admin-session',
    body: { id: 'user-id', role: 'manager' },
  })
  assert.equal(promote.status, 200)
  assert.equal(promote.body.user.role, 'manager')

  const selfChange = await callApi({
    method: 'PATCH', path: '/api/admin/users/role', session: 'admin-session',
    body: { id: 'admin-id', role: 'manager' },
  })
  assert.equal(selfChange.status, 400)

  const superadminChange = await callApi({
    method: 'PATCH', path: '/api/admin/users/role', session: 'admin-session',
    body: { id: 'super-id', role: 'admin' },
  })
  assert.equal(superadminChange.status, 403)

  const assignSuperadmin = await callApi({
    method: 'PATCH', path: '/api/admin/users/role', session: 'super-session',
    body: { id: 'user-id', role: 'superadmin' },
  })
  assert.equal(assignSuperadmin.status, 400)
})

test('admins can invite users by email and the invited role binds at Google sign-in', async () => {
  const managerInviteForbidden = await callApi({
    method: 'POST', path: '/api/admin/users', session: 'manager-session',
    body: { name: 'New Manager', email: 'new.manager@example.com', role: 'manager' },
  })
  assert.equal(managerInviteForbidden.status, 403)

  const invite = await callApi({
    method: 'POST', path: '/api/admin/users', session: 'admin-session',
    body: { name: 'New Manager', email: 'new.manager@example.com', role: 'manager' },
  })
  assert.equal(invite.status, 201)
  assert.equal(invite.body.invite.role, 'manager')

  const duplicate = await callApi({
    method: 'POST', path: '/api/admin/users', session: 'super-session',
    body: { email: 'NEW.MANAGER@example.com', role: 'user' },
  })
  assert.equal(duplicate.status, 409)

  const firstSignIn = database.upsertGoogleUser({
    sub: 'new-manager-id', email: 'new.manager@example.com', email_verified: true, name: 'Google Name', picture: '',
  })
  assert.equal(firstSignIn.role, 'manager')
  assert.equal(firstSignIn.name, 'New Manager')
  assert.equal(database.listInvites().length, 0)
})

test('admins can cancel invitations and delete eligible users but not themselves or superadmin', async () => {
  const invite = await callApi({
    method: 'POST', path: '/api/admin/users', session: 'admin-session',
    body: { email: 'pending@example.com', role: 'user' },
  })
  const cancel = await callApi({
    method: 'DELETE', path: `/api/admin/invites?id=${invite.body.invite.id}`, session: 'admin-session',
  })
  assert.equal(cancel.status, 200)

  database.createSubmission({
    id: 'user-owned-project', repoOwner: 'user', repoName: 'scanner', repoUrl: 'https://github.com/user/scanner',
    description: 'A scanner', repositoryDescription: '', category: 'Tool', defaultBranch: 'main',
    pushedAt: new Date().toISOString(), submittedBy: 'user-id',
  })
  database.createNotification({ userId: 'user-id', kind: 'review', message: 'Review note', submissionId: 'user-owned-project' })

  const deleteSelf = await callApi({ method: 'DELETE', path: '/api/admin/users?id=admin-id', session: 'admin-session' })
  const deleteSuperadmin = await callApi({ method: 'DELETE', path: '/api/admin/users?id=super-id', session: 'admin-session' })
  assert.equal(deleteSelf.status, 400)
  assert.equal(deleteSuperadmin.status, 403)

  const deleteUser = await callApi({ method: 'DELETE', path: '/api/admin/users?id=user-id', session: 'admin-session' })
  assert.equal(deleteUser.status, 200)
  assert.equal(database.getUser('user-id'), undefined)
  assert.equal(database.listSubmissions().some((submission) => submission.id === 'user-owned-project'), false)
  assert.equal(database.listNotifications('user-id').length, 0)
})

test('profile edits leave the verified Google login email unchanged', async () => {
  const result = await callApi({
    method: 'POST', path: '/api/profile', session: 'user-session',
    body: { name: 'Updated Name', contactEmail: 'contact@example.com', bio: 'Security student' },
  })
  assert.equal(result.status, 200)
  assert.equal(result.body.user.email, 'user@example.com')
  assert.equal(result.body.user.contactEmail, 'contact@example.com')
  assert.equal(result.body.user.name, 'Updated Name')
})

test('a review note creates a private student notification', async () => {
  database.createSubmission({
    id: 'noted-project', repoOwner: 'user', repoName: 'scanner', repoUrl: 'https://github.com/user/scanner',
    description: 'A security tool', repositoryDescription: '', category: 'Tool', defaultBranch: 'main',
    pushedAt: new Date().toISOString(), submittedBy: 'user-id',
  })

  const review = await callApi({
    method: 'PATCH', path: '/api/admin/submissions', session: 'manager-session',
    body: { id: 'noted-project', status: 'approved', reviewNote: 'Please add installation steps.' },
  })
  assert.equal(review.status, 200)

  const studentNotifications = await callApi({ path: '/api/notifications', session: 'user-session' })
  assert.equal(studentNotifications.status, 200)
  assert.equal(studentNotifications.body.notifications.length, 1)
  assert.match(studentNotifications.body.notifications[0].message, /Please add installation steps/)

  const anotherUserNotifications = await callApi({ path: '/api/notifications', session: 'manager-session' })
  assert.equal(anotherUserNotifications.body.notifications.length, 0)

  const markRead = await callApi({
    method: 'PATCH', path: '/api/notifications', session: 'user-session',
    body: { ids: [studentNotifications.body.notifications[0].id] },
  })
  assert.ok(markRead.body.notifications[0].readAt)

  database.createSubmission({
    id: 'rejected-project', repoOwner: 'user', repoName: 'other-tool', repoUrl: 'https://github.com/user/other-tool',
    description: 'Another security tool', repositoryDescription: '', category: 'Tool', defaultBranch: 'main',
    pushedAt: new Date().toISOString(), submittedBy: 'user-id',
  })
  const rejection = await callApi({
    method: 'PATCH', path: '/api/admin/submissions', session: 'manager-session',
    body: { id: 'rejected-project', status: 'rejected', reviewNote: 'Please include a setup guide.' },
  })
  assert.equal(rejection.status, 200)
  const afterRejection = await callApi({ path: '/api/notifications', session: 'user-session' })
  assert.equal(afterRejection.body.notifications.length, 2)
  assert.match(afterRejection.body.notifications[0].message, /Please include a setup guide/)
})

test('staff can hide and restore approved projects, then delete them', async () => {
  database.createSubmission({
    id: 'visible-project', repoOwner: 'user', repoName: 'tool', repoUrl: 'https://github.com/user/tool',
    description: 'A tool', repositoryDescription: '', category: 'Tool', defaultBranch: 'main',
    pushedAt: new Date().toISOString(), submittedBy: 'user-id',
  })
  database.reviewSubmission('visible-project', 'manager-id', 'approved', '')

  const hidden = await callApi({
    method: 'PATCH', path: '/api/admin/submissions/visibility', session: 'manager-session',
    body: { id: 'visible-project', hidden: true },
  })
  assert.equal(hidden.status, 200)
  assert.equal(hidden.body.submission.hidden, true)
  assert.equal((await callApi({ path: '/api/projects' })).body.projects.length, 0)

  const restored = await callApi({
    method: 'PATCH', path: '/api/admin/submissions/visibility', session: 'manager-session',
    body: { id: 'visible-project', hidden: false },
  })
  assert.equal(restored.body.submission.hidden, false)
  assert.equal((await callApi({ path: '/api/projects' })).body.projects.length, 1)

  const deleted = await callApi({ method: 'DELETE', path: '/api/admin/submissions?id=visible-project', session: 'manager-session' })
  assert.equal(deleted.status, 200)
  assert.equal((await callApi({ path: '/api/projects' })).body.projects.length, 0)
})

test('only staff can synchronize an approved project', async () => {
  createApprovedProject()
  const anonymous = await callApi({ method: 'POST', path: '/api/admin/submissions/organization-project/github-sync' })
  const user = await callApi({ method: 'POST', path: '/api/admin/submissions/organization-project/github-sync', session: 'user-session' })
  assert.equal(anonymous.status, 401)
  assert.equal(user.status, 403)
})

test('synchronization requires an approved project and organization configuration', async () => {
  database.createSubmission({
    id: 'pending-organization-project', repoOwner: 'user', repoName: 'scanner', repoUrl: 'https://github.com/user/scanner',
    description: 'A scanner', repositoryDescription: '', category: 'Tool', defaultBranch: 'main',
    pushedAt: new Date().toISOString(), submittedBy: 'user-id',
  })
  const pending = await callApi({ method: 'POST', path: '/api/admin/submissions/pending-organization-project/github-sync', session: 'manager-session' })
  assert.equal(pending.status, 409)

  createApprovedProject('unconfigured-project')
  delete process.env.GITHUB_ORG
  delete process.env.GITHUB_ORG_TOKEN
  const unconfigured = await callApi({ method: 'POST', path: '/api/admin/submissions/unconfigured-project/github-sync', session: 'manager-session' })
  assert.equal(unconfigured.status, 503)
  assert.equal(database.getSubmission('unconfigured-project').githubSyncStatus, 'failed')
})

test('successful synchronization creates a README, stores the repository, and reuses it', async () => {
  createApprovedProject()
  process.env.GITHUB_ORG = 'Anonymous-Hyena'
  process.env.GITHUB_ORG_TOKEN = 'test-token'
  let calls = 0
  globalThis.fetch = async (url, options) => {
    calls += 1
    if (calls === 1) {
      assert.equal(url, 'https://api.github.com/orgs/Anonymous-Hyena/repos')
      assert.equal(options.method, 'POST')
      assert.match(options.headers.authorization, /^Bearer test-token$/)
      assert.equal(JSON.parse(options.body).auto_init, false)
      return { ok: true, status: 201, async json() { return { id: 42, name: 'scanner', html_url: 'https://github.com/Anonymous-Hyena/scanner', default_branch: 'main' } } }
    }
    assert.equal(url, 'https://api.github.com/repos/Anonymous-Hyena/scanner/contents/README.md')
    assert.equal(options.method, 'PUT')
    assert.match(Buffer.from(JSON.parse(options.body).content, 'base64').toString(), /Original repository: https:\/\/github.com\/user\/scanner/)
    return { ok: true, status: 201, async json() { return {} } }
  }

  const synced = await callApi({ method: 'POST', path: '/api/admin/submissions/organization-project/github-sync', session: 'manager-session' })
  assert.equal(synced.status, 201)
  assert.equal(synced.body.submission.githubSyncStatus, 'synced')
  assert.equal(synced.body.submission.githubOrgRepoUrl, 'https://github.com/Anonymous-Hyena/scanner')

  const repeated = await callApi({ method: 'POST', path: '/api/admin/submissions/organization-project/github-sync', session: 'admin-session' })
  assert.equal(repeated.status, 200)
  assert.equal(repeated.body.alreadySynced, true)
  assert.equal(calls, 2)
})

test('GitHub failures are sanitized and leave the project retryable', async () => {
  createApprovedProject()
  process.env.GITHUB_ORG = 'Anonymous-Hyena'
  process.env.GITHUB_ORG_TOKEN = 'test-token'
  globalThis.fetch = async () => ({ ok: false, status: 403, async json() { return { message: 'sensitive GitHub details' } } })

  const result = await callApi({ method: 'POST', path: '/api/admin/submissions/organization-project/github-sync', session: 'admin-session' })
  assert.equal(result.status, 502)
  assert.equal(result.body.error, 'The GitHub organization token cannot create repositories.')
  assert.equal(database.getSubmission('organization-project').githubSyncStatus, 'failed')
  assert.doesNotMatch(JSON.stringify(result.body), /sensitive GitHub details/)
})
