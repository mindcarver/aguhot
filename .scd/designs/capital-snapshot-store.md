---
managed_by: scd-architecture
status: ready
sources:
  - PRD `.scd/product/prd.md` v1 (资本环境仪表盘, FR-002/FR-003/FR-007/FR-008/FR-010)
  - Architecture `.scd/designs/capital-provider-port.md` (AD-CAP-1/2/3, provider port + FRED publishedAt)
  - NBS publication-date capability investigation (2026-08-01, confirmed: NBS/ECOS/KRX provide no programmatic release timestamp or historical vintages)
---

# Capital snapshot store

## Outcome and boundary

### Problem

资本环境仪表盘的中国(5 维)、韩国(5 维)市场全部显示「未知」,因为 NBS / ECOS / KRX
不像 FRED 那样提供程序化的发布日期(`release/dates`)或历史版本(vintage)。AD-CAP-2
的 `publishedAt` 解析链路(series → release → release/dates)对这些中国/韩国官方来源
不成立——它们的 API 只返回观测期 + 最新修订值,数据库覆盖旧值不留 vintage。

PRD FR-003 与 Source policy 要求每个数据点有**可验证的发布日期**。没有发布日期的数据
按 AD-CAP-2 降级为 `unknown`,这就是仪表盘中国/韩国全「未知」的根因。

### Outcome

引入一个**采集快照基础设施**:按各来源的发布节奏轮询 NBS/ECOS/KRX,在数据首次出现时
**以 AGUHOT 采集时刻作为 `publishedAt`**,并保留原始 payload 作为可审计证据。这样产出的
记录满足 PRD 的点时要求(`publishedAt <= asOf`),通过现有
`appendCapitalProviderObservations` 路径落库,仪表盘读路径不变。

### Boundary

**In:**
- 一个原始快照表(`capital_provider_snapshots`),保留 provider 的原始反序列化 payload + 采集元数据。
- 一个发布节奏配置(cron pattern per provider),驱动按发布日的轮询。
- `publishedAt` = 首次成功采集时刻的语义约定 + 快照证据链。
- NBS / ECOS / KRX 三个 adapter 复用现有 `CapitalProviderPort`,从快照表读取(而非每次实时调外部 API)。
- 快照 → normalized `CapitalDataRecord` 的转换服务,产出带采集时间 `publishedAt` 的记录。

**Out:**
- 不改现有 `capital_environment_records` 表结构和点时读路径(`replayCapitalEnvironmentAt` / `listCapitalDataRecordsAt` 不变)。
- 不改 FRED 路径(FRED 已有权威 `release/dates`,不需要快照存储)。
- 不接入 PBoC / CFETS(资金价格、M2 真实属它们,不是 NBS——首版聚焦 NBS 的 GDP+CPI)。
- 不改现有 A 股 sidecar 路径。
- 不建立实时盘口或分钟级采集。

## Existing context

资本环境模块现有两条数据进入路径:

1. **A 股 sidecar**(`syncAshareCapitalEnvironmentRecords`):Python sidecar 写三张表,Node 读表映射到 `CapitalDataRecord`。`publishedAt` 为 null(`ObservationOnly`),降级为 unknown。
2. **外部 provider**(`CapitalProviderPort`,AD-CAP-1):目前只有 FRED adapter。`publishedAt` 来自 FRED `release/dates`(AD-CAP-2)。worker `market-data-refresh` 每 30 分钟轮询一次。

两条路径都写 `capital_environment_records` 表(append-only,`recordKey` 唯一,revision 追加)。点时读路径 `listCapitalDataRecordsAt` 用 `publishedAt <= asOf`(null 时回退 `asOf`)过滤。

**缺口**(本设计填补):
- 无原始 payload 存储(`EvidenceRecord.raw_payload` 是 RSS 模块的,资本环境没有)。
- 无发布日历表(所有 BullMQ 调度都是固定间隔 `every: ms`,无 cron pattern)。
- NBS/ECOS/KRX adapter 未注册(`capital-provider-resolver.ts:25` 有占位注释)。

## Domain and responsibility changes

### 新增表:`capital_provider_snapshots`(原始快照 + 采集审计)

