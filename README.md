# openai-compatible-codebuddy

基于 [CodeBuddy Agent SDK](https://www.codebuddy.ai) (`@tencent-ai/agent-sdk`) 构建的 OpenAI 兼容 API 服务器。

任何使用 OpenAI SDK/API 的客户端只需更改 `base_url` 即可接入 CodeBuddy 提供的大模型服务。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入你的 CODEBUDDY_API_KEY
```

### 3. 启动服务

```bash
npm run dev
```

服务默认监听 `http://0.0.0.0:3000`。

## API 端点

### `POST /v1/chat/completions`

OpenAI 兼容的聊天补全接口，支持流式和非流式。

```bash
# 非流式
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v3.1",
    "messages": [
      {"role": "system", "content": "你是一个有用的助手"},
      {"role": "user", "content": "你好"}
    ]
  }'

# 流式
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v3.1",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'
```

### `GET /v1/models`

返回可用模型列表。

```bash
curl http://localhost:3000/v1/models
```

### `GET /v1/models/:model`

获取单个模型信息。

```bash
curl http://localhost:3000/v1/models/deepseek-v3.1
```

### `GET /health`

健康检查。

```bash
curl http://localhost:3000/health
```

## 使用 OpenAI SDK 接入

### Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="not-needed"  # 认证由服务端的 CODEBUDDY_API_KEY 处理
)

response = client.chat.completions.create(
    model="deepseek-v3.1",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

### TypeScript/JavaScript

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'not-needed',
});

const response = await client.chat.completions.create({
  model: 'deepseek-v3.1',
  messages: [{ role: 'user', content: 'Hello!' }],
});
console.log(response.choices[0].message.content);
```

## 缓存机制

### 双层缓存

1. **SDK 缓存统计透传**：SDK 返回的 `cache_read_input_tokens` 映射到 `usage.prompt_tokens_details.cached_tokens`
2. **Server 端请求级缓存**：相同请求（model + messages 组合）的非流式结果会被缓存

### 缓存配置

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `CACHE_ENABLED` | `true` | 是否启用缓存 |
| `CACHE_TTL_MS` | `300000` | 缓存过期时间（毫秒） |
| `CACHE_MAX_SIZE` | `100` | 最大缓存条目数 |

### 缓存响应头

- `X-Cache: HIT` / `X-Cache: MISS` — 缓存命中/未命中
- `X-Cache-Stats` — 缓存统计信息（命中率等）

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `CODEBUDDY_API_KEY` | 是 | - | CodeBuddy API Key |
| `CODEBUDDY_INTERNET_ENVIRONMENT` | 否 | - | `internal`(中国版) / `ioa`(iOA版) |
| `PORT` | 否 | `3000` | 服务端口 |
| `HOST` | 否 | `0.0.0.0` | 监听地址 |
| `DEFAULT_MODEL` | 否 | `deepseek-v3.1` | 默认模型 |
| `FALLBACK_MODEL` | 否 | `deepseek-v3.1` | 备用模型 |

## 测试

```bash
# LRU 缓存单元测试
npm test

# 集成测试（需先启动服务）
npm run test:integration
```

## 技术栈

- **Hono** — 轻量高性能 Web 框架
- **@tencent-ai/agent-sdk** — CodeBuddy Agent SDK
- **TypeScript** — 类型安全
- **Node.js >= 18.20**
