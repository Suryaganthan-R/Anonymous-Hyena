import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const superadminEmail = 'mistermanuniq@gmail.com'
const defaultDatabasePath = fileURLToPath(new URL('./data/anonymous-hyena.sqlite', import.meta.url))

const toUser = (row) => row && ({
  id: row.google_id,
  email: row.email,
  name: row.name,
  contactEmail: row.contact_email,
  bio: row.bio,
  avatarUrl: row.avatar_url,
  role: row.role,
  github: row.github_login ? {
    id: row.github_id,
    login: row.github_login,
    name: row.github_name,
    avatarUrl: row.github_avatar_url,
  } : null,
  createdAt: row.created_at,
})

const toSubmission = (row) => row && ({
  id: row.id,
  name: row.repo_name,
  repoOwner: row.repo_owner,
  repoUrl: row.repo_url,
  description: row.description,
  repositoryDescription: row.repository_description,
  category: row.category,
  defaultBranch: row.default_branch,
  pushedAt: row.pushed_at,
  status: row.status,
  submitterId: row.submitted_by,
  submitterName: row.submitter_name,
  submitterEmail: row.submitter_email,
  submitterGithub: row.submitter_github,
  reviewerId: row.reviewer_id,
  reviewNote: row.review_note,
  hidden: Boolean(row.hidden),
  createdAt: row.created_at,
  reviewedAt: row.reviewed_at,
})

const toNotification = (row) => row && ({
  id: row.id,
  kind: row.kind,
  message: row.message,
  submissionId: row.submission_id,
  createdAt: row.created_at,
  readAt: row.read_at,
})

