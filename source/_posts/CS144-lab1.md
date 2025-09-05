---
title: CS144 Lab1
tags:
  - network
categories:
  - CS144
date: 2025-08-25 16:41:52
---

# Lab-1
## StreamReassembler
这次是实现 `StreamReassembler`，一个流重组器，字节流接收方用于正确重组接收到的字节流的子串。
会适应到 Lab-0 中实现的 `ByteStream`

实验文档有非常好的图文描述，这里不贴了。

因为网络环境的约束，TCP 发送方会将数据分割为多个小段的数据，分次发送，TCP 接收方则必须通过流重组器，将接收到的这些可能被重排、重传的数据包重新组装成新的连续字节流。

## 实现
流的每个字节都有自己唯一的索引，从零开始向上计数。当重组器知道了流的下一个字节，它应该将其写入 `ByteStream`

传入的子串可能存在重叠部分，且 `ByteStream` 容量有限，`StreamReassembler` 自身也需要维护自身容量
CS144 要求 `ByteStream` 持有长度和未重组的 unassembled_strings 长度之和不超过 `StreamReassembler` 构造函数传入的容量大小。
使用位图 `std::deque<bool> bitmap` 记录缓冲区使用状态。

如果感觉容量和片段关系的比较逻辑不好理解，可以参考实验文档的图。

```cpp
class StreamReassembler {
  private:
    // Your code here -- add private members as necessary.
    size_t unass_base;        //!< The index of the first unassembled byte
    size_t unass_size;        //!< The number of bytes in the substrings stored but not yet reassembled
    bool _eof;                //!< The last byte has arrived
    std::deque<char> buffer;  //!< The unassembled strings
    std::deque<bool> bitmap;  //!< buffer bitmap

    ByteStream _output;  //!< The reassembled in-order byte stream
    size_t _capacity;    //!< The maximum number of bytes

    void check_contiguous();
    size_t real_size(const std::string &data, const size_t index);

  public:
    //! \brief Construct a `StreamReassembler` that will store up to `capacity` bytes.
    //! \note This capacity limits both the bytes that have been reassembled,
    //! and those that have not yet been reassembled.
    StreamReassembler(const size_t capacity);

    //! \brief Receive a substring and write any newly contiguous bytes into the stream.
    //!
    //! The StreamReassembler will stay within the memory limits of the `capacity`.
    //! Bytes that would exceed the capacity are silently discarded.
    //!
    //! \param data the substring
    //! \param index indicates the index (place in sequence) of the first byte in `data`
    //! \param eof the last byte of `data` will be the last byte in the entire stream
    void push_substring(const std::string &data, const uint64_t index, const bool eof);

    //! \name Access the reassembled byte stream
    //!@{
    const ByteStream &stream_out() const { return _output; }
    ByteStream &stream_out() { return _output; }
    //!@}

    //! The number of bytes in the substrings stored but not yet reassembled
    //!
    //! \note If the byte at a particular index has been pushed more than once, it
    //! should only be counted once for the purpose of this function.
    size_t unassembled_bytes() const;

    //! \brief Is the internal state empty (other than the output stream)?
    //! \returns `true` if no substrings are waiting to be assembled
    bool empty() const;

    //! The acknowledge index of the stream, i.e., the index of the next interested substring
    size_t ack_index() const;
};
```

具体实现如下：
```cpp
StreamReassembler::StreamReassembler(const size_t capacity)
    : unass_base(0)
    , unass_size(0)
    , _eof(0)
    , buffer(capacity, '\0')
    , bitmap(capacity, false)
    , _output(capacity)
    , _capacity(capacity) {}

//! \details This functions calls just after pushing a substring into the
//! _output stream. It aims to check if there exists any contiguous substrings
//! recorded earlier can be push into the stream.
void StreamReassembler::check_contiguous() {
    string tmp = "";
    // 检查是否有未拼接到 ByteStream 的连续片段
    while(bitmap.front()) {
        tmp += buffer.front();
        buffer.pop_front();
        bitmap.pop_front();
        buffer.push_back('\0');
        bitmap.push_back(false);
    }
    if(tmp.length() > 0) {
        _output.write(tmp);
        unass_base += tmp.length();
        unass_size -= tmp.length();
    }
}

//! \details This function accepts a substring (aka a segment) of bytes,
//! possibly out-of-order, from the logical stream, and assembles any newly
//! contiguous substrings and writes them into the output stream in order.
void StreamReassembler::push_substring(const string &data, const size_t index, const bool eof) {
    if(eof) {
        _eof = true;
    }
    size_t len = data.length();
    if(len == 0 && _eof && unass_size == 0) {
        _output.end_input();
        return;
    }
    // invalid index 无法容纳
    if(index >= unass_base + _capacity) {
        return;
    }
    if(index >= unass_base) {
        // 非连续片段先行抵达
        int offset = index - unass_base;
        // 判断是否可容纳
        size_t space_to_accept = min(len, _capacity - _output.buffer_size() - offset);
        if(space_to_accept < len) {
            _eof = false;
        }
        for(size_t i = 0; i < space_to_accept; i++) {
            if(bitmap[i + offset]) {
                // 已有重复片段
                continue;
            }
            buffer[i + offset] = data[i];
            bitmap[i + offset] = true;
            unass_size++;
        }
    } else if (index + len > unass_base) {
        // 部分重合
        int offset = unass_base - index;
        size_t space_to_accept = min(len - offset, _capacity - _output.buffer_size());
        if(space_to_accept < len - offset) {
            _eof = false;
        }
        for(size_t i = 0; i < space_to_accept; i++) {
            if(bitmap[i]) {
                // 已有重复片段
                continue;
            }
            buffer[i] = data[i + offset];
            bitmap[i] = true;
            unass_size++;
        }
    }
    check_contiguous();
    if(_eof && unass_size == 0) {
        _output.end_input();
    }
}

size_t StreamReassembler::unassembled_bytes() const { return unass_size; }

bool StreamReassembler::empty() const { return unass_size == 0; }

size_t StreamReassembler::ack_index() const { return unass_base; }
```