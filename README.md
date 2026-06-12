# MarketWatch

本项目是一个盯大盘和个股的本地 MVP。当前目标是先把“看盘、加自选、设置提醒、接收异动事件”跑通；最终目标是接入 Agent，让 Agent 在明确授权、风控约束和人工确认边界内辅助自动交易。

> 当前版本不包含实盘交易能力，也不提供投资建议。任何自动下单能力都必须先完成券商 API、账户授权、风控、审计和人工确认机制。

## 当前能力

- 自选股和指数盯盘。
- 东方财富行情接口接入。
- 行情源缺失或不可用时，自动使用演示数据占位，并在页面顶部提示。
- 支持提醒规则：
  - 价格上破
  - 价格下破
  - 涨幅超过
  - 跌幅超过
  - 涨速超过
  - 成交额超过
- 通过 SSE 推送行情刷新和提醒事件。
- 本地保存自选列表和提醒规则。
- 纸面交易账户：支持订单草稿、模拟成交、拒单、持仓和现金更新。
- 硬风控基础版：自动执行默认关闭、紧急停止、单笔金额限制、单标的持仓数量限制、黑名单、非交易时段拦截开关。
- Agent 工具权限表：只读允许、订单草稿需确认、直接执行订单禁止。
- 交易审计日志：记录订单草稿和纸面订单执行结果。
- 浏览器桌面通知授权后，可弹出提醒通知。

## 运行方式

```bash
cd /Users/moon/Work/Workspace/VibeCoding/Coding/MarketWatch
npm start
```

打开：

```text
http://localhost:4177
```

运行测试：

```bash
npm test
```

## 项目结构

```text
MarketWatch/
  data/state.json              本地自选和提醒规则
  src/server/index.js          HTTP API、静态文件服务、SSE 推送
  src/server/market-data.js    行情源接入、代码标准化、演示数据兜底
  src/server/rules.js          提醒规则引擎
  src/server/trading.js        纸面交易订单模型和账户更新
  src/server/risk-controls.js  交易风控硬规则
  src/server/agent-tools.js    Agent 工具权限表
  src/server/audit-log.js      审计日志追加逻辑
  src/server/store.js          JSON 本地存储
  src/public/                  前端页面
  test/                        Node test 单元测试
```

## API

- `GET /api/state`：获取自选、规则、规则类型、当前行情。
- `GET /api/quotes`：获取当前行情。
- `POST /api/watchlist`：添加自选。
- `DELETE /api/watchlist/:symbol`：移除自选，并删除该标的关联规则。
- `POST /api/rules`：添加提醒规则。
- `DELETE /api/rules/:id`：删除提醒规则。
- `GET /api/events`：SSE 事件流。
- `GET /api/trading/account`：获取纸面账户、持仓、订单、审计日志。
- `POST /api/trading/order-drafts`：创建候选订单草稿，默认用于 Agent 建议。
- `POST /api/trading/orders`：执行纸面订单。`source=AGENT` 时必须传 `confirm=true`。
- `GET /api/trading/risk-controls`：查看当前风控配置。
- `PATCH /api/trading/risk-controls`：更新风控配置。
- `POST /api/trading/kill-switch`：开启或关闭紧急停止。
- `GET /api/agent/tools`：查看 Agent 工具权限表。

## 自动交易目标架构

最终不要让 Agent 直接碰券商账户。应拆成四层：

```text
行情/账户数据 -> 策略和风控引擎 -> Agent 决策辅助 -> 交易执行网关
                         |              |
                         |              +-- 只生成建议、解释、候选订单
                         +-- 硬性拦截：仓位、金额、频率、黑名单、交易时段
```

建议边界：

- 确定性代码负责行情、规则、仓位、风控和下单前校验。
- Agent 负责自然语言交互、策略解释、复盘、候选订单生成。
- 实盘订单默认需要人工确认。
- 只有在纸面交易和长时间回测通过后，才允许配置小额度自动执行。
- 所有 Agent 输入、输出、风控结果、下单请求、券商回报都必须审计留痕。

## 下一步

未完成内容见 [TODO.md](./TODO.md)。
