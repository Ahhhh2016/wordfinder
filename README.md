# GitHub Models Backend

一个最小可用的本地后端，用来把前端请求转发到 GitHub Models。

## 1. 配置环境变量

复制 `.env.example` 为 `.env`，然后填入你的 GitHub Token：

```bash
cp .env.example .env
```

`GITHUB_TOKEN` 需要具备 GitHub Models 访问权限。

## 2. 启动服务

```bash
npm run start
```

默认会监听 `http://localhost:3000`。

## 3. 接口说明

### 健康检查

```bash
curl http://localhost:3000/api/health
```

### 聊天接口

你可以传 `prompt`：

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What is the capital of France?"
  }'
```

也可以直接传完整的 `messages`：

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-5-mini",
    "messages": [
      { "role": "system", "content": "You are a helpful assistant." },
      { "role": "user", "content": "What is the capital of France?" }
    ]
  }'
```

返回示例：

```json
{
  "model": "openai/gpt-5-mini",
  "content": "Paris",
  "raw": {}
}
```
