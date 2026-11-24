# 构建空白独立使用版

默认演示构建包含虚构商品和客户，适合查看源码和试用。独立使用版初始客户、商品、订单、库存及发货单位为空，使用独立应用名称和标识；各台电脑的数据相互独立，没有自动同步。

## Windows 构建

先在仓库根目录完成 `npm ci`。下列脚本生成独立的源代码暂存目录，清空其中的初始化样例及发货单位，保留原演示源码。暂存目录通过 Windows junction 复用依赖，仅用于本机构建，不应转发。

```powershell
node scripts/prepare-independent-release.cjs
$stagePath = Get-Content -LiteralPath 'release/independent-stage-path.txt' -Raw
Push-Location -LiteralPath $stagePath
try { npm run electron:build } finally { Pop-Location }
```

安装包和目录版输出到 `release/independent-v<版本号>/`。对外分发安装包即可，无需发送源码、依赖目录或任何数据库。当前构建未进行代码签名。

独立版标识为 `io.github.zhangyn1203.business-workbench`，包名为 `business-workbench`。后续升级须保持标识和包名一致；更换电脑前先通过软件备份业务数据。

## 验证空白初始化和主要流程

在仓库根目录执行（以 1.4.0 为例）：

```powershell
$env:ORDER_PRINT_PACKAGED_RESOURCES = (Resolve-Path -LiteralPath 'release/independent-v1.4.0/win-unpacked/resources').Path
npx electron tests/independent-install.cjs
npx electron tests/electron-smoke.cjs
Remove-Item Env:ORDER_PRINT_PACKAGED_RESOURCES
```

两个测试都使用隔离的临时用户目录，不会在实际用户目录安装或覆盖数据。首次测试检查空白数据、发货单位和应用包名，完整流程测试覆盖开单、库存、备份恢复、系统切换及 PDF 打印输出。它们不能替代另一台电脑上的安装与实体打印试用。
