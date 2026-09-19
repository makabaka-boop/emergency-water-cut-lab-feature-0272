import { describe, expect, it } from 'vitest'
import { solve } from '../src/core/analyze'
import { computeSupplyRange } from '../src/core/range'
import { Network } from '../src/core/types'
import { mulberry32 } from './helpers'

/** 取指定需求点的区间结果，失败即抛错。 */
function rangeOf(net: Network, sinkId: string, disabled: ReadonlySet<string> = new Set()) {
  const solved = solve(net, disabled)
  const result = computeSupplyRange(solved, sinkId)
  if (!result.ok) throw new Error(result.error)
  return { solved, range: result.range }
}

describe('避难点供水区间：锁定场景', () => {
  it('共享瓶颈容量 5、下游两个需求点容量各 5：二者均为 0..5 且当前分配落在区间内', () => {
    const net: Network = {
      nodes: [{ id: 's' }, { id: 'm' }, { id: 't1' }, { id: 't2' }],
      arcs: [
        { id: 'bottle', from: 's', to: 'm', capacity: 5 },
        { id: 'd1', from: 'm', to: 't1', capacity: 5 },
        { id: 'd2', from: 'm', to: 't2', capacity: 5 },
      ],
      sources: [{ node: 's', capacity: 100 }],
      sinks: [
        { node: 't1', capacity: 5 },
        { node: 't2', capacity: 5 },
      ],
    }
    const solved = solve(net, new Set())
    expect(solved.analysis.value).toBe(5)

    for (const sinkId of ['t1', 't2']) {
      const result = computeSupplyRange(solved, sinkId)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const r = result.range
      expect(r.total).toBe(5)
      expect(r.capacity).toBe(5)
      expect(r.min).toBe(0)
      expect(r.max).toBe(5)
      // 当前 Dinic 方案值只是一组可行分配，必在闭区间内；两者之和恰为总值。
      expect(r.current).toBeGreaterThanOrEqual(r.min)
      expect(r.current).toBeLessThanOrEqual(r.max)
      expect(Number.isInteger(r.min) && Number.isInteger(r.max)).toBe(true)
    }
    const r1 = computeSupplyRange(solved, 't1')
    const r2 = computeSupplyRange(solved, 't2')
    if (r1.ok && r2.ok) {
      expect(r1.range.current + r2.range.current).toBe(5)
    }
  })

  it('区间端点可实现：单点直供饱和时退化为单点区间', () => {
    const net: Network = {
      nodes: [{ id: 's' }, { id: 't' }],
      arcs: [{ id: 'e', from: 's', to: 't', capacity: 5 }],
      sources: [{ node: 's', capacity: 5 }],
      sinks: [{ node: 't', capacity: 5 }],
    }
    const { range } = rangeOf(net, 't')
    expect(range).toMatchObject({ min: 5, current: 5, max: 5, total: 5 })
  })

  it('总流量为 0 时所有需求点区间为 0..0', () => {
    const net: Network = {
      nodes: [{ id: 's' }, { id: 'a' }, { id: 'b' }],
      arcs: [{ id: 'e', from: 's', to: 'a', capacity: 5 }],
      sources: [{ node: 's', capacity: 5 }],
      sinks: [
        { node: 'a', capacity: 3 },
        { node: 'b', capacity: 4 },
      ],
    }
    // 需求点 a 可达但…实际：s→a 通，a 的需求边直接入汇，可送 3。改为断管场景：
    const solved = solve(net, new Set(['e']))
    expect(solved.analysis.value).toBe(0)
    for (const k of ['a', 'b']) {
      const r = computeSupplyRange(solved, k)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.range).toMatchObject({ min: 0, current: 0, max: 0 })
    }
  })

  it('重边与原生反向边：按输入边独立核算，区间仍正确', () => {
    // s→t 有重边 3+4，另加一条 t→s 原生反向边（容量 10）不参与正向输送。
    const net: Network = {
      nodes: [{ id: 's' }, { id: 't' }],
      arcs: [
        { id: 'p1', from: 's', to: 't', capacity: 3 },
        { id: 'p2', from: 's', to: 't', capacity: 4 },
        { id: 'back', from: 't', to: 's', capacity: 10 },
      ],
      sources: [{ node: 's', capacity: 100 }],
      sinks: [{ node: 't', capacity: 10 }],
    }
    const { range } = rangeOf(net, 't')
    expect(range.total).toBe(7)
    expect(range.current).toBe(7)
    expect(range.min).toBe(7) // 总量 7 只有一个需求点，无处转移
    expect(range.max).toBe(7)
  })

  it('同一节点兼作供水点与需求点：供水边与需求边独立核算', () => {
    const net: Network = {
      nodes: [{ id: 'x' }, { id: 't' }],
      arcs: [{ id: 'e', from: 'x', to: 't', capacity: 10 }],
      sources: [{ node: 'x', capacity: 6 }],
      sinks: [
        { node: 'x', capacity: 2 },
        { node: 't', capacity: 10 },
      ],
    }
    const solved = solve(net, new Set())
    expect(solved.analysis.value).toBe(6)
    // x 就地消化的 2 单位可改为外送给 t（x 的需求边可减量 2，t 可增量 2）。
    const rx = computeSupplyRange(solved, 'x')
    const rt = computeSupplyRange(solved, 't')
    expect(rx.ok && rt.ok).toBe(true)
    if (rx.ok && rt.ok) {
      expect(rx.range.min).toBe(0)
      expect(rx.range.max).toBe(2)
      expect(rt.range.min).toBe(4)
      expect(rt.range.max).toBe(6)
      expect(rx.range.current + rt.range.current).toBe(6)
    }
  })
})

