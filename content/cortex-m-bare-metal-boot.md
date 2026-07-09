---
title: "Cortex-M Bare-Metal Boot"
summary: "What happens between power-on and main on a Cortex-M - stack-pointer init, data and bss setup, and the hosted-runtime preamble you write yourself with no OS or libc."
tags: [embedded-systems, cortex-m]
updated: 2026-07-09
---

What happens between applying power and reaching `main` on a Cortex-M microcontroller — no OS, no libc, no stdio. The entire hosted-runtime preamble (stack pointer init, global variable initialization, zeroing memory) is code you write.

## Reset sequence

On power-up or reset, the Cortex-M hardware performs exactly two reads from the vector table at `0x08000000` (flash base):

1. **Word 0 → initial stack pointer.** Loaded into MSP (Main Stack Pointer). This is the top of RAM — on STM32F103 with 20 KB SRAM at `0x20000000`, this is `0x20005000`.
2. **Word 1 → reset handler address.** Loaded into PC. The CPU jumps here.

That's it. Everything else — data segment copy, BSS zeroing, peripheral clock enable — is the reset handler's responsibility. The hardware doesn't initialize globals, doesn't call constructors, doesn't set up a heap. If you forget to zero `.bss`, your uninitialized globals contain whatever was in RAM at power-up (not zero — residue from the SRAM cells' random power-on state).

## Linker script and memory map

Compiled objects carry sections. The linker script (`linker.ld`) maps them to physical addresses in flash and RAM:

| Section | Content | Physical location | Startup action |
|---------|---------|-------------------|----------------|
| `.text` | Executable code | Flash | None (execute in place) |
| `.rodata` | Read-only constants | Flash | None |
| `.data` | Initialized globals | RAM (at runtime), Flash (initial values) | Copy flash→RAM at startup |
| `.bss` | Zero-initialized globals | RAM | Zero-fill at startup |

The key insight is that `.data` has **two addresses**: the *load address* (LMA) in flash where initial values are stored, and the *virtual address* (VMA) in RAM where the variable actually lives at runtime. The linker script expresses this as:

```
.data : AT (LOADADDR(.data))
{
    _sdata = .;        /* start of .data in RAM */
    *(.data)
    _edata = .;        /* end of .data in RAM */
} > RAM

_sidata = LOADADDR(.data);  /* start of .data initial values in flash */
```

The startup code copies from `_sidata`→`_edata` (flash) to `_sdata`→`_edata` (RAM) before calling `main`. The symbols `_sidata`, `_sdata`, `_edata` mark the copy bounds — they're addresses, not variables, accessed as `&_sidata` in C.

Storage duration maps to physical location:
- File-scope initialized → `.data` (costs both flash and RAM)
- File-scope uninitialized → `.bss` (costs only RAM, zeroed at boot)
- `const` → `.rodata` (costs only flash — zero RAM)
- Locals → stack (SP-relative, transient)

## Memory-mapped I/O

Peripherals are controlled by reading and writing fixed memory addresses that are wired to hardware registers, not RAM cells. On STM32F103:

```c
#define RCC_BASE     0x40021000
#define RCC_APB2ENR  (*(volatile uint32_t *)(RCC_BASE + 0x18))

#define GPIOC_BASE   0x40011000
#define GPIOC_CRH    (*(volatile uint32_t *)(GPIOC_BASE + 0x04))
#define GPIOC_ODR    (*(volatile uint32_t *)(GPIOC_BASE + 0x0C))
```

Register addresses come from the reference manual (RM0008 for STM32F103). Core peripherals (SysTick, NVIC) are documented in the Cortex-M3 Generic User Guide — they're ARM IP, not STM32-specific.

`volatile` is mandatory. Without it, the compiler can cache register values in CPU registers, reorder writes, or elide repeated reads entirely. The address looks like memory to the compiler but it's actually a wire to hardware — every access has a side effect. Three things `volatile` prevents:
1. **Caching** — forces re-read from the address every time
2. **Reordering** — writes to `volatile` locations stay in program order relative to each other
3. **Elimination** — even "redundant" writes are emitted (e.g., toggling the same bit twice)

## `__attribute__` — GCC extensions

GCC's `__attribute__((...))` syntax expresses things C's grammar can't. The ones that matter for bare-metal:

| Attribute | What it does | Bare-metal use case |
|-----------|-------------|---------------------|
| `section(".name")` | Place symbol in a named linker section | Pin the vector table to `.isr_vector` so the linker script can force it to `0x08000000` |
| `used` | Prevent linker from discarding the symbol even if unreferenced | Vector table entries — the linker never sees them called from C, so `--gc-sections` would drop them |
| `weak` | Provide a default definition that can be overridden | Default handler that traps all unhandled exceptions — user can override `SysTick_Handler` without touching the default |
| `naked` | No prologue/epilogue — no stack frame, no register save | Hand-written assembly functions (will matter for the PendSV context switch) |
| `aligned(N)` | Minimum alignment boundary | Stack alignment to 8 bytes (AAPCS requirement) |

The vector table declaration in startup:

```c
__attribute__((section(".isr_vector"), used))
void (*const vector_table[])(void) = {
    (void *)0x20005000,     // initial SP
    Reset_Handler,          // reset
    Default_Handler,        // NMI
    Default_Handler,        // HardFault
    // ... 11 more Default_Handler entries ...
    SysTick_Handler,        // position 15 — SysTick
};
```

The linker script places `.isr_vector` at `0x08000000` via `KEEP(*(.isr_vector))` — `KEEP` prevents `--gc-sections` from discarding it.

## Startup code

`startup.c` implements `Reset_Handler`:

```c
void Reset_Handler(void) {
    // Copy .data from flash (LMA) to RAM (VMA)
    uint32_t *src = &_sidata;
    uint32_t *dst = &_sdata;
    while (dst < &_edata) {
        *dst++ = *src++;
    }

    // Zero .bss
    for (uint32_t *bss = &_sbss; bss < &_ebss; bss++) {
        *bss = 0;
    }

    main();  // never returns — main has while(1)

    while (1);  // trap if main somehow returns
}

void Default_Handler(void) {
    while (1);  // trap — unhandled exception
}
```

No heap setup, no static constructors, no `atexit` — this isn't a hosted environment. `-ffreestanding -nostdlib` tells GCC not to assume libc.
