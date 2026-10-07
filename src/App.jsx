import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import './Workflow.css'
import { navItems, stats, projectCategories, projectCatalog } from './data/siteData'
import AdminPortal from './AdminPortal'
import ContributionDialog from './ContributionDialog'
import ProfileDialog from './ProfileDialog'
import { requestJson } from './api'
import hyenaImage from '../hyena.png'

const scrollToSection = (event, sectionId) => {
  event.preventDefault()
  window.history.replaceState(null, '', window.location.pathname)
  document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' })
}

function BackgroundNetwork() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return undefined

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let width = 0
    let height = 0
    let animationFrame = 0
    let pointer = null
    let dispersal = null
    let lastFrame = 0
    const nodes = Array.from({ length: 22 }, (_, index) => ({
      x: (index * 0.61803398875) % 1,
      y: (index * 0.75487766625) % 1,
      vx: Math.sin(index * 12.9898) * 0.16,
      vy: Math.cos(index * 7.233) * 0.16,
      radius: index % 6 === 0 ? 2.6 : 1.6,
      attractedTo: null,
      disperseCooldown: 0,
    }))

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const previousWidth = width
      const previousHeight = height
      width = window.innerWidth
      height = window.innerHeight
      for (const node of nodes) {
        node.x = previousWidth ? node.x * width / previousWidth : node.x * width
        node.y = previousHeight ? node.y * height / previousHeight : node.y * height
      }
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    const onPointerMove = (event) => {
      const now = performance.now()
      const distance = pointer ? Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) : 0
      const elapsed = pointer ? Math.max(now - pointer.updatedAt, 1) : 16
      const speed = Math.min(distance / elapsed, 3)
      if (pointer && (distance > 100 || speed > 1.2)) {
        dispersal = { x: pointer.x, y: pointer.y, strength: Math.max(distance / 140, speed), remaining: 14 }
      }
      pointer = {
        x: event.clientX,
        y: event.clientY,
        speed,
        updatedAt: now,
      }
    }
    const clearPointer = () => { pointer = null }
    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('blur', clearPointer)

    const draw = (timestamp) => {
      const delta = Math.min((timestamp - (lastFrame || timestamp)) / 16.67, 2)
      lastFrame = timestamp
      context.clearRect(0, 0, width, height)

      for (const node of nodes) {
        if (node.disperseCooldown > 0) node.disperseCooldown -= delta
        if (pointer && node.attractedTo && Math.hypot(pointer.x - node.attractedTo.x, pointer.y - node.attractedTo.y) > 300) {
          let dx = node.x - node.attractedTo.x
          let dy = node.y - node.attractedTo.y
          let distance = Math.hypot(dx, dy)
          if (distance < 1) {
            dx = node.attractedTo.x - pointer.x
            dy = node.attractedTo.y - pointer.y
            distance = Math.hypot(dx, dy) || 1
          }
          node.vx += (dx / distance) * 0.32
          node.vy += (dy / distance) * 0.32
          node.attractedTo = null
          node.disperseCooldown = 18
        }

        if (dispersal && !reducedMotion) {
          const dx = node.x - dispersal.x
          const dy = node.y - dispersal.y
          const distance = Math.hypot(dx, dy)
          if (distance < 220 && distance > 1) {
            const force = (1 - distance / 220) * 0.055 * dispersal.strength * (dispersal.remaining / 14)
            node.vx += (dx / distance) * force * delta
            node.vy += (dy / distance) * force * delta
          }
        }

        if (pointer && !reducedMotion && node.disperseCooldown <= 0) {
          const dx = node.x - pointer.x
          const dy = node.y - pointer.y
          const distance = Math.hypot(dx, dy)
          const fastMovement = pointer.speed > 1.2
          const influenceRadius = fastMovement ? 190 : 250
          if (distance < influenceRadius && distance > 1) {
            if (fastMovement) {
              const force = (1 - distance / influenceRadius) * 0.022 * delta
              node.vx += (dx / distance) * force
              node.vy += (dy / distance) * force
            } else {
              node.attractedTo ??= { x: pointer.x, y: pointer.y }
              const force = (1 - distance / influenceRadius) * 0.008 * delta
              node.vx -= (dx / distance) * force
              node.vy -= (dy / distance) * force
            }
          }
        }

      if (dispersal) {
        dispersal.remaining -= delta
        if (dispersal.remaining <= 0) dispersal = null
      }
        node.vx += Math.sin(timestamp * 0.00022 + node.y * 0.008) * 0.002 * delta
        node.vy += Math.cos(timestamp * 0.00019 + node.x * 0.008) * 0.002 * delta
        node.vx *= 0.995
        node.vy *= 0.995
        const speed = Math.hypot(node.vx, node.vy)
        if (speed > 0.42) {
          node.vx = (node.vx / speed) * 0.42
          node.vy = (node.vy / speed) * 0.42
        }
        if (!reducedMotion) {
          node.x += node.vx * delta
          node.y += node.vy * delta
        }

        if (node.x < -8) node.x = width + 8
        if (node.x > width + 8) node.x = -8
        if (node.y < -8) node.y = height + 8
        if (node.y > height + 8) node.y = -8
      }
      if (pointer) {
        pointer.speed *= 0.9 ** delta
        if (pointer.speed < 0.06) pointer.speed = 0
      }

      const linkDistance = Math.min(140, width * 0.15)
      const candidateLinks = []
      for (let first = 0; first < nodes.length; first += 1) {
        for (let second = first + 1; second < nodes.length; second += 1) {
          const dx = nodes[first].x - nodes[second].x
          const dy = nodes[first].y - nodes[second].y
          const distance = Math.hypot(dx, dy)
          if (distance < linkDistance) candidateLinks.push({ first, second, distance })
        }
      }
      candidateLinks.sort((first, second) => first.distance - second.distance)
      const linkCounts = Array(nodes.length).fill(0)
      for (const link of candidateLinks) {
        if (linkCounts[link.first] >= 3 || linkCounts[link.second] >= 3) continue
        linkCounts[link.first] += 1
        linkCounts[link.second] += 1
        context.beginPath()
        context.moveTo(nodes[link.first].x, nodes[link.first].y)
        context.lineTo(nodes[link.second].x, nodes[link.second].y)
        context.strokeStyle = `rgba(103, 232, 249, ${(1 - link.distance / linkDistance) * 0.28})`
        context.lineWidth = 0.8
        context.stroke()
      }

      for (const node of nodes) {
        context.beginPath()
        context.arc(node.x, node.y, node.radius, 0, Math.PI * 2)
        context.fillStyle = node.radius > 2 ? 'rgba(103, 232, 249, 0.76)' : 'rgba(125, 211, 252, 0.56)'
        context.shadowBlur = node.radius > 2 ? 10 : 5
        context.shadowColor = 'rgba(103, 232, 249, 0.5)'
        context.fill()
      }
      context.shadowBlur = 0

      if (!reducedMotion) animationFrame = window.requestAnimationFrame(draw)
    }

    animationFrame = window.requestAnimationFrame(draw)
    return () => {
      window.cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('blur', clearPointer)
    }
  }, [])

  return <canvas ref={canvasRef} className="network-canvas" aria-hidden="true" />
}

