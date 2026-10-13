# ui-env-report

生成前端组件问题所需的环境报告，方便附在 Issue 或复现说明中。支持 Markdown 和 JSON，使用 Node.js 内置模块，无外部依赖。

## 使用

需要 **Node.js 18 或更新版本**。下载或克隆代码后，在本仓库目录运行：

```sh
node bin/ui-env-report.js
node bin/ui-env-report.js /path/to/your-project
node bin/ui-env-report.js /path/to/your-project --json
node bin/ui-env-report.js /path/to/your-project --package @rc-component/image --package @rc-component/trigger
```

省略项目目录时检查当前工作目录；默认输出 Markdown。`--package` 可重复使用，用于补充需要检查的包。

```sh
node bin/ui-env-report.js --help
node bin/ui-env-report.js --version
```

## 报告内容

- 实际运行此工具的 Node.js 版本、操作系统与 CPU 架构。
- 目标项目的名称、`packageManager` 声明，以及根目录中检测到的锁文件名称。
- 常见框架、组件库及额外指定包的声明版本范围和实际安装版本。

**声明版本不等于安装版本。** 例如，`package.json` 中的 `^6.6.0` 是允许的版本范围；只有读取已安装包的 `package.json` 才能确认具体版本。缺少 `node_modules` 或未找到某个包时，报告会标明安装版本缺失，不会把声明值当作已安装版本。

`packageManager` 仅来自项目声明，不代表本机正在使用该版本。锁文件名称也不会用于推断实际安装版本。系统信息描述的是运行工具的机器，不包含浏览器版本或浏览器复现结果。

## 读取范围

工具读取目标项目的 `package.json`、已安装包的 `package.json`，并检查根目录中的锁文件名称。它不读取 `.env`、`.npmrc` 或 Git remotes，不执行项目脚本或包管理器，也不发起网络请求。

URL 和本地文件形式的依赖来源会省略，避免将其中的凭据或本地路径放入报告。分享前仍请检查项目名称和包名是否适合公开。

## 测试

在本仓库目录运行：

```sh
npm test
```

## 许可证

[MIT](LICENSE)，Copyright © 2026 SweetDianDian。
