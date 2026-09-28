import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { AppDatabase } from './database.js'
import { handleApiError, handleApiRequest } from './api.js'

const port = Number(process.env.AUTH_PORT || 8787)
const appUrl = process.env.APP_URL || 'http://localhost:5173'
const googleClientId = process.env.GOOGLE_CLIENT_ID
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET
const githubClientId = process.env.GITHUB_CLIENT_ID
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET
const googleRedirectUri = `${appUrl}/auth/google/callback`
const githubRedirectUri = `${appUrl}/auth/github/callback`
const sessions = new Map()
const oauthStates = new Map()
const database = new AppDatabase()

const send = (response, status, body, headers = {}) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers })
  response.end(JSON.stringify(body))
}

const redirect = (response, location, headers = {}) => {
  response.writeHead(302, { location, ...headers })
  response.end()
}

const parseCookies = (request) => Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map((part) => {
  const [key, ...value] = part.trim().split('=')
  return [key, decodeURIComponent(value.join('='))]
}))

const cookieOptions = `HttpOnly; SameSite=Lax; Path=/${appUrl.startsWith('https:') ? '; Secure' : ''}`
const authFailure = (provider, reason) => `/?auth=error&provider=${provider}&reason=${reason}`

const startOAuth = (response, { provider, clientId, authorizeUrl, redirectUri, scope, returnTo = '/' }) => {
  const clientSecret = provider === 'google' ? googleClientSecret : githubClientSecret
  if (!clientId || !clientSecret) return send(response, 500, { error: `${provider} OAuth is not configured on the server.` })
  const state = randomBytes(24).toString('hex')
  oauthStates.set(state, { provider, returnTo, createdAt: Date.now() })
  const authorization = new URL(authorizeUrl)
  authorization.searchParams.set('client_id', clientId)
  authorization.searchParams.set('redirect_uri', redirectUri)
  authorization.searchParams.set('response_type', 'code')
  authorization.searchParams.set('scope', scope)
  authorization.searchParams.set('state', state)
  return redirect(response, authorization.toString(), { 'set-cookie': `oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600` })
}

const consumeOAuthState = (state, storedState, provider) => {
  const pending = state && oauthStates.get(state)
  const matchesCookie = storedState && state && state.length === storedState.length && timingSafeEqual(Buffer.from(state), Buffer.from(storedState))
  if (state) oauthStates.delete(state)
  return pending?.provider === provider && Date.now() - pending.createdAt < 10 * 60 * 1000 && matchesCookie ? pending : null
}

const handleRequest = async (request, response) => {
  const url = new URL(request.url, appUrl)
  const cookies = parseCookies(request)

  if (request.method === 'GET' && url.pathname === '/auth/google') {
    return startOAuth(response, {
      provider: 'google',
      clientId: googleClientId,
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      redirectUri: googleRedirectUri,
      scope: 'openid email profile',
      returnTo: url.searchParams.get('next') === '/admin' ? '/admin' : '/',
    })
  }

  if (request.method === 'GET' && url.pathname === '/auth/google/callback') {
    const pending = consumeOAuthState(url.searchParams.get('state'), cookies.oauth_state, 'google')
    if (!pending) return redirect(response, authFailure('google', 'invalid_state'))
    if (url.searchParams.get('error')) return redirect(response, `${pending.returnTo}?auth=cancelled&provider=google`)

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: googleClientId, client_secret: googleClientSecret, code: url.searchParams.get('code'), redirect_uri: googleRedirectUri, grant_type: 'authorization_code' }),
    })
    const token = await tokenResponse.json()
    if (!token.access_token) return redirect(response, authFailure('google', 'token_exchange'))

    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${token.access_token}` } })
    const googleUser = await profileResponse.json()
    if (!profileResponse.ok || !googleUser.sub || !googleUser.email || googleUser.email_verified !== true) {
      return redirect(response, authFailure('google', 'user_lookup'))
    }

    const user = database.upsertGoogleUser(googleUser)
    const sessionId = randomBytes(32).toString('hex')
    sessions.set(sessionId, user.id)
    return redirect(response, `${pending.returnTo}?auth=success`, { 'set-cookie': `session=${sessionId}; ${cookieOptions}` })
  }

  if (request.method === 'GET' && url.pathname === '/auth/github/connect') {
    if (!cookies.session || !sessions.has(cookies.session)) return redirect(response, authFailure('github', 'signin_required'))
    return startOAuth(response, {
      provider: 'github',
      clientId: githubClientId,
      authorizeUrl: 'https://github.com/login/oauth/authorize',
      redirectUri: githubRedirectUri,
      scope: 'read:user user:email',
    })
  }

  if (request.method === 'GET' && url.pathname === '/auth/github/callback') {
    const pending = consumeOAuthState(url.searchParams.get('state'), cookies.oauth_state, 'github')
    if (!pending) return redirect(response, authFailure('github', 'invalid_state'))
    if (url.searchParams.get('error')) return redirect(response, '/?auth=cancelled&provider=github')
    const googleId = cookies.session && sessions.get(cookies.session)
    if (!googleId) return redirect(response, authFailure('github', 'signin_required'))

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: githubClientId, client_secret: githubClientSecret, code: url.searchParams.get('code'), redirect_uri: githubRedirectUri }),
    })
    const token = await tokenResponse.json()
    if (!token.access_token) return redirect(response, authFailure('github', 'token_exchange'))

    const githubResponse = await fetch('https://api.github.com/user', { headers: { authorization: `Bearer ${token.access_token}`, 'user-agent': 'anonymous-hyena' } })
    const githubUser = await githubResponse.json()
    if (!githubResponse.ok || !githubUser.id || !githubUser.login) return redirect(response, authFailure('github', 'user_lookup'))
    try {
      database.linkGithub(googleId, githubUser)
    } catch (cause) {
      if (String(cause.message).includes('UNIQUE')) return redirect(response, authFailure('github', 'already_linked'))
      throw cause
    }
    return redirect(response, '/?auth=github_connected')
  }

  if (request.method === 'GET' && url.pathname === '/auth/health') return send(response, 200, { ok: true })
  if (await handleApiRequest(request, response, cookies, sessions, database)) return
  send(response, 404, { error: 'Not found' })
}

const server = createServer((request, response) => {
  handleRequest(request, response).catch((cause) => handleApiError(response, cause))
})

server.listen(port, () => console.log(`Auth server listening on http://localhost:${port}; OAuth callback origin is ${appUrl}`))