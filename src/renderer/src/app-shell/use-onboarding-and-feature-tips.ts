import { useCallback, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { onOnboardingReopened } from '../components/onboarding/show-onboarding-event'
import { shouldShowOnboarding } from '../components/onboarding/should-show-onboarding'
import { useAppStore } from '../store'
import type { OnboardingState } from '../../../shared/onboarding-state-types'

export type OnboardingGate = ReturnType<typeof useOnboardingAndFeatureTips>

/**
 * Owns first-run education: the onboarding flow's visibility. Lead Studio never opens
 * Orca's feature tips on its own; they teach Orca features a creator does not use.
 */
export function useOnboardingAndFeatureTips() {
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null)
  const [onboardingLoaded, setOnboardingLoaded] = useState(false)
  const persistedUIReady = useAppStore((s) => s.persistedUIReady)
  const contextualToursAutoEligible = useAppStore((s) => s.contextualToursAutoEligible)
  const actions = useAppStore(
    useShallow((s) => ({
      setNativeChatUpgradeTipVariant: s.setNativeChatUpgradeTipVariant,
      setContextualToursAutoEligible: s.setContextualToursAutoEligible,
      setContextualToursOnboardingVisible: s.setContextualToursOnboardingVisible
    }))
  )

  const applyStartupOnboardingState = useCallback((state: OnboardingState): void => {
    setOnboarding(state)
    setOnboardingLoaded(true)
  }, [])

  useEffect(() => {
    return onOnboardingReopened(setOnboarding)
  }, [])

  useEffect(() => {
    // Why: suppress tours until onboarding state is known (null = loading) so a first-run user can't mark a tour seen before onboarding appears.
    const suppressTours = !onboardingLoaded || shouldShowOnboarding(onboarding)
    actions.setContextualToursOnboardingVisible(suppressTours)
  }, [actions, onboarding, onboardingLoaded])

  useEffect(() => {
    if (!persistedUIReady || !onboardingLoaded || contextualToursAutoEligible !== null) {
      return
    }
    // Why: rollout targets first-run onboarding users; existing profiles are classified once and never auto-toured.
    actions.setContextualToursAutoEligible(shouldShowOnboarding(onboarding))
  }, [actions, contextualToursAutoEligible, onboarding, onboardingLoaded, persistedUIReady])

  useEffect(() => {
    if (!persistedUIReady) {
      return
    }

    let cancelled = false
    void window.api.onboarding
      .getNativeChatUpgradeTipVariant()
      .then((variant) => {
        if (!cancelled) {
          actions.setNativeChatUpgradeTipVariant(variant)
        }
      })
      .catch(() => {
        // Why: fail closed, and never hold the other tips behind a failed read.
        if (!cancelled) {
          actions.setNativeChatUpgradeTipVariant('none')
        }
      })

    return () => {
      cancelled = true
    }
  }, [actions, persistedUIReady])

  return {
    applyStartupOnboardingState,
    onboarding,
    setOnboarding,
    shouldRender: onboarding !== null && shouldShowOnboarding(onboarding)
  }
}
