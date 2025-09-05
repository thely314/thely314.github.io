---
title: CS144 Lab0
tags:
  - network
categories:
  - CS144
date: 2025-08-24 17:20:42
---

# CS144 学习前言
打算写一系列博客记录一下自己学习 CS144 的心得，说起来又好久没有更新博客了呢（笑）
这次在 CS144 遇到挺多之前并不熟悉的实践，也算是有所收获，以及认识到了 morden C++ 看起来也可以很舒服（其实根本没有用到太多特性）

这门课的 GitHub Repository 会随着每一年的进度被直接清空，所以使用了 PKUFlyingPig 的 fork：
[https://github.com/PKUFlyingPig/CS144-Computer-Network](https://github.com/PKUFlyingPig/CS144-Computer-Network)
该课程的课程视频翻译可以参考[B站这个视频](https://www.bilibili.com/video/BV16o4y1V7RQ)

# 环境
我使用 VMware + Ubuntu22.04，工具链之前用的就基本齐了，克隆到本地后，根据 Cmake 补上就行

实践基本跟着这个仓库下的 `lab_handouts/` 做就行，会告诉你做每个 lab 需要注意哪些地方

# Lab-0
## Networking by hand
`Fetch a Web page` 使用 `telnet` 手动发送 HTTP 请求，他们的 cs144 课程网站用不了，随便找个可请求的域名就行。
`Send yourself an email` 则使用 SMTP 协议，和理论课上的一致，不再重复。
`Listening and connecting` 是 `netcat` 的使用。

## webget
初始化 `build` 目录，之后使用 `Cmake` 和 `make` 构建项目与测试

任务位于 `apps/webget.cc`，根据代码文档完成 `get_URL` ，需要依靠 `libsponge/util` 的 `TCPSocket` 和 `Address`
```cpp
void get_URL(const string &host, const string &path) {
    // Your code here.

    // You will need to connect to the "http" service on
    // the computer whose name is in the "host" string,
    // then request the URL path given in the "path" string.

    // Then you'll need to print out everything the server sends back,
    // (not just one call to read() -- everything) until you reach
    // the "eof" (end of file).
    TCPSocket socket;
    socket.connect(Address(host, "http"));
    socket.write("GET " + path + "HTTP/1.1\r\n");
    socket.write("Host: " + host + "\r\n");
    socket.write("Connection: close\r\n\r\n");
    while (!socket.eof()) {
        cout << socket.read();
    }
    socket.wait_until_closed();
}
```

## An in-memory reliable byte stream
实现一个在内存中的有序可靠字节流 `ByteStream`
考虑字节流的元素处理，使用双端队列 `deque` 比较方便，所以这个工作结构看起来更像管道
```cpp
class ByteStream {
  private:
    // Your code here -- add private members as necessary.

    // Hint: This doesn't need to be a sophisticated data structure at
    // all, but if any of your tests are taking longer than a second,
    // that's a sign that you probably want to keep exploring
    // different approaches.
    bool _error{};  //!< Flag indicating that the stream suffered an error.
    std::deque<char> buffer;
    size_t capacity;
    bool end_write;
    bool end_read;
    size_t written_bytes;
    size_t read_bytes;

  public:
    //! Construct a stream with room for `capacity` bytes.
    ByteStream(const size_t capacity);

    //! \name "Input" interface for the writer
    //!@{

    //! Write a string of bytes into the stream. Write as many
    //! as will fit, and return how many were written.
    //! \returns the number of bytes accepted into the stream
    size_t write(const std::string &data);

    //! \returns the number of additional bytes that the stream has space for
    size_t remaining_capacity() const;

    //! Signal that the byte stream has reached its ending
    void end_input();

    //! Indicate that the stream suffered an error.
    void set_error() { _error = true; }
    //!@}

    //! \name "Output" interface for the reader
    //!@{

    //! Peek at next "len" bytes of the stream
    //! \returns a string
    std::string peek_output(const size_t len) const;

    //! Remove bytes from the buffer
    void pop_output(const size_t len);

    //! Read (i.e., copy and then pop) the next "len" bytes of the stream
    //! \returns a string
    std::string read(const size_t len);

    //! \returns `true` if the stream input has ended
    bool input_ended() const;

    //! \returns `true` if the stream has suffered an error
    bool error() const { return _error; }

    //! \returns the maximum amount that can currently be read from the stream
    size_t buffer_size() const;

    //! \returns `true` if the buffer is empty
    bool buffer_empty() const;

    //! \returns `true` if the output has reached the ending
    bool eof() const;
    //!@}

    //! \name General accounting
    //!@{

    //! Total number of bytes written
    size_t bytes_written() const;

    //! Total number of bytes popped
    size_t bytes_read() const;
    //!@}
};
```

具体实现如下：
```cpp
ByteStream::ByteStream(const size_t capa)
    : buffer(), capacity(capa), end_write(false), end_read(false), written_bytes(0), read_bytes(0) {}

size_t ByteStream::write(const string &data) {
    size_t space_for_write = capacity - buffer.size();
    // 实际写入长度
    size_t real_write = min(space_for_write, data.length());
    for(size_t i = 0; i< real_write; i++) {
        buffer.push_back(data[i]);
    }
    written_bytes += real_write;
    return real_write;
}

//! \param[in] len bytes will be copied from the output side of the buffer
string ByteStream::peek_output(const size_t len) const {
    size_t space_for_peek = min(len, buffer.size());
    string out = "";
    for(size_t i = 0; i< space_for_peek; i++) {
        out += buffer[i];
    }
    return out;
}

//! \param[in] len bytes will be removed from the output side of the buffer
void ByteStream::pop_output(const size_t len) {
    if(len > buffer.size()) {
        set_error();
        return;
    }
    for(size_t i = 0; i < len; i++) {
        buffer.pop_front();
    }
    read_bytes += len;
}

//! Read (i.e., copy and then pop) the next "len" bytes of the stream
//! \param[in] len bytes will be popped and returned
//! \returns a string
std::string ByteStream::read(const size_t len) {
    string out = "";
    if(len > buffer.size()) {
        set_error();
        return out;
    }
    for(size_t i = 0; i<len; i++) {
        out += buffer.front();
        buffer.pop_front();
    }
    read_bytes += len;
    return out;
}

void ByteStream::end_input() {
    end_write = true;
}

bool ByteStream::input_ended() const {
    return end_write;
}

size_t ByteStream::buffer_size() const {
    return buffer.size();
}

bool ByteStream::buffer_empty() const {
    return buffer.empty();
}

bool ByteStream::eof() const {
    return buffer.empty() && end_write;
}

size_t ByteStream::bytes_written() const {
    return written_bytes;
}

size_t ByteStream::bytes_read() const {
    return read_bytes;
}

size_t ByteStream::remaining_capacity() const {
    return capacity - buffer.size();
}
```

测试时发现 `webget` 的测试基本不通过，排查发现是 `webget` 会向国外服务器发送请求，测试过不了也在情理之中。