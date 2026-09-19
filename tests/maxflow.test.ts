import { describe, expect, it } from 'vitest'
import { analyze, solve } from '../src/core/analyze'
import { FlowEdge, maxFlow } from '../src/core/maxflow'
import { Network } from '../src/core/types'
import { validateNetwork } from '../src/core/validate'
import { mulberry32 } from './helpers'

describe('典型结构', () => {
  it('多源多汇', () => {
    const net: Network = {
      nodes: [{ id: 's1' }, { id: 's2' }, { id: 'm' }, { id: 't1' }, { id: 't2' }],
      arcs: [
        { id: 'a1', from: 's1', to: 'm', capacity: 10 },
        { id: 'a2', from: 's2', to: 'm', capacity: 7 },
        { id: 'a3', from: 'm', to: 't1', capacity: 9 },
        { id: 'a4', from: 'm', to: 't2', capacity: 6 },
      ],
      sources: [
        { node: 's1', capacity: 10 },
        { node: 's2', capacity: 7 },
      ],
      sinks: [
        { node: 't1', capacity: 9 },
        { node: 't2', capacity: 6 },
      ],
    }
    const res = analyze(net, new Set())
    // 供给 17，需求 15，通路 15 → 15
    expect(res.value).toBe(15)
    expect(res.cut.reduce((s, c) => s + c.capacity, 0)).toBe(15)
    // 残量网络中 s2 经 a2 余量可达 m，故割项为 m 下游的两条饱和管段
    expect(res.cut).toEqual([
      { kind: 'arc', id: 'a3', from: 'm', to: 't1', capacity: 9 },
      { kind: 'arc', id: 'a4', from: 'm', to: 't2', capacity: 6 },
    ])
  })

  it('零容量管段：仍作为容量 0 的割项出现', () => {
    const net: Network = {
      nodes: [{ id: 's' }, { id: 't' }],
      arcs: [{ id: 'zero', from: 's', to: 't', capacity: 0 }],
      sources: [{ node: 's', capacity: 5 }],
      sinks: [{ node: 't', capacity: 5 }],
    }
    const res = analyze(net, new Set())
    expect(res.value).toBe(0)
    expect(res.cut).toEqual([
      { kind: 'arc', id: 'zero', from: 's', to: 't', capacity: 0 },
    ])
  })

  it('零容量供水点/需求点', () => {
    const net: Network = {
      nodes: [{ id: 's' }, { id: 't' }],
      arcs: [{ id: 'e', from: 's', to: 't', capacity: 4 }],
      sources: [{ node: 's', capacity: 0 }],
      sinks: [{ node: 't', capacity: 0 }],
    }
    const res = analyze(net, new Set())
    expect(res.value).toBe(0)
    // 源侧可达集为空（供水边容量 0），需求点不可达 → 割项含零容量供水点
    expect(res.cut).toEqual([{ kind: 'source', id: 's', capacity: 0 }])
  })

  it('重边容量叠加', () => {
    const net: Network = {
      nodes: [{ id: 's' }, { id: 't' }],
      arcs: [
        { id: 'p1', from: 's', to: 't', capacity: 4 },
        { id: 'p2', from: 's', to: 't', capacity: 6 },
        { id: 'p3', from: 's', to: 't', capacity: 5 },
      ],
      sources: [{ node: 's', capacity: 100 }],
      sinks: [{ node: 't', capacity: 100 }],
    }
    const res = analyze(net, new Set())
    expect(res.value).toBe(15)
    expect(res.cut.map((c) => c.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('反向边合法且不构成正向通路', () => {
    const net: Network = {
      nodes: [{ id: 's' }, { id: 'a' }, { id: 't' }],
      arcs: [
        { id: 'fwd', from: 's', to: 'a', capacity: 5 },
        { id: 'back', from: 'a', to: 's', capacity: 100 },
        { id: 'out', from: 'a', to: 't', capacity: 3 },
      ],
      sources: [{ node: 's', capacity: 100 }],
      sinks: [{ node: 't', capacity: 100 }],
    }
    const res = analyze(net, new Set())
    expect(res.value).toBe(3)
    expect(res.cut).toEqual([
      { kind: 'arc', id: 'out', from: 'a', to: 't', capacity: 3 },
    ])
  })

  it('同一节点可同时是供水点与需求点', () => {
    const net: Network = {
      nodes: [{ id: 'x' }, { id: 't' }],
      arcs: [{ id: 'e', from: 'x', to: 't', capacity: 10 }],
      sources: [{ node: 'x', capacity: 6 }],
      sinks: [
        { node: 'x', capacity: 2 },
        { node: 't', capacity: 10 },
      ],
    }
    const res = analyze(net, new Set())
    // 2 单位在 x 处直接消化，4 单位经 e 送往 t
    expect(res.value).toBe(6)
  })
})

describe('安全整数上界', () => {
  it('总容量恰为 9×10^15 时精确核算，流量为 3×10^15', () => {
    const K = 3000
    const nodes: { id: string }[] = []
    const arcs: Network['arcs'] = []
    const sources: Network['sources'] = []
    const sinks: Network['sinks'] = []
    for (let i = 0; i < K; i++) {
      nodes.push({ id: `s${i}` }, { id: `t${i}` })
      arcs.push({
        id: `a${i}`,
        from: `s${i}`,
        to: `t${i}`,
        capacity: 1_000_000_000_000,
      })
      sources.push({ node: `s${i}`, capacity: 1_000_000_000_000 })
      sinks.push({ node: `t${i}`, capacity: 1_000_000_000_000 })
    }
    const net: Network = { nodes, arcs, sources, sinks }

    // 总容量 = 3 × 3000 × 10^12 = 9×10^15，恰在上界，应通过校验。
    const parsed = validateNetwork(JSON.parse(JSON.stringify(net)))
    expect(parsed.ok).toBe(true)

    const res = analyze(net, new Set())
    expect(res.value).toBe(3_000_000_000_000_000)
    expect(Number.isSafeInteger(res.value)).toBe(true)
    expect(res.cut).toHaveLength(K)
    // 大数求和仍精确：割项容量和 === 流量
    const cutSum = res.cut.reduce((s, c) => s + c.capacity, 0)
    expect(cutSum).toBe(3_000_000_000_000_000)
    expect(Number.isSafeInteger(cutSum)).toBe(true)
  })

  it('总容量超过 9×10^15 判 INVALID_NETWORK', () => {
    const net = {
      nodes: [{ id: 's' }, { id: 't' }],
      // 9001 × 10^12 = 9.001×10^15 > 9×10^15
      arcs: Array.from({ length: 9001 }, (_, i) => ({
        id: `a${i}`,
        from: 's',
        to: 't',
        capacity: 1_000_000_000_000,
      })),
      sources: [],
      sinks: [],
    }
    const parsed = validateNetwork(net)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error.code).toBe('INVALID_NETWORK')
  })
})

describe('按输入边身份的正/反残量容量', () => {
  it('flow（反残量）+ residual（正残量）恒等于输入容量，重边/自环/零容量各自独立', () => {
    // 直接在 maxFlow 层构造含重边、自环、原生反向边与零容量的输入边集合。
    const edges: FlowEdge[] = [
      { from: 0, to: 1, capacity: 4 }, // 重边 1
      { from: 0, to: 1, capacity: 6 }, // 重边 2
      { from: 0, to: 0, capacity: 9 }, // 自环：流量恒 0
      { from: 1, to: 0, capacity: 7 }, // 原生反向边
      { from: 1, to: 2, capacity: 0 }, // 零容量：流量恒 0
      { from: 1, to: 2, capacity: 10 },
    ]
    const res = maxFlow(3, edges, 0, 2)
    expect(res.value).toBe(10)
    expect(res.flow).toHaveLength(edges.length)
    expect(res.residual).toHaveLength(edges.length)
    edges.forEach((e, i) => {
      // 按输入边身份一一对应，不合并重边。
      expect(res.flow[i] + res.residual[i]).toBe(e.capacity)
      expect(res.flow[i]).toBeGreaterThanOrEqual(0)
      expect(res.residual[i]).toBeGreaterThanOrEqual(0)
    })
    // 自环与零容量边无流量；原生反向边也不参与正向输送。
    expect(res.flow[2]).toBe(0)
    expect(res.residual[2]).toBe(9)
    expect(res.flow[3]).toBe(0)
    expect(res.flow[4]).toBe(0)
    expect(res.residual[4]).toBe(0)
    // 两条重边流量之和恰为送出的 10。
    expect(res.flow[0] + res.flow[1]).toBe(10)
    expect(res.flow[5]).toBe(10)
    expect(res.residual[5]).toBe(0)
  })

  it('solve 给出的需求边残量与区间口径自洽', () => {
    const net: Network = {
      nodes: [{ id: 's' }, { id: 'm' }, { id: 't1' }, { id: 't2' }],
      arcs: [
        { id: 'b', from: 's', to: 'm', capacity: 5 },
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
    // 两条需求边按身份独立：流量之和为总值，正残量之和为剩余需求容量。
    const sumFlow = solved.sinkEdges.reduce((s, e) => s + e.flow, 0)
    const sumResidual = solved.sinkEdges.reduce((s, e) => s + e.residual, 0)
    expect(sumFlow).toBe(5)
    expect(sumResidual).toBe(5)
    solved.sinkEdges.forEach((e) => {
      expect(e.flow + e.residual).toBe(e.capacity)
    })
  })
})

describe('性能', () => {
  it('10000 节点 / 50000 管段（含反向边与重边）四秒内完成', () => {
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
    // 层间前向边：99 × 100 × 5 = 49500
    for (let l = 0; l < LAYERS - 1; l++) {
      for (let i = 0; i < PER; i++) {
        for (let k = 0; k < 5; k++) {
          const j = Math.floor(rng() * PER)
          arcs.push({
            id: `a${counter++}`,
            from: `L${l}N${i}`,
            to: `L${l + 1}N${j}`,
            capacity: randCap(),
          })
        }
      }
    }
    // 补足 50000：250 条反向边 + 250 条重边
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
    expect(net.nodes).toHaveLength(10_000)
    expect(net.arcs).toHaveLength(50_000)

    // 规模恰在上限，应通过校验。
    expect(validateNetwork(JSON.parse(JSON.stringify(net))).ok).toBe(true)

    const start = performance.now()
    const res = analyze(net, new Set())
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(4000)
    expect(Number.isSafeInteger(res.value)).toBe(true)
    expect(res.value).toBeGreaterThan(0)
    expect(res.value).toBeLessThanOrEqual(100_000_000_000)
    // 割项容量和恰为流量（大规模下不变量仍成立）。
    expect(res.cut.reduce((s, c) => s + c.capacity, 0)).toBe(res.value)
  })
})
