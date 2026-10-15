#!/usr/bin/env node
/**
 * Security gate — secret-pattern scan over every git-tracked file (#21).
 *
 * Fails (exit 1) when a tracked file contains something that looks like a
 * live credential. Patterns cover the token shapes this project actually
 * touches (GitHub, AWS, OpenAI/Anthropic, Google, Slack, TLS keys) plus a
 * generic `secret = "…"` assignment sweep. Placeholders and docs references
 * are allowlisted so documentation about token FORMATS passes.
 *
 * Usage: node scripts/security-check.mjs   (CI + pre-commit friendly)
 */

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const PATTERNS = [
  { name: 'GitHub fine-grained PAT', re: /github_pat_[A-Za-z0-9_]{22,255}/ },
  { name: 'GitHub classic token', re: /\bgh[posur]_[A-Za-z0-9]{30,255}\b/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'OpenAI-style key', re: /\bsk-[A-Za-z0-9_-]{35,}\b/ },
  { name: 'Anthropic-style key', re: /\bsk-ant-[A-Za-z0-9_-]{30,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    name: 'Hardcoded secret assignment',
    re:
      /\b(password|passwd|secret|api[_-]?key|access[_-]?token)\b\s*[:=]\s*["'][^"'\s]{10,}["']/i,
  },
]

/** Lines that mention credential FORMATS, docs, or test fixtures — allowed. */
const LINE_ALLOWLIST = [
  /process\.env/i,
  /import\.meta\.env/i,
  /env\.APP_PIN/i,
  /KEYSTORE_PASSWORD/i,
  /\bexample\b|\bsample\b|\bplaceholder\b/i,
  /\bgithub_pat_?X{3,}|ghp_?X{3,}/i,
  /<your[^>]*>/i,
  /\b\d{4}-\d{2}-\d{2}/, // dates inside assignment-looking lines
  /KEYSTORE_BASE64|KEYSTORE_ALIAS/,
  /secrets\./, // GitHub Actions expressions
]

const FILE_ALLOWLIST = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)bun\.lock$/,
  /\.svg$/i,
  /(^|\/)SECURITY\.md$/i,
]

function trackedFiles() {
  const out = execSync('git ls-files -z', {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return out.split('\0').filter(Boolean)
}

function isBinary(buf) {
  const n = Math.min(buf.length, 4096)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

const findings = []
const files = trackedFiles()

for (const file of files) {
  if (FILE_ALLOWLIST.some((re) => re.test(file))) continue
  let buf
  try {
    buf = readFileSync(file)
  } catch {
    continue // deleted between listing and read
  }
  if (isBinary(buf)) continue
  const text = buf.toString('utf8')
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    for (const { name, re } of PATTERNS) {
      if (!re.test(line)) continue
      if (LINE_ALLOWLIST.some((allow) => allow.test(line))) continue
      findings.push(
        `${file}:${i + 1}: ${name}\n    ${line.trim().slice(0, 120)}`
      )
    }
  })
}

if (findings.length > 0) {
  console.error(
    `security-check: ${findings.length} potential secret(s) found:\n\n` +
      findings.join('\n\n') +
      '\n\nRemove the secret(s), rotate the credential, and commit again.'
  )
  process.exit(1)
}

console.log(
  `security-check: clean — ${files.length} tracked files scanned, no secrets found.`
)
