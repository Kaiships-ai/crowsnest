// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { isVirtualEditorFile } from '@/store/slices/editor/tabs/editor-tab-content-type'
import { openBoardTab } from './open-board-tab'

describe('openBoardTab', () => {
  it('reuses one virtual tab when the same board opens twice', () => {
    openBoardTab('rivals', 'wt-1')
    openBoardTab('rivals', 'wt-1')

    const boards = useAppStore.getState().openFiles.filter((file) => file.mode === 'board')
    expect(boards).toHaveLength(1)
    expect(boards[0]).toMatchObject({ boardId: 'rivals', relativePath: 'Đối thủ' })
    expect(isVirtualEditorFile(boards[0]!)).toBe(true)
  })
})
