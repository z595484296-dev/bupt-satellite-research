## 将已发布内容同步到 Sites

阿里云继续每 5 分钟从 FlowUs 读取符合发布条件的内容。GitHub Actions 的 `Sync public content to Sites` 使用专用只读 SSH 密钥，从同一个公开接口读取正文、图片和附件，每小时第 7、22、37、52 分钟尝试同步。GitHub 排队可能延迟执行。在 Actions 页面也可以手动运行。任务保持 Sites 原有的文章地址和站内阅读体验。

### 审核合并后的启用步骤

1. 在管理员电脑为同步任务单独生成一对 Ed25519 密钥。把公钥保存到服务器上的 `/root/sites-reader.pub`。保留现有的代码部署密钥供发布流程使用。
2. 在阿里云服务器上从已审核版本安装仓库中的 `deploy/aliyun/sites-public-export.mjs`，创建专用账号并绑定上一步的公钥。以下命令由管理员运行。导出程序使用系统现有的 Node 22，通过回环地址读取网站公开的内容，只允许取回当前公开内容引用的媒体。

   ```bash
   # 在已审核的仓库副本根目录运行
   id satellite-reader >/dev/null 2>&1 || useradd --system --create-home --shell /bin/sh satellite-reader
   install -d -m 0755 -o root -g root /usr/local/libexec
   install -m 0644 -o root -g root deploy/aliyun/sites-public-export.mjs /usr/local/libexec/satellite-sites-public-export.mjs
   reader_dir=$(getent passwd satellite-reader | cut -d: -f6)
   install -d -m 0755 -o root -g root "$reader_dir/.ssh"
   # 首次配置专用账号，authorized_keys 应为空。后续轮换只替换对应公钥。
   test ! -s "$reader_dir/.ssh/authorized_keys" && printf 'restrict,command="/usr/local/bin/node /usr/local/libexec/satellite-sites-public-export.mjs" %s\n' "$(cat /root/sites-reader.pub)" > "$reader_dir/.ssh/authorized_keys"
   chmod 0644 "$reader_dir/.ssh/authorized_keys"
   ```

3. 在 GitHub 的 **Settings → Environments** 创建 `sites-mirror`，部署分支限定为 `main`。在这个环境下新增 `SITES_READ_KEY`（配对私钥）和 `SITES_SYNC_TOKEN`（现有 Sites 同步令牌，沿用原同步接口的权限）。工作流复用仓库已有的 `ALIYUN_HOST`、`ALIYUN_KNOWN_HOSTS`。FlowUs 授权由阿里云保管。
4. 切换前在服务器的 `/etc/satellite-center/website.env` 中设置 `SITES_CONTENT_PUSH_ENABLED=false` 并重启 `satellite-center`。这样公开内容只有一个推送方；既有的留言回收仍由服务器负责。该设置默认开启原来的直接推送。然后在 GitHub 仓库的 Actions **Variables**（仓库级）将 `SITES_MIRROR_ENABLED` 设为 `true`。预设关闭，合并 PR 本身不会启动定时发布。
5. 在 **Actions → Sync public content to Sites → Run workflow** 选择 `main`。成功日志给出版本、公开条数、媒体数和本次上传数。打开 Sites 的一篇动态检查正文和图片。暂停时先将 `SITES_MIRROR_ENABLED` 改为 `false` 并等待进行中的任务结束。只有确认服务器能访问 Sites 后，才恢复原来的直接推送。

任务先校验文件清单，只传缺少或变化的媒体，确认来源版本和文件状态后才提交。撤回公开的条目随下一份快照下线。单次失败保留上一份已提交的内容，可在 Actions 查看失败步骤并重试。若 FlowUs 授权失效，应先在阿里云恢复授权；镜像只反映阿里云已发布的内容。
