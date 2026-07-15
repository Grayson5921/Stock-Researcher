# Arduino Crane — Joystick-Controlled Servos (Activity 2)

Arduino Uno sketch that controls a small crane built with two MG90S servo
motors and a joystick.

- **Sketch:** `crane_joystick_control/crane_joystick_control.ino`
- Pushing the joystick left/right rotates the **base servo** (D10).
- Pushing the joystick up/down moves the **arm servo** (D9).
- Includes a dead zone around the joystick center (no drift when the stick
  is released) and angle limits so the servos never exceed a safe range.

## Wiring

| Component           | Arduino Pin | Description                      |
|---------------------|-------------|----------------------------------|
| Joystick VRx        | A0          | Horizontal / base movement       |
| Joystick VRy        | A1          | Vertical / arm movement          |
| Joystick VCC        | 5V          | Power supply                     |
| Joystick GND        | GND         | Ground                           |
| Base servo signal   | D10         | Base rotation                    |
| Arm servo signal    | D9          | Arm movement                     |
| Servo VCC           | External 5V | Servo power                      |
| Servo GND           | GND         | Must be shared with Arduino GND  |

**Important:** when powering the servos from an external 5V supply, the
supply's ground must be connected to the Arduino's GND, or the servos will
behave erratically.

## Uploading

1. Open `crane_joystick_control/crane_joystick_control.ino` in the Arduino IDE.
2. Under **Tools → Board**, select **Arduino Uno**, and pick the correct **Port**.
3. Click **Upload**.
4. (Optional) Open the Serial Monitor at **9600 baud** to watch the current
   base/arm angles while you drive the crane.

## Tuning

All adjustable values are constants at the top of the sketch:

- `DEAD_ZONE` — how far the stick must move before the servos respond.
- `STEP_SIZE` / `UPDATE_DELAY` — movement speed (bigger step or smaller
  delay = faster).
- `ARM_MIN_ANGLE` / `ARM_MAX_ANGLE` — limit the arm's travel so it can't
  crash into your crane frame or the table.