位置:`packages/core/prisma/schema.prisma`。

```prisma
model CapitalProviderSnapshot {
  id                String   @id
  // provider + 指标身份 + 观测期的组合唯一——同一 provider 观测期的首次采集只存一条。
  snapshotKey       String   @unique @map("snapshot_key")
  providerId        String   @map("provider_id")   // cn-nbs / kr-ecos / kr-krx
  metricKey         String   @map("metric_key")
  market            String
  dimension         String
  observedAt        DateTime @map("observed_at")    // 数据所述观测期
  // AGUHOT 首次成功采集到该观测期的时刻——这是 publishedAt 的来源(见 AD-SNAP-1)。
  firstCapturedAt   DateTime @map("first_captured_at")
  rawPayload        Json     @map("raw_payload")    // provider 原始反序列化响应(审计证据)
  processingVersion String   @map("processing_version")
  traceId           String?  @map("trace_id")
  ingestedAt        DateTime @default(now()) @map("ingested_at")

  @@index([providerId, observedAt])
  @@index([metricKey, firstCapturedAt])
  @@map("capital_provider_snapshots")
}
```

**`snapshotKey` 组成**:`providerId | metricKey | market | dimension | canonical(observedAt) | processingVersion`

**设计依据:**
- 对齐 `EvidenceRecord.raw_payload`(Json 列存原始 payload 的代码库惯例)。
- 对齐 `capital_environment_records` 的 append-only + 应用层组合 key 惯例(不靠 DB 复合约束)。
- `firstCapturedAt` 是单调的——同一观测期只采集一次(首次出现即锁定),后续轮询发现已存在则跳过(idempotent),不更新。这保证 `publishedAt` 反映"首次可得"而非"最后一次轮询"。

### 新增 `publishedAt` 语义决策:AD-SNAP-1

**决策:`publishedAt` = AGUHOT 首次成功采集到该观测期数据的时刻(`firstCapturedAt`)。**

**事实依据:**
1. NBS/ECOS/KRX 不提供程序化发布时间戳(2026-08-01 调研确认),无法获得权威 `publishedAt`。
2. `firstCapturedAt` 是 **AGUHOT 自己产生的时间戳**(轮询 job 的执行时刻),可审计、可复核——满足 PRD Source policy 的"可保存快照、能够记录发布日期"。
3. **方向保守**:`firstCapturedAt >= 真实发布时刻`(轮询必然在数据已发布之后),所以点时回放时该数据出现的时刻**晚于或等于**真实发布,绝不会"提前看到"未发布数据。这满足 FR-003 的安全性要求。
4. 精度代价:回放时数据出现可能比真实发布晚几分钟到几小时(取决于轮询间隔)。对于宏观月度/季度数据,这个代价可接受;产品在证据下钻中显式标注"发布日期 = 采集时间(非官方发布时刻)"以保持诚实。

**与 AD-CAP-2 的关系:** AD-CAP-2 的 `release/dates` 链路是 FRED 专属(权威程序化发布日期)。AD-SNAP-1 是无程序化发布日期来源的降级方案——用可审计的采集时间代替。两者并存:FRED 走 AD-CAP-2,NBS/ECOS/KRX 走 AD-SNAP-1。`CapitalDataRecord.publishedAt` 字段语义不变,只是值的来源不同。

### 不变:`CapitalProviderPort` 接口

现有 `CapitalProviderPort.fetchObservations` 接口不变。NBS/ECOS/KRX adapter 实现该接口,但它们的 `fetchObservations` 从 `capital_provider_snapshots` 表读取(而非实时调外部 API)——外部 API 调用由独立的轮询 job 完成。

### 不变:点时读路径

`replayCapitalEnvironmentAt` / `listCapitalDataRecordsAt` 完全不变。快照存储产出的 normalized record 通过现有 `appendCapitalProviderObservations` 落库,读路径按 `publishedAt <= asOf` 过滤。

## Flow and failure behavior

### 运行时数据流

