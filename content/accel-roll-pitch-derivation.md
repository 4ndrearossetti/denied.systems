---
title: "Roll and pitch from accelerometer"
summary: "Deriving roll and pitch from the accelerometer out of the rotation matrix, so the formulas - and their signs - are never guesswork."
tags: [state-estimation, kinematics]
updated: 2026-06-17
---

The formulas `roll = atan2(ay, az)` and `pitch = atan2(-ax, sqrt(ay²+az²))` look like they came out of nowhere. They didn't — they fall out of a rotation matrix. Deriving them once means you'll never write the wrong sign.

## The setup

When the chip is at rest, the only force on it is gravity. The accelerometer measures the *support force* (proper acceleration), equal and opposite to gravity. So if gravity in the world frame is $(0, 0, -g)$ (pointing down), the accelerometer reads $(0, 0, +g)$ in the world frame — pointing up.

The chip doesn't measure in the world frame. It measures in *its own frame*. When the chip is rotated, the question is: what does the world's "up" vector look like *expressed in the chip's coordinate system*?

That's a rotation problem. Write the rotation that takes world coordinates to chip coordinates, apply it to $(0, 0, g)$, and the result is what the accelerometer reads on its three axes.

## Roll only

Roll the chip by $\phi$ around its X-axis. The rotation matrix that takes world → chip is the inverse of the chip→world rotation — i.e., a rotation by $-\phi$ around X:

$$
R_x(-\phi) = \begin{bmatrix}
1 & 0 & 0 \\
0 & \cos\phi & \sin\phi \\
0 & -\sin\phi & \cos\phi
\end{bmatrix}
$$

Apply to the world-frame gravity-up vector $(0, 0, g)$:

$$
\begin{bmatrix}
1 & 0 & 0 \\
0 & \cos\phi & \sin\phi \\
0 & -\sin\phi & \cos\phi
\end{bmatrix}
\begin{bmatrix}0 \\ 0 \\ g\end{bmatrix}
= \begin{bmatrix}0 \\ g\sin\phi \\ g\cos\phi\end{bmatrix}
$$

So for pure roll:

$$
a_x = 0, \quad a_y = g\sin\phi, \quad a_z = g\cos\phi
$$

Therefore $a_y / a_z = \tan\phi$, and $\phi = \text{atan2}(a_y, a_z)$.

## Pitch only

Pitch the chip by $\theta$ around its Y-axis.

$$
R_y(-\theta) = \begin{bmatrix}
\cos\theta & 0 & -\sin\theta \\
0 & 1 & 0 \\
\sin\theta & 0 & \cos\theta
\end{bmatrix}
$$

Apply to $(0, 0, g)$:

$$
\begin{bmatrix}
\cos\theta & 0 & -\sin\theta \\
0 & 1 & 0 \\
\sin\theta & 0 & \cos\theta
\end{bmatrix}
\begin{bmatrix}0 \\ 0 \\ g\end{bmatrix}
= \begin{bmatrix}-g\sin\theta \\ 0 \\ g\cos\theta\end{bmatrix}
$$

So for pure pitch:

$$
a_x = -g\sin\theta, \quad a_y = 0, \quad a_z = g\cos\theta
$$

And $-a_x / a_z = \tan\theta$, so $\theta = \text{atan2}(-a_x, a_z)$.

This is *almost* the full formula but only works when roll is zero. For the combined case, we need both rotations.

## Roll AND pitch

Apply the rotations in sequence: first roll, then pitch. The combined rotation world → chip is $R_x(-\phi) \cdot R_y(-\theta)$.

Multiplying and applying to $(0, 0, g)$:

$$
a_x = -g\sin\theta \\
a_y = g\cos\theta \sin\phi \\
a_z = g\cos\theta \cos\phi
$$

Now the formulas. For roll:

$$
\frac{a_y}{a_z} = \frac{g\cos\theta\sin\phi}{g\cos\theta\cos\phi} = \tan\phi
$$

The $\cos\theta$ cancels — pitch doesn't enter the roll formula. So $\text{roll} = \text{atan2}(a_y, a_z)$ works regardless of pitch.

For pitch, the $\sqrt{}$ comes from collapsing the roll terms:

$$
a_y^2 + a_z^2 = g^2\cos^2\theta\sin^2\phi + g^2\cos^2\theta\cos^2\phi
= g^2\cos^2\theta \; (\sin^2\phi + \cos^2\phi) = g^2\cos^2\theta
$$

Taking the square root (assuming $\cos\theta > 0$, true for any sensible drone pitch within $\pm 90^\circ$):

$$
\sqrt{a_y^2 + a_z^2} = g\cos\theta
$$

Then:

$$
\frac{-a_x}{\sqrt{a_y^2 + a_z^2}} = \frac{g\sin\theta}{g\cos\theta} = \tan\theta
$$

And:

$$
\text{pitch} = \text{atan2}(-a_x, \sqrt{a_y^2 + a_z^2})
$$

The $\sqrt{a_y^2 + a_z^2}$ is the magnitude of gravity's projection onto the chip's YZ plane. By construction this is $g\cos\theta$ regardless of roll, so pitch becomes independent of roll — exactly like roll is independent of pitch.

## Why the $\sqrt{}$ matters

If you used the pitch-only formula $\text{atan2}(-a_x, a_z)$ when the chip is also rolled, the denominator would be $g\cos\theta\cos\phi$ instead of $g\cos\theta$ — the roll angle would corrupt the pitch estimate. The $\sqrt{}$ removes the roll dependence.

## What it doesn't give you: yaw

Gravity is along Z. Rotation around Z (yaw) leaves the gravity vector unchanged in the chip's frame — it's invariant under yaw. No amount of trig with $a_x, a_y, a_z$ can recover yaw. That's why gyro yaw drifts without a magnetometer.

## Connection to the complementary filter

These formulas provide the **absolute reference** for roll and pitch that the complementary filter needs. See [[complementary-filter]] for how they're blended with the gyro integration:

```
roll_accel  = atan2(ay, az)
pitch_accel = atan2(-ax, sqrt(ay*ay + az*az))
```

The filter feeds the gyro at high frequencies and these accel-derived angles at low frequencies.

## Coordinate sign check

These formulas assume NED sensor mount: +x forward, +y right, +z down. If the sensor is rotated relative to the vehicle frame, adjust the sign in the atan2 calls — not in the control code.
