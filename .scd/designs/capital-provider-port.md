---
managed_by: scd-architecture
status: ready
sources:
  - GitHub Issue #40 (Initiative: 资本环境仪表盘, graph revision 5, node `capital-provider-architecture`)
  - GitHub Issue #43 (source field catalog, Planned FRED/NBS/ECOS/KRX mappings)
  - GitHub Issue #47 (CapitalDataRecord persistence + ashare-observation-service)
  - AD-7 (_bmad-output/planning-artifacts/architecture/architecture-aguhot-2026-07-09/ARCHITECTURE-SPINE.md:93-97)
---

# Capital environment provider port

## Existing context

资本环境模块（`packages/core/src/modules/capital-environment/`）目前只有一条数据进入
路径：`syncAshareCapitalEnvironmentRecords`（`ashare-observation-service.ts:338`）
直接 Prisma 读取 Python sidecar 写入的三张表（`index_daily_bars`、
`sector_daily_bars`、`market_breadth_daily`，见 `:371-390`），再经
`mapAshareObservation`（`ashare-observation-adapter.ts:65`）映射到
`CapitalDataRecord`（`types.ts:118-133`）。该函数 **不接收任何 adapter/port
参数**——sidecar 表名与 provider 身份（`ASHARE_SIDECAR_MAPPINGS`，`:52-89`）硬编码
在领域服务内部。

`#43` 的指标目录（`metric-catalog.ts`）已登记 FRED（`us-fred`，系列 `GDPC1`/
`CPIAUCSL`/`WALCL`/`DFF`/`BAMLH0A0HYM2`）、NBS（`cn-nbs`）、ECOS（`kr-ecos`）、
KRX（`kr-krx`）四个外部官方来源，但 **全部为 `Planned`**——只有候选字段名，
没有 adapter，也没有验证过的发布日期/历史版本能力。`source-baseline.ts` 同样把
这四个来源标为 `Planned`，附注 "No AGUHOT adapter is wired in this delivery."

四个外部适配器（`us-fred`/`cn-nbs`/`kr-ecos`/`kr-krx`）共用同一个尚未存在的
provider port。本设计界定该 port、其部署模型、worker 接线方式，以及 FRED 的
`published_at` 解析策略。

## Domain and responsibility changes

### 新增 port：`CapitalProviderPort`

位置：`packages/core/src/modules/capital-environment/provider-port.ts`，从模块
barrel `index.ts` 导出。命名独立于现有 `ashare-observation-adapter.ts`（后者是
纯映射函数，不是 port）。

```typescript
/**
 * Capital environment external-provider port (AD-7).
 *
 * 每个 provider（FRED/NBS/ECOS/KRX/未来的官方基金披露）实现此接口。领域模块
 * 与 worker 不直接 import 第三方 SDK；切换/新增 provider 只发生在 adapter 层
 * 和 worker 装配层。
 *
 * Port 返回的是已反序列化、领域归一化的观察集合——不是 wire format，不是
 * SDK 响应对象。每个 ProviderObservation 必须携带可验证的 publishedAt 或
 * 明确的降级状态；port 调用方（service）据此构建 CapitalDataRecord。
 */
export interface CapitalProviderPort {
  readonly providerId: string;
  fetchObservations(
    request: CapitalProviderRequest,
  ): Promise<ProviderObservationBatch>;
}

export interface CapitalProviderRequest {
  /** 想要覆盖的观察日期区间（含）。provider 可返回超出范围的数据以支持回填。 */
  readonly observedFrom: string;
  readonly observedTo: string;
  /** 调用方的 trace，透传到 provider 日志/指标。 */
  readonly traceId: string;
}

export interface ProviderObservationBatch {
  readonly providerId: string;
  readonly observations: readonly ProviderObservation[];
  /** provider 级整体状态：部分失败时仍返回已成功的 observations，并在此说明。 */
  readonly availability: CapitalAvailability;
  readonly statusReason: string | null;
}

export interface ProviderObservation {
  /** 对齐 #43 目录的 metricKey，例如 "us.growth.gdp_real_yoy"。 */
  readonly metricKey: string;
  readonly market: CapitalMarket;
  readonly dimension: CapitalDimension;
  readonly value: number | null;
  readonly unit: string | null;
  readonly observedAt: string;
  /**
   * 数据对用户公开的日期/时间。必须满足 publishedAt <= asOf（service 侧校验）。
   * provider 无法验证发布日期时设为 null——service 会据此输出 unknown/partial
   * 降级记录，绝不把 observedAt 或抓取时间冒充发布日期。
   */
  readonly publishedAt: string | null;
  /** 本条记录的来源（id/name/dataset/documentationUrl）。 */
  readonly source: CapitalSourceReference;
  /** provider 自报的处理版本，用于 revision 追加。 */
  readonly processingVersion: string;
  readonly availability: CapitalAvailability;
  readonly statusReason: string | null;
  readonly revision: number;
}
```

