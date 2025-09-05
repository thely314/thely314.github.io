---
title: CS144 Lab2
tags:
  - network
categories:
  - CS144
date: 2025-08-26 18:01:17
---

# Lab-2
## TCPReceiver
需要实现 `TCPReceiver`，接收传入的 TCP segment 并将其转换成可读的数据流

`TCPReceiver` 将读入的 segment 载荷交给 `StreamReassembler`，还需要告诉发送者**确认号 ackno** 和**接收窗口长度 window_size**
ackno 是第一个未组装的字节索引，是接收者需要的第一个字节的索引。
window_size 是第一个未组装的字节索引和第一个不可接受的字节索引之间的距离。

TCP 接收方可以通过接收窗口进行**流量控制**，限制发送方发送数据的速度。

状态图参考实验文档。

## WrappingInt32
TCP 报文中用来描述**当前数据首字节的索引（序列号 seqno）**是32位类型的，最大表示值为 4GB，存在溢出风险

出于安全性考虑，以及避免与之前的 TCP 报文混淆，TCP 希望让每一个 seqno 难以预测，降低重复的可能性。因此 TCP 使用一个 32 位随机数作为初始序列号 ISN

流中的每个数据字节占用一个序列号，SYN 和 FIN 控制标志也会分别分配一个序列号，SYN 使用的就是 ISN

字节索引类型多样，一般有三种索引：
+ 序列号 seqno。从 ISN 起，包含 SYN 和 FIN，32 位循环计数
+ 绝对序列号 absolute seqno。从 0 起，包含 SYN 和 FIN，64 位非循环计数
+ 流索引 stream index。从 0 起，不包含 SYN 和 FIN，64 位非循环计数。

CS144 使用自定义类型 WrappingInt32 表示序列号，并实现它与绝对序列号之间的转换，注意 WrappingInt32 内部使用的是 u32

```cpp
WrappingInt32 wrap(uint64_t n, WrappingInt32 isn) { return isn + uint32_t(n); }

//! Transform a WrappingInt32 into an "absolute" 64-bit sequence number (zero-indexed)
//! \param n The relative sequence number
//! \param isn The initial sequence number
//! \param checkpoint A recent absolute 64-bit sequence number
//! \returns the 64-bit sequence number that wraps to `n` and is closest to `checkpoint`
//!
//! \note Each of the two streams of the TCP connection has its own ISN. One stream
//! runs from the local TCPSender to the remote TCPReceiver and has one ISN,
//! and the other stream runs from the remote TCPSender to the local TCPReceiver and
//! has a different ISN.
uint64_t unwrap(WrappingInt32 n, WrappingInt32 isn, uint64_t checkpoint) {
    uint64_t u64_left = 0, u64_right = 0;
    // 计算基础偏移
    if(n - isn < 0) {
        // u32 已经循环
        // 得到绝对序列号的低32位
        u64_right = uint64_t(n - isn + (1l << 32));
    } else {
        u64_right = uint64_t(n - isn);
    }
    if(u64_right >= checkpoint) {
        // 其他候选值都会更大，目前最接近
        return u64_right;
    }
    // 将 u64_right 的高32位设置为与检查点的高32位相同，低32位保持不变（即基础偏移）
    u64_right |= ((checkpoint >> 32) << 32);
    // 寻找第一个大于 checkpoint 的候选值
    while(u64_right <= checkpoint) {
        u64_right += (1ll << 32);
    }
    // 小于或等于 checkpoint 的最后一个候选值
    u64_left = u64_right - (1ll << 32);
    // 选择距离 checkpoint 最近的
    return (checkpoint - u64_left < u64_right - checkpoint) ? u64_left : u64_right;
}
```

## 实现
主要需要实现 `segment_received`、`ackno` 和 `window_size` 方法。
```cpp
class TCPReceiver {
    //! Our data structure for re-assembling bytes.
    StreamReassembler _reassembler;

    //! The maximum number of bytes we'll store.
    size_t _capacity;

    //! Flag to indicate whether the first SYN message has received
    bool _synReceived;

    //! Flag to indicate whether FIN mesaage has received
    bool _finReceived;

    //! Inital Squence Number
    WrappingInt32 _isn;

  public:
    //! \brief Construct a TCP receiver
    //!
    //! \param capacity the maximum number of bytes that the receiver will
    //!                 store in its buffers at any give time.
    TCPReceiver(const size_t capacity)
        : _reassembler(capacity), _capacity(capacity), _synReceived(false), _finReceived(false), _isn(0) {}

    //! \name Accessors to provide feedback to the remote TCPSender
    //!@{

    //! \brief The ackno that should be sent to the peer
    //! \returns empty if no SYN has been received
    //!
    //! This is the beginning of the receiver's window, or in other words, the sequence number
    //! of the first byte in the stream that the receiver hasn't received.
    std::optional<WrappingInt32> ackno() const;

    //! \brief The window size that should be sent to the peer
    //!
    //! Operationally: the capacity minus the number of bytes that the
    //! TCPReceiver is holding in its byte stream (those that have been
    //! reassembled, but not consumed).
    //!
    //! Formally: the difference between (a) the sequence number of
    //! the first byte that falls after the window (and will not be
    //! accepted by the receiver) and (b) the sequence number of the
    //! beginning of the window (the ackno).
    size_t window_size() const;
    //!@}

    //! \brief number of bytes stored but not yet reassembled
    size_t unassembled_bytes() const { return _reassembler.unassembled_bytes(); }

    //! \brief handle an inbound segment
    void segment_received(const TCPSegment &seg);

    //! \name "Output" interface for the reader
    //!@{
    ByteStream &stream_out() { return _reassembler.stream_out(); }
    const ByteStream &stream_out() const { return _reassembler.stream_out(); }
    //!@}
};
```

具体实现如下：
```cpp
void TCPReceiver::segment_received(const TCPSegment &seg) {
    const TCPHeader head = seg.header();
    if(!head.syn && ! _synReceived) {
        return;
    }

    string data = seg.payload().copy();
    bool eof = false;
    // 首次收到 SYN
    if(head.syn && !_synReceived) {
        _synReceived = true;
        _isn = head.seqno;
        if(head.fin) {
            _finReceived = true;
            eof = true;
        }
        _reassembler.push_substring(data, 0, eof);
        return;
    }
    // FIN received
    if(_synReceived && head.fin) {
        _finReceived = true;
        eof = true;
    }
    // u32->u64
    // 选择期望的下一个序列号作为 checkpoint
    uint64_t checkpoint = _reassembler.ack_index();
    uint64_t abs_seqno = unwrap(head.seqno, _isn, checkpoint);
    uint64_t stream_idx = abs_seqno - (_synReceived ? 1 : 0);
    _reassembler.push_substring(data, stream_idx, eof);
}

optional<WrappingInt32> TCPReceiver::ackno() const {
    if(!_synReceived) {
        // 连接未建立
        return {};
    }
    return wrap(_reassembler.ack_index() + 1 + (_reassembler.empty() && _finReceived), _isn);
}

size_t TCPReceiver::window_size() const {
    return _capacity - _reassembler.stream_out().buffer_size();
}
```