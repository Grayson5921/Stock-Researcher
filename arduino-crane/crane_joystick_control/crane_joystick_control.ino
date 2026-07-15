// Arduino code to control two MG90S servo motors with a joystick (A0 and A1).
// Servos connected to pins 9 and 10.
//
// Crane Construction and Implementation - Activity 2
//
// Wiring (matches the assignment's pin connection summary):
//   Joystick VRx  -> A0   (horizontal / base rotation)
//   Joystick VRy  -> A1   (vertical / arm movement)
//   Joystick VCC  -> 5V
//   Joystick GND  -> GND
//   Base servo signal -> D10
//   Arm  servo signal -> D9
//   Servo VCC -> external 5V supply
//   Servo GND -> GND (MUST be shared with Arduino GND)

#include <Servo.h>

// ---------- Pin assignments ----------
const int JOY_X_PIN     = A0;  // VRx: controls the base (horizontal)
const int JOY_Y_PIN     = A1;  // VRy: controls the arm (vertical)
const int BASE_SERVO_PIN = 10; // bottom servo
const int ARM_SERVO_PIN  = 9;  // top servo

// ---------- Tuning constants ----------
const int JOY_CENTER   = 512; // analogRead() midpoint (0-1023 range)
const int DEAD_ZONE    = 60;  // ignore joystick wiggle this close to center

// Angle limits: keep the servos inside a safe range so the crane
// structure never gets forced past what it can physically do.
const int BASE_MIN_ANGLE = 0;
const int BASE_MAX_ANGLE = 180;
const int ARM_MIN_ANGLE  = 20;  // raise if your arm hits the base/table
const int ARM_MAX_ANGLE  = 160; // lower if your arm over-extends

const int STEP_SIZE      = 2;   // degrees moved per update (movement speed)
const int UPDATE_DELAY   = 15;  // ms between updates (smaller = faster)

// ---------- State ----------
Servo baseServo;
Servo armServo;

int baseAngle = 90; // start both servos centered
int armAngle  = 90;

void setup() {
  baseServo.attach(BASE_SERVO_PIN);
  armServo.attach(ARM_SERVO_PIN);

  // Move to the starting position so the crane begins centered.
  baseServo.write(baseAngle);
  armServo.write(armAngle);

  // Serial output for debugging in the Arduino IDE Serial Monitor.
  Serial.begin(9600);
  Serial.println("Crane ready. Move the joystick to control base and arm.");
}

void loop() {
  int joyX = analogRead(JOY_X_PIN); // 0-1023
  int joyY = analogRead(JOY_Y_PIN); // 0-1023

  // --- Base rotation (horizontal axis) ---
  // Only move when the stick is pushed outside the dead zone,
  // so a slightly off-center joystick doesn't cause drift.
  if (joyX > JOY_CENTER + DEAD_ZONE) {
    baseAngle += STEP_SIZE;
  } else if (joyX < JOY_CENTER - DEAD_ZONE) {
    baseAngle -= STEP_SIZE;
  }

  // --- Arm up/down (vertical axis) ---
  if (joyY > JOY_CENTER + DEAD_ZONE) {
    armAngle += STEP_SIZE;
  } else if (joyY < JOY_CENTER - DEAD_ZONE) {
    armAngle -= STEP_SIZE;
  }

  // Prevent the servos from exceeding their allowed range (0-180 max).
  baseAngle = constrain(baseAngle, BASE_MIN_ANGLE, BASE_MAX_ANGLE);
  armAngle  = constrain(armAngle, ARM_MIN_ANGLE, ARM_MAX_ANGLE);

  baseServo.write(baseAngle);
  armServo.write(armAngle);

  // Print current state every ~0.5 s (every 33rd loop at 15 ms/loop)
  static int printCounter = 0;
  if (++printCounter >= 33) {
    printCounter = 0;
    Serial.print("Base: ");
    Serial.print(baseAngle);
    Serial.print("  Arm: ");
    Serial.println(armAngle);
  }

  delay(UPDATE_DELAY); // controls overall movement speed
}
