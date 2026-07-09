---
title: "FreeRTOS Task Control Block (TCB)"
summary: "The FreeRTOS Task Control Block - the per-task struct the scheduler uses to track, save, and restore a task, and how it relates to the task's separate stack."
tags: [embedded-systems, rtos]
updated: 2026-06-18
---

Every FreeRTOS task has one TCB — a struct allocated at `xTaskCreate()` time that the scheduler uses to track, save, and restore the task. The TCB and the task's stack are separate `pvPortMalloc` calls. The TCB lives in the kernel's internal linked lists (Ready list, Delayed list, etc.); the stack is wherever malloc found room.

## Key fields

```c
typedef struct tskTaskControlBlock {
    volatile StackType_t *pxTopOfStack;   // where to resume — points into the stack
    ListItem_t xStateListItem;            // node in Ready/Blocked/Suspended list
    ListItem_t xEventListItem;            // node in event notification list
    UBaseType_t uxPriority;               // task priority
    StackType_t *pxStack;                 // bottom of allocated stack
    char pcTaskName[configMAX_TASK_NAME_LEN];

    #if (configUSE_TASK_NOTIFICATIONS == 1)
        volatile uint32_t ulNotifiedValue; // the notification value — zero-cost semaphore
        volatile uint8_t ucNotifyState;    // notification pending flag
    #endif
    // ... conditional fields for mutex inheritance, stats, MPU, etc.
} tskTCB;
```

The `ulNotifiedValue` field is what `ulTaskNotifyTake` reads and decrements. It exists in every TCB whether you use notifications or not — there is zero memory cost to enabling them, and that's the entire reason they beat semaphores.

## Context switch mechanics

A FreeRTOS context switch (on Cortex-M / Xtensa / RISC-V) follows the same pattern regardless of architecture:

1. **Save:** The current task's CPU registers are pushed onto its own stack by the hardware exception entry sequence (on Xtensa/ESP32 this happens in the `_frxt_dispatch` assembly trampoline).
2. **Update TCB:** `pxTopOfStack` is updated to point where the registers were saved.
3. **Pick next task:** The scheduler walks the Ready task list by priority — first task at the highest priority that isn't empty. The choice is $O(1)$ because FreeRTOS uses a bitmap of ready priorities, not a linear scan.
4. **Restore:** The picked task's `pxTopOfStack` tells the CPU where to pop its saved registers. Execution resumes at the instruction after the last context switch — the task never knows it was suspended.

```
Run → xSwitch → save registers to current stack
              → update current TCB.pxTopOfStack
              → walk Ready list, pick next
              → load next TCB.pxTopOfStack into SP
              → restore registers from next stack
              → return → next task resumes
```

The entire sequence takes ~1-3 µs on ESP32 at 240 MHz, dominated by register save/restore.

## What lives in the lists

FreeRTOS never searches for a task — every task is always in exactly one scheduler list:

| List | Contains | Transition |
|------|----------|------------|
| Ready (one per priority) | Tasks that can run immediately | `vTaskResume`, `xTaskNotifyGive` |
| Delayed | Tasks waiting on `vTaskDelay`, `vTaskDelayUntil` | Tick interrupt decrements counter |
| Blocked | Tasks waiting on a queue, semaphore, notification | `xQueueReceive`, `ulTaskNotifyTake` |
| Suspended | Tasks explicitly paused | `vTaskSuspend` |
| Pending Ready (ISR-safe) | Tasks unblocked from ISR context | `portYIELD_FROM_ISR` at end of ISR |

When the scheduler looks for the next task to run, it scans the Ready lists from highest priority downward, picks the first thread-ready task, and restores its register context from the TCB's `pxTopOfStack`.

## ESP32 practical footprint

| Item | Size | Notes |
|------|------|-------|
| `sizeof(tskTCB)` | ~84–108 bytes | Varies with config options enabled |
| Default stack | 3072 bytes | `configMINIMAL_STACK_SIZE` on ESP32 |
| `ulTaskNotifyTake` / `ulNotifiedValue` | 0 bytes extra | Reuses existing TCB field |

On a drone with 4-5 tasks (control, telemetry, radio, LED, watchdog), the TCB overhead is ~500 bytes total. The stacks are where the RAM goes — ~16 KB for the control task alone if it does printf over UART.

## Relation to other kernel objects

```
TCB (per task, always exists)
├── embedded: ulNotifiedValue    → ulTaskNotifyTake    (zero-cost, single task)
├── embedded: xEventListItem     → xQueueReceive       (costs queue object)
├── references: xMutexHolder     → xSemaphoreTake      (costs semaphore object)
└── references: xTimerHandle     → xTimerStart         (costs timer object)
```

Task notifications sit on the TCB directly — no separate object, no allocation, no cleanup on deletion. That's the entire reason to reach for them over a queue or semaphore when you only have one consumer task.