describe('避难点供水区间：断管联动与失败处理', () => {
  const NET: Network = {
    nodes: [{ id: 's' }, { id: 'a' }, { id: 'b' }, { id: 't' }],
    arcs: [
      { id: 'e1', from: 's', to: 'a', capacity: 10 },
      { id: 'e2', from: 's', to: 'b', capacity: 8 },
      { id: 'e3', from: 'a', to: 't', capacity: 10 },
      { id: 'e4', from: 'b', to: 't', capacity: 8 },
      { id: 'e5', from: 'a', to: 'b', capacity: 1 },
    ],
    sources: [{ node: 's', capacity: 100 }],
    sinks: [{ node: 't', capacity: 100 }],
  }

  it('停用/恢复管段后按新断管集合与当前总量重算；清空方案恢复基线区间', () => {
    const baseline = solve(NET, new Set())
    const drilled = solve(NET, new Set(['e1']))
    expect(baseline.analysis.value).toBe(18)
    expect(drilled.analysis.value).toBe(8)

    const rb = computeSupplyRange(baseline, 't')
    const rd = computeSupplyRange(drilled, 't')
    expect(rb.ok && rd.ok).toBe(true)
    if (rb.ok && rd.ok) {
      expect(rb.range.total).toBe(18)
      expect(rd.range.total).toBe(8)
      expect(rd.range.current).toBe(8)
      // 清空方案：基线区间结果与基线求解逐项一致。
      const cleared = solve(NET, new Set())
      expect(computeSupplyRange(cleared, 't')).toEqual(rb)
    }
  })

  it('需求点不属于当前模型时返回失败（供页面清除旧区间并就地提示）', () => {
    const solved = solve(NET, new Set())
    const result = computeSupplyRange(solved, '不存在的避难点')
    expect(result.ok).toBe(false)
  })
})

/**
 * 小整数网络全部可行流枚举：
 * 对每个随机小网络逐条枚举建模边的流量向量（容量 0..2），
 * 过滤满足全部节点守恒且总值恰等于最大流的方案，
 * 逐需求点核对 Dinic 区间上下界恰为枚举极值，并核对当前值落在区间内。
 */