**设计依据：**

- **单方法 port，返回值携带降级状态**——对齐 `MarketDataAdapter.fetchSnapshot`
  返回 `Promise<MarketDataSnapshot | null>` 的诚实降级惯例
  （`market-reaction/types.ts:172-181`）。但 provider 需要批量返回多指标，故返回
  `ProviderObservationBatch` 而非单值；部分失败时 `availability=partial` 仍返回
  已成功的 observations（对齐 `ashare-observation-service.ts:352-370` 的
  `readSource` per-source 隔离：一个来源失败不阻塞其他来源）。
- **返回领域归一化类型，不是 wire format**——对齐 `SourceAdapter.fetch()` 返回
  `EvidenceItem`（`source-ingest/types.ts:41-56`）而非 RSS XML；对齐
  `AshareObservationInput`（`ashare-observation-adapter.ts:14-34`）已是反序列化
  形态。SDK 的 HTTP/JSON/XML 细节被 adapter 吞掉。
- **`publishedAt: string | null`**——这是整个设计的核心约束。`null` 不是错误，
  是合法的"无法验证发布日期"信号，下游据此降级而非伪造。这直接实现 PRD FR-008
  与 #41/#47 的点时契约。

### 不变：`mapAshareObservation` 的角色

`mapAshareObservation`（纯映射函数）保持不变。A 股 sidecar 路径不强制改造为
`CapitalProviderPort`——它已经是"内部表 → 记录"的稳定映射，改造它无独立价值
且违反"不为一个端点重写架构"。未来若要让 A 股路径也走 port，可新增一个
`AshareSidecarProvider implements CapitalProviderPort` 包裹现有读取，但这是可选
的、非本设计要求的演进。

`CapitalProviderPort` 的产出（`ProviderObservation`）经由一个新的轻量 service
函数 `appendCapitalProviderObservations(prisma, batch, { asOf, traceId })` 落库，
该函数复用 #47 已有的 `appendCapitalDataRecord`（幂等、冲突拒绝）和点时校验
（`point-in-time.ts`），不新建持久化模型。

### 部署模型决策：进程内 Node 适配器（AD-CAP-1）

**决策：四个外部 provider 都是进程内 Node HTTP 适配器，不新增 Python sidecar。**

| 选项 | 结论 | 理由 |
|---|---|---|
| A1 进程内 Node adapter | **采纳** | FRED/NBS/ECOS/KRX 都是标准 REST + JSON/XML 数值接口，不拖入重型 binary 或 SDK。对齐 `RssAdapter`（轻量 HTTP 源在 Node 内）和 `OpenAiCompatibleDigestAdapter`（HTTP API 在 worker 内直接调）。 |
| A2 Python sidecar | 拒绝 | AD-7 把 sidecar 限定为"行情历史序列"（指数/行业日线）的采集器，因为 AkShare 拖入 Python 数据生态。资本环境的宏观/官方统计 API 是无状态 HTTP，没有等价的生态捆绑。新增 sidecar 会徒增第三个运行时的运维成本，无架构收益。 |

