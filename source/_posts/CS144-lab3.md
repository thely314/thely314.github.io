---
title: CS144 Lab3
tags:
  - network
categories:
  - CS144
date: 2025-08-27 17:26:30
---

# Lab-3
## TCPSender
`TCPSender` 负责从 `ByteStream` 读取数据，以 TCP 报文的形式发送，处理 `TCPReceiver` 传入的 `ackno` 和 `window_size`，以及处理重传。

状态图参考实验文档。

## 重传判断
TCP 使用超时重传机制，需要追踪每个已发送报文（已被发送但还未被接收）的发送时间，如果某些已发送报文太久没有被接收方确认（即接收方接收到对应的 ackno），则该数据包必须重传。

需要注意的是，接收方返回的 ackno 不一定对应着发送方返回的 seqno（且与 seqno 不存在数学关系），因为发送的数据可能会因为内存问题，被接收方截断。

`TCPSender` 的 tick 函数会被不定时调用，其参数声明了距离上一次调用过去的时间，是 `TCPSender` 唯一能调用的超时时间相关函数。因为直接调用系统提供的 clock 或者 time 将会导致测试不可用。

TCPSender 在构造时会被给予一个**重传超时时间 RTO** 的初始值。RTO 是在重新发送未完成确认的 TCP segment 之前需要等待的毫秒数。RTO值将会随着时间的流逝（或者更应该说是网络环境的变化）而变化，但初始的 RTO 将始终不变。

需要为 `TCPSender` 实现一个重传计时器，如果重传计时器超时，进行以下操作：
+ 重传尚未被 TCP 接收方完全确认的最早报文（即最低 ackno 所对应的报文）。这需要我们将发送中的报文数据保存至一个新的数据结构中，以追踪正处于发送状态的数据。
+ 如果接收者的 window_size 不为 0，即可以正常接收数据，则：
  + 跟踪连续重传次数。过多的重传次数可能意味着网络的中断，需要立即停止重传。
  + 将 RTO 的值设置为先前的两倍，以降低重传速度，避免加剧网络环境的拥堵。
  + 重置并重启重传计时器。

当接收者给发送者一个确认成功接收新数据的 ack 包时（absolute ack seqno 比之前接收到的 ackno 更大）：
+ 将 RTO 设置为初始值。
+ 如果发送方存在尚未完成的数据，则重新启动重传计时器。
+ 将连续重传计数清零。

若接收方的 window_size 为 0，则发送方将按照接收方 window_size 为 1 的情况进行处理，持续发包。因为这样才可以确保接收方的数据正确更新到发送方。对于这个探测包的重传不需要将 RTO 翻倍。

## 实现
主要需要实现 `fill_window`、`ack_received`、`tick` 和 `send_empty_segment`方法。
```cpp
class TCPSender {
  private:
    //! our initial sequence number, the number for our SYN.
    WrappingInt32 _isn;

    //! outbound queue of segments that the TCPSender wants sent
    std::queue<TCPSegment> _segments_out{};

    //! retransmission timer for the connection
    unsigned int _initial_retransmission_timeout;

    //! outgoing stream of bytes that have not yet been sent
    ByteStream _stream;

    //! the (absolute) sequence number for the next byte to be sent
    uint64_t _next_seqno{0};

    bool _syn_sent = false;
    bool _fin_sent = false;
    uint64_t _bytes_in_flight = 0;
    uint16_t _receiver_window_size = 0;
    uint16_t _receiver_free_space = 0;
    uint16_t _consecutive_retransmissions = 0;
    unsigned int _rto = 0;
    unsigned int _time_elapsed = 0;
    bool _timer_running = false;
    std::queue<TCPSegment> _segments_outstanding{};

    bool _ack_valid(uint64_t abs_ackno);
    void _send_segment(TCPSegment &seg);

  public:
    //! Initialize a TCPSender
    TCPSender(const size_t capacity = TCPConfig::DEFAULT_CAPACITY,
              const uint16_t retx_timeout = TCPConfig::TIMEOUT_DFLT,
              const std::optional<WrappingInt32> fixed_isn = {});

    //! \name "Input" interface for the writer
    //!@{
    ByteStream &stream_in() { return _stream; }
    const ByteStream &stream_in() const { return _stream; }
    //!@}

    //! \name Methods that can cause the TCPSender to send a segment
    //!@{

    //! \brief A new acknowledgment was received
    void ack_received(const WrappingInt32 ackno, const uint16_t window_size);

    //! \brief Generate an empty-payload segment (useful for creating empty ACK segments)
    void send_empty_segment();

    //! \brief create and send segments to fill as much of the window as possible
    void fill_window();

    //! \brief Notifies the TCPSender of the passage of time
    void tick(const size_t ms_since_last_tick);
    //!@}

    //! \name Accessors
    //!@{

    //! \brief How many sequence numbers are occupied by segments sent but not yet acknowledged?
    //! \note count is in "sequence space," i.e. SYN and FIN each count for one byte
    //! (see TCPSegment::length_in_sequence_space())
    size_t bytes_in_flight() const;

    //! \brief Number of consecutive retransmissions that have occurred in a row
    unsigned int consecutive_retransmissions() const;

    //! \brief TCPSegments that the TCPSender has enqueued for transmission.
    //! \note These must be dequeued and sent by the TCPConnection,
    //! which will need to fill in the fields that are set by the TCPReceiver
    //! (ackno and window size) before sending.
    std::queue<TCPSegment> &segments_out() { return _segments_out; }
    //!@}

    //! \name What is the next sequence number? (used for testing)
    //!@{

    //! \brief absolute seqno for the next byte to be sent
    uint64_t next_seqno_absolute() const { return _next_seqno; }

    //! \brief relative seqno for the next byte to be sent
    WrappingInt32 next_seqno() const { return wrap(_next_seqno, _isn); }
    //!@}
};
```

