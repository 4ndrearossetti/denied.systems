---
title: "Unix signals"
summary: "Unix signals as asynchronous, preemptive notification to a process - the same suspend-save-jump model as a hardware interrupt, one layer up."
tags: [embedded-systems, concurrency]
updated: 2026-07-09
---

A signal is the Unix mechanism for asynchronous, preemptive notification to a process. ~30 named events, each a small integer: `SIGINT` (Ctrl-C), `SIGSEGV` (bad memory access), `SIGALRM` (timer expiry), etc. The kernel delivers them by suspending the process mid-execution, saving its state, and jumping to a registered handler function. Same model as a hardware interrupt — different layer.

See also: [[freertos-tcb]] (how a Cortex-M ISR does this in hardware), [[freertos-metronome-pattern]] (a timer fires → signal handler → task wakes — same pattern, same names, different substrate), [[cortex-m-interrupts]] (the Cortex-M hardware version of this same mechanism), [[cortex-m-bare-metal-boot]] (what you need before interrupts work).

## The mechanism

When the kernel delivers a signal to your process:

1. Your process is suspended **mid-instruction** — doesn't matter where. Not at a function boundary, not at a yield point. Anywhere.
2. The kernel saves the current execution state (registers, PC, stack pointer) somewhere safe.
3. Execution jumps to the function you registered as the handler for that signal.
4. The handler runs.
5. The handler returns.
6. The kernel restores the saved state. Your original code resumes as if nothing happened.

This is asynchronous and preemptive. Your code didn't call the handler. It was invaded by it. This is exactly how a Cortex-M SysTick ISR works — the CPU hardware saves the register context, vectors to the ISR, and restores on return.

## Default vs custom behavior

Every signal has a default disposition:

| Signal | Default | What triggers it |
|--------|---------|------------------|
| `SIGINT` | Terminate | Ctrl-C in terminal |
| `SIGSEGV` | Core dump | Touched unmapped memory |
| `SIGTERM` | Terminate | `kill <pid>` |
| `SIGALRM` | Terminate | `alarm()` timer expired |
| `SIGUSR1` | Terminate | User-defined (nothing by default) |

The default for `SIGALRM` is **terminate the process**. This is the footgun: if you arm a timer before registering a handler, the default behavior fires and your process dies.

To override the default, you register a handler function — "kernel, for THIS signal, don't do the default; call THIS function instead."

## The two setup calls

### 1. `sigaction` — register a handler

```c
#include <signal.h>

void tick_handler(int signum) {
    // signum will be SIGALRM
    // This runs ASYNCHRONOUSLY — the rest of the process is paused
    // Must not block, must not malloc, must be fast
    yield();  // context-switch from inside the signal handler
}

struct sigaction sa = {
    .sa_handler = tick_handler,
    .sa_flags   = SA_RESTART,  // auto-restart interrupted syscalls
};
sigemptyset(&sa.sa_mask);
sigaction(SIGALRM, &sa, NULL);
```

`SA_RESTART` matters: without it, a signal arriving during a blocking `read()` or `printf()` causes that call to return `EINTR` — now every I/O call needs a retry loop. With `SA_RESTART`, the kernel restarts the syscall after the handler returns, as if nothing happened.

### 2. `setitimer` — arm the timer

```c
#include <sys/time.h>

struct itimerval timer = {
    .it_interval = {0, 10000},  // repeat every 10 ms (10,000 µs)
    .it_value    = {0, 10000},  // first expiry after 10 ms
};
setitimer(ITIMER_REAL, &timer, NULL);
```

`it_interval` controls repetition — set both fields to zero for a one-shot. `ITIMER_REAL` delivers `SIGALRM` on expiry (wall-clock time). There are also `ITIMER_VIRTUAL` (CPU time only) and `ITIMER_PROF` (CPU time + kernel time on behalf of process), but `ITIMER_REAL` is what you want for a fixed-frequency preemption tick.

**Order matters.** Register the handler first, then arm the timer. Reversing the two means `SIGALRM` can fire before the handler exists → default behavior → process dies.

## Signal handler constraints

Signal handlers run in a restricted context. The constraints are nearly identical to ISR constraints on a microcontroller:

| Constraint | Why |
|------------|-----|
| No blocking calls (`sleep`, `read`, `printf`) | The process is already suspended — blocking here deadlocks everything |
| No `malloc` / `free` | The interrupted code might have been mid-malloc, holding the heap lock |
| No non-reentrant functions | The interrupted code might have been in the same function — re-entering it corrupts state |
| Must be fast | The rest of the process is paused until the handler returns |
| Only async-signal-safe functions | POSIX defines a short list: `write`, `_exit`, `signal`, `sem_post` (yes, this one is safe — useful) |

## Signal mask and nesting

While a signal handler is running, the kernel automatically blocks delivery of the same signal — you won't get a `SIGALRM` nested inside a `SIGALRM` handler. Other signals can still arrive (and interrupt your handler) unless you explicitly block them via `sa_mask`.

This means: if your tick handler takes longer than one tick period, you'll miss ticks. The timer keeps firing; the kernel queues at most one pending `SIGALRM` while the handler runs. If multiple fire during that window, the extras are merged (standard signals don't queue; real-time signals do, but that's `SIGRTMIN` territory).

For a 200 Hz control loop (5 ms period), the handler must return in well under 5 ms. With `swapcontext` taking ~1 µs and the control task doing the heavy lifting, this is easy — the handler only calls `yield()` and returns.

## Practical: arming the timer from main

After registering the handler and arming the timer, `main()` no longer calls `yield()` explicitly — the timer does it. The idle task becomes the fallback that runs when no other task is ready:

```c
int main(void) {
    init_tcb(&tcb_a, task_a);
    init_tcb(&tcb_b, task_b);
    init_tcb(&tcb_idle, task_idle);

    // Register handler FIRST
    struct sigaction sa = { .sa_handler = tick_handler, .sa_flags = SA_RESTART };
    sigemptyset(&sa.sa_mask);
    sigaction(SIGALRM, &sa, NULL);

    // Arm timer SECOND
    struct itimerval timer = {
        .it_interval = {0, 10000},  // 10 ms → 100 Hz tick
        .it_value    = {0, 10000},
    };
    setitimer(ITIMER_REAL, &timer, NULL);

    // Jump into first task — the timer now drives scheduling
    setcontext(&tcb_a.exec_state);
    return 0;
}
```

From this point, `yield()` is called from the signal handler every 10 ms. Tasks that call `task_delay()` will be unblocked when enough ticks have elapsed. The idle task spins harmlessly when nothing else is ready. This is a preemptive RTOS in ~150 lines of C.
