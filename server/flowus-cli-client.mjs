import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import { FlowusClient } from "./flowus-client.mjs";
import { dataDir, error } from "./storage.mjs";

const execute = promisify(execFile);
let queue = Promise.resolve();
const serial = (fn) => {
  const job = queue.then(fn);
  queue = job.catch(() => {});
  return job;
};
export const cliEnabled = () => process.env.FLOWUS_AUTH_MODE === "cli";
export const cliConfigured = () =>
  cliEnabled() &&
  !!process.env.FLOWUS_CLI_PATH &&
  !!process.env.FLOWUS_CONFIG_DIR &&
  !!process.env.FLOWUS_WORKSPACE_ID;

function failure(code) {
  return error(
    502,
    {
      unauthorized: "FlowUs 浏览器授权失效，请在服务器重新登录后重试。",
      forbidden: "FlowUs 拒绝读取，请核对空间权益和页面授权范围。",
      object_not_found: "FlowUs 页面不可访问，请核对页面 ID 和授权。",
      ENOENT: "服务器未找到 FlowUs CLI，请检查安装路径。",
    }[code] || "FlowUs 读取未完成，请检查服务器授权后重试。",
  );
}

// The official CLI owns OAuth storage and renewal. The website never reads,
// copies or returns its tokens, and exposes only a fixed set of read operations.
export class FlowusCliClient extends FlowusClient {
  constructor({
    executable = process.env.FLOWUS_CLI_PATH,
    configDir = process.env.FLOWUS_CONFIG_DIR,
    workspaceId = process.env.FLOWUS_WORKSPACE_ID,
    runner = execute,
    requestDir = path.join(dataDir, "flowus-requests"),
  } = {}) {
    super("");
    this.executable = executable;
    this.configDir = configDir;
    this.workspaceId = workspaceId;
    this.runner = runner;
    this.requestDir = requestDir;
    this.identity = null;
  }
  async invoke(route, body) {
    if (
      !this.executable ||
      !path.isAbsolute(this.executable) ||
      !this.configDir ||
      !path.isAbsolute(this.configDir) ||
      !/^[a-f0-9-]{36}$/.test(this.workspaceId || "")
    )
      throw error(400, "请在服务器配置 FlowUs CLI、授权目录和目标空间。");
    return serial(async () => {
      const url = new URL("https://api.flowus.cn/v2" + route);
      const args = [
        "--json",
        "--no-retry",
        "api",
        "call",
        body ? "POST" : "GET",
        url.pathname,
      ];
      for (const [key, value] of url.searchParams)
        args.push("--param", key + "=" + value);
      let temporary, bodyFile;
      try {
        if (body) {
          await mkdir(this.requestDir, { recursive: true });
          temporary = await mkdtemp(path.join(this.requestDir, "query-"));
          bodyFile = path.join(temporary, "body.json");
          await writeFile(bodyFile, JSON.stringify(body), { mode: 0o600 });
          args.push("--body", bodyFile);
        }
        const env = {
          ...process.env,
          FLOWUS_CONFIG_DIR: this.configDir,
          FLOWUS_BASE_URL: "https://api.flowus.cn",
        };
        delete env.FLOWUS_TOKEN;
        let stdout;
        try {
          ({ stdout } = await this.runner(this.executable, args, {
            env,
            windowsHide: true,
            shell: false,
            encoding: "utf8",
            timeout: 60000,
            maxBuffer: 2 * 1024 * 1024,
          }));
        } catch (e) {
          let code = e.code;
          try {
            code = JSON.parse(e.stdout).error?.code || code;
          } catch {}
          throw failure(code);
        }
        let result;
        try {
          result = JSON.parse(stdout);
        } catch {
          throw failure();
        }
        if (!result.ok || !result.data || typeof result.data !== "object")
          throw failure(result.error?.code);
        return result.data;
      } finally {
        if (bodyFile) await unlink(bodyFile).catch(() => {});
        if (temporary) await rmdir(temporary).catch(() => {});
      }
    });
  }
  async call(route, body) {
    const read =
      /^\/(users\/me|pages\/[a-f0-9-]{36}(?:\/content\/markdown)?|blocks\/[a-f0-9-]{36}\/children(?:\?(?:page_size|start_cursor)=[^#]*)?|databases\/[a-f0-9-]{36})$/;
    const query = /^\/databases\/[a-f0-9-]{36}\/query$/;
    if (!(body ? query.test(route) : read.test(route)))
      throw error(400, "不支持的 FlowUs 读取请求。");
    this.identity ||= this.invoke("/users/me").then((identity) => {
      if (identity.workspace_id !== this.workspaceId)
        throw error(403, "FlowUs 当前登录空间与网站配置不一致，已停止同步。");
      return identity;
    });
    const identity = await this.identity;
    return route === "/users/me" ? identity : this.invoke(route, body);
  }
}

export const configuredFlowusClient = (token) =>
  cliEnabled() ? new FlowusCliClient() : new FlowusClient(token);
