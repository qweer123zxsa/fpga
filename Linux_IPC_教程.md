# Linux 进程间通信（IPC）教程

> 适合初学者到进阶开发者：从概念、分类、API、示例到选型，一次讲清楚 Linux IPC。

---

## 目录

- [1. 什么是 IPC](#1-什么是-ipc)
- [2. Linux IPC 有哪些方式](#2-linux-ipc-有哪些方式)
- [3. 各方式详细讲解](#3-各方式详细讲解)
  - [3.1 匿名管道 pipe](#31-匿名管道-pipe)
  - [3.2 命名管道 FIFO](#32-命名管道-fifo)
  - [3.3 信号 signal](#33-信号-signal)
  - [3.4 消息队列 message queue](#34-消息队列-message-queue)
  - [3.5 共享内存 shared memory](#35-共享内存-shared-memory)
  - [3.6 信号量 semaphore](#36-信号量-semaphore)
  - [3.7 套接字 socket](#37-套接字-socket)
- [4. IPC 选型建议](#4-ipc-选型建议)
- [5. 常见问题与坑](#5-常见问题与坑)
- [6. 调试命令速查](#6-调试命令速查)
- [7. 总结](#7-总结)

---

## 1. 什么是 IPC

IPC（Inter-Process Communication）即**进程间通信**。  
Linux 中每个进程都有独立地址空间，不能直接访问彼此内存，因此需要内核提供机制来：

- 交换数据
- 协调执行顺序（同步）
- 通知事件（如退出、重载配置）

---

## 2. Linux IPC 有哪些方式

常见 IPC 方式主要有 7 类：

1. 匿名管道（`pipe`）
2. 命名管道（`FIFO`）
3. 信号（`signal`）
4. 消息队列（System V / POSIX）
5. 共享内存（System V / POSIX）
6. 信号量（System V / POSIX）
7. 套接字（`socket`，含 Unix Domain Socket）

---

## 3. 各方式详细讲解

### 3.1 匿名管道 `pipe`

#### 适用场景
- 父子进程通信（`fork` 后）

#### 特点
- 半双工（单向）
- 字节流（无消息边界）
- 通过文件描述符读写

#### 常用 API
```c
int pipe(int fd[2]); // fd[0]读端, fd[1]写端
ssize_t read(int fd, void *buf, size_t count);
ssize_t write(int fd, const void *buf, size_t count);
```

#### 示例（父写子读）
```c
#include <stdio.h>
#include <unistd.h>
#include <sys/types.h>
#include <string.h>

int main() {
    int fd[2];
    pipe(fd);

    pid_t pid = fork();
    if (pid == 0) {
        close(fd[1]);
        char buf[64] = {0};
        read(fd[0], buf, sizeof(buf));
        printf("child recv: %s\n", buf);
        close(fd[0]);
    } else {
        close(fd[0]);
        write(fd[1], "hello pipe", strlen("hello pipe"));
        close(fd[1]);
    }
    return 0;
}
```

#### 注意
- 不关闭不用的一端，可能导致阻塞或无法读到 EOF。

---

### 3.2 命名管道 `FIFO`

#### 适用场景
- 无亲缘关系进程、本机通信

#### 特点
- 在文件系统中有路径（如 `/tmp/myfifo`）
- 仍是字节流

#### 常用 API
```c
int mkfifo(const char *pathname, mode_t mode);
int open(const char *pathname, int flags);
```

#### 命令方式快速体验
```bash
mkfifo /tmp/demo_fifo
# 终端1
echo "hello fifo" > /tmp/demo_fifo
# 终端2
cat /tmp/demo_fifo
```

#### 实战代码：一个写进程 + 一个读进程

写端（`fifo_writer.c`）：
```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <errno.h>

int main(void) {
    const char *fifo = "/tmp/ipc_fifo_demo";

    // 如果 FIFO 不存在就创建；已存在时忽略 EEXIST
    if (mkfifo(fifo, 0666) == -1 && errno != EEXIST) {
        perror("mkfifo");
        return 1;
    }

    // O_WRONLY 在没有读端打开时会阻塞
    int fd = open(fifo, O_WRONLY);
    if (fd == -1) {
        perror("open writer");
        return 1;
    }

    const char *msg = "hello from fifo writer\n";
    if (write(fd, msg, strlen(msg)) == -1) {
        perror("write");
        close(fd);
        return 1;
    }

    close(fd);
    return 0;
}
```

读端（`fifo_reader.c`）：
```c
#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <errno.h>

int main(void) {
    const char *fifo = "/tmp/ipc_fifo_demo";
    char buf[128] = {0};

    if (mkfifo(fifo, 0666) == -1 && errno != EEXIST) {
        perror("mkfifo");
        return 1;
    }

    // O_RDONLY 在没有写端打开时会阻塞
    int fd = open(fifo, O_RDONLY);
    if (fd == -1) {
        perror("open reader");
        return 1;
    }

    ssize_t n = read(fd, buf, sizeof(buf) - 1);
    if (n == -1) {
        perror("read");
        close(fd);
        return 1;
    }

    printf("reader recv: %s", buf);
    close(fd);
    return 0;
}
```

#### 编译与运行步骤（可直接复制）
```bash
gcc fifo_writer.c -o fifo_writer
gcc fifo_reader.c -o fifo_reader

# 先开读端终端
./fifo_reader

# 再开写端终端
./fifo_writer
```

#### 阻塞与非阻塞行为说明
- `open(fifo, O_RDONLY)`：默认会等到有写端连接。
- `open(fifo, O_WRONLY)`：默认会等到有读端连接。
- 若用 `O_NONBLOCK`：
  - 读端可立即打开，但 `read` 可能返回 0（无写端）或 `-1`。
  - 写端在无读端时打开会失败，常见错误是 `ENXIO`。

#### 工程实践建议
- FIFO 是字节流，建议定义应用层协议：`长度 + 负载`，避免粘包/拆包理解错误。
- 多写端并发写入时，单次写入不超过 `PIPE_BUF` 更容易保持原子性。
- 用完记得清理：
```bash
rm -f /tmp/ipc_fifo_demo
```

---

### 3.3 信号 `signal`

#### 适用场景
- 事件通知，而不是大量数据传输

#### 常见信号
- `SIGINT`：Ctrl+C
- `SIGTERM`：优雅终止
- `SIGKILL`：强制终止（不可捕获）
- `SIGCHLD`：子进程状态变化

#### 推荐 API（`sigaction`）
```c
#include <signal.h>
int sigaction(int signum, const struct sigaction *act, struct sigaction *oldact);
int kill(pid_t pid, int sig);
```

#### 示例
```c
#include <stdio.h>
#include <signal.h>
#include <unistd.h>

void handler(int sig) {
    write(1, "got SIGUSR1\n", 12);
}

int main() {
    struct sigaction sa = {0};
    sa.sa_handler = handler;
    sigaction(SIGUSR1, &sa, NULL);

    printf("pid=%d\n", getpid());
    while (1) pause();
    return 0;
}
```

#### 注意
- 信号处理函数中只能调用异步信号安全函数（如 `write`）。

---

### 3.4 消息队列 `message queue`

消息队列有两套：**System V** 与 **POSIX**，新项目常优先 POSIX。

#### 特点
- 有消息边界
- 适合异步解耦
- 可按类型/优先级处理（视实现）

#### 3.4.1 System V 消息队列
```c
int msgget(key_t key, int msgflg);
int msgsnd(int msqid, const void *msgp, size_t msgsz, int msgflg);
ssize_t msgrcv(int msqid, void *msgp, size_t msgsz, long msgtyp, int msgflg);
int msgctl(int msqid, int cmd, struct msqid_ds *buf);
```

消息结构首字段需为 `long mtype`：
```c
struct msgbuf {
    long mtype;
    char mtext[128];
};
```

实战代码（System V）：

发送端（`sysv_msg_sender.c`）：
```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ipc.h>
#include <sys/msg.h>

struct msgbuf {
    long mtype;
    char mtext[128];
};

int main(void) {
    key_t key = 0x1234; // 也可用 ftok 生成
    int msqid = msgget(key, IPC_CREAT | 0666);
    if (msqid == -1) {
        perror("msgget sender");
        return 1;
    }

    struct msgbuf msg;
    msg.mtype = 1;
    snprintf(msg.mtext, sizeof(msg.mtext), "hello from sysv sender");

    // msgsz 只计算 mtext，不包含 mtype
    if (msgsnd(msqid, &msg, strlen(msg.mtext) + 1, 0) == -1) {
        perror("msgsnd");
        return 1;
    }

    printf("sysv sender done\n");
    return 0;
}
```

接收端（`sysv_msg_receiver.c`）：
```c
#include <stdio.h>
#include <stdlib.h>
#include <sys/ipc.h>
#include <sys/msg.h>

struct msgbuf {
    long mtype;
    char mtext[128];
};

int main(void) {
    key_t key = 0x1234;
    int msqid = msgget(key, IPC_CREAT | 0666);
    if (msqid == -1) {
        perror("msgget receiver");
        return 1;
    }

    struct msgbuf msg;
    if (msgrcv(msqid, &msg, sizeof(msg.mtext), 1, 0) == -1) {
        perror("msgrcv");
        return 1;
    }

    printf("sysv receiver recv: %s\n", msg.mtext);

    // 演示结束后删除队列，避免残留
    if (msgctl(msqid, IPC_RMID, NULL) == -1) {
        perror("msgctl IPC_RMID");
        return 1;
    }
    return 0;
}
```

编译与运行：
```bash
gcc sysv_msg_sender.c -o sysv_msg_sender
gcc sysv_msg_receiver.c -o sysv_msg_receiver

# 终端1：先启动接收端（会阻塞等待）
./sysv_msg_receiver

# 终端2：启动发送端
./sysv_msg_sender
```

关键点：
- `msgrcv(..., msgtyp=1, ...)` 只收类型为 1 的消息。
- `msgsnd/msgrcv` 默认阻塞；可加 `IPC_NOWAIT` 改为非阻塞。
- System V 队列是内核对象，进程退出后可能仍存在，记得 `IPC_RMID`。

#### 3.4.2 POSIX 消息队列
```c
mqd_t mq_open(const char *name, int oflag, ...);
int mq_send(mqd_t mqdes, const char *msg_ptr, size_t msg_len, unsigned msg_prio);
ssize_t mq_receive(mqd_t mqdes, char *msg_ptr, size_t msg_len, unsigned *msg_prio);
int mq_close(mqd_t mqdes);
int mq_unlink(const char *name);
```

实战代码（POSIX）：

发送端（`posix_mq_sender.c`）：
```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <mqueue.h>
#include <fcntl.h>
#include <sys/stat.h>

int main(void) {
    const char *name = "/ipc_mq_demo";

    struct mq_attr attr;
    attr.mq_flags = 0;
    attr.mq_maxmsg = 10;
    attr.mq_msgsize = 128;
    attr.mq_curmsgs = 0;

    mqd_t mqd = mq_open(name, O_CREAT | O_WRONLY, 0666, &attr);
    if (mqd == (mqd_t)-1) {
        perror("mq_open sender");
        return 1;
    }

    const char *msg = "hello from posix mq";
    unsigned prio = 5; // 优先级越大越先被取出
    if (mq_send(mqd, msg, strlen(msg) + 1, prio) == -1) {
        perror("mq_send");
        mq_close(mqd);
        return 1;
    }

    printf("posix sender done\n");
    mq_close(mqd);
    return 0;
}
```

接收端（`posix_mq_receiver.c`）：
```c
#include <stdio.h>
#include <stdlib.h>
#include <mqueue.h>
#include <fcntl.h>
#include <sys/stat.h>

int main(void) {
    const char *name = "/ipc_mq_demo";
    char buf[128];
    unsigned prio = 0;

    mqd_t mqd = mq_open(name, O_CREAT | O_RDONLY, 0666, NULL);
    if (mqd == (mqd_t)-1) {
        perror("mq_open receiver");
        return 1;
    }

    ssize_t n = mq_receive(mqd, buf, sizeof(buf), &prio);
    if (n == -1) {
        perror("mq_receive");
        mq_close(mqd);
        return 1;
    }

    printf("posix receiver recv: %s (prio=%u)\n", buf, prio);

    mq_close(mqd);
    mq_unlink(name); // 删除队列名，避免对象残留
    return 0;
}
```

编译与运行：
```bash
gcc posix_mq_sender.c -o posix_mq_sender -lrt
gcc posix_mq_receiver.c -o posix_mq_receiver -lrt

# 终端1：先接收
./posix_mq_receiver

# 终端2：再发送
./posix_mq_sender
```

关键点：
- POSIX 消息队列天然保留消息边界，不会出现流式“粘包”语义问题。
- `mq_msgsize` 限制单条消息最大长度，超过会发送失败。
- 队列满时 `mq_send` 阻塞，队列空时 `mq_receive` 阻塞；可用 `O_NONBLOCK`。
- 完成后记得 `mq_unlink`，否则队列名会残留在系统中。

对比建议：
- 想兼容老系统、已有 SysV 生态：System V。
- 新项目想要更直观接口、优先级能力：POSIX。

---

### 3.5 共享内存 `shared memory`

#### 适用场景
- 高性能、大量数据交换

#### 特点
- 速度最快（避免多次拷贝）
- 只解决“共享数据”，不同步；需配合信号量/锁

#### POSIX 共享内存（常用）
```c
int shm_open(const char *name, int oflag, mode_t mode);
int ftruncate(int fd, off_t length);
void *mmap(void *addr, size_t length, int prot, int flags, int fd, off_t offset);
int munmap(void *addr, size_t length);
int shm_unlink(const char *name);
```

#### 使用流程
1. `shm_open` 创建/打开
2. `ftruncate` 设置大小
3. `mmap` 映射
4. 读写内存
5. `munmap + close + shm_unlink` 清理

#### 实战代码：一个写进程 + 一个读进程（POSIX）

写端（`shm_writer.c`）：
```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

int main(void) {
    const char *name = "/ipc_shm_demo";
    const size_t SIZE = 4096;

    int fd = shm_open(name, O_CREAT | O_RDWR, 0666);
    if (fd == -1) {
        perror("shm_open writer");
        return 1;
    }

    if (ftruncate(fd, SIZE) == -1) {
        perror("ftruncate");
        close(fd);
        return 1;
    }

    char *ptr = mmap(NULL, SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (ptr == MAP_FAILED) {
        perror("mmap writer");
        close(fd);
        return 1;
    }

    // 示例协议：前 4 字节写长度，后面写字符串
    const char *msg = "hello from shared memory";
    int len = (int)strlen(msg);
    memcpy(ptr, &len, sizeof(int));
    memcpy(ptr + sizeof(int), msg, len + 1);

    printf("writer wrote: %s\n", msg);

    munmap(ptr, SIZE);
    close(fd);
    return 0;
}
```

读端（`shm_reader.c`）：
```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

int main(void) {
    const char *name = "/ipc_shm_demo";
    const size_t SIZE = 4096;

    int fd = shm_open(name, O_RDONLY, 0666);
    if (fd == -1) {
        perror("shm_open reader");
        return 1;
    }

    char *ptr = mmap(NULL, SIZE, PROT_READ, MAP_SHARED, fd, 0);
    if (ptr == MAP_FAILED) {
        perror("mmap reader");
        close(fd);
        return 1;
    }

    int len = 0;
    memcpy(&len, ptr, sizeof(int));
    if (len > 0 && len < (int)(SIZE - sizeof(int))) {
        printf("reader recv: %s\n", ptr + sizeof(int));
    } else {
        printf("invalid length: %d\n", len);
    }

    munmap(ptr, SIZE);
    close(fd);
    return 0;
}
```

#### 编译与运行步骤（可直接复制）
```bash
gcc shm_writer.c -o shm_writer -lrt
gcc shm_reader.c -o shm_reader -lrt

# 先写入
./shm_writer

# 再读取
./shm_reader
```

> 说明：较新的 glibc 上可能不需要 `-lrt`，但加上兼容性更好。

#### 清理共享内存对象
共享内存对象通常挂在 `/dev/shm` 下。示例中的对象名是 `/ipc_shm_demo`，清理方式：
```bash
# 方式1：写一个小程序调用 shm_unlink("/ipc_shm_demo")
# 方式2：手工删除（对象映射到 /dev/shm/ipc_shm_demo）
rm -f /dev/shm/ipc_shm_demo
```

#### 为什么共享内存还要配合同步原语
- 共享内存只负责“看见同一块数据”，不保证“谁先写、谁后读”。
- 生产级代码应至少加一种同步机制：
  - `POSIX semaphore`（跨进程最常见）
  - `pthread_mutex`（放在共享内存中并设置 `PTHREAD_PROCESS_SHARED`）
- 否则会出现“读到半包数据”“覆盖写”等竞态问题。

---

### 3.6 信号量 `semaphore`

#### 适用场景
- 互斥访问、进程同步

#### 常见操作
- `P` 操作（等待/减 1）：`sem_wait`
- `V` 操作（释放/加 1）：`sem_post`

#### POSIX API
```c
#include <semaphore.h>
int sem_init(sem_t *sem, int pshared, unsigned int value);
int sem_wait(sem_t *sem);
int sem_post(sem_t *sem);
int sem_destroy(sem_t *sem);
```

有名信号量：
```c
sem_t *sem_open(const char *name, int oflag, ...);
int sem_close(sem_t *sem);
int sem_unlink(const char *name);
```

#### 注意
- 信号量负责“谁先做”，不负责传输业务数据。

---

### 3.7 套接字 `socket`

#### 适用场景
- 本机/跨主机统一通信模型
- 分布式系统、服务端开发

#### 类型
- `AF_UNIX`：本机进程通信（Unix Domain Socket）
- `AF_INET/AF_INET6`：网络通信（TCP/UDP）

#### 服务端流程（TCP）
1. `socket`
2. `bind`
3. `listen`
4. `accept`
5. `recv/send`
6. `close`

#### 特点
- 通用性最强
- 可扩展到跨机器架构
- 需要处理协议设计（粘包、连接管理等）

---

## 4. IPC 选型建议

- **父子进程简单通信**：`pipe`
- **无亲缘本机通信**：`FIFO`
- **仅通知/控制**：`signal`
- **异步消息分发**：`message queue`
- **大数据高性能交换**：`shared memory + semaphore`
- **跨主机或统一接口**：`socket`

一句话：  
**共享内存管“快”，信号量管“稳”，socket 管“远”，消息队列管“解耦”。**

---

## 5. 常见问题与坑

1. **阻塞卡死**：忘记关闭管道另一端，或读写双方都在等待。  
2. **竞态条件**：共享内存没有同步保护。  
3. **资源泄漏**：System V IPC 未删除；POSIX 对象未 `unlink`。  
4. **权限错误**：`mode/umask` 与运行用户不一致。  
5. **粘包/拆包**：流式通信（管道/socket）需自定义协议（长度头 + payload）。

---

## 6. 调试命令速查

```bash
# 查看 System V IPC
ipcs -q   # 消息队列
ipcs -m   # 共享内存
ipcs -s   # 信号量

# 删除 System V IPC
ipcrm -q <msqid>
ipcrm -m <shmid>
ipcrm -s <semid>

# 观察进程打开的 fd/pipe/socket
lsof -p <pid>

# 跟踪系统调用
strace -f -p <pid>
```

---

## 7. 总结

Linux IPC 没有“唯一最优解”，只有“最适合场景的组合”：

- 小而简单：管道/FIFO
- 通知控制：信号
- 异步解耦：消息队列
- 高性能共享：共享内存 + 信号量
- 通用扩展：Socket

掌握这些机制后，你就能设计出性能与可维护性都不错的多进程系统。

