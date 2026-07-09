---
title: "Complementary filter for attitude estimation"
summary: "Fusing a drifting gyro and a noisy accelerometer into one roll/pitch estimate by splitting the frequency domain - the simplest useful attitude filter."
tags: [state-estimation, sensor-fusion]
updated: 2026-06-17
---

The raw MPU-6050 gives accelerometer (m/s²) and gyroscope (rad/s) readings. Neither alone is sufficient for attitude estimation — the complementary filter fuses them into a single roll/pitch estimate.

## The problem

| Sensor | Strength | Weakness |
|--------|----------|----------|
| Gyro | Fast, clean angular velocity | Integrates to angle, but biases accumulate → drift |
| Accel | Absolute roll/pitch reference at rest (gravity direction) | Noisy under vibration, corrupted by linear acceleration |

Each sensor covers what the other lacks. The complementary filter exploits this by splitting the frequency domain: **gyro dominates at high frequencies, accel at low frequencies.**

## The filter (roll and pitch)

One line per axis:

```
roll  = (1 - α) · (roll_prev  + p · dt) + α · roll_accel
pitch = (1 - α) · (pitch_prev + q · dt) + α · pitch_accel
```

Where `roll_accel` and `pitch_accel` are computed from the accelerometer (see [[accel-roll-pitch-derivation]] for the full derivation):

```c
float roll_accel  = atan2f(ay, az);
float pitch_accel = atan2f(-ax, sqrtf(ay*ay + az*az));
```

These use the fact that at rest, the accelerometer measures only gravity — so the direction of the gravity vector in the sensor frame directly gives the tilt angles.

## Choosing alpha

α is the cross-fade frequency. The crossover point is:

$$f_c = \frac{\alpha}{2\pi \cdot dt}$$

| α (at 200 Hz) | Crossover | Behavior |
|---------------|-----------|----------|
| 0.5 | ~16 Hz | Heavy accel blend — jittery |
| 0.02 | ~0.3 Hz | Good for hover, moderate flight |
| 0.01 | ~0.16 Hz | Better for aggressive flight, slower drift recovery |
| 0.001 | ~0.016 Hz | Almost pure gyro — minutes of drift |

For a quadcopter in attitude-hold or gentle flight, α = 0.02–0.05 works well. For acro/rate mode where sustained acceleration is common (the accel no longer points at gravity), drop to α = 0.005–0.01.

## What it doesn't do

- **Yaw.** There's no magnetic reference in a 6-DOF IMU. Yaw is pure gyro integration and will drift. This is acceptable for rate mode — the pilot commands yaw rate, and relative heading is all that matters.
- **Absolute position.** The complementary filter estimates attitude only. Position requires additional sensors (barometer, GPS, optical flow).

## On hardware

The filter runs inside the control task (see [[freertos-metronome-pattern]]), after `mpu6050_read()` and before `control_update()`. The gyro integration step (`p · dt`) uses the same dt as the control loop. The `roll_accel` and `pitch_accel` terms can be computed at a lower rate (every 4th tick, 50 Hz) since the accel is slow-changing — saves CPU cycles on the microcontroller.

The pitch formula sign assumes the sensor is mounted with +x forward, +y right, +z down (NED). If the sensor mount flips any axis, adjust the sign in the atan2 calls — not in the control code.
