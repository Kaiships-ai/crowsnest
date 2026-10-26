import type {
  EngineCallArgs,
  EngineCallName,
  EngineCallValue,
  EngineResult
} from '../../server/bridge/engine-calls'

export type { EngineCallName, EngineResult }

export type CrowsnestApi = {
  call: <N extends EngineCallName>(
    name: N,
    ...args: EngineCallArgs<N>
  ) => Promise<EngineResult<EngineCallValue<N>>>
}
