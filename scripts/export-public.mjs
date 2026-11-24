#!/usr/bin/env node
/**
 * The public tree: what the public repository carries, built from this one.
 *
 * The private (staging) repository keeps everything: the working rules, the
 * plan, the decisions, the handoff, the history. The public one carries the
 * extension: what Lumiverse clones and builds, the tests that need nothing
 * private, the licence and the README. A release is a run of this script into
 * the public clone, one commit, one push. Nothing private is ever in the
 * public history, because nothing private is ever written there.
 *
 *   node scripts/export-public.mjs <out-dir> [--url https://github.com/Owner/Repo] [--force]
 *
 * `--url` rewrites the two repository addresses in `spindle.json` (where
 * Lumiverse's Update button looks). `--force` empties a non-empty out-dir
 * first and keeps its `.git`, which is how every release after the first goes
 * into the public clone.
 *
 * What is left out is `scripts/public-exclude.txt`. After writing, the tree
 * is checked for leaks, and any of these fails the run:
 * - a path the exclude list names;
 * - a word from `scripts/private-terms.txt`, named with its file and line;
 * - a picture carrying its maker's metadata (PNG text or EXIF chunks, JPEG
 *   EXIF, XMP, IPTC or comment segments), which no text scan can read: run
 *   `node scripts/strip-image-metadata.mjs <picture>` and commit the result.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { imageMetadata } from './strip-image-metadata.mjs'

export const EXCLUDE_FILE = 'scripts/public-exclude.txt'
export const PRIVATE_TERMS_FILE = 'scripts/private-terms.txt'
export const PUBLIC_WORKFLOW_PATH = '.github/workflows/test.yml'

/** @param {string} text */
export function parseExcludes(text) {
    /** @type {{ raw: string, dir: boolean, path: string }[]} */
    const rules = []
    for (const line of text.split('\n')) {
        const raw = line.trim()
        if (!raw || raw.startsWith('#')) continue
        const dir = raw.endsWith('/')
        rules.push({ raw, dir, path: dir ? raw.slice(0, -1) : raw })
    }
    return rules
}

/**
 * @param {string} path repository-relative, forward slashes
 * @param {{ raw: string, dir: boolean, path: string }[]} rules
 */
export function isExcluded(path, rules) {
    for (const rule of rules) {
        if (rule.dir ? path === rule.path || path.startsWith(`${rule.path}/`) : path === rule.path) return rule
    }
    return null
}

/** @param {string} text */
export function parsePrivateTerms(text) {
    /** @type {{ term: string, allowed: string[] }[]} */
    const terms = []
    for (const line of text.split('\n')) {
        const raw = line.trim()
        if (!raw || raw.startsWith('#')) continue
        const at = raw.indexOf(' @ ')
        const term = at >= 0 ? raw.slice(0, at).trim() : raw
        const allowed = at >= 0 ? raw.slice(at + 3).split(',').map((path) => path.trim()).filter(Boolean) : []
        if (term) terms.push({ term, allowed })
    }
    return terms
}

const WORD = /[A-Za-z0-9]/

/**
 * Every line holding a private term, whole: a letter or digit on either side is not a hit. Case matters.
 * @param {string} path
 * @param {string} content
 * @param {{ term: string, allowed: string[] }[]} terms
 */
export function findPrivateTerms(path, content, terms) {
    /** @type {{ line: number, term: string }[]} */
    const hits = []
    const lines = content.split('\n')
    for (const { term, allowed } of terms) {
        if (allowed.includes(path)) continue
        for (const [i, line] of lines.entries()) {
            let from = 0
            for (;;) {
                const at = line.indexOf(term, from)
                if (at < 0) break
                from = at + 1
                const before = at > 0 ? line[at - 1] : ''
                const after = line[at + term.length] ?? ''
                if ((WORD.test(term[0]) && WORD.test(before)) || (WORD.test(term[term.length - 1]) && WORD.test(after))) continue
                hits.push({ line: i + 1, term })
                break
            }
        }
    }
    return hits
}

/** @param {Buffer} buffer */
function isText(buffer) {
    return !buffer.subarray(0, 8000).includes(0)
}

/** The public tree's CI: install, test, typecheck, build. */
export function publicWorkflow() {
    return [
        '# Runs on every push to main and every pull request: the types, the tests and both bundles.',
        'name: tests',
        'on:',
        '  push:',
        '    branches: [main]',
        '  pull_request:',
        '    branches: [main]',
        '  workflow_dispatch:',
        'jobs:',
        '  checks:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '      - uses: oven-sh/setup-bun@v2',
        '      - run: bun install --frozen-lockfile',
        '      - run: bun run typecheck',
        '      - run: bun test',
        '      - run: bun run build',
        '',
    ].join('\n')
}

/**
 * @param {string} text
 * @param {string | undefined} url
 */
