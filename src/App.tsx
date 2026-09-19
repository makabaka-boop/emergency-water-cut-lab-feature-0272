import { ChangeEvent, useMemo, useState } from 'react'
import { relativeLoss, solve, SolvedNetwork } from './core/analyze'
import { formatInt, formatPercent } from './core/format'
import { initialLoaderState, reduceLoad } from './core/loader'
import { computeSupplyRange } from './core/range'
import { SAMPLE_TEXT } from './core/sample'
import { Analysis, CutItem, CutKind, Model } from './core/types'

const KIND_LABEL: Record<CutKind, string> = {
  source: '供水点',
  arc: '管段',
  sink: '需求点',
}

const PAGE_SIZE = 100

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** 复核报告：自包含（含网络与方案），可脱离页面独立重算验证。 */
function buildReport(
  kind: 'baseline' | 'drill',
  model: Model,
  analysis: Analysis,
) {
  return {
    report: kind,
    generatedAt: new Date().toISOString(),
    network: model.network,
    disabledArcIds: analysis.disabled,
    maxSupply: analysis.value,
    cut: analysis.cut,
    loss: model.baseline.value - analysis.value,
    relativeLoss: relativeLoss(model.baseline.value, analysis.value),
  }
}

function CutTable({
  cut,
  onDisableArc,
}: {
  cut: CutItem[]
  onDisableArc?: (id: string) => void
}) {
  if (cut.length === 0) {
    return <p className="muted">割项为空（当前网络无源侧到汇侧的割边）。</p>
  }
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>类别</th>
          <th>ID</th>
          <th>起点 → 终点</th>
          <th className="num">容量</th>
          {onDisableArc && <th>操作</th>}
        </tr>
      </thead>
      <tbody>
        {cut.map((item) => (
          <tr key={`${item.kind}:${item.id}`}>
            <td>{KIND_LABEL[item.kind]}</td>
            <td className="mono">{item.id}</td>
            <td className="mono">
              {item.kind === 'arc' ? `${item.from} → ${item.to}` : '—'}
            </td>
            <td className="num mono">{formatInt(item.capacity)}</td>
            {onDisableArc && (
              <td>
                {item.kind === 'arc' && (
                  <button
                    className="link-btn"
                    onClick={() => onDisableArc(item.id)}
                  >
                    停用
                  </button>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ValueBlock({
  label,
  value,
  suffix,
}: {
  label: string
  value: string
  suffix?: string
}) {
  return (
    <div className="value-block">
      <div className="value-label">{label}</div>
      <div className="value-number mono">
        {value}
        {suffix && <span className="value-suffix">{suffix}</span>}
      </div>
    </div>
  )
}

/**
 * 避难点供水区间：在当前最大供水总量不变的前提下，展示所选需求点
 * 可获水量的最小值、当前 Dinic 方案值与最大值。
 *
 * 当前值只是一组可行分配；停用/恢复管段后由父组件传入按新断管集合
 * 重算的 solved；求解失败时就地提示且不展示任何旧区间。
 */
function SupplyRangeSection({
  solved,
  selectedSink,
  onSelectSink,
}: {
  solved: SolvedNetwork
  selectedSink: string | null
  onSelectSink: (id: string | null) => void
}) {
  const sinks = solved.network.sinks
  const valid = selectedSink !== null && sinks.some((k) => k.node === selectedSink)
  const result = useMemo(
    () => (valid ? computeSupplyRange(solved, selectedSink!) : null),
    [solved, selectedSink, valid],
  )

  return (
    <div className="range-box">
      <h3>避难点供水区间（当前最大供水总量 {formatInt(solved.analysis.value)} 不变）</h3>
      <div className="range-controls">
        <label>
          选择需求点：
          <select
            value={valid ? selectedSink! : ''}
            onChange={(e) => onSelectSink(e.target.value === '' ? null : e.target.value)}
          >
            <option value="">（不选择）</option>
            {sinks.map((k) => (
              <option key={k.node} value={k.node}>
                {k.node}（需求容量 {formatInt(k.capacity)}）
              </option>
            ))}
          </select>
        </label>
      </div>
      {!valid && (
        <p className="muted">从当前模型的需求点中选择一个，查看其在总量不变前提下的可获水量区间。</p>
      )}
      {valid && result && !result.ok && (
        <p className="error-inline" role="alert">
          {result.error}（已清除旧区间，不影响上方已完成的核算结果）
        </p>
      )}
      {valid && result && result.ok && (
        <>
          <div className="value-row">
            <ValueBlock label="可获水量 · 最小值" value={formatInt(result.range.min)} />
            <ValueBlock label="当前 Dinic 方案值" value={formatInt(result.range.current)} />
            <ValueBlock label="可获水量 · 最大值" value={formatInt(result.range.max)} />
          </div>
          <p className="muted range-note">
            当前值 {formatInt(result.range.current)} 只是保持总供水量{' '}
            {formatInt(result.range.total)} 不变的一组可行分配；区间{' '}
            <span className="mono">
              [{formatInt(result.range.min)}, {formatInt(result.range.max)}]
            </span>{' '}
            内的每个整数端点均可在不突破容量与节点守恒的前提下实现。
          </p>
        </>
      )}
    </div>
  )
}

export default function App() {
  const [loader, setLoader] = useState(initialLoaderState)
  const [text, setText] = useState('')
  const [disabled, setDisabled] = useState<ReadonlySet<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(0)
  const [selectedSink, setSelectedSink] = useState<string | null>(null)

  const model = loader.model

  const loadText = (t: string) => {
    setLoader((prev) => reduceLoad(prev, t))
  }

  // 模型更换（引用变化）时清空演练方案与需求点选择，从基线重新开始。
  // 载入新模型使旧的需求点选择失效（区间一并清除）。
  const [prevModel, setPrevModel] = useState(model)
  if (model !== prevModel) {
    setPrevModel(model)
    setDisabled(new Set())
    setFilter('')
    setPage(0)
    setSelectedSink(null)
  }

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    file.text().then(loadText)
    e.target.value = ''
  }

  // 空方案直接复用基线结果，保证「清空方案」逐项精确回到基线。
  // 区间核算同样复用载入时保存的基线完整求解（baselineSolution）。
  const baselineSolved = model?.baselineSolution ?? null
  const drillSolved: SolvedNetwork | null = useMemo(() => {
    if (!model) return null
    return disabled.size === 0 ? baselineSolved : solve(model.network, disabled)
  }, [model, disabled, baselineSolved])
  const analysis: Analysis | null = drillSolved ? drillSolved.analysis : null

  const filteredArcs = useMemo(() => {
    if (!model) return []
    const f = filter.trim()
    if (!f) return model.network.arcs
    return model.network.arcs.filter(
      (a) => a.id.includes(f) || a.from.includes(f) || a.to.includes(f),
    )
  }, [model, filter])

  const pageCount = Math.max(1, Math.ceil(filteredArcs.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageArcs = filteredArcs.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE,
  )

  const toggleArc = (id: string) => {
    const next = new Set(disabled)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    setDisabled(next)
  }

  const clearPlan = () => setDisabled(new Set())

  return (
    <div className="page">
      <header className="page-header">
        <h1>暴雨断管 · 应急供水韧性评估</h1>
        <p className="muted">
          载入管网 JSON，核算基线最大供水量与瓶颈割项；逐项停用管段演练，
          实时得到当前供水量、相对损失与新割项。纯前端计算，无任何网络请求。
        </p>
      </header>

      <section className="card">
        <h2>一、载入网络</h2>
        <div className="load-actions">
          <label className="file-btn">
            选择 JSON 文件
            <input type="file" accept=".json,application/json" onChange={onFileChange} />
          </label>
          <button onClick={() => { setText(SAMPLE_TEXT); loadText(SAMPLE_TEXT) }}>
            载入内置示例
          </button>
          <button onClick={() => loadText(text)}>解析文本框内容</button>
        </div>
        <textarea
          className="json-input mono"
          spellCheck={false}
          placeholder='粘贴网络 JSON：{"nodes":[...],"arcs":[...],"sources":[...],"sinks":[...]}'
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {loader.error && (
          <div className="error-banner" role="alert">
            <strong className="mono">{loader.error.code}</strong>
            <span className="muted">（已保留上次模型）</span>
            <ul>
              {loader.error.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </div>
        )}
        {model ? (
          <p className="muted stats-line">
            当前模型：节点 {formatInt(model.network.nodes.length)} · 管段{' '}
            {formatInt(model.network.arcs.length)} · 供水点{' '}
            {model.network.sources.length} · 需求点 {model.network.sinks.length}
          </p>
        ) : (
          <p className="muted">尚未载入有效模型。</p>
        )}
      </section>

      {model && analysis && (
        <>
          <section className="card">
            <div className="card-head">
              <h2>二、基线核算</h2>
              <button
                onClick={() =>
                  downloadJson('baseline-report.json', buildReport('baseline', model, model.baseline))
                }
              >
                导出基线复核报告
              </button>
            </div>
            <div className="value-row">
              <ValueBlock
                label="基线最大供水量"
                value={formatInt(model.baseline.value)}
              />
              <ValueBlock
                label="割项数量"
                value={formatInt(model.baseline.cut.length)}
              />
            </div>
            <h3>残量网络源侧 → 汇侧割项</h3>
            <CutTable cut={model.baseline.cut} />
            <SupplyRangeSection
              solved={baselineSolved!}
              selectedSink={selectedSink}
              onSelectSink={setSelectedSink}
            />
          </section>

          <section className="card">
            <div className="card-head">
              <h2>三、断管演练</h2>
              <div className="head-actions">
                <button onClick={clearPlan} disabled={disabled.size === 0}>
                  清空方案（回到基线）
                </button>
                <button
                  onClick={() =>
                    downloadJson('drill-report.json', buildReport('drill', model, analysis))
                  }
                >
                  导出演练复核报告
                </button>
              </div>
            </div>

            <div className="value-row">
              <ValueBlock
                label="当前最大供水量"
                value={formatInt(analysis.value)}
              />
              <ValueBlock
                label="绝对损失"
                value={formatInt(model.baseline.value - analysis.value)}
              />
              <ValueBlock
                label="相对损失"
                value={formatPercent(
                  relativeLoss(model.baseline.value, analysis.value),
                )}
              />
              <ValueBlock label="已停用管段" value={String(disabled.size)} />
            </div>
            {disabled.size === 0 && (
              <p className="muted">当前为空方案，结果与基线逐项一致。</p>
            )}
            {disabled.size > 0 && (
              <div className="chips">
                {analysis.disabled.map((id) => (
                  <button
                    key={id}
                    className="chip mono"
                    title="点击恢复该管段"
                    onClick={() => toggleArc(id)}
                  >
                    {id} ✕
                  </button>
                ))}
              </div>
            )}

            <h3>当前割项</h3>
            <CutTable cut={analysis.cut} onDisableArc={toggleArc} />

            <SupplyRangeSection
              solved={drillSolved!}
              selectedSink={selectedSink}
              onSelectSink={setSelectedSink}
            />

            <h3>管段清单（勾选停用）</h3>
            <div className="arc-toolbar">
              <input
                type="search"
                placeholder="按 id / 起点 / 终点过滤"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value)
                  setPage(0)
                }}
              />
              <span className="muted">
                命中 {formatInt(filteredArcs.length)} 条 · 第 {safePage + 1} /{' '}
                {pageCount} 页
              </span>
              <button
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
              >
                上一页
              </button>
              <button
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
              >
                下一页
              </button>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>停用</th>
                  <th>ID</th>
                  <th>起点 → 终点</th>
                  <th className="num">容量</th>
                </tr>
              </thead>
              <tbody>
                {pageArcs.map((arc) => (
                  <tr
                    key={arc.id}
                    className={disabled.has(arc.id) ? 'row-disabled' : ''}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={disabled.has(arc.id)}
                        onChange={() => toggleArc(arc.id)}
                      />
                    </td>
                    <td className="mono">{arc.id}</td>
                    <td className="mono">
                      {arc.from} → {arc.to}
                    </td>
                    <td className="num mono">{formatInt(arc.capacity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      <footer className="muted footer">
        计算口径：超级源→供水点（供水能力）、原管段、需求点→超级汇（需求能力）的最大流；
        割项为残量网络中源侧可达集到汇侧的供水点/管段/需求点边，按类别与 id（UTF-16 升序）排列。
      </footer>
    </div>
  )
}