function NotificationCenter({ userId }) {
  const [notifications, setNotifications] = useState([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    requestJson('/api/notifications')
      .then((result) => setNotifications(result.notifications))
      .catch(() => setNotifications([]))
  }, [userId])

  const toggleNotifications = async () => {
    const nextOpen = !open
    setOpen(nextOpen)
    if (!nextOpen) return

    try {
      const result = await requestJson('/api/notifications')
      const unreadIds = result.notifications.filter((notification) => !notification.readAt).map((notification) => notification.id)
      const updated = unreadIds.length
        ? await requestJson('/api/notifications', { method: 'PATCH', body: JSON.stringify({ ids: unreadIds }) })
        : result
      setNotifications(updated.notifications)
    } catch {
      setNotifications([])
    }
  }

  const unreadCount = notifications.filter((notification) => !notification.readAt).length

  return (
    <div className="notification-center">
      <button type="button" className="notification-button" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`} aria-expanded={open} onClick={toggleNotifications}>
        <span className="bell-glyph" aria-hidden="true" />
        {unreadCount > 0 && <span className="notification-count">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>
      {open && <section className="notification-popover" aria-label="Notifications">
        <div className="notification-heading"><strong>Notifications</strong><button type="button" onClick={() => setOpen(false)} aria-label="Close notifications">×</button></div>
        {notifications.length ? <ul>{notifications.map((notification) => <li key={notification.id} className={notification.readAt ? '' : 'is-unread'}>
          <p>{notification.message}</p><time dateTime={notification.createdAt}>{new Date(notification.createdAt).toLocaleString()}</time>
        </li>)}</ul> : <p className="notification-empty">You’re all caught up.</p>}
      </section>}
    </div>
  )
}

function ProjectDetails({ project, onBack }) {
  return (
    <main className="detail-page">
      <button type="button" className="text-link back-link" onClick={onBack}>← Back to projects</button>
      {project ? (
        <>
          <section className="detail-hero">
            <div>
              <span className="section-kicker">{project.category}</span>
              <h1>{project.name}</h1>
              <p>{project.description}</p>
              {project.repoUrl && <a className="text-link repo-link" href={project.repoUrl} target="_blank" rel="noreferrer">View GitHub repository ↗</a>}
            </div>
            <span className="status-badge">{project.status || 'Published'}</span>
          </section>
          <section className="detail-grid">
            <div className="detail-panel">
              <span className="mini-label">Repository metadata</span>
              <dl className="detail-list">
                <div><dt>Maintainer</dt><dd>{project.maintainer}</dd></div>
                <div><dt>Default branch</dt><dd>{project.version}</dd></div>
                {project.contributors > 0 && <div><dt>Contributors</dt><dd>{project.contributors}</dd></div>}
                <div><dt>Updated</dt><dd>{new Date(project.updated).toLocaleDateString()}</dd></div>
              </dl>
            </div>
            <div className="detail-panel detail-placeholder">
              <span className="mini-label">Project documentation</span>
              <p>Documentation, roadmap, history, and contribution links are available from the connected repository.</p>
            </div>
          </section>
        </>
      ) : (
        <section className="detail-empty empty-state-card">
          <span className="section-kicker">PROJECT DETAILS</span>
          <h1>No project selected</h1>
          <p>Project details will appear here when a connected repository is selected.</p>
        </section>
      )}
    </main>
  )
}

function Header({ user, authError, onSignIn, onConnectGithub, onSignOut, onContribute, onProfile }) {
  const isStaff = ['manager', 'admin', 'superadmin'].includes(user?.role)
  const [dismissedAuthError, setDismissedAuthError] = useState('')

  useEffect(() => {
    if (!authError) return undefined
    const timeout = window.setTimeout(() => setDismissedAuthError(authError), 5000)
    return () => window.clearTimeout(timeout)
  }, [authError])

  return (
    <header className="topbar">
      {authError && dismissedAuthError !== authError && <div className="auth-error" role="alert">{authError}</div>}
      <a className="brand-wrap" aria-label="Anonymous Hyena home" href="/">
        <div className="brand-mark" aria-hidden="true"><span className="mark-core" /></div>
        <div className="brand-copy"><span className="brand-name">ANONYMOUS HYENA</span><span className="brand-tag">Student Cybersecurity Suite</span></div>
      </a>
      <nav className="main-nav" aria-label="Main navigation">
        {navItems.filter((item) => !['Home', 'Documentation', 'Contribute'].includes(item)).map((item) => {
          const sectionId = item === 'Projects' ? 'project-discovery' : 'home'
          return <a key={item} href={`#${sectionId}`} onClick={(event) => scrollToSection(event, sectionId)} className="nav-link">{item}</a>
        })}
      </nav>
      <div className="nav-actions">
        {user ? (
          <>
            <button type="button" className="ghost-button" onClick={onConnectGithub}>{user.github ? 'GitHub connected' : 'Connect GitHub'}</button>
            <NotificationCenter key={user.id} userId={user.id} />
            <details className="account-menu">
              <summary className="ghost-button">Account</summary>
              <div className="account-menu-popover">
                <span className="account-menu-identity">{user.name || user.email}</span>
                <button type="button" onClick={(event) => { event.currentTarget.closest('details').open = false; onProfile() }}>Edit profile</button>
                {isStaff && <a href="/admin">Staff workspace</a>}
                <button type="button" onClick={onSignOut} aria-label={`Sign out ${user.name || user.email}`}>Sign out</button>
              </div>
            </details>
          </>
        ) : <button type="button" className="ghost-button" onClick={onSignIn}>Sign in with Google</button>}
        <button type="button" className="primary-button" onClick={onContribute}>Contribute</button>
      </div>
    </header>
  )
}

