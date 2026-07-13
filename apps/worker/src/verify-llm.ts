/**
 * SCRATCH — direct LLM adapter smoke test. Calls the REAL provider
 * (aicodewith/gpt5.5 via .env) with mock A-share event data + logs the
 * generated AI 解读 / 深读 / 趋势研判. DELETE before commit (or keep as
 * verify:llm — TBD). No DB/Redis needed (direct adapter call).
 *
 * Run: node --env-file=.env --import tsx/esm apps/worker/src/verify-llm.ts
 */
import { resolveLlmAdapter } from "./llm-adapter-resolver.js";

const adapter = resolveLlmAdapter();
if (adapter === undefined) {
  console.error(
    "✗ LLM env not set. Export LLM_BASE_URL / LLM_API_KEY / LLM_MODEL or use --env-file=.env",
  );
  process.exit(1);
}
console.log("✓ LLM adapter resolved. Calling real provider...\n");

// --- 1. AI 解读 (reason, ≤40字) ---
const reason = await adapter.generateReason({
  hotEventId: "test-reason",
  title: "半导体设备国产化提速：北方华创 Q2 订单超预期",
  summary:
    "北方华创披露 Q2 新签订单同比 +47%，刻蚀/薄膜沉积设备在长江存储、中芯国际产线验证通过率提升。机构测算 2026 年国产设备渗透率有望从 21% 提升至 28%，但高端 ALD 仍依赖进口。",
});
console.log("══════════════════════════════════════════");
console.log("【AI 解读】(reason, ≤40字)");
console.log("══════════════════════════════════════════");
console.log(reason ?? "(null — adapter returned no reason)");
console.log("");

// --- 2. AI 深读 (deepRead, 3 segments × ≤120字) ---
const deepRead = await adapter.generateDeepRead({
  hotEventId: "test-deepread",
  title: "半导体设备国产化提速：北方华创 Q2 订单超预期",
  summary:
    "北方华创披露 Q2 新签订单同比 +47%，刻蚀/薄膜沉积设备在长江存储、中芯国际产线验证通过率提升。",
  evidence: [
    {
      sourceName: "财联社",
      summary: "北方华创 Q2 新签订单同比 +47%，刻蚀/薄膜设备验证通过率提升",
      publishedAt: new Date("2026-07-12T14:38:00Z"),
    },
    {
      sourceName: "证券时报",
      summary: "机构测算 2026 年国产设备渗透率有望从 21% 提升至 28%",
      publishedAt: new Date("2026-07-12T10:00:00Z"),
    },
  ],
});
console.log("══════════════════════════════════════════");
console.log("【AI 深读】(deepRead, 3 segments × ≤120字)");
console.log("══════════════════════════════════════════");
if (deepRead === null) {
  console.log("(null — adapter returned no deep read)");
} else {
  console.log(`影响面：${deepRead.impactSurface}`);
  console.log(`受益方：${deepRead.beneficiaries}`);
  console.log(`风险点：${deepRead.riskPoints}`);
  console.log(`(modelId: ${deepRead.modelId}, promptVersion: ${deepRead.promptVersion})`);
}
console.log("");

// --- 3. AI 趋势研判 (trendBriefing, ≤200字) ---
const trend = await adapter.generateTrendBriefing({
  coverageDate: new Date("2026-07-12T00:00:00Z"),
  events: [
    {
      hotEventId: "test-1",
      title: "半导体设备国产化提速：北方华创 Q2 订单超预期",
      summary: "北方华创 Q2 订单 +47%，国产设备渗透率有望提升至 28%。",
    },
    {
      hotEventId: "test-2",
      title: "央行降准 0.5pct 落地：流动性宽松预期升温",
      summary: "央行全面降准 0.5 个百分点，释放长期资金约 1 万亿元。",
    },
    {
      hotEventId: "test-3",
      title: "创新药出海：百济神州泽布替尼欧洲适应症获批",
      summary: "EMA 批准泽布替尼新增一线 CLL 适应症，海外营收占比提升。",
    },
  ],
});
console.log("══════════════════════════════════════════");
console.log("【AI 趋势研判】(trendBriefing, ≤200字)");
console.log("══════════════════════════════════════════");
if (trend === null) {
  console.log("(null — adapter returned no briefing)");
} else {
  console.log(trend.briefing);
  console.log(`(modelId: ${trend.modelId}, promptVersion: ${trend.promptVersion})`);
}
console.log("");

console.log("══════════════════════════════════════════");
console.log("✓ Done. Real gpt5.5 output above.");
console.log("══════════════════════════════════════════");