export function publicSpindleJson(text, url) {
    if (!url) return text
    const manifest = JSON.parse(text)
    manifest.github = url
    manifest.homepage = url
    // Keep the manifest's own indentation, so an address that is already right changes nothing.
    const indent = /^\{\s*\n([ \t]+)"/.exec(text)?.[1] ?? '  '
    return `${JSON.stringify(manifest, null, indent)}\n`
}

/**
 * @param {string} dir
 * @param {string} [base]
 * @param {string[]} [out]
 */
function walk(dir, base = dir, out = []) {
    for (const name of readdirSync(dir)) {
        if (name === '.git' || name === 'node_modules') continue
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full, base, out)
        else out.push(relative(base, full).split('\\').join('/'))
    }
    return out
}

/** @param {{ root: string, out: string, url?: string, force?: boolean }} options */
export function exportPublic({ root, out, url, force = false }) {
    const rootDir = resolve(root)
    const outDir = resolve(out)
    if (outDir === rootDir || rootDir.startsWith(`${outDir}/`)) throw new Error('the out-dir must be outside this repository')
    const rules = parseExcludes(readFileSync(join(rootDir, EXCLUDE_FILE), 'utf8'))
    const termsPath = join(rootDir, PRIVATE_TERMS_FILE)
    const terms = existsSync(termsPath) ? parsePrivateTerms(readFileSync(termsPath, 'utf8')) : []
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: rootDir, encoding: 'utf8' }).split('\0').filter(Boolean)

    if (existsSync(outDir)) {
        const entries = readdirSync(outDir).filter((name) => name !== '.git')
        if (entries.length && !force) throw new Error(`${outDir} is not empty; pass --force to replace its files (its .git is kept)`)
        for (const name of entries) rmSync(join(outDir, name), { recursive: true, force: true })
    } else {
        mkdirSync(outDir, { recursive: true })
    }

    /** @type {string[]} */
    const written = []
    /** @type {[string, string][]} */
    const excluded = []
    for (const path of tracked) {
        const rule = isExcluded(path, rules)
        if (rule) {
            excluded.push([path, rule.raw])
            continue
        }
        const source = readFileSync(join(rootDir, path))
        const content = path === 'spindle.json' ? Buffer.from(publicSpindleJson(source.toString('utf8'), url)) : source
        const target = join(outDir, path)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, content)
        written.push(path)
    }
    const workflow = join(outDir, PUBLIC_WORKFLOW_PATH)
    mkdirSync(dirname(workflow), { recursive: true })
    writeFileSync(workflow, publicWorkflow())
    written.push(PUBLIC_WORKFLOW_PATH)

    /** @type {string[]} */
    const privateHits = []
    for (const path of walk(outDir)) {
        if (path === PUBLIC_WORKFLOW_PATH) continue
        const rule = isExcluded(path, rules)
        if (rule) throw new Error(`leak: ${path} is in the public tree, excluded by "${rule.raw}"`)
        const buffer = readFileSync(join(outDir, path))
        const picture = imageMetadata(buffer)
        if (picture?.found.length) {
            const names = picture.found.map(({ name, size }) => `${name} (${size} bytes)`).join(', ')
            throw new Error(`leak: ${path} carries ${names}, a picture's own metadata; run node scripts/strip-image-metadata.mjs ${path} and commit the result`)
        }
        if (!isText(buffer)) continue
        for (const hit of findPrivateTerms(path, buffer.toString('utf8'), terms)) privateHits.push(`${path}:${hit.line} holds "${hit.term}"`)
    }
    if (privateHits.length) {
        const shown = privateHits.slice(0, 40)
        const more = privateHits.length > shown.length ? `\n  … and ${privateHits.length - shown.length} more` : ''
        throw new Error(`leak: ${privateHits.length} private term${privateHits.length === 1 ? '' : 's'} in the public tree:\n  ${shown.join('\n  ')}${more}`)
    }
    return { written, excluded }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
    const args = process.argv.slice(2)
    const force = args.includes('--force')
    const urlAt = args.indexOf('--url')
    const url = urlAt >= 0 ? args[urlAt + 1] : undefined
    const out = args.find((arg, i) => !arg.startsWith('--') && (urlAt < 0 || i !== urlAt + 1))
    if (!out || (urlAt >= 0 && !url)) {
        console.error('usage: node scripts/export-public.mjs <out-dir> [--url https://github.com/Owner/Repo] [--force]')
        process.exit(2)
    }
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dirname(fileURLToPath(import.meta.url)), encoding: 'utf8' }).trim()
    try {
        const result = exportPublic({ root, out, url, force })
        const outDir = resolve(out)
        console.log(`Wrote ${result.written.length} files to ${outDir}.`)
        console.log(`Left out by ${EXCLUDE_FILE}: ${result.excluded.length} files.`)
        console.log(`Private terms found: 0. Pictures carrying metadata: 0.`)
        if (!url) console.log('No --url given, so spindle.json still names the private repository; pass --url before the first push.')
        console.log('')
        console.log('Next, in the public clone:')
        console.log(`  cd ${outDir}`)
        console.log('  git add -A')
        console.log('  git commit -m "<Name> <version>"')
        console.log('  git push')
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
    }
}
