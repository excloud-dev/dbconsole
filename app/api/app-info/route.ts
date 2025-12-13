import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { NextResponse } from 'next/server'

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

  return NextResponse.json({
    version: pkg?.version ?? '0.0.0',
    buildSha,
    buildTime: build?.time,
    platform: 'web',
  })
}
