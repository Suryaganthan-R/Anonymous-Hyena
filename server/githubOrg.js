const githubApiVersion = '2026-03-10'

export class GithubOrgError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.name = 'GithubOrgError'
    this.status = status
  }
}

const configuration = () => {
  const organization = process.env.GITHUB_ORG?.trim()
  const token = process.env.GITHUB_ORG_TOKEN?.trim()
  if (!organization) throw new GithubOrgError('GitHub organization integration is not configured.', 503)
  if (!token) throw new GithubOrgError('GitHub organization integration is not configured.', 503)
  return { organization, token }
}

const repositoryNamePattern = /^(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/

const githubRequest = async (url, options, fetchImpl) => {
  try {
    return await fetchImpl(url, options)
  } catch {
    throw new GithubOrgError('GitHub could not be reached. Try again shortly.', 502)
  }
}

const parseGithubError = async (response) => {
  const payload = await response.json().catch(() => ({}))
  return typeof payload.message === 'string' ? payload.message : ''
}

const headersFor = (token) => ({
  accept: 'application/vnd.github+json',
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
  'user-agent': 'anonymous-hyena',
  'x-github-api-version': githubApiVersion,
})

export const createOrganizationRepository = async (project, fetchImpl = globalThis.fetch) => {
  const { organization, token } = configuration()
  if (!repositoryNamePattern.test(project.repoName)) {
    throw new GithubOrgError('The project repository name cannot be used for an organization repository.', 400)
  }

  const headers = headersFor(token)
  const createResponse = await githubRequest(`https://api.github.com/orgs/${encodeURIComponent(organization)}/repos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: project.repoName,
      description: project.description || project.repositoryDescription || '',
      homepage: project.repoUrl,
      private: false,
      auto_init: false,
    }),
  }, fetchImpl)

  if (!createResponse.ok) {
    const detail = await parseGithubError(createResponse)
    if (createResponse.status === 401) throw new GithubOrgError('GitHub organization authentication failed.', 502)
    if (createResponse.status === 403) throw new GithubOrgError('The GitHub organization token cannot create repositories.', 502)
    if (createResponse.status === 404) throw new GithubOrgError('The configured GitHub organization was not found.', 502)
    if (createResponse.status === 422) throw new GithubOrgError('An organization repository with this name already exists or the name is invalid.', 409)
    if (createResponse.status === 429) throw new GithubOrgError('GitHub rate limit reached. Try again later.', 503)
    throw new GithubOrgError(detail || 'GitHub could not create the organization repository.', 502)
  }

  const repository = await createResponse.json().catch(() => null)
  if (!repository?.id || !repository.name || !repository.html_url) {
    throw new GithubOrgError('GitHub returned an invalid repository response.', 502)
  }

  const readme = `# ${project.repoName}\n\n${project.description || project.repositoryDescription || 'Anonymous Hyena approved project.'}\n\nOriginal repository: ${project.repoUrl}\n`
  const readmeResponse = await githubRequest(`https://api.github.com/repos/${encodeURIComponent(organization)}/${encodeURIComponent(repository.name)}/contents/README.md`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: 'Initialize project README',
      content: Buffer.from(readme, 'utf8').toString('base64'),
      branch: repository.default_branch || 'main',
    }),
  }, fetchImpl)

  if (!readmeResponse.ok) {
    if (readmeResponse.status === 401 || readmeResponse.status === 403) {
      throw new GithubOrgError('The GitHub token cannot initialize the organization repository README.', 502)
    }
    if (readmeResponse.status === 429) throw new GithubOrgError('GitHub rate limit reached. Try again later.', 503)
    throw new GithubOrgError('The organization repository was created, but its README could not be initialized.', 502)
  }

  return { id: String(repository.id), name: repository.name, url: repository.html_url }
}
