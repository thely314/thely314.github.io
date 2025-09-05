---
title: CS144 Lab5
tags:
  - network
categories:
  - CS144
date: 2025-08-29 16:36:05
---

# Lab-5
## Network interface
这部分内容是实现**网络接口 network interface** （也可以称为适配器）

TCP 报文有三种方式可被发送到远程终端：
+ TCP-in-UDP-in-IP：用户提供 TCP 包，之后可以使用 Linux 提供的接口，让内核来负责构造 UDP 报头、IP报头以及以太网报头，并将构造出的数据包发送至下一个层。
+ TCP-in-IP：将 TCP 数据包直接放进 IP 包作为其 payload，被称为 TCP/IP。但用户层如果想直接操作构造 IP 报文，需要使用到 Linux 提供的 TUN 虚拟网络设备来作为中转。当用户将 IP 报文发送给 TUN 设备后，剩余的以太网报头构造、发送以太网帧等等的操作均会由内核自动进行，无需用户干预。
+ TCP-in-IP-in-Ethernet：每次用户向TUN设备写入IP数据报时，Linux 内核都必须构造一个适当的链路层(以太网)帧，并将 IP 数据报作为其 payload。因此 Linux 必须找出下一跳的以太网目的地址，给出下一跳的 IP 地址。如果 Linux 无法得知该映射关系，则将会发出广播探测请求以查找到下一跳的地址等信息。上述功能由网络接口 network interface 实现，将会把待发送的 IP 报文转换成链路层（以太网）帧。

上一部分（Lab-4）中采用了 TCP-in-IP 实现下层技术栈，这部分实现的 network interface，将完成 Internet datagrams 到 Ethernet frames 的转换。

由于适配器同时拥有网络层和链路层地址，因此需要相互转化。而这种转换的任务就由**地址解析协议 ARP** 来完成。

每台主机或路由器在其内存中保存了一张 ARP 表，该表包含了 IP 地址到 MAC 地址的映射关系，同时还包含了一个寿命值（TTL），用以表示从表中删除每个映射的时间。

当发送适配器需要查询目的适配器的 MAC 地址时，发送适配器会设置分组的目的地址为 MAC 广播地址（FF-FF-FF-FF-FF-FF），这样做的目的是为了让所有子网上的其他适配器都接收到。当其他适配器接收到了该 ARP 查询分组后，只有 IP 匹配的适配器才会返回一个 ARP 响应分组，之后发送适配器便可更新自己的 ARP 表，并开始发送 IP 报文。

## 实现
主要需要实现 `send_datagram`、`recv_frame` 和 `tick`方法。
```cpp
class NetworkInterface {
  private:
    //! only resend ARP request for the same IPv4 address after 5000ms
    static constexpr size_t MAX_RETX_WAITING_TIME = 5000; 

    //! cache the mapping for 30 seconds
    static constexpr size_t MAX_CACHE_TIME = 30000;

    //! Ethernet (known as hardware, network-access-layer, or link-layer) address of the interface
    EthernetAddress _ethernet_address;

    //! IP (known as internet-layer or network-layer) address of the interface
    Address _ip_address;

    //! outbound queue of Ethernet frames that the NetworkInterface wants sent
    std::queue<EthernetFrame> _frames_out{};

    //! cache entry for ethernet address mapping
    struct EthernetAddressEntry {
      size_t caching_time;
      EthernetAddress MAC_address;
    };

    //! mapping from ip_address to ethernet address
    std::map<uint32_t, EthernetAddressEntry> _cache{};

    //! to avoid flooding the network with ARP requests. If the network interface 
    // already sent an ARP request about the same IP address in the last five seconds,
    // don’t send a second request—just wait for a reply to the first one. 
    // Again, queue the datagram until you learn the destination Ethernet address.
    struct WaitingList {
      size_t time_since_last_ARP_request_send = 0;
      std::queue<InternetDatagram> waiting_datagram{};
    };

    //! mapping from the ip_address to the waiting queue
    std::map<uint32_t, WaitingList> _queue_map{};

    std::optional<EthernetAddress>get_EthernetAdress(const uint32_t ip_addr);
    std::optional<WaitingList>get_WaitingList(const uint32_t ip_addr); 
    void send_helper(const EthernetAddress MAC_addr, const InternetDatagram &dgram);
    void queue_helper(const uint32_t ip_addr, const InternetDatagram &dgram);
    void send_ARP_request(const uint32_t ip_addr);
    void send_ARP_reply(const uint32_t ip_addr, const EthernetAddress& MAC_addr);
    bool valid_frame(const EthernetFrame &frame);
    void cache_mapping(uint32_t ip_addr, EthernetAddress MAC_addr);
    void clear_waitinglist(uint32_t ip_addr, EthernetAddress MAC_addr);

  public:
    //! \brief Construct a network interface with given Ethernet (network-access-layer) and IP (internet-layer) addresses
    NetworkInterface(const EthernetAddress &ethernet_address, const Address &ip_address);

    //! \brief Access queue of Ethernet frames awaiting transmission
    std::queue<EthernetFrame> &frames_out() { return _frames_out; }

    //! \brief Sends an IPv4 datagram, encapsulated in an Ethernet frame (if it knows the Ethernet destination address).

    //! Will need to use [ARP](\ref rfc::rfc826) to look up the Ethernet destination address for the next hop
    //! ("Sending" is accomplished by pushing the frame onto the frames_out queue.)
    void send_datagram(const InternetDatagram &dgram, const Address &next_hop);

    //! \brief Receives an Ethernet frame and responds appropriately.

    //! If type is IPv4, returns the datagram.
    //! If type is ARP request, learn a mapping from the "sender" fields, and send an ARP reply.
    //! If type is ARP reply, learn a mapping from the "sender" fields.
    std::optional<InternetDatagram> recv_frame(const EthernetFrame &frame);

    //! \brief Called periodically when time elapses
    void tick(const size_t ms_since_last_tick);
};
```

