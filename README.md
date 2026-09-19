# 暴雨断管 · 应急供水韧性评估

纯前端单页应用（React + TypeScript + Vite）：载入供水管网 JSON，核算**基线最大供水量**，
并在残量网络中定位**源侧到汇侧的割项**（瓶颈）；随后可逐项停用管段做断管演练，实时得到
**当前供水量、相对损失与新割项**；清空方案精确回到基线。无任何后端与在线调用，全部计算在浏览器内完成。

## 快速开始

```bash
npm ci                # 安装依赖（需 Node 20+）
npm run dev           # 本地开发（Vite 开发服务器）
npm test              # Vitest 全量测试
npm run build         # 类型检查 + 生产构建（输出 dist/）
npm run verify        # 一次性验收：typecheck + 测试 + 构建
```

### Docker Compose

```bash
WEB_PORT=8080 docker compose up --build web   # 通过 WEB_PORT 发布页面（默认 8080）
docker compose run --rm verify                # 一次性验收服务，结束即退出，退出码即结论
```

`verify` 服务依次执行 `tsc --noEmit`、`vitest run`、`vite build`，任一失败即非零退出。

## 输入契约

输入为一个 JSON 文本，解析后**必须**是仅含以下四个字段的对象（缺一不可、多一不可）：

```json
{
  "nodes":   [{ "id": "n1" }, ...],
  "arcs":    [{ "id": "a1", "from": "n1", "to": "n2", "capacity": 100 }, ...],
  "sources": [{ "node": "n1", "capacity": 100 }, ...],
  "sinks":   [{ "node": "n2", "capacity": 80 }, ...]
}
```

校验规则（任一不满足即判 `INVALID_NETWORK`，页面保留上次模型）：

| 规则 | 说明 |
| --- | --- |
| 顶层结构 | 对象，恰好包含 `nodes` / `arcs` / `sources` / `sinks` 四个数组 |
| 节点 id | 非空字符串，节点间互不重复 |
| 管段 | `id` 非空字符串且管段间互不重复；`from` / `to` 必须指向已声明节点 |
| 供需项 | `node` 必须指向已声明节点；`sources` 内、`sinks` 内各自不重复（同一节点可同时是供水点与需求点） |
| 容量 | 整数，`0 ≤ capacity ≤ 10^12`（管段、供水、需求一致） |
| 容量总和 | 管段 + 供水 + 需求全部容量之和 `≤ 9×10^15`（小于 2^53，保证全程精确整数运算） |
| 规模 | 节点 `≤ 10000`，管段 `≤ 50000` |
| 重边 / 反向边 | 合法；自环合法（对流量无贡献） |

## 计算口径

**建模**：超级源 → 每个供水点（容量 = 供水能力）；原管段（停用管段从当前网络移除）；
每个需求点 → 超级汇（容量 = 需求能力）。最大供水量 = 该网络的最大流（Dinic 算法，
残量用 Float64 存储；因流量总和 ≤ 9×10^15 < 2^53，全程为精确整数）。

**割项**：在最大流残量网络中从超级源遍历，取「源侧可达集 → 汇侧不可达集」的建模边：

- 供水点割项：供水点节点不可达（其供水边饱和），`id` 取节点 id；
- 管段割项：起点可达且终点不可达（该管段饱和；容量 0 的越界管段同样列入，容量记 0），`id` 取管段 id；
- 需求点割项：需求点节点可达（其需求边饱和），`id` 取节点 id。

割项按 **类别（供水点 → 管段 → 需求点）、id 的 UTF-16 编码单元升序** 排列
（即 JavaScript 字符串默认 `<` 比较）。割项容量之和恒等于最大供水量。

**断管演练**：停用集合为空时的核算结果即基线。每停用/恢复一条管段，对当前网络整体重算：
当前值 = 新最大供水量；绝对损失 = 基线 − 当前；相对损失 = 绝对损失 / 基线
（基线为 0 时约定相对损失为 0）。算法与排序完全确定，**清空方案后重算结果与基线逐项相等**。

## 独立复核

基线面板与演练面板各自独立展示，并可分别导出**复核报告 JSON**（自包含，可脱离页面重算验证）：

```json
{
  "report": "baseline | drill",
  "generatedAt": "ISO-8601 时间戳",
  "network": { "nodes": [], "arcs": [], "sources": [], "sinks": [] },
  "disabledArcIds": ["..."],
  "maxSupply": 0,
  "cut": [{ "kind": "source | arc | sink", "id": "...", "capacity": 0, "from": "...", "to": "..." }],
  "loss": 0,
  "relativeLoss": 0
}
```

复核方式：用同一 `network` 与 `disabledArcIds` 按上文「计算口径」重算，
`maxSupply` 与 `cut` 应逐项一致，且割项容量之和等于 `maxSupply`。

## 测试与验收

Vitest 覆盖（`tests/`）：

- `exhaustive.test.ts`：300 个随机小图（多源多汇、零容量、重边、反向边、自环、随机断管）
  **穷举全部割集**，验证 最大供水量 = 最小割容量，割项与「由流量独立重建残量网络」的结果逐项一致，
  并校验流量可行性（容量约束、节点守恒）与割项排序；
- `maxflow.test.ts`：典型结构单测；安全整数上界（总容量恰为 9×10^15，流量 3×10^15 精确核算）；
  **10000 节点 / 50000 管段（含反向边与重边）4 秒内完成**；
- `analyze.test.ts`：断管演练（逐项停用、非瓶颈管段、清空精确回基线）、UTF-16 混合字符集割项排序；
- `validate.test.ts`：全部校验规则的正反用例；
- `loader.test.ts`：非法文件判 `INVALID_NETWORK` 且保留上次模型（引用不变）。

## 目录结构

```
src/
  core/
    types.ts      数据契约（网络 / 割项 / 核算结果）
    validate.ts   JSON 解析与全部校验规则
    maxflow.ts    Dinic 最大流（类型化数组、迭代阻塞流）
    analyze.ts    建模、割项提取与排序、相对损失
    loader.ts     载入状态机（非法输入保留上次模型）
    sample.ts     内置示例网络
    format.ts     整数 / 百分比展示格式化
  App.tsx         单页界面（载入 / 基线 / 演练三个独立面板）
tests/            Vitest 全量测试
Dockerfile        deps → verify / build → web 多阶段
docker-compose.yml  web（WEB_PORT 发布）+ verify（一次性验收）
```
