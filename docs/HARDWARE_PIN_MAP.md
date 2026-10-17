# Industrial Motor Health Monitor — Authoritative Hardware Pin Map

**Target MCU:** ESP32-S3 N16R8 (16 MB Flash, 8 MB Octal PSRAM)  
**Operating Voltage:** 3.3 V Logic Level  
**Machine-Readable Header:** [`firmware/pin_config.h`](file:///c:/Users/Shudd/OneDrive/Desktop/Shuddhay/AI%20motor/firmware/pin_config.h)  

---

## 1. Master GPIO Assignment Table

| ESP32-S3 Pin | Subsystem | Signal / Function | Peripheral Bus | Active Level | Electrical Requirements | Verification Method |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **GPIO 4** | Diagnostics | Test LED 1 / Vibration Bar #1 | GPIO Output | HIGH (3.3V) | 220–330 Ω series resistor to GND | Web Command `LED_TEST_SINGLE` (1) |
| **GPIO 5** | Diagnostics | Test LED 2 / Vibration Bar #2 | GPIO Output | HIGH (3.3V) | 220–330 Ω series resistor to GND | Web Command `LED_TEST_SINGLE` (2) |
| **GPIO 6** | Diagnostics | Test LED 3 / Vibration Bar #3 | GPIO Output | HIGH (3.3V) | 220–330 Ω series resistor to GND | Web Command `LED_TEST_SINGLE` (3) |
| **GPIO 7** | Diagnostics | Test LED 4 / Vibration Bar #4 | GPIO Output | HIGH (3.3V) | 220–330 Ω series resistor to GND | Web Command `LED_TEST_SINGLE` (4) |
| **GPIO 16** | Diagnostics | Test LED 5 / Vibration Bar #5 | GPIO Output | HIGH (3.3V) | 220–330 Ω series resistor to GND | Web Command `LED_TEST_SINGLE` (5) |
| **GPIO 17** | System Status | **Red Status LED** (Alarm / Fault) | GPIO Output | HIGH (3.3V) | 220–330 Ω series resistor to GND | Steady on critical alarm / Fast blink on sensor error |
| **GPIO 18** | System Status | **Green Status LED** (Normal / Health) | GPIO Output | HIGH (3.3V) | 220–330 Ω series resistor to GND | Steady on normal / Slow heartbeat during 200 Hz sampling |
| **GPIO 8** | Sensors | I²C Data (SDA) | Hardware I2C | Bidirectional | Internal/external pull-up to 3.3V | I²C Bus Scan (`0x53` ADXL, `0x68` DS3231) |
| **GPIO 9** | Sensors | I²C Clock (SCL) | Hardware I2C | 400 kHz Clock | Internal/external pull-up to 3.3V | Clock waveform / 400 kHz timing |
| **GPIO 10** | Temperature | Motor Stator Probe (DS18B20 #1) | OneWire Bus #1 | Bidirectional | **4.7 kΩ pull-up to 3.3V** | ROM detection & temperature query |
| **GPIO 11** | Temperature | Ambient Reference (DS18B20 #2) | OneWire Bus #2 | Bidirectional | **4.7 kΩ pull-up to 3.3V** | ROM detection & temperature query |
| **GPIO 12** | Storage | MicroSD Clock (SCK) | FSPI (SPI2) | 20 MHz Clock | Direct connection to MicroSD module | `SD.begin()` initialization |
| **GPIO 13** | Storage | MicroSD Master-In (MISO) | FSPI (SPI2) | Input | Direct connection to MicroSD module | Sector read check |
| **GPIO 14** | Storage | MicroSD Master-Out (MOSI) | FSPI (SPI2) | Output | Direct connection to MicroSD module | Sector write check |
| **GPIO 15** | Storage | MicroSD Chip Select (CS) | FSPI (SPI2) | Active LOW | Direct connection to MicroSD module | Card select assertion |
| **3.3V Pin** | Power | System 3.3V Rail | Power Out | 3.3V DC | Max load: 500–800 mA (Onboard LDO) | Multimeter measurement |
| **GND Pin** | Power | System Common Ground | Power Ground | 0V Ground | Star ground configuration | Continuity check |

---

## 2. Sensor & Module Wiring Schematics

### 2.1 ADXL345 3-Axis Accelerometer (I²C Address 0x53)
* **VCC:** Connect to ESP32 **3.3V** (Do NOT connect to 5V).
* **GND:** Connect to ESP32 **GND**.
* **SDA:** Connect to ESP32 **GPIO 8**.
* **SCL:** Connect to ESP32 **GPIO 9**.
* **CS:** Connect to **3.3V** (Enables I²C communication mode).
* **SDO:** Connect to **GND** (Sets alternate I²C address to `0x53`).

### 2.2 DS3231SN Real-Time Clock (I²C Address 0x68)
* **VCC:** Connect to ESP32 **3.3V**.
* **GND:** Connect to ESP32 **GND**.
* **SDA:** Connect to ESP32 **GPIO 8** (Shared bus with ADXL345).
* **SCL:** Connect to ESP32 **GPIO 9** (Shared bus with ADXL345).

### 2.3 Dual DS18B20 Temperature Probes (Independent Buses)
* **Probe #1 (Motor-Bearing):**
  * VDD (Red): Connect to **3.3V**.
  * GND (Black): Connect to **GND**.
  * DATA (Yellow): Connect to **GPIO 10** with a **4.7 kΩ pull-up resistor** tied to **3.3V**.
* **Probe #2 (Ambient Air Reference):**
  * VDD (Red): Connect to **3.3V**.
  * GND (Black): Connect to **GND**.
  * DATA (Yellow): Connect to **GPIO 11** with a **4.7 kΩ pull-up resistor** tied to **3.3V**.

### 2.4 MicroSD Card SPI Adapter (FSPI)
* **VCC:** Connect to ESP32 **3.3V** (Ensure adapter has 3.3V logic; generic modules with 5V LDOs may require 5V VCC, but logic signals must remain 3.3V).
* **GND:** Connect to ESP32 **GND**.
* **SCK:** Connect to ESP32 **GPIO 12**.
* **MISO:** Connect to ESP32 **GPIO 13**.
* **MOSI:** Connect to ESP32 **GPIO 14**.
* **CS:** Connect to ESP32 **GPIO 15**.

---

## 3. LED Array Wiring

```text
ESP32 GPIO 4  ───[ 220 Ω ]───( Anode ) [ Test LED 1 (Blue) ] ( Cathode )─── GND
ESP32 GPIO 5  ───[ 220 Ω ]───( Anode ) [ Test LED 2 (Blue) ] ( Cathode )─── GND
ESP32 GPIO 6  ───[ 220 Ω ]───( Anode ) [ Test LED 3 (Amber) ] ( Cathode )─── GND
ESP32 GPIO 7  ───[ 220 Ω ]───( Anode ) [ Test LED 4 (Amber) ] ( Cathode )─── GND
ESP32 GPIO 16 ───[ 220 Ω ]───( Anode ) [ Test LED 5 (Red) ]   ( Cathode )─── GND

ESP32 GPIO 17 ───[ 220 Ω ]───( Anode ) [ Red Status LED ]    ( Cathode )─── GND
ESP32 GPIO 18 ───[ 220 Ω ]───( Anode ) [ Green Status LED ]  ( Cathode )─── GND
```

---

## 4. Pin Safety and Silicon Constraints

1. **Octal SPI Pins (GPIO 33–37):** Reserved exclusively on the ESP32-S3 N16R8 for high-speed PSRAM and Flash. **NEVER** wire to external sensors or LEDs.
2. **Strapping Pins (GPIO 0, 3, 45, 46):** Avoid using for external outputs or pull-downs to prevent boot mode lockouts.
3. **Current Sourcing Limits:** Maximum current draw per GPIO is 20 mA, with an aggregate chip total under 120 mA. Using 220 Ω to 330 Ω series resistors limits LED current to ~6–9 mA per pin, well within safe operating limits.
