import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { selectFolderWorkspaces } from '@/store/workspace-record-selectors'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { activateAndRevealFolderWorkspace } from '@/lib/worktree-activation'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import type { TabGroupLayoutNode } from '../../../../shared/tab-types'
import type { PlanCard } from './plan-card-parts'

const STUDIO_GROUP = 'Studio Reel'

type CookOutcome = { ok: true } | { ok: false; error: string }

export const COOK_TAB_PREFIX = 'board::cook::'

/** Opens the reel workspace. With `planId` it also puts the Cook pane back left of Claude when the
 *  workspace has none: board tabs are not restored when the app restarts, Claude's terminal is. */
export function openCookWorkspace(workspaceId: string, planId?: string): boolean {
  const opened =
    activateAndRevealFolderWorkspace(workspaceId, { navigationIntent: 'user-open' }) !== false
  if (opened && planId) {
    ensureCookPane(folderWorkspaceKey(workspaceId), planId)
  }
  return opened
}

function openCookTab(worktreeId: string, planId: string, groupId: string): void {
  useAppStore.getState().openFile(
    {
      filePath: `${COOK_TAB_PREFIX}${planId}`,
      relativePath: 'Cook',
      worktreeId,
      language: 'plaintext',
      mode: 'board'
    },
    { targetGroupId: groupId, preview: false }
  )
}

function leftmostGroup(node: TabGroupLayoutNode | undefined): string | undefined {
  return node?.type === 'leaf' ? node.groupId : node ? leftmostGroup(node.first) : undefined
}

function ensureCookPane(worktreeId: string, planId: string): void {
  const store = useAppStore.getState()
  const filePath = `${COOK_TAB_PREFIX}${planId}`
  if ((store.unifiedTabsByWorktree[worktreeId] ?? []).some((tab) => tab.entityId === filePath)) {
    return
  }
  // The leftmost group on screen: reuse it when a restart left it empty, else split left of it.
  const first =
    leftmostGroup(store.layoutByWorktree[worktreeId]) ?? store.groupsByWorktree[worktreeId]?.[0]?.id
  const empty =
    store.groupsByWorktree[worktreeId]?.find((g) => g.id === first)?.tabOrder.length === 0
  const left = !first
    ? store.ensureWorktreeRootGroup(worktreeId)
    : empty
      ? first
      : store.createEmptySplitGroup(worktreeId, first, 'left')
  if (left) {
    openCookTab(worktreeId, planId, left)
  }
}

/** Opens the Cook pane (a board tab) in the workspace's first group and returns the group beside
 *  it for Claude, splitting to the right when there is none yet (proto v2 `cook()`). */
function openCookSplit(worktreeId: string, planId: string): string | undefined {
  const store = useAppStore.getState()
  const filePath = `${COOK_TAB_PREFIX}${planId}`
  // Why: a retry or Resume runs with Claude's group active; the pane stays in the group it is in.
  const paneTab = (store.unifiedTabsByWorktree[worktreeId] ?? []).find(
    (tab) => tab.entityId === filePath
  )
  const left =
    (paneTab &&
      store.groupsByWorktree[worktreeId]?.find((group) => group.tabOrder.includes(paneTab.id))
        ?.id) ??
    store.ensureWorktreeRootGroup(worktreeId)
  openCookTab(worktreeId, planId, left)
  const right = (useAppStore.getState().groupsByWorktree[worktreeId] ?? []).find(
    (group) => group.id !== left
  )
  return right?.id ?? store.createEmptySplitGroup(worktreeId, left, 'right') ?? undefined
}

/** Starts Claude on the reel's script in the group beside the Cook pane. Resume uses it too:
 *  /make-reel continues from job.json and skips the done steps. */
export function launchCookClaude(args: {
  worktreeId: string
  planId: string
  root: string
  scriptPath: string
}): ReturnType<typeof launchAgentInNewTab> {
  const { worktreeId } = args
  const groupId = openCookSplit(worktreeId, args.planId)
  return launchAgentInNewTab({
    requestId: newAgentLaunchRequestId(),
    agent: 'claude',
    worktreeId,
    ...(groupId ? { groupId } : {}),
    prompt: `/make-reel ${args.scriptPath}`,
    initialCwd: args.root,
    promptDelivery: 'submit-after-ready'
  })
}

/** Shows the workspace's Claude terminal, the newest one when Resume started another. */
export function showCookTerminal(worktreeId: string): void {
  const state = useAppStore.getState()
  const terminal = (state.tabsByWorktree[worktreeId] ?? []).findLast(
    (tab) => tab.launchAgent === 'claude'
  )
  const tab = (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
    (candidate) => candidate.entityId === terminal?.id
  )
  if (tab) {
    state.activateTab(tab.id, { worktreeId })
  }
}

/** Cook (B5-01): write the script into studio-reel, open a "Reel: <title>" folder workspace
 *  there split in two, the Cook pane left and Claude right, and type /make-reel into Claude
 *  once its TUI is ready. */
export async function cookReel(
  card: Pick<PlanCard, 'id'>,
  onLaunchFailed: () => void
): Promise<CookOutcome> {
  const result = await window.api.crowsnest.call('cookPlanCardAction', card.id)
  const cooked = result.ok ? result.value : { ok: false as const, error: result.error.message }
  if (!cooked.ok) {
    return cooked
  }
  const state = useAppStore.getState()
  const group =
    state.projectGroups.find((g) => g.name === STUDIO_GROUP) ??
    (await state.createProjectGroup(STUDIO_GROUP, LOCAL_EXECUTION_HOST_ID))
  if (!group) {
    return {
      ok: false,
      error: translate('boards.plan.cookNoProject', 'Could not create the Studio Reel project.')
    }
  }
  const name = `Reel: ${cooked.title}`
  // A retry reuses the workspace an earlier try opened on the same folder.
  const workspace =
    selectFolderWorkspaces(state).find((w) => w.folderPath === cooked.root && w.name === name) ??
    (await state.createFolderWorkspace(
      { projectGroupId: group.id, name, folderPath: cooked.root },
      { runtimeEnvironmentId: null }
    ))
  if (!workspace) {
    return {
      ok: false,
      error: translate('boards.plan.cookNoWorkspace', 'Could not open the reel workspace.')
    }
  }
  const marked = await window.api.crowsnest.call('markPlanCookingAction', card.id, workspace.id)
  const markedOutcome = marked.ok
    ? marked.value
    : { ok: false as const, error: marked.error.message }
  if (!markedOutcome.ok) {
    return markedOutcome
  }
  const failed = translate(
    'boards.plan.cookNoAgent',
    'Could not start Claude in the reel workspace.'
  )
  const rollBack = () => window.api.crowsnest.call('clearPlanCookingAction', card.id, workspace.id)
  openCookWorkspace(workspace.id)
  const launched = launchCookClaude({
    worktreeId: folderWorkspaceKey(workspace.id),
    planId: card.id,
    root: cooked.root,
    scriptPath: cooked.scriptPath
  })
  if (!launched) {
    await rollBack()
    return { ok: false, error: failed }
  }
  // Why: Claude may never reach a ready TUI; then the card leaves Cooking so Cook can be retried.
  void launched.promptDeliveryResult?.then(({ delivered }) => {
    if (!delivered) {
      void rollBack().then(onLaunchFailed)
    }
  })
  return { ok: true }
}
