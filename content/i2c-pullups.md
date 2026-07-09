---
title: "I2C Pull-up Resistors"
summary: "Why I2C needs pull-up resistors on SDA and SCL, how to size them, and what breaks when they are missing or wrong."
tags: [sensing, i2c]
updated: 2026-06-14
---

## What a pull-up is

A resistor connected between the signal wire (SDA or SCL) and VCC (3.3V).
Its job: pull the line to 3.3V (logic 1) when nothing is actively driving
it low.

Analogy: the I2C lines are ropes that devices can only *pull down* (to
ground). They cannot push them back up. The pull-up resistor is a spring
that gently returns the rope to 3.3V whenever no one is pulling it.

## Why I2C needs them (open-drain)

> "SDA | Serial Data — bidirectional, **open-drain**, pulled high by
> pull-up resistors" — `i2c-protocol.md`

I2C uses **open-drain** outputs:

- To send a **0**: device connects the line to ground (pulls it low).
- To send a **1**: device does nothing — releases the line. The pull-up
  resistor pulls it high.

This is a "wired-AND" design. Multiple devices can share the same two
wires safely — if two devices try to talk simultaneously, nothing gets
damaged. If any device drives low, the line goes low. They all agree on
the low state.

**Without pull-up resistors** the line floats at an indeterminate voltage
when no device is pulling it low → the bus doesn't work. Transitions are
slow or never complete.

## External vs internal pull-ups

The ESP32 has weak **internal pull-up resistors** built into the silicon,
enableable per-GPIO. This is what your config disables:

```c
.sda_pullup_en    = GPIO_PULLUP_DISABLE,
.scl_pullup_en    = GPIO_PULLUP_DISABLE,
```

These internal pull-ups are typically **~45 kΩ** — far too weak for I2C.
At that resistance the RC time constant (with trace capacitance plus
sensor input capacitance) is too large for clean edges at 100 kHz or
400 kHz. The bus becomes flaky: intermittent ACKs, wrong data, timeouts.

**Best practice:** disable internal pull-ups and use dedicated **external**
resistors on the board.

## Wiring

```
3.3V  ───[4.7kΩ]───┬─── SDA (to ESP32 GPIO21 and MPU SDA)
                   │
3.3V  ───[4.7kΩ]───┴─── SCL (to ESP32 GPIO22 and MPU SCL)
```

Each line gets its own pull-up to 3.3V. Two resistors total.

## Resistor value selection

| Situation | Value | Why |
|-----------|-------|-----|
| Standard 100 kHz bus, short wires | 4.7 kΩ | Sweet spot for most setups |
| 400 kHz fast mode | 2.2–3.3 kΩ | Lower resistance charges line capacitance faster for higher speed |
| Long wires ( >30 cm) | 2.2 kΩ | Overcome higher bus capacitance |
| Many devices on bus (>4) | 2.2–3.3 kΩ | Each device adds ~10 pF input capacitance |
| Breakout board (MPU-6050 module) | Usually has 4.7 kΩ already | Check with a multimeter before adding your own |

Too high → slow rise times → failed communication at speed.
Too low → excessive current draw, devices may struggle to pull the line
low (weak drive strength).

4.7 kΩ at 3.3V draws $I = 3.3/4700 = 0.7\,\text{mA}$ when the line is
pulled low. That's within any I2C device's drive capability by a wide
margin.

## When using a breakout board

Most MPU-6050 breakout boards (GY-521, etc.) already have 4.7 kΩ
pull-ups soldered on. If you're using one, you don't need to add your own
— but verify with a multimeter: probe between SDA and 3.3V (with board
unpowered). If you see ~4.7 kΩ, they're there.

If you're using a bare MPU-6050 chip (QFN package), you **must** add
external pull-ups. The chip has no internal ones.

## Symptoms of missing or weak pull-ups

- Bus works sometimes but fails intermittently
- Frequent NACKs on address or data frames
- `i2c_master_cmd_begin` returns timeout or error
- WHO_AM_I reads 0x00 or random garbage
- Oscilloscope shows slow rise times on SDA/SCL (trapezoidal edges instead
  of square)
- Works at low speed (10 kHz) but fails at 100 kHz

This is the most common hardware cause of I2C bringup failures on ESP32.

## Links

- [[i2c-protocol]] — the protocol these pull-ups enable.
  Bus lines section covers open-drain behaviour.
- [[mpu-6050]] — the sensor on the other end of these lines
  wiring the MPU-6050 is the first time you'll actually need these