describe('避难点供水区间：枚举全部可行流', () => {
  it('300 个小整数网络：区间上下界 = 枚举极值，端点可实现，当前值在区间内', () => {
    const rng = mulberry32(20260919)
    let sinkChecks = 0
    for (let round = 0; round < 300; round++) {
      const nodeCount = 2 + Math.floor(rng() * 3) // 2..4
      const ids = Array.from({ length: nodeCount }, (_, i) => `n${i}`)
      const pick = () => ids[Math.floor(rng() * nodeCount)]
      const arcCount = Math.floor(rng() * 5) // 0..4
      const arcs = Array.from({ length: arcCount }, (_, i) => ({
        id: `a${i}`,
        from: pick(),
        to: pick(),
        capacity: Math.floor(rng() * 3), // 0..2，天然覆盖零容量与自环
      }))
      const shuffled = [...ids]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }
      const srcCount = 1 + Math.floor(rng() * Math.min(2, nodeCount))
      const snkCount = 1 + Math.floor(rng() * Math.min(2, nodeCount))
      const sources = shuffled
        .slice(0, srcCount)
        .map((node) => ({ node, capacity: Math.floor(rng() * 3) }))
      const sinks = shuffled
        .slice(nodeCount - snkCount)
        .map((node) => ({ node, capacity: Math.floor(rng() * 3) }))
      // 允许同一节点兼作供需点（小概率自然出现时覆盖）。
      const net: Network = {
        nodes: ids.map((id) => ({ id })),
        arcs,
        sources,
        sinks,
      }
      const disabled = new Set<string>()
      net.arcs.forEach((a) => {
        if (rng() < 0.25) disabled.add(a.id)
      })

      const solved = solve(net, disabled)
      const V = solved.analysis.value
      expect(Number.isSafeInteger(V)).toBe(true)

      // 建模边（与 solve 同口径）：管段（跳过停用）+ 供水 + 需求。
      const idx = new Map(ids.map((id, i) => [id, i]))
      const S = nodeCount
      const T = nodeCount + 1
      type E = { u: number; v: number; c: number; kind: 'arc' | 'src' | 'snk' }
      const es: E[] = []
      net.arcs.forEach((a) => {
        if (!disabled.has(a.id)) {
          es.push({ u: idx.get(a.from)!, v: idx.get(a.to)!, c: a.capacity, kind: 'arc' })
        }
      })
      net.sources.forEach((s) => {
        es.push({ u: S, v: idx.get(s.node)!, c: s.capacity, kind: 'src' })
      })
      const sinkStart = es.length
      net.sinks.forEach((k) => {
        es.push({ u: idx.get(k.node)!, v: T, c: k.capacity, kind: 'snk' })
      })

      // 枚举全部可行流并记录每个需求点在「总值=最大流」方案中的极值。
      const balance = new Int32Array(nodeCount + 2)
      const flowVec = new Int32Array(es.length)
      const extrema = net.sinks.map(() => ({
        min: Number.POSITIVE_INFINITY,
        max: Number.NEGATIVE_INFINITY,
      }))
      let feasibleMaxFlows = 0

      const evaluate = () => {
        if (balance[T] !== V) return
        for (let v = 0; v < nodeCount; v++) {
          if (balance[v] !== 0) return
        }
        feasibleMaxFlows++
        net.sinks.forEach((_, k) => {
          const x = flowVec[sinkStart + k]
          if (x < extrema[k].min) extrema[k].min = x
          if (x > extrema[k].max) extrema[k].max = x
        })
      }

      const enumEdges = (i: number) => {
        if (i === es.length) {
          evaluate()
          return
        }
        const { u, v, c } = es[i]
        for (let x = 0; x <= c; x++) {
          flowVec[i] = x
          balance[u] -= x
          balance[v] += x
          enumEdges(i + 1)
          balance[u] += x
          balance[v] -= x
        }
        flowVec[i] = 0
      }
      enumEdges(0)

      // Dinic 方案本身必是「总值=最大流」的可行流，故至少一枚可行。
      expect(feasibleMaxFlows).toBeGreaterThan(0)

      net.sinks.forEach((k, sinkPos) => {
        sinkChecks++
        const result = computeSupplyRange(solved, k.node)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        const r = result.range
        // 上下界恰为全部最大流可行方案中该需求边流量的枚举极值。
        expect(r.min).toBe(extrema[sinkPos].min)
        expect(r.max).toBe(extrema[sinkPos].max)
        // 端点不突破容量与当前 analysis.value。
        expect(r.min).toBeGreaterThanOrEqual(0)
        expect(r.max).toBeLessThanOrEqual(k.capacity)
        expect(r.max - r.min).toBeLessThanOrEqual(V)
        // 当前 Dinic 方案值落在区间内，且各需求点当前值之和恰为总值。
        expect(r.current).toBeGreaterThanOrEqual(r.min)
        expect(r.current).toBeLessThanOrEqual(r.max)
        expect(r.total).toBe(V)
        // 端点皆为整数（端点可实现性由枚举极值直接保证）。
        expect(Number.isInteger(r.min) && Number.isInteger(r.max)).toBe(true)
      })
      const currentSum = solved.sinkEdges.reduce((s, e) => s + e.flow, 0)
      expect(currentSum).toBe(V)
    }
    // 基本的样本量护栏，防止随机参数被意外改小导致空转。
    expect(sinkChecks).toBeGreaterThan(300)
  })
})

