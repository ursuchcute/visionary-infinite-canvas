# Visionary Hosted 画布发布

Hosted 画布与主站使用两个独立 release 软链：

- 主站：`/opt/aiimageoco -> /opt/aiimageoco-releases/<release>`
- 画布：`/opt/v-canvas -> /opt/v-canvas-releases/<release>`

画布发布只上传 `web/dist` 并切换 `/opt/v-canvas`，不会替换或重启主站
PM2 进程。主站的蓝绿发布也不会修改 `/opt/v-canvas`。

代码提交、推送并打版本 tag 后，在 `web/` 目录执行：

```bash
npm run deploy:hosted
```

该命令会依次执行类型检查、Hosted 构建、静态产物安全审计、上传、原子
切换和公网冒烟检查；检查失败会自动切回上一个画布 release。DNS/TLS 尚未
就绪时可先执行 `npm run deploy:hosted -- --stage-only`，就绪后再执行
`npm run deploy:hosted -- --activate <release-name>`。回滚命令为
`npm run deploy:hosted -- --rollback`。

## 首次启用

1. 给 `canvas.visionary.beer` 添加指向生产服务器的 A 记录。
2. 构建 Hosted 产物并上传到唯一的 `/opt/v-canvas-releases/<release>`。
3. 将 `ops/nginx/visionary-canvas-http.conf` 临时安装到
   `/etc/nginx/conf.d/`，执行 `nginx -t` 和 reload 后，用
   `certbot certonly --nginx -d canvas.visionary.beer` 签发证书。
4. 将 `ops/nginx/visionary-canvas-security-headers.conf` 安装到
   `/etc/nginx/snippets/`。
5. 用 `ops/nginx/visionary-canvas.conf` 替换临时配置。
6. 执行 `nginx -t`，验证通过后 reload。
7. 确认静态首页、Canvas API Host 隔离、SSE、图片上传与 CSP 均正常后，
   才在主站生产环境同时打开前后端 Canvas 开关。

Nginx 只把 `/api/canvas/v1/` 代理给主站 upstream。不得在 Canvas 域名代理
其他 `/api` 路由，也不得为 Canvas API 配置 CORS 或 Bearer Token。

## 回滚

回滚只需把 `/opt/v-canvas` 原子切回上一个已验证的画布 release，再 reload
Nginx（仅静态文件变化时通常无需 reload）。回滚画布不需要回滚主站；只有
Canvas 协议版本或主站 Canvas API 同时发生不兼容变化时，才按配套版本一起回滚。
