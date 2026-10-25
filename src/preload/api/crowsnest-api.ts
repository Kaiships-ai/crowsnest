import type {
  EngineCallArgs,
  EngineCallName,
  EngineCallValue,
  EngineResult
} from '../../server/bridge/engine-calls'

export type { EngineCallName, EngineResult }

/** Derived from `ENGINE_CALLS` in src/server/bridge/engine-calls.ts; add a call there, never here. */
export type CrowsnestApi = {
  call: <N extends EngineCallName>(
    name: N,
    ...args: EngineCallArgs<N>
  ) => Promise<EngineResult<EngineCallValue<N>>>
}