代码库自身的放置惯例（`headless-agent-targets-adapter.ts:1-10` 注释）已给出明
确判据：**只有当 adapter 拖入会污染 web 构建（web imports `@aguhot/core`）的
重型依赖时，才必须放 `apps/worker`**。FRED 等 REST adapter 用标准 `fetch`，无此
风险，但仍放在 worker 以遵守 AD-7"领域模块不直接 import 第三方 SDK"——port 在
core，具体 adapter 在 worker。

## Flow and failure behavior

### 运行时数据流

```
BullMQ job (apps/worker/src/market-data-refresh.ts)
  │
  ├─ resolveCapitalProviders(env) → CapitalProviderPort[]  [adapter-resolver]
  │      每个 provider 从 env 读取凭据，缺凭据返回 undefined（诚实降级）
  │
  ├─ for each provider:
  │    batch = provider.fetchObservations({ observedFrom, observedTo, traceId })
  │      └─ adapter 内部：调外部 REST API → 反序列化 → 解析 publishedAt → 组装 ProviderObservation[]
  │
  └─ appendCapitalProviderObservations(prisma, batch, { asOf, traceId })
         └─ 复用 #47 appendCapitalDataRecord：幂等 upsert on recordKey，冲突拒绝
            点时校验：publishedAt > asOf 的记录拒绝入库或标 pending_review
```

### 失败与降级

| 情况 | 行为 | 依据 |
|---|---|---|
| provider 凭据缺失 | resolver 返回 `undefined`，job 跳过该 provider，不报错 | `digest-adapter-resolver.ts` 惯例 |
| provider 网络失败 | adapter 捕获，返回 `batch.availability=failed`，`observations=[]`，`statusReason` 记录原因；service 写一条 `failed` 记录保留可审计痕迹 | `ashare-observation-service.ts:352-370` `readSource` per-source 隔离 |
| provider 返回部分指标 | `availability=partial`，已成功 observations 正常入库，缺失项标 `unknown` | PRD FR-008，#47 A4 |
| `publishedAt` 无法验证 | 该 observation 的 `publishedAt=null`，service 输出 `unknown` 记录（非值状态，不携带 value） | `CapitalDataRecord` 契约 L281-286 |
| `publishedAt > asOf` | service 拒绝入库或标 `pending_review`（点时违规） | #47 点时契约，PRD FR-003 |
| 指标字段漂移 | adapter 自报的 mapping 经 `evaluateCapitalMetricMapping` 校验，漂移 → `pending_review` | `metric-catalog.ts:876-897`（#43 已建） |

## Shared contract changes

### 本设计不新增跨前端/服务的机器可读契约

`CapitalProviderPort` 是 **core 内部模块边界**的 TypeScript 接口，不是跨进程
API。按 `interface-contract.md` 的 TypeScript module boundary 形式（"exported
types plus runtime schema"），其规范契约就是 `provider-port.ts` 中的导出接口 +
`types.ts` 已有的 `validateCapitalDataRecord`/`assertCapitalDataRecord` 运行时
校验。不创建 OpenAPI/JSON Schema——没有第二个进程消费这个接口。

### `CapitalProviderPort` 实现可校验性

每个 adapter 实现必须：
1. 在 `providerId` 上对齐 #43 目录的 `sourceId`（`us-fred`/`cn-nbs`/`kr-ecos`/
   `kr-krx`），使 `metric-catalog.ts` 的映射能匹配。
2. 产出的每个 `ProviderObservation` 能通过 `validateCapitalDataRecord`（service
   组装为 `CapitalDataRecord` 后）——这是 adapter 的验收接缝，不是可选的。
3. `publishedAt` 非 null 时必须是 ISO-8601 且 `<= asOf`；为 null 时
   `availability` 必须是非值状态。

## Data, compatibility, and migration

