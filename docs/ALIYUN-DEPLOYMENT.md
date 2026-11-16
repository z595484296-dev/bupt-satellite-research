# 阿里云部署与代码更新

该仓库的 `main` 分支连接阿里云服务器。提交到 `main` 后，GitHub Actions 会安装依赖、运行网站和 Sites 测试、构建前端，再通过专用 SSH 部署密钥发布。PR 只测试和构建，不发布。也可以在 Actions 的 **Test and deploy to Aliyun** 中手动运行主分支。

本次迁移保留已有页面设计。临时访问地址为 `http://47.93.3.125/`；`satnetresearch.cn` 的域名绑定和 HTTPS 另行配置。

## 内容与源码分开维护

- `src/`、`public/`、`server/`：代码和页面资源，走 GitHub 自动部署。
- `/var/lib/satellite-center/data`：服务器上的文章、图片、附件、管理员密码摘要和留言。部署包不会包含或覆盖这个目录。
- `/var/lib/satellite-center/flowus`：服务器私有 FlowUs CLI 授权目录，不进入仓库或构建包。
- `/etc/satellite-center/website.env`：服务器私有环境配置，不进入仓库。

FlowUs 每 5 分钟检查一次。观点库仍按“状态 = 研究中心”发布，动态库按“版块包含中心动态”发布（该字段此前名为“类型”）。保留既有自动发布规则。请勿同时在本机和服务器运行同一生产授权的同步进程；开发时使用独立测试数据和授权。

## 服务器运行结构

- Ubuntu 24.04，Node 22.23.5，FlowUs CLI 0.3.14。
- Nginx 监听 80；Node 仅监听 `127.0.0.1:3000`，不对公网开放应用端口。
- `satellite-center.service` 负责开机自启、故障重启和单进程运行。
- `/opt/satellite-center/releases/` 保存版本，`current` 指向正在运行的版本。
- GitHub 部署成功后检查首页和内容 API；启动失败会切回上一版本。`/deploy-version.json` 提供已部署的提交号。
- 后台在临时公网 HTTP 入口受限。通过 SSH 隧道访问本机回环地址；配置 HTTPS 后再开放正式后台入口并启用 `COOKIE_SECURE=true`。

GitHub 使用独立 `satellite-deploy` 账号，SSH 密钥只能读取公开静态资源的校验摘要和发送指定发布命令，不能打开交互 shell、做端口转发或直接读取业务数据。发布时只上传变化的静态文件，未变化的资源从上一版本复制，并逐一校验 SHA-256。接收脚本限制包大小、文件路径和文件类型。服务器只允许此账号通过固定脚本切换网站版本。

Actions 所需仓库 Secrets：`ALIYUN_HOST`、`ALIYUN_DEPLOY_KEY`、`ALIYUN_KNOWN_HOSTS`。私钥和主机指纹通过 Secrets 配置；不要把服务器密码、FlowUs 授权或 `.env` 写入仓库。

## 常用维护

以下命令在服务器上执行：

```sh
systemctl status satellite-center nginx
journalctl -u satellite-center -n 100 --no-pager
systemctl list-timers satellite-center-backup.timer
readlink -f /opt/satellite-center/current
curl --fail http://127.0.0.1:3000/api/content >/dev/null
```

每日北京时间 03:20 附近生成私有备份，保存于 `/var/backups/satellite-center`，保留约 14 天。备份包括业务数据和私有配置；这属于同机恢复备份，不能替代异地备份。首次迁移包也保存在服务器 root 私有目录。恢复业务数据时应先停止网站，恢复后确认属主为 `satellite-center`，避免两个进程同时写同一数据目录。

`deploy/aliyun/` 内的 systemd、Nginx 和部署脚本是服务器运维配置。普通 CI 发布只更新应用；更改这些运维配置需要由服务器管理员单独审核和安装。

## 原 Sites 网站

这条 Actions 工作流只部署阿里云，不发布 Sites 的前端版本。原 Sites 镜像是独立托管环境。迁移时其旧授权返回 HTTP 403，当前仍保留上次成功的内容快照；需要恢复镜像时再更新其授权。