```
┌─ 轮询 job (新 BullMQ job, cron pattern per provider) ─────────────────┐
│                                                                        │
│  1. capital-snapshot-poll worker 触发(按 provider 的 cron,如         │
│     NBS 月度指标每月中旬日频轮询直到出现)                              │
│                                                                        │
│  2. for each metric in provider's catalog:                             │
│       raw = fetchFromExternalApi(provider, metric, latestPeriod)       │
│       if raw 已有数据且 snapshotKey 不存在:                            │
│         INSERT capital_provider_snapshots (firstCapturedAt = now)      │
│       else: skip (idempotent)                                          │
│                                                                        │
│  3. snapshot-to-record service:                                        │
│       for each new snapshot:                                           │
│         record = normalize(snapshot, publishedAt = snapshot.firstCapturedAt) │
│         appendCapitalProviderObservations(prisma, record, {asOf})      │
│         → 复用 #47 append + 点时校验                                   │
└────────────────────────────────────────────────────────────────────────┘
```

### 调度:AD-SNAP-2(cron pattern per provider)

**决策:每个 provider 用独立的 BullMQ cron `pattern` 调度,而非固定间隔。**

| 来源 | cron pattern(示例) | 理由 |
|---|---|---|
| cn-nbs (GDP 季度) | `0 10 * * *`(每日 10:00,NBS 通常 10:00 发布) | 季度发布日不定,日频轮询直到数据出现,首次出现即锁定 |
| cn-nbs (CPI 月度) | `0 10 * * *` | 同上,月初到中旬发布窗口日频轮询 |
| kr-ecos | `0 10 * * *` | 韩国 BOK 发布时间类似 |
| kr-krx | `0 16 * * 1-5` | 收盘后工作日 |

**首次出现检测:** 轮询时若 `snapshotKey` 已存在 → skip(idempotent)。若 API 返回新观测期数据 → 这就是"首次出现",`firstCapturedAt = now`。若 API 还没发布该期数据(返回空或上一期)→ 不插入,下次轮询继续。

**与现有 `market-data-refresh` 的关系:** 快照轮询是**独立的 BullMQ job**,不嵌入 `market-data-refresh`(后者保持 FRED + A 股路径不变)。两条调度并存。

### 失败与降级

| 情况 | 行为 | 依据 |
|---|---|---|
| 外部 API 网络失败 | 轮询 job 捕获失败,本轮不插入快照,下次 cron 自然重试 | 对齐 sidecar 增量语义 |
| API 返回空(数据未发布) | 不插入,视为"尚未发布",下次轮询 | 首次出现检测 |
| API 返回的数据与上次相同(无新期) | snapshotKey 已存在 → skip | idempotent |
| 原始 payload 格式漂移 | 快照存原始值,normalize 时若映射失败 → 降级 unknown | `evaluateCapitalMetricMapping` |
| 凭据缺失 | resolver 返回 undefined,job 跳过该 provider | 对齐 `digest-adapter-resolver.ts` |

## Shared contract changes

### 本设计不新增跨前端/服务的机器可读契约

`capital_provider_snapshots` 是 core 内部的 Prisma 模型。`CapitalProviderPort` 接口不变。
快照 → record 的 normalize 是 core 内部纯函数,不跨进程。无 OpenAPI/JSON Schema 新增。

### 快照 → record 转换契约

新增 `packages/core/src/modules/capital-environment/snapshot-service.ts`:

```typescript
/**
 * 将原始快照转换为带 publishedAt(=firstCapturedAt)的 ProviderObservationBatch,
 * 供 appendCapitalProviderObservations 落库。publishedAt = firstCapturedAt 是
 * AD-SNAP-1 的可审计降级方案(非官方发布时刻)。
 */
export function snapshotsToProviderBatch(
  snapshots: readonly CapitalProviderSnapshotRow[],
  metricCatalog: CapitalMetricCatalogEntry[],
): ProviderObservationBatch;
```

每个产出的 `ProviderObservation` 的 `publishedAt = snapshot.firstCapturedAt`,
`statusReason` 显式标注 `"publishedAt = AGUHOT 采集时间(非官方发布时刻);原始 payload 见 snapshot"`。

## Data, compatibility, and migration