- **无 schema 变更。** `CapitalProviderPort` 的产出落库到 #47 已建立的
  `capital_environment_records` 表（`schema.prisma:1226-1257`），复用其 append-only、
  `recordKey` 唯一、revision 追加语义。
- **无破坏性迁移。** A 股 sidecar 路径（`syncAshareCapitalEnvironmentRecords`）
  保持不变，与新的 provider 路径并存。两条路径写同一张表，由 `recordKey`（含
  source identity）天然区分，不冲突。
- **#43 目录状态推进。** 当某个 adapter（如 FRED）通过独立验收证明其 `publishedAt`
  解析真实有效后，`metric-catalog.ts` 中对应条目的 `catalogStatus` 才可从
  `Planned` 推进到 `Confirmed`。adapter Issue 的验收必须包含这一推进证据；未验收
  前目录状态不变，避免提前宣称覆盖。

## Security, reliability, and operations

| 关注点 | 决策 |
|---|---|
| 凭据 | 各 provider 的 API key 从 worker env 读取（`FRED_API_KEY` / `ECOS_API_KEY` 等），经 `*-adapter-resolver.ts` 注入。key 不进 core，不进 git，不复用 `.env`（仅本地）。`.env.example` 记录所需变量名。 |
| 速率限制 | FRED 限 120 req/min。adapter 内置请求间隔或令牌桶；BullMQ job 的并发度保持现有单 slot。NBS/ECOS/KRX 的限速在各自 adapter Issue 里按实测设定。 |
| 超时与重试 | 单 provider 请求超时 30s（对齐现有 sidecar SIGTERM 超时量级）。失败不重试入库——返回 `failed` 记录，下一个 job 周期自然重试（对齐 sidecar 增量语义）。 |
| 网络出口 | worker 进程直接出站到 FRED/NBS/ECOS/KRX 的公网 API。无需新增 sidecar 进程或代理。 |
| 可观测性 | 每个 batch 携带 `providerId`/`availability`/`statusReason`，service 返回 `{ inserted, unchanged, failed }`（对齐 `syncAshareCapitalEnvironmentRecords` 的返回形态），worker 日志按 provider 维度记录。 |
| 审计 | `CapitalDataRecord.source`（`CapitalSourceReference`）完整保留 provider id/name/dataset/documentationUrl，满足 PRD FR-002/FR-010 的可追溯要求。 |

## Alternatives and decisions

### AD-CAP-1：进程内 Node adapter（已采纳）

见上文"部署模型决策"。判据来自 `headless-agent-targets-adapter.ts:1-10` 的代码库
自文档：重型 binary/SDK → worker；轻量 HTTP → 也可 worker，但 port 在 core。
资本环境官方统计 API 属于后者。

### AD-CAP-2：FRED `publishedAt` 解析策略（已采纳）

**决策：`publishedAt` 通过 `series/release → release/dates` 两步解析获得；禁止
用 `realtime_start`/`realtime_end` 作为 `publishedAt`。**

**事实依据（已验证）：**

1. FRED observation 的 `realtime_start`/`realtime_end` 是 **vintage 边界**——
   文档定义为 "data as it existed on these specified dates in history"，即 FRED
   数据库里某个 vintage 被记录的日期，**不是数据对公众发布的日期**。用它当
   `publishedAt` 会违反 PRD FR-003 的点时语义。
2. FRED `release/dates` endpoint 返回 `{release_id, date}`，其中 `date` 是
   **数据源公布的发布日期**（scheduled/historical publication date）——这正是
   `CapitalDataRecord.publishedAt` 所需的"数据对用户公开的日期"。
3. series → release 的关联经 `series/release` endpoint 获得（给定 `series_id`
   返回其所属 `release_id`）。

**解析链路：**

```
series_id (如 GDPC1)
  → GET /series/release?series_id=GDPC1  →  release_id (如 53)
  → GET /release/dates?release_id=53      →  date (如 "2026-07-27")
  → publishedAt = "2026-07-27T00:00:00Z"  (该发布日对应的 UTC 开始)
```

