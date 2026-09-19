import { Analysis, BoundaryItem, CutItem, CutKind, Model, Network } from './types'
import { FlowEdge, maxFlow } from './maxflow'

const KIND_ORDER: Record<CutKind, number> = { source: 0, arc: 1, sink: 2 }

/** UTF-16 编码单元升序（即 JavaScript 字符串默认 < 比较）。 */
export function compareUtf16(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function compareCutItems(a: CutItem, b: CutItem): number {
  return (
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || compareUtf16(a.id, b.id)
  )
}

/** 一条建模边（管段 / 超级源→供水点 / 需求点→超级汇）的身份与端点。 */
export interface SolvedEdge {
  /** 边在建模边数组中的下标（即传给 maxFlow 的输入边身份）。 */
  index: number
  from: number
  to: number
  /** 原始容量（停用管段不在此列表中）。 */
  capacity: number
  /** 当前 Dinic 方案分配的流量（= 该边反向残量容量）。 */
  flow: number
  /** 当前方案的正向残量容量 = 容量 - 流量。 */
  residual: number
}

/**
 * 一次完整求解的内部结果：对外的 Analysis 加上按输入边身份的建模边与
 * 正/反残量容量，供避难点供水区间等二次分析直接复用，不必重跑最大流。
 *
 * 建模边数组顺序固定为：未停用管段（按 network.arcs 顺序）、
 * 供水边（按 network.sources 顺序）、需求边（按 network.sinks 顺序）。
 * 同一节点兼作供水点与需求点时，供水边与需求边仍为两条独立输入边。
 */
export interface SolvedNetwork {
  network: Network
  nodeCount: number
  superSource: number
  superSink: number
  analysis: Analysis
  /** 未停用管段的建模边，下标与 network.arcs 对齐；停用管段对应 null。 */
  arcEdges: (SolvedEdge | null)[]
  /** 供水点建模边，下标与 network.sources 对齐。 */
  sourceEdges: SolvedEdge[]
  /** 需求点建模边，下标与 network.sinks 对齐。 */
  sinkEdges: SolvedEdge[]
}

/**
 * 对给定断管方案建模并求一次完整最大流：
 *  1. 建模：超级源 → 各供水点（容量=供水能力），原管段（停用管段移除），
 *     各需求点 → 超级汇（容量=需求能力）；
 *  2. 求最大流，即当前最大供水量；
 *  3. 在残量网络中从超级源遍历，源侧可达集到汇侧不可达集的
 *     「供水点 / 管段 / 需求点」边即为割项；
 *  4. 割项按 类别（供水点→管段→需求点）、id UTF-16 升序 排列。
 *
 * 同一输入必得同一输出（算法与排序均确定），因此清空方案后
 * 重算结果与基线逐项相等。
 */
export function solve(network: Network, disabled: ReadonlySet<string>): SolvedNetwork {
  const n = network.nodes.length
  const index = new Map<string, number>()
  network.nodes.forEach((node, i) => index.set(node.id, i))

  const SUPER_SOURCE = n
  const SUPER_SINK = n + 1

  const edges: FlowEdge[] = []
  const arcEdgeIndex: number[] = [] // 每条管段对应的边下标，停用为 -1
  network.arcs.forEach((arc) => {
    if (disabled.has(arc.id)) {
      arcEdgeIndex.push(-1)
      return
    }
    arcEdgeIndex.push(edges.length)
    edges.push({
      from: index.get(arc.from)!,
      to: index.get(arc.to)!,
      capacity: arc.capacity,
    })
  })
  const sourceEdgeIndex: number[] = []
  network.sources.forEach((s) => {
    sourceEdgeIndex.push(edges.length)
    edges.push({ from: SUPER_SOURCE, to: index.get(s.node)!, capacity: s.capacity })
  })
  const sinkEdgeIndex: number[] = []
  network.sinks.forEach((k) => {
    sinkEdgeIndex.push(edges.length)
    edges.push({ from: index.get(k.node)!, to: SUPER_SINK, capacity: k.capacity })
  })

  const result = maxFlow(n + 2, edges, SUPER_SOURCE, SUPER_SINK)
  const { value, flow, residual, reachable } = result

  const toEdge = (edgeIndex: number, item: { capacity: number }): SolvedEdge => ({
    index: edgeIndex,
    from: edges[edgeIndex].from,
    to: edges[edgeIndex].to,
    capacity: item.capacity,
    flow: flow[edgeIndex],
    residual: residual[edgeIndex],
  })

  // 割项 = 从源侧可达集指向汇侧不可达集的建模边（残量必为 0）。
  const cut: CutItem[] = []
  network.sources.forEach((s) => {
    if (!reachable[index.get(s.node)!]) {
      cut.push({ kind: 'source', id: s.node, capacity: s.capacity })
    }
  })
  network.arcs.forEach((arc, i) => {
    if (arcEdgeIndex[i] === -1) return // 已停用的管段不属于当前网络
    const fromReachable = reachable[index.get(arc.from)!]
    const toReachable = reachable[index.get(arc.to)!]
    if (fromReachable && !toReachable) {
      cut.push({
        kind: 'arc',
        id: arc.id,
        from: arc.from,
        to: arc.to,
        capacity: arc.capacity,
      })
    }
  })
  network.sinks.forEach((k) => {
    if (reachable[index.get(k.node)!]) {
      cut.push({ kind: 'sink', id: k.node, capacity: k.capacity })
    }
  })
  cut.sort(compareCutItems)

  const disabledSorted = Array.from(disabled).sort(compareUtf16)
  const analysis: Analysis = { value, cut, disabled: disabledSorted }

  const arcEdges = network.arcs.map((arc, i) => {
    const edgeIndex = arcEdgeIndex[i]
    return edgeIndex === -1 ? null : toEdge(edgeIndex, arc)
  })
  const sourceEdges = network.sources.map((s: BoundaryItem, i: number) =>
    toEdge(sourceEdgeIndex[i], s),
  )
  const sinkEdges = network.sinks.map((k: BoundaryItem, i: number) =>
    toEdge(sinkEdgeIndex[i], k),
  )

  return {
    network,
    nodeCount: n + 2,
    superSource: SUPER_SOURCE,
    superSink: SUPER_SINK,
    analysis,
    arcEdges,
    sourceEdges,
    sinkEdges,
  }
}

/** 仅取核算结果（Analysis），口径与历史 analyze 完全一致。 */
export function analyze(network: Network, disabled: ReadonlySet<string>): Analysis {
  return solve(network, disabled).analysis
}

/**
 * 载入成功后的内部模型：在对外 Model 之上额外携带基线的完整求解结果，
 * 供避难点供水区间等二次分析直接复用基线残量，避免基线重复计算。
 * 对外的 network / baseline 字段与 Model 完全一致。
 */
export type LoadedModel = Model & {
  readonly baselineSolution: SolvedNetwork
}

/** 相对损失 = (基线 - 当前) / 基线；基线为 0 时约定为 0（此时当前必为 0）。 */
export function relativeLoss(baseline: number, current: number): number {
  return baseline > 0 ? (baseline - current) / baseline : 0
}
