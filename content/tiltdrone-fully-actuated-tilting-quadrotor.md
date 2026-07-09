---
title: "TiltDrone: Fully-Actuated Tilting Quadrotor Platform"
summary: "TiltDrone, a fully-actuated quadrotor whose biaxial tilting rotors decouple translation from rotation, giving independent control of all six degrees of freedom."
tags: [guidance-control]
updated: 2026-06-28
---

TiltDrone is a fully-actuated quadrotor with a biaxial tilting mechanism using two linear servos and spherical-cylindrical joints to independently control all six degrees of freedom. The design allows rotors to tilt in unison, decoupling translation from rotation — unlike conventional quadrotors where fixing rotors in parallel couples rotational and translational DOFs.

IEEE Robotics and Automation Letters, 2020. Prototype built with consumer components (Omnibus F4 V3, Betaflight) and 3D-printed parts. Achieved stable hover at 30° incline and comparable position tracking to conventional flight.

## The coupling problem

Conventional quadrotors fix rotors perpendicular to the platform plane. Steering is achieved by differential thrust. This couples rotational and translational degrees of freedom: to translate forward, you must pitch forward. The thrust vector is always perpendicular to the rotor plane, so attitude and position are locked together.

This coupling makes physical interaction tasks (sensor installation, surface inspection, aerial filming, manipulation) difficult — you can't apply force in an arbitrary direction without also changing orientation.

## Design categories for multi-directional flight

| Category | Mechanism | Tradeoffs |
|----------|-----------|-----------|
| **Fixed-tilt** | Motors fixed at prescribed angles | Simple, robust; reduced flight time from thrust cancellation |
| **Uniaxial-tilt** | Rotors tilt about arm axis | Full 6-DOF possible; opposing thrust vectors create inefficiency |
| **Biaxial-tilt** | Rotors tilt synchronously in two axes (TiltDrone) | No cross-canceling thrust; weight penalty from mechanism |

TiltDrone's biaxial design avoids thrust inefficiency by keeping rotor axes parallel during tilting. All four rotors tilt in unison — the quadrotor form is retained at all tilt angles.

## Kinematic design

Two linear servomotors drive the tilting mechanism in parallel. Spherical-cylindrical compound joints allow the upper and lower structure to remain a constant distance apart during actuation. The mechanism is a single kinematic chain — simple enough to be 3D-printed and actuated with off-the-shelf servos.

Key structural constraints:
- Propeller-propeller clearance during tilting
- Propeller-motor clearance
- Body height and width as functions of maximum tilt angle α_max and propeller/motor dimensions

The design maxes out at ~30° tilt. Above this, structural interference between propellers, motors, and body becomes the limiting factor.

## Control framework

Conventional quadrotor control: 4 inputs (motor speeds) → 4 outputs (thrust, roll, pitch, yaw moments). This is underactuated — translation and rotation are coupled.

TiltDrone control: 6 inputs (4 motor speeds + 2 servo positions) → 6 outputs (3D thrust vector + 3D torque). Fully actuated.

Control allocation:
1. Desired wrench (force + torque) computed from position/attitude controller
2. Spherical thrust command converted to servo positions via inverse kinematics
3. Motor speeds set to achieve total thrust magnitude
4. Limiter handles servo travel saturation

This is a cleaner mapping than over-actuated designs: input-to-output is unique, no additional computation needed for redundancy resolution.

## Hardware challenges

**Twist-induced yaw**: Manufacturing tolerances in the 3D-printed spherical joints caused unwanted twist, inducing yaw during tilt. Mitigated by a passive linear rail that constrains twist while allowing the intended degrees of freedom.

**Servo limitations**: Linear servos have finite travel and speed. The limiter in control allocation prevents commands that would exceed servo range. Servo dynamics (not modeled in the paper) become a constraint on how fast the platform can re-orient its thrust vector.

**Weight**: The tilting mechanism adds weight. For a platform designed for manipulation tasks (not racing), this is acceptable — the payload is the manipulation capability itself.

## See also

- [[thrust-vector-from-attitude]] — How thrust decomposes in the inertial frame for conventional quads
- [[rotating-coordinate-frames]] — The frame separation that TiltDrone achieves mechanically
