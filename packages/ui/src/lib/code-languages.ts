import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import plaintext from 'highlight.js/lib/languages/plaintext'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { createLowlight } from 'lowlight'

// The curated grammar set, and the single source of truth for three things that must agree: what
// `lowlight` can highlight, what the language selector offers, and what an inbound fence language
// coerces to. A selector offering a grammar the bundle does not carry is a lie the user only
// discovers by getting no colours.
//
// NOT `lowlight.common` — that is ~37 grammars and would dominate the client bundle. Fifteen plus
// plain text is a judgement about what a small dev team pastes; it is one array in one file, and the
// measured bundle delta is recorded in the implementation log. `highlight.js` is BSD-3-Clause.
//
const GRAMMARS = {
  bash,
  css,
  diff,
  dockerfile,
  go,
  javascript,
  json,
  markdown,
  plaintext,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
} as const

const instance = createLowlight(GRAMMARS)

/** The fallback, so it is not offered twice in the selector. */
export const PLAIN_TEXT_LANGUAGE = 'plaintext'

export interface CodeLanguage {
  readonly value: string
  readonly label: string
}

export const CODE_LANGUAGES: readonly CodeLanguage[] = [
  { value: PLAIN_TEXT_LANGUAGE, label: 'Plain text' },
  { value: 'bash', label: 'Bash' },
  { value: 'css', label: 'CSS' },
  { value: 'diff', label: 'Diff' },
  { value: 'dockerfile', label: 'Dockerfile' },
  { value: 'go', label: 'Go' },
  { value: 'html', label: 'HTML' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'python', label: 'Python' },
  { value: 'rust', label: 'Rust' },
  { value: 'sql', label: 'SQL' },
  { value: 'tsx', label: 'TSX' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'yaml', label: 'YAML' },
]

// Alias → the entry the selector shows for it. `highlight.js` resolves every one of these to a
// grammar above on its own (verified by running each: only `shell` does not resolve, so it is not
// here), and they are ACCEPTED rather than rewritten — somebody who wrote ```ts gets ```ts back.
// The selector still shows sixteen entries, because "TypeScript" and "TS" as two rows is a choice
// nobody wants to make.
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  docker: 'dockerfile',
  golang: 'go',
  js: 'javascript',
  jsx: 'javascript',
  md: 'markdown',
  patch: 'diff',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  text: PLAIN_TEXT_LANGUAGE,
  ts: 'typescript',
  txt: PLAIN_TEXT_LANGUAGE,
  xml: 'html',
  yml: 'yaml',
  zsh: 'bash',
}

const CANONICAL = new Set(CODE_LANGUAGES.map((language) => language.value))
const ACCEPTED = new Set([...CANONICAL, ...Object.keys(LANGUAGE_ALIASES)])

export function isRegisteredLanguage(value: unknown): value is string {
  return typeof value === 'string' && ACCEPTED.has(value)
}

/**
 * What an inbound fence language becomes. A block whose language this bundle does not carry renders
 * unhighlighted rather than failing, and the selector then reads "Plain text" rather than naming a
 * grammar that is not there. A language it DOES carry survives verbatim, alias included, so a
 * markdown round trip returns the fence the author wrote.
 */
export function coerceCodeLanguage(value: unknown): string {
  return isRegisteredLanguage(value) ? value : PLAIN_TEXT_LANGUAGE
}

/** The selector entry a language maps to. */
export function canonicalCodeLanguage(value: unknown): string {
  const accepted = coerceCodeLanguage(value)
  return LANGUAGE_ALIASES[accepted] ?? accepted
}

/**
 * What the code-block extension is handed, in place of the raw `lowlight` instance.
 *
 * Two gates in `@tiptap/extension-code-block-lowlight@3.28.0`'s plugin decide whether a block is
 * highlighted at all: `lowlight.listLanguages().includes(language)`, which returns REGISTERED NAMES
 * and not aliases, and `highlight.getLanguage(language)` against the GLOBAL `highlight.js/lib/core`
 * singleton — which `createLowlight()`'s private instance never populates (verified). A `ts` block
 * would fail both and fall through to `highlightAuto`: a detection pass per keystroke, guessing.
 *
 * So the adapter answers for the accepted set and refuses to throw. `lowlight.highlight` throws
 * `Unknown language` on anything it does not know, and a document is user-controlled input.
 */
export const lowlight = {
  listLanguages: () => [...ACCEPTED],
  registered: (name: string) => ACCEPTED.has(name),
  highlight: (language: string, value: string, options?: unknown) =>
    instance.highlight(
      isRegisteredLanguage(language) ? language : PLAIN_TEXT_LANGUAGE,
      value,
      options as never,
    ),
  highlightAuto: (value: string, options?: unknown) =>
    instance.highlightAuto(value, options as never),
}
