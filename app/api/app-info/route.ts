import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { NextResponse } from 'next/server'
import { GitHubClientImpl } from '../../../lib/updater/github-client'
import { isNewerVersion } from '../../../lib/updater/version-utils'

export const runtime = 'nodejs'

function readJsonFile<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function GET() {
  const root = process.cwd()
  const pkg = readJsonFile<{ version?: string }>(path.join(root, 'package.json'))
  const build = readJsonFile<{ sha?: string; shaShort?: string; time?: string }>(
    path.join(root, 'dist', 'electron', 'build-info.json'),
  )

  let buildSha = build?.shaShort ?? build?.sha
  if (!buildSha) {
    buildSha = (process.env.DBCONSOLE_BUILD_SHA_SHORT ?? '').trim() || (process.env.VERCEL_GIT_COMMIT_SHA ?? '').trim()
    if (!buildSha) {
      try {
        const out = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
        buildSha = String(out).trim() || undefined
      } catch {
        // ignore
      }
    }
  }

  const currentVersion = pkg?.version ?? '0.0.0'

  // Check for GitHub updates if token is available
  let updateInfo = null
  const githubToken = process.env.GITHUB_TOKEN
  const repoOwner = process.env.GITHUB_REPO_OWNER || 'excloud-in'
  const repoName = process.env.GITHUB_REPO_NAME || 'dbconsole'

  if (githubToken) {
    try {
      const githubClient = new GitHubClientImpl()
      githubClient.authenticate(githubToken)

      const latestRelease = await githubClient.getLatestRelease(repoOwner, repoName)

      // Clean version tags (remove 'v' prefix if present)
      const latestVersion = latestRelease.tagName.replace(/^v/, '')

      if (isNewerVersion(latestVersion, currentVersion)) {
        updateInfo = {
          available: true,
          latestVersion,
          releaseNotes: latestRelease.body,
          publishedAt: latestRelease.publishedAt,
          downloadUrl: `https://github.com/${repoOwner}/${repoName}/releases/tag/${latestRelease.tagName}`
        }
      } else {
        updateInfo = {
          available: false,
          latestVersion,
          message: 'You are running the latest version'
        }
      }
    } catch (error) {
      console.warn('Failed to check for GitHub updates:', error)
      updateInfo = {
        available: false,
        error: 'Failed to check for updates',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  return NextResponse.json({
    version: currentVersion,
    buildSha,
    buildTime: build?.time,
    platform: 'web',
    updateInfo
  })
}
