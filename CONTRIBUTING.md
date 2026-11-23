# 贡献说明

1. 使用 Node.js 22，在 Windows 上运行 `npm ci`。
2. 使用虚构资料复现问题；不要提交数据库、备份、真实 Excel、客户或公司信息。
3. 修改数据逻辑时，为失败回滚和关键边界增加回归测试。
4. 提交前运行 `npm run check:public`、`npm test`、`npm run test:electron`。
5. Pull request 说明触发场景、修改后的行为、验证结果及已知限制。

项目使用 GitHub Issues 跟踪功能和一般问题。涉及敏感信息或漏洞时，按 `SECURITY.md` 处理。