- **新增一张表** `capital_provider_snapshots`(见上)。一个向前 migration,无破坏性。
- **不改现有表**。`capital_environment_records` 结构、索引、recordKey 组成不变。
- **不改读路径**。`replayCapitalEnvironmentAt` / `listCapitalDataRecordsAt` 不变。
- **FRED 路径不变**。FRED 继续走 AD-CAP-2 的 `release/dates`,不经快照存储。
- **回滚**:删除新表 + 移除轮询 job 即可完全回滚;不影响已有 FRED/A 股数据。

## Security, reliability, and operations

| 关注点 | 决策 |
|---|---|
| 凭据 | NBS 无需 key(公共);ECOS 需_API_KEY(从 worker env);KRX 公共。经 `capital-provider-resolver.ts` 注入 |
| 速率限制 | NBS/ECOS/KRX 各自在 adapter 内置请求间隔;轮询 job 单 slot 串行,无并发 |
| 轮询频率 | cron 日频(发布窗口期);数据出现后 idempotent skip,不会重复请求 |
| 原始 payload 审计 | `rawPayload Json` 保留 provider 原始响应,满足 FR-010 可重复复核 |
| `publishedAt` 诚实标注 | 证据下钻显式区分"采集时间"vs"官方发布",不冒充 |
| 可观测性 | 轮询 job 日志按 provider/metric 维度记录 first-capture / skip / fail |

## Alternatives and decisions

### AD-SNAP-1:publishedAt = 采集时间(已采纳)

见上文"Domain and responsibility changes"。核心权衡:可审计 + 保守(FR-003 安全)但非官方发布时刻。

### AD-SNAP-2:cron pattern 调度(已采纳)

见上文"Flow and failure behavior"。BullMQ 5.x `upsertJobScheduler` 支持 cron `pattern`。

### 被拒绝的替代

| 替代 | 拒绝理由 |
|---|---|
| publishedAt = NBS 发布排期日期 | 排期表是 HTML、"可能调整"、非程序化可验证;排期变了 publishedAt 会错(违背点时) |
| 双字段(采集时间 + 排期参考) | 首版增加复杂度无必要;点时校验仍用采集时间,排期只是参考,留待后续 |
| 把快照逻辑嵌入现有 market-data-refresh | NBS/ECOS/KRX 的发布节奏不同,固定 30min 间隔要么过频(浪费)要么漏采;独立 cron 更贴合 |
| 实时调外部 API(不存快照) | 无法满足"首次出现"检测和审计;且历史回填无快照证据 |
| 改造 capital_environment_records 加 rawPayload 列 | 污染已验收的 normalized 表;快照与 normalized 关注点不同,分表更清晰 |

## Verification

本设计为 `status: draft`,待 readiness review 后升级为 `ready`。就绪性证据:

1. **NBS/ECOS/KRX 发布日期能力已验证(2026-08-01 调研)**:确认它们不提供程序化发布时间戳/vintage,快照存储是点时合规的唯一路径。
2. **快照表模型对齐代码库惯例**:`rawPayload Json` 对齐 `EvidenceRecord.raw_payload`;append-only + 应用层 key 对齐 `capital_environment_records`。
3. **落库路径复用已验收契约**:`appendCapitalProviderObservations` + 点时校验已在 #51/#52 验收。
4. **读路径零改动**:`replayCapitalEnvironmentAt` / `listCapitalDataRecordsAt` 已在 #55/#57/#58 验收。
5. **BullMQ cron pattern 可行**:BullMQ 5.79 的 `upsertJobScheduler` 支持 `pattern`(代码库当前用 `every`,但 API 支持)。

**需要在首个 Delivery Issue 验证的:**
- NBS easyquery.htm endpoint 的真实可达性与字段映射(调研基于文档,需实跑 spike)。
- cron pattern 的真实时区行为(BullMQ pattern 用 UTC 还是 worker 本地时区)。

## Open items

- NBS 2026-03-25 数据门户升级后,`easyquery.htm` 是否仍可用——首个 adapter Issue 的 spike 需验证。
- ECOS / KRX 的具体字段映射和发布日历——各自 adapter Issue 的 in-scope discovery。
- PBoC(M2/社融)/ CFETS(资金价格)是否后续纳入——超出本设计首版(只 NBS GDP+CPI)。