**降级规则：** 若 `series/release` 返回多个 release，或 `release/dates` 缺少
对应 observation 日期的条目，adapter 必须将该 observation 的 `publishedAt` 设为
`null` 并标记 `availability=unknown`，**不得回退到 `realtime_start`**。这条规则
使 FRED adapter 的点时合规性可被独立验收（adapter Issue 的 A 条件之一）。

**缓存：** `series/release` 的映射和 `release/dates` 列表在 adapter 内按发布周期
缓存（FRED 发布日历变化低频），避免每次 observation 都发两个辅助请求。

### AD-CAP-3：单方法批量 port（已采纳）

`fetchObservations(request) → ProviderObservationBatch`（而非每指标一次调用）。
理由：宏观统计 API 通常一次返回多系列（如 FRED 一个 release 含多个指标），批量
返回减少往返，且让 provider 在单次 batch 内表达"部分成功"。

### 被拒绝的替代

| 替代 | 拒绝理由 |
|---|---|
| 每个 provider 独立定义自己的 fetch 接口 | 违反 AD-7 统一端口目标；worker 装配层要为每个 provider 写不同胶水；与 `MarketDataAdapter`/`SourceAdapter` 惯例不符 |
| port 返回 `CapitalDataRecord` 而非 `ProviderObservation` | 让 provider 承担点时校验责任，违反"port 只做获取+反序列化，service 做校验+落库"的分层；`CapitalDataRecord` 需要 `id`/`asOf`/`recordKey` 等持久化字段，不属于 provider 关心范围 |
| 把 A 股 sidecar 强制改造为 port | 无独立验收价值，增加返工，违反"演进时保留既有基线"（architecture-contract.md baseline-and-evolution） |

## Verification

本设计为 `status: ready` 的架构设计，其就绪性证据：

1. **port 形态对齐已验证惯例** —— 与 `MarketDataAdapter`、`SourceAdapter`、
   `DigestAdapter` 三个现有 AD-7 port 的代码逐行对照（见上文设计依据），形态一致。
2. **FRED `publishedAt` 解析链路经 API 文档验证** —— `release/dates` 返回发布
   `date`（非 vintage），`series/release` 提供 series→release 关联，链路完整可行。
3. **持久化复用已验收契约** —— 落库路径复用 #47 的 `appendCapitalDataRecord` +
   `point-in-time.ts`，无新 schema，#47 的 A1–A6 验收已覆盖这些路径。
4. **降级语义对齐已验收契约** —— `publishedAt=null` → 非值状态，与
   `CapitalDataRecord` 校验（`types.ts:281-286`）和 #47 A4 一致。

**不需要的技术 spike：** FRED REST 是标准 JSON API，`series/release` +
`release/dates` 的可行性已由官方文档确认，无需写一次性 spike 验证。adapter 的
实际 HTTP 调用、限速、缓存实现属于 `scd-quickdev` 在 `capital-provider-architecture`
Delivery Issue 内的职责，不属于本架构设计。

**未验证、留给后续 adapter Issue 的事实：** NBS/ECOS/KRX 各自是否提供等价于
FRED `release/dates` 的发布日历 endpoint，需在各自 adapter Issue 的 discovery
阶段验证；无法验证时该 provider 的 `publishedAt` 保持 `null`（降级），不阻塞
整体架构。

## Open items

- 无影响本设计边界的 open item。`capital-provider-architecture` 节点可回到
  `scd-project` 物化为 Delivery Issue，其验收接缝已由本设计的 port 定义、
  AD-CAP-1/AD-CAP-2/AD-CAP-3 决策、以及 FRED 解析降级规则界定。
- 各 provider adapter Issue（`us-fred`/`cn-nbs`/`kr-ecos`/`kr-krx`）的发布日期
  能力核验属于各自 Issue 的 in-scope discovery，不在架构层预先结论。
