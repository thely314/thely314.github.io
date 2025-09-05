---
title: CS144 Lab4
tags:
  - network
categories:
  - CS144
date: 2025-08-28 18:03:12
---

# Lab-4
## TCPConnection
`TCPConnection` 将 `TCPSender` 和 `TCPReceiver` 组合形成 TCP 的终端，同时维护数据收发。

对于接收数据：
+ 收到 RST 标志位时，设置错误状态并永久关闭 TCP 连接
+ 告知自己的 `TCPSender` 对端的 ackno 和 window_size
+ 收到 TCP 报文时需要告知对端，自己的 ackno 和 window_size

对于发送数据：
+ 将自己 `TCPReceiver` 的 ackno 和 window_size 填充到待发送的 TCP segment
+ 设置待发送报文的 ack
+ 通过自己的 `tick` 函数，告知 `TCPSender` 时间的流逝
+ 连续重传次数超过最大重传次数 `MAX_RETX_ATTEMPTS`，需要发送 RST 包
+ 在一定条件下关闭 TCP 连接，主要是暴力退出、先发出 FIN 一方的等待（linger）行为

假设本地先关闭连接（输出流结束），对方输出流未结束（还可以发送数据），此时本地会在对方（更晚）关闭连接后进入linger状态，等待后关闭。
本地进入linger状态的确切时机是在本地发送了FIN并且收到了对方对FIN的ACK，同时本地也收到了对方的FIN并回复了ACK之后。

linger 期间本地需要防止对方的可能动作：
+ 确保最后的ACK被对方接收
  + 如果本地发送的最后一个 ACK 丢失，对方会超时并重传 FIN
  + 在 linger 期间，本地可以接收并重新 ACK 这个重传的 FIN
  + 如果没有 linger 期，连接立即关闭，重传的 FIN 将得不到响应，导致对方保持半关闭状态
+ 防止旧的重复报文段干扰新连接
  + 等待足够长时间，确保网络中所有属于此连接的报文段都已消失
  + 防止相同四元组（源IP、源端口、目的IP、目的端口）的新连接收到旧的重复报文段