export class AppDatabase {
  constructor(filename = process.env.DATABASE_PATH || defaultDatabasePath) {
    const databasePath = filename === ':memory:' ? filename : resolve(filename)
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true })
    this.connection = new DatabaseSync(databasePath)
    this.connection.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS users (
        google_id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        contact_email TEXT NOT NULL DEFAULT '',
        bio TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'manager', 'admin', 'superadmin')),
        github_id TEXT UNIQUE,
        github_login TEXT,
        github_name TEXT,
        github_avatar_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        repo_owner TEXT NOT NULL,
        repo_name TEXT NOT NULL,
        repo_url TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        repository_description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL,
        default_branch TEXT NOT NULL DEFAULT 'main',
        pushed_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        submitted_by TEXT NOT NULL REFERENCES users(google_id),
        reviewer_id TEXT REFERENCES users(google_id),
        review_note TEXT NOT NULL DEFAULT '',
        hidden INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        reviewed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(google_id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        message TEXT NOT NULL,
        submission_id TEXT,
        created_at TEXT NOT NULL,
        read_at TEXT
      );
      CREATE TABLE IF NOT EXISTS user_invites (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'manager', 'admin')),
        invited_by TEXT NOT NULL REFERENCES users(google_id),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS submissions_status_created ON submissions(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS submissions_submitter ON submissions(submitted_by, created_at DESC);
      CREATE INDEX IF NOT EXISTS notifications_user_created ON notifications(user_id, created_at DESC);
    `)
    const submissionColumns = this.connection.prepare('PRAGMA table_info(submissions)').all()
    if (!submissionColumns.some((column) => column.name === 'hidden')) {
      this.connection.exec('ALTER TABLE submissions ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0')
    }
  }

  getUser(googleId) {
    return toUser(this.connection.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId))
  }

  upsertGoogleUser(profile) {
    const existing = this.getUser(profile.sub)
    const email = profile.email.trim().toLowerCase()
    const invite = this.connection.prepare('SELECT * FROM user_invites WHERE email = ? COLLATE NOCASE').get(email)
    const now = new Date().toISOString()
    const role = email === superadminEmail ? 'superadmin' : (existing?.role || invite?.role || 'user')

    if (existing) {
      this.connection.prepare(`
        UPDATE users SET email = ?, avatar_url = ?, role = ?, updated_at = ?
        WHERE google_id = ?
      `).run(email, profile.picture || existing.avatarUrl, role, now, profile.sub)
    } else {
      this.connection.prepare(`
        INSERT INTO users (google_id, email, name, avatar_url, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(profile.sub, email, invite?.name || profile.name || email, profile.picture || '', role, now, now)
    }
    if (invite) this.connection.prepare('DELETE FROM user_invites WHERE id = ?').run(invite.id)

    return this.getUser(profile.sub)
  }

  updateProfile(googleId, { name, contactEmail, bio }) {
    this.connection.prepare(`
      UPDATE users SET name = ?, contact_email = ?, bio = ?, updated_at = ?
      WHERE google_id = ?
    `).run(name, contactEmail, bio, new Date().toISOString(), googleId)
    return this.getUser(googleId)
  }

  linkGithub(googleId, profile) {
    this.connection.prepare(`
      UPDATE users SET github_id = ?, github_login = ?, github_name = ?, github_avatar_url = ?, updated_at = ?
      WHERE google_id = ?
    `).run(String(profile.id), profile.login, profile.name || '', profile.avatar_url || '', new Date().toISOString(), googleId)
    return this.getUser(googleId)
  }

  listApprovedSubmissions() {
    return this.connection.prepare(`
      SELECT s.*, u.name AS submitter_name, u.email AS submitter_email, u.github_login AS submitter_github
      FROM submissions s JOIN users u ON u.google_id = s.submitted_by
      WHERE s.status = 'approved' AND s.hidden = 0 ORDER BY s.created_at DESC
    `).all().map(toSubmission)
  }

  listSubmissions(status = 'all') {
    const query = `
      SELECT s.*, u.name AS submitter_name, u.email AS submitter_email, u.github_login AS submitter_github
      FROM submissions s JOIN users u ON u.google_id = s.submitted_by
      ${status === 'all' ? '' : 'WHERE s.status = ?'}
      ORDER BY CASE s.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, s.created_at DESC
    `
    const rows = status === 'all' ? this.connection.prepare(query).all() : this.connection.prepare(query).all(status)
    return rows.map(toSubmission)
  }

  findActiveSubmission(repoUrl) {
    const row = this.connection.prepare(`
      SELECT id FROM submissions WHERE repo_url = ? AND status IN ('pending', 'approved') LIMIT 1
    `).get(repoUrl)
    return Boolean(row)
  }

  createSubmission(submission) {
    this.connection.prepare(`
      INSERT INTO submissions (
        id, repo_owner, repo_name, repo_url, description, repository_description,
        category, default_branch, pushed_at, submitted_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      submission.id,
      submission.repoOwner,
      submission.repoName,
      submission.repoUrl,
      submission.description,
      submission.repositoryDescription,
      submission.category,
      submission.defaultBranch,
      submission.pushedAt,
      submission.submittedBy,
      new Date().toISOString(),
    )
    return this.connection.prepare('SELECT * FROM submissions WHERE id = ?').get(submission.id)
  }

  reviewSubmission(id, reviewerId, status, reviewNote) {
    const result = this.connection.prepare(`
      UPDATE submissions SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(status, reviewerId, reviewNote, new Date().toISOString(), id)
    return result.changes ? this.listSubmissions('all').find((submission) => submission.id === id) : null
  }

  setSubmissionHidden(id, hidden) {
    const result = this.connection.prepare('UPDATE submissions SET hidden = ? WHERE id = ? AND status = \'approved\'')
      .run(hidden ? 1 : 0, id)
    return result.changes ? this.listSubmissions('all').find((submission) => submission.id === id) : null
  }

  deleteSubmission(id) {
    return this.connection.prepare('DELETE FROM submissions WHERE id = ? AND status = \'approved\'').run(id).changes > 0
  }

  createNotification({ userId, kind, message, submissionId }) {
    const id = randomUUID()
    this.connection.prepare(`
      INSERT INTO notifications (id, user_id, kind, message, submission_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, kind, message, submissionId, new Date().toISOString())
    return this.getNotification(userId, id)
  }

  getNotification(userId, notificationId) {
    return toNotification(this.connection.prepare('SELECT * FROM notifications WHERE user_id = ? AND id = ?').get(userId, notificationId))
  }

  listNotifications(userId) {
    return this.connection.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(userId).map(toNotification)
  }

  markNotificationsRead(userId, notificationIds = []) {
    const now = new Date().toISOString()
    if (notificationIds.length) {
      const placeholders = notificationIds.map(() => '?').join(', ')
      this.connection.prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${placeholders})`)
        .run(now, userId, ...notificationIds)
      return
    }
    this.connection.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now, userId)
  }

  listUsers() {
    return this.connection.prepare('SELECT * FROM users ORDER BY created_at DESC').all().map(toUser)
  }

  updateRole(googleId, role) {
    const result = this.connection.prepare('UPDATE users SET role = ?, updated_at = ? WHERE google_id = ?')
      .run(role, new Date().toISOString(), googleId)
    return result.changes ? this.getUser(googleId) : null
  }

  createInvite({ email, name, role, invitedBy }) {
    const id = randomUUID()
    this.connection.prepare(`
      INSERT INTO user_invites (id, email, name, role, invited_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, email, name, role, invitedBy, new Date().toISOString())
    return this.getInvite(id)
  }

  getInvite(id) {
    const row = this.connection.prepare(`
      SELECT i.*, u.name AS inviter_name
      FROM user_invites i JOIN users u ON u.google_id = i.invited_by
      WHERE i.id = ?
    `).get(id)
    return row && ({ id: row.id, email: row.email, name: row.name, role: row.role, invitedBy: row.inviter_name, createdAt: row.created_at })
  }

  listInvites() {
    return this.connection.prepare(`
      SELECT i.*, u.name AS inviter_name
      FROM user_invites i JOIN users u ON u.google_id = i.invited_by
      ORDER BY i.created_at DESC
    `).all().map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      invitedBy: row.inviter_name,
      createdAt: row.created_at,
    }))
  }

  findUserByEmail(email) {
    return toUser(this.connection.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email))
  }

  deleteInvite(id) {
    return this.connection.prepare('DELETE FROM user_invites WHERE id = ?').run(id).changes > 0
  }

  deleteUser(googleId) {
    this.connection.exec('BEGIN IMMEDIATE')
    try {
      this.connection.prepare('DELETE FROM user_invites WHERE invited_by = ?').run(googleId)
      this.connection.prepare('DELETE FROM submissions WHERE submitted_by = ?').run(googleId)
      this.connection.prepare('UPDATE submissions SET reviewer_id = NULL WHERE reviewer_id = ?').run(googleId)
      const deleted = this.connection.prepare('DELETE FROM users WHERE google_id = ?').run(googleId).changes > 0
      this.connection.exec('COMMIT')
      return deleted
    } catch (cause) {
      this.connection.exec('ROLLBACK')
      throw cause
    }
  }

  close() {
    this.connection.close()
  }
}
