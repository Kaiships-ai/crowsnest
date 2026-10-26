import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { activateAndRevealFolderWorkspace } from '@/lib/worktree-activation'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import type { PlanCard } from './plan-card-parts'

const STUDIO_GROUP = 'Studio Reel'

type CookOutcome = { ok: true } | { ok: false; error: string }

export function openCookWorkspace(workspaceId: string): boolean {
  return activateAndRevealFolderWorkspace(workspaceId, { navigationIntent: 'user-open' }) !== false
}

/** Cook (B5-01): write the script into studio-reel, open a "Reel: <title>" folder workspace
 *  there and type /make-reel into Claude once its TUI is ready. */
export async function cookReel(card: PlanCard): Promise<CookOutcome> {
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
  const workspace = await state.createFolderWorkspace(
    { projectGroupId: group.id, name: `Reel: ${cooked.title}`, folderPath: cooked.root },
    { runtimeEnvironmentId: null }
  )
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
  openCookWorkspace(workspace.id)
  const launched = launchAgentInNewTab({
    requestId: newAgentLaunchRequestId(),
    agent: 'claude',
    worktreeId: folderWorkspaceKey(workspace.id),
    prompt: `/make-reel ${cooked.scriptPath}`,
    initialCwd: cooked.root,
    promptDelivery: 'submit-after-ready'
  })
  return launched
    ? { ok: true }
    : {
        ok: false,
        error: translate('boards.plan.cookNoAgent', 'Could not start Claude in the reel workspace.')
      }
}
