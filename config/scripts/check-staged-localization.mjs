import { execFileSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import {
  SOURCE_EXTENSIONS,
  collectLocalizationCandidates,
  findNewCandidates,
  isSkippedFile,
  printNewCandidates,
  readAllowlist
} from './audit-localization-coverage.mjs'

// Why: the pre-commit hook judges the index, not the working tree, so it sees exactly what is being
// committed and stays under 2 s. The full coverage check and the catalog checks run in CI.
export async function checkStagedLocalization(root = process.cwd()) {
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const stagedPaths = git(
    'diff',
    '--cached',
    '--name-only',
    '--diff-filter=ACMR',
    '-z',
    '--',
    'src/renderer/src'
  )
    .split('\0')
    .filter(Boolean)
  const reports = []

  for (const relativePath of stagedPaths) {
    const filePath = path.join(root, relativePath)
    if (SOURCE_EXTENSIONS.has(path.extname(relativePath)) && !isSkippedFile(root, filePath)) {
      reports.push(
        ...collectLocalizationCandidates(filePath, git('show', `:${relativePath}`), root)
      )
    }
  }

  const allowlist = await readAllowlist(root, 'config/localization-coverage-allowlist.json')
  const newCandidates = findNewCandidates(reports, allowlist)
  if (newCandidates.length > 0) {
    printNewCandidates(root, newCandidates)
    return 1
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await checkStagedLocalization())
}
