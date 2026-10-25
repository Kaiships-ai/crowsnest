import { copyFileSync, existsSync, renameSync, rmSync, statSync } from 'node:fs'

const stamp = (path: string): string => {
  const stats = statSync(path)
  return `${stats.size}:${stats.mtimeMs}`
}

type Copy = (from: string, to: string) => void

function copyPair(source: string, temp: string, copy: Copy): boolean {
  rmSync(`${temp}-wal`, { force: true })
  const before = stamp(source)
  copy(source, temp)
  if (existsSync(`${source}-wal`)) {
    copy(`${source}-wal`, `${temp}-wal`)
  }
  return stamp(source) === before
}

// Copied as files, never opened: the operator's app may still be writing the source DB.
export function copyDbOnce(
  source: string,
  target: string,
  copy: Copy = (from, to) => copyFileSync(from, to)
): void {
  if (existsSync(target) || !existsSync(source)) {
    return
  }
  const temp = `${target}.copy`
  if (!copyPair(source, temp, copy) && !copyPair(source, temp, copy)) {
    rmSync(temp, { force: true })
    rmSync(`${temp}-wal`, { force: true })
    throw new Error(
      `${source} changed during both copy attempts; quit the app that writes it and relaunch to take a consistent copy`
    )
  }
  if (existsSync(`${temp}-wal`)) {
    renameSync(`${temp}-wal`, `${target}-wal`)
  }
  renameSync(temp, target)
}
