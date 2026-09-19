/**
 * 避难点供水区间。
 *
 * 给定一组总值固定（= 当前最大供水量 analysis.value）的可行分配（solve() 中
 * Dinic 给出的当前方案只是其中一组），求某个需求点 k 的需求边 e=(v,T) 在
 * 「不破坏容量约束与节点守恒、且总供水量不变」前提下可获水量的最小值与最大值。
 *
 * 残量网络刻画了保持当前总值的全部调整空间：沿残量弧推送的是**环流**，
 * 因此从超级源出发/汇入超级源的总量不变。
 *
 *  - 增加 e 的流量 δ：需在残量网中找到 T→v 的环流
 *        T → … → v —(e 正向残量)→ T
 *    其中从 T 到 v 的部分只能使用**其他边**的残量弧（e 自身的两条残量弧
 *    一律排除，否则会沿 e 自己绕回，得到没有意义的自循环）。故
 *        可增量 = maxFlow(残量网 \ {e 正弧, e 反弧}, T → v)
 *    再与 e 的正向残量容量（容量 - 当前值）取最小。
 *
 *  - 减少 e 的流量 δ：沿 e 的反向残量弧把流量从 T 推回 v，再经其他边回到 T：
 *        v ←(e 反向残量)— T → … → v 等价于残量网中 v → T 的环流，
 *        可减量 = maxFlow(残量网 \ {e 正弧, e 反弧}, v → T)
 *    再与 e 的反向残量容量（当前值）取最小。
 *
 * 两次辅助最大流都只复用 solve() 按输入边身份给出的正/反残量容量独立建图；
 * 重边、原生反向边、自环、零容量边均作为各自独立的输入边残量弧参与核算，
 * 不做合并。Dinic 求整数容量网络必得整数流，故区间端点皆为整数且可实现。
 */

import { SolvedEdge, SolvedNetwork } from './analyze'
import { FlowEdge, maxFlow } from './maxflow'

export interface SupplyRange {
  /** 需求点节点 id。 */
  sinkId: string
  /** 需求边容量（上界不可能超过它）。 */
  capacity: number
  /** 当前 Dinic 方案中该需求点的获水量（只是一组可行分配）。 */
  current: number
  /** 当前最大供水总量（区间核算全程保持不变）。 */
  total: number
  /** 总量不变前提下可获水量的最小值（整数、可实现）。 */
  min: number
  /** 总量不变前提下可获水量的最大值（整数、可实现）。 */
  max: number
}

export type RangeResult =
  | { ok: true; range: SupplyRange }
  | { ok: false; error: string }

/**
 * 在当前方案的残量网络上构造辅助边：除下标 excludeIndex 的需求边自身外，
 * 每条建模输入边各提供两条独立残量弧——正向（容量=正向残量）与
 * 反向（容量=反向残量，即当前流量）。
 *
 * 排除目标需求边自身的两条残量弧，保证可增/减量完全由其他输入边的
 * 调整空间提供。
 */
function buildResidualEdges(solved: SolvedNetwork, excludeIndex: number): FlowEdge[] {
  const all: SolvedEdge[] = [
    ...solved.arcEdges.filter((e): e is SolvedEdge => e !== null),
    ...solved.sourceEdges,
    ...solved.sinkEdges,
  ]
  const edges: FlowEdge[] = []
  for (const e of all) {
    if (e.index === excludeIndex) continue
    // 自环：两条残量弧也都是自环，对最大流无贡献，保留即可（独立核算）。
    if (e.residual > 0) {
      edges.push({ from: e.from, to: e.to, capacity: e.residual })
    }
    if (e.flow > 0) {
      edges.push({ from: e.to, to: e.from, capacity: e.flow })
    }
  }
  return edges
}

function isSafeNonNegInt(x: number): boolean {
  return Number.isSafeInteger(x) && x >= 0
}

/**
 * 计算指定需求点在当前方案下的供水区间。
 *
 * @param solved 当前断管集合下 solve() 的完整结果
 * @param sinkId 工程师在页面选择的需求点节点 id
 */
export function computeSupplyRange(
  solved: SolvedNetwork,
  sinkId: string,
): RangeResult {
  const sinkPos = solved.network.sinks.findIndex((k) => k.node === sinkId)
  if (sinkPos === -1) {
    return { ok: false, error: `需求点 "${sinkId}" 不属于当前模型，区间已清除` }
  }
  const target = solved.sinkEdges[sinkPos]
  const sinkItem = solved.network.sinks[sinkPos]

  // 内部不变量自检：身份、容量分解与总量守恒一旦异常即视为辅助求解失败，
  // 调用方据此清除旧区间并就地提示，不改动已成功的基线/演练核算结果。
  const { superSink: T } = solved
  let sourceSum = 0
  for (const e of solved.sourceEdges) sourceSum += e.flow
  let sinkSum = 0
  for (const e of solved.sinkEdges) sinkSum += e.flow
  const edges: SolvedEdge[] = [
    ...solved.arcEdges.filter((e): e is SolvedEdge => e !== null),
    ...solved.sourceEdges,
    ...solved.sinkEdges,
  ]
  for (const e of edges) {
    if (
      !isSafeNonNegInt(e.flow) ||
      !isSafeNonNegInt(e.residual) ||
      e.flow + e.residual !== e.capacity
    ) {
      return { ok: false, error: '当前方案残量不满足容量分解，区间求解失败' }
    }
  }
  if (
    sourceSum !== solved.analysis.value ||
    sinkSum !== solved.analysis.value
  ) {
    return { ok: false, error: '当前方案总量与核算结果不一致，区间求解失败' }
  }

  const residualEdges = buildResidualEdges(solved, target.index)
  const demandNode = target.from // 需求边为 v→T，需求节点 v 是起点

  // 增量：超级汇 → 需求节点在「排除目标需求边自身残量弧」的残量网上的最大流。
  const increaseFlow = maxFlow(solved.nodeCount, residualEdges, T, demandNode)
  // 减量：需求节点 → 超级汇，同一辅助网络反向求流（独立重跑，互不污染）。
  const decreaseFlow = maxFlow(solved.nodeCount, residualEdges, demandNode, T)

  if (
    !isSafeNonNegInt(increaseFlow.value) ||
    !isSafeNonNegInt(decreaseFlow.value)
  ) {
    return { ok: false, error: '辅助网络可调流量不是精确整数，区间求解失败' }
  }

  // 端点不能突破需求边容量（正/反残量）与当前 analysis.value（总量不变）。
  const increase = Math.min(increaseFlow.value, target.residual)
  const decrease = Math.min(decreaseFlow.value, target.flow)
  const current = target.flow
  const max = current + increase
  const min = current - decrease

  if (
    !isSafeNonNegInt(min) ||
    !isSafeNonNegInt(max) ||
    min > current ||
    current > max ||
    max > target.capacity
  ) {
    return { ok: false, error: '区间端点违反容量或总量约束，区间求解失败' }
  }
  // 端点处其余需求点的分摊总量不超过当前总值（min/max 由环流构造，
  // 理论上恒成立，此处再做一道防御性校验）。
  if (max - current > solved.analysis.value) {
    return { ok: false, error: '区间端点突破当前最大供水总量，区间求解失败' }
  }

  return {
    ok: true,
    range: {
      sinkId,
      capacity: sinkItem.capacity,
      current,
      total: solved.analysis.value,
      min,
      max,
    },
  }
}
