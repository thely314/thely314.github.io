---
title: Rust tokio 异步使用记录
tags:
  - Rust
  - async
categories:
  - Experience
date: 2025-04-26 22:37:42
---

# Rust tokio 异步使用记录
最近学 Rust tokio 时因为一时疏忽，踩了个坑，同时想起几个月没有更新博客，故作此篇，以便提醒未来的我。

## 基本知识：async/await
### 无栈协程
Rust 异步使用 async/await 模型，基于无栈协程（Stackless Coroutine）实现，可以达到轻量级、零内存分配和高效协作式并发。作为比较，Golang 使用有栈协程实现 goroutine。

什么是无栈协程呢？无栈协程的特点是**无独立调用栈**，每个协程的上下文通过**编译时生成的状态机**保存，不使用独立的栈内存。

`async` 函数会被 Rust 编译器转换为一个实现了 `Future` trait 的结构体，内部使用 enum 记录所有可能的执行状态（如 Start、AfterAwait1、AfterAwait2、Completed 等）。

无栈协程的**状态大小固定**，无需动态分配栈空间，因此可嵌入其他数据结构（如 struct）中；同时状态机的内存布局在编译期确定，可以轻松通过 Rust 编译器检查。

### 异步流程简要解释
Rust 提供多个组件共同实现异步过程，可以分为异步操作接口 `Future` trait、执行器、反应器、Waker。

+ `Future` trait 定义异步操作接口，通过 `poll` 方法暴露执行状态。
```rust
pub trait Future {
    type Output;
    fn poll(self: Pin<&mut Self>, cx: &mut Context) -> Poll<Self::Output>;
}
```
+ 执行器（Executor）驱动 `Future` 的执行，比如 tokio 运行时 `tokio::runtime`。
+ 反应器（Reactor）监听外部事件（如 I/O、定时器），通过 Waker 通知执行器。
+ Waker 在事件就绪时唤醒关联的 `Future`，触发重新轮询。

1.首先通过 `async func` 或 `async {}` 定义异步操作，返回一个实现了 `Future` trait 的类型，`Future` 在创建时不会立即执行，而是等待被驱动(`.await` 或交给执行器)。

2.编译器会将 `async func` 或 `async {}` 转换为一个状态机，每个 `await` 对应一个状态分支（即状态机的一个暂停点），通过 `.await` 或 `spawn` 将 `Future` 提交给执行器。

3.在首次轮询，执行器调用 `Future::poll`，检查其状态：
+ 若 `Future` 直接完成（如缓存命中），返回 `Poll::Ready`。
+ 若需等待（如等待 TCP 连接），返回 `Poll::Pending`，并注册 `Waker`。

4.接下来执行器将任务挂起，将线程控制权交还给异步运行时，转而执行其他就绪的 `Future`。反应器（如 `epoll`）监听外部事件（如 socket 可读），并将 `Waker` 与事件绑定。

5.当事件就绪（如数据到达 socket、定时器到期），反应器调用 `Waker::wake()`，通知执行器重新调度关联的 `Future`。

6.执行器再次调用 `Future::poll`，此时 `Future` 可能完成，最终返回结果。

异步任务只能在 `await` 点让出控制权，任务之间需要主动协作。因此若一个 `Future` 长时间不 `await`，会阻塞线程。

## 踩坑环节
### 主线程不等待
存在 bug 的代码实现逻辑如下：
```rust
let fut = server_stream_handle(rx, writer, reader); // did not call .await
tokio::join!(fut);
```
以上是一个 echo server 客户端的主逻辑的一部分（[具体代码链接](https://github.com/thely314/async_echo_server_demo/blob/master/src/bin/client.rs)），bug 为客户端主进程立即结束，函数 `server_stream_handle` 实现如下：
```rust
pub async fn server_stream_handle(
    mut rx: tokio::sync::mpsc::Receiver<String>, 
    mut writer: OwnedWriteHalf, 
    mut reader: OwnedReadHalf
) -> tokio::task::JoinHandle<Result<(), anyhow::Error>> {
    tokio::spawn(async move {
        /* handle logic */
    })
}
```

主逻辑中对 `server_stream_handle` 的调用未使用 `.await`（即未 `await` 其返回的 `JoinHandle`），`Future` 未绑定到任何运行时任务队列，主进程将不会等待任务完成。当 `main` 主进程退出时，未完成的 `Future` 会被运行时强制丢弃，只有通过 `await` 显式等待的任务才能确保完成（确保主进程等待）。

```rust
let fut = server_stream_handle(rx, writer, reader).await; // #[tokio::main] will wait
tokio::join!(fut);
```
如上，主进程将正常等待所有 `Future` 完成，客户端正常运行。

### Waker 可能的误区
曾经错误认为 `Waker` 知道有哪些 `Future` 存在并等待，但实际上 `Waker` 本身并不直接知道有哪些 `Future` 存在。具体来说，`Waker` 的职责是通知执行器“某个任务需要被重新调度”，而具体是哪个 `Future` 需要被唤醒，则由执行器和异步运行时管理。

当执行器（如 tokio）启动一个异步任务时，会为每个 `Future` 分配一个任务句柄（`Task`），其中包含：
+ `Future` 的状态机（由 `async` 生成）。
+ 一个与任务关联的 `Waker`，内部通过 `Arc` 或类似机制绑定到任务的调度逻辑。

当 `Future` 被轮询（调用 `poll` 方法）时，如果 `Future` 未就绪（返回 `Poll::Pending`），必须将传入的 `Waker`（通过 `Context` 参数）注册到事件源。

> 例如一个异步 I/O 操作（如读取 socket）会将 `Waker` 注册到操作系统的 I/O 多路复用机制（如 `epoll`）。

当事件就绪（如 socket 可读或定时器到期），底层系统（反应器）会调用注册的 `Waker::wake()`，执行器收到唤醒通知后，将对应的任务重新加入调度队列，等待下次轮询。

**TLDR**：`Waker` 不跟踪 `Future`，而是被 `Future` 持有，`Future` 在 `poll` 方法中，将 `Waker` 注册到事件源（如 I/O、定时器）。当事件就绪时，事件源（反应器）调用 `Waker::wake()`，通知执行器重新调度关联的任务。