---
title: mini Game From Lone(End)
tags:
  - CTF
categories:
  - mini game
date: 2024-11-19 22:29:43
---

# mini Game From Lone(End) 已结束
## intro
### EN:

~~Driven by the idea of CTF~~ Thinking it was interesting, I decided to design three beginner-friendly puzzles as a mini game.(Actually, there are also ideas to publicize my blog)

the flag you need to collect has the fromat of `cdkPartN{XXX}`, N means number `1-3`, but the content of `cdkPartN{XXX}` are not the real cdkey.

Please submit all flags and solutions at once (via email: p478a0bb9ea88@qq.com, or via private chats). If you encounter problems, please also contact me through the above methods.

The first person to submit all flags and solutions will be awarded. Tips will be updated on this page if needed.

The reward will be a `Steam game within the price range of 100(be pending)` or `KFC V50 for you`

### 中文:

站长~~打CTF打的~~出于“觉得有意思所以就做了试试”的想法，设计了三个新手相对友好的问题，打算弄个小游戏(其实也有宣传我的博客的想法)

你需要收集的flag的格式为`cdkPartN{XXX}`，N表示数字`1-3`，但是 `cdkPartN{XXX}` 的内容不是真正的cdkey

请一次提交所有flag和解题方法(通过邮箱p478a0bb9ea88@qq.com，也接受私聊)。遇到问题时同样通过上述方式联系我

第一个提交所有flag和解题方法的人将获得奖励。如有需要，本页将更新提示。

奖励将会是`价位100以内的steam游戏(待定)`或`KFC V你50`

## 结束

有效解题时间已经结束，虽然参加的人不多，但只要我的想法，能给乐于探索的人带来一点乐趣，那便是极好的

正式题解发布在每个puzzle下方，可供参考

没有人最终自行解决了所有谜题（收集所有flag），但还是感谢大家的参与。下面是正确联系我且解出题目的名单

### puzzle 1
*暂无解决者*
### puzzle 2
Jdwiwd
### puzzle 3
苍月

## puzzle 1

**A basic string with clear meaning(?) guides you to find the treasure image:**

**意义明确的基础字符串(?)，引导你找到藏宝图片:**

bG9uZWNoYW4uc3BhY2UvaW1nL2hlcmUucG5n

> tips1: 一层base64
> tips2: The file structure of PNG files(PNG文件结构)

**题解：**<br/>
字符串为base64编码，解出`lonechan.space/img/here.png`

访问发现是一个损坏的图片（大部分浏览器无法正确显示）

下载到本地，发现部分程序可以查看图片，内容为黑色向下箭头，猜测图片文件结构被修改<br/>
即使没有猜测到，搜索引擎搜索`图片`, `隐写`等可以找到相关资料

使用十六进制编辑器可以发现尾随文本`tip: the width and height are same`，或者简单将文件后缀改为`.txt`也能发现

再结合图片内容的箭头，猜测图片高度被截短（不熟悉png文件结构可以搜索）

1. （手动挡）可使用十六进制编辑器，将IHDR（文件头数据块）高度部分字节`0000 0258`向宽度部分字节`0000 03E8`对齐

![](/img/here_solution.png)

2. （自动挡）每个数据块的最后4字节都有CRC（循环冗余检测）用来检测是否有错误和被篡改，可使用python计算crc，爆破算出图片原高度
```python
import zlib
import struct
import sys

filename = sys.argv[1]
with open("/path/to/here.png", 'rb') as f:
    all_b = f.read()
    crc32key = int(all_b[29:33].hex(),16)
    data = bytearray(all_b[12:29])
    n = 4095
    for w in range(n): 
        width = bytearray(struct.pack('>i', w))
        for h in range(n):
            height = bytearray(struct.pack('>i', h))
            for x in range(4):
                data[x+4] = width[x]
                data[x+8] = height[x]
            crc32result = zlib.crc32(data)
            if crc32result == crc32key:
                print("weight",end="")
                print(width)
                print("height",end="")
                print(height)
                exit(0)
```
得到flag `cdkPart1{DE3P_sEek_!mG}`
> 代码懒得写所以是借鉴的，参考文献 https://www.cnblogs.com/chtxrt/p/17279614.html