在实现细节上参考了这篇博客：[Kiprey: CS144计算机网络 Lab4](https://kiprey.github.io/2021/11/cs144-lab4/)
## 实现
```cpp
class TCPConnection {
  private:
    TCPConfig _cfg;
    TCPReceiver _receiver{_cfg.recv_capacity};
    TCPSender _sender{_cfg.send_capacity, _cfg.rt_timeout, _cfg.fixed_isn};

    //! outbound queue of segments that the TCPConnection wants sent
    std::queue<TCPSegment> _segments_out{};

    //! Should the TCPConnection stay active (and keep ACKing)
    //! for 10 * _cfg.rt_timeout milliseconds after both streams have ended,
    //! in case the remote TCPConnection doesn't know we've received its whole stream?
    // linger 确保最后对对方的 FIN 的 ACK 被对方接收，否则对方可能会超时并重传FIN
    // 防止旧的重复报文段干扰新连接
    bool _linger_after_streams_finish{true};

    size_t _time_since_last_segment_received_counter{0};

    bool _active{true};

    void send_RST();
    bool real_send();
    void set_ack_and_windowsize(TCPSegment& segment);
    // prereqs1 : The inbound stream has been fully assembled and has ended.
    bool check_inbound_ended();
    // prereqs2 : The outbound stream has been ended by the local application and fully sent (including
    // the fact that it ended, i.e. a segment with fin ) to the remote peer.
    // prereqs3 : The outbound stream has been fully acknowledged by the remote peer.
    bool check_outbound_ended();

  public:
    //! \name "Input" interface for the writer
    //!@{

    //! \brief Initiate a connection by sending a SYN segment
    void connect();

    //! \brief Write data to the outbound byte stream, and send it over TCP if possible
    //! \returns the number of bytes from `data` that were actually written.
    size_t write(const std::string &data);

    //! \returns the number of `bytes` that can be written right now.
    size_t remaining_outbound_capacity() const;

    //! \brief Shut down the outbound byte stream (still allows reading incoming data)
    void end_input_stream();
    //!@}

    //! \name "Output" interface for the reader
    //!@{

    //! \brief The inbound byte stream received from the peer
    ByteStream &inbound_stream() { return _receiver.stream_out(); }
    //!@}

    //! \name Accessors used for testing

    //!@{
    //! \brief number of bytes sent and not yet acknowledged, counting SYN/FIN each as one byte
    size_t bytes_in_flight() const;
    //! \brief number of bytes not yet reassembled
    size_t unassembled_bytes() const;
    //! \brief Number of milliseconds since the last segment was received
    size_t time_since_last_segment_received() const;
    //!< \brief summarize the state of the sender, receiver, and the connection
    TCPState state() const { return {_sender, _receiver, active(), _linger_after_streams_finish}; };
    //!@}

    //! \name Methods for the owner or operating system to call
    //!@{

    //! Called when a new segment has been received from the network
    void segment_received(const TCPSegment &seg);

    //! Called periodically when time elapses
    void tick(const size_t ms_since_last_tick);

    //! \brief TCPSegments that the TCPConnection has enqueued for transmission.
    //! \note The owner or operating system will dequeue these and
    //! put each one into the payload of a lower-layer datagram (usually Internet datagrams (IP),
    //! but could also be user datagrams (UDP) or any other kind).
    std::queue<TCPSegment> &segments_out() { return _segments_out; }

    //! \brief Is the connection still alive in any way?
    //! \returns `true` if either stream is still running or if the TCPConnection is lingering
    //! after both streams have finished (e.g. to ACK retransmissions from the peer)
    bool active() const;
    //!@}

    //! Construct a new connection from a configuration
    explicit TCPConnection(const TCPConfig &cfg) : _cfg{cfg} {}

    //! \name construction and destruction
    //! moving is allowed; copying is disallowed; default construction not possible

    //!@{
    ~TCPConnection();  //!< destructor sends a RST if the connection is still open
    TCPConnection() = delete;
    TCPConnection(TCPConnection &&other) = default;
    TCPConnection &operator=(TCPConnection &&other) = default;
    TCPConnection(const TCPConnection &other) = delete;
    TCPConnection &operator=(const TCPConnection &other) = delete;
    //!@}
};
```

具体实现如下：
```cpp
size_t TCPConnection::remaining_outbound_capacity() const {
    return _sender.stream_in().remaining_capacity();
}

size_t TCPConnection::bytes_in_flight() const {
    return _sender.bytes_in_flight();
}

size_t TCPConnection::unassembled_bytes() const {
    return _receiver.unassembled_bytes();
}

size_t TCPConnection::time_since_last_segment_received() const {
    return _time_since_last_segment_received_counter;
}

bool TCPConnection::real_send() {
    bool isSend = false;
    while(!_sender.segments_out().empty()) {
        isSend = true;
        TCPSegment seg = _sender.segments_out().front();
        _sender.segments_out().pop();
        set_ack_and_windowsize(seg);
        _segments_out.push(seg);
    }
    return isSend;
}

void TCPConnection::segment_received(const TCPSegment &seg) {
    _time_since_last_segment_received_counter = 0;
    // check RST
    if(seg.header().rst) {
        _sender.stream_in().set_error();
        _receiver.stream_out().set_error();
        _active = false;
        return;
    }
    // 将 segment 传递给 receiver
    _receiver.segment_received(seg);
    // check if need to linger
    // 1. 本地 TCPReceiver 是否已完整接收了输入流，标志着对方关闭了连接
    // 2. 本地 TCPSender  的输出流是否未结束，标志着本地可能还有数据需要发送
    if(check_inbound_ended() && !_sender.stream_in().eof()) {
        // 对方已经关闭连接，不需要 linger
        _linger_after_streams_finish = false;
    }
    // check ack
    if(seg.header().ack) {
        _sender.ack_received(seg.header().ackno, seg.header().win);
        real_send();
    }
    // send ack
    if(seg.length_in_sequence_space() > 0) {
        // handle the SYN/ACK case
        _sender.fill_window();
        bool isSend = real_send();
        if(!isSend) {
            // not SYN/ACK case
            // TCPSender没有数据要发送，但对方发送了数据，因此需要发送一个ACK来确认接收到的数据
            // _sender.send_empty_segment() 发送一个没有负载的 TCP 段，具有正确的序列号、ACK 标志、确认号、窗口大小
            _sender.send_empty_segment();
            TCPSegment ACK_seg = _sender.segments_out().front();
            _sender.segments_out().pop();
            set_ack_and_windowsize(ACK_seg);
            _segments_out.push(ACK_seg);
        }
    }
    return;
}

bool TCPConnection::active() const { return _active; }

void TCPConnection::set_ack_and_windowsize(TCPSegment &segment) {
    // ask receiver for ack and window size
    optional<WrappingInt32> ackno = _receiver.ackno();
    if(ackno.has_value()) {
        segment.header().ack = true;
        segment.header().ackno = ackno.value();
    }
    size_t window_size = _receiver.window_size();
    segment.header().win = static_cast<uint16_t>(window_size);
    return;
}

void TCPConnection::connect() {
    // send SYN
    _sender.fill_window();
    real_send();
}

size_t TCPConnection::write(const string &data) {
    if(data.size() == 0) {
        return 0;
    }
    size_t actually_write = _sender.stream_in().write(data);
    _sender.fill_window();
    real_send();
    return actually_write;
}

void TCPConnection::end_input_stream() {
    _sender.stream_in().end_input();
    _sender.fill_window();
    real_send();
}

void TCPConnection::send_RST() {
    _sender.send_empty_segment();
    TCPSegment RST_seg = _sender.segments_out().front();
    _sender.segments_out().pop();
    set_ack_and_windowsize(RST_seg);
    RST_seg.header().rst = true;
    _segments_out.push(RST_seg);
}

// prereqs1 : The inbound stream has been fully assembled and has ended.
bool TCPConnection::check_inbound_ended() {
    return _receiver.unassembled_bytes() == 0 && _receiver.stream_out().input_ended();
}
// prereqs2 : The outbound stream has been ended by the local application and fully sent (including
// the fact that it ended, i.e. a segment with fin ) to the remote peer.
// prereqs3 : The outbound stream has been fully acknowledged by the remote peer.
bool TCPConnection::check_outbound_ended() {
    return _sender.stream_in().eof()
        // +2 include SYN and FIN
        && _sender.next_seqno_absolute() == _sender.stream_in().bytes_written() + 2
        && _sender.bytes_in_flight() == 0;
}

//! \param[in] ms_since_last_tick number of milliseconds since the last call to this method
void TCPConnection::tick(const size_t ms_since_last_tick) {
    _time_since_last_segment_received_counter += ms_since_last_tick;
    // tick the sender
    _sender.tick(ms_since_last_tick);
    // 需要重传
    if(_sender.segments_out().size() > 0) {
        TCPSegment retx_seg = _sender.segments_out().front();
        _sender.segments_out().pop();
        set_ack_and_windowsize(retx_seg);
        // 重传次数超过限制
        // 中断连接
        if(_sender.consecutive_retransmissions() > _cfg.MAX_RETX_ATTEMPTS) {
            _sender.stream_in().set_error();
            _receiver.stream_out().set_error();
            retx_seg.header().rst = true;
            _active = false;
        }
        _segments_out.push(retx_seg);
    }
    // check if need to linger
    if(check_inbound_ended() && !_sender.stream_in().eof()) {
        _linger_after_streams_finish = false;
    }
    // check if done
    if(check_inbound_ended() && check_outbound_ended()) {
        if(!_linger_after_streams_finish) {
            _active = false;
        } else if(_time_since_last_segment_received_counter >= 10*_cfg.rt_timeout) {
            // linger
            _active = false;
        }
    }
}

TCPConnection::~TCPConnection() {
    try {
        if (active()) {
            cerr << "Warning: Unclean shutdown of TCPConnection\n";
            // Your code here: need to send a RST segment to the peer
            _sender.stream_in().set_error();
            _receiver.stream_out().set_error();
            send_RST();
            _active = false;
        }
    } catch (const exception &e) {
        std::cerr << "Exception destructing TCP FSM: " << e.what() << std::endl;
    }
}
```