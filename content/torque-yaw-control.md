---
title: "Quadcopter Flight Physics Overview"
summary: "The fundamental physics of quadcopter flight - forces, stability, and the torque and yaw control principles that control theory and simulation build on."
tags: [guidance-control, pid]
updated: 2026-06-28
---

Fundamental physics of quadcopter flight covering the forces, stability mechanisms, and control principles behind multirotor operation. Introductory-level but provides the physical intuition that control theory and simulation build on.

## Core forces

| Force | Direction | Cause |
|-------|-----------|-------|
| **Lift/Thrust** | Upward (perpendicular to rotor plane) | Propellers push air down → equal/opposite reaction upward (Newton's Third Law) |
| **Weight** | Downward | Fg = mg, gravitational pull on drone mass |
| **Drag** | Opposite to motion | Air resistance proportional to velocity and cross-section |

## Equilibrium conditions

**Hover (static equilibrium)**: Lift = Weight. All forces balanced, no net acceleration. Propulsion force is purely vertical.

**Forward flight at constant velocity (dynamic equilibrium)**: Propulsion force tilted forward. Vertical component balances weight; horizontal component counteracts drag. No net force.

**Accelerating forward**: Horizontal propulsion component exceeds drag → net force → acceleration according to F = ma.

## Torque-based yaw control

Each spinning propeller generates reaction torque. Adjacent propellers rotate in opposite directions (CW and CCW) to cancel torque:
- Balanced speeds → net torque = 0 → no yaw
- Speed up CW pair, slow down CCW pair → net torque in desired direction → yaw

## Wake turbulence

Propellers generate spiraling airflow that interferes with nearby objects or other drones. Factors: propeller size/shape, rotational speed, air density, environment. Critical for swarm operations and close-proximity flight. Managed via CFD simulation (ANSYS) for propeller design optimization.

## Stability mechanisms

Gyroscopes detect orientation changes; accelerometers detect motion. The flight controller adjusts individual motor speeds to maintain balance — this is the hardware layer that [[complementary-filter]] operates on, fusing gyro and accel data into usable attitude estimates.

## See also

- [[complementary-filter]] — Sensor fusion for attitude estimation (the algorithm)
- [[accel-roll-pitch-derivation]] — How accelerometer readings become roll/pitch angles
- [[thrust-vector-from-attitude]] — Converting attitude to thrust components
- [[rotating-coordinate-frames]] — Body vs. inertial frame kinematics
- [[torque-yaw-control]] — Agent note on torque-based yaw