具体实现如下：
```cpp
//! \param[in] ethernet_address Ethernet (what ARP calls "hardware") address of the interface
//! \param[in] ip_address IP (what ARP calls "protocol") address of the interface
NetworkInterface::NetworkInterface(const EthernetAddress &ethernet_address, const Address &ip_address)
    : _ethernet_address(ethernet_address), _ip_address(ip_address) {
    cerr << "DEBUG: Network interface has Ethernet address " << to_string(_ethernet_address) << " and IP address "
         << ip_address.ip() << "\n";
}

optional<EthernetAddress> NetworkInterface::get_EthernetAdress(const uint32_t ip_addr) {
    optional<EthernetAddress> ret = nullopt;
    map<uint32_t, EthernetAddressEntry>::iterator iter;
    iter = _cache.find(ip_addr);
    if (iter != _cache.end()) {
        ret = iter->second.MAC_address;
    }
    return ret;
}

optional<NetworkInterface::WaitingList> NetworkInterface::get_WaitingList(const uint32_t ip_addr) {
    optional<WaitingList> ret = nullopt;
    map<uint32_t, NetworkInterface::WaitingList>::iterator iter;
    iter = _queue_map.find(ip_addr);
    if (iter != _queue_map.end()) {
        ret = iter->second;
    }
    return ret;
}

//! \param[in] MAC_addr the destination Ethernet Address
//! \param[in] dgram the IPv4 datagram to be sent
void NetworkInterface::send_helper(const EthernetAddress MAC_addr, const InternetDatagram &dgram) {
    EthernetFrame frame;
    frame.header().type = EthernetHeader::TYPE_IPv4;
    frame.header().src = _ethernet_address;
    frame.header().dst = MAC_addr;
    frame.payload() = dgram.serialize();
    _frames_out.push(frame);
}

//! \param[in] ipaddr the IPv4 address waits for resolving
//! \param[in] dgram the IPv4 datagram queued to be sent
//! push the datagram into the waiting queue
//! resend ARP request if a new ARP request need to be sent ,i.e., the last request was sent over 5 seconds ago or there is no request sent before
void NetworkInterface::queue_helper(const uint32_t ip_addr, const InternetDatagram &dgram) {
    optional<WaitingList> wait_list = get_WaitingList(ip_addr);
    bool send_ARP = false;
    if (wait_list.has_value()) {
        wait_list.value().waiting_datagram.push(dgram);        
        send_ARP = wait_list.value().time_since_last_ARP_request_send >= NetworkInterface::MAX_RETX_WAITING_TIME;
    } else {
        WaitingList new_wait_list;
        new_wait_list.waiting_datagram.push(dgram);
        _queue_map[ip_addr] = new_wait_list; 
        send_ARP = true;
    }
    if (send_ARP) send_ARP_request(ip_addr);
}

void NetworkInterface::send_ARP_request(const uint32_t ip_addr) {
    EthernetFrame frame;
    frame.header().type = EthernetHeader::TYPE_ARP;
    frame.header().src = _ethernet_address;
    frame.header().dst = ETHERNET_BROADCAST;
    ARPMessage arp;
    arp.opcode = ARPMessage::OPCODE_REQUEST;
    arp.sender_ethernet_address = _ethernet_address;
    arp.sender_ip_address = _ip_address.ipv4_numeric();
    // arp.target_ethernet_address = unknown address
    arp.target_ip_address = ip_addr;
    frame.payload() = BufferList(arp.serialize());
    _frames_out.push(frame);
}

void NetworkInterface::send_ARP_reply(const uint32_t ip_addr, const EthernetAddress& MAC_addr) {
    EthernetFrame frame;
    frame.header().type = EthernetHeader::TYPE_ARP;
    frame.header().src = _ethernet_address;
    frame.header().dst = MAC_addr;
    ARPMessage arp;
    arp.opcode = ARPMessage::OPCODE_REPLY;
    arp.sender_ethernet_address = _ethernet_address;
    arp.sender_ip_address = _ip_address.ipv4_numeric();
    arp.target_ethernet_address = MAC_addr;
    arp.target_ip_address = ip_addr;
    frame.payload() = BufferList(arp.serialize());
    _frames_out.push(frame);
}

bool NetworkInterface::valid_frame(const EthernetFrame &frame) {
    EthernetAddress dst = frame.header().dst;
    return dst == _ethernet_address || dst == ETHERNET_BROADCAST; 
}

void NetworkInterface::cache_mapping(uint32_t ip_addr, EthernetAddress MAC_addr) {
    map<uint32_t, EthernetAddressEntry>::iterator iter;
    iter = _cache.find(ip_addr);
    if (iter != _cache.end()) {
        // update the cache
        iter->second.caching_time = 0;
        iter->second.MAC_address = MAC_addr;
    } else {
        // add new entry
        EthernetAddressEntry entry;
        entry.caching_time = 0;
        entry.MAC_address = MAC_addr;
        _cache[ip_addr] = entry;
    }
}

void NetworkInterface::clear_waitinglist(uint32_t ip_addr, EthernetAddress MAC_addr) {
    map<uint32_t, WaitingList>::iterator iter;
    iter = _queue_map.find(ip_addr);
    if (iter != _queue_map.end()) {
        while (!iter->second.waiting_datagram.empty()) {
            InternetDatagram dgram = iter->second.waiting_datagram.front();
            iter->second.waiting_datagram.pop();
            send_helper(MAC_addr, dgram);
        }
    }
    _queue_map.erase(ip_addr);
}

//! \param[in] dgram the IPv4 datagram to be sent
//! \param[in] next_hop the IP address of the interface to send it to (typically a router or default gateway, but may also be another host if directly connected to the same network as the destination)
//! (Note: the Address type can be converted to a uint32_t (raw 32-bit IP address) with the Address::ipv4_numeric() method.)
void NetworkInterface::send_datagram(const InternetDatagram &dgram, const Address &next_hop) {
    // convert IP address of next hop to raw 32-bit representation (used in ARP header)
    const uint32_t next_hop_ip = next_hop.ipv4_numeric();
    optional<EthernetAddress> MAC_addr = get_EthernetAdress(next_hop_ip);
    if(MAC_addr.has_value()) {
        send_helper(MAC_addr.value(), dgram);
    } else {
        queue_helper(next_hop_ip, dgram);
    }
}

//! \param[in] frame the incoming Ethernet frame
optional<InternetDatagram> NetworkInterface::recv_frame(const EthernetFrame &frame) {
    // 过滤目标不是本网络接口，也不是广播地址的 frame
    optional<InternetDatagram> ret = nullopt;
    if(!valid_frame(frame)) {
        return ret;
    }
    if(frame.header().type == EthernetHeader::TYPE_IPv4) {
        // ipv4
        InternetDatagram dgram;
        if(dgram.parse(Buffer(frame.payload())) == ParseResult::NoError) {
            ret = dgram;
        }
    } else {
        // arp
        ARPMessage arp;
        if(arp.parse(Buffer(frame.payload())) == ParseResult::NoError) {
            cache_mapping(arp.sender_ip_address, arp.sender_ethernet_address);
            clear_waitinglist(arp.sender_ip_address, arp.sender_ethernet_address);
            // 检查是否需要回复请求
            if(arp.opcode == ARPMessage::OPCODE_REQUEST && arp.target_ip_address == _ip_address.ipv4_numeric()) {
                send_ARP_reply(arp.sender_ip_address, arp.sender_ethernet_address);
            }
        }
    }
    return ret;
}
```