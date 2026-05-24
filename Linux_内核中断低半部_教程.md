# Linux 内核中断低半部实现方法教程

> 面向驱动开发初学者到进阶读者：从“为什么有低半部”到 softirq/tasklet/workqueue/threaded IRQ 的实现与选型，一次讲清楚。

---

## 目录

- [1. 什么是中断上半部与低半部](#1-什么是中断上半部与低半部)
- [2. 为什么必须拆成上下半部](#2-为什么必须拆成上下半部)
- [3. 低半部的四种主流实现](#3-低半部的四种主流实现)
  - [3.1 SoftIRQ（软中断）](#31-softirq软中断)
  - [3.2 Tasklet（基于 SoftIRQ）](#32-tasklet基于-softirq)
  - [3.3 Workqueue（工作队列）](#33-workqueue工作队列)
  - [3.4 Threaded IRQ（线程化中断）](#34-threaded-irq线程化中断)
- [4. 开发流程与代码骨架](#4-开发流程与代码骨架)
- [5. 完整示例：上半部快速应答 + Workqueue 慢处理](#5-完整示例上半部快速应答--workqueue-慢处理)
- [6. 如何选型（实战建议）](#6-如何选型实战建议)
- [7. 常见错误与排查](#7-常见错误与排查)
- [8. 调试与观测命令速查](#8-调试与观测命令速查)
- [9. 总结](#9-总结)

---

## 1. 什么是中断上半部与低半部

当设备触发硬件中断后，CPU 会进入中断上下文执行中断处理函数（ISR）。

- **上半部（Top Half）**：立即执行、必须尽快完成，主要做“确认中断源 + 采样关键状态 + 唤醒后续处理”。
- **低半部（Bottom Half）**：把耗时工作延后执行，如数据搬运、协议解析、日志处理、唤醒用户态等。

核心目标：**缩短中断关闭或受限时间，降低对系统实时性的冲击**。

---

## 2. 为什么必须拆成上下半部

如果把所有逻辑都放在上半部，会出现这些问题：

1. **中断延迟升高**：其他中断得不到及时响应。
2. **调度受限**：中断上下文里不能睡眠，很多 API 不能用。
3. **系统抖动变大**：长 ISR 会影响整体吞吐和实时性。
4. **可维护性差**：复杂逻辑堆在 ISR，难调试、难扩展。

所以常见模式是：

1. 上半部只做最小必要动作；
2. 通过某种“低半部机制”调度后续工作；
3. 在更合适的上下文中完成慢操作。

---

## 3. 低半部的四种主流实现

### 3.1 SoftIRQ（软中断）

#### 特点

- 内核静态定义，类型有限（网络子系统大量使用）。
- 运行在软中断上下文，不可睡眠。
- 并发能力强，性能好，但开发复杂度较高。

#### 典型场景

- 网络收发（`NET_RX_SOFTIRQ` / `NET_TX_SOFTIRQ`）。
- 对延迟敏感、处理路径高度优化的内核子系统。

#### 开发要点

- 驱动普通开发一般**不直接新增自定义 softirq**。
- 主要理解其语义，便于阅读网络块层代码。

---

### 3.2 Tasklet（基于 SoftIRQ）

#### 特点

- 构建在 softirq 之上，接口更简单。
- 同一个 tasklet 实例在同一时刻不会并发运行（天然串行化该实例）。
- 仍在原子上下文，**不能睡眠**。

#### 典型场景

- 比 ISR 稍重，但仍要求短小、不可睡眠的后处理。

#### 注意

- 新内核开发中更推荐使用 `workqueue` 或 `threaded IRQ`。
- 某些内核版本/社区实践中 tasklet 已逐步弱化。

#### 最小示例：ISR 中调度 tasklet

```c
#include <linux/module.h>
#include <linux/interrupt.h>

static int demo_irq = 42; /* 示例 IRQ，实际请从 DT/平台资源获取 */
static unsigned long demo_events;

/* tasklet 回调：运行在软中断上下文，不能睡眠 */
static void demo_tasklet_fn(unsigned long data)
{
    unsigned long events = data;

    /*
     * 这里只能做原子上下文可执行的短处理：
     * - 统计计数
     * - 轻量状态机推进
     * - 准备后续可睡眠任务（比如再转给 workqueue）
     */
    pr_info("demo tasklet run, events=%lu\n", events);
}

DECLARE_TASKLET(demo_tasklet, demo_tasklet_fn, 0);

static irqreturn_t demo_isr(int irq, void *dev_id)
{
    /* 1) 快速 ACK/清中断（此处省略设备寄存器操作） */
    /* 2) 记录事件 */
    demo_events++;
    demo_tasklet.data = demo_events;
    /* 3) 调度 tasklet，慢一点的原子处理放到下半部 */
    tasklet_schedule(&demo_tasklet);
    return IRQ_HANDLED;
}

static int __init demo_tasklet_init(void)
{
    int ret;

    ret = request_irq(demo_irq, demo_isr, IRQF_SHARED, "demo_tasklet_irq", &demo_tasklet);
    if (ret) {
        pr_err("request_irq failed: %d\n", ret);
        return ret;
    }

    pr_info("demo tasklet module loaded\n");
    return 0;
}

static void __exit demo_tasklet_exit(void)
{
    free_irq(demo_irq, &demo_tasklet);
    tasklet_kill(&demo_tasklet); /* 等待可能在跑的 tasklet 结束 */
    pr_info("demo tasklet module unloaded\n");
}

module_init(demo_tasklet_init);
module_exit(demo_tasklet_exit);
MODULE_LICENSE("GPL");
```

#### 这个示例要点

- `tasklet_schedule()` 只负责“挂起执行请求”，真正回调在稍后软中断上下文执行。
- `tasklet` 回调里不要调用可能睡眠的 API（如 `msleep`、`mutex_lock`）。
- 模块退出时用 `tasklet_kill()`，避免卸载后回调访问无效内存。

---

### 3.3 Workqueue（工作队列）

#### 特点

- 在内核线程上下文执行，**可以睡眠**。
- 可使用互斥锁、阻塞 I/O、等待事件等“进程上下文能力”。
- 易用性高，是驱动里最常见的低半部手段之一。

#### 典型场景

- I2C/SPI 后续访问、较复杂状态机、可阻塞资源访问。
- 需要和其它子系统进行可能睡眠的交互。

#### 常见 API

```c
INIT_WORK(&work, work_fn);
schedule_work(&work);
flush_work(&work);
cancel_work_sync(&work);
```

---

### 3.4 Threaded IRQ（线程化中断）

#### 特点

- 使用 `request_threaded_irq()` 同时注册“快速上半部 + 线程函数”。
- 线程函数运行在可调度上下文，**可以睡眠**。
- 对于“需要快速 ACK + 后续较慢处理”的设备非常实用。

#### 典型场景

- GPIO 按键、触摸、部分传感器、慢速总线设备中断。

#### 常见 API 形式

```c
int request_threaded_irq(unsigned int irq,
                         irq_handler_t handler,      // 上半部，可为 NULL
                         irq_handler_t thread_fn,    // 线程函数
                         unsigned long flags,
                         const char *name,
                         void *dev);
```

---

## 4. 开发流程与代码骨架

不管你选哪种低半部，流程基本一致：

1. 申请 IRQ（`request_irq` 或 `request_threaded_irq`）。
2. 在上半部做最小动作：
   - 读取并确认中断状态寄存器；
   - 清中断标志；
   - 记录必要数据到环形缓冲/状态结构；
   - 调度低半部（`schedule_work` / `tasklet_schedule` 等）。
3. 在低半部做耗时处理。
4. 卸载时按顺序清理：`free_irq` + 同步取消低半部任务。

---

## 5. 完整示例：上半部快速应答 + Workqueue 慢处理

下面示例展示经典模式：ISR 里只打标记并调度工作队列，真正慢处理在 `work_fn` 中做。

> 说明：示例用于教学，寄存器读写部分用伪函数表示，请替换为你的 SoC/设备接口。

```c
#include <linux/module.h>
#include <linux/interrupt.h>
#include <linux/workqueue.h>
#include <linux/spinlock.h>

struct demo_dev {
    int irq;
    spinlock_t lock;
    u32 pending_status;
    struct work_struct irq_work;
};

static struct demo_dev gdev;

/* -------- 设备相关伪函数（请替换为真实实现） -------- */
static inline u32 dev_read_irq_status(void)
{
    return 0x1;
}

static inline void dev_clear_irq_status(u32 st)
{
    (void)st;
}

static void dev_slow_path_handle(u32 st)
{
    /*
     * 这里允许做可能阻塞的动作（例如等待资源、复杂处理等）,
     * 因为 workqueue 运行在进程上下文。
     */
    pr_info("demo: slow handle status=0x%x\n", st);
}

/* -------- 低半部：workqueue 回调 -------- */
static void demo_irq_workfn(struct work_struct *work)
{
    unsigned long flags;
    u32 st;

    spin_lock_irqsave(&gdev.lock, flags);
    st = gdev.pending_status;
    gdev.pending_status = 0;
    spin_unlock_irqrestore(&gdev.lock, flags);

    if (st)
        dev_slow_path_handle(st);
}

/* -------- 上半部：硬中断处理函数 -------- */
static irqreturn_t demo_isr(int irq, void *dev_id)
{
    unsigned long flags;
    u32 st;

    st = dev_read_irq_status();
    if (!st)
        return IRQ_NONE; /* 不是本设备中断 */

    dev_clear_irq_status(st); /* 先快速清中断，避免重复触发 */

    spin_lock_irqsave(&gdev.lock, flags);
    gdev.pending_status |= st;
    spin_unlock_irqrestore(&gdev.lock, flags);

    schedule_work(&gdev.irq_work); /* 调度低半部 */
    return IRQ_HANDLED;
}

static int __init demo_init(void)
{
    int ret;

    gdev.irq = 42; /* 示例 IRQ，实际应从 DT/平台资源获取 */
    spin_lock_init(&gdev.lock);
    INIT_WORK(&gdev.irq_work, demo_irq_workfn);

    ret = request_irq(gdev.irq, demo_isr, IRQF_SHARED, "demo_irq", &gdev);
    if (ret) {
        pr_err("demo: request_irq failed: %d\n", ret);
        return ret;
    }

    pr_info("demo: loaded\n");
    return 0;
}

static void __exit demo_exit(void)
{
    free_irq(gdev.irq, &gdev);
    cancel_work_sync(&gdev.irq_work); /* 确保退出时没有悬挂任务 */
    pr_info("demo: unloaded\n");
}

module_init(demo_init);
module_exit(demo_exit);
MODULE_LICENSE("GPL");
```

---

## 6. 如何选型（实战建议）

可以按这条经验路径判断：

1. **后续处理需要睡眠吗？**
   - 需要：优先 `workqueue` 或 `threaded IRQ`。
   - 不需要：可考虑 tasklet（或更底层 softirq 语义）。
2. **是否希望把中断处理天然拆成“快 + 慢线程”结构？**
   - 是：优先 `request_threaded_irq`。
3. **是否追求极限吞吐并在核心子系统内开发？**
   - 是：可能接触 softirq（例如网络路径）。

一句话版本：

- 驱动里默认先考虑 **workqueue / threaded IRQ**；
- 只有明确知道自己处于原子路径且不需睡眠时，才考虑 tasklet/softirq 风格。

---

## 7. 常见错误与排查

### 错误 1：在 ISR 或 tasklet 里睡眠

典型后果：`BUG: sleeping function called from invalid context`。

避免方式：

- ISR/tasklet 中只做原子操作；
- 把可能阻塞的逻辑放到 workqueue 或 threaded handler。

### 错误 2：上半部做太重

表现：

- 中断风暴时系统卡顿；
- 丢中断、响应抖动。

优化：

- 缩短 ISR；
- 尽早 ACK/清中断；
- 合并事件后交给低半部批处理。

### 错误 3：模块退出时清理顺序不当

风险：

- 已卸载对象仍被低半部访问，导致崩溃。

建议顺序：

1. 先 `free_irq` 防止新中断进入；
2. 再 `cancel_work_sync` / `flush_work` 等待低半部结束；
3. 最后释放设备资源。

### 错误 4：共享数据无并发保护

中断与工作线程并发访问状态变量，可能出现竞态。

建议：

- 原子路径用 `spinlock` / 原子变量；
- 进程上下文用 `mutex`（仅可睡眠上下文）。

---

## 8. 调试与观测命令速查

### 查看中断计数

```bash
cat /proc/interrupts
watch -n 1 "cat /proc/interrupts | grep -i demo"
```

### 查看软中断统计

```bash
cat /proc/softirqs
```

### 查看内核日志

```bash
dmesg -T | tail -n 100
```

### ftrace 观察 IRQ 路径（示例）

```bash
echo nop > /sys/kernel/debug/tracing/current_tracer
echo 1 > /sys/kernel/debug/tracing/events/irq/enable
echo 1 > /sys/kernel/debug/tracing/tracing_on
sleep 2
cat /sys/kernel/debug/tracing/trace | tail -n 200
echo 0 > /sys/kernel/debug/tracing/tracing_on
```

---

## 9. 总结

- 低半部的本质是：**把“必须马上做”和“可以稍后做”分离**。
- `softirq/tasklet` 偏原子上下文，不能睡眠；
- `workqueue/threaded IRQ` 在可调度上下文，更适合多数驱动日常开发。
- 写中断代码的黄金法则：
  1. 上半部短小；
  2. 共享数据加锁；
  3. 退出路径同步清理。

如果你愿意，我可以再给你补一版“**针对你当前 LED 项目**”的低半部改造示例（比如按键中断 + 消抖 + 事件上报），直接按你的工程文件结构来写。

