---
title: 更换Hexo_butterfly主题记录
tags:
  - Git
  - Hexo
categories:
  - Experience
date: 2023-12-09 08:48:02
---

## 更换Hexo butterfly theme记录
### 前言
真正的第一篇 blog，记录更换 Hexo 主题遇到的坑

最近比较忙，只能抽空做一点，结果最后没做完想做的（）

### 更换主题时遇到的问题：

上一个主题使用了 npm 直接部署，更换 butterfly 时使用 git clone ，导致目录比较混乱（告诉我们文件管理不能完全依赖git）

发现用`git clone`是把一个独立的仓库克隆到 Hexo 根目录中，而 Hexo 根目录也是一个仓库，所以就产生了父子关系，即 butterfly 主题仓库成为了主仓库下的一个独立子仓库。父仓库不会对子仓库进行管理，这样违背了用 Git 进行版本控制的初衷

后来发现可以删除 butterfly 项目下的 .git 文件，把 themes/butterfly 变成一个普通的目录，这样就取消了父子仓库关系。但是如果后续主题作者有更新，就不能直接用 git pull 拉取更新，而是需要手动安装，覆盖原来的文件，重新配置主题，不易维护

Git 提供了子模块 submodule 功能，可以避免上面的问题。它允许将一个 Git 仓库作为另一个 Git 仓库的子目录，同时还保持提交的独立

这样做在本地修改和使用主题的时候是没有问题的。但是当把修改提交到 GitHub 时，会导致提交到主题原作者的仓库去

下载主题的正确操作流程如下：
1. 在 GitHub 上，把原作者的主题 fork 到我们自己的仓库中
2. 运行以下命令
```bash
git submodule add https://github.com/<username>/hexo-theme-butterfly themes/butterfly
```

`username`为自己的用户名

在 push 时子模块和主模块需要分开 push，一般先推送子模块，后推送主模块

如果使用的主题仍在被维护，那么我们就能从远程获取更新

```bash
git submodule update --remote
```

在其他设备工作时，与普通的 git clone 相比，只需要加上 --recursive 参数

```bash
git clone --recursive <your repo address>
```

也等价于
```bash
git clone <your repo address>
git submodule update --init
```
删除 submodule
```bash
git submodule deinit <submodule-name>
```
### 暂时搁置功能

本来还想加一个 aplayer 的，认为个人网页有音乐非常重要:）

不过一直没法正常部署，只能暂时搁置到以后再做了（悲）

评论功能以后或许会做，目前有需要的话，可以通过[关于](https://thely314.github.io/about/ "页面上方'关于'分页")页面的邮箱联系我
### 参考文献
> 星空下的YZY - [更换Butterfly主题及其美化记录](https://226yzy.com/2022/010948485.html "'星空下的YZY'的个人网页文章")
> 
> Mr.J - [使用Git Submodule管理Hexo主题](https://dnocm.com/articles/beechnut/hexo-git-submodule/ "'Mr.J'的个人网页文章")
> 
> 某中二的黑科技研究中心 - [在 hexo 中使用 git submodules 管理主题](https://darkreunion.tech/article/manage-hexo-theme-with-git-submodules "'某中二的黑科技研究中心'的个人网页文章")