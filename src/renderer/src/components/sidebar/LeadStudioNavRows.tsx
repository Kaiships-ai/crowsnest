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
import { openLeadSourcesSettings } from '@/lib/open-lead-sources-settings'
import type { BoardId } from '../../../../shared/lead-studio-boards'

type NavItem = {
  id: string
  label: () => string
  icon: LucideIcon
  open?: () => void
  board?: BoardId
}

const board = (id: BoardId): Pick<NavItem, 'board' | 'open'> => ({
  board: id,
  open: () => openBoardInActiveWorkspace(id)
})

const TODAY: NavItem = {
  id: 'today',
  label: () => translate('leadStudio.nav.today', 'Today'),
  icon: Sun,
  ...board('today')
}

const GROUPS: { id: string; label: () => string; items: NavItem[] }[] = [
  {
    id: 'insight',
    label: () => translate('leadStudio.nav.group.insight', 'Insight'),
    items: [
      {
        id: 'funnel',
        label: () => translate('leadStudio.nav.funnel', 'Funnel'),
        icon: Filter,
        ...board('funnel')
      },
      {
        id: 'own',
        label: () => translate('leadStudio.nav.own', 'My channel'),
        icon: BarChart3,
        ...board('own')
      },
      {
        id: 'rivals',
        label: () => translate('leadStudio.nav.rivals', 'Rivals'),
        icon: Users,
        ...board('rivals')
      }
    ]
  },
  {
    id: 'create',
    label: () => translate('leadStudio.nav.group.create', 'Create'),
    items: [
      {
        id: 'plan',
        label: () => translate('leadStudio.nav.plan', 'Plan'),
        icon: CalendarDays,
        ...board('plan')
      },
      // Studio has no board yet; the row holds its place in the nav.
      {
        id: 'studio',
        label: () => translate('leadStudio.nav.studio', 'Studio'),
        icon: Clapperboard
      }
    ]
  },
  {
    id: 'system',
    label: () => translate('leadStudio.nav.group.system', 'System'),
    items: [
      {
        id: 'sources',
        label: () => translate('leadStudio.nav.sources', 'Sources'),
        icon: KeyRound,
        open: openLeadSourcesSettings
      },
      {
        id: 'agents',
        label: () => translate('leadStudio.nav.agents', 'Agents'),
        icon: Bot,
        ...board('agents')
      }
    ]
  }
]

function useActiveBoardId(): BoardId | null {
  return useAppStore((s) => {
    if (s.activeView !== 'terminal') {
      return null
    }
    const file = s.openFiles.find((f) => f.id === s.activeFileId)
    return file?.mode === 'board' ? (file.boardId ?? null) : null
  })
}

function NavRow({ item, active }: { item: NavItem; active: boolean }): React.ReactNode {
  const Icon = item.icon
  return (
    <button
      type="button"
      data-testid="ls-nav-row"
      data-nav-id={item.id}
      aria-current={active ? 'page' : undefined}
      disabled={!item.open}
      onClick={item.open}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors disabled:cursor-default',
        active
          ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
          : 'text-worktree-sidebar-foreground/60 enabled:hover:bg-worktree-sidebar-foreground/8'
      )}
    >
      <Icon
        className={cn('size-4 shrink-0', !active && 'text-worktree-sidebar-foreground/30')}
        strokeWidth={active ? 2.25 : 1.75}
      />
      <span className="flex-1 truncate">{item.label()}</span>
      {item.open ? null : (
        <span className="text-2xs text-worktree-sidebar-foreground/40">
          {translate('leadStudio.nav.soon', 'Soon')}
        </span>
      )}
    </button>
  )
}

/** Lead Studio's boards, in Orca's sidebar row style, under the Search row. */
export function LeadStudioNavRows(): React.ReactNode {
  const activeBoardId = useActiveBoardId()
  return (
    <nav data-testid="ls-nav" className="flex flex-col gap-0.5">
      <NavRow item={TODAY} active={activeBoardId === TODAY.board} />
      {GROUPS.map((group) => (
        <React.Fragment key={group.id}>
          <span className="select-none px-2 pt-2.5 pb-0.5 text-2xs font-semibold uppercase tracking-wider text-worktree-sidebar-foreground/40">
            {group.label()}
          </span>
          {group.items.map((item) => (
            <NavRow
              key={item.id}
              item={item}
              active={item.board !== undefined && activeBoardId === item.board}
            />
          ))}
        </React.Fragment>
      ))}
    </nav>
  )
}