function App() {
  const isAdminRoute = window.location.pathname === '/admin'
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('recent')
  const [projectPage, setProjectPage] = useState(1)
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [approvedProjects, setApprovedProjects] = useState([])
  const [user, setUser] = useState(null)
  const [userLoading, setUserLoading] = useState(true)
  const [contributionOpen, setContributionOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  const searchParams = new URLSearchParams(window.location.search)
  const authProvider = searchParams.get('provider') === 'google' ? 'Google' : 'GitHub'
  const authReasons = {
    signin_required: 'sign in before connecting GitHub',
    already_linked: 'this GitHub account is already linked elsewhere',
    invalid_state: 'security check failed; please try again',
    token_exchange: 'could not complete the provider authorization',
    user_lookup: 'could not retrieve your provider profile',
  }
  const authError = searchParams.get('reason')
    ? `${authProvider}: ${authReasons[searchParams.get('reason')] || 'authentication failed'}.`
    : searchParams.get('auth') === 'cancelled' ? `${authProvider} authorization was cancelled.` : null

  const refreshUser = () => fetch('/auth/session', { credentials: 'include' })
    .then((response) => response.ok ? response.json() : null)
    .then((session) => setUser(session?.user ?? null))
    .catch(() => setUser(null))
    .finally(() => setUserLoading(false))

  useEffect(() => {
    if (window.location.hash || window.location.search) window.history.replaceState(null, '', window.location.pathname)
    refreshUser()
    requestJson('/api/projects').then((result) => setApprovedProjects(Array.isArray(result.projects) ? result.projects : [])).catch(() => setApprovedProjects([]))
  }, [])

  const signIn = () => window.location.assign('/auth/google')
  const connectGithub = () => window.location.assign('/auth/github/connect')
  const signOut = async () => {
    await requestJson('/auth/logout', { method: 'POST' })
    setUser(null)
  }

  const projects = useMemo(() => [...projectCatalog, ...approvedProjects], [approvedProjects])
  const selectedProject = projects.find((project) => (project.id || project.name) === selectedProjectId)
  const openProject = (project) => {
    const projectId = project.id || project.name
    setSelectedProjectId(projectId)
  }
  const closeProject = () => {
    window.history.replaceState(null, '', window.location.pathname)
    setSelectedProjectId('')
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('project-discovery')?.scrollIntoView({ behavior: 'smooth' })))
  }
  const categories = ['All', ...new Set([...projectCategories, ...approvedProjects.map((project) => project.category)])]

  const allFilteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const results = projects.filter((project) => {
      const matchesCategory = selectedCategory === 'All' || project.category === selectedCategory
      const searchable = `${project.name} ${project.category} ${project.description} ${project.maintainer}`.toLowerCase()
      return matchesCategory && (!query || searchable.includes(query))
    })
    return [...results].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'contributors') return (b.contributors || 0) - (a.contributors || 0)
      return new Date(b.updated) - new Date(a.updated)
    })
  }, [projects, searchQuery, selectedCategory, sortBy])
  const projectPageSize = 4
  const projectPageCount = Math.ceil(allFilteredProjects.length / projectPageSize)
  const filteredProjects = allFilteredProjects.slice((projectPage - 1) * projectPageSize, projectPage * projectPageSize)

  if (isAdminRoute) {
    return <AdminPortal
      user={user}
      loading={userLoading}
      onSignIn={() => window.location.assign('/auth/google?next=%2Fadmin')}
      onSignOut={signOut}
      onUserUpdated={setUser}
    />
  }

  const highlights = approvedProjects.filter((project) => project.featured)

  return (
    <div className="page-shell">
      <BackgroundNetwork />
      <Header user={user} authError={authError} onSignIn={signIn} onConnectGithub={connectGithub} onSignOut={signOut} onContribute={() => setContributionOpen(true)} onProfile={() => setProfileOpen(true)} />
      {selectedProjectId && selectedProjectId !== 'project-discovery' ? (
        <ProjectDetails project={selectedProject} onBack={closeProject} />
      ) : (
        <main id="home">
          <section className="hero-section">
            <div className="hero-grid" aria-hidden="true" />
            <div className="hero-content">
              <div className="eyebrow-row"><span className="eyebrow-dot" /><span>Build · Contribute · Improve · Continue</span></div>
              <h1>Anonymous Hyena<span>Where student-built security projects live, evolve, and continue.</span></h1>
              <p>A cybersecurity ecosystem where research, tooling, and operational knowledge are preserved across student generations instead of disappearing at the end of a semester.</p>
              <div className="hero-actions"><a className="primary-button" href="#project-discovery" onClick={(event) => scrollToSection(event, 'project-discovery')}>Explore Projects</a><button type="button" className="secondary-button" onClick={() => setContributionOpen(true)}>Contribute</button></div>
            </div>
            <div className="hero-panel" aria-label="Hyena network overview">
              <div className="panel-header"><span className="status-pill live">LIVE</span><span className="panel-label">HYENA NETWORK</span></div>
              <div className="hyena-emblem" aria-label="Hyena emblem"><span className="emblem-ring" /><span className="emblem-ring ring-inner" /><img className="emblem-symbol" src={hyenaImage} alt="" /><span className="emblem-scan" /></div>
              <div className="panel-stats">{stats.length ? stats.map((stat) => <div key={stat.label} className="stat-box"><strong>{stat.value}</strong><span>{stat.label}</span></div>) : <div className="empty-state-box">{approvedProjects.length} community projects published</div>}</div>
            </div>
          </section>

          <section className="section-block showcase-block"><div className="section-header split"><div><span className="section-kicker">PROJECT SHOWCASE</span><h2>Cybersecurity tools built for the next student generation.</h2></div><a href="#project-discovery" onClick={(event) => scrollToSection(event, 'project-discovery')} className="text-link">Browse all projects</a></div>{highlights.length ? <div className="project-grid">{highlights.map((project) => <article key={project.id || project.name} className="project-card"><div className="card-top"><div className="project-icon"><span /></div><span className="status-badge">{project.status || 'Published'}</span></div><div className="project-meta"><h3>{project.name}</h3><p>{project.description}</p></div><div className="card-tags"><span>{project.category}</span><span>{project.version}</span></div><div className="card-details"><span>{project.maintainer}</span><span>{project.updated}</span></div><button type="button" className="card-button" onClick={() => openProject(project)}>View project →</button></article>)}</div> : <div className="empty-state-card">Community projects appear here after review and approval.</div>}</section>

          <section id="project-discovery" className="section-block discovery-panel"><div className="section-header split"><div><span className="section-kicker">EXPLORE PROJECTS</span><h2>Project discovery for student-driven research and operations.</h2></div><div className="result-pill">{allFilteredProjects.length} projects</div></div><div className="project-toolbar"><label className="search-field" htmlFor="project-search"><span className="sr-only">Search projects</span><input id="project-search" type="search" value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setProjectPage(1) }} placeholder="Search projects, categories, or teams" /></label><label className="sort-field" htmlFor="project-sort"><span>Sort</span><select id="project-sort" value={sortBy} onChange={(event) => { setSortBy(event.target.value); setProjectPage(1) }}>
        <option value="recent">Most recent</option>
        <option value="name">Alphabetical</option>
        <option value="contributors">Contributors</option>
      </select></label></div><div className="filter-list showcase-filters">{categories.map((category) => <button key={category} type="button" className={`filter-chip ${selectedCategory === category ? 'is-active' : ''}`} onClick={() => { setSelectedCategory(category); setProjectPage(1) }}>{category}</button>)}</div>{filteredProjects.length ? <div className="catalog-grid">{filteredProjects.map((project, index) => <article key={project.id || project.name} className={`catalog-card accent-${project.accent || (index % 2 ? 'cyan' : 'violet')}`}><div className="catalog-header"><div className="project-icon small"><span /></div><span className="status-badge">{project.status || 'Published'}</span></div><div className="catalog-main"><div className="catalog-row"><span className="mini-label">{project.category}</span><span className="version-pill">{project.version}</span></div><h3>{project.name}</h3><p>{project.description}</p></div><div className="catalog-meta"><span>{project.maintainer}</span><span>{project.contributors || 0} contributors</span></div><div className="catalog-footer"><span>{new Date(project.updated).toLocaleDateString()}</span><button type="button" className="card-button" onClick={() => openProject(project)}>View project</button></div></article>)}</div> : <div className="empty-state-card">No projects have been published yet. Share a public GitHub project for review.</div>}</section>
          {projectPageCount > 1 && <nav className="project-pagination" aria-label="Project pages"><button type="button" className="secondary-button" disabled={projectPage === 1} onClick={() => setProjectPage((page) => page - 1)}>Previous</button><span>Page {projectPage} of {projectPageCount}</span><button type="button" className="secondary-button" disabled={projectPage === projectPageCount} onClick={() => setProjectPage((page) => page + 1)}>Next</button></nav>}
        </main>
      )}
      <footer className="site-footer"><a href="/admin">Staff sign in</a><span>Anonymous Hyena</span></footer>
      {contributionOpen && <ContributionDialog user={user} onClose={() => setContributionOpen(false)} onSignIn={signIn} onConnectGithub={connectGithub} />}
      {profileOpen && user && <ProfileDialog user={user} onClose={() => setProfileOpen(false)} onSaved={setUser} />}
    </div>
  )
}

export default App
