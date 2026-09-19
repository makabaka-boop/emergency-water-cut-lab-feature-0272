/**
 * 输入网络的数据契约（与 README「输入契约」一节一一对应）。
 * 所有容量均为 0..10^12 的整数（安全整数范围内用 number 精确表示）。
 */

export interface NodeItem {
  id: string
}

export interface ArcItem {
  id: string
  from: string
  to: string
  capacity: number
}

/** 供水点（sources）与需求点（sinks）共用结构。 */
export interface BoundaryItem {
  node: string
  capacity: number
}

export interface Network {
  nodes: NodeItem[]
  arcs: ArcItem[]
  sources: BoundaryItem[]
  sinks: BoundaryItem[]
}

/** 割项类别：供水点 / 管段 / 需求点。 */
export type CutKind = 'source' | 'arc' | 'sink'

export interface CutItem {
  kind: CutKind
  /** 供水点/需求点取节点 id，管段取管段 id。 */
  id: string
  capacity: number
  /** 仅管段割项携带起终点，便于复核。 */
  from?: string
  to?: string
}

/** 一次核算（基线或某个断管方案）的完整结果。 */
export interface Analysis {
  /** 最大供水量（最大流值）。 */
  value: number
  /** 残量网络中源侧到汇侧的割项，按 类别(供水点→管段→需求点)、id UTF-16 升序 排列。 */
  cut: CutItem[]
  /** 本方案停用的管段 id，UTF-16 升序。 */
  disabled: string[]
}

/** 载入成功后的模型：网络 + 基线核算。 */
export interface Model {
  network: Network
  baseline: Analysis
}

export const INVALID_NETWORK = 'INVALID_NETWORK' as const

export interface LoadError {
  code: typeof INVALID_NETWORK
  details: string[]
}

export type ParseResult =
  | { ok: true; network: Network }
  | { ok: false; error: LoadError }
