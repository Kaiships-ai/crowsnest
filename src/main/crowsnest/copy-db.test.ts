import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { copyDbOnce } from './copy-db'

describe('copyDbOnce', () => {
  let source: string
  let target: string
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'copy-db-'))
    source = join(dir, 'crowsnest.db')
    target = join(dir, 'copy.db')
    writeFileSync(source, 'main')
    writeFileSync(`${source}-wal`, 'wal')
  })

  it('copies the main file and its WAL', () => {
    copyDbOnce(source, target)
    expect(readFileSync(target, 'utf8')).toBe('main')
    expect(readFileSync(`${target}-wal`, 'utf8')).toBe('wal')
  })

  it('leaves an existing copy alone', () => {
    writeFileSync(target, 'old')
    copyDbOnce(source, target)
    expect(readFileSync(target, 'utf8')).toBe('old')
  })

  it('retries once when the source changes during the copy', () => {
    let calls = 0
    copyDbOnce(source, target, (from, to) => {
      copyFileSync(from, to)
      if (++calls === 1) {
        appendFileSync(source, '+write')
      }
    })
    expect(readFileSync(target, 'utf8')).toBe('main+write')
  })

  it('fails and leaves no copy when the source changes during both attempts', () => {
    const copyWhileWriting = (from: string, to: string): void => {
      copyFileSync(from, to)
      if (from === source) {
        appendFileSync(source, '+write')
      }
    }
    expect(() => copyDbOnce(source, target, copyWhileWriting)).toThrow(
      'changed during both copy attempts'
    )
    expect(existsSync(target)).toBe(false)
    expect(existsSync(`${target}.copy`)).toBe(false)
  })
})
