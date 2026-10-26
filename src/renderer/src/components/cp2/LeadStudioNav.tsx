import React from 'react'
import {
  BarChart3,
  Bot,
  CalendarDays,
  Clapperboard,
  Filter,
  KeyRound,
  Sun,
  Users,
  type LucideIcon
} from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { openBoardInActiveWorkspace } from '@/lib/open-board-tab'
import type { BoardId } from '../../../../shared/lead-studio-boards'

// CP2 prototype: Lead Studio nav rows in Orca's sidebar row style.
type Item = { id: string; label: string; icon: LucideIcon; board?: BoardId }
const HOME: Item = { id: 'today', label: 'Today', icon: Sun, board: 'today' }
const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: 'Insight',
    items: [
      { id: 'funnel', label: 'Funnel', icon: Filter, board: 'funnel' },
      { id: 'own', label: 'My channel', icon: BarChart3, board: 'own' },
      { id: 'rivals', label: 'Rivals', icon: Users, board: 'rivals' }
    ]
  },
  {
    label: 'Create',
    items: [
      { id: 'plan', label: 'Plan', icon: CalendarDays, board: 'plan' },
      { id: 'studio', label: 'Studio', icon: Clapperboard }
    ]
  },
  {
    label: 'System',
    items: [
      { id: 'vault', label: 'Sources', icon: KeyRound },
      { id: 'agents', label: 'Agents', icon: Bot, board: 'agents' }
    ]
  }
]

function useActiveId(): string | null {
  return useAppStore((s) => {
    if (s.activeView === 'settings') {
      return 'vault'
    }
    const file = s.openFiles.find((f) => f.id === s.activeFileId)
    return file?.mode === 'board' ? (file.boardId ?? null) : null
  })
}

function open(item: Item): void {
  if (item.id === 'vault') {
    const s = useAppStore.getState()
    s.openSettingsTarget({ pane: 'lead-sources', repoId: null })
    s.openSettingsPage()
    return
  }
  if (item.board) {
    openBoardInActiveWorkspace(item.board)
  }
}

function NavRow({ item, active }: { item: Item; active: boolean }): React.ReactNode {
  const Icon = item.icon
  return (
    <button
      type="button"
      data-testid="ls-nav-row"
      data-nav-id={item.id}
      aria-current={active ? 'page' : undefined}
      onClick={() => open(item)}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
        active
          ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
          : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
      )}
    >
      <Icon
        className={cn('size-4 shrink-0', !active && 'text-worktree-sidebar-foreground/30')}
        strokeWidth={active ? 2.25 : 1.75}
      />
      <span className="flex-1 truncate">{translate(`leadStudio.nav.${item.id}`, item.label)}</span>
    </button>
  )
}

export function LeadStudioNavRows({ dense = false }: { dense?: boolean }): React.ReactNode {
  const activeId = useActiveId()
  return (
    <div data-testid="ls-nav" className="flex flex-col gap-0.5">
      <NavRow item={HOME} active={activeId === HOME.id} />
      {GROUPS.map((group) => (
        <React.Fragment key={group.label}>
          <span
            className={cn(
              'select-none px-2 pb-0.5 text-2xs font-semibold uppercase tracking-wider text-worktree-sidebar-foreground/40',
              dense ? 'pt-1.5' : 'pt-2.5'
            )}
          >
            {translate(`leadStudio.nav.group.${group.label.toLowerCase()}`, group.label)}
          </span>
          {group.items.map((item) => (
            <NavRow key={item.id} item={item} active={activeId === item.id} />
          ))}
        </React.Fragment>
      ))}
    </div>
  )
}

/** Variant A: its own titled block, above Orca's untouched workspace list. */
export function LeadStudioNavBlock(): React.ReactNode {
  return (
    <div className="flex flex-col gap-0.5 border-b border-worktree-sidebar-border px-2 pb-2">
      <span className="select-none px-2 pt-1 pb-1 text-xs font-semibold text-muted-foreground/80">
        Lead Studio
      </span>
      <LeadStudioNavRows dense />
    </div>
  )
}

/** Variant C: one segmented switch, Boards or Workspaces, each gets the full height. */
export function SidebarModeSwitch({
  mode,
  onMode
}: {
  mode: 'boards' | 'workspaces'
  onMode: (mode: 'boards' | 'workspaces') => void
}): React.ReactNode {
  return (
    <div className="mx-2 mt-1 grid grid-cols-2 gap-0.5 rounded-md bg-worktree-sidebar-foreground/5 p-0.5">
      {(
        [
          ['boards', 'Boards'],
          ['workspaces', 'Workspaces']
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          data-testid={`ls-mode-${id}`}
          aria-pressed={mode === id}
          onClick={() => onMode(id)}
          className={cn(
            'rounded px-2 py-1 text-xs font-medium transition-colors',
            mode === id
              ? 'bg-worktree-sidebar text-worktree-sidebar-foreground shadow-xs'
              : 'text-worktree-sidebar-foreground/55 hover:text-worktree-sidebar-foreground'
          )}
        >
          {translate(`leadStudio.sidebarMode.${id}`, label)}
        </button>
      ))}
    </div>
  )
}
