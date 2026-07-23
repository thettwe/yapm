#!/usr/bin/env node
import { readFile } from 'node:fs/promises'

const TYPES = [
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'perf',
  'refactor',
  'revert',
  'style',
  'test',
]
const HEADER = new RegExp(`^(${TYPES.join('|')})(\\([^()\\r\\n]+\\))?!?: .+`)
const SIGN_OFF = /^Signed-off-by: .+ <[^<>@\s]+@[^<>\s]+>$/m
const EXEMPT = /^(Merge |Revert "|fixup! |squash! )/

const source = process.argv[2]
if (!source) {
  console.error('usage: check-commit-msg.mjs <commit-msg-file>')
  process.exit(2)
}

const raw = await readFile(source, 'utf8')
const message = raw
  .split('\n')
  .filter((line) => !line.startsWith('#'))
  .join('\n')
  .trim()

const header = message.split('\n')[0] ?? ''
const errors = []

if (!EXEMPT.test(header)) {
  if (!HEADER.test(header)) {
    errors.push(
      `Header is not a Conventional Commit: "${header}"\n` +
        `    expected <type>[optional scope][!]: <description>\n` +
        `    types: ${TYPES.join(', ')}`,
    )
  }
  if (header.length > 100) {
    errors.push(`Header is ${header.length} characters; keep it under 100.`)
  }
}

if (!SIGN_OFF.test(message)) {
  errors.push(
    'Missing DCO sign-off. Commit with `git commit -s` to add "Signed-off-by: Name <email>".',
  )
}

if (errors.length > 0) {
  console.error('Commit message rejected:\n')
  for (const error of errors) console.error(`  - ${error}`)
  console.error('\nSee CONTRIBUTING.md.')
  process.exit(1)
}