具体实现如下：
```cpp
TCPSender::TCPSender(const size_t capacity, const uint16_t retx_timeout, const std::optional<WrappingInt32> fixed_isn)
    : _isn(fixed_isn.value_or(WrappingInt32{random_device()()}))
    , _initial_retransmission_timeout{retx_timeout}
    , _stream(capacity)
    , _rto{retx_timeout} {}

uint64_t TCPSender::bytes_in_flight() const { return _bytes_in_flight; }

void TCPSender::fill_window() {
    if(!_syn_sent) {
        _syn_sent = true;
        TCPSegment seg;
        seg.header().syn = true;
        _send_segment(seg);
        return;
    }
    // 等待 SYN 的 ack
    if(!_segments_outstanding.empty() && _segments_outstanding.front().header().syn) {
        return;
    }
    // 没有发送需求，输入未结束
    if(_stream.buffer_empty() && !_stream.eof()) {
        return;
    }
    if(_fin_sent) {
        return;
    }

    if(_receiver_window_size) {
        while(_receiver_free_space) {
            TCPSegment seg;
            size_t payload_size = min({_stream.buffer_size(),
                                    static_cast<size_t>(_receiver_free_space),
                                    TCPConfig::MAX_PAYLOAD_SIZE});
            seg.payload() = Buffer{_stream.read(payload_size)};
            if(_stream.eof() && static_cast<size_t>(_receiver_free_space) > payload_size) {
                // 可以一个 segment 完成 FIN
                seg.header().fin = true;
                _fin_sent = true;
            }
            _send_segment(seg); // already recorded sent segments
            if(_stream.buffer_empty()) {
                break;
            }
        }
    } else if(_receiver_free_space == 0) {
        // 需要探测新的接收窗口
        TCPSegment seg;
        if(_stream.eof()) {
            seg.header().fin = true;
            _fin_sent = true;
            _send_segment(seg);
        } else if(!_stream.buffer_empty()) {
            // try 1 byte
            seg.payload() = _stream.read(1);
            _send_segment(seg);
        }
    }
}

//! \param ackno The remote receiver's ackno (acknowledgment number)
//! \param window_size The remote receiver's advertised window size
void TCPSender::ack_received(const WrappingInt32 ackno, const uint16_t window_size) {
    uint64_t abs_ackno = unwrap(ackno, _isn, _next_seqno);
    if(!_ack_valid(abs_ackno)) {
        return;
    }
    _receiver_window_size = window_size;
    _receiver_free_space = window_size;
    while(!_segments_outstanding.empty()) {
        TCPSegment seg = _segments_outstanding.front();
        if(unwrap(seg.header().seqno, _isn, _next_seqno) + seg.length_in_sequence_space() <= abs_ackno) {
            // 被 ack 确认
            _bytes_in_flight -= seg.length_in_sequence_space();
            _segments_outstanding.pop();
            _time_elapsed = 0;
            _rto = _initial_retransmission_timeout;
            _consecutive_retransmissions = 0;
        } else {
            break;
        }
    }
    if(!_segments_outstanding.empty()) {
        _receiver_free_space = static_cast<uint16_t>(
            abs_ackno +
            static_cast<uint64_t>(window_size) - 
            _next_seqno);
        // 数学上等价于 abs_ackno + window_size - _next_seqno
        // _receiver_free_space = static_cast<uint16_t>(
        //     abs_ackno + static_cast<uint64_t>(window_size) - 
        //     unwrap(_segments_outstanding.front().header().seqno, _isn, _next_seqno) - 
        //     _bytes_in_flight)
    }
    if(_bytes_in_flight == 0) {
        _timer_running = false;
    }
    fill_window();
}

//! \param[in] ms_since_last_tick the number of milliseconds since the last call to this method
void TCPSender::tick(const size_t ms_since_last_tick) {
    if(!_timer_running) {
        return;
    }
    _time_elapsed += ms_since_last_tick;
    if(_time_elapsed >= _rto) {
        _segments_out.push(_segments_outstanding.front());
        if(_receiver_window_size || _segments_outstanding.front().header().syn) {
            ++_consecutive_retransmissions;
            _rto <<= 1;
        }
        _time_elapsed = 0;
    }
}

unsigned int TCPSender::consecutive_retransmissions() const { return _consecutive_retransmissions; }

void TCPSender::send_empty_segment() {
    TCPSegment seg;
    seg.header().seqno = wrap(_next_seqno, _isn);
    _segments_out.push(seg);
}

bool TCPSender::_ack_valid(uint64_t abs_ackno) {
    if(_segments_outstanding.empty()) {
        // ack 不会确认未发送的数据
        return abs_ackno <= _next_seqno;
    }
    return (abs_ackno <= _next_seqno) && 
        (abs_ackno >= unwrap(_segments_outstanding.front().header().seqno, _isn, _next_seqno));
}

void TCPSender::_send_segment(TCPSegment &seg) {
    seg.header().seqno = wrap(_next_seqno, _isn);
    _next_seqno += seg.length_in_sequence_space();
    _bytes_in_flight += seg.length_in_sequence_space();
    if(_syn_sent) {
        _receiver_free_space -= seg.length_in_sequence_space();
    }
    _segments_out.push(seg);
    _segments_outstanding.push(seg);
    if(!_timer_running) {
        _timer_running = true;
        _time_elapsed = 0;
    }
}
```