describe('避难点供水区间：性能', () => {
  it('一万节点 / 五万管段样本上，单次区间查询（含整体重算）4 秒内完成', () => {
    const rng = mulberry32(42)
    const LAYERS = 100
    const PER = 100
    const nodes: { id: string }[] = []
    for (let l = 0; l < LAYERS; l++) {
      for (let i = 0; i < PER; i++) nodes.push({ id: `L${l}N${i}` })
    }
    const arcs: Network['arcs'] = []
    let counter = 0
    const randCap = () => Math.floor(rng() * 1_000_000_000)
    for (let l = 0; l < LAYERS - 1; l++) {
      for (let i = 0; i < PER; i++) {
        for (let k = 0; k < 5; k++) {
          arcs.push({
            id: `a${counter++}`,
            from: `L${l}N${i}`,
            to: `L${l + 1}N${Math.floor(rng() * PER)}`,
            capacity: randCap(),
          })
        }
      }
    }
    for (let i = 0; i < 250; i++) {
      const l = Math.floor(rng() * (LAYERS - 1))
      arcs.push({
        id: `a${counter++}`,
        from: `L${l + 1}N${Math.floor(rng() * PER)}`,
        to: `L${l}N${Math.floor(rng() * PER)}`,
        capacity: randCap(),
      })
    }
    for (let i = 0; i < 250; i++) {
      const l = Math.floor(rng() * (LAYERS - 1))
      const u = Math.floor(rng() * PER)
      arcs.push({
        id: `a${counter++}`,
        from: `L${l}N${u}`,
        to: `L${l + 1}N${u}`,
        capacity: randCap(),
      })
    }
    const sources: Network['sources'] = []
    const sinks: Network['sinks'] = []
    for (let i = 0; i < PER; i++) {
      sources.push({ node: `L0N${i}`, capacity: 1_000_000_000 })
      sinks.push({ node: `L${LAYERS - 1}N${i}`, capacity: 1_000_000_000 })
    }
    const net: Network = { nodes, arcs, sources, sinks }
    const disabled = new Set<string>()
    for (let i = 0; i < 50; i++) {
      disabled.add(arcs[Math.floor(rng() * arcs.length)].id)
    }

    // 演练场景：停用集合变化 → 整体重算 + 区间查询，单次四秒内完成。
    const start = performance.now()
    const solved = solve(net, disabled)
    const result = computeSupplyRange(solved, `L${LAYERS - 1}N37`)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(4000)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.range.total).toBe(solved.analysis.value)
      expect(result.range.min).toBeLessThanOrEqual(result.range.max)
    }
  })
})
