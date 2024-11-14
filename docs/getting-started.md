---
标题：入门
---

#####这个入门指南只是一个旨在让您快速建立的过程的摘要！完整的过程包含在用户指南中，可以从顶部栏的链接访问。

##先决条件

测试版保护目前支持铬和边缘和_应该_研究其他Chrome衍生物（比如Vivaldi）。对于本指南，我们假设使用Chrome浏览器。

首先，确保你有一个审查后端运行的地方。这通常是[截尾](https://silveredgold.github.io/beta-censoring/)（默认）或Beta安全。

##下载

_详情请参阅[安装指南](./guide/installation.md)_

从[GitHub版本](https://github.com/silveredgold/beta-protection/releases)页。你应该下载**beta-protection.crx**文件，_不_ZIP文件。打开下载CRX文件的文件夹，以备稍后使用。

##安装

_详情请参阅[安装指南](./guide/installation.md)_

打开Extensions屏幕（从Manage Extensions菜单），并确保已切换开发人员模式**在**将上一步下载的CRX文件拖放到“扩展”窗口中。Chrome应该提示您安装测试版保护，所以接受提示和测试版保护应该出现在您的扩展列表中！

>您的浏览器是否拒绝加载带有愤怒信息的扩展插件[安装指南](./guide/installation.md)我该怎么做。

##使用

_详情请参阅[使用指南](./guide/usage.md)_

您现在应该在Chrome extensions窗口中看到测试版保护扩展。

单击工具栏中的图标打开弹出窗口并检查扩展。屏幕顶部将显示连接状态。如果这显示*有关的*您连接到后端，可以跳过下一步！

###后端配置

如果它没有说连接，你需要告诉Beta保护在哪里找到你的后端。打开弹出窗口右上角的按钮，下拉后台主机，并输入审查服务器的地址*保存并重新连接*然后*复查*从连接状态窗口检查扩展可以找到您的后端。

### Start Browsing

Beta Protection will default to "on demand" mode that will only enable sites you either _ask_ to be censored (with the context menu) or sites that are in your Forced list (you can add sites to the list from the extension options). You can set the extension to Enabled mode from the popup to default to censoring all pages.

For more information on all the other features like [overrides](./guide/overrides.md), [placeholders](./guide/usage.md#placeholders) or [local censoring](./guide/usage.md#local-censoring), check the full [Usage section of the User Guide](./guide/usage.md).
