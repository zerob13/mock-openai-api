# 部署指南 / Deployment Guide

*[English](#english) | [中文](#中文)*

## 中文

### Docker Hub 自动部署

此项目已配置 GitHub Actions，会自动构建并推送 Docker 镜像到 Docker Hub。

#### 触发条件
- 推送到 `main` 或 `master` 分支
- 创建新的版本标签 (`v*`)
- 提交 Pull Request（仅构建，不推送）

#### 镜像标签策略
- `latest` - 默认分支的滚动构建
- `1.0.6` - 具体版本号
- `1.0` - 主要版本号
- `1` - 大版本号

### 使用预构建镜像

Docker Hub仓库：https://hub.docker.com/r/zerob13/mock-openai-api

```bash
# 拉取 1.0.6
docker pull zerob13/mock-openai-api:1.0.6

# 运行容器
docker run -d -p 3000:3000 --name mock-openai-api zerob13/mock-openai-api:1.0.6

# 检查健康状态
curl http://localhost:3000/health
```

### Docker Compose 部署

1. 下载 `docker-compose.yml` 文件
2. 根据需要修改环境变量
3. 启动服务：

```bash
ADMIN_TOKEN=change-this-token docker compose up -d
```

### Web 管理后台

镜像已经包含 Recorder、Replay playlist、Scenario Editor、API Test 和 Settings。Admin 在容器内默认只监听 loopback；需要从宿主机访问时，必须显式监听容器网卡并配置 token：

```bash
docker run -d \
  -p 3000:3000 \
  -p 127.0.0.1:3001:3001 \
  -e ADMIN_HOST=0.0.0.0 \
  -e ADMIN_TOKEN=change-this-token \
  -v mock-openai-data:/data \
  zerob13/mock-openai-api:1.0.6
```

浏览器打开 `http://127.0.0.1:3001`。`/data` 保存录制、场景与运行配置；API key 不会写入磁盘。

### 生产环境部署建议

#### 1. 使用具体版本标签
```bash
docker run -d -p 3000:3000 zerob13/mock-openai-api:1.0.6
```

#### 2. 配置反向代理（Nginx）
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 支持 Server-Sent Events
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding off;
    }
}
```

#### 3. 设置资源限制
```bash
docker run -d \
  --name mock-openai-api \
  --restart unless-stopped \
  --memory="256m" \
  --cpus="0.5" \
  -p 3000:3000 \
  zerob13/mock-openai-api:1.0.6
```

### 环境变量配置

| 变量名     | 描述         | 默认值       |
| ---------- | ------------ | ------------ |
| `NODE_ENV` | Node.js 环境 | `production` |
| `PORT`     | 服务端口     | `3000`       |
| `HOST`     | 绑定地址     | `0.0.0.0`    |
| `ADMIN_PORT` | 管理后台端口 | `3001` |
| `ADMIN_HOST` | 管理后台监听地址 | `127.0.0.1` |
| `ADMIN_TOKEN` | 非 loopback 管理后台的 Bearer token | 空 |
| `DATA_DIR` | 录制与场景目录 | `/data` |
| `VERBOSE`  | 详细日志     | `false`      |
| `TZ`       | 时区设置     | `UTC`        |

---

## English

### Automatic Docker Hub Deployment

This project is configured with GitHub Actions to automatically build and push Docker images to Docker Hub.

#### Trigger Conditions
- Push to `main` or `master` branch
- Create new version tags (`v*`)
- Submit Pull Request (build only, no push)

#### Image Tagging Strategy
- `latest` - Rolling default-branch build
- `1.0.6` - Specific version number
- `1.0` - Major version number
- `1` - Major version number

### Using Pre-built Images

Docker Hub Repository: https://hub.docker.com/r/zerob13/mock-openai-api

```bash
# Pull 1.0.6
docker pull zerob13/mock-openai-api:1.0.6

# Run container
docker run -d -p 3000:3000 --name mock-openai-api zerob13/mock-openai-api:1.0.6

# Check health status
curl http://localhost:3000/health
```

### Docker Compose Deployment

1. Download the `docker-compose.yml` file
2. Modify environment variables as needed
3. Start services:

```bash
ADMIN_TOKEN=change-this-token docker compose up -d
```

### Web Admin

The image includes Recorder, Replay playlist, Scenario Editor, API Test, and Settings. Admin listens on container loopback by default. To reach it from the host, explicitly bind it to the container network and set a token:

```bash
docker run -d \
  -p 3000:3000 \
  -p 127.0.0.1:3001:3001 \
  -e ADMIN_HOST=0.0.0.0 \
  -e ADMIN_TOKEN=change-this-token \
  -v mock-openai-data:/data \
  zerob13/mock-openai-api:1.0.6
```

Open `http://127.0.0.1:3001`. `/data` stores recordings, scenarios, and runtime configuration; API keys are never persisted.

### Production Deployment Recommendations

#### 1. Use Specific Version Tags
```bash
docker run -d -p 3000:3000 zerob13/mock-openai-api:1.0.6
```

#### 2. Configure Reverse Proxy (Nginx)
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Support Server-Sent Events
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding off;
    }
}
```

#### 3. Set Resource Limits
```bash
docker run -d \
  --name mock-openai-api \
  --restart unless-stopped \
  --memory="256m" \
  --cpus="0.5" \
  -p 3000:3000 \
  zerob13/mock-openai-api:1.0.6
```

### Environment Variables

| Variable   | Description         | Default      |
| ---------- | ------------------- | ------------ |
| `NODE_ENV` | Node.js environment | `production` |
| `PORT`     | Server port         | `3000`       |
| `HOST`     | Bind address        | `0.0.0.0`    |
| `ADMIN_PORT` | Admin UI port | `3001` |
| `ADMIN_HOST` | Admin listener | `127.0.0.1` |
| `ADMIN_TOKEN` | Bearer token for non-loopback Admin | Empty |
| `DATA_DIR` | Capture and scenario directory | `/data` |
| `VERBOSE`  | Verbose logging     | `false`      |
| `TZ`       | Timezone setting    | `UTC`        |
