---
title: "I2C Protocol"
summary: "The I2C two-wire, open-drain, master-slave bus that connects sensors like the MPU-6050 to a microcontroller on the same board."
tags: [sensing, i2c]
updated: 2026-06-14
---

A communication protocol for chips on the same PCB. Two wires, shared bus,
master-slave.

## Bus lines

| Line | Role |
|------|------|
| SDA | Serial Data — bidirectional, open-drain, pulled high by pull-up resistors |
| SCL | Serial Clock — driven by the master. Every data bit is clocked on SCL. |

Open-drain means any device can pull a line low, but no device pushes it
high (the pull-up resistor does that). This enables multi-master arbitration
and clock-stretching by slaves. See [[i2c-pullups]] for the
full explanation of why pull-ups are needed, what value to use, and what
happens when they're missing.

## Master / slave

The **master** controls the clock, initiates every transaction, decides the
direction. On the ESP32, the master is the I2C peripheral (or bit-banged
GPIOs — use the hardware peripheral for the MPU-6050; bit-bang only when no
hardware I2C pin is available).

The **slave** only responds when addressed by the master. The MPU-6050 is
a slave at address 0x68 (7-bit). The 7-bit address gets shifted left by 1
and the R/W bit is OR'd into the LSB to form the 8-bit address byte:

```
7-bit address:     1 1 0 1 0 0 0     (0x68)
Write bit (0):                  0
                               ↓
Address byte (write): 1 1 0 1 0 0 0 0  = 0xD0
Read bit (1):                   1
                               ↓
Address byte (read):  1 1 0 1 0 0 0 1  = 0xD1
```

Formula:
- Write = `(0x68 << 1) | 0` = `0xD0`
- Read  = `(0x68 << 1) | 1` = `0xD1`

## Transaction structure

Every transaction follows a strict sequence:

```
START | ADDRESS + R/W | ACK | [DATA + ACK]... | STOP
```

1. **START condition (S):** SDA goes low while SCL is high. This pulls the
   bus out of idle and tells all slaves a new transaction is starting.
2. **Address frame:** master sends 8 bits on SDA — 7-bit device address
   (MSB first) followed by 1 bit for R/W direction (0 = write, 1 = read).
   Each bit is clocked on SCL. The slave whose address matches asserts
   ACK by pulling SDA low on the 9th clock cycle. No slave ACKing is a
   NACK — transaction should abort (device absent, dead, or busy).
3. **Data frames:** one or more bytes of data, each 8 bits followed by an
   ACK/NACK. The ACK is sent by the *receiver* — if the master is
   receiving, it ACKs each byte it wants more of, and NACKs the last byte
   to tell the slave "stop sending."
4. **STOP condition (P):** SDA goes high while SCL is high. Bus returns to
   idle.

## Reading a register (two-phase transaction)

Reading a register on the MPU-6050 requires two phases because the chip
exposes a flat address space — you need to tell it *which* address to
read from before you can read the data.

Note: `0x3B` is **not** an ESP32 register. It's a register **inside the
MPU-6050** — specifically `ACCEL_XOUT_H`. You're telling the slave "I want
to start reading from your internal address 0x3B." The ESP32 (master) has
no I2C-accessible register space; it just initiates transactions and
buffers the bytes the slave sends.

### Phase 1: Write the register address

```
START | 0xD0 (write) | ACK | <reg_addr> | ACK | REPEATED START
```

Send the device address in write mode (0xD0 = 0x68 << 1 | 0), then send
the register byte. The chip internally latches this as the auto-increment
pointer. Instead of STOP, issue a **repeated START** (Sr) — another START
condition without an intervening STOP.

### Why repeated START

Think of repeated START like staying on the same phone call instead of
hanging up and dialling again. A full STOP would be hanging up — the bus
goes idle, all slaves reset their state. Repeated START says "same
transaction, still talking, just switching what I'm asking for."

Concretely: after sending the register address and getting ACK, instead of
STOP you assert another START condition while SCL is still high. This
tells every device on the bus "new address phase coming — but I'm still
the master and the previous pointer is valid." Then you immediately send
the address byte again, this time with the Read bit set.

Some slaves reset their internal address pointer on STOP. If you send a
full STOP between writing the register address and reading the data, the
chip might forget which register you were pointing at and start at 0x00
(or an undefined state). Repeated START tells the chip "same bus, same
transaction, same pointer." The MPU-6050 tolerates both, but repeated
START is correct I2C practice.

### Phase 2: Read the data

```
REPEATED START | 0xD1 (read) | ACK | <data_byte> | ACK | <data_byte> | NACK | STOP
```

Resend the device address in read mode (0xD1 = 0x68 << 1 | 1). The chip
now clocks out data starting from the register you wrote. After each byte,
the master ACKs if it wants another byte, and sends a NACK on the last
byte followed by STOP.

### Multi-byte burst reads

The MPU-6050 auto-increments its register pointer after each read byte.
This means you can burst-read all 14 sensor bytes by requesting 14
consecutive bytes starting from 0x3B. The master ACKs the first 13 and
NACKs the 14th + STOP. This guarantees a consistent snapshot: all bytes
come from one measurement cycle. Reading one register at a time with
separate transactions risks mixing samples.

## ACK / NACK ownership

Who sends the ACKs depends on which phase you're in:

| Phase | Who sends address | Who ACKs | Who sends data | Who decides to stop |
|-------|-------------------|----------|----------------|---------------------|
| Write register | Master (`0xD0`) | Slave (MPU) | Master (`0x3B`) | — |
| Read data | Master (`0xD1`) | Slave (MPU) | **Slave (MPU)** | **Master** (NACK) |

This is the most common point of confusion in I2C. During the read phase
the MPU is generating the data, so it's natural to think the MPU controls
the flow. It doesn't. The master (your code on the ESP32) decides when it
has enough bytes and signals "stop" by NACKing the last one. The MPU never
NACKs during the read data phase — it just keeps sending until told to
stop.

## Summary transaction flow for sensor reads

```
START | 0xD0 | ACK | 0x3B | ACK | Sr | 0xD1 | ACK | [read 14 bytes, ACK 13, NACK 14th] | STOP
```

That's the pattern: one transaction gets you all 6 axes + temperature in
a consistent atomic read. Store it in a 14-byte buffer, then assemble the
16-bit signed values:

```c
int16_t ax = (buf[0] << 8) | buf[1];
int16_t ay = (buf[2] << 8) | buf[3];
// ... etc
```

MPU-6050 is big-endian (MSB first), so this is just a shift-and-or.

## Links

- [[mpu-6050]] — the sensor this protocol talks to
  wire the MPU-6050, read gyro/accel over I2C
- [i2cdevlib](https://github.com/jrowberg/i2cdevlib) — Jeff Rowberg's
  well-documented MPU-6050 driver, useful as a register-accurate reference
  for the ESP32 port