## puzzle 2

**A string with unclear meaning but distinct features, containing AES:**

**意义不明确但有明显特征的字符串，内含AES:**

ZTk2ZTAwNTQ1YmUwMjQ1ZjM2NzEzYTNmZTcyNGViNDc0ODJjMzhlMDBkNTY2OGFjODA2NGU4MzU3MTJiMDNhNTwhLS0gdGhlIE5FWFQgQUVTIGtleSBpcyBteSBmYXZvcml0ZSB3YWlmdSdzIGVuZ2xpc2ggbmFtZShhbGwgaW4gbG93ZXJjYXNlKSBhZnRlciBBRVMgZW5jcnlwdCwgdGhlIEFFUyBrZXkgYW5kIEFFUyBJViBib3RoIGFyZSBteSBmYXZvcml0ZSB3YWlmdSdzIGVuZ2xpc2ggbmFtZSBhZnRlciBNRDUgLS0+

> tips1: CBC mode; when using IV, take the first 16 bytes(CBC模式；用到IV时取前16 bytes)
> tips2: Take a look at my blog and discover my preferences(看看我的博客，发现我的偏好)

**题解：**<br/>
看到加号`+`可以试试base64，得到`e96e00545be0245f36713a3fe724eb47482c38e00d5668ac8064e835712b03a5<!-- the NEXT AES key is my favorite waifu's english name(all in lowercase) after AES encrypt, the AES key and AES IV both are my favorite waifu's english name after MD5 -->`

信息可能看起来比较乱，但是一般的翻译服务都可以得到正确的中文表述

`my favorite waifu`从我的博客可以找到（就是这个网站），所有顶图都有一个红发女性人物（本文章更新于2024/12/2），从个别图片可以提取关键词`SURTR`, `Arknights`，某篇关于梦的文章出现了相同人物，可以找到关键称呼`42`，搜索引擎确认为`surtr`（也可以直接交给google image识图）

![](/img/miniGame-surtr-md5.png)

AES 模式，key 与 IV 可以多次尝试确定，推荐一个手动挡工具: https://cyberchef.org/

注意 key 与 IV 选择 utf8 编码，自动挡（python等）因为是 bytes 类型处理反而不怎么注意这一点，得到flag `cdkPart2{FuNkv_cRyPt0}`图解如下

![](/img/miniGame-surtr-AES.png)
![](/img/miniGame-solution.png)

## puzzle 3

**DO SOME EASY JOB AND FELLOW ME ON gITHUB, YOU WiLL GEt THE AWARDS SOON**

**你需要阅读英文题面**
> tips1: Is there some strange commits on my Github profile repository?(我的Github个人主页配置仓库中是否有一些奇怪的commits？)
> tips2: how can i see the history of git?(我怎样才能看到git的历史？)

**题解：**<br/>
在我的 github 个人主页配置仓库（即 github 用户名仓库），最新的 commit 为一个压缩包，如果使用过 github 能认出就是这个仓库的下载压缩包，猜测为关键点

下载发现里面是完整 git 仓库，`git reflog`可以发现有一次 commit `9c23a70` 被 revert，尝试`checkout <commit_hash> -- <file_path>`或使用`revert`撤销这次`revert`，即可发现一份`.md`文件被还原，从中得到flag
```bash
git reflog

f96cab9 HEAD@{0}: revert: Revert "copied content of README.md"
9c23a70 (HEAD -> main) HEAD@{1}: commit: copied content of README.md
388d9c6 (origin/main, origin/HEAD) HEAD@{2}: clone: from github.com:thely314/thely314.git
# 解法1
git checkout 9c23a70 -- .
# 解法2
git revert f96cab9
```
得到flag `cdkPart3{M43Ter_0f_g!T}`
> 本题灵感来源为 中科大2023年hackergame: https://github.com/USTC-Hackergame/hackergame2023-writeups/blob/master/official/Git%20Git!/README.